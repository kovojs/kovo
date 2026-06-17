import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// SPEC.md §10.5 / §11.2: emit the committed graph + derived-optimism artifacts for
// the Stack Overflow clone. Unlike commerce (which hand-authors its facts), THIS
// script EXTRACTS everything from src: the touch graph, the symbolic write
// effects, and the algebraic query shapes — then derives one optimistic transform
// program per (mutation × invalidated-query) pair. `--check` asserts the committed
// artifacts are not stale.

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
  extractAlgebraicShapesFromProject,
  extractSymbolicEffectsFromProject,
  extractTouchGraphFromProject,
  serializeInvalidationRegistry,
  serializeTouchGraph,
} = await import('@kovojs/drizzle/static');
const { deriveOptimistic, serializeDerivedOptimistic } = await import('@kovojs/drizzle/derive');
const { createSoGraph } = await import('../src/graph.js');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const soRoot = resolve(scriptDir, '..');
const srcDir = resolve(soRoot, 'src');
const graphPath = resolve(soRoot, 'src/generated/graph.json');
const touchGraphPath = resolve(soRoot, 'src/generated/touch-graph.ts');
const optimisticDir = resolve(soRoot, 'src/generated/optimistic');

// The source files the §10.5 extractors analyze. domains.ts/runtime.ts/db.ts are
// included so ts-morph can prove the cross-module types (SoDb, the domain
// registry), but they carry no Drizzle writes.
const sourceFileNames = [
  'schema.ts',
  'db.ts',
  'domains.ts',
  'runtime.ts',
  'queries.ts',
  'mutations.ts',
];
const sourceByName = new Map(
  sourceFileNames.map((name) => [name, readFileSync(resolve(srcDir, name), 'utf8')]),
);

// ts-morph's default Project reads the REAL file system, so passing the canonical
// `examples/stackoverflow/src/*.ts` paths collides with the on-disk files (and
// across extractor calls in one process). Give each extraction call a UNIQUE
// virtual directory, then normalize the emitted `site` strings back to the
// canonical source path so the committed artifacts cite real files.
const CANONICAL_DIR = 'examples/stackoverflow/src';
let projectCounter = 0;
function projectFiles() {
  const dir = `examples/stackoverflow/.emit-${projectCounter++}/src`;
  return {
    dir,
    files: sourceFileNames.map((name) => ({
      fileName: `${dir}/${name}`,
      source: sourceByName.get(name),
    })),
  };
}
function canonicalizeSite(site, dir) {
  return typeof site === 'string' ? site.replace(`${dir}/`, `${CANONICAL_DIR}/`) : site;
}

// The generated dir is fmt-ignored in the root vite.config (like commerce's), so
// the IR serializers' raw valid-TypeScript output is committed verbatim. Skipping
// an external formatter keeps `emit-graph --check` deterministic across machines.
function formatTs(source) {
  return source;
}

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

// ── Extract the touch graph, effects, and shapes from the project ──────────────
const touchProject = projectFiles();
const extractedTouchGraph = extractTouchGraphFromProject({ files: touchProject.files });
const effectFacts = extractSymbolicEffectsFromProject({ files: projectFiles().files });
const shapes = extractAlgebraicShapesFromProject({ files: projectFiles().files });

// The `domain('x')` factory calls in domains.ts surface as spurious
// `<domain>.<spread>` KV406 entries; keep only the real mutation handlers (the
// entries with extracted writes). These are keyed by handler function name.
const MUTATION_KEYS = ['postQuestion', 'postAnswer', 'voteUp'];
const soTouchGraph = Object.fromEntries(
  MUTATION_KEYS.map((key) => {
    const entry = extractedTouchGraph[key];
    assert.ok(entry, `expected an extracted touch-graph entry for ${key}`);
    assert.equal(entry.unresolved.length, 0, `${key} extracted clean touches (no KV406)`);
    assert.ok(entry.touches.length > 0, `${key} has extracted touches`);
    // Normalize the virtual extraction paths back to the canonical source path.
    const normalized = {
      ...entry,
      touches: entry.touches.map((touch) => ({
        ...touch,
        site: canonicalizeSite(touch.site, touchProject.dir),
      })),
    };
    return [key, normalized];
  }),
);

const effectsByMutation = new Map();
for (const fact of effectFacts) {
  if (!fact.writeKey) continue;
  const list = effectsByMutation.get(fact.writeKey) ?? [];
  list.push(fact.effect);
  effectsByMutation.set(fact.writeKey, list);
}
const shapeByQuery = new Map(shapes.map((shape) => [shape.query, shape]));

// ── Invalidation: which queries each mutation invalidates (domain overlap) ─────
const queryDomains = [
  { domains: ['question'], query: 'questionList' },
  { domains: ['answer'], query: 'answerList' },
  { domains: ['question'], query: 'questionDetail' },
  { domains: ['answer'], query: 'questionAnswers' },
  { domains: ['vote'], query: 'questionScore' },
];
const invalidatedQueriesByMutation = {
  postQuestion: ['questionList'],
  postAnswer: ['questionList', 'answerList'],
  voteUp: ['questionList', 'questionScore'],
};

// ── Derive one PatchProgram per (mutation × invalidated query) pair ────────────
const optimisticByMutation = new Map();
for (const mutationKey of MUTATION_KEYS) {
  const effects = effectsByMutation.get(mutationKey);
  assert.ok(effects, `expected extracted effects for ${mutationKey}`);
  const entries = [];
  for (const query of invalidatedQueriesByMutation[mutationKey]) {
    const shape = shapeByQuery.get(query);
    assert.ok(shape, `expected an extracted shape for ${query}`);
    const result = deriveOptimistic(effects, shape);
    assert.equal(
      result.kind,
      'derived',
      `${mutationKey} × ${query} must derive: ${JSON.stringify(result)}`,
    );
    entries.push({ program: result.program, query });
  }
  optimisticByMutation.set(mutationKey, entries);
}

// ── Build the KovoExplainInput graph.json (touchGraph EXTRACTED) ─────────────────
const graph = createSoGraph(soTouchGraph);
const graphJson = `${formatJson(graph)}\n`;

// ── Serialize the touch graph + invalidation registry artifact ─────────────────
const invalidationRegistry = deriveInvalidationRegistry({
  mutations: MUTATION_KEYS.map((key) => ({ mutation: key, touchGraphKey: key })),
  queries: queryDomains,
  touchGraph: soTouchGraph,
});
const invalidationRegistrySource = serializeInvalidationRegistry(invalidationRegistry, {
  constName: 'soInvalidationSets',
  typeName: 'SoInvalidationSets',
});
const serializedTouchGraph = serializeTouchGraph(soTouchGraph).replace(
  'export const touchGraph =',
  'export const soTouchGraph =',
);

const touchGraphSource = formatTs(
  `// DO NOT EDIT — generated by scripts/emit-graph.mjs (SPEC.md §10.5).
import type { AnswerListResult, QuestionAnswersResult, QuestionDetailResult, QuestionListResult, QuestionScoreResult } from '../types.js';

${serializedTouchGraph}
${invalidationRegistrySource}
declare module '@kovojs/core' {
  interface QueryRegistry {
    questionList: QuestionListResult;
    answerList: AnswerListResult;
    questionDetail: QuestionDetailResult | null;
    questionAnswers: QuestionAnswersResult;
    questionScore: QuestionScoreResult;
  }

  interface InvalidationSets extends SoInvalidationSets {}
}
`,
  touchGraphPath,
);

// ── Serialize one generated/optimistic/<mutation>.ts per mutation ──────────────
const FORM_BY_MUTATION = {
  postQuestion: { name: 'postQuestionForm', path: '../../types.js' },
  postAnswer: { name: 'postAnswerForm', path: '../../types.js' },
  voteUp: { name: 'voteUpForm', path: '../../types.js' },
};
const CONST_BY_MUTATION = {
  postQuestion: 'postQuestionDerivedOptimistic',
  postAnswer: 'postAnswerDerivedOptimistic',
  voteUp: 'voteUpDerivedOptimistic',
};
const QUEUE_BY_MUTATION = {
  postQuestion: 'question',
  postAnswer: 'answer',
  voteUp: 'vote',
};
const optimisticFileName = (mutationKey) =>
  resolve(optimisticDir, `${mutationKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}.ts`);

const optimisticSources = new Map();
for (const mutationKey of MUTATION_KEYS) {
  const path = optimisticFileName(mutationKey);
  const source = serializeDerivedOptimistic({
    complete: true,
    constName: CONST_BY_MUTATION[mutationKey],
    entries: optimisticByMutation.get(mutationKey),
    formImport: FORM_BY_MUTATION[mutationKey],
    queue: QUEUE_BY_MUTATION[mutationKey],
  });
  optimisticSources.set(path, formatTs(source, path));
}

// ── Write or --check ───────────────────────────────────────────────────────────
if (process.argv.includes('--check')) {
  assert.equal(readFileSync(graphPath, 'utf8'), graphJson, 'generated graph.json is stale');
  assert.equal(
    readFileSync(touchGraphPath, 'utf8'),
    touchGraphSource,
    'generated touch-graph.ts is stale',
  );
  for (const [path, source] of optimisticSources) {
    assert.equal(readFileSync(path, 'utf8'), source, `generated ${path} is stale`);
  }
  console.log('emit-graph --check: artifacts are up to date');
} else {
  mkdirSync(resolve(soRoot, 'src/generated'), { recursive: true });
  mkdirSync(optimisticDir, { recursive: true });
  writeFileSync(graphPath, graphJson);
  writeFileSync(touchGraphPath, touchGraphSource);
  for (const [path, source] of optimisticSources) {
    writeFileSync(path, source);
  }
  console.log('emit-graph: wrote graph.json, touch-graph.ts, and optimistic/*.ts');
}
