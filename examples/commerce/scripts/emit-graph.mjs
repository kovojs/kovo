import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { commerceCartPageMeta, commerceStylesheetHrefs } = await import('../src/graph.js');
const ts = await import('typescript');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const commerceRoot = resolve(scriptDir, '..');
const repoRoot = resolve(commerceRoot, '../..');
const localCliPath = resolve(repoRoot, 'packages/cli/src/bin.ts');
const sourcePath = resolve(commerceRoot, 'src/domain.ts');
const graphPath = resolve(commerceRoot, 'src/generated/graph.json');
const touchGraphPath = resolve(commerceRoot, 'src/generated/touch-graph.ts');
const optimisticPath = resolve(commerceRoot, 'src/generated/optimistic/cart-add.ts');
const tempRoot = mkdtempSync(resolve(tmpdir(), 'kovo-commerce-graph-'));
let drizzleStaticCounter = 0;
const source = readFileSync(sourcePath, 'utf8');
const starterCart = { count: 0 };
const componentNames = ['cart-badge', 'order-history', 'product-grid'];
const registryFacts = {
  mutationInputs: compileMutationInputs(),
  mutations: { 'cart/add': 'typeof addToCart' },
};
const registryFactsPath = resolve(tempRoot, 'registry-facts.json');
writeFileSync(registryFactsPath, `${JSON.stringify(registryFacts, null, 2)}\n`);
process.on('exit', () => rmSync(tempRoot, { force: true, recursive: true }));

const componentResults = componentNames.map((name) => {
  const fileName = `examples/commerce/src/components/${name}.tsx`;
  const factsPath = resolve(tempRoot, `${name}.facts.json`);
  runKovo([
    'compile',
    'component',
    resolve(commerceRoot, `src/components/${name}.tsx`),
    '--out',
    resolve(tempRoot, `${name}.tsx`),
    '--file-name',
    fileName,
    '--registry-facts',
    registryFactsPath,
    '--facts-out',
    factsPath,
  ]);
  return readJson(factsPath);
});

const routeFactsPath = resolve(tempRoot, 'route.facts.json');
runKovo([
  'compile',
  'route',
  resolve(commerceRoot, 'src/app.tsx'),
  '--out',
  resolve(tempRoot, 'app.kovo-route.tsx'),
  '--file-name',
  'examples/commerce/src/app.tsx',
  '--artifact-file-name',
  'examples/commerce/src/generated/app.kovo-route.tsx',
  '--rewrite',
  'CartBadge=./cart-badge.js',
  '--rewrite',
  'OrderHistory=./order-history.js',
  '--rewrite',
  'ProductGrid=./product-grid.js',
  '--facts-out',
  routeFactsPath,
]);
const routeResult = readJson(routeFactsPath);

const formatJson = (value, indent = 0) => {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    }
    const childIndent = ' '.repeat(indent + 2);
    return `[\n${value.map((item) => `${childIndent}${formatJson(item, indent + 2)}`).join(',\n')}\n${' '.repeat(indent)}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const childIndent = ' '.repeat(indent + 2);
    return `{\n${entries
      .map(([key, item]) => `${childIndent}${JSON.stringify(key)}: ${formatJson(item, indent + 2)}`)
      .join(',\n')}\n${' '.repeat(indent)}}`;
  }
  return JSON.stringify(value);
};

const queryDomainsFromFacts = (facts) =>
  [...facts]
    .sort((left, right) => siteLineNumber(left.site) - siteLineNumber(right.site))
    .map((fact) => ({ domains: [...fact.reads], query: fact.query }));

const siteLineNumber = (site) => Number(String(site).split(':').pop() ?? 0);

// SPEC.md §10.5 / §11.1: run the real Drizzle static extractor over the
// commerce source. Stage-1 symbolic effects (write → effect IR) and Stage-2
// algebraic query shapes (loader → shape IR) are read directly from the
// loaders/handlers; nothing here is hand-authored. The deriver turns each
// (mutation effects × query shape) pair into a committed optimistic transform
// or a named §10.5 punt.
const extractionFiles = ['domain.ts', 'queries.ts', 'graph.ts', 'schema.ts', 'db.ts'].map(
  (rel) => ({
    fileName: `examples/commerce/src/${rel}`,
    source: readFileSync(resolve(commerceRoot, `src/${rel}`), 'utf8'),
  }),
);

const staticFacts = compileDrizzleStatic({
  files: extractionFiles,
});
const allEffectFacts = staticFacts.symbolicEffects;
const algebraicShapes = staticFacts.algebraicShapes;
const queryFacts = staticFacts.queryFacts;
const commerceQueryDomains = queryDomainsFromFacts(queryFacts);
const shapeByQuery = new Map(algebraicShapes.map((shape) => [shape.query, shape]));

// Map each exported handler variable to the line span of its
// definition, so extracted write sites can be attributed to the right handler.
const appSourceFile = ts.createSourceFile('domain.ts', source, ts.ScriptTarget.Latest, true);
const handlerSpans = new Map();
const collectSpans = (node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    handlerSpans.set(node.name.text, [
      appSourceFile.getLineAndCharacterOfPosition(node.getStart(appSourceFile)).line + 1,
      appSourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
    ]);
  }
  ts.forEachChild(node, collectSpans);
};
collectSpans(appSourceFile);

const siteLine = (site) => Number(site.split(':').pop());
const effectsInHandler = (name) => {
  const span = handlerSpans.get(name);
  assert.ok(span, `commerce app.ts must define a ${name} handler`);
  return allEffectFacts.filter((fact) => {
    const line = siteLine(fact.site);
    return line >= span[0] && line <= span[1];
  });
};

// A chained `db.update(table).set(...).where(...)` reports its call-start at the
// `await db` line; re-point the recorded site to the line that actually names
// the Drizzle write call (`.insert(table)` / `.update(table)` / `.delete(table)`)
// so the touch-graph provenance honesty check resolves it to a real write line.
const sourceLines = source.split('\n');
const writeCallPattern = /\.(?:insert|update|delete)\(/;
const repointSite = (site) => {
  const separator = site.lastIndexOf(':');
  const path = site.slice(0, separator);
  const startLine = Number(site.slice(separator + 1));
  for (let line = startLine; line < startLine + 4 && line <= sourceLines.length; line += 1) {
    if (writeCallPattern.test(sourceLines[line - 1] ?? '')) return `${path}:${line}`;
  }
  return site;
};

// Extraction-driven write sites: the touch graph keeps the app's declared
// invalidation semantics (domains/keys), but each site is the real extracted
// write location for that (handler, table) pair.
const siteFor = (handler, table) => {
  const matches = effectsInHandler(handler).filter((fact) => fact.effect.table === table);
  assert.equal(
    matches.length,
    1,
    `expected one ${table} write in ${handler}, got ${matches.length}`,
  );
  return repointSite(matches[0].site);
};

const commerceTouchGraph = {
  'cart.addItem': {
    touches: [
      {
        domain: 'cart',
        keys: null,
        site: siteFor('addToCart', 'cart_items'),
        via: 'cart_items',
      },
      {
        domain: 'order',
        keys: null,
        site: siteFor('addToCart', 'orders'),
        via: 'orders',
      },
      {
        domain: 'product',
        keys: 'arg:productId',
        predicate: 'eq',
        site: siteFor('addToCart', 'products'),
        via: 'products',
      },
    ],
    reads: [],
    unresolved: [],
  },
};

const commerceGraph = {
  endpoints: [],
  mutations: [
    {
      guards: ['authed', 'rateLimit:session'],
      invalidates: ['cart', 'product', 'order'],
      inputFields: ['productId', 'quantity'],
      key: 'cart/add',
      session: 'commerceSession',
      writes: ['cart', 'product', 'order'],
    },
    {
      guards: ['authed'],
      inputFields: [],
      key: 'auth/sign-out',
      session: 'commerceSession',
      writes: ['auth'],
    },
  ],
  optimistic: [
    { derivation: { status: 'derived' }, mutation: 'cart/add', query: 'cart', status: 'derived' },
    {
      derivation: { status: 'derived' },
      mutation: 'cart/add',
      query: 'productGrid',
      status: 'derived',
    },
    {
      derivation: { status: 'derived' },
      mutation: 'cart/add',
      query: 'orderHistory',
      status: 'derived',
    },
  ],
  ownerDomains: [],
  pages: [
    {
      i18n: ['en-US:cartLabel,productStock'],
      meta: commerceCartPageMeta(starterCart),
      modulepreloads: [],
      prefetch: false,
      route: '/',
      stylesheets: [...commerceStylesheetHrefs],
    },
    {
      i18n: ['en-US:cartLabel,productStock'],
      meta: commerceCartPageMeta(starterCart),
      modulepreloads: [],
      prefetch: false,
      route: '/cart',
      stylesheets: [...commerceStylesheetHrefs],
    },
  ],
  queries: commerceQueryDomains,
  scopeAudits: [],
  touchGraph: commerceTouchGraph,
};

const graph = deriveGraphViaCli({
  components: componentResults,
  graph: commerceGraph,
  routePages: [routeResult],
});
const staticGraphArtifacts = compileDrizzleStatic({
  invalidation: {
    constName: 'commerceInvalidationSets',
    mutations: [{ mutation: 'cart/add', touchGraphKey: 'cart.addItem' }],
    queries: commerceQueryDomains,
    touchGraph: commerceTouchGraph,
    typeName: 'CommerceInvalidationSets',
  },
});

const graphJson = `${formatJson(graph)}\n`;
const commerceInvalidationRegistrySource = staticGraphArtifacts.invalidationRegistrySource;
const touchGraphSource = `import type { CartQueryResult, OrderHistoryResult, ProductGridResult } from '../domain.js';

export const commerceTouchGraph = ${formatJson(commerceTouchGraph)} as const;

export const commerceQueryDomains = ${formatJson(commerceQueryDomains)} as const;

${commerceInvalidationRegistrySource}
declare module '@kovojs/core' {
  interface QueryRegistry {
    cart: CartQueryResult;
    productGrid: ProductGridResult;
    orderHistory: OrderHistoryResult;
  }

  interface MutationRegistry {
    'cart/add': typeof import('../domain.js').addToCart;
  }

  interface InvalidationSets extends CommerceInvalidationSets {}
}
`;

// SPEC.md §10.5 (derived optimism): the cart/add symbolic effects come straight
// from the extracted Drizzle handler writes (Stage 1) and each query shape from
// the extracted loader (Stage 2). The deriver pairs the effects with every query
// shape — every pair derives here (cart += quantity, productGrid update-row of
// the matched product's stock, orderHistory push-row of the new order). Deleting
// a transform from generated/optimistic/ lets you hand-write an override;
// regenerating restores derivation (the §10.4 pair-by-pair contract).
const cartAddEffects = effectsInHandler('addToCart').map((fact) => fact.effect);
const cartAddOptimisticQueries = ['cart', 'orderHistory', 'productGrid'].map((query) => {
  const shape = shapeByQuery.get(query);
  assert.ok(shape, `commerce extractor must produce a ${query} query shape`);
  return { query, shape };
});
const optimisticSourcePath = resolve(tempRoot, 'cart-add.optimistic.ts');
const optimisticFactsPath = resolve(tempRoot, 'cart-add.optimistic.json');
compileDrizzleOptimistic({
  complete: true,
  constName: 'cartAddDerivedOptimistic',
  effects: cartAddEffects,
  entries: cartAddOptimisticQueries,
  factsPath: optimisticFactsPath,
  formImport: { name: 'addToCartForm', path: '../../domain.js' },
  outPath: optimisticSourcePath,
  queue: 'cart',
});
assert.deepEqual(
  readJson(optimisticFactsPath),
  cartAddOptimisticQueries.map(({ query }) => ({
    derivation: { status: 'derived' },
    query,
    status: 'derived',
  })),
);
const optimisticSource = [
  "import '../live-targets.js';",
  '',
  readFileSync(optimisticSourcePath, 'utf8'),
].join('\n');

if (process.argv.includes('--check')) {
  assert.equal(readFileSync(graphPath, 'utf8'), graphJson, 'generated graph.json is stale');
  assert.equal(
    readFileSync(touchGraphPath, 'utf8'),
    touchGraphSource,
    'generated touch-graph.ts is stale',
  );
  assert.equal(
    readFileSync(optimisticPath, 'utf8'),
    optimisticSource,
    'generated optimistic/cart-add.ts is stale',
  );
} else {
  writeFileSync(graphPath, graphJson);
  writeFileSync(touchGraphPath, touchGraphSource);
  mkdirSync(resolve(commerceRoot, 'src/generated/optimistic'), { recursive: true });
  writeFileSync(optimisticPath, optimisticSource);
}

function compileMutationInputs() {
  const outPath = resolve(tempRoot, 'mutation-inputs.json');
  runKovo([
    'compile',
    'mutation-inputs',
    sourcePath,
    '--out',
    outPath,
    '--file-name',
    'examples/commerce/src/domain.ts',
  ]);
  return readJson(outPath);
}

function deriveGraphViaCli(input) {
  const inputPath = resolve(tempRoot, 'graph-input.json');
  const outPath = resolve(tempRoot, 'graph-output.json');
  writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  runKovo(['compile', 'graph', inputPath, '--out', outPath]);
  return readJson(outPath);
}

function compileDrizzleOptimistic(input) {
  const inputPath = resolve(tempRoot, `${input.constName}.drizzle-optimistic-input.json`);
  writeFileSync(
    inputPath,
    `${JSON.stringify(
      {
        complete: input.complete,
        constName: input.constName,
        effects: input.effects,
        entries: input.entries,
        formImport: input.formImport,
        queue: input.queue,
      },
      null,
      2,
    )}\n`,
  );
  runKovo([
    'compile',
    'drizzle-optimistic',
    inputPath,
    '--out',
    input.outPath,
    '--facts-out',
    input.factsPath,
  ]);
}

function compileDrizzleStatic(input) {
  const id = drizzleStaticCounter++;
  const inputPath = resolve(tempRoot, `drizzle-static-${id}.json`);
  const outPath = resolve(tempRoot, `drizzle-static-${id}.facts.json`);
  writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  runKovo(['compile', 'drizzle-static', inputPath, '--out', outPath]);
  return readJson(outPath);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runKovo(args) {
  const command = existsSync(localCliPath) ? process.execPath : 'kovo';
  const commandArgs = existsSync(localCliPath)
    ? ['--experimental-strip-types', localCliPath, ...args]
    : args;
  execFileSync(command, commandArgs, {
    cwd: commerceRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
