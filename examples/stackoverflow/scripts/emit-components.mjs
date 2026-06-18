import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const soRoot = resolve(scriptDir, '..');
const componentNames = ['question-detail', 'question-list'];
const check = process.argv.includes('--check');
const tempRoot = mkdtempSync(join(tmpdir(), 'kovo-so-components-'));
const registryFactsPath = join(tempRoot, 'registry-facts.json');

const registryFacts = {
  mutationInputs: {
    postAnswer: [
      requiredString('id'),
      requiredString('questionId'),
      requiredString('body'),
      requiredString('authorId'),
    ],
    postQuestion: [
      requiredString('id'),
      requiredString('title'),
      requiredString('body'),
      requiredString('authorId'),
    ],
    voteUp: [requiredString('id'), requiredString('targetId'), requiredString('userId')],
  },
  mutations: {
    postAnswer: 'typeof postAnswerMutation',
    postQuestion: 'typeof postQuestionMutation',
  },
};

try {
  writeFileSync(registryFactsPath, `${JSON.stringify(registryFacts, null, 2)}\n`);
  for (const name of componentNames) {
    const sourcePath = resolve(soRoot, `src/components/${name}.tsx`);
    const generatedPath = resolve(soRoot, `src/generated/${name}.tsx`);
    const loweredPath = resolve(tempRoot, `${name}.tsx`);
    const fileName = `examples/stackoverflow/src/components/${name}.tsx`;
    const source = readFileSync(sourcePath, 'utf8');
    const header = `// @kovojs-ir — lowered from ${fileName} by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`pnpm run emit-components\`.\n`;

    // SPEC.md §4.8: query-backed component roots derive their refresh stamps.
    assert.doesNotMatch(
      source,
      /(?:data-bind|kovo-deps|kovo-c|kovo-fragment-target|kovo-state|data-p-[\w-]+)=/,
      `${fileName} hand-writes stamps`,
    );

    if (check) {
      const current = readFileSync(generatedPath, 'utf8');
      assert.ok(
        current.startsWith(header),
        `generated ${name}.tsx has a stale header; run \`pnpm --filter @kovojs/example-stackoverflow run emit-components\``,
      );
      writeFileSync(loweredPath, current.slice(header.length));
    }

    runKovo([
      'compile',
      'component',
      sourcePath,
      '--out',
      loweredPath,
      '--file-name',
      fileName,
      '--registry-facts',
      registryFactsPath,
      '--fixpoint',
      '--render-equivalence',
      ...(check ? ['--check'] : []),
    ]);

    if (!check) {
      writeFileSync(generatedPath, `${header}${readFileSync(loweredPath, 'utf8')}`);
    }
  }

  const liveTargetsPath = resolve(soRoot, 'src/generated/live-targets.ts');
  const liveTargetsSource = `// @kovojs-ir — generated live-target registry for StackOverflow components (SPEC.md section 9.1). Do not edit; regenerate with \`pnpm run emit-components\`.
import { collectGeneratedLiveTargetRenderers } from '@kovojs/server/internal/wire';

import * as questionDetailModule from './question-detail.js';
import * as questionListModule from './question-list.js';

export const liveTargetRenderers = collectGeneratedLiveTargetRenderers([
  questionDetailModule,
  questionListModule,
]);
`;

  if (check) {
    assert.equal(
      readFileSync(liveTargetsPath, 'utf8'),
      liveTargetsSource,
      'generated live-targets.ts is stale; run `pnpm --filter @kovojs/example-stackoverflow run emit-components`',
    );
  } else {
    writeFileSync(liveTargetsPath, liveTargetsSource);
  }

  const routeSourcePath = resolve(soRoot, 'src/interactive-app.tsx');
  const routeGeneratedPath = resolve(soRoot, 'src/generated/interactive-app.kovo-route.tsx');
  const routeFileName = 'examples/stackoverflow/src/interactive-app.tsx';
  const routeArtifactFileName =
    'examples/stackoverflow/src/generated/interactive-app.kovo-route.tsx';

  runKovo([
    'compile',
    'route',
    routeSourcePath,
    '--out',
    routeGeneratedPath,
    '--file-name',
    routeFileName,
    '--artifact-file-name',
    routeArtifactFileName,
    '--rewrite',
    'QuestionDetailRegion=./question-detail.js',
    '--rewrite',
    'QuestionListRegion=./question-list.js',
    ...(check ? ['--check'] : []),
  ]);
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}

function requiredString(name) {
  return {
    coercion: 'string',
    defaulted: false,
    name,
    optional: false,
    provenance: 'registry',
    required: true,
  };
}

function runKovo(args) {
  execFileSync('kovo', args, {
    cwd: soRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
