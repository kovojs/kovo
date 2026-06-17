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

const { assertFixpoint, assertRenderEquivalence, compileComponentModule, compileRouteModule } =
  await import('@kovojs/compiler');
const { mutationInputFactsFromSource } = await import('@kovojs/compiler/internal');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const crmRoot = resolve(scriptDir, '..');
const componentNames = ['contacts', 'deal-detail', 'pipeline'];
const mutationSourcePath = resolve(crmRoot, 'src/mutations.ts');
const registryFacts = {
  mutationInputs: registryMutationInputs(
    'examples/crm/src/mutations.ts',
    readFileSync(mutationSourcePath, 'utf8'),
  ),
  mutations: {
    addContact: 'typeof addContact',
    closeDeal: 'typeof closeDeal',
    createDeal: 'typeof createDeal',
    moveDeal: 'typeof moveDeal',
  },
};

function registryMutationInputs(fileName, source) {
  return Object.fromEntries(
    [...mutationInputFactsFromSource(fileName, source).values()].map((fact) => [
      fact.key,
      fact.fields.map((field) => ({ ...field, provenance: 'registry' })),
    ]),
  );
}

for (const name of componentNames) {
  const sourcePath = resolve(crmRoot, `src/components/${name}.tsx`);
  const generatedPath = resolve(crmRoot, `src/generated/${name}.tsx`);
  const fileName = `examples/crm/src/components/${name}.tsx`;
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
      `generated ${name}.tsx is stale; run \`pnpm --filter @kovojs/example-crm run emit-components\``,
    );
  } else {
    writeFileSync(generatedPath, generated);
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

if (process.argv.includes('--check')) {
  assert.equal(
    readFileSync(liveTargetsPath, 'utf8'),
    liveTargetsSource,
    'generated live-targets.ts is stale; run `pnpm --filter @kovojs/example-crm run emit-components`',
  );
} else {
  writeFileSync(liveTargetsPath, liveTargetsSource);
}

const routeSourcePath = resolve(crmRoot, 'src/interactive-app.tsx');
const routeGeneratedPath = resolve(crmRoot, 'src/generated/interactive-app.kovo-route.tsx');
const routeFileName = 'examples/crm/src/interactive-app.tsx';
const routeArtifactFileName = 'examples/crm/src/generated/interactive-app.kovo-route.tsx';
const routeResult = compileRouteModule({
  artifactFileName: routeArtifactFileName,
  componentImportRewrites: [
    { localName: 'ContactsRegion', specifier: './contacts.js' },
    { localName: 'DealDetailRegion', specifier: './deal-detail.js' },
    { localName: 'PipelineRegion', specifier: './pipeline.js' },
  ],
  fileName: routeFileName,
  source: readFileSync(routeSourcePath, 'utf8'),
});

assert.deepEqual(
  routeResult.diagnostics,
  [],
  `${routeFileName} has compiler diagnostics: ${JSON.stringify(routeResult.diagnostics, null, 2)}`,
);
assert.equal(routeResult.files.length, 1, `${routeFileName} produced no generated route IR`);
const routeGenerated = routeResult.files[0].source;

if (process.argv.includes('--check')) {
  assert.equal(
    readFileSync(routeGeneratedPath, 'utf8'),
    routeGenerated,
    'generated interactive-app.kovo-route.tsx is stale; run `pnpm --filter @kovojs/example-crm run emit-components`',
  );
} else {
  writeFileSync(routeGeneratedPath, routeGenerated);
}
