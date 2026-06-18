import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// SPEC.md §10.5 / §11.1: this script is the CRM example's EXTRACTION pipeline. It
// reads the real Drizzle source (schema/queries/mutations), runs the static
// extractor to get the touch graph + symbolic write effects + algebraic query
// shapes, then asks `kovo compile drizzle-optimistic` to run the source-agnostic
// deriver per (mutation × query) pair and emit the committed derived transform.
// For the pairs that PUNT (GROUP BY pipeline, opaque commission / column
// arithmetic), the CLI suppresses the derived entry via `overrides` so the
// mutation module's hand-written transform merges in. It also emits the
// touch-graph module + graph.json (with the optimistic[] status mix) and supports
// `--check` to fail on stale artifacts.

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  deriveInvalidationRegistry,
  serializeInvalidationRegistry,
  extractTouchGraphFromProject,
  extractQueryFactsFromProject,
  extractSymbolicEffectsFromProject,
  extractAlgebraicShapesFromProject,
} = await import('@kovojs/drizzle/static');
const { puntReasonLabel } = await import('@kovojs/core/internal/derivation');
const { createCrmGraph } = await import('../src/graph.js');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const crmRoot = resolve(scriptDir, '..');
const tempRoot = mkdtempSync(resolve(tmpdir(), 'kovo-crm-graph-'));
process.on('exit', () => rmSync(tempRoot, { force: true, recursive: true }));

// The generated dir is fmt-ignored in the root vite.config (like commerce's), so
// the IR serializers' raw valid-TypeScript output is committed verbatim. Skipping
// an external formatter keeps `emit-graph --check` deterministic across machines.
function formatSource(source) {
  return source;
}

function queryDomainsFromFacts(facts) {
  return [...facts]
    .sort((left, right) => siteLineNumber(left.site) - siteLineNumber(right.site))
    .map((fact) => ({ domains: [...fact.reads], query: fact.query }));
}

function siteLineNumber(site) {
  return Number(String(site).split(':').pop() ?? 0);
}

const SOURCE_FILES = [
  'src/schema.ts',
  'src/db.ts',
  'src/model.ts',
  'src/queries.ts',
  'src/mutations.ts',
];

const files = SOURCE_FILES.map((relative) => ({
  fileName: `examples/crm/${relative}`,
  source: readFileSync(resolve(crmRoot, relative), 'utf8'),
}));

// ── Mutation handler ↔ public mutation key + per-pair override decisions ───────
// SPEC.md §10.4: the extractor keys write effects by the handler function name;
// we map those to the public mutation keys (and forms) here. `overrides` lists
// the queries whose transform is HAND-WRITTEN in mutations.ts (a PUNT, or a
// derived-but-unlowerable opaque program) so the CLI suppresses the derived entry
// and the app merges the hand-written one.
const MUTATIONS = [
  {
    key: 'addContact',
    handler: 'addContactHandler',
    form: 'addContactForm',
    queue: 'crm',
    overrides: [],
  },
  {
    key: 'createDeal',
    handler: 'createDealHandler',
    form: 'createDealForm',
    queue: 'crm',
    // contactList: derived program carries the opaque `sql\`${col} + 1\`` SET ⇒
    // not lowerable ⇒ hand-written. pipelineByStage: GROUP BY PUNT.
    overrides: ['contactList', 'pipelineByStage'],
  },
  {
    key: 'moveDeal',
    handler: 'moveDealHandler',
    form: 'moveDealForm',
    queue: 'crm',
    // openDeals: membership-entry PUNT. pipelineByStage: GROUP BY PUNT.
    overrides: ['openDeals', 'pipelineByStage'],
  },
  {
    key: 'closeDeal',
    handler: 'closeDealHandler',
    form: 'closeDealForm',
    queue: 'crm',
    // dealList + openDeals: derived program carries the opaque commission SET ⇒
    // not lowerable ⇒ hand-written. pipelineByStage: GROUP BY PUNT.
    overrides: ['dealList', 'openDeals', 'pipelineByStage'],
  },
];

const FORM_IMPORT_PATH = '../../model.js';

const TABLE_DOMAIN = { contacts: 'contact', deals: 'deal', activities: 'activity' };

// The pairs deliberately served by `'await-fragment'` (wait for server truth)
// rather than a hand-written predictor: server-computed commission + GROUP BY
// rollups that the scalar client value cannot reconstruct. Every other override
// is a hand-written transform.
const AWAIT_FRAGMENT_PAIRS = new Set([
  'moveDeal\0openDeals',
  'moveDeal\0pipelineByStage',
  'closeDeal\0dealList',
  'closeDeal\0pipelineByStage',
]);

// ── Stage 1+2 extraction ──────────────────────────────────────────────────────
const rawTouchGraph = extractTouchGraphFromProject({ files });
const queryFacts = extractQueryFactsFromProject({ files });
const effectFacts = extractSymbolicEffectsFromProject({ files });
const shapes = extractAlgebraicShapesFromProject({ files });
const shapeByQuery = new Map(shapes.map((shape) => [shape.query, shape]));

const effectsByHandler = new Map();
for (const fact of effectFacts) {
  if (!fact.writeKey) continue;
  const list = effectsByHandler.get(fact.writeKey) ?? [];
  list.push(fact.effect);
  effectsByHandler.set(fact.writeKey, list);
}

// Keep only the mutation-handler touch entries, re-keyed by mutation key (the
// domain() leaf-module factory calls surface as `<spread>` KV406 noise — they are
// not mutation write sites, so they are dropped from the published touch graph).
const crmTouchGraph = {};
for (const mutation of MUTATIONS) {
  const entry = rawTouchGraph[mutation.handler];
  assert.ok(entry, `expected an extracted touch entry for ${mutation.handler}`);
  crmTouchGraph[mutation.key] = entry;
}
const touchedDomains = new Set(
  Object.values(crmTouchGraph).flatMap((entry) => entry.touches.map((touch) => touch.domain)),
);
const crmQueryDomains = queryDomainsFromFacts(queryFacts).filter((entry) =>
  entry.domains.some((domain) => touchedDomains.has(domain)),
);

// ── Stage 3 derivation + optimistic[] coverage matrix ─────────────────────────
const optimisticEntries = [];
const generatedModules = [];

for (const mutation of MUTATIONS) {
  const effects = effectsByHandler.get(mutation.handler) ?? [];
  const writtenDomains = new Set(effects.map((effect) => TABLE_DOMAIN[effect.table]));
  const overrides = new Set(mutation.overrides);
  const optimisticInputEntries = [];

  for (const { domains, query } of crmQueryDomains) {
    const invalidated = domains.some((domain) => writtenDomains.has(domain));
    if (!invalidated) continue;

    const shape = shapeByQuery.get(query);
    assert.ok(shape, `expected an extracted shape for ${query}`);
    optimisticInputEntries.push({
      query,
      shape,
      status: overrides.has(query)
        ? AWAIT_FRAGMENT_PAIRS.has(`${mutation.key}\0${query}`)
          ? 'await-fragment'
          : 'hand-written'
        : 'derived',
    });
  }

  const optimisticSourcePath = resolve(tempRoot, `${mutation.key}.optimistic.ts`);
  const optimisticFactsPath = resolve(tempRoot, `${mutation.key}.optimistic.json`);
  compileDrizzleOptimistic({
    complete: overrides.size === 0,
    constName: `${mutation.key}DerivedOptimistic`,
    effects,
    entries: optimisticInputEntries,
    factsPath: optimisticFactsPath,
    formImport: { name: mutation.form, path: FORM_IMPORT_PATH },
    outPath: optimisticSourcePath,
    queue: mutation.queue,
    ...(overrides.size > 0 ? { overrides: [...overrides] } : {}),
  });
  const facts = readJson(optimisticFactsPath);
  optimisticEntries.push(
    ...facts.map((entry) => ({
      mutation: mutation.key,
      query: entry.query,
      status: entry.status,
      ...(entry.derivation ? { derivation: entry.derivation } : {}),
    })),
  );
  const baseSource = readFileSync(optimisticSourcePath, 'utf8');
  // SPEC.md §10.4: a complete (fully-derived) plan `satisfies OptimisticFor` and
  // is already typed. A partial plan (override path) is emitted satisfies-free by
  // the serializer; we add the example-local `CrmDerivedSubset` contextual type
  // over exactly the DERIVED query names so the generated source stays strict (no
  // implicit any) without demanding the overridden keys the mutation module owns.
  const moduleSource =
    overrides.size === 0
      ? baseSource
      : typeDerivedSubset(
          baseSource,
          mutation.form,
          facts.filter((entry) => entry.status === 'derived').map((entry) => entry.query),
        );
  generatedModules.push({
    key: mutation.key,
    source: formatSource(moduleSource, `optimistic/${kebab(mutation.key)}.ts`),
  });
}

optimisticEntries.sort(
  (left, right) =>
    left.mutation.localeCompare(right.mutation) || left.query.localeCompare(right.query),
);

// ── Touch graph module + invalidation registry ────────────────────────────────
const crmInvalidationRegistry = deriveInvalidationRegistry({
  mutations: MUTATIONS.map((mutation) => ({
    mutation: mutation.key,
    touchGraphKey: mutation.key,
  })),
  queries: crmQueryDomains,
  touchGraph: crmTouchGraph,
});

const crmGraph = createCrmGraph(crmTouchGraph, optimisticEntries, crmQueryDomains);
const graph = deriveGraphViaCli({ graph: crmGraph });

const crmInvalidationSource = serializeInvalidationRegistry(crmInvalidationRegistry, {
  constName: 'crmInvalidationSets',
  typeName: 'CrmInvalidationSets',
});

const touchGraphSource = formatSource(
  `import type {
  ContactDealCountResult,
  ContactListResult,
  DealListResult,
  OpenDealsResult,
  PipelineByStageResult,
} from '../queries.js';

export const crmTouchGraph = ${formatJson(crmTouchGraph)} as const;

export const crmQueryDomains = ${formatJson(crmQueryDomains)} as const;

${crmInvalidationSource}
declare module '@kovojs/core' {
  interface QueryRegistry {
    contactList: ContactListResult;
    dealList: DealListResult;
    contactDealCount: ContactDealCountResult;
    openDeals: OpenDealsResult;
    pipelineByStage: PipelineByStageResult;
  }

  interface MutationRegistry {
    addContact: typeof import('../mutations.js').addContact;
    createDeal: typeof import('../mutations.js').createDeal;
    moveDeal: typeof import('../mutations.js').moveDeal;
    closeDeal: typeof import('../mutations.js').closeDeal;
  }

  interface InvalidationSets extends CrmInvalidationSets {}
}
`,
  'touch-graph.ts',
);

const graphJson = formatSource(`${formatJson(graph)}\n`, 'graph.json');

// ── Write or --check ──────────────────────────────────────────────────────────
const graphPath = resolve(crmRoot, 'src/generated/graph.json');
const touchGraphPath = resolve(crmRoot, 'src/generated/touch-graph.ts');
const optimisticDir = resolve(crmRoot, 'src/generated/optimistic');
const modulePath = (key) => resolve(optimisticDir, `${kebab(key)}.ts`);

if (process.argv.includes('--check')) {
  assertFile(graphPath, graphJson, 'generated graph.json');
  assertFile(touchGraphPath, touchGraphSource, 'generated touch-graph.ts');
  for (const module of generatedModules) {
    assertFile(
      modulePath(module.key),
      module.source,
      `generated optimistic/${kebab(module.key)}.ts`,
    );
  }
  // Surface the named punts for the operator (parity with `kovo explain --optimistic`).
  for (const entry of optimisticEntries) {
    if (entry.derivation?.status === 'PUNTED') {
      // eslint-disable-next-line no-console
      console.log(
        `PUNTED ${entry.mutation} -> ${entry.query} (${puntReasonLabel(entry.derivation.reason)}) [${entry.status}]`,
      );
    }
  }
  // eslint-disable-next-line no-console
  console.log('emit-graph --check: CRM generated artifacts are up to date.');
} else {
  mkdirSync(optimisticDir, { recursive: true });
  writeFileSync(graphPath, graphJson);
  writeFileSync(touchGraphPath, touchGraphSource);
  for (const module of generatedModules) {
    writeFileSync(modulePath(module.key), module.source);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

// Add the `CrmDerivedSubset` import + a `satisfies` clause to a satisfies-free
// (override-path) generated module, typing the derived transforms against exactly
// the derived query names. Pure string surgery on the serializer output keeps the
// serializer contract untouched (no changes outside examples/crm/**).
function typeDerivedSubset(source, formName, derivedQueries) {
  const keysUnion =
    derivedQueries.length === 0
      ? 'never'
      : [...derivedQueries]
          .sort((left, right) => left.localeCompare(right))
          .map((query) => JSON.stringify(query))
          .join(' | ');
  const withImport = source.replace(
    "import type { OptimisticFor } from '@kovojs/runtime';\n",
    "import type { CrmDerivedSubset } from '../../optimistic-merge.js';\n",
  );
  assert.notEqual(withImport, source, 'expected the OptimisticFor import to rewrite');
  // The serializer ends a partial plan with `}` followed by a trailing `;`.
  const closing = '\n};\n';
  assert.ok(withImport.endsWith(closing), 'expected a satisfies-free plan close');
  return `${withImport.slice(0, -closing.length)}\n} satisfies CrmDerivedSubset<typeof ${formName}, ${keysUnion}>;\n`;
}

function assertFile(path, expected, label) {
  assert.ok(existsSync(path), `${label} is missing — run emit-graph without --check`);
  assert.equal(readFileSync(path, 'utf8'), expected, `${label} is stale — run emit-graph`);
}

function deriveGraphViaCli(input) {
  const inputPath = resolve(tempRoot, 'graph-input.json');
  const outPath = resolve(tempRoot, 'graph-output.json');
  writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  execFileSync('kovo', ['compile', 'graph', inputPath, '--out', outPath], {
    cwd: crmRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(readFileSync(outPath, 'utf8'));
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
        overrides: input.overrides,
        queue: input.queue,
      },
      null,
      2,
    )}\n`,
  );
  execFileSync(
    'kovo',
    [
      'compile',
      'drizzle-optimistic',
      inputPath,
      '--out',
      input.outPath,
      '--facts-out',
      input.factsPath,
    ],
    {
      cwd: crmRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function kebab(value) {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function formatJson(value, indent = 0) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    }
    const childIndent = ' '.repeat(indent + 2);
    return `[\n${value
      .map((item) => `${childIndent}${formatJson(item, indent + 2)}`)
      .join(',\n')}\n${' '.repeat(indent)}]`;
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
}
