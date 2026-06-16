import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertFixpoint,
  assertRenderEquivalence,
  compileComponentModule,
} from '../../dist/compiler/src/index.mjs';
import { listSnippetReferences, loadTutorialSnippets } from './extract-snippets.mjs';

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
const stepsDir = path.join(tutorialDir, 'steps');
const contentDir = path.resolve(tutorialDir, '../content/tutorial');
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

  for (const file of readdirSync(componentsDir).sort()) {
    if (!file.endsWith('.tsx')) continue;
    const name = file.replace(/\.tsx$/, '');
    const fileName = `site/tutorial/steps/${step}/src/components/${file}`;
    const source = readFileSync(path.join(componentsDir, file), 'utf8');

    // SPEC.md §4.8: stamps are derived, never hand-written in authored sugar.
    assert.doesNotMatch(
      source,
      /(?:data-bind|kovo-deps|kovo-c|kovo-state|data-p-[\w-]+)=/,
      `${fileName} hand-writes stamps`,
    );

    const result = compileComponentModule({ fileName, source });
    const errors = result.diagnostics.filter((entry) => entry.severity === 'error');
    assert.deepEqual(
      errors,
      [],
      `${fileName} has compiler errors: ${JSON.stringify(errors, null, 2)}`,
    );
    // SPEC.md §5.2.3 / Constitution #3: compiling the output is a no-op.
    // Real authored-vs-lowered render equivalence is tracked separately in plans/compiler-hardening.md.
    assertFixpoint(result);
    assertRenderEquivalence(result);

    const lowered = result.loweredSource;
    assert.ok(lowered, `${fileName} produced no lowered render source`);
    const clientSource = result.files.find((entry) =>
      entry.fileName.endsWith('.client.js'),
    )?.source;
    assert.ok(clientSource, `${fileName} produced no client module`);

    const loweredFile = `// @kovojs-ir — lowered from ${fileName} by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`node site/tutorial/run-steps.mjs --write\`.\n${lowered}`;
    const targets = [
      [path.join(generatedDir, `${name}.tsx`), loweredFile],
      [path.join(generatedDir, `${name}.client.js`), clientSource],
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

  return compiled;
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
