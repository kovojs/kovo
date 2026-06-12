import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const galleryRoot = resolve(scriptDir, '..');
const repoRoot = resolve(galleryRoot, '../..');
const checkOnly = process.argv.includes('--check');

const demos = [
  'checkbox-demo',
  'collapsible-demo',
  'disclosure-demo',
  'dialog-demo',
  'number-field-demo',
  'popover-demo',
  'switch-demo',
  'tabs-demo',
  'toggle-demo',
  'tooltip-demo',
];

for (const name of demos) {
  const sourcePath = resolve(galleryRoot, `src/interactive/${name}.tsx`);
  const sourceFileName = relative(repoRoot, sourcePath);
  const generatedBase = resolve(galleryRoot, `src/generated/interactive/${name}`);
  const generatedFileName = relative(repoRoot, `${generatedBase}.tsx`);
  const source = readFileSync(sourcePath, 'utf8');

  assert.doesNotMatch(
    source,
    /(?:data-bind|fw-deps|fw-c|fw-state|data-p-[\w-]+)=/,
    `${sourceFileName} hand-writes compiler stamps`,
  );

  const result = compileComponentModule({
    fileName: generatedFileName,
    source,
  });
  const blockingDiagnostics = result.diagnostics.filter(
    (diagnostic) => diagnostic.code !== 'FW210',
  );
  assert.deepEqual(
    blockingDiagnostics,
    [],
    `${sourceFileName} has blocking compiler diagnostics: ${JSON.stringify(blockingDiagnostics, null, 2)}`,
  );
  assert.ok(
    result.diagnostics.every((diagnostic) => diagnostic.code === 'FW210'),
    `${sourceFileName} emitted unexpected lint diagnostics: ${JSON.stringify(result.diagnostics, null, 2)}`,
  );
  assertFixpoint(result);
  assertRenderEquivalence(result);

  const lowered = result.renderEquivalenceChecks[0]?.expected;
  assert.ok(lowered, `${sourceFileName} produced no lowered TSX`);

  const generated = new Map([
    [
      `${generatedBase}.tsx`,
      formatGeneratedTsx(
        `${generatedBase}.tsx`,
        `// @jiso-ir - lowered from ${sourceFileName} by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`pnpm run emit:interactive-gallery\`.\n${lowered}`,
      ),
    ],
  ]);

  for (const file of result.files) {
    if (file.kind !== 'client') continue;
    const artifactPath = resolve(repoRoot, file.fileName);
    generated.set(artifactPath, formatGeneratedSource(artifactPath, file.source));
  }

  for (const [artifactPath, content] of generated) {
    if (checkOnly) {
      assert.equal(
        readFileSync(artifactPath, 'utf8'),
        content,
        `${relative(repoRoot, artifactPath)} is stale; run \`pnpm --filter @jiso/example-gallery run emit:interactive-gallery\``,
      );
    } else {
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, content);
    }
  }
}

function formatGeneratedTsx(fileName, source) {
  return formatGeneratedSource(fileName, source);
}

function formatGeneratedSource(fileName, source) {
  return execFileSync('pnpm', ['exec', 'vp', 'fmt', '--stdin-filepath', fileName], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: source,
  });
}
