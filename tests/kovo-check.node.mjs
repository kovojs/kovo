// Project-level kovo-check suite. `scripts/kovo-check.mjs` can run this file alone
// in CI or alongside the other suite files for the local aggregate gate.
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
import {
  inlineKovoLoaderInstallerSource,
  kovoLoaderSource,
  refetchQueries,
} from '../dist/browser/src/internal/inline-loader.mjs';
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
        'cache-control': 'private, no-store',
        'content-type': 'text/html; charset=utf-8',
        vary: 'Cookie',
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
  const commerceGraph = commerceGraphFixture();
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
  assert.deepEqual(fact.hardRuleTitlesCovered, [
    ...fact.compilerRuleTitles,
    'Output safety is contextual and default-on',
    'Inputs (mandatory)',
    'Stamping points (mandatory)',
    'Comparison (mandatory, server and client)',
  ]);
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
    'Commerce route/link/redirect checks plus route-rename proof in packages/browser/src/index.test.ts.',
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
    gzipSync(kovoLoaderSource).byteLength <= 8192,
    `inline loader gzip size ${gzipSync(kovoLoaderSource).byteLength} exceeds 8192 bytes`,
  );

  const fact = await executeInlineEnhancedFormLoaderFixture(
    `(${inlineKovoLoaderInstallerSource})((url)=>import(url));`,
  );
  assert.deepEqual(fact.listenerEvents, [...delegatedLifecycleEvents, 'popstate']);
  assert.equal(fact.listenerOptions.click?.capture, true);
  assert.equal(fact.fetchCalls.length, 1);
  assert.deepEqual(fact.fetchCalls[0], {
    body: { kind: 'form-data' },
    headers: {
      Accept: 'text/vnd.kovo.fragment+html',
      'Kovo-Form-Target': '',
      'Kovo-Fragment': 'true',
      'Kovo-Idem': 'idem-inline',
      'Kovo-Live-Targets': 'cart-badge#cart-badge:{}; inventory#inventory:{}',
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
      optimisticProofs: [],
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
        '<kovo-query name="productDetail" key="product:p1" version="3">' +
        '{"id":"p1","max":3,"userId":"u1"}</kovo-query>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
      },
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
    optimisticProofs: [],
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
  const commerceGraph = commerceGraphFixture();
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
