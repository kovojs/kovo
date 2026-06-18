import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listSnippetReferences, loadTutorialSnippets } from './extract-snippets.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

/**
 * Tutorial step gate (plan W5): every checked-in step state must
 *  1. typecheck against the workspace @kovojs/* packages (tsgo per step),
 *  2. compile its TSX components with zero error diagnostics through the
 *     SPEC.md §5.2.3 fixpoint gate, with committed lowered IR proven fresh
 *     (the emit-components.mjs doctrine from examples/commerce),
 *  3. pass its vitest tests.
 * Chapter snippet references are validated here too, so a renamed marker
 * fails this gate even before the site build runs. `--write` regenerates
 * the committed lowered IR.
 */

const tutorialDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(tutorialDir, '../..');
const siteRoot = path.resolve(tutorialDir, '..');
const stepsDir = path.join(tutorialDir, 'steps');
const contentDir = path.resolve(tutorialDir, '../content/tutorial');
const kovoBin = path.join(siteRoot, 'node_modules/.bin/kovo');
const write = process.argv.includes('--write');

const steps = readdirSync(stepsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function run(command, args) {
  execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
}

function compileStepComponents(step) {
  const componentsDir = path.join(stepsDir, step, 'src/components');
  if (!existsSync(componentsDir)) return 0;

  const generatedDir = path.join(stepsDir, step, 'src/generated');
  let compiled = 0;
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-tutorial-compile-'));

  try {
    const registryFactsPath = writeRegistryFactsForStep(step, root);

    for (const file of readdirSync(componentsDir).sort()) {
      if (!file.endsWith('.tsx')) continue;
      const name = file.replace(/\.tsx$/, '');
      const fileName = `site/tutorial/steps/${step}/src/components/${file}`;
      const sourcePath = path.join(componentsDir, file);
      const source = readFileSync(sourcePath, 'utf8');

      // SPEC.md §4.8: stamps are derived, never hand-written in authored sugar.
      assert.doesNotMatch(
        source,
        /(?:data-bind|kovo-deps|kovo-c|kovo-state|data-p-[\w-]+)=/,
        `${fileName} hand-writes stamps`,
      );

      const compiledComponent = compileTutorialComponent({
        fileName,
        registryFactsPath,
        root,
        sourcePath,
      });
      assert.ok(compiledComponent.lowered, `${fileName} produced no lowered render source`);
      assert.ok(compiledComponent.clientSource, `${fileName} produced no client module`);

      const loweredFile = `// @kovojs-ir — lowered from ${fileName} by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`node site/tutorial/run-steps.mjs --write\`.\n${compiledComponent.lowered}`;
      const targets = [
        [path.join(generatedDir, `${name}.tsx`), loweredFile],
        [path.join(generatedDir, `${name}.client.js`), compiledComponent.clientSource],
      ];

      for (const [target, content] of targets) {
        if (write) {
          mkdirSync(generatedDir, { recursive: true });
          writeFileSync(target, content);
        } else {
          assert.ok(existsSync(target), `${target} missing; run run-steps.mjs --write`);
          assert.equal(
            readFileSync(target, 'utf8'),
            content,
            `${path.relative(repoRoot, target)} is stale; run \`node site/tutorial/run-steps.mjs --write\``,
          );
        }
      }
      compiled += 1;
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }

  return compiled;
}

function writeRegistryFactsForStep(step, root) {
  const appPath = path.join(stepsDir, step, 'src/app.ts');
  const mutationInputs = existsSync(appPath)
    ? compileMutationInputs(`site/tutorial/steps/${step}/src/app.ts`, appPath, root)
    : {};
  const registryFacts = {
    ...(Object.keys(mutationInputs).length > 0 ? { mutationInputs } : {}),
    mutations: { 'cart/add': 'typeof addToCart' },
  };
  const registryFactsPath = path.join(root, 'registry-facts.json');
  writeFileSync(registryFactsPath, `${JSON.stringify(registryFacts, null, 2)}\n`);
  return registryFactsPath;
}

function compileMutationInputs(fileName, appPath, root) {
  const outPath = path.join(root, 'mutation-inputs.json');
  execFileSync(
    kovoBin,
    ['compile', 'mutation-inputs', appPath, '--out', outPath, '--file-name', fileName],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return JSON.parse(readFileSync(outPath, 'utf8'));
}

function compileTutorialComponent({ fileName, registryFactsPath, root, sourcePath }) {
  const loweredPath = path.join(root, 'lowered.tsx');
  const clientFileName = fileName.replace(/\.tsx$/, '.client.js');
  const clientPath = path.join(root, clientFileName);
  execFileSync(
    kovoBin,
    [
      'compile',
      'component',
      sourcePath,
      '--out',
      loweredPath,
      '--file-name',
      fileName,
      '--registry-facts',
      registryFactsPath,
      '--emit-client-files',
      '--allow-diagnostic',
      'KV210',
      '--fixpoint',
      '--render-equivalence',
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return {
    clientSource: existsSync(clientPath) ? readFileSync(clientPath, 'utf8') : '',
    lowered: readFileSync(loweredPath, 'utf8'),
  };
}

let components = 0;
for (const step of steps) {
  // 1. Compile TSX components; verify (or, with --write, refresh) the
  //    committed lowered IR the step imports at runtime.
  components += compileStepComponents(step);
  // 2. Typecheck the step against the real workspace packages.
  run(path.join(repoRoot, 'node_modules/.bin/tsgo'), [
    '-p',
    path.join(stepsDir, step, 'tsconfig.json'),
  ]);
}

// 3. Chapter snippet references must resolve against step-state markers.
const snippets = loadTutorialSnippets(stepsDir);
let references = 0;
if (existsSync(contentDir)) {
  for (const file of readdirSync(contentDir).sort()) {
    if (!file.endsWith('.md')) continue;
    for (const reference of listSnippetReferences(
      readFileSync(path.join(contentDir, file), 'utf8'),
    )) {
      assert.ok(
        snippets.has(reference),
        `content/tutorial/${file} references unknown snippet "${reference}"`,
      );
      references += 1;
    }
  }
}

// 4. Run every step's vitest suite.
run(path.join(repoRoot, 'node_modules/.bin/vitest'), ['--run', 'site/tutorial/steps']);

process.stdout.write(
  `tutorial-steps/v1\nsteps=${steps.length} components=${components} snippets=${snippets.size} references=${references}\ntutorial-steps/v1 steps=${steps.length} OK\n`,
);
