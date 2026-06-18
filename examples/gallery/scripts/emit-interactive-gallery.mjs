import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const galleryRoot = resolve(scriptDir, '..');
const repoRoot = resolve(galleryRoot, '../..');
const kovoBin = resolve(galleryRoot, 'node_modules/.bin/kovo');
const checkOnly = process.argv.includes('--check');

const demos = [
  'accordion-demo',
  'alert-dialog-demo',
  'autocomplete-demo',
  'checkbox-demo',
  'checkbox-group-demo',
  'collapsible-demo',
  'combobox-demo',
  'command-demo',
  'context-menu-demo',
  'disclosure-demo',
  'dialog-demo',
  'drawer-demo',
  'dropdown-menu-demo',
  'field-demo',
  'hover-card-demo',
  'menubar-demo',
  'meter-demo',
  'navigation-menu-demo',
  'number-field-demo',
  'otp-field-demo',
  'popover-demo',
  'progress-demo',
  'pure-markup-demo',
  'radio-group-demo',
  'scroll-area-demo',
  'select-demo',
  'sheet-demo',
  'slider-demo',
  'switch-demo',
  'tabs-demo',
  'toolbar-demo',
  'toggle-demo',
  'toggle-group-demo',
  'toast-demo',
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
    /(?:data-bind|kovo-deps|kovo-c|kovo-state|data-p-[\w-]+)=/,
    `${sourceFileName} hand-writes compiler stamps`,
  );

  const compiled = compileInteractiveComponent(sourcePath, generatedFileName);
  assert.ok(compiled.lowered, `${sourceFileName} produced no lowered TSX`);

  const generated = new Map([
    [
      `${generatedBase}.tsx`,
      formatGeneratedTsx(
        `${generatedBase}.tsx`,
        `// @kovojs-ir - lowered from ${sourceFileName} by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`pnpm run emit:interactive-gallery\`.\n${compiled.lowered}`,
      ),
    ],
  ]);

  for (const [fileName, content] of compiled.clientFiles) {
    const artifactPath = resolve(repoRoot, fileName);
    generated.set(artifactPath, formatGeneratedSource(artifactPath, content));
  }

  for (const [artifactPath, content] of generated) {
    if (checkOnly) {
      assert.equal(
        readFileSync(artifactPath, 'utf8'),
        content,
        `${relative(repoRoot, artifactPath)} is stale; run \`pnpm --filter @kovojs/example-gallery run emit:interactive-gallery\``,
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

function compileInteractiveComponent(sourcePath, generatedFileName) {
  const root = mkdtempSync(resolve(tmpdir(), 'kovo-gallery-compile-'));
  const loweredPath = resolve(root, 'lowered.tsx');
  try {
    execFileSync(
      kovoBin,
      [
        'compile',
        'component',
        sourcePath,
        '--out',
        loweredPath,
        '--file-name',
        generatedFileName,
        '--emit-client-files',
        '--allow-diagnostic',
        'KV210',
        '--fixpoint',
        '--render-equivalence',
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );

    const clientFiles = new Map();
    const clientFileName = generatedFileName.replace(/\.tsx$/, '.client.js');
    const clientPath = resolve(root, clientFileName);
    if (existsSync(clientPath)) {
      clientFiles.set(clientFileName, readFileSync(clientPath, 'utf8'));
    }

    return {
      clientFiles,
      lowered: readFileSync(loweredPath, 'utf8'),
    };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}
