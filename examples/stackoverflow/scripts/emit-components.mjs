import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { assertFixpoint, assertRenderEquivalence, compileComponentModule } =
  await import('@kovojs/compiler');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const soRoot = resolve(scriptDir, '..');
const componentNames = ['question-detail', 'question-list'];
const registryFacts = {
  mutations: {
    postAnswer: 'typeof postAnswerMutation',
    postQuestion: 'typeof postQuestionMutation',
  },
};

for (const name of componentNames) {
  const sourcePath = resolve(soRoot, `src/components/${name}.tsx`);
  const generatedPath = resolve(soRoot, `src/generated/${name}.tsx`);
  const fileName = `examples/stackoverflow/src/components/${name}.tsx`;
  const source = readFileSync(sourcePath, 'utf8');

  // SPEC.md §4.8: query-backed component roots derive their refresh stamps.
  assert.doesNotMatch(
    source,
    /(?:data-bind|kovo-deps|kovo-c|kovo-fragment-target|kovo-state|data-p-[\w-]+)=/,
    `${fileName} hand-writes stamps`,
  );

  const result = compileComponentModule({ fileName, registryFacts, source });
  assert.deepEqual(
    result.diagnostics,
    [],
    `${fileName} has compiler diagnostics: ${JSON.stringify(result.diagnostics, null, 2)}`,
  );
  assertFixpoint(result);
  assertRenderEquivalence(result);

  const lowered = result.loweredSource;
  assert.ok(lowered, `${fileName} produced no lowered render source`);

  const generated = `// @kovojs-ir — lowered from ${fileName} by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`pnpm run emit-components\`.\n${lowered}`;

  if (process.argv.includes('--check')) {
    assert.equal(
      readFileSync(generatedPath, 'utf8'),
      generated,
      `generated ${name}.tsx is stale; run \`pnpm --filter @kovojs/example-stackoverflow run emit-components\``,
    );
  } else {
    writeFileSync(generatedPath, generated);
  }
}
