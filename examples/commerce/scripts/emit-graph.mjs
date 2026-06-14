import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
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

const { deriveAppGraph } = await import('@jiso/compiler/graph');
const {
  deriveInvalidationRegistry,
  serializeInvalidationRegistry,
  extractSymbolicEffectsFromProject,
  extractAlgebraicShapesFromProject,
} = await import('@jiso/drizzle/static');
const { deriveOptimistic, serializeDerivedOptimistic } = await import('@jiso/drizzle/derive');
const ts = await import('typescript');
const { createCommerceGraph } = await import('../src/graph.js');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const commerceRoot = resolve(scriptDir, '..');
const sourcePath = resolve(commerceRoot, 'src/app.ts');
const graphPath = resolve(commerceRoot, 'src/generated/graph.json');
const touchGraphPath = resolve(commerceRoot, 'src/generated/touch-graph.ts');
const optimisticPath = resolve(commerceRoot, 'src/generated/optimistic/cart-add.ts');
const source = readFileSync(sourcePath, 'utf8');
const starterCart = { count: 0 };

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

// SPEC.md §10.5 / §11.1: run the real Drizzle static extractor over the
// commerce source. Stage-1 symbolic effects (write → effect IR) and Stage-2
// algebraic query shapes (loader → shape IR) are read directly from the
// loaders/handlers; nothing here is hand-authored. The deriver turns each
// (mutation effects × query shape) pair into a committed optimistic transform
// or a named §10.5 punt.
const extractionFiles = ['app.ts', 'queries.ts', 'schema.ts', 'db.ts', 'domains.ts'].map((rel) => ({
  fileName: `examples/commerce/src/${rel}`,
  source: readFileSync(resolve(commerceRoot, `src/${rel}`), 'utf8'),
}));

const allEffectFacts = extractSymbolicEffectsFromProject({ files: extractionFiles });
const algebraicShapes = extractAlgebraicShapesFromProject({ files: extractionFiles });
const shapeByQuery = new Map(algebraicShapes.map((shape) => [shape.query, shape]));

// Map each exported mutation/webhook variable to the line span of its
// definition, so extracted write sites can be attributed to the right handler.
const appSourceFile = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true);
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
  return matches[0].site;
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
  'payment.webhook': {
    touches: [
      {
        domain: 'order',
        keys: 'arg:data.object.id',
        predicate: 'eq',
        site: siteFor('paymentWebhook', 'orders'),
        via: 'orders',
      },
    ],
    reads: [],
    unresolved: [],
  },
  'order.receipt': {
    touches: [
      {
        domain: 'attachment',
        keys: 'arg:orderId',
        predicate: 'eq',
        site: siteFor('uploadReceipt', 'attachments'),
        via: 'attachments',
      },
    ],
    reads: [],
    unresolved: [],
  },
};

const commerceGraph = createCommerceGraph(starterCart, commerceTouchGraph);

const { graph } = deriveAppGraph({
  graph: commerceGraph,
});
const commerceInvalidationRegistry = deriveInvalidationRegistry({
  mutations: [
    { mutation: 'cart/add', touchGraphKey: 'cart.addItem' },
    { mutation: 'order/receipt', touchGraphKey: 'order.receipt' },
  ],
  queries: commerceGraph.queries,
  touchGraph: commerceTouchGraph,
});

const graphJson = `${formatJson(graph)}\n`;
const commerceInvalidationRegistrySource = serializeInvalidationRegistry(
  commerceInvalidationRegistry,
  {
    constName: 'commerceInvalidationSets',
    typeName: 'CommerceInvalidationSets',
  },
);
const touchGraphSource = `import type { CartQueryResult, OrderHistoryResult, ProductGridResult } from '../app.js';

export const commerceTouchGraph = ${formatJson(commerceTouchGraph)} as const;

${commerceInvalidationRegistrySource}
declare module '@jiso/core' {
  interface QueryRegistry {
    cart: CartQueryResult;
    productGrid: ProductGridResult;
    orderHistory: OrderHistoryResult;
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
const cartAddOptimisticEntries = [];
for (const query of ['cart', 'orderHistory', 'productGrid']) {
  const shape = shapeByQuery.get(query);
  assert.ok(shape, `commerce extractor must produce a ${query} query shape`);
  const result = deriveOptimistic(cartAddEffects, shape);
  assert.equal(result.kind, 'derived', `commerce ${query} must derive: ${JSON.stringify(result)}`);
  cartAddOptimisticEntries.push({ program: result.program, query });
}
const optimisticSource = serializeDerivedOptimistic({
  complete: true,
  constName: 'cartAddDerivedOptimistic',
  entries: cartAddOptimisticEntries,
  formImport: { name: 'addToCartForm', path: '../../app.js' },
  queue: 'cart',
});

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
