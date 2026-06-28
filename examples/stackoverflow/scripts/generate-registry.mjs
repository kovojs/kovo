#!/usr/bin/env node
// SPEC.md §6.1/§10.6/§11.1 — generate the StackOverflow example's `@kovojs/core` registry
// augmentation (QueryRegistry + InvalidationSets) into a gitignored `src/generated/` artifact that
// the example's `tsc` program includes, so KV310 / `OptimisticFor` exhaustiveness is enforced
// WITHOUT a hand-authored `declare module` that can drift from the real invalidation graph
// (capability-gaps §3). Run BEFORE `tsc -p examples/stackoverflow/tsconfig.json` (the example
// typecheck task depends on this step; `tsc` does not run the compiler/Drizzle plugins itself).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Re-exec with TypeScript type stripping (mirrors packages/cli/src/bin.ts) so this script can
// import the Drizzle analyzer / codegen `.ts` sources directly from the workspace.
if (process.env.KOVO_GEN_REGISTRY_TT !== '1') {
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { env: { ...process.env, KOVO_GEN_REGISTRY_TT: '1' }, stdio: 'inherit' },
  );
  process.exit(result.status ?? 1);
}

// Resolve the workspace's `.js` import specifiers to their `.ts` sources (mirrors the CLI bin).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const scriptDir = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(scriptDir, '..');
const sourceRoot = resolve(exampleRoot, 'src');
const outPath = resolve(sourceRoot, 'generated/registry.d.ts');

const { writeExampleCoreRegistry } = await import(
  resolve(exampleRoot, '../drizzle-registry-runtime.ts')
);

const derivationFacts = writeExampleCoreRegistry({
  outPath,
  sourceRoot,
  // Query loaders are exported by key from `src/queries.ts`; `../queries.js` is relative to the
  // generated file at `src/generated/registry.d.ts`.
  queryModule: '../queries.js',
  // Mutation key → touch-graph function name (the inline Drizzle write handlers in mutations.ts).
  mutationTouchGraphKeys: {
    'mutations/post-answer-mutation': 'postAnswer',
    'mutations/post-question-mutation': 'postQuestion',
    'mutations/vote-up-mutation': 'voteUp',
  },
  // Compact declared query → read-domain graph (SPEC.md §10.2/§11.1): the project query-fact
  // analyzer cannot prove reads through this example's `Reader<SoDb>` + `requireSoQueryDb(context)`
  // loader indirection, so the read set is declared here. The mutation→query InvalidationSets union
  // is still DERIVED from this read set folded against the analyzer-derived Drizzle touch graph.
  queries: [
    { query: 'questionList', domains: ['question'] },
    { query: 'answerList', domains: ['answer'] },
    { query: 'questionDetail', domains: ['question'] },
    { query: 'questionAnswers', domains: ['answer'] },
    { query: 'questionScore', domains: ['vote'] },
  ],
});

// SPEC.md §10.5/§10.6 — surface each (mutation × invalidated query) derivation outcome: a
// DERIVED pair gets a compiler-proven transform (no hand-written entry); a hand-written /
// await-fragment pair is NAMED with its punt reason (coverage is never silently dropped).
process.stdout.write(`kovo-generate-registry/v1\nWRITE ${outPath}\n`);
for (const fact of derivationFacts) {
  const verb = fact.status === 'derived' ? 'DERIVED' : 'PUNT';
  const reason = fact.reason ? ` (${fact.reason})` : '';
  process.stdout.write(`${verb} ${fact.mutation} -> ${fact.query}${reason}\n`);
}
