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
import { diagnosticDefinitions } from '../dist/core/src/index.mjs';
import {
  applyCompiledQueryUpdatePlan,
  applyDeferredStreamResponseToRuntime,
  createQueryStore,
  derive,
  DomMorphTarget,
  installPagehideOptimismCleanup,
  installKovoLoader,
  kovoEscapeHtml,
  kovoLoaderSource,
  morphStructuralTree,
  OptimisticRebaser,
  readElementParams,
  refetchQueries,
  stampPendingQueries,
  submitEnhancedMutation,
  submitOptimisticEnhancedMutation,
} from '../dist/runtime/src/index.mjs';
import { createDbVerifier, createKovoTestHarness } from '../dist/test/src/index.mjs';
import {
  browserSuiteAcceptanceProjectFact,
  commandOutputLines,
  commandSequenceWithoutLast,
  conformanceGateFacts,
  loadVitePlusConfig,
  p10PerfAcceptanceProjectFact,
  runCapturedCliCommand,
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
  graphFixtureFile,
  generatedGraphArtifactAcceptanceProjectFact,
  graphMutationFact,
  graphMutationUpdateConsumers,
  graphOptimisticStatusMatrix,
} from '../packages/conformance-fixtures/src/graph-fixtures.ts';
import { documentQueryScriptBehaviorFact } from '../packages/test/src/html-fragment.ts';
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
import {
  runPnpmFilterTaskCommand,
  starterTemplateAcceptanceFact,
} from '../packages/conformance-fixtures/src/starter-template-fixtures.ts';
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
  viteHandlerTransformFact,
  viteProductionEmitContractFact,
  viteRedGreenBuildFixtureFact,
  viteTransformElementFact,
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
import { createApp } from '../dist/server/src/api/app-shell/core.mjs';
import {
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
  renderDeferredStream,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
  renderDocument,
  renderDocumentQueryScript,
  renderMutationResponse,
  renderMutationEndpointResponse,
  renderPageHints,
  renderQueryScript,
  runMutation,
  runQuery,
  runRoutePage,
  renderRoutePageResponse,
  route as serverRoute,
  session,
  s,
  stylesheetsForTargets,
  t,
  exportStaticApp,
} from '../dist/server/src/index.mjs';
import { fragmentTarget, href, Link, redirect, route } from '../dist/core/src/index.mjs';

const readProjectFile = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const loadProjectWireFixtureSources = () =>
  loadWireFixtureSources(new URL('../fixtures/wire/', import.meta.url));
const execFileAsync = promisify(execFile);

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
  installKovoLoader() {},
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
const starterTemplatePaths = {
  projectRoot: projectRootPath,
  templateRoot: new URL('../packages/create-kovo/templates/', import.meta.url),
};
const starterTemplateKovoOutputs = [
  {
    args: ['check', 'graph.json'],
    output: 'kovo-check/v1\nOK\n',
  },
  {
    args: ['explain', 'query', 'cart', 'graph.json'],
    output:
      'kovo-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge,component:CartPanel,page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
  },
  {
    args: ['explain', 'mutation', 'cart/add', '--optimistic', 'graph.json'],
    output:
      'kovo-explain/v1\nMUTATION cart/add\nguards: authed\nsession: starterSession\ninput-fields: productId,quantity\nwrites: cart\ninvalidates: cart\nmanual-invalidates: -\nupdates: cart->component:CartBadge,component:CartPanel,page:/cart\nOPTIMISTIC cart await-fragment\nOPTIMISTIC-SUMMARY total=1 derived=0 hand-written=0 await-fragment=1 UNHANDLED=0 PUNTED=0\n',
  },
  {
    args: ['explain', 'page', '/cart', 'graph.json'],
    output:
      'kovo-explain/v1\nPAGE /cart\nprefetch: false\nmeta: title=Kovo Starter Cart description=Starter cart backed by query data. image=-\ni18n: en-US:cartTitle\nmodulepreloads: -\nstylesheets: /src/styles.css\nqueries: cart\nview-transitions: -\n',
  },
];

void test('kovo-check wrapper explains the production build prerequisite', () => {
  assert.equal(
    missingBuildMessage('dist/missing-cli.mjs'),
    'kovo-check requires dist/missing-cli.mjs. Run `vp run build` first.',
  );
});

void test('Phase 0 wire fixtures are present and explicit', async () => {
  const fixtureSources = await loadProjectWireFixtureSources();

  assert.deepEqual(
    fixtureSources.map(({ name }) => name),
    [
      'defer-stream.http',
      'enhanced-mutation.http',
      'no-js-post-redirect-get.http',
      'typed-read.http',
      'validation-422-fragment.http',
    ],
  );
  assert.deepEqual(
    wireFixturePresenceFacts(fixtureSources).map((fact) => ({
      hasRequest: fact.requestStartLine.length > 0,
      hasResponse: fact.responseStartLine.length > 0,
      hasTitle: fact.title.length > 0,
      name: fact.name,
    })),
    [
      { hasRequest: true, hasResponse: true, hasTitle: true, name: 'defer-stream.http' },
      { hasRequest: true, hasResponse: true, hasTitle: true, name: 'enhanced-mutation.http' },
      {
        hasRequest: true,
        hasResponse: true,
        hasTitle: true,
        name: 'no-js-post-redirect-get.http',
      },
      { hasRequest: true, hasResponse: true, hasTitle: true, name: 'typed-read.http' },
      {
        hasRequest: true,
        hasResponse: true,
        hasTitle: true,
        name: 'validation-422-fragment.http',
      },
    ],
  );
  assert.deepEqual(
    wireFragmentModeFacts(fixtureSources, [
      'enhanced-mutation.http',
      'validation-422-fragment.http',
    ]),
    [
      {
        accept: 'text/vnd.kovo.fragment+html',
        fragment: 'true',
        name: 'enhanced-mutation.http',
      },
      {
        accept: 'text/vnd.kovo.fragment+html',
        fragment: 'true',
        name: 'validation-422-fragment.http',
      },
    ],
  );
});

void test('Phase 0 wire fixture response bodies match generated contracts byte-for-byte', async () => {
  const fixtureSources = await loadProjectWireFixtureSources();
  assert.deepEqual(
    wireResponseBodyPinFacts(fixtureSources, generatedWireResponseBodies).map(
      ({ matches, name, responseIndex }) => ({
        matches,
        name,
        responseIndex,
      }),
    ),
    [
      { matches: true, name: 'defer-stream.http', responseIndex: 1 },
      { matches: true, name: 'enhanced-mutation.http', responseIndex: 1 },
      { matches: true, name: 'no-js-post-redirect-get.http', responseIndex: 1 },
      { matches: true, name: 'no-js-post-redirect-get.http', responseIndex: 2 },
      { matches: true, name: 'typed-read.http', responseIndex: 1 },
      { matches: true, name: 'validation-422-fragment.http', responseIndex: 1 },
    ],
  );
});

void test('Phase 0 wire fixture responses keep stable protocol metadata', async () => {
  assert.deepEqual(wireResponseMetadataFacts(await loadProjectWireFixtureSources()), [
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
      name: 'defer-stream.http',
      responseIndex: 1,
      statusLine: 'HTTP/1.1 200 OK',
    },
    {
      headers: {
        'content-type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'kovo-changes': '[{"domain":"cart"}]',
        'kovo-idem': 'idem_01HX',
      },
      name: 'enhanced-mutation.http',
      responseIndex: 1,
      statusLine: 'HTTP/1.1 200 OK',
    },
    {
      headers: {
        'cache-control': 'no-store',
        location: '/cart',
      },
      name: 'no-js-post-redirect-get.http',
      responseIndex: 1,
      statusLine: 'HTTP/1.1 303 See Other',
    },
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
      name: 'no-js-post-redirect-get.http',
      responseIndex: 2,
      statusLine: 'HTTP/1.1 200 OK',
    },
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
      name: 'typed-read.http',
      responseIndex: 1,
      statusLine: 'HTTP/1.1 200 OK',
    },
    {
      headers: {
        'content-type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'kovo-idem': 'idem_01HY',
      },
      name: 'validation-422-fragment.http',
      responseIndex: 1,
      statusLine: 'HTTP/1.1 422 Unprocessable Content',
    },
  ]);
});

void test('SSE remains a v2 backlog fixture, not a v1 wire contract', async () => {
  const fixtureSources = await loadProjectWireFixtureSources();

  assert.deepEqual(wireFixtureContentTypesFacts(fixtureSources), [
    { contentTypes: ['text/html; charset=utf-8'], name: 'defer-stream.http' },
    {
      contentTypes: ['text/vnd.kovo.fragment+html; charset=utf-8'],
      name: 'enhanced-mutation.http',
    },
    { contentTypes: [null, 'text/html; charset=utf-8'], name: 'no-js-post-redirect-get.http' },
    { contentTypes: ['text/html; charset=utf-8'], name: 'typed-read.http' },
    {
      contentTypes: ['text/vnd.kovo.fragment+html; charset=utf-8'],
      name: 'validation-422-fragment.http',
    },
  ]);
  assert.deepEqual(wireFixturesWithContentType(fixtureSources, 'text/event-stream'), []);
});

void test('P10 constitution rejects forbidden browser architecture in framework code', async () => {
  const ts = await import('typescript');
  const fact = await forbiddenBrowserArchitectureProjectFact({
    rootPath: projectRootPath,
    ts,
  });
  assert.equal(fact.clean, true);
  assert.equal(fact.checkedFileCount > 100, true);
  assert.deepEqual(fact.violations, []);
});

// SPEC §5.2: post-parse compiler phases must decide from typed model facts/spans, not raw source.
void test('post-parse compiler phases consume model facts, not source strings', async () => {
  const ts = await import('typescript');
  const fact = await postParseSourceStringProjectFact({
    rootPath: projectRootPath,
    ts,
  });
  assert.deepEqual(fact.violations, []);
  assert.equal(fact.clean, true);
  assert.equal(fact.checkedFileCount > 0, true);
});

void test('P10 commerce invalidation is expressed through graph facts', async () => {
  const commerceGraph = await graphFixtureFile(
    projectRootPath,
    'examples/commerce/src/generated/graph.json',
  );
  const cartAddExplain = kovoExplain(commerceGraph, {
    kind: 'mutation',
    optimistic: true,
    target: 'cart/add',
  }).output;

  assert.deepEqual(graphMutationFact(commerceGraph, 'cart/add'), {
    guards: ['authed', 'rateLimit:session'],
    invalidates: ['cart', 'product', 'order'],
    inputFields: ['productId', 'quantity'],
    key: 'cart/add',
    session: 'commerceSession',
    writes: ['cart', 'product', 'order'],
  });
  assert.deepEqual(kovoExplainListField(cartAddExplain, 'manual-invalidates'), []);
  assert.deepEqual(
    kovoExplainUpdateConsumers(cartAddExplain),
    graphMutationUpdateConsumers(commerceGraph, 'cart/add'),
  );
  assert.deepEqual(graphOptimisticStatusMatrix(commerceGraph), {
    'auth/sign-out': {
      cart: 'no-invalidation',
      orderHistory: 'no-invalidation',
      productGrid: 'no-invalidation',
    },
    'cart/add': {
      cart: 'derived',
      orderHistory: 'derived',
      productGrid: 'derived',
    },
    'order/receipt': {
      cart: 'no-invalidation',
      orderHistory: 'no-invalidation',
      productGrid: 'no-invalidation',
    },
  });
});

void test('P10 normative docs cover the constitution and compiler hard rules', async () => {
  const constitution = await readProjectFile('rules/constitution.md');
  const compilerRules = await readProjectFile('rules/compiler-hard-rules.md');
  const openDesignAreas = await readProjectFile('plans/open-design-areas.md');
  const spec = await readProjectFile('SPEC.md');
  const fact = normativeDocsGateFact({
    assertRenderEquivalence,
    collectCssAssetManifest,
    compileComponentModule,
    compilerRules,
    constitution,
    openDesignAreas,
    spec,
  });

  assert.deepEqual(fact.constitutionRuleTitles, [
    'Legibility is load-bearing',
    'Local code must not require global knowledge',
    'Sugar must lower to authorable IR',
    'The wire is the documentation',
    'Server truth always wins',
  ]);
  assert.deepEqual(fact.constitutionTableNumbers, ['1', '2', '3', '4', '5']);
  assert.deepEqual(fact.constitutionTableRuleTitles, [
    'Legibility is load-bearing',
    'No global knowledge at local sites',
    'Sugar must lower to authorable IR',
    'The wire is the documentation',
    'Server truth always wins',
  ]);
  assert.deepEqual(fact.compilerRuleTitles, [
    'Source-derived names',
    '1:1 file mapping',
    'Fixpoint invariant',
    'Platform-behavior emission',
    'Teaching errors',
    'Registry atomicity',
    'TSX-only authoring',
    'Public imports in app source',
    'Post-parse decisions use typed facts, not source strings',
  ]);
  assert.deepEqual(fact.compilerRuleTitles, fact.hardRuleTitlesCovered);
  assert.equal(
    fact.compilerRuleItemsMatchTitles,
    true,
    'compiler hard rules expose one numbered item per parsed title',
  );
  assert.deepEqual(fact.cssContractHeadings, [
    { number: '13.1', title: 'CSS' },
    { number: '13.2', title: 'Lists at scale' },
    { number: '13.3', title: 'Streaming details' },
    { number: '13.4', title: 'Persistent cross-navigation elements' },
    { number: '13.5', title: "Adopt-don't-invent list" },
  ]);
  assert.deepEqual(fact.handlerExports, ['DocCard$choose']);
  assert.equal(fact.renderEquivalenceAsserted, true);
  assert.equal(fact.cssStylesheet.href, '/_kovo/components/docs/doc-card.css');
  assert.deepEqual(fact.cssStylesheet.fragmentTargets, []);
  assert.deepEqual(fact.cssScopeRules, [
    {
      limit: ':scope [kovo-c]',
      raw: '@scope (doc-card) to (:scope [kovo-c]) {',
      scope: 'doc-card',
    },
  ]);
});

void test('P10 legibility study packet is ready but not claimed complete', async () => {
  const study = await readProjectFile('docs/legibility-study.md');
  const fact = legibilityStudyGateFact(study);

  assert.equal(fact.status, 'protocol ready; recruitment, sessions, and results pending');
  assert.equal(fact.requiredParticipants, 'five outside developers who have not worked on Kovo');
  assert.equal(
    fact.passingCriterion,
    'each participant answers every task from browser devtools artifacts alone in under 60 seconds',
  );
  assert.deepEqual(fact.taskNames, [
    'Button behavior',
    'Island data',
    'Mutation effects',
    'Optimism',
    'Failure path',
  ]);
  assert.deepEqual(
    fact.resultFacts.map((row) => row.participant),
    ['pending-1', 'pending-2', 'pending-3', 'pending-4', 'pending-5'],
  );
  for (const row of fact.resultFacts) {
    assert.equal(row.date, 'TBD', `${row.participant} is not dated as a completed study`);
    assert.equal(row.commit, 'TBD', `${row.participant} has no freeze-run commit`);
    assert.equal(row.result, 'pending', `${row.participant} remains pending`);
  }
  assert.deepEqual(fact.issueStatuses, ['pending']);
  assert.deepEqual(fact.readinessStatuses, ['pending', 'pending']);
  assert.deepEqual(fact.localSessionSteps, ['1', '2', '3', '4', '5']);
  assert.equal(fact.localSessionEvidenceComplete, true);
});

void test('P10 v1 acceptance ledger tracks every freeze criterion', async () => {
  const ledger = await readProjectFile('docs/v1-acceptance-ledger.md');
  const rule = await readProjectFile('rules/v1-acceptance.md');
  const fact = v1AcceptanceLedgerGateFact({ ledger, rule });

  assert.deepEqual(fact.gateCriteria, fact.ruleGateCriteria);
  assert.equal(fact.gateCriteriaMatchRule, true);
  assert.equal(
    fact.gateEvidenceArtifacts['16.5 Coverage'],
    'Commerce matrix assertions in examples/commerce/src/app.test.ts and kovo check optimistic output.',
  );
  assert.equal(
    fact.gateEvidenceArtifacts['16.6 Navigation typed'],
    'Commerce route/link/redirect checks plus route-rename proof in packages/runtime/src/index.test.ts.',
  );
  assert.equal(
    fact.gateEvidenceArtifacts['16.8 Update coverage'],
    'KV311/update-coverage graph assertions and kovo check coverage output.',
  );
  assert.equal(fact.gateStatuses['16.2 Legibility'], 'pending external study');
  assert.equal(fact.gateStatuses['Pre-launch'], 'pending external checks');
  assert.deepEqual(fact.runFacts, [
    { command: 'pnpm run acceptance', commit: '5e693a7', result: 'passed' },
    { command: 'pnpm run acceptance', commit: '036e494', result: 'passed' },
    { command: 'pnpm run acceptance', commit: 'ec876f5', result: 'passed' },
    { command: 'pnpm run acceptance', commit: 'TBD at freeze run', result: 'pending' },
  ]);
  assert.deepEqual(
    {
      legibility: fact.auditStatuses['Outside legibility study'],
      prelaunch: fact.auditStatuses['Pre-launch external checks'],
      prelaunchHonesty: fact.auditStatuses['Pre-launch ledger honesty'],
    },
    {
      legibility: 'pending external study',
      prelaunch: 'pending external checks',
      prelaunchHonesty: 'packet ready; external evidence pending',
    },
  );
  assert.ok(fact.runFacts.length >= 4);
  assert.equal(fact.passedAcceptanceRunCount, fact.runFacts.length - 1);
  assert.equal(fact.pendingFreezeRunCount, 1);
  assert.equal(
    fact.localAcceptanceAuditRunCount,
    fact.passedAcceptanceRunCount,
    'each passed local acceptance row has a matching dated audit row',
  );
  assert.equal(
    fact.externalAuditPendingCount,
    2,
    'only the external-evidence blockers are pending audit rows',
  );
  assert.equal(
    fact.localAcceptanceAuditPending,
    false,
    'the pending final clean-checkout run is not claimed as a dated audit row',
  );
  assert.deepEqual(fact.cleanCheckoutStatuses, [
    'pending',
    'pending',
    'pending',
    'pending',
    'pending',
    'pending',
  ]);
});

void test('pre-launch checklist is tracked explicitly', async () => {
  const checklist = await readProjectFile('rules/prelaunch-checklist.md');
  const fact = prelaunchChecklistGateFact(checklist);

  assert.deepEqual(fact.requiredChecks, [
    'Trademark screen',
    'Domain',
    'npm scope',
    'Linguistic screen',
  ]);
  assert.deepEqual(
    Object.keys(fact.evidenceByCheck).toSorted((left, right) => left.localeCompare(right)),
    fact.requiredChecks.toSorted((left, right) => left.localeCompare(right)),
  );
  for (const check of fact.requiredChecks) {
    assert.equal(fact.requiredStatuses[check], 'pending', `${check} remains pending`);
    assert.ok(fact.evidenceByCheck[check], `${check} has a dedicated evidence ledger row`);
  }
  assert.equal(fact.domain, 'kovo.sh');
  assert.equal(fact.scope, '@kovojs');
  assert.deepEqual(fact.evidenceReviewFacts, {
    Domain: { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
    'Linguistic screen': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
    'Trademark screen': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
    'npm scope': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
  });
  assert.deepEqual(
    {
      linguisticMarkets: fact.linguisticMarkets,
      trademarkSources: fact.trademarkSources,
    },
    {
      linguisticMarkets: 'TBD',
      trademarkSources: 'TBD',
    },
  );
  assert.equal(fact.auditStatuses.Codex, 'packet ready; external evidence pending');
  assert.deepEqual(fact.runnableStatuses, ['pending', 'pending', 'pending', 'pending']);
  assert.deepEqual(fact.evidenceStatuses, ['pending', 'pending', 'pending', 'pending']);
  assert.equal(
    fact.auditReadyCount,
    1,
    'packet readiness is recorded separately from external completion',
  );
});

void test('S2 loader budget and inline enhanced form behavior are acceptance evidence', async () => {
  assert.ok(
    gzipSync(kovoLoaderSource).byteLength <= 4096,
    `inline loader gzip size ${gzipSync(kovoLoaderSource).byteLength} exceeds 4096 bytes`,
  );

  const fact = await executeInlineEnhancedFormLoaderFixture(kovoLoaderSource);
  assert.deepEqual(fact.listenerEvents, delegatedLifecycleEvents);
  assert.equal(fact.listenerOptions.click?.capture, true);
  assert.equal(fact.fetchCalls.length, 1);
  assert.deepEqual(fact.fetchCalls[0], {
    body: { kind: 'form-data' },
    headers: {
      Accept: 'text/vnd.kovo.fragment+html',
      'Kovo-Form-Target': '',
      'Kovo-Fragment': 'true',
      'Kovo-Idem': 'idem-inline',
      'Kovo-Targets': 'cart-badge=cart; inventory=inventory stock',
    },
    keepalive: true,
    method: 'POST',
    url: '/_m/cart/add',
  });
  assert.deepEqual(fact.dispatchedQueries, [
    { body: '{"count":1}', key: 'cart:c1', name: 'cart', type: 'kovo:query' },
  ]);
  assert.deepEqual(fact.fragmentHtmlByTarget, { 'cart-badge': '<cart-badge>1</cart-badge>' });
  assert.deepEqual(fact.appendCalls, [['beforeend', '<li>2</li>']]);
});

void test('P2 loader smoke evidence is asserted through runtime behavior', async () => {
  assert.deepEqual(
    await loaderSmokeBehaviorFact({
      applyCompiledQueryUpdatePlan,
      createQueryStore,
      installKovoLoader,
      refetchQueries,
    }),
    {
      appliedTemplateStamps: ['[data-list]'],
      calls: [
        ['load', true],
        ['idle', true],
        ['visible', true],
      ],
      disposedListenerEvents: [],
      initialImportCount: 0,
      listenerEvents: defaultDelegatedEvents,
      listenerOptions: Object.fromEntries(
        delegatedLifecycleEvents.map((event) => [event, { capture: true }]),
      ),
      observer: { observedCount: 1, unobservedCount: 2 },
      reconciledItems: [
        {
          html: '<li>p1:2</li>',
          index: 0,
          key: 'p1',
          value: { id: 'p1', qty: 2 },
        },
      ],
      refetched: [{ fragments: [], queries: ['cart'] }],
      storeValues: {
        cart: { count: 2 },
      },
    },
  );
});

void test('P3 server renders initial query scripts for document-load hydration', async () => {
  const query = {
    key: 'cart:c1',
    name: 'cart',
    value: { html: '</script>' },
  };
  const queryScript =
    '<script type="application/json" kovo-query="cart" key="cart:c1">{"html":"\\u003c/script>"}</script>';
  const document = renderDocument({
    body: '<main></main>',
    queries: [query],
  });
  const fact = documentQueryScriptBehaviorFact(document.html, {
    queryName: 'cart',
    renderedDocumentQueryScript: renderDocumentQueryScript(query),
    renderedQueryScript: renderQueryScript(query),
  });

  assert.deepEqual(fact, {
    bodyElements: [{ attrs: {}, html: '<main></main>', innerHtml: '', tag: 'main' }],
    bodyQueryScripts: [],
    documentQueryScripts: [
      {
        attrs: {
          'data-kovo-csp-hash': 'sha256-RI5k6RX1M0ro0XMCjumAJoDVyEhUT0DexGgN17O9SSY=',
          'kovo-query': 'cart',
          key: 'cart:c1',
          type: 'application/json',
        },
        rawJson: '{"html":"\\u003c/script>"}',
      },
    ],
    headQueryScripts: [
      {
        attrs: {
          'data-kovo-csp-hash': 'sha256-RI5k6RX1M0ro0XMCjumAJoDVyEhUT0DexGgN17O9SSY=',
          'kovo-query': 'cart',
          key: 'cart:c1',
          type: 'application/json',
        },
        rawJson: '{"html":"\\u003c/script>"}',
      },
    ],
    renderedDocumentQueryScript: queryScript,
    renderedQueryScript: queryScript,
  });
});

void test('P2 page hints keep speculation rules opt-in and non-empty', async () => {
  assert.deepEqual(serverPageHintsBehaviorFact({ renderPageHints }), {
    deduplicatedRules: {
      prerender: [{ eagerness: 'moderate', urls: ['/products', '/cart'] }],
    },
    emptyOptInHtml: '',
    renderedHtml:
      '<script type="speculationrules" data-kovo-csp-hash="sha256-VDbRXdVrG1h/HSZeEzeFOKzfY6aegZfd8rNURnGGk4A=">{"prerender":[{"eagerness":"moderate","urls":["/products","/cart"]}]}</script>',
    scriptAttrs: {
      'data-kovo-csp-hash': 'sha256-VDbRXdVrG1h/HSZeEzeFOKzfY6aegZfd8rNURnGGk4A=',
      type: 'speculationrules',
    },
  });
});

void test('P2 compiler merges view transition stamps into existing styles', async () => {
  const result = compileComponentModule({
    fileName: 'components/product-card.tsx',
    source: `
import { component } from '@kovojs/core';

export const ProductCard = component({
  render: () => <img style="opacity: .8" viewTransitionName="product-p1-image" src="/p1.png" />,
});
`,
  });
  assert.deepEqual(result.viewTransitions, [{ name: 'product-p1-image' }]);
  assert.deepEqual(
    await generatedViewTransitionStampBehaviorFact({
      files: result.files,
      registryMemberTypes: generatedRegistryInterfaceMemberTypes(result.files, 'ViewTransitions'),
      viewTransitions: result.viewTransitions,
    }),
    {
      componentAttr: 'product-card',
      jsxPropPreserved: false,
      registryMemberTypes: { 'product-p1-image': 'unknown' },
      src: '/p1.png',
      styledElementCount: 1,
      // SPEC §4.2: identity is emitted explicitly on native hosts (kovo-c).
      style: 'opacity: .8; view-transition-name: product-p1-image',
      viewTransitionNames: ['product-p1-image'],
    },
  );
});

void test('P1 compiler validation facts come from reusable fixture behavior', async () => {
  const fact = compilerValidationBehaviorFact({
    compileComponentModule,
    diagnosticDefinitions,
  });

  assert.deepEqual(fact.diagnostics, {
    KV211: 'on:load eager trigger requires a justification comment.',
    KV212: 'Unknown on:* event or execution trigger name.',
    KV221: 'IDREF references an id not present in component scope.',
    KV224: 'Static id is duplicated in component scope or appears inside a repeatable stamp.',
    KV225: 'JSX nesting violates the HTML content model.',
    KV226: 'kovo-deps or kovo-c names an unknown query instance or component.',
  });
  assert.deepEqual(fact.validIdrefDiagnostics, []);
  assert.deepEqual(fact.validContentModelDiagnostics, []);
  assert.deepEqual(fact.validExecutionTriggerDiagnostics, []);
  assert.deepEqual(fact.validResidualStampDiagnostics, []);
  assert.deepEqual(fact.invalidIdrefDiagnostics, [
    {
      code: 'KV221',
      fileName: 'components/cart/cart-search.tsx',
      help: diagnosticDefinitions.KV221.help,
      message: `${diagnosticDefinitions.KV221.message} missing-label`,
      severity: 'error',
    },
    {
      code: 'KV221',
      fileName: 'components/cart/cart-search.tsx',
      help: diagnosticDefinitions.KV221.help,
      message: `${diagnosticDefinitions.KV221.message} missing-help`,
      severity: 'error',
    },
    {
      code: 'KV221',
      fileName: 'components/cart/cart-search.tsx',
      help: diagnosticDefinitions.KV221.help,
      message: `${diagnosticDefinitions.KV221.message} missing-popover`,
      severity: 'error',
    },
  ]);
  assert.deepEqual(fact.invalidStaticIdDiagnostics, [
    {
      code: 'KV224',
      fileName: 'components/cart/cart-shell.tsx',
      help: diagnosticDefinitions.KV224.help,
      message: `${diagnosticDefinitions.KV224.message} duplicate id="cart-title"`,
      severity: 'error',
    },
    {
      code: 'KV224',
      fileName: 'components/cart/cart-list.tsx',
      help: diagnosticDefinitions.KV224.help,
      message: `${diagnosticDefinitions.KV224.message} repeatable id="cart-row"`,
      severity: 'error',
    },
  ]);
  assert.deepEqual(fact.invalidContentModelDiagnostics, [
    {
      code: 'KV225',
      fileName: 'components/cart/cart-shell.tsx',
      help: diagnosticDefinitions.KV225.help,
      message: `${diagnosticDefinitions.KV225.message} <div> cannot appear inside <p>`,
      severity: 'error',
    },
    {
      code: 'KV225',
      fileName: 'components/cart/cart-shell.tsx',
      help: diagnosticDefinitions.KV225.help,
      message: `${diagnosticDefinitions.KV225.message} <tr> must be inside a table section or table`,
      severity: 'error',
    },
  ]);
  assert.deepEqual(fact.invalidExecutionTriggerDiagnostics, [
    {
      code: 'KV211',
      fileName: 'components/execution-triggers.tsx',
      help: diagnosticDefinitions.KV211.help,
      message: `${diagnosticDefinitions.KV211.message} on:load`,
      severity: 'lint',
    },
    {
      code: 'KV212',
      fileName: 'components/execution-triggers.tsx',
      help: diagnosticDefinitions.KV212.help,
      message: `${diagnosticDefinitions.KV212.message} on:media`,
      severity: 'lint',
    },
  ]);
  assert.deepEqual(fact.invalidResidualStampDiagnostics, [
    {
      code: 'KV226',
      fileName: 'components/recommendations.tsx',
      help: diagnosticDefinitions.KV226.help,
      message: `${diagnosticDefinitions.KV226.message} kovo-c="unknown-component"`,
      severity: 'error',
    },
    {
      code: 'KV226',
      fileName: 'components/recommendations.tsx',
      help: diagnosticDefinitions.KV226.help,
      message: `${diagnosticDefinitions.KV226.message} kovo-deps="missingQuery:p1"`,
      severity: 'error',
    },
  ]);
});

void test('P1 compiler emits KV311 update coverage facts', async () => {
  assert.equal(
    diagnosticDefinitions.KV311.message,
    'Query/state-dependent DOM position has no update status.',
  );
  const result = compileComponentModule({
    fileName: 'components/cart/cart-badge.tsx',
    source: `
import { component } from '@kovojs/core';

export const CartBadge = component({
  queries: { cart: {}, product: {} },
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">{cart.count}</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <span>{renderOnce(cart.currency)}</span>
      <strong className={cart.discount}>Discount</strong>
      <em className={product.name}>Product</em>
    </cart-badge>
  ),
});
`,
  });

  assert.deepEqual(compilerUpdateCoverageFacts(result.updateCoverage), [
    {
      component: 'CartBadge',
      detail: 'data-bind',
      position: 'binding',
      query: 'cart.count',
      status: 'plan',
    },
    {
      component: 'CartBadge',
      detail: 'data-bind:hidden',
      position: 'attribute',
      query: 'cart.empty',
      status: 'plan',
    },
    {
      component: 'CartBadge',
      detail: 'declared renderOnce',
      position: 'expression',
      query: 'cart.currency',
      status: 'renderOnce',
    },
    {
      component: 'CartBadge',
      detail: 'inferred query-backed server refresh target',
      position: 'expression',
      query: 'cart.discount',
      status: 'fragment',
    },
    {
      component: 'CartBadge',
      detail: 'inferred query-backed server refresh target',
      position: 'expression',
      query: 'product.name',
      status: 'fragment',
    },
  ]);
  assert.deepEqual(compilerDiagnosticFacts(result.diagnostics, ['KV311']), []);
  assert.deepEqual(
    kovoCheckAssertionFact(
      kovoCheck({
        updateCoverage: [
          {
            component: 'CartBadge',
            detail: 'text binding',
            position: 'text',
            query: 'cart.count',
            status: 'plan',
          },
          {
            component: 'CartBadge',
            position: 'conditional <dot>',
            query: 'cart.discount',
            status: 'UNHANDLED',
          },
        ],
      }),
    ),
    {
      coverage: [
        {
          properties: {
            component: 'CartBadge',
            detail: 'text binding',
            position: 'text',
            query: 'cart.count',
            status: 'plan',
          },
        },
      ],
      diagnostics: [
        {
          code: 'KV311',
          message: diagnosticDefinitions.KV311.message,
          properties: {
            component: 'CartBadge',
            position: 'conditional <dot>',
            query: 'cart.discount',
          },
          severity: 'WARN',
          target: '',
        },
      ],
      exitCode: 1,
      status: 'issues',
      version: 'kovo-check/v1',
    },
  );
});

void test('P1 compiler validates binding stamp expression drift', async () => {
  assert.equal(
    diagnosticDefinitions.KV222.message,
    'Hand-written binding stamp disagrees with the typed expression it wraps.',
  );
  assert.equal(
    diagnosticDefinitions.KV223.message,
    'Redundant hand-written binding stamp in sugar; the compiler derives it.',
  );
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/cart/cart-badge.tsx',
        source: `
import { component } from '@kovojs/core';

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
      }).diagnostics,
      ['KV223'],
    ),
    [
      {
        code: 'KV223',
        fileName: 'components/cart/cart-badge.tsx',
        help: diagnosticDefinitions.KV223.help,
        message: `${diagnosticDefinitions.KV223.message} data-bind="cart.count" wraps {cart.count}`,
        severity: 'lint',
      },
    ],
  );
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/cart/cart-badge.tsx',
        source: `
import { component } from '@kovojs/core';

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.total}</span>,
});
`,
      }).diagnostics,
      ['KV222'],
    ),
    [
      {
        code: 'KV222',
        fileName: 'components/cart/cart-badge.tsx',
        help: diagnosticDefinitions.KV222.help,
        message: `${diagnosticDefinitions.KV222.message} data-bind="cart.count" wraps {cart.total}`,
        severity: 'error',
      },
    ],
  );
});

void test('P1 compiler validates primitive composition attribute merges', async () => {
  assert.equal(
    diagnosticDefinitions.KV231.message,
    'Unmergeable attribute conflict in primitive composition.',
  );
  assert.equal(
    diagnosticDefinitions.KV232.message,
    'Author overrides a primitive-owned ARIA or state attribute.',
  );
  assert.equal(diagnosticDefinitions.KV233.message, 'Two writers target the same binding slot.');
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/primitive-merge.tsx',
        source: `
import { component } from '@kovojs/core';

export const PrimitiveMerge = component({
  render: () => (
    <primitive-merge>
      <dialog id="drawer"></dialog>
      <dialog id="confirm"></dialog>
      <button commandfor="drawer" commandfor="confirm" data-p-id="one" data-p-id="two" kovo-c="primitive-merge" kovo-c="primitive-merge">Open</button>
      <button aria-expanded="false" aria-expanded="true" role="button" role="link" data-state="closed" data-state="open">Toggle</button>
      <span data-bind="cart.count" data-bind="cart.total" data-bind:hidden="cart.empty" data-bind:hidden="cart.loading">2</span>
    </primitive-merge>
  ),
});
`,
      }).diagnostics,
      ['KV231', 'KV232', 'KV233'],
    ),
    [
      {
        code: 'KV231',
        fileName: 'components/primitive-merge.tsx',
        help: diagnosticDefinitions.KV231.help,
        message: `${diagnosticDefinitions.KV231.message} commandfor`,
        severity: 'error',
      },
      {
        code: 'KV231',
        fileName: 'components/primitive-merge.tsx',
        help: diagnosticDefinitions.KV231.help,
        message: `${diagnosticDefinitions.KV231.message} data-p-id`,
        severity: 'error',
      },
      {
        code: 'KV231',
        fileName: 'components/primitive-merge.tsx',
        help: diagnosticDefinitions.KV231.help,
        message: `${diagnosticDefinitions.KV231.message} kovo-c`,
        severity: 'error',
      },
      {
        code: 'KV232',
        fileName: 'components/primitive-merge.tsx',
        help: diagnosticDefinitions.KV232.help,
        message: `${diagnosticDefinitions.KV232.message} aria-expanded`,
        severity: 'lint',
      },
      {
        code: 'KV232',
        fileName: 'components/primitive-merge.tsx',
        help: diagnosticDefinitions.KV232.help,
        message: `${diagnosticDefinitions.KV232.message} role`,
        severity: 'lint',
      },
      {
        code: 'KV232',
        fileName: 'components/primitive-merge.tsx',
        help: diagnosticDefinitions.KV232.help,
        message: `${diagnosticDefinitions.KV232.message} data-state`,
        severity: 'lint',
      },
      {
        code: 'KV233',
        fileName: 'components/primitive-merge.tsx',
        help: diagnosticDefinitions.KV233.help,
        message: `${diagnosticDefinitions.KV233.message} data-bind`,
        severity: 'error',
      },
      {
        code: 'KV233',
        fileName: 'components/primitive-merge.tsx',
        help: diagnosticDefinitions.KV233.help,
        message: `${diagnosticDefinitions.KV233.message} data-bind:hidden`,
        severity: 'error',
      },
    ],
  );
});

void test('P1 compiler validates fragment-target child hoisting failures', async () => {
  assert.equal(
    diagnosticDefinitions.KV230.message,
    'Fragment-target children cannot lower to a component reference.',
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-row.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartRow = component({
  queries: { cart: {} },
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component({
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{cart.count}</span>
      </CartRow>
    </table>
  ),
});
`,
    }).diagnostics,
    [],
  );
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/cart/cart-row.tsx',
        source: `
import { component } from '@kovojs/core';

export const CartRow = component({
  queries: { cart: {} },
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component({
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{window.location.href}</span>
      </CartRow>
    </table>
  ),
});
`,
      }).diagnostics,
      ['KV230'],
    ),
    [
      {
        code: 'KV230',
        fileName: 'components/cart/cart-row.tsx',
        help: [
          'Would hoist children to: CartRow$slot_children',
          // SECURITY_FINDINGS.md C1: static data-path text children are wrapped in escapeText(...)
          // during lowering, so the blocked-children snippet shows the escaped form.
          'Blocked children: <span>{escapeText(window.location.href)}</span>',
          diagnosticDefinitions.KV230.help,
        ].join('\n'),
        message: `${diagnosticDefinitions.KV230.message} CartRow`,
        severity: 'error',
      },
    ],
  );
});

void test('P3 typed routes validate navigation targets', async () => {
  assert.equal(
    diagnosticDefinitions.KV220.message,
    'Literal href or form action matches no declared route.',
  );
  assert.deepEqual(
    await generatedTypedRouteNavigationBehaviorFact({
      assertRegistryConsumerTypes: assertGeneratedRegistryConsumerTypes,
      compileComponentModule,
      href,
      Link,
      redirect,
      route,
      serverRoute,
    }),
    {
      core: {
        href: '/products/p%201?max=10',
        link: { href: '/products/p1' },
        redirect: { location: '/products/p1', status: 303 },
        route: { path: '/products/:id' },
        serverRoute: { loadType: 'function', path: '/products/:id' },
      },
      generated: {
        diagnostics: [],
        registryConsumerTypesAsserted: true,
        renderedHrefs: ['/products/p%201?max=500', '/cart'],
      },
      invalidDiagnostics: [
        {
          code: 'KV220',
          fileName: 'components/product-links.tsx',
          help: diagnosticDefinitions.KV220.help,
          message: `${diagnosticDefinitions.KV220.message} /product/p1`,
          severity: 'error',
        },
        {
          code: 'KV220',
          fileName: 'components/product-links.tsx',
          help: diagnosticDefinitions.KV220.help,
          message: `${diagnosticDefinitions.KV220.message} /checkout`,
          severity: 'error',
        },
      ],
      provenance: {
        spec: 'SPEC.md section 6.4',
      },
    },
  );
});

void test('P3 mutation lifecycle includes an explicit transaction boundary', async () => {
  assert.deepEqual(await serverMutationLifecycleBehaviorFact(serverMutationRuntime), {
    failedTransaction: {
      events: ['begin', 'handler', 'rollback'],
      result: {
        error: {
          code: 'OUT_OF_STOCK',
          payload: { availableQuantity: 0 },
        },
        ok: false,
        status: 422,
      },
    },
    fragmentResponse: {
      body: '<kovo-query name="cart" key="cart:c1">{"cartId":"c1"}</kovo-query>',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[{"domain":"cart"}]',
      },
      status: 200,
    },
    successfulTransaction: {
      events: ['guard:u1', 'begin:plain', 'handler:tx', 'commit'],
      result: {
        changes: [],
        ok: true,
        rerunQueries: [],
        value: 'p1',
      },
    },
  });
});

void test('P3 server data-plane APIs stay exported and covered', async () => {
  const fact = await serverDataPlaneBehaviorFact(serverDataPlaneRuntime);

  assert.deepEqual(fact.query, {
    endpoint: {
      body:
        '<kovo-query name="product:p1" version="3">' +
        '{"id":"p1","max":3,"userId":"u1"}</kovo-query>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    },
    invalidInput: {
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected string', path: ['id'] }] },
      },
      ok: false,
      status: 422,
    },
    missingRegistryQuery: {
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    },
    success: {
      input: { id: 'p1', max: 10 },
      ok: true,
      value: { id: 'p1', max: 10, userId: 'u1' },
    },
    unauthorized: {
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    },
  });
  assert.deepEqual(fact.route, {
    notFound: {
      body: 'Not Found',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 404,
    },
    success: {
      ok: true,
      value: 'u1:p1:details',
    },
  });
  assert.match(fact.csrf.field, /^<input type="hidden" name="csrf" value="[A-Za-z0-9+/=_-]+">$/);
  assert.deepEqual(
    {
      guardCallsAfterFailure: fact.csrf.guardCallsAfterFailure,
      guardCallsAfterSuccess: fact.csrf.guardCallsAfterSuccess,
      missingToken: fact.csrf.missingToken,
      success: fact.csrf.success,
    },
    {
      guardCallsAfterFailure: 1,
      guardCallsAfterSuccess: 1,
      missingToken: {
        error: { code: 'CSRF', payload: {} },
        ok: false,
        status: 422,
      },
      success: {
        changes: [],
        ok: true,
        rerunQueries: [],
        value: 'p1',
      },
    },
  );
});

void test('P3 route and query guard removal is mechanically audited by kovo check', () => {
  assert.deepEqual(kovoCheckUnguardedAuditBehaviorFact({ kovoCheck }), {
    coverage: [],
    diagnostics: [
      {
        code: 'UNGUARDED',
        message: 'mutation is reachable without an auth guard.',
        properties: {},
        severity: 'WARN',
        target: 'inventory/sync',
      },
      {
        code: 'UNGUARDED',
        message: 'is reachable without an auth guard.',
        properties: {},
        severity: 'WARN',
        target: 'page /admin',
      },
      {
        code: 'UNGUARDED',
        message: 'is reachable without an auth guard.',
        properties: {},
        severity: 'WARN',
        target: 'query adminOrders',
      },
    ],
    exitCode: 0,
    status: 'issues',
    targets: {
      mutation: ['inventory/sync'],
      page: ['/admin'],
      query: ['adminOrders'],
    },
    version: 'kovo-check/v1',
  });
});

void test('P5 morph evidence preserves keyed identity and applies fragments', async () => {
  assert.deepEqual(
    await morphFragmentBehaviorFact({
      applyMutationResponseToDom({ body, root, store }) {
        return submitEnhancedMutation({
          fetch: async () => new Response(body, { status: 200 }),
          form: { action: '/_m/kovo-check-morph', method: 'post' },
          formData: new FormData(),
          idem: 'kovo-check-morph-fixture',
          root: {
            ...root,
            querySelectorAll() {
              return [];
            },
          },
          store,
        });
      },
      createQueryStore,
      morphStructuralTree,
    }),
    {
      appliedFragments: ['products'],
      ignoredMissingTarget: true,
      keyedIdentity: {
        firstItemReusedAfterReorder: true,
        secondItemReusedAtFront: true,
      },
      preservedBrowserState: {
        focused: true,
        scroll: { left: 4, top: 24 },
        selection: { direction: 'forward', end: 3, start: 1 },
      },
      queryStoreValue: { count: 2 },
      renderedTargetHtml:
        '<article kovo-key="p1">Old</article><article kovo-key="p2">New</article>',
      reorderedText: 'Alpha next',
    },
  );
});

void test('D2 commerce validates keyed append and optimistic reorder', async () => {
  const commerceGraph = await graphFixtureFile(
    projectRootPath,
    'examples/commerce/src/generated/graph.json',
  );
  const fact = await commerceKeyedOptimisticBehaviorFact({
    graph: commerceGraph,
    runtime: {
      OptimisticRebaser,
      createQueryStore,
      domain,
      morphStructuralTree,
      mutation,
      query,
      renderMutationEndpointResponse,
      runMutation,
      s,
      submitOptimisticEnhancedMutation,
    },
  });

  assert.deepEqual(fact, {
    graph: {
      componentTargets: [
        { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
        { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
        { fragments: ['order-history'], name: 'OrderHistory', queries: ['orderHistory'] },
      ],
      optimistic: [
        { mutation: 'cart/add', query: 'cart', status: 'derived' },
        { mutation: 'cart/add', query: 'orderHistory', status: 'derived' },
        { mutation: 'cart/add', query: 'productGrid', status: 'derived' },
      ],
    },
    keyedMorph: {
      appendedKeys: ['p1', 'p2', 'p3'],
      firstProductReusedAfterReorder: true,
      reorderedBrowserState: { islandState: { pendingMutation: 'cart/add' } },
      reorderedKeys: ['p3', 'p1', 'p2'],
    },
    mutationEndpoint: {
      body: '',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[{"domain":"product","keys":["p1"]}]',
      },
      result: {
        changes: [{ domain: 'product', input: { productId: 'p1' }, keys: ['p1'] }],
        ok: true,
        rerunQueries: ['productDetail'],
        rerunQueryInstances: [{ instanceKey: 'product:p1', key: 'productDetail' }],
        value: 'p1',
      },
      status: 200,
    },
    optimisticReview: {
      appliedFragments: ['reviews:p1'],
      fetchStoreDuringOptimism: { items: [{ id: 'r1' }, { id: 'draft' }] },
      fragmentHtml: '<section>Reviews ready</section>',
      queries: ['reviews:product:p1'],
      storeAfterResponse: { items: [{ id: 'r1' }, { id: 'server' }] },
    },
  });
});

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
  const commerceGraph = await graphFixtureFile(
    projectRootPath,
    'examples/commerce/src/generated/graph.json',
  );
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
    queries: ['cart', 'productGrid', 'orderHistory'],
    route: '/cart',
    stylesheets: ['/assets/styles.css'],
  });
  assert.deepEqual(fact.graph.receiptMutation, {
    enctype: 'multipart/form-data',
    fileFields: ['receipt'],
    guards: ['authed', 'rateLimit:session'],
    inputFields: ['orderId', 'receipt'],
    key: 'order/receipt',
    session: 'commerceSession',
    writes: ['attachment'],
  });
  assert.deepEqual(fact.pageHints, {
    missingQueryMessage: 'Missing query data for route meta: cart',
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
  const commerceGraph = await graphFixtureFile(
    projectRootPath,
    'examples/commerce/src/generated/graph.json',
  );
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
    consumers: ['component:CartBadge', 'page:/cart'],
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
      { consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' },
      { consumers: ['component:OrderHistory', 'page:/cart'], query: 'orderHistory' },
      { consumers: ['component:ProductGrid', 'page:/cart'], query: 'productGrid' },
    ],
    version: 'kovo-explain/v1',
    writes: ['cart', 'product', 'order'],
  });
  assert.deepEqual(fact.orderReceiptExplain, {
    enctype: 'multipart/form-data',
    exitCode: 0,
    fileFields: ['receipt'],
    guards: ['authed', 'rateLimit:session'],
    inputFields: ['orderId', 'receipt'],
    invalidates: [],
    manualInvalidates: [],
    optimisticSummary: {
      PUNTED: '0',
      UNHANDLED: '0',
      'await-fragment': '0',
      derived: '0',
      'hand-written': '0',
      total: '0',
    },
    session: 'commerceSession',
    subject: 'MUTATION order/receipt',
    updateConsumers: [],
    version: 'kovo-explain/v1',
    writes: ['attachment'],
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
      { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
      { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
      { fragments: ['order-history'], name: 'OrderHistory', queries: ['orderHistory'] },
    ],
    domains: ['attachment', 'auth', 'cart', 'order', 'product'],
    invalidations: {
      'cart/add': ['cart', 'orderHistory', 'productGrid'],
    },
    mutations: ['auth/sign-out', 'cart/add', 'order/receipt'],
    optimistic: [
      { mutation: 'cart/add', query: 'cart', status: 'derived' },
      { mutation: 'cart/add', query: 'orderHistory', status: 'derived' },
      { mutation: 'cart/add', query: 'productGrid', status: 'derived' },
    ],
    routes: ['/admin', '/cart'],
    touchGraphKeys: ['cart.addItem', 'order.receipt', 'payment.webhook'],
  });
  assert.deepEqual(fact.componentGraphFacts, [
    {
      domName: 'cart-badge',
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
  assert.deepEqual(fact.touchGraphKeys, ['cart.addItem', 'order.receipt', 'payment.webhook']);
});

void test('P10 starter wires graph assertions into CI', async () => {
  const starterAcceptance = await starterTemplateAcceptanceFact({
    assertFixpoint,
    assertRenderEquivalence,
    compileComponentModule,
    expectedDevDependencies: [
      '@kovojs/compiler',
      '@types/node',
      '@typescript/native-preview',
      'kovo',
      'typescript',
      'vite',
      'vite-plus',
      'vitest',
    ],
    kovoCheck,
    kovoExplain,
    kovoOutputs: starterTemplateKovoOutputs,
    ...starterTemplatePaths,
  });

  assert.deepEqual(starterAcceptance.package, {
    dependencies: [
      '@kovojs/better-auth',
      '@kovojs/core',
      '@kovojs/runtime',
      '@kovojs/server',
      '@kovojs/style',
    ],
    scripts: {
      emitGraph: 'node scripts/emit-graph.mjs',
      kovoCheck: undefined,
      graphAssertions: undefined,
    },
  });
  assert.deepEqual(starterAcceptance.devDependencyCoverage, {
    expected: [
      '@kovojs/compiler',
      '@types/node',
      '@typescript/native-preview',
      'kovo',
      'typescript',
      'vite',
      'vite-plus',
      'vitest',
    ],
    missing: [],
    present: [
      '@kovojs/compiler',
      '@types/node',
      '@typescript/native-preview',
      'kovo',
      'typescript',
      'vite',
      'vite-plus',
      'vitest',
    ],
  });
  assert.deepEqual(starterAcceptance.graphCheck, {
    exitCode: 0,
    issueCount: 0,
    status: 'ok',
    version: 'kovo-check/v1',
  });
  assert.deepEqual(starterAcceptance.graph.components, ['CartBadge', 'CartPanel']);
  assert.deepEqual(starterAcceptance.graph.mutations, [
    {
      guards: ['authed'],
      invalidates: ['cart'],
      inputFields: ['productId', 'quantity'],
      key: 'cart/add',
      session: 'starterSession',
      writes: ['cart'],
    },
  ]);
  assert.deepEqual(starterAcceptance.graph.optimistic, [
    { mutation: 'cart/add', query: 'cart', status: 'await-fragment' },
  ]);
  assert.deepEqual(starterAcceptance.graph.pages, [
    {
      i18n: ['en-US:cartTitle'],
      meta: {
        description: 'Starter cart backed by query data.',
        title: 'Kovo Starter Cart',
      },
      queries: ['cart'],
      route: '/cart',
      stylesheets: ['/src/styles.css'],
    },
  ]);
  assert.deepEqual(starterAcceptance.graph.queries, [{ domains: ['cart'], query: 'cart' }]);
  assert.deepEqual(starterAcceptance.graph.touchGraphSites['cart.addItem'], [
    { domain: 'cart', keys: null, site: 'src/cart.ts:12', via: 'cart_items' },
  ]);
  assert.deepEqual(starterAcceptance.explain.cartQuery, {
    consumers: ['component:CartBadge', 'component:CartPanel', 'page:/cart'],
    domainWrites: ['cart.addItem'],
    exitCode: 0,
    invalidatedBy: ['cart/add'],
    reads: ['cart'],
    subject: 'QUERY cart',
    version: 'kovo-explain/v1',
  });
  assert.deepEqual(starterAcceptance.explain.cartAdd, {
    exitCode: 0,
    guards: ['authed'],
    inputFields: ['productId', 'quantity'],
    invalidates: ['cart'],
    manualInvalidates: [],
    optimisticStatuses: { cart: 'await-fragment' },
    optimisticSummary: {
      PUNTED: '0',
      UNHANDLED: '0',
      'await-fragment': '1',
      derived: '0',
      'hand-written': '0',
      total: '1',
    },
    session: 'starterSession',
    subject: 'MUTATION cart/add',
    updateConsumers: [
      { consumers: ['component:CartBadge', 'component:CartPanel', 'page:/cart'], query: 'cart' },
    ],
    version: 'kovo-explain/v1',
    writes: ['cart'],
  });
  assert.deepEqual(starterAcceptance.explain.cartPage, {
    exitCode: 0,
    i18n: ['en-US:cartTitle'],
    meta: 'title=Kovo Starter Cart description=Starter cart backed by query data. image=-',
    modulepreloads: [],
    prefetch: 'false',
    queries: ['cart'],
    stylesheets: ['/src/styles.css'],
    subject: 'PAGE /cart',
    version: 'kovo-explain/v1',
    viewTransitions: [],
  });

  assert.deepEqual(starterAcceptance.tasks.kovoCheck, {
    input: [
      { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
      { pattern: 'src/**/*', base: 'workspace' },
    ],
    output: ['graph.json'],
  });
  assert.deepEqual(starterAcceptance.tasks.graphAssertions, {
    input: [
      { pattern: 'graph.json', base: 'workspace' },
      { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
      { pattern: 'scripts/graph-assertions.mjs', base: 'workspace' },
      { pattern: 'src/**/*', base: 'workspace' },
    ],
    output: undefined,
  });
  assert.deepEqual(starterAcceptance.ciRunCommands, [
    'vp install',
    'vp check',
    'vp test',
    'vp run build',
    'vp run kovo-check',
    'vp run graph-assertions',
  ]);
  assert.deepEqual(
    starterAcceptance.taskOutputs.map((taskOutput) => taskOutput.output),
    ['emit-graph/v1\nOK\nkovo-check/v1\nOK\n', 'emit-graph/v1\nOK\ngraph-assertions/v1\nOK\n'],
  );
  assert.deepEqual(
    starterAcceptance.taskOutputs.map((taskOutput) => taskOutput.graph),
    [starterAcceptance.emittedGraph.graph, starterAcceptance.emittedGraph.graph],
  );

  assert.equal(starterAcceptance.emittedGraph.output, 'emit-graph/v1\nOK\n');
  assert.equal(starterAcceptance.graphAssertionsOutput, 'graph-assertions/v1\nOK\n');
  assert.deepEqual(starterAcceptance.appCompile, {
    fixpointAsserted: true,
    renderEquivalenceAsserted: true,
  });
  assert.deepEqual(starterAcceptance.browserClient, {
    appendedHtml: [['beforeend', '<li>p1</li>']],
    deferredApplication: {
      body: '<kovo-fragment></kovo-fragment>',
      boundary: 'starter-boundary',
      morph: 'structural',
      queryPlansMatch: true,
      rootMatches: true,
      storeMatches: true,
    },
    deferredApplied: true,
    fetchCall: {
      body: 'productId=p1',
      headers: { Accept: 'text/vnd.kovo.fragment+html' },
      keepalive: true,
      method: 'POST',
      url: '/_m/cart/add',
    },
    fetchOk: true,
    fragmentHtml: {
      afterReplace: '<cart-badge>1</cart-badge>',
      beforeReplace: '<cart-badge>0</cart-badge>',
    },
    loader: {
      enhancedMutationStoreMatches: true,
      hasEnhancedFetch: true,
      hasImportModule: true,
      queryPlansType: 'object',
      queryStoreMatches: true,
      rootMatches: true,
    },
    loaderInstallCount: 1,
  });

  assert.deepEqual(starterAcceptance.cssLayers, ['kovo-starter-base']);
  assert.deepEqual(starterAcceptance.html.tags, [
    'html',
    'head',
    'meta',
    'meta',
    'link',
    'title',
    'body',
  ]);
  assert.deepEqual(starterAcceptance.html.htmlAttrs, { lang: 'en' });
  assert.deepEqual(starterAcceptance.html.metaAttrs, [
    { charset: 'UTF-8' },
    { content: 'width=device-width, initial-scale=1.0', name: 'viewport' },
  ]);
  assert.deepEqual(starterAcceptance.html.linkAttrs, [
    { rel: 'stylesheet', href: '/src/styles.css' },
  ]);
  assert.deepEqual(starterAcceptance.html.scriptAttrs, []);

  execFileSync('pnpm', ['exec', 'vitest', '--run', 'packages/create-kovo/src/index.test.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, CI: '1' },
    stdio: 'pipe',
  });
});

void test('P9 verification layer evidence remains represented', async () => {
  assert.deepEqual(
    await verificationLayerBehaviorFact({
      createDbVerifier,
      createKovoTestHarness,
      csrfField,
      csrfToken,
      diagnosticDefinitions,
      domain,
      mutation,
      query,
      s,
    }),
    {
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
    },
  );

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
        severity: 'WARN',
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
    versionShape: 'lower-hex-8',
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
      versionShape: 'lower-hex-8',
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
  const greenTransform = viteTransformElementFact(plugin, {
    id: componentId,
    selector: { tag: 'button' },
    source: greenSource,
  });
  const greenButtons = greenTransform.elements.map((element) => element.attrs);
  assert.equal(greenTransform.mapIsNull, true);
  assert.deepEqual(greenButtons, [{ 'kovo-c': 'diagnostic-card' }]);

  assert.throws(
    () => plugin.transform(redSource, componentId),
    (error) => {
      assertRedTransformMessage(String(error?.message ?? error));
      return true;
    },
  );

  const lintDiagnostics = [];
  const lintPlugin = kovoVitePlugin({
    onDiagnostic: (diagnostic) => lintDiagnostics.push(diagnostic),
  });
  const lintTransform = viteHandlerTransformFact(lintPlugin, {
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
    versionShape: 'lower-hex-8',
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
    appCoreModuleUrl: pathToFileURL(join(projectRoot, 'dist/server/src/api/app-shell/core.mjs'))
      .href,
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

void test('P3 Drizzle query facts include select shapes and instance keys', async () => {
  let drizzle;
  try {
    drizzle = await import('../packages/drizzle/src/static.ts');
  } catch (error) {
    const importFailureFact = moduleImportFailureFact(error, [
      '__filename is not defined in ES module scope',
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
      fragments: ['cart-row/cart-row'],
      name: 'cart-row/cart-row',
      queries: ['cart'],
    },
  ]);
  await assertGeneratedRegistryConsumerTypes(
    result.files,
    `
import { fragmentTarget } from '@kovojs/core';

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
    status: 'issues',
    version: 'kovo-check/v1',
  });
});

void test('P4 commerce touch graph is a committed generated artifact', async () => {
  const commerceAcceptance = await generatedGraphArtifactAcceptanceProjectFact({
    artifactPath: 'examples/commerce/src/generated/graph.json',
    emitCheck: {
      args: ['scripts/emit-graph.mjs', '--check'],
      command: 'node',
      cwd: join(projectRootPath, 'examples/commerce'),
      env: { ...process.env, CI: '1' },
    },
    kovoCheck,
    rootPath: projectRootPath,
  });
  assert.deepEqual(commerceAcceptance.emitCheck, { stderr: '', stdout: '' });
  assert.deepEqual(commerceAcceptance.checklist, {
    emitCheckClean: true,
    kovoCheckOk: true,
    invalidationKeys: ['cart/add'],
    staticBehavior: {
      components: [
        { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
        { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
        { fragments: ['order-history'], name: 'OrderHistory', queries: ['orderHistory'] },
      ],
      domains: ['attachment', 'auth', 'cart', 'order', 'product'],
      invalidations: {
        'cart/add': ['cart', 'orderHistory', 'productGrid'],
      },
      mutations: ['auth/sign-out', 'cart/add', 'order/receipt'],
      optimistic: [
        { mutation: 'cart/add', query: 'cart', status: 'derived' },
        { mutation: 'cart/add', query: 'orderHistory', status: 'derived' },
        { mutation: 'cart/add', query: 'productGrid', status: 'derived' },
      ],
      routes: ['/admin', '/cart'],
      touchGraphKeys: ['cart.addItem', 'order.receipt', 'payment.webhook'],
    },
    touchGraph: {
      entryKeys: ['cart.addItem', 'order.receipt', 'payment.webhook'],
      sourceLineMismatchCount: 0,
      sourceSitePaths: ['examples/commerce/src/app.ts'],
      sourceSitesHavePositiveLines: true,
      touchCountsByMutation: {
        'cart.addItem': 3,
        'order.receipt': 1,
        'payment.webhook': 1,
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
        disabled: 'false',
        hidden: 'false',
      },
      deriveText: 'false',
      orderedApply: {
        order: ['derive-after-binding:6', 'stamp-after-derive:items:1'],
        stampValue: 'true',
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
      appliedFragments: ['reviews', 'summary', 'reviews'],
      chunkFragments: [
        [{ html: '<article>B</article>', mode: 'append', target: 'reviews' }],
        [
          { html: '<section>Replace</section>', target: 'summary' },
          { html: '<article>A</article>', mode: 'append', target: 'reviews' },
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
      include: ['packages/runtime/src/**/*.browser.test.ts'],
      providerPackage: '@vitest/browser-playwright',
    },
    inputFacts: [
      { auto: true },
      { base: 'workspace', pattern: 'vitest.browser.config.ts' },
      { base: 'workspace', pattern: 'tests/browser-acceptance.mjs' },
      { base: 'workspace', pattern: 'packages/runtime/src/**/*.browser.test.ts' },
    ],
    presentInAcceptance: true,
    presentInCi: true,
    scriptName: 'test:browser',
    taskName: 'browser',
  });
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
