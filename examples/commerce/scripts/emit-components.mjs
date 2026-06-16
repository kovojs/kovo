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

// Compiles the authored TSX components (src/components/*.tsx) through
// @kovojs/compiler and commits the lowered IR modules to src/generated/ — the
// SPEC.md section 3 pipeline with the section 5.2.3 fixpoint gate and committed
// lowered-source freshness applied to every component. The app imports the
// committed IR at runtime, so served HTML carries the compiler-derived stamps
// (kovo-c, kovo-deps, data-bind — SPEC.md sections 4.2 and 4.8) instead of
// hand-written ones. `--check` verifies the committed IR is not stale.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const commerceRoot = resolve(scriptDir, '..');
const componentNames = ['cart-badge', 'order-history', 'product-grid'];

for (const name of componentNames) {
  const sourcePath = resolve(commerceRoot, `src/components/${name}.tsx`);
  const generatedPath = resolve(commerceRoot, `src/generated/${name}.tsx`);
  const fileName = `examples/commerce/src/components/${name}.tsx`;
  const source = readFileSync(sourcePath, 'utf8');

  // SPEC.md section 4.8: stamps are derived, never required in sugar.
  assert.doesNotMatch(
    source,
    /(?:data-bind|kovo-deps|kovo-c|kovo-state|data-p-[\w-]+)=/,
    `${fileName} hand-writes stamps`,
  );

  const result = compileComponentModule({ fileName, source });

  assert.deepEqual(
    result.diagnostics,
    [],
    `${fileName} has compiler diagnostics: ${JSON.stringify(result.diagnostics, null, 2)}`,
  );
  // SPEC.md section 5.2.3 / Constitution #3: compiling the output is a no-op.
  // Real authored-vs-lowered render equivalence is tracked separately in plans/compiler-hardening.md.
  assertFixpoint(result);
  assertRenderEquivalence(result);

  const lowered = result.loweredSource;
  assert.ok(lowered, `${fileName} produced no lowered render source`);

  const generated = `// @kovojs-ir — lowered from ${fileName} by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`pnpm run emit-components\`.\n${lowered}`;

  if (process.argv.includes('--check')) {
    assert.equal(
      readFileSync(generatedPath, 'utf8'),
      generated,
      `generated ${name}.tsx is stale; run \`pnpm --filter @kovojs/example-commerce run emit-components\``,
    );
  } else {
    writeFileSync(generatedPath, generated);
  }
}
