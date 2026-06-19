import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const crmRoot = resolve(scriptDir, '..');
const componentNames = ['contacts', 'deal-detail', 'pipeline'];
const check = process.argv.includes('--check');
const tempRoot = mkdtempSync(join(tmpdir(), 'kovo-crm-components-'));
const registryFactsPath = join(tempRoot, 'registry-facts.json');

const registryFacts = {
  mutationInputs: {
    addContact: [
      requiredString('id'),
      requiredString('name'),
      requiredString('email'),
      requiredString('ownerId'),
    ],
    closeDeal: [requiredString('dealId')],
    createDeal: [
      requiredString('id'),
      requiredString('contactId'),
      requiredString('stage'),
      requiredNumber('amount'),
      requiredString('ownerId'),
    ],
    moveDeal: [requiredString('dealId'), requiredString('stage')],
  },
  mutations: {
    addContact: 'typeof addContact',
    closeDeal: 'typeof closeDeal',
    createDeal: 'typeof createDeal',
    moveDeal: 'typeof moveDeal',
  },
};

try {
  writeFileSync(registryFactsPath, `${JSON.stringify(registryFacts, null, 2)}\n`);
  for (const name of componentNames) {
    const sourcePath = resolve(crmRoot, `src/components/${name}.tsx`);
    const generatedPath = resolve(crmRoot, `src/generated/${name}.tsx`);
    const loweredPath = resolve(tempRoot, `${name}.tsx`);
    const fileName = `examples/crm/src/components/${name}.tsx`;
    const source = readFileSync(sourcePath, 'utf8');
    const header = `// @kovojs-ir — lowered from ${fileName} by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`pnpm run emit-components\`.\n`;

    // SPEC.md §4.8: query-backed component roots derive their refresh stamps.
    assert.doesNotMatch(
      source,
      /(?:data-bind|kovo-deps|kovo-c|kovo-fragment-target|kovo-state|data-p-[\w-]+)=/,
      `${fileName} hand-writes stamps`,
    );

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
    ]);

    if (!check) {
      mkdirSync(dirname(generatedPath), { recursive: true });
      writeFileSync(generatedPath, `${header}${readFileSync(loweredPath, 'utf8')}`);
    }
  }

  const liveTargetsPath = resolve(crmRoot, 'src/generated/live-targets.ts');
  const liveTargetsSource = `// @kovojs-ir - generated live-target registry for CRM components (SPEC.md section 9.1). Do not edit; regenerate with \`pnpm run emit-components\`.
import { collectGeneratedLiveTargetRenderers } from '@kovojs/server/internal/wire';

import * as contactsModule from './contacts.js';
import * as dealDetailModule from './deal-detail.js';
import * as pipelineModule from './pipeline.js';

export const liveTargetRenderers = collectGeneratedLiveTargetRenderers([
  contactsModule,
  dealDetailModule,
  pipelineModule,
]);
`;

  if (!check) {
    mkdirSync(dirname(liveTargetsPath), { recursive: true });
    writeFileSync(liveTargetsPath, liveTargetsSource);
  }

  const routeSourcePath = resolve(crmRoot, 'src/interactive-app.tsx');
  const routeGeneratedPath = check
    ? resolve(tempRoot, 'interactive-app.kovo-route.tsx')
    : resolve(crmRoot, 'src/generated/interactive-app.kovo-route.tsx');
  const routeFileName = 'examples/crm/src/interactive-app.tsx';
  const routeArtifactFileName = 'examples/crm/src/generated/interactive-app.kovo-route.tsx';

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
    'ContactsRegion=./contacts.js',
    '--rewrite',
    'DealDetailRegion=./deal-detail.js',
    '--rewrite',
    'PipelineRegion=./pipeline.js',
  ]);
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}

function requiredString(name) {
  return requiredField(name, 'string');
}

function requiredNumber(name) {
  return requiredField(name, 'number');
}

function requiredField(name, coercion) {
  return {
    coercion,
    defaulted: false,
    name,
    optional: false,
    provenance: 'registry',
    required: true,
  };
}

function runKovo(args) {
  execFileSync('kovo', args, {
    cwd: crmRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
