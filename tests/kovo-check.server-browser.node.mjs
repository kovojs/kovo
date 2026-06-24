// Server/browser kovo-check suite. `scripts/kovo-check.mjs` can run this file
// alone in CI or alongside the other suite files for the local aggregate gate.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

import { missingBuildMessage } from '../scripts/kovo-check.mjs';
import { readTempCommerceGraph } from '../scripts/commerce-graph.mjs';
import {
  kovoCheck,
  kovoExplain,
  handleKovoMcpRequest,
  mainAsync,
  runMcpFallbackStdio,
} from '../dist/cli/src/index.mjs';
import {
  assertFixpoint,
  assertRenderEquivalence,
  compileComponentModule,
  deriveAppGraph,
  emitQueryPlanBootstrapModule,
  kovoVitePlugin,
} from '../dist/compiler/src/index.mjs';
import {
  collectCssAssetManifest,
  collectMinifierReservedNames,
  queryShapesFromFacts,
} from '../dist/compiler/src/internal.mjs';
import { diagnosticDefinitions } from '../dist/core/src/internal/diagnostics.mjs';
import { createQueryStore, installKovoLoader } from '../dist/browser/src/client.mjs';
import { derive } from '../dist/browser/src/index.mjs';
import {
  applyDeferredStreamResponseToRuntime,
  kovoEscapeHtml,
} from '../dist/browser/src/generated.mjs';
import { refetchQueries, kovoLoaderSource } from '../dist/browser/src/internal/inline-loader.mjs';
import { DomMorphTarget, morphStructuralTree } from '../dist/browser/src/internal/morph.mjs';
import {
  applyCompiledQueryUpdatePlan,
  installPagehideOptimismCleanup,
  OptimisticRebaser,
  stampPendingQueries,
  submitEnhancedMutation,
  submitOptimisticEnhancedMutation,
} from '../dist/browser/src/internal/mutation.mjs';
import { readElementParams } from '../dist/browser/src/internal/delegation.mjs';
import { createKovoTestHarness } from '../dist/test/src/harness.mjs';
import { createDbVerifier } from '../dist/test/src/verifier.mjs';
import {
  browserSuiteAcceptanceProjectFact,
  commandOutputLines,
  commandSequenceWithoutLast,
  conformanceGateFacts,
  loadVitePlusConfig,
  p10PerfAcceptanceProjectFact,
  pnpmRunScriptNames,
  runCapturedCliCommand,
  vitePlusTaskInputFacts,
  workflowStepCommands,
} from '../packages/conformance-fixtures/src/command-fixtures.ts';
import {
  compilerDataBindBehaviorFact,
  compilerDiagnosticFacts,
  compilerLoweredIrKovoCheckBehaviorFact,
  compilerQueryUpdatePlanFacts,
  compilerUpdateCoverageFacts,
  compilerValidationBehaviorFact,
} from '../packages/conformance-fixtures/src/compiler-fixtures.ts';
import { viteLoweredEventDiagnosticFact } from '../packages/conformance-fixtures/src/diagnostic-output-fixtures.ts';
import {
  kovoExplainComponentAssertionFact,
  kovoExplainEndpointAssertionFact,
  kovoExplainListField,
  kovoExplainQueryAssertionFact,
  kovoExplainScopeAuditAssertionFact,
  kovoExplainUnguardedAssertionFact,
  kovoExplainUpdateConsumers,
} from '../packages/conformance-fixtures/src/kovo-explain-fixtures.ts';
import {
  kovoCheckAssertionFact,
  kovoCheckOkAssertionFact,
  kovoCheckUnguardedAuditBehaviorFact,
} from '../packages/conformance-fixtures/src/kovo-check-fixtures.ts';
import { kovoExportStaticBehaviorFact } from '../packages/conformance-fixtures/src/kovo-export-fixtures.ts';
import {
  executeGeneratedClientArtifact,
  executeGeneratedBootstrapModule,
  executeGeneratedClientModule,
  executeInlineEnhancedFormLoaderFixture,
  assertGeneratedRegistryConsumerTypes,
  generatedBootstrapDeferredBehaviorFact,
  generatedMinifierNamePreservationBehaviorFact,
  generatedQueryUpdatePlanBehaviorFact,
  generatedRenderEquivalenceBehaviorFact,
  generatedServerDeferredBehaviorFact,
  generatedTypedDataParamCoercionBehaviorFact,
  generatedTypedRouteNavigationBehaviorFact,
  generatedViewTransitionStampBehaviorFact,
  generatedWireDeferredBehaviorFact,
  generatedRegistryInterfaceMemberTypes,
} from '../packages/conformance-fixtures/src/generated-module-fixtures.ts';
import {
  commerceGraphBehaviorFact,
  generatedGraphArtifactAcceptanceChecklistFact,
  generatedGraphArtifactAcceptanceFact,
  graphMutationFact,
  graphMutationUpdateConsumers,
  graphOptimisticStatusMatrix,
} from '../packages/conformance-fixtures/src/graph-fixtures.ts';
import { touchGraphProvenanceFact } from '../packages/conformance-fixtures/src/touch-graph-fixtures.ts';
import { documentQueryScriptBehaviorFact } from '../packages/test/src/internal/html-wire.ts';
import {
  legibilityStudyGateFact,
  normativeDocsGateFact,
  prelaunchChecklistGateFact,
  v1AcceptanceLedgerGateFact,
} from '../packages/conformance-fixtures/src/markdown-fixtures.ts';
import { mcpCompileResponseFacts } from '../packages/conformance-fixtures/src/mcp-fixtures.ts';
import {
  drizzleQueryBehaviorSourceFixtures,
  moduleImportFailureFact,
  projectQueryBehaviorFacts,
  projectQueryDiagnosticFacts,
  projectTouchGraphBehaviorFacts,
  forbiddenBrowserArchitectureProjectFact,
  postParseSourceStringProjectFact,
  projectJsonFile,
  projectPackageManifestFacts,
} from '../packages/conformance-fixtures/src/source-fixtures.ts';
import { runPnpmFilterTaskCommand } from '../packages/conformance-fixtures/src/starter-template-fixtures.ts';
import {
  commerceKeyedOptimisticBehaviorFact,
  enhancedMutationBehaviorFact,
  loaderSmokeBehaviorFact,
  morphFragmentBehaviorFact,
  optimismCleanupBehaviorFact,
} from '../packages/conformance-fixtures/src/runtime-fixtures.ts';
import {
  serverCommerceAdoptDontInventBehaviorFact,
  serverCommerceStylesheetBehaviorFact,
  serverCommerceTransactionBehaviorFact,
  serverDataPlaneBehaviorFact,
  serverMutationLifecycleBehaviorFact,
  serverPageHintsBehaviorFact,
} from '../packages/conformance-fixtures/src/server-fixtures.ts';
import {
  viteHandlerTransformFactAsync,
  viteProductionEmitContractFact,
  viteRedGreenBuildFixtureFact,
  viteTransformElementFactAsync,
} from '../packages/conformance-fixtures/src/vite-fixtures.ts';
import {
  generatedWireResponseBodies,
  loadWireFixtureSources,
  wireFixtureContentTypesFacts,
  wireFixturePresenceFacts,
  wireFixtureResponseBody,
  wireFixturesWithContentType,
  wireFragmentModeFacts,
  wireResponseBodyPinFacts,
  wireResponseMetadataFacts,
} from '../packages/conformance-fixtures/src/wire-fixtures.ts';
import {
  verificationLayerBehaviorFact,
  verificationLayerKovoCheckDiagnosticsFact,
} from '../packages/conformance-fixtures/src/verification-fixtures.ts';
import {
  createApp,
  csrfField,
  csrfToken,
  domain,
  errorBoundary,
  guards,
  i18n,
  metaFromQuery,
  mutation,
  notFound,
  query,
  route as serverRoute,
  session,
  s,
  t,
  exportStaticApp,
} from '../dist/server/src/index.mjs';
import { runMutation, runQuery, runRoutePage } from '../dist/server/src/internal/execution.mjs';
import {
  renderDeferredStream,
  renderDocument,
  renderDocumentQueryScript,
  renderPageHints,
  renderQueryScript,
  stylesheetsForTargets,
} from '../dist/server/src/internal/html.mjs';
import { renderRoutePageResponse } from '../dist/server/src/internal/route.mjs';
import {
  renderMutationEndpointResponse,
  renderMutationResponse,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
} from '../dist/server/src/internal/wire.mjs';
import { href, Link, redirect, route } from '../dist/core/src/index.mjs';
import { fragmentTarget } from '../dist/core/src/internal/fragment-target.mjs';

const readProjectFile = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const loadProjectWireFixtureSources = () =>
  loadWireFixtureSources(new URL('../fixtures/wire/', import.meta.url));
const execFileAsync = promisify(execFile);
let commerceGraphCache;

function commerceGraphFixture() {
  commerceGraphCache ??= readTempCommerceGraph();
  return commerceGraphCache;
}

const runCliCommand = (args) => runCapturedCliCommand(mainAsync, args);

const generatedModuleRuntime = {
  applyCompiledQueryUpdatePlan,
  applyDeferredStreamResponseToRuntime,
  createQueryStore,
  derive,
  DomMorphTarget,
  handler: (callback) => (event, ctx) => callback(event, ctx),
  installKovoLoader,
  kovoEscapeHtml,
};

const defaultDelegatedEvents = [
  'click',
  'submit',
  'input',
  'change',
  'keydown',
  'keyup',
  'contextmenu',
  'paste',
  'cancel',
  'beforetoggle',
  'animationend',
  'scroll',
  'focus',
  'blur',
  'pointerdown',
  'pointermove',
  'pointerup',
];
const delegatedLifecycleEvents = [...defaultDelegatedEvents, 'pointerover', 'pointerout'];

const generatedBootstrapRuntime = {
  ...generatedModuleRuntime,
  installKovoLoader() {
    return { dispose() {}, events: [], islandSignalScope: {} };
  },
};

const serverMutationRuntime = {
  domain,
  mutation,
  query,
  renderMutationResponse,
  runMutation,
  s,
};

const serverDataPlaneRuntime = {
  ...serverMutationRuntime,
  csrfField,
  csrfToken,
  notFound,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
  renderRoutePageResponse,
  route: serverRoute,
  runQuery,
  runRoutePage,
};

const serverCommerceAdoptDontInventRuntime = {
  ...serverDataPlaneRuntime,
  createQueryStore,
  errorBoundary,
  guards,
  i18n,
  metaFromQuery,
  renderMutationEndpointResponse,
  renderPageHints,
  session,
  submitEnhancedMutation,
  t,
};

const serverCommerceStylesheetRuntime = {
  ...serverMutationRuntime,
  renderDeferredStream,
  renderMutationEndpointResponse,
  renderPageHints,
  stylesheetsForTargets,
};

const loadProjectVitePlusConfig = async (configPath = 'vite.config.ts') =>
  loadVitePlusConfig(await readProjectFile(configPath));

const projectRootPath = fileURLToPath(new URL('..', import.meta.url));
void test('P3 Drizzle query facts include select shapes and instance keys', async () => {
  let drizzle;
  try {
    drizzle = await import('../packages/drizzle/src/static.ts');
  } catch (error) {
    const importFailureFact = moduleImportFailureFact(error, [
      '__filename is not defined in ES module scope',
      'packages/drizzle/src/graph.js',
      'packages/core/src/diagnostics.js',
    ]);
    assert.equal(importFailureFact.allowed, true, 'unexpected Drizzle static import failure');
    assert.notEqual(importFailureFact.matchedReason, null);
    await execFileAsync(
      'pnpm',
      [
        'exec',
        'vitest',
        '--run',
        'packages/drizzle/src/index',
        '-t',
        [
          'extracts query result shapes, read domains, and instance keys from Drizzle selects',
          'reports KV410 for opaque query projections without declared output schemas',
          'omits instance keys when Drizzle query predicates do not target an annotated table key',
          'reports KV411 when a query read set includes an exempt table',
          'omits write-side-only exempt table writes from the touch graph',
          'resolves imported table symbols in project query facts',
        ].join('|'),
      ],
      { cwd: new URL('..', import.meta.url), maxBuffer: 1024 * 1024 * 10 },
    );
    return;
  }

  const { extractQueryFactsFromProject, extractQueryFactsFromSource, extractTouchGraphFromSource } =
    drizzle;
  const drizzleSources = drizzleQueryBehaviorSourceFixtures();

  assert.deepEqual(
    projectQueryBehaviorFacts(extractQueryFactsFromSource(drizzleSources.selectShape)),
    [
      {
        instanceKey: {
          domain: 'cart',
          key: 'arg:cartId',
        },
        query: 'cart',
        reads: ['cart', 'product'],
        shape: {
          count: 'number',
          item: {
            qty: 'number',
          },
          productId: 'string',
        },
        site: 'cart.queries.ts:11',
      },
    ],
  );

  const opaqueProjectionFacts = extractQueryFactsFromSource(drizzleSources.opaqueProjection);
  assert.deepEqual(projectQueryBehaviorFacts(opaqueProjectionFacts), [
    {
      diagnostics: [
        {
          code: 'KV410',
          message:
            'Opaque query projection requires a declared output schema. cart.count uses sql/raw projection without output.',
          severity: 'error',
          site: 'cart.queries.ts:4',
        },
      ],
      instanceKey: {
        domain: 'cart',
        key: 'arg:cartId',
      },
      query: 'cart',
      reads: ['cart'],
      shape: {
        count: 'number',
      },
      site: 'cart.queries.ts:4',
    },
  ]);
  assert.deepEqual(projectQueryDiagnosticFacts(opaqueProjectionFacts), [
    {
      code: 'KV410',
      message:
        'Opaque query projection requires a declared output schema. cart.count uses sql/raw projection without output.',
      severity: 'error',
      site: 'cart.queries.ts:4',
    },
  ]);

  assert.deepEqual(
    projectQueryBehaviorFacts(extractQueryFactsFromSource(drizzleSources.nonKeyPredicate)),
    [
      {
        query: 'product',
        reads: ['product'],
        shape: {
          sku: 'string',
        },
        site: 'product.queries.ts:4',
      },
    ],
  );

  const exemptReadFacts = extractQueryFactsFromSource(drizzleSources.exemptRead);
  assert.deepEqual(projectQueryBehaviorFacts(exemptReadFacts), [
    {
      diagnostics: [
        {
          code: 'KV411',
          message: 'Query read set includes an exempt table. Tables: audit_log.',
          severity: 'error',
          site: 'product.queries.ts:5',
        },
      ],
      query: 'product',
      reads: ['product'],
      shape: {
        message: 'string',
        name: 'string',
      },
      site: 'product.queries.ts:5',
    },
  ]);
  assert.deepEqual(projectQueryDiagnosticFacts(exemptReadFacts), [
    {
      code: 'KV411',
      message: 'Query read set includes an exempt table. Tables: audit_log.',
      severity: 'error',
      site: 'product.queries.ts:5',
    },
  ]);

  assert.deepEqual(
    projectTouchGraphBehaviorFacts(extractTouchGraphFromSource(drizzleSources.exemptWriteTouch)),
    {
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: 'arg:cartId',
            site: 'cart.domain.ts:9',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    },
  );

  assert.deepEqual(
    projectQueryBehaviorFacts(
      extractQueryFactsFromProject({ files: drizzleSources.importedSchemaProject }),
    ),
    [
      {
        instanceKey: {
          domain: 'cart',
          key: 'arg:id',
        },
        query: 'cart',
        reads: ['cart'],
        shape: {
          id: 'string',
        },
        site: 'cart.queries.ts:4',
      },
    ],
  );
});

void test('P1 fragment targets emit typed registry facts', async () => {
  assert.deepEqual(fragmentTarget('cart-row/cart-row', { rowId: 'row-1' }), {
    props: { rowId: 'row-1' },
    target: 'cart-row/cart-row',
  });

  const result = compileComponentModule({
    fileName: 'cart-row.tsx',
    source: `
export const CartRow = component({
  queries: { cart: {} },
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});
`,
  });
  assert.deepEqual(result.componentGraphFacts, [
    {
      domName: 'cart-row',
      exportName: 'CartRow',
      fragments: ['cart-row/cart-row'],
      name: 'cart-row/cart-row',
      queries: ['cart'],
    },
  ]);
  await assertGeneratedRegistryConsumerTypes(
    result.files,
    `
import { fragmentTarget } from '@kovojs/core/internal/fragment-target';

const cartRow = fragmentTarget('cart-row/cart-row', { rowId: 'row-1' });
cartRow.props.rowId.toUpperCase();

// @ts-expect-error generated FragmentTargets require rowId.
fragmentTarget('cart-row/cart-row', {});

// @ts-expect-error generated FragmentTargets keep rowId typed as string.
fragmentTarget('cart-row/cart-row', { rowId: 1 });

// @ts-expect-error generated FragmentTargets reject undeclared props.
fragmentTarget('cart-row/cart-row', { rowId: 'row-1', sku: 'sku-1' });
`,
  );
});

void test('D9 KV235 fails kovo-check for app-authored lowered IR component modules', async () => {
  const fact = compilerLoweredIrKovoCheckBehaviorFact({ compileComponentModule, kovoCheck });

  assert.equal(fact.specSection, 'SPEC §5.2');
  assert.deepEqual(fact.compilerDiagnostics, [
    {
      code: 'KV235',
      fileName: 'cart-badge.tsx',
      help:
        `${diagnosticDefinitions.KV235.help}\n` +
        'TSX equivalent direction: render with JSX, for example `render: (...) => (<cart-badge>...</cart-badge>)`, and use typed expressions such as `{cart.count}` instead of data-bind strings.',
      message:
        'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
      severity: 'error',
    },
  ]);
  assert.deepEqual(fact.kovoCheck, {
    coverage: [],
    diagnostics: [
      {
        code: 'KV235',
        message:
          'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
        properties: {},
        severity: 'ERROR',
        target: 'cart-badge.tsx:4:25',
      },
    ],
    exitCode: 1,
    optimisticProofs: [],
    status: 'issues',
    version: 'kovo-check/v1',
  });
});

void test('P4 commerce touch graph is an on-demand generated artifact', async () => {
  const artifactGraph = commerceGraphFixture();
  const kovoCheckResult = kovoCheck(artifactGraph);
  const provenance = await touchGraphProvenanceFact(
    projectRootPath,
    artifactGraph.touchGraph ?? {},
  );
  const commerceAcceptance = {
    artifactGraph,
    checklist: generatedGraphArtifactAcceptanceChecklistFact(
      generatedGraphArtifactAcceptanceFact({
        artifactGraph,
        emitCheck: { stderr: '', stdout: '' },
        kovoCheck: kovoCheckOkAssertionFact(kovoCheckResult),
        provenance,
      }),
    ),
    emitCheck: { stderr: '', stdout: '' },
  };
  assert.equal(kovoCheckResult.exitCode, 0);
  assert.deepEqual(commerceAcceptance.emitCheck, { stderr: '', stdout: '' });
  assert.deepEqual(commerceAcceptance.checklist, {
    emitCheckClean: true,
    kovoCheckOk: true,
    invalidationKeys: ['cart/add'],
    staticBehavior: {
      components: [
        {
          fragments: ['components/cart-badge/cart-badge'],
          name: 'components/cart-badge/cart-badge',
          queries: ['cart'],
        },
        {
          fragments: ['components/order-history/order-history'],
          name: 'components/order-history/order-history',
          queries: ['orderHistory'],
        },
        {
          fragments: ['components/product-grid/product-grid'],
          name: 'components/product-grid/product-grid',
          queries: ['productGrid'],
        },
      ],
      domains: ['auth', 'cart', 'order', 'product'],
      invalidations: {
        'cart/add': ['cart', 'orderHistory', 'productGrid'],
      },
      mutations: ['auth/sign-out', 'cart/add'],
      optimistic: [
        { mutation: 'cart/add', query: 'cart', status: 'derived' },
        { mutation: 'cart/add', query: 'orderHistory', status: 'derived' },
        { mutation: 'cart/add', query: 'productGrid', status: 'derived' },
      ],
      routes: ['/', '/cart', '/login'],
      touchGraphKeys: ['cart.addItem'],
    },
    touchGraph: {
      entryKeys: ['cart.addItem'],
      sourceLineMismatchCount: 0,
      sourceSitePaths: ['examples/commerce/src/domain.ts'],
      sourceSitesHavePositiveLines: true,
      touchCountsByMutation: {
        'cart.addItem': 3,
      },
      unresolvedMutations: [],
    },
  });
  assert.deepEqual(
    kovoExplainQueryAssertionFact(
      kovoExplain(commerceAcceptance.artifactGraph, { kind: 'query', target: 'cart' }),
    ).domainWrites,
    ['cart.addItem'],
  );
});

void test('Conformance suites are an explicit gate', async () => {
  const conformancePackages = await projectPackageManifestFacts({
    rootPath: projectRootPath,
    directory: 'conformance',
  });
  const expectedConformancePackages = {
    'app-shell-spike': '@kovojs/conformance-app-shell-spike',
    'auth-spike': '@kovojs/conformance-auth-spike',
    'better-auth-pin': '@kovojs/conformance-better-auth-pin',
    'drizzle-pin': '@kovojs/conformance-drizzle-pin',
    'webhook-spike': '@kovojs/conformance-webhook-spike',
  };

  const packageJson = await projectJsonFile(projectRootPath, 'package.json');
  const viteTasks = (await loadProjectVitePlusConfig()).run.tasks;
  const ciWorkflowSource = await readProjectFile('.github/workflows/ci.yml');
  const conformanceFacts = conformanceGateFacts({
    expectedPackages: expectedConformancePackages,
    packageJson,
    packages: conformancePackages,
    scriptName: 'test:conformance',
    viteConfig: { run: { tasks: viteTasks } },
  });
  assert.deepEqual(
    conformanceFacts.packageEntries,
    Object.entries(expectedConformancePackages),
    'conformance gate covers the expected suite families',
  );
  assert.equal(conformanceFacts.everyPackageHasTestScript, true);
  assert.equal(
    conformanceFacts.everyCommandRunsTest,
    true,
    'conformance task runs package tests through pnpm filters',
  );
  assert.equal(conformanceFacts.presentInAcceptance, true);
  const workflowCommands = workflowStepCommands(ciWorkflowSource)
    .map((step) => step.run)
    .filter(Boolean);
  assert.ok(
    workflowCommands.includes('vp exec pnpm --filter @kovojs/conformance-${{ matrix.suite }} test'),
  );
  for (const suiteName of Object.keys(expectedConformancePackages)) {
    assert.ok(ciWorkflowSource.includes(suiteName), `CI conformance matrix includes ${suiteName}`);
  }
  assert.deepEqual(
    conformanceFacts.commands
      .map((entry) => entry.packageName)
      .toSorted((left, right) => left.localeCompare(right)),
    conformanceFacts.packageNames,
  );
  assert.deepEqual(conformanceFacts.inputFacts, [
    { auto: true },
    { pattern: 'conformance/**/package.json', base: 'workspace' },
    { pattern: 'conformance/**/src/**/*.ts', base: 'workspace' },
    { pattern: 'conformance/**/docs/**', base: 'workspace' },
    { pattern: 'packages/core/src/**/*.ts', base: 'workspace' },
    { pattern: 'packages/server/src/**/*.ts', base: 'workspace' },
    { pattern: 'packages/drizzle/src/**/*.ts', base: 'workspace' },
    { pattern: 'packages/better-auth/src/**/*.ts', base: 'workspace' },
  ]);
  const conformanceTask = viteTasks[conformanceFacts.taskName];
  const executedTask = await runPnpmFilterTaskCommand(
    conformanceTask.command,
    conformancePackages,
    {
      cwd: new URL('..', import.meta.url),
    },
  );
  assert.deepEqual(
    executedTask.observed.map((entry) => entry.script),
    ['test', 'test', 'test', 'test', 'test'],
  );
  assert.deepEqual(
    commandOutputLines(executedTask.output),
    conformanceFacts.commands.map((entry) => `pnpm-filter-test ${entry.packageName}`),
  );

  const missingPackageCommand = commandSequenceWithoutLast(conformanceTask.command);
  await assert.rejects(
    runPnpmFilterTaskCommand(missingPackageCommand, conformancePackages, {
      cwd: new URL('..', import.meta.url),
    }),
    /conformance task executes every discovered conformance package test/,
  );

  await execFileAsync(
    'pnpm',
    ['--filter', '@kovojs/drizzle', 'exec', 'vitest', 'run', 'src/index'],
    {
      cwd: new URL('..', import.meta.url),
      maxBuffer: 1024 * 1024 * 10,
    },
  );
});

void test('D3 deferred stream responses are consumed by the runtime', async () => {
  const compiled = compileComponentModule({
    fileName: 'cart-badge.tsx',
    source: `
export const CartBadge$isEmpty = derive(['cart'], (cart) => cart.count === 0);

export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">0</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <output data-derive="cart.CartBadge$isEmpty">false</output>
      <button disabled={cart.count === 0}>Disabled</button>
      <ul data-bind-list="cart.items" kovo-key="productId">
        <template kovo-stamp>
          <li><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li>
        </template>
      </ul>
    </cart-badge>
  ),
});
`,
  });

  assert.deepEqual(compiled.diagnostics, []);
  assert.deepEqual(compilerQueryUpdatePlanFacts(compiled.queryUpdatePlans), [
    {
      componentName: 'CartBadge',
      derives: [
        {
          exportName: 'CartBadge$isEmpty',
          expression: 'cart.count === 0',
          input: 'cart',
          name: 'CartBadge$isEmpty',
          param: 'cart',
          selector: '[data-derive="cart.CartBadge$isEmpty"]',
        },
      ],
      paths: ['cart.count', 'cart.empty', 'cart.items'],
      query: 'cart',
      stamps: [
        {
          attr: 'disabled',
          derive: {
            exportName: 'CartBadge$button_disabled_derive',
            expression: 'cart.count === 0',
            input: 'cart',
            name: 'CartBadge$button_disabled_derive',
            param: 'cart',
            selector: '[data-derive="cart.CartBadge$button_disabled_derive"]',
          },
          selector: '[data-derive="cart.CartBadge$button_disabled_derive"]',
        },
      ],
      templateStamps: [
        {
          itemBindingPlaceholders: [
            {
              path: '.name',
              readPath: 'name',
              readSegments: [{ name: 'name', optional: false }],
              value: 'Item',
            },
            {
              path: '.qty',
              readPath: 'qty',
              readSegments: [{ name: 'qty', optional: false }],
              value: '0',
            },
          ],
          key: 'productId',
          list: 'cart.items',
          listReadPath: 'items',
          listReadSegments: [{ name: 'items', optional: false }],
          selector: '[data-bind-list="cart.items"]',
          template:
            '<li><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li>',
        },
      ],
    },
  ]);

  assert.deepEqual(
    generatedQueryUpdatePlanBehaviorFact(compiled.files, {
      applyCompiledQueryUpdatePlan,
      executeClientArtifact: executeGeneratedClientArtifact,
      runtime: generatedModuleRuntime,
    }),
    {
      appliedPlan: {
        bindings: ['cart.count', 'cart.empty'],
        derives: ['CartBadge$isEmpty'],
        stamps: ['disabled'],
        templateStamps: ['[data-bind-list="cart.items"]'],
      },
      bindingText: '2',
      booleanAttributes: {
        disabled: null,
        hidden: null,
      },
      deriveText: 'false',
      orderedApply: {
        order: ['derive-after-binding:6', 'stamp-after-derive:items:1'],
        stampValue: '',
      },
      templateItems: [
        {
          html: '<li><span data-bind=".qty">1</span> x <span data-bind=".name">Coffee</span></li>',
          key: 'p1',
        },
        {
          html: '<li><span data-bind=".qty">3</span> x <span data-bind=".name">Tea</span></li>',
          key: 'p2',
        },
      ],
    },
  );

  assert.deepEqual(
    generatedBootstrapDeferredBehaviorFact(
      compiled.files,
      {
        emitQueryPlanBootstrapModule,
        executeBootstrapModule: executeGeneratedBootstrapModule,
        executeClientArtifact: executeGeneratedClientArtifact,
        runtime: generatedModuleRuntime,
      },
      generatedBootstrapRuntime,
    ),
    {
      appliedFragments: ['cart-badge'],
      bootstrapCallCount: 1,
      deferredApplicationCount: 0,
      enhancedMutationStoreMatches: true,
      fragmentHtmlByTarget: {
        'cart-badge': '<cart-badge><span data-bind="cart.count">9</span></cart-badge>',
      },
      queryPlanStoreMatches: true,
      updatedBindings: {
        'cart.count': '9',
      },
    },
  );

  assert.deepEqual(
    renderPageHints({
      bootstrapScript: '/c/generated/app.client.js',
      modulepreloads: ['/c/cart.client.js', '/c/generated/app.client.js'],
    }),
    {
      earlyHints: {
        Link: '</c/cart.client.js>; rel=modulepreload, </c/generated/app.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/cart.client.js">',
        '<link rel="modulepreload" href="/c/generated/app.client.js">',
        '<script type="module" src="/c/generated/app.client.js"></script>',
      ].join(''),
    },
  );

  assert.deepEqual(
    generatedServerDeferredBehaviorFact({
      applyDeferredStreamResponseToRuntime,
      createQueryStore,
      renderDeferredStream,
    }),
    {
      appliedFragments: ['reviews', 'reviews', 'summary'],
      chunkFragments: [
        [{ html: '<article>B</article>', mode: 'append', target: 'reviews' }],
        [
          { html: '<article>A</article>', mode: 'append', target: 'reviews' },
          { html: '<section>Replace</section>', target: 'summary' },
        ],
      ],
      chunkQueries: [['reviews'], ['reviews']],
      fragmentHtmlByTarget: {
        reviews: '<article>Initial</article><article>B</article><article>A</article>',
        summary: '<section>Replace</section>',
      },
      storeValues: {
        reviews: { items: ['A'] },
      },
    },
  );

  const fixtureBody = wireFixtureResponseBody(
    await loadProjectWireFixtureSources(),
    'defer-stream.http',
    1,
  );
  assert.deepEqual(
    generatedWireDeferredBehaviorFact(fixtureBody, {
      applyCompiledQueryUpdatePlan,
      applyDeferredStreamResponseToRuntime,
      createQueryStore,
    }),
    {
      appliedFragments: ['reviews:p1', 'recommendations:p1'],
      chunkFragmentTargets: [['reviews:p1', 'recommendations:p1']],
      fragmentHtmlFactsByTarget: {
        'reviews:p1': [{ attrs: { 'kovo-key': 'r1' }, innerHtml: '5', tag: 'article' }],
      },
      fragmentTargets: ['reviews:p1', 'recommendations:p1'],
      queryNames: ['reviews', 'recommendations'],
      storeValues: {
        recommendations: { items: [{ id: 'rec-1' }] },
        reviews: { items: [{ id: 'r1', rating: 5 }] },
      },
      stylesheetHrefsByTarget: {
        'recommendations:p1': [],
        'reviews:p1': ['/assets/reviews.css'],
      },
    },
  );
});

void test('P1 minifier name preservation evidence remains represented', async () => {
  const cartBadge = compileComponentModule({
    fileName: 'components/cart/cart-badge.tsx',
    source: `
import { component } from '@kovojs/core';

function removeItem() {}

export const CartBadge = component({
  render: () => (
    <div>
      <button onClick={removeItem}>Remove</button>
      <button onClick={() => state.count += params.quantity}>Add</button>
      <button onClick={() => state.count = state.count - params.quantity}>Subtract</button>
    </div>
  ),
});
`,
  });
  const cartDrawer = compileComponentModule({
    fileName: 'components/cart/cart-drawer.tsx',
    source: `
import { component } from '@kovojs/core';

function removeItem() {}

export const CartDrawer = component({
  render: () => <button onClick={removeItem}>Remove</button>,
});
`,
  });
  assert.deepEqual(
    generatedMinifierNamePreservationBehaviorFact({
      cartBadge,
      cartDrawer,
      collectMinifierReservedNames,
      executeClientArtifact: executeGeneratedClientArtifact,
      runtime: generatedModuleRuntime,
    }),
    {
      callResults: {
        add: 7,
        remove: 'removed',
        subtract: 5,
      },
      exportTypes: {
        CartBadge$button_click: 'function',
        CartBadge$button_click_2: 'function',
        CartBadge$removeItem: 'function',
      },
      forwardedCalls: [
        {
          ctx: { params: { quantity: 2 }, state: { count: 5 } },
          event: 'click',
        },
      ],
      handlerExports: [
        'CartBadge$removeItem',
        'CartBadge$button_click',
        'CartBadge$button_click_2',
      ],
      reservedNames: [
        'CartBadge$button_click',
        'CartBadge$button_click_2',
        'CartBadge$removeItem',
        'CartDrawer$removeItem',
      ],
      stateCountAfterAdd: 7,
      stateCountAfterSubtract: 5,
    },
  );
});

void test('P1 typed data param coercion remains represented', async () => {
  const result = compileComponentModule({
    fileName: 'components/cart/cart-actions.tsx',
    source: `
import { component } from '@kovojs/core';

export const CartActions = component({
  render: () => (
    <div>
      <button onClick={() => state.count += item.quantity}>Add</button>
      <button onClick={() => item.selected ? select(item.id) : deselect(item.id)}>Select</button>
    </div>
  ),
});
`,
  });
  assert.deepEqual(
    generatedTypedDataParamCoercionBehaviorFact({
      executeClientArtifact: executeGeneratedClientArtifact,
      files: result.files,
      readElementParams,
      runtime: generatedModuleRuntime,
    }),
    {
      buttonAttributes: [
        {
          'data-p-quantity': '{item.quantity}',
          'kovo-param-types': 'quantity:number',
        },
        {
          'data-p-id': '{item.id}',
          'data-p-selected': '{item.selected}',
          'kovo-param-types': 'selected:boolean',
        },
      ],
      handlerResults: {
        add: 3,
        deselect: 'deselect:p2',
        select: 'select:p1',
      },
      parsedParams: {
        add: { quantity: 2 },
        deselect: { id: 'p2', selected: false },
        select: { id: 'p1', selected: true },
        standalone: {
          featured: false,
          productId: 'p1',
          quantity: 2,
        },
      },
      stateCountAfterAdd: 3,
    },
  );
});

void test('P1 render-equivalence gate remains represented', async () => {
  const result = compileComponentModule({
    fileName: 'components/cart/cart-total.tsx',
    source: `
import { component } from '@kovojs/core';

export const CartTotal = component({
  render: () => <cart-total><span data-bind="cart.total">{cart.total}</span></cart-total>,
});
`,
  });
  assert.deepEqual(
    generatedRenderEquivalenceBehaviorFact({
      assertRenderEquivalence,
      result,
    }),
    {
      actualMatchesExpected: true,
      artifact: 'components/cart/cart-total.server.js',
      boundSpanAttrs: { 'data-bind': 'cart.total' },
      cartTotalAttrs: {},
      checkCount: 1,
      mismatchRejected: true,
      ok: true,
    },
  );
  assert.deepEqual(
    kovoCheckAssertionFact(
      kovoCheck({
        renderEquivalenceChecks: [
          {
            actual: 'sha256:lowered',
            artifact: 'components/z.server.js',
            detail: 'render(src) differed from render(compile(src)).',
            expected: 'sha256:authored',
            ok: false,
          },
          {
            artifact: 'components/ok.server.js',
            ok: true,
          },
          {
            artifact: 'components/a.server.js',
            ok: false,
          },
        ],
      }),
    ),
    {
      coverage: [],
      diagnostics: [
        {
          code: 'RENDER_EQUIV',
          message: 'Authored and lowered render output must match byte-for-byte.',
          properties: {},
          severity: 'ERROR',
          target: 'components/a.server.js',
        },
        {
          code: 'RENDER_EQUIV',
          message:
            'render(src) differed from render(compile(src)). expected="sha256:authored" actual="sha256:lowered"',
          properties: {},
          severity: 'ERROR',
          target: 'components/z.server.js',
        },
      ],
      exitCode: 1,
      optimisticProofs: [],
      status: 'issues',
      version: 'kovo-check/v1',
    },
  );
});

void test('framework-owned browser suite is wired into acceptance', async () => {
  assert.deepEqual(await browserSuiteAcceptanceProjectFact({ rootPath: projectRootPath }), {
    acceptance: {
      browsers: ['chromium', 'firefox', 'webkit'],
      headless: true,
      include: ['packages/browser/src/**/*.browser.test.ts'],
      providerPackage: '@vitest/browser-playwright',
    },
    inputFacts: [
      { auto: true },
      { base: 'workspace', pattern: 'vitest.browser.config.ts' },
      { base: 'workspace', pattern: 'tests/browser-acceptance.mjs' },
      { base: 'workspace', pattern: 'packages/browser/src/**/*.browser.test.ts' },
    ],
    presentInAcceptance: true,
    presentInCi: true,
    scriptName: 'test:browser',
    taskName: 'browser',
  });
});

void test('root acceptance and CI cover the omitted release gates plus gallery browser coverage', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const acceptanceScripts = pnpmRunScriptNames(packageJson.scripts?.acceptance);
  assert.deepEqual(
    acceptanceScripts.filter((scriptName) =>
      [
        'check',
        'check:api-surface',
        'test:browser',
        'test:gallery-browser',
        'test:integration',
        'check:build',
        'check:publish',
      ].includes(scriptName),
    ),
    [
      'check',
      'check:api-surface',
      'test:browser',
      'test:gallery-browser',
      'test:integration',
      'check:build',
      'check:publish',
    ],
  );

  const workflowCommands = workflowStepCommands(await readProjectFile('.github/workflows/ci.yml'))
    .map((step) => step.run)
    .filter(Boolean);
  assert.ok(workflowCommands.includes('vp exec pnpm run check'));
  assert.ok(workflowCommands.includes('vp exec pnpm run check:api-surface'));
  assert.ok(
    workflowCommands.includes('vp exec pnpm --filter @kovojs/example-gallery run test:browser'),
  );
  assert.ok(workflowCommands.includes('vp exec pnpm run check:publish'));
});

void test('typecheck-examples watches every tsx-bearing example source tree', async () => {
  const viteTasks = (await loadProjectVitePlusConfig()).run.tasks;
  const typecheckInputs = vitePlusTaskInputFacts(viteTasks['typecheck-examples'])
    .map((fact) => fact.pattern)
    .filter(Boolean);
  const exampleTsconfigs = [
    'examples/commerce/tsconfig.json',
    'examples/stackoverflow/tsconfig.json',
    'examples/crm/tsconfig.json',
    'examples/reference/tsconfig.json',
  ];

  for (const tsconfigPath of exampleTsconfigs) {
    const tsconfig = JSON.parse(await readProjectFile(tsconfigPath));
    const hasTsx = (tsconfig.include ?? []).includes('src/**/*.tsx');
    const sourceBase = tsconfigPath.replace(/\/tsconfig\.json$/, '');
    assert.ok(typecheckInputs.includes(`${sourceBase}/src/**/*.ts`));
    assert.equal(typecheckInputs.includes(`${sourceBase}/src/**/*.tsx`), hasTsx);
  }
});

void test('P10 perf acceptance is wired through Playwright and CDP', async () => {
  assert.deepEqual(await p10PerfAcceptanceProjectFact({ rootPath: projectRootPath }), {
    acceptance: {
      browser: 'chromium',
      cdpMethods: ['HeapProfiler.collectGarbage', 'Runtime.getHeapUsage'],
      heapNoiseBudget: 65536,
      navigationCount: 100,
      paintEntry: 'first-contentful-paint',
      prerenderTimingField: 'activationStart',
      ttiMetric: 'ttiMinusFcpMs',
    },
    inputFacts: [
      { auto: true },
      { base: 'workspace', pattern: 'tests/p10-perf.node.mjs' },
      { base: 'workspace', pattern: 'dist/**' },
    ],
    ordering: {
      acceptanceAfterBuild: true,
      acceptanceBeforeKovoCheck: true,
      ciAfterBuild: true,
      ciBeforeKovoCheck: true,
    },
    presentInAcceptance: true,
    presentInCi: true,
    runFunction: true,
    scriptName: 'test:p10-perf',
    taskName: 'p10-perf',
  });
});
