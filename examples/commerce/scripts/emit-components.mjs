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
  await import('@jiso/compiler');

// Compiles the authored TSX components (src/components/*.tsx) through
// @jiso/compiler and commits the lowered IR modules to src/generated/ — the
// SPEC.md section 3 pipeline with the section 5.2.3 fixpoint and
// render-equivalence gates applied to every component. The app imports the
// committed IR at runtime, so served HTML carries the compiler-derived stamps
// (fw-c, fw-deps, data-bind — SPEC.md sections 4.2 and 4.8) instead of
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
    /(?:data-bind|fw-deps|fw-c|fw-state|data-p-[\w-]+)=/,
    `${fileName} hand-writes stamps`,
  );

  const result = compileComponentModule({ fileName, source });

  assert.deepEqual(
    result.diagnostics,
    [],
    `${fileName} has compiler diagnostics: ${JSON.stringify(result.diagnostics, null, 2)}`,
  );
  // SPEC.md section 5.2.3 / Constitution #3: compiling the output is a no-op.
  assertFixpoint(result);
  assertRenderEquivalence(result);

  const lowered = result.renderEquivalenceChecks[0]?.expected;
  assert.ok(lowered, `${fileName} produced no lowered render source`);

  const generated = `// @jiso-ir — lowered from ${fileName} by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`pnpm run emit-components\`.\n${lowered}`;

  if (process.argv.includes('--check')) {
    assert.equal(
      readFileSync(generatedPath, 'utf8'),
      generated,
      `generated ${name}.tsx is stale; run \`pnpm --filter @jiso/example-commerce run emit-components\``,
    );
  } else {
    writeFileSync(generatedPath, generated);
  }
}
