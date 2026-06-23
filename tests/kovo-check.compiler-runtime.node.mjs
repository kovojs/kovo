// v1-cleanup item 1: kept whole intentionally. This is the framework's single
// node:test acceptance surface (`check:kovo`): it runs against built `../dist/**`
// artifacts and drives cross-package behavior end-to-end, so its tests share
// build/setup context and a coherent pass/fail story. Splitting would fragment a
// deliberately holistic acceptance gate. Reusable mechanics already live in
// @kovojs/test (source-fixtures, harness); this file is the executable surface.
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
void test('P6 navigation bfcache optimism cleanup acceptance is represented', async () => {
  assert.deepEqual(
    await optimismCleanupBehaviorFact({
      OptimisticRebaser,
      createQueryStore,
      installPagehideOptimismCleanup,
      stampPendingQueries,
      submitOptimisticEnhancedMutation,
    }),
    {
      disposedLifecycleListeners: [],
      fetchOptions: {
        bodyIsFormData: true,
        formDataQuantity: '2',
        headers: {
          Accept: 'text/vnd.kovo.fragment+html',
          'Kovo-Fragment': 'true',
          'Kovo-Idem': 'idem_bfcache',
          'Kovo-Live-Targets': '',
          'Kovo-Targets': '',
        },
        keepalive: true,
        method: 'POST',
      },
      listenerStates: {
        afterDispose: { pagehide: false },
        afterInstall: { pagehide: true, unload: false },
      },
      pendingAttributes: {
        afterPagehide: { 'kovo-deps': 'cart' },
        afterSubmit: {
          'aria-busy': 'true',
          'kovo-deps': 'cart',
          'kovo-pending': '',
        },
      },
      pendingCounts: {
        afterPagehide: 0,
        afterResponse: 0,
        afterSubmit: 1,
      },
      result: {
        appliedFragments: [],
        changes: [],
        fragments: [],
        idem: 'idem_bfcache',
        queries: ['cart'],
        targets: [],
      },
      storeValues: {
        afterPagehide: { count: 1 },
        afterResponse: { count: 2 },
        afterSubmit: { count: 3 },
      },
    },
  );
});

void test('P3 commerce mutation runs through the transaction lifecycle', async () => {
  assert.deepEqual(await serverCommerceTransactionBehaviorFact(serverMutationRuntime), {
    failed: {
      db: {
        commits: 1,
        items: [{ productId: 'p1', qty: 2 }],
        rollbacks: 1,
      },
      result: {
        error: { code: 'OUT_OF_STOCK', payload: { availableQuantity: 5 } },
        ok: false,
        status: 422,
      },
    },
    successful: {
      db: {
        commits: 1,
        items: [{ productId: 'p1', qty: 2 }],
        rollbacks: 0,
      },
      result: {
        changes: [],
        ok: true,
        rerunQueries: [],
        value: { count: 1 },
      },
    },
  });
});

void test('D1 commerce enhanced fragments carry stylesheet hints', async () => {
  assert.deepEqual(await serverCommerceStylesheetBehaviorFact(serverCommerceStylesheetRuntime), {
    deferred: {
      fragmentAttrs: { target: 'recommendations' },
      linkAttrs: {
        href: '/assets/recommendations.css',
        rel: 'stylesheet',
      },
      sectionAttrs: { class: 'recommendation-panel' },
      tags: ['main', 'kovo-defer', 'kovo-fragment', 'link', 'section', 'script', 'script'],
    },
    failure: {
      body: '<kovo-fragment target="product-form:p2"><link rel="stylesheet" href="/assets/styles.css"><form class="cart-form-panel"><output role="alert">Only 0 left.</output></form></kovo-fragment>',
      headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8' },
      status: 422,
    },
    pageHints: {
      csp: {
        scripts: [],
        styles: ['sha256-aglF4eql6svDxPnTw19+/jdeBTsfl850MsmdffQ8F/s='],
      },
      earlyHints: {
        Link: '</assets/styles.css>; rel=preload; as=style',
      },
      html: '<style data-kovo-critical-href="/assets/styles.css" data-kovo-csp-hash="sha256-aglF4eql6svDxPnTw19+/jdeBTsfl850MsmdffQ8F/s=">cart-badge { color: teal; }<\\/style> cart-badge { display: block; }</style><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/recommendations.css">',
    },
    selectedStylesheets: [
      {
        criticalCss: 'cart-badge { color: teal; }</style> cart-badge { display: block; }',
        fragmentTargets: ['cart-badge'],
        href: '/assets/styles.css',
      },
    ],
  });
});

void test('D4 commerce adopt-dont-invent features stay represented', async () => {
  const commerceGraph = commerceGraphFixture();
  const fact = await serverCommerceAdoptDontInventBehaviorFact(
    serverCommerceAdoptDontInventRuntime,
    commerceGraph,
  );

  assert.deepEqual(fact.graph.cartPage, {
    i18n: ['en-US:cartLabel,productStock'],
    meta: {
      description: 'Browse products and checkout with 0 verifiable cart item.',
      title: 'Kovo Commerce (0)',
    },
    modulepreloads: [],
    prefetch: false,
    route: '/cart',
    stylesheets: ['/assets/styles.css'],
    layouts: [{ name: 'CommerceCartLayout', queries: [] }],
    navigationSegments: [
      { id: 'layout:CommerceCartLayout', kind: 'layout', name: 'CommerceCartLayout' },
      {
        components: ['CommerceCartPage'],
        id: 'page:/cart',
        kind: 'page',
        name: 'page',
      },
    ],
  });
  assert.deepEqual(fact.graph.receiptMutation, {});
  assert.deepEqual(fact.pageHints, {
    missingQueryMessage: '',
    rendered: {
      csp: {
        scripts: ['sha256-428PRljyKzl7OW83C4phJF4OKCzGr42vPOLbx/jnYFI='],
        styles: [],
      },
      earlyHints: {},
      html: [
        '<title>Kovo Commerce (1)</title>',
        '<meta name="description" content="Browse products and checkout with 1 verifiable cart item.">',
        '<meta property="og:description" content="Browse products and checkout with 1 verifiable cart item.">',
        '<script type="application/json" kovo-i18n locale="en-US" data-kovo-csp-hash="sha256-428PRljyKzl7OW83C4phJF4OKCzGr42vPOLbx/jnYFI=">{"cartLabel":"Cart ({count})","productStock":"{stock} in stock"}</script>',
      ].join(''),
    },
    translation: 'Cart (1)',
  });
  assert.deepEqual(fact.guards, {
    authenticatedSession: { id: 's1', user: { id: 'u1' } },
    authedFailure: {
      kind: 'unauthenticated',
      payload: {},
    },
    firstRateLimitPasses: true,
    secondRateLimitFailure: 'rateLimited',
  });
  const receiptFile = fact.upload.result.changes[0].input.receipt.file;
  assert.equal(receiptFile instanceof Blob, true);
  assert.deepEqual(fact.upload.result, {
    changes: [
      {
        domain: 'attachment',
        input: {
          orderId: 'o1',
          receipt: {
            file: receiptFile,
            key: 'receipts/receipt.pdf',
            storage: {
              body: new TextEncoder().encode('receipt'),
              contentType: 'application/pdf',
              key: 'receipts/receipt.pdf',
              metadata: { filename: 'receipt.pdf' },
              size: 7,
            },
          },
        },
      },
    ],
    ok: true,
    rerunQueries: [],
    value: {
      orderId: 'o1',
      session: 'u1',
      storageKey: 'receipts/receipt.pdf',
    },
  });
  assert.deepEqual(fact.upload.stored, {
    body: new TextEncoder().encode('receipt'),
    contentType: 'application/pdf',
    key: 'receipts/receipt.pdf',
    metadata: { filename: 'receipt.pdf' },
    size: 7,
  });
  assert.deepEqual(fact.upload.progress, { max: '100', value: '50' });
  assert.equal(fact.upload.pendingDuringResponse, '');
  assert.equal(fact.upload.pendingAfterSubmit, null);
  assert.deepEqual(fact.fragmentFailure, {
    body: '<kovo-fragment target="product-grid-error" error-boundary="product-grid"><link rel="stylesheet" href="/assets/styles.css"><section role="alert">fragment failed</section></kovo-fragment>',
    headers: {
      'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
      'Kovo-Changes': '[]',
    },
    status: 200,
  });
});

void test('P10 commerce graph assertions answer behavior mechanically', async () => {
  const commerceGraph = commerceGraphFixture();
  const fact = commerceGraphBehaviorFact({
    compileComponentModule,
    deriveAppGraph,
    kovoCheck,
    kovoExplain,
    graph: commerceGraph,
  });

  assert.deepEqual(fact.kovoCheck, {
    exitCode: 0,
    issueCount: 0,
    status: 'ok',
    version: 'kovo-check/v1',
  });
  assert.deepEqual(fact.cartQueryExplain, {
    consumers: ['component:CartBadge'],
    domainWrites: ['cart.addItem'],
    exitCode: 0,
    invalidatedBy: ['cart/add'],
    reads: ['cart'],
    subject: 'QUERY cart',
    version: 'kovo-explain/v1',
  });
  assert.deepEqual(fact.cartAddExplain, {
    exitCode: 0,
    guards: ['authed', 'rateLimit:session'],
    inputFields: ['productId', 'quantity'],
    invalidates: ['cart', 'product', 'order'],
    manualInvalidates: [],
    optimisticStatuses: {
      cart: 'derived',
      orderHistory: 'derived',
      productGrid: 'derived',
    },
    optimisticSummary: {
      PUNTED: '0',
      UNHANDLED: '0',
      'await-fragment': '0',
      derived: '3',
      'hand-written': '0',
      total: '3',
    },
    session: 'commerceSession',
    subject: 'MUTATION cart/add',
    updateConsumers: [
      { consumers: ['component:CartBadge'], query: 'cart' },
      { consumers: ['component:OrderHistory'], query: 'orderHistory' },
      { consumers: ['component:ProductGrid'], query: 'productGrid' },
    ],
    version: 'kovo-explain/v1',
    writes: ['cart', 'product', 'order'],
  });
  assert.equal(
    diagnosticDefinitions.KV310.message,
    'Invalidated query lacks optimistic transform.',
  );
  assert.equal(
    diagnosticDefinitions.KV311.message,
    'Query/state-dependent DOM position has no update status.',
  );
  assert.deepEqual(fact.coverage.diagnostics, [
    {
      code: 'KV310',
      message: diagnosticDefinitions.KV310.message,
      properties: {},
      severity: 'WARN',
      target: 'cart/add -> cart',
    },
    {
      code: 'KV311',
      message: diagnosticDefinitions.KV311.message,
      properties: {
        component: 'CartBadge',
        position: 'undefined',
        query: 'cart.discount',
      },
      severity: 'WARN',
      target: '',
    },
    {
      code: 'UNGUARDED',
      message: 'mutation is reachable without an auth guard.',
      properties: {},
      severity: 'WARN',
      target: 'cart/add',
    },
  ]);
  assert.deepEqual(fact.coverage.coverage, [
    {
      properties: {
        component: 'OrderHistory',
        position: 'undefined',
        query: 'orderHistory',
        status: 'fragment',
      },
    },
  ]);
  assert.deepEqual(fact.staticBehavior, {
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
  });
  assert.deepEqual(fact.componentGraphFacts, [
    {
      domName: 'cart-badge',
      exportName: 'CartBadge',
      fragments: ['cart-badge/cart-badge'],
      name: 'cart-badge/cart-badge',
      queries: ['cart'],
    },
  ]);
  assert.deepEqual(fact.registryFacts, {
    components: ['cart-badge/cart-badge'],
    domainKeys: ['cart'],
    fragmentTargets: ['cart-badge/cart-badge'],
    invalidations: {},
    routes: [],
  });
  assert.deepEqual(fact.matrix.matrix, graphOptimisticStatusMatrix(commerceGraph));
  assert.deepEqual(fact.matrix.staticInvalidationMismatches, []);
  assert.deepEqual(fact.matrix.unhandledMutations, []);
  assert.deepEqual(fact.touchGraphKeys, ['cart.addItem']);
});

void test('P10 starter template stays wired to the current app-shell contract', async () => {
  const packageJson = JSON.parse(
    await readFile(
      new URL('../packages/create-kovo/templates/package.json', import.meta.url),
      'utf8',
    ),
  );
  const appSource = await readFile(
    new URL('../packages/create-kovo/templates/src/app.tsx', import.meta.url),
    'utf8',
  );
  const stylesSource = await readFile(
    new URL('../packages/create-kovo/templates/src/styles.css', import.meta.url),
    'utf8',
  );
  const viteConfigSource = await readFile(
    new URL('../packages/create-kovo/templates/vite.config.ts', import.meta.url),
    'utf8',
  );
  const appCompile = compileComponentModule({ fileName: 'src/app.tsx', source: appSource });

  assertFixpoint(appCompile);
  assertRenderEquivalence(appCompile);
  assert.deepEqual(Object.keys(packageJson.scripts).sort(), [
    'build:prod',
    'check',
    'dev',
    'serve',
    'start',
    'test',
  ]);
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
    '@electric-sql/pglite',
    '@kovojs/better-auth',
    '@kovojs/browser',
    '@kovojs/core',
    '@kovojs/drizzle',
    '@kovojs/server',
    '@kovojs/style',
    '@kovojs/ui',
    'better-auth',
    'drizzle-orm',
  ]);
  assert.deepEqual(Object.keys(packageJson.devDependencies).sort(), [
    '@kovojs/cli',
    '@types/node',
    '@typescript/native-preview',
    'typescript',
    'vite',
    'vite-plus',
    'vitest',
  ]);
  assert.match(viteConfigSource, /kovo\(\{ app: '\/src\/app\.tsx' \}\)/);
  assert.doesNotMatch(viteConfigSource, /\brun\s*:/);
  assert.match(appSource, /createMemoryVersionedClientModuleRegistry/);
  assert.match(appSource, /createRequestHandler/);
  assert.match(appSource, /route\('\/login'/);
  assert.match(appSource, /contactsQuery/);
  assert.match(stylesSource, /@layer kovo-app-base/);

  execFileSync('pnpm', ['exec', 'vitest', '--run', 'packages/create-kovo/src/index.test.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, CI: '1' },
    stdio: 'pipe',
  });
});

void test('P9 verification layer evidence remains represented', async () => {
  const verificationLayerFact = await verificationLayerBehaviorFact({
    createDbVerifier,
    createKovoTestHarness,
    csrfField,
    csrfToken,
    diagnosticDefinitions,
    domain,
    mutation,
    query,
    s,
  });

  assert.ok(
    verificationLayerFact.sqlite.libsqlRowKey === undefined ||
      verificationLayerFact.sqlite.libsqlRowKey === 'id',
  );
  assert.ok(Array.isArray(verificationLayerFact.sqlite.preparedStatementObserved));
  const normalizedVerificationLayerFact = {
    ...verificationLayerFact,
    sqlite: {
      mutationReadCovered: verificationLayerFact.sqlite.mutationReadCovered,
      writeCovered: verificationLayerFact.sqlite.writeCovered,
    },
  };

  assert.deepEqual(normalizedVerificationLayerFact, {
    csrf: {
      invalidResult: {
        error: { code: 'CSRF', payload: {} },
        ok: false,
        status: 422,
      },
      mutationExecutions: 1,
      tokenMatchesField: true,
      validResult: {
        changes: [],
        ok: true,
        rerunQueries: [],
        value: 'p1',
      },
    },
    diagnosticMessages: {
      KV402: 'Write touched an undeclared domain.',
      KV404: 'Write to unmapped table.',
      KV407: 'Query read from undeclared domain.',
      KV408: 'Declared row key differs from observed row predicate.',
      KV410: 'Query result shape failed declared output schema.',
      KV411: 'Query read set includes an exempt table.',
    },
    failures: {
      exemptRawSql: 'KV411 Query read set includes an exempt table: audit_log',
      exemptRead: 'KV411 Query read set includes an exempt table: audit_log',
      invalidOutput:
        'KV410 Query result shape failed declared output schema: product/list Expected string',
      missingNestedRead: 'KV407 Query read from undeclared domain: price, price',
      rowKey:
        'KV408 Declared row key differs from observed row predicate: products expected id observed sku',
      selectSubqueryMissingRead: 'KV407 Query read from undeclared domain: price',
      undeclaredRead: 'KV407 Query read from undeclared domain: product',
      unmappedWrite: 'KV404 Write to unmapped table: unknown_table',
      writeOutsideGraph: 'KV402 Write touched an undeclared domain: audit',
    },
    harness: {
      validOutputQuery: { count: 2 },
      writeMutation: {
        changes: [],
        ok: true,
        rerunQueries: [],
        value: 'p1',
      },
    },
    pglite: {
      rawMutationFailure: 'KV402 Write touched an undeclared domain: audit',
      transactionFailure: 'KV402 Write touched an undeclared domain: audit',
    },
    sqlite: {
      mutationReadCovered: true,
      writeCovered: true,
    },
    sql: {
      compoundRowKeyCovered: true,
      nestedUpdateCovered: true,
      nestedUpdateReadsCovered: true,
      selectSubqueryCoveredWithBothDomains: true,
      structuredStatementForwarded: true,
      structuredStatementObserved: [
        {
          branch: undefined,
          domain: 'cart',
          kind: 'read',
          mutationRead: undefined,
          rowKey: undefined,
          sql: 'select * from cart_items',
          table: 'cart_items',
        },
      ],
    },
    verifier: {
      exemptWriteCovered: true,
    },
  });

  const verificationKovoCheckFact = verificationLayerKovoCheckDiagnosticsFact({
    diagnosticDefinitions,
    kovoCheck,
  });
  assert.deepEqual(verificationKovoCheckFact.verificationDiagnostics, {
    coverage: [],
    diagnostics: [
      {
        code: 'KV410',
        message: diagnosticDefinitions.KV410.message,
        properties: {},
        severity: 'ERROR',
        target: 'cart.queries.ts:5',
      },
      {
        code: 'KV302',
        message: 'data-bind path is not present in the declared query shape. cart.missing',
        properties: {},
        severity: 'ERROR',
        target: 'cart-badge.tsx:3:23',
      },
      {
        code: 'KV405',
        message:
          'Conditional write branch was never executed under instrumentation. domain=product branch=stock-reserve',
        properties: {},
        severity: 'ERROR',
        target: 'cart.domain.ts:2',
      },
      {
        code: 'KV402',
        message: 'Write touched an undeclared domain. domain=audit observed table audit_log',
        properties: {},
        severity: 'ERROR',
        target: 'domain:audit',
      },
      {
        code: 'KV403',
        message: 'Declared domain was never observed written. domain=order',
        properties: {},
        severity: 'WARN',
        target: 'domain:order',
      },
      {
        code: 'KV404',
        message: 'Write to unmapped table. domain=unknown_table observed table unknown_table',
        properties: {},
        severity: 'ERROR',
        target: 'domain:unknown_table',
      },
      {
        code: 'KV407',
        message: 'Query read from undeclared domain. domain=product observed table products',
        properties: {},
        severity: 'ERROR',
        target: 'cart.queries.ts:7',
      },
      {
        code: 'KV408',
        message:
          'Declared row key differs from observed row predicate. domain=product expected id observed sku',
        properties: {},
        severity: 'ERROR',
        target: 'product.domain.ts:9',
      },
      {
        code: 'KV410',
        message:
          'Query result shape failed declared output schema. domain=cart cart Expected number',
        properties: {},
        severity: 'ERROR',
        target: 'cart.queries.ts:11',
      },
    ],
    exitCode: 1,
    status: 'issues',
    version: 'kovo-check/v1',
  });
  assert.deepEqual(verificationKovoCheckFact.exemptTableDiagnostic, {
    coverage: [],
    diagnostics: [
      {
        code: 'KV411',
        message: 'Query read set includes an exempt table.',
        properties: {},
        severity: 'ERROR',
        target: 'cart.queries.ts:9',
      },
    ],
    exitCode: 1,
    status: 'issues',
    version: 'kovo-check/v1',
  });

  assert.deepEqual(
    await enhancedMutationBehaviorFact({
      OptimisticRebaser,
      createQueryStore,
      submitEnhancedMutation,
      submitOptimisticEnhancedMutation,
    }),
    {
      broadcast: {
        events: [
          {
            body: '<kovo-query name="cart" key="cart:c1">{"count":2}</kovo-query>',
            changes: [{ domain: 'cart', keys: ['c1'] }],
          },
        ],
        fetchHeaders: {
          Accept: 'text/vnd.kovo.fragment+html',
          'Kovo-Fragment': 'true',
          'Kovo-Idem': 'idem_change_record',
          'Kovo-Live-Targets': '',
          'Kovo-Targets': '',
        },
        resultChanges: [{ domain: 'cart', keys: ['c1'] }],
        resultQueries: ['cart:c1'],
        storeValue: { count: 2 },
      },
      malformedHeader: {
        errorCount: 1,
        errorMessagePrefixMatches: true,
        resultChanges: [],
        resultQueries: ['cart'],
      },
      optimistic: {
        fetchIdemHeader: 'idem_optimistic_change',
        pendingAfterResponse: null,
        pendingDuringFetch: '',
        resultChanges: [{ domain: 'product', keys: ['p1'] }],
        resultQueries: ['reviews:product:p1'],
        storeAfterResponse: { items: [{ id: 'r1' }, { id: 'server' }] },
        storeDuringFetch: { items: [{ id: 'r1' }, { id: 'draft' }] },
      },
    },
  );
});

void test('P8 component explain includes handler, derive, trigger, and merge facts', async () => {
  const graph = {
    components: [
      {
        attributeMerges: [
          {
            attr: 'aria-expanded',
            decision: 'primitive',
            element: 'button',
            rule: 'primitive-owned',
          },
          {
            attr: 'data-bind:hidden',
            decision: 'diagnostic',
            diagnostics: ['KV233'],
            element: 'button',
            rule: 'single-binding-writer',
          },
        ],
        derives: [
          {
            inputs: ['cart'],
            name: 'CartBadge$isEmpty',
            ref: '/components/cart-badge.js#CartBadge$isEmpty',
            target: 'data-bind:hidden',
          },
        ],
        handlers: [
          {
            captures: ['ctx', 'element-params'],
            event: 'click',
            exportName: 'CartBadge$button_click',
            params: ['itemId'],
            ref: '/components/cart-badge.js#CartBadge$button_click',
          },
        ],
        name: 'CartBadge',
        queries: ['cart'],
        triggers: [
          {
            deps: ['cart'],
            exportName: 'CartBadge$mountChart',
            justification: 'charts are below the fold',
            ref: '/components/cart-badge.js#CartBadge$mountChart',
            trigger: 'visible',
          },
        ],
      },
    ],
    endpoints: [
      {
        auth: 'verifier:stripe-signature',
        csrf: 'exempt',
        csrfJustification: 'stripe-signature',
        method: 'POST',
        name: 'stripe/webhook',
        path: '/webhooks/stripe',
        writes: ['payment'],
      },
      {
        method: 'GET',
        name: 'health',
        path: '/health',
      },
    ],
    mutations: [{ key: 'cart/add', writes: ['cart'] }],
    ownerDomains: [{ domain: 'cart', owner: 'userId' }],
    pages: [{ guards: [], queries: ['cart'], route: '/cart' }],
    queries: [{ domains: ['cart'], guards: [], query: 'cart' }],
    scopeAudits: [
      {
        detail: 'where eq(carts.id, args.cartId)',
        domain: 'cart',
        kind: 'query',
        name: 'cartById',
        scope: 'args',
        site: 'cart.queries.ts:21',
      },
    ],
  };

  assert.deepEqual(
    kovoExplainComponentAssertionFact(
      kovoExplain(graph, { kind: 'component', target: 'CartBadge' }),
    ),
    {
      derives: [
        {
          inputs: ['cart'],
          name: 'CartBadge$isEmpty',
          ref: '/components/cart-badge.js#CartBadge$isEmpty',
          target: 'data-bind:hidden',
        },
      ],
      exitCode: 0,
      fragments: [],
      handlers: [
        {
          captures: ['ctx', 'element-params'],
          event: 'click',
          exportName: 'CartBadge$button_click',
          params: ['itemId'],
          ref: '/components/cart-badge.js#CartBadge$button_click',
          substitution: '-',
        },
      ],
      merges: [
        {
          attr: 'aria-expanded',
          decision: 'primitive',
          diagnostics: [],
          element: 'button',
          rule: 'primitive-owned',
        },
        {
          attr: 'data-bind:hidden',
          decision: 'diagnostic',
          diagnostics: ['KV233'],
          element: 'button',
          rule: 'single-binding-writer',
        },
      ],
      queries: ['cart'],
      subject: 'COMPONENT CartBadge',
      triggers: [
        {
          deps: ['cart'],
          exportName: 'CartBadge$mountChart',
          justification: 'charts are below the fold',
          ref: '/components/cart-badge.js#CartBadge$mountChart',
          trigger: 'visible',
        },
      ],
      version: 'kovo-explain/v1',
    },
  );
  assert.deepEqual(kovoExplainEndpointAssertionFact(kovoExplain(graph, { endpoints: true })), {
    endpoints: [
      {
        auth: '-',
        csrf: 'checked',
        endpoint: 'health',
        method: 'GET',
        mount: 'exact',
        path: '/health',
        writes: [],
      },
      {
        auth: 'verifier:stripe-signature',
        csrf: 'exempt:stripe-signature',
        endpoint: 'stripe/webhook',
        method: 'POST',
        mount: 'exact',
        path: '/webhooks/stripe',
        writes: ['payment'],
      },
    ],
    exitCode: 0,
    subject: 'ENDPOINTS',
    summary: { total: '2' },
    version: 'kovo-explain/v1',
  });
  assert.deepEqual(kovoExplainUnguardedAssertionFact(kovoExplain(graph, { unguarded: true })), {
    exitCode: 0,
    records: [
      {
        fields: {
          auth: '-',
          csrf: 'checked',
          method: 'GET',
          mount: 'exact',
          path: '/health',
        },
        target: 'health',
        targetKind: 'ENDPOINT',
      },
      {
        fields: { guards: [], invalidates: [], 'manual-invalidates': [], writes: ['cart'] },
        target: 'cart/add',
        targetKind: 'MUTATION',
      },
      {
        fields: { guards: [], queries: ['cart'] },
        target: '/cart',
        targetKind: 'PAGE',
      },
      {
        fields: { guards: [], reads: ['cart'] },
        target: 'cart',
        targetKind: 'QUERY',
      },
    ],
    subject: 'UNGUARDED',
    summary: { total: '4' },
    version: 'kovo-explain/v1',
  });
  assert.deepEqual(kovoExplainScopeAuditAssertionFact(kovoExplain(graph, { unscoped: true })), {
    exitCode: 0,
    records: [
      {
        domain: 'cart',
        reason: 'where eq(carts.id, args.cartId)',
        scope: 'args',
        site: 'cart.queries.ts:21',
        target: 'cartById',
        targetKind: 'QUERY',
      },
    ],
    subject: 'UNSCOPED',
    summary: { total: '1' },
    version: 'kovo-explain/v1',
  });
});

void test('P5 data-bind paths are checked against generated query shape facts', async () => {
  const dataBindFact = compilerDataBindBehaviorFact({
    compileComponentModule,
    diagnosticDefinitions,
    queryShapesFromFacts,
  });
  assert.deepEqual(dataBindFact.diagnostics, {
    KV227Help: [
      'Blocked reason: the binding path crosses a nullable query segment without declaring empty-on-null behavior.',
      'Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.',
      'SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.',
    ].join('\n'),
    KV302Message: 'data-bind path is not present in the declared query shape.',
  });
  assert.deepEqual(dataBindFact.queryShapes, {
    cart: {
      count: 'number',
      empty: 'boolean',
      items: [{ name: 'string', productId: 'string', qty: 'number' }],
    },
  });
  assert.deepEqual(dataBindFact.validCartBindingDiagnostics, []);
  assert.deepEqual(dataBindFact.validCartBindingPlans, [
    {
      componentName: 'CartBadge',
      paths: ['cart.count', 'cart.empty', 'cart.items'],
      query: 'cart',
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
  assert.deepEqual(dataBindFact.staleGeneratedShapeDiagnostics, [
    {
      code: 'KV302',
      help: diagnosticDefinitions.KV302.help,
      message: 'data-bind path is not present in the declared query shape. cart.count',
    },
  ]);
  assert.deepEqual(dataBindFact.invalidListStampDiagnostics, [
    {
      code: 'KV302',
      help: diagnosticDefinitions.KV302.help,
      message: 'data-bind path is not present in the declared query shape. cart.items',
    },
  ]);
  assert.deepEqual(dataBindFact.nullableQueryShapes, {
    product: {
      name: 'string',
      review: {
        kind: 'nullable',
        shape: {
          rating: {
            kind: 'nullable',
            shape: 'number',
          },
        },
      },
    },
  });
  assert.deepEqual(dataBindFact.optionalNullablePathDiagnostics, []);
  assert.deepEqual(dataBindFact.unsafeNullablePathDiagnostics, [
    {
      code: 'KV227',
      help: diagnosticDefinitions.KV227.help,
      message:
        'Binding path traverses a nullable segment without ?. product.review.rating (segment: review)',
    },
  ]);
});

void test('S1 production build proves the compiler 1:1 emit contract', async () => {
  const contract = await viteProductionEmitContractFact({
    createPlugin: kovoVitePlugin,
    executeClientModule: executeGeneratedClientModule,
    projectRoot: projectRootPath,
    runtime: generatedModuleRuntime,
  });
  assert.deepEqual(contract.prodEmit, { stderr: '', stdoutLines: ['prod-emit-check/v1', 'OK'] });
  assert.equal(contract.pluginName, 'kovo');
  assert.equal(contract.mapIsNull, true);
  assert.equal(contract.renderedButtonAttrs['data-p-id'], '{product.id}');
  assert.deepEqual(contract.handlerSummary, {
    handlerName: 'ProductCard$button_click',
    modulePath: '/c/routes/products/product-card.client.js',
    versionShape: 'render-plan-hex-16-plus-hash-hex-8',
  });
  assert.deepEqual(contract.middleware, {
    cartEvents: ['p1'],
    contentType: 'text/javascript',
    invocationResult: 'added:p1',
    nextCallsAfterHit: 0,
    nextCallsAfterStale: 1,
    statusCode: 200,
  });
});

void test('D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces', async () => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const fileName = 'routes/diagnostic-card.tsx';
  const componentId = join(projectRoot, fileName);
  const redSource = `
import { component } from '@kovojs/core';

export const DiagnosticCard = component({
  render: () => <button onClick={() => window.alert('x')}>Add</button>,
});
`;
  const greenSource = `
import { component } from '@kovojs/core';

export const DiagnosticCard = component({
  render: () => <button>Add</button>,
});
`;
  const lintSource = `
import { component } from '@kovojs/core';

export const DiagnosticCard = component({
  render: () => <button onClick={() => { const response = { ok: true }; return response.ok; }}>Check</button>,
});
`;
  const assertRedTransformMessage = (message) => {
    const diagnosticFact = viteLoweredEventDiagnosticFact(message);

    assert.equal(diagnosticFact.summary, 'Kovo Vite transform failed with 1 error diagnostic.');
    assert.deepEqual(diagnosticFact.diagnostic, {
      code: 'KV201',
      location: `${fileName}:5:25`,
      message: diagnosticDefinitions.KV201.message,
    });
    assert.deepEqual(diagnosticFact.loweredHandler, {
      handlerName: 'DiagnosticCard$button_click',
      modulePath: '/c/routes/diagnostic-card.client.js',
      versionShape: 'render-plan-hex-16-plus-hash-hex-8',
    });
    assert.deepEqual(
      diagnosticFact.help.map(({ label }) => label),
      [
        'Would lower to',
        'Blocked expression',
        'Element params',
        'Fixes',
        'help',
        'Blocked reason',
        'help',
      ],
    );
    assert.equal(diagnosticFact.sourceExpression, "() => window.alert('x')");
    assert.equal(diagnosticFact.elementParams, '-');
    assert.deepEqual(
      diagnosticFact.help.slice(3),
      diagnosticDefinitions.KV201.help.split('\n').map((line, index) => {
        if (index === 0) return { label: 'Fixes', text: line.replace(/^Fixes:\s+/, '') };
        if (line.startsWith('Blocked reason:')) {
          return { label: 'Blocked reason', text: line.replace(/^Blocked reason:\s+/, '') };
        }
        return { label: 'help', text: line };
      }),
    );
  };
  const expectedStaticExportError = [
    `Static export refused error diagnostic KV201 at ${fileName}:5:25. ${diagnosticDefinitions.KV201.message}`,
    diagnosticDefinitions.KV201.help,
  ].join('\n');
  const expectedStaticExportCliError = expectedStaticExportError.replaceAll('\n', ' ');

  const plugin = kovoVitePlugin();
  const greenTransform = await viteTransformElementFactAsync(plugin, {
    id: componentId,
    selector: { tag: 'button' },
    source: greenSource,
  });
  const greenButtons = greenTransform.elements.map((element) => element.attrs);
  assert.equal(greenTransform.mapIsNull, true);
  assert.deepEqual(greenButtons, [{ 'kovo-c': 'diagnostic-card' }]);

  await assert.rejects(
    async () => plugin.transform(redSource, componentId),
    (error) => {
      assertRedTransformMessage(String(error?.message ?? error));
      return true;
    },
  );

  const lintDiagnostics = [];
  const lintPlugin = kovoVitePlugin({
    onDiagnostic: (diagnostic) => lintDiagnostics.push(diagnostic),
  });
  const lintTransform = await viteHandlerTransformFactAsync(lintPlugin, {
    id: componentId,
    selector: { tag: 'button' },
    source: lintSource,
  });
  const lintButtons = lintTransform.elements.map((element) => element.attrs);
  assert.equal(lintTransform.mapIsNull, true);
  assert.equal(lintButtons.length, 1);
  assert.equal(lintButtons[0]?.['kovo-c'], 'diagnostic-card');
  assert.equal(lintButtons[0]?.['data-p-ok'], undefined);
  assert.deepEqual(lintTransform.handlerSummary, {
    handlerName: 'DiagnosticCard$button_click',
    modulePath: '/c/routes/diagnostic-card.client.js',
    versionShape: 'render-plan-hex-16-plus-hash-hex-8',
  });
  assert.deepEqual(
    lintDiagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      fileName: diagnostic.fileName,
      severity: diagnostic.severity,
    })),
    [{ code: 'KV210', fileName, severity: 'lint' }],
  );

  const buildFixture = await viteRedGreenBuildFixtureFact({
    coreAlias: join(projectRoot, 'dist/core/src/index.mjs'),
    entrypoint: `
import './routes/diagnostic-card';

document.querySelector('#app')!.textContent = 'D10 build green';
`,
    fileName,
    fixtureParent: join(projectRoot, 'examples'),
    fixturePrefix: 'd10-vp-build-',
    greenSource,
    packageName: 'kovo-d10-vp-build-fixture',
    projectRoot,
    redSource,
    vitePluginImportUrl: pathToFileURL(join(projectRoot, 'dist/compiler/src/index.mjs')).href,
    vpExecutable: join(projectRoot, 'node_modules/.bin/vp'),
  });
  assertRedTransformMessage(buildFixture.redOutput);
  assert.deepEqual(buildFixture.greenDistEntries, ['assets', 'index.html']);

  const errorDiagnostic = {
    code: 'KV201',
    fileName,
    help: diagnosticDefinitions.KV201.help,
    message: diagnosticDefinitions.KV201.message,
    start: { column: 25, line: 5 },
  };
  const lintDiagnostic = {
    code: 'KV210',
    fileName,
    message: diagnosticDefinitions.KV210.message,
    start: { column: 25, line: 5 },
  };

  const exportBehavior = await kovoExportStaticBehaviorFact({
    appCoreModuleUrl: pathToFileURL(join(projectRoot, 'dist/server/src/index.mjs')).href,
    createApp,
    errorDiagnostic,
    expectedStaticExportCliError,
    expectedStaticExportError,
    exportStaticApp,
    fixturePrefix: 'kovo-d10-kovo-export-',
    lintDiagnostic,
    runCliCommand,
    serverModuleUrl: pathToFileURL(join(projectRoot, 'dist/server/src/index.mjs')).href,
    serverRoute,
  });
  assert.match(exportBehavior.cli.green.summary?.outDir ?? '', /^".*green-out"$/);
  assert.deepEqual(exportBehavior, {
    api: {
      greenArtifactBodyMatchesDisk: true,
      greenArtifactDiagnostics: 0,
      greenArtifactPath: '/index.html',
      greenMarker: {
        attribute: 'data-kovo-check-export',
        mainCount: 1,
        marker: 'api',
      },
      redArtifactWritten: false,
      redError: {
        code: 'KV201',
        diagnosticCodes: ['KV201'],
        message: expectedStaticExportError,
        name: 'StaticExportError',
      },
    },
    cli: {
      green: {
        errors: [],
        exitCode: 0,
        html: [{ bytesArePositive: true, path: '/index.html', status: 200 }],
        outputStream: 'stdout',
        summary: {
          assets: '0',
          clientModules: '0',
          diagnostics: '0',
          html: '1',
          outDir: exportBehavior.cli.green.summary?.outDir,
        },
        version: 'kovo-export/v1',
      },
      greenMarker: {
        attribute: 'data-kovo-check-export',
        mainCount: 1,
        marker: 'cli',
      },
      red: {
        errors: [
          {
            code: 'KV201',
            message: expectedStaticExportCliError,
            route: fileName,
          },
        ],
        exitCode: 1,
        html: [],
        outputStream: 'stderr',
        version: 'kovo-export/v1',
      },
      redArtifactWritten: false,
    },
  });

  const redMcp = await handleKovoMcpRequest({
    id: 'd10-red',
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      arguments: { fileName, source: redSource },
      name: 'compile_component',
    },
  });
  assert.equal(redMcp.result.version, 'kovo-mcp/v1');
  assert.equal(redMcp.result.structuredContent.version, 'compile/v1');
  assert.equal(redMcp.result.structuredContent.ok, false);
  assert.deepEqual(
    redMcp.result.structuredContent.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
    })),
    [
      { code: 'KV210', severity: 'lint' },
      { code: 'KV201', severity: 'error' },
    ],
  );

  const greenMcp = await handleKovoMcpRequest({
    id: 'd10-green',
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      arguments: { fileName, source: greenSource },
      name: 'compile_component',
    },
  });
  assert.equal(greenMcp.result.structuredContent.ok, true);
  assert.deepEqual(greenMcp.result.structuredContent.diagnostics, []);

  const mcpStdioChunks = [];
  const mcpStdioRequests = [redSource, greenSource]
    .map((source, index) =>
      JSON.stringify({
        id: `d10-stdio-${index}`,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: { fileName, source },
          name: 'compile_component',
        },
      }),
    )
    .join('\n');
  await runMcpFallbackStdio(
    (async function* mcpInput() {
      yield `${mcpStdioRequests}\n`;
    })(),
    { write: (chunk) => mcpStdioChunks.push(chunk) },
  );
  assert.deepEqual(mcpCompileResponseFacts(mcpStdioChunks), [
    {
      contentVersion: 'compile/v1',
      diagnostics: [
        { code: 'KV210', severity: 'lint' },
        { code: 'KV201', severity: 'error' },
      ],
      id: 'd10-stdio-0',
      ok: false,
      version: 'kovo-mcp/v1',
    },
    {
      contentVersion: 'compile/v1',
      diagnostics: [],
      id: 'd10-stdio-1',
      ok: true,
      version: 'kovo-mcp/v1',
    },
  ]);
});
