import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

import { missingBuildMessage } from '../scripts/fw-check.mjs';
import {
  fwCheck,
  fwExplain,
  handleFwMcpRequest,
  mainAsync,
  runMcpFallbackStdio,
} from '../dist/cli/src/index.mjs';
import {
  assertFixpoint,
  assertRenderEquivalence,
  collectCssAssetManifest,
  collectMinifierReservedNames,
  compileComponentModule,
  deriveAppGraph,
  emitQueryPlanBootstrapModule,
  jisoVitePlugin,
  queryShapesFromFacts,
} from '../dist/compiler/src/index.mjs';
import { diagnosticDefinitions } from '../dist/core/src/index.mjs';
import {
  applyMutationResponseToDom,
  applyCompiledQueryUpdatePlan,
  applyDeferredStreamResponseToRuntime,
  createQueryStore,
  derive,
  installPagehideOptimismCleanup,
  installJisoLoader,
  jisoLoaderSource,
  morphStructuralTree,
  OptimisticRebaser,
  readElementParams,
  refetchQueries,
  stampPendingQueries,
  submitEnhancedMutation,
  submitOptimisticEnhancedMutation,
} from '../dist/runtime/src/index.mjs';
import { createDbVerifier, createJisoTestHarness } from '../dist/test/src/index.mjs';
import {
  browserSuiteAcceptanceProjectFact,
  commandOutputLines,
  commandSequenceWithoutLast,
  conformanceGateFacts,
  loadVitePlusConfig,
  p10PerfAcceptanceProjectFact,
} from '../packages/test/src/command-fixtures.ts';
import {
  compilerDataBindBehaviorFact,
  compilerDiagnosticFacts,
  compilerQueryUpdatePlanFacts,
  compilerUpdateCoverageFacts,
  compilerValidationBehaviorFact,
} from '../packages/test/src/compiler-fixtures.ts';
import { viteLoweredEventDiagnosticFact } from '../packages/test/src/diagnostic-output-fixtures.ts';
import {
  fwExplainComponentAssertionFact,
  fwExplainEndpointAssertionFact,
  fwExplainListField,
  fwExplainMutationAssertionFact,
  fwExplainQueryAssertionFact,
  fwExplainScopeAuditAssertionFact,
  fwExplainUnguardedAssertionFact,
  fwExplainUpdateConsumers,
} from '../packages/test/src/fw-explain-fixtures.ts';
import {
  fwCheckAssertionFact,
  fwCheckCoverageAssertionFacts,
  fwCheckDiagnosticAssertionFacts,
  fwCheckOkAssertionFact,
} from '../packages/test/src/fw-check-fixtures.ts';
import { fwExportStaticBehaviorFact } from '../packages/test/src/fw-export-fixtures.ts';
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
} from '../packages/test/src/generated-module-fixtures.ts';
import {
  graphComponentTargetFacts,
  graphFixtureFile,
  generatedGraphArtifactAcceptanceProjectFact,
  graphMutationFact,
  graphOptimisticFacts,
  graphMutationUpdateConsumers,
  graphOptimisticStatusMatrix,
  graphStaticBehaviorFact,
  graphTouchGraphKeys,
} from '../packages/test/src/graph-fixtures.ts';
import {
  documentQueryScriptBehaviorFact,
  htmlElementFacts,
} from '../packages/test/src/html-fragment.ts';
import {
  legibilityStudyGateFact,
  normativeDocsGateFact,
  prelaunchChecklistGateFact,
  v1AcceptanceLedgerGateFact,
} from '../packages/test/src/markdown-fixtures.ts';
import { mcpCompileResponseFacts } from '../packages/test/src/mcp-fixtures.ts';
import {
  drizzleQueryBehaviorSourceFixtures,
  forbiddenBrowserArchitectureFacts,
  moduleImportFailureFact,
  projectQueryBehaviorFacts,
  projectQueryDiagnosticFacts,
  projectTouchGraphBehaviorFacts,
  projectFileSources,
  projectJsonFile,
  projectPackageManifestFacts,
} from '../packages/test/src/source-fixtures.ts';
import {
  runPnpmFilterTaskCommand,
  starterTemplateAcceptanceFact,
} from '../packages/test/src/starter-template-fixtures.ts';
import {
  enhancedMutationBehaviorFact,
  loaderSmokeBehaviorFact,
  morphFragmentBehaviorFact,
  optimismCleanupBehaviorFact,
} from '../packages/test/src/runtime-fixtures.ts';
import {
  viteHandlerTransformFact,
  viteProductionEmitContractFact,
  viteRedGreenBuildFixtureFact,
  viteTransformElementFact,
} from '../packages/test/src/vite-fixtures.ts';
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
} from '../packages/test/src/wire-fixtures.ts';
import { verificationLayerBehaviorFact } from '../packages/test/src/verification-fixtures.ts';
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

const runCliCommand = async (args) => {
  let stdout = '';
  let stderr = '';
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = function writeStdout(chunk) {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = function writeStderr(chunk) {
    stderr += String(chunk);
    return true;
  };

  try {
    const exitCode = await mainAsync(args);
    return { exitCode, stderr, stdout };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
};

const generatedModuleRuntime = {
  applyCompiledQueryUpdatePlan,
  applyDeferredStreamResponseToDom: applyDeferredStreamResponseToRuntime,
  createQueryStore,
  derive,
  handler: (callback) => (event, ctx) => callback(event, ctx),
  installJisoLoader,
};

const generatedBootstrapRuntime = {
  ...generatedModuleRuntime,
  installJisoLoader() {},
};

const loadProjectVitePlusConfig = async (configPath = 'vite.config.ts') =>
  loadVitePlusConfig(await readProjectFile(configPath));

const projectRootPath = fileURLToPath(new URL('..', import.meta.url));
const starterTemplatePaths = {
  projectRoot: projectRootPath,
  templateRoot: new URL('../packages/create-jiso/templates/', import.meta.url),
};
const starterTemplateFwOutputs = [
  {
    args: ['check', 'graph.json'],
    output: 'fw-check/v1\nOK\n',
  },
  {
    args: ['explain', 'query', 'cart', 'graph.json'],
    output:
      'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge,component:CartPanel,page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
  },
  {
    args: ['explain', 'mutation', 'cart/add', '--optimistic', 'graph.json'],
    output:
      'fw-explain/v1\nMUTATION cart/add\nguards: authed\nsession: starterSession\ninput-fields: productId,quantity\nwrites: cart\ninvalidates: cart\nmanual-invalidates: -\nupdates: cart->component:CartBadge,component:CartPanel,page:/cart\nOPTIMISTIC cart await-fragment\nOPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=1 UNHANDLED=0\n',
  },
  {
    args: ['explain', 'page', '/cart', 'graph.json'],
    output:
      'fw-explain/v1\nPAGE /cart\nprefetch: false\nmeta: title=Jiso Starter Cart description=Starter cart backed by query data. image=-\ni18n: en-US:cartTitle\nmodulepreloads: -\nstylesheets: /src/styles.css\nqueries: cart\nview-transitions: -\n',
  },
];

void test('fw-check wrapper explains the production build prerequisite', () => {
  assert.equal(
    missingBuildMessage('dist/missing-cli.mjs'),
    'fw-check requires dist/missing-cli.mjs. Run `vp run build` first.',
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
        accept: 'text/vnd.jiso.fragment+html',
        fragment: 'true',
        name: 'enhanced-mutation.http',
      },
      {
        accept: 'text/vnd.jiso.fragment+html',
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
        'content-type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'fw-changes': '[{"domain":"cart"}]',
        'fw-idem': 'idem_01HX',
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
        'content-type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'fw-idem': 'idem_01HY',
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
      contentTypes: ['text/vnd.jiso.fragment+html; charset=utf-8'],
      name: 'enhanced-mutation.http',
    },
    { contentTypes: [null, 'text/html; charset=utf-8'], name: 'no-js-post-redirect-get.http' },
    { contentTypes: ['text/html; charset=utf-8'], name: 'typed-read.http' },
    {
      contentTypes: ['text/vnd.jiso.fragment+html; charset=utf-8'],
      name: 'validation-422-fragment.http',
    },
  ]);
  assert.deepEqual(wireFixturesWithContentType(fixtureSources, 'text/event-stream'), []);
});

void test('P10 constitution rejects forbidden browser architecture in framework code', async () => {
  const ts = await import('typescript');
  const sources = await projectFileSources({
    rootPath: projectRootPath,
    directory: 'packages',
    include: (path) => path.endsWith('.ts') && path.includes('/src/') && !path.endsWith('.test.ts'),
  });
  const violations = [];

  for (const { path, source } of sources) {
    violations.push(...forbiddenBrowserArchitectureFacts(ts, path, source));
  }

  assert.deepEqual(violations, []);
});

void test('P10 commerce invalidation is expressed through graph facts', async () => {
  const commerceGraph = await graphFixtureFile(
    projectRootPath,
    'examples/commerce/src/generated/graph.json',
  );
  const cartAddExplain = fwExplain(commerceGraph, {
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
  assert.deepEqual(fwExplainListField(cartAddExplain, 'manual-invalidates'), []);
  assert.deepEqual(
    fwExplainUpdateConsumers(cartAddExplain),
    graphMutationUpdateConsumers(commerceGraph, 'cart/add'),
  );
  assert.deepEqual(graphOptimisticStatusMatrix(commerceGraph), {
    'auth/sign-out': {
      cart: 'no-invalidation',
      orderHistory: 'no-invalidation',
      productGrid: 'no-invalidation',
    },
    'cart/add': {
      cart: 'hand-written',
      orderHistory: 'await-fragment',
      productGrid: 'await-fragment',
    },
    'order/receipt': {
      cart: 'no-invalidation',
      orderHistory: 'no-invalidation',
      productGrid: 'no-invalidation',
    },
  });
});

void test('P10 normative docs cover the constitution and compiler hard rules', async () => {
  const constitution = await readProjectFile('docs/constitution.md');
  const compilerRules = await readProjectFile('docs/compiler-hard-rules.md');
  const spec = await readProjectFile('SPEC.md');
  const fact = normativeDocsGateFact({
    assertRenderEquivalence,
    collectCssAssetManifest,
    compileComponentModule,
    compilerRules,
    constitution,
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
    'TSX-only authoring',
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
  assert.equal(fact.cssStylesheet.href, '/_jiso/components/docs/doc-card.css');
  assert.deepEqual(fact.cssStylesheet.fragmentTargets, ['doc-card']);
  assert.deepEqual(fact.cssScopeRules, [
    { limit: ':scope [fw-c]', raw: '@scope (doc-card) to (:scope [fw-c]) {', scope: 'doc-card' },
  ]);
});

void test('P10 legibility study packet is ready but not claimed complete', async () => {
  const study = await readProjectFile('docs/legibility-study.md');
  const fact = legibilityStudyGateFact(study);

  assert.equal(fact.status, 'protocol ready; recruitment, sessions, and results pending');
  assert.equal(fact.requiredParticipants, 'five outside developers who have not worked on Jiso');
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
  const ledger = await readProjectFile('docs/v1-acceptance.md');
  const spec = await readProjectFile('SPEC.md');
  const fact = v1AcceptanceLedgerGateFact({ ledger, spec });

  assert.deepEqual(fact.gateCriteria, fact.specGateCriteria);
  assert.equal(fact.gateCriteriaMatchSpec, true);
  assert.equal(
    fact.gateEvidenceArtifacts['16.5 Coverage'],
    'Commerce matrix assertions in examples/commerce/src/app.test.ts and fw check optimistic output.',
  );
  assert.equal(
    fact.gateEvidenceArtifacts['16.6 Navigation typed'],
    'Commerce route/link/redirect checks plus route-rename proof in packages/runtime/src/index.test.ts.',
  );
  assert.equal(
    fact.gateEvidenceArtifacts['16.8 Update coverage'],
    'FW311/update-coverage graph assertions and fw check coverage output.',
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
  const checklist = await readProjectFile('docs/prelaunch-checklist.md');
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
  assert.equal(fact.domain, 'jiso.dev');
  assert.equal(fact.scope, '@jiso');
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
    gzipSync(jisoLoaderSource).byteLength <= 4096,
    `inline loader gzip size ${gzipSync(jisoLoaderSource).byteLength} exceeds 4096 bytes`,
  );

  const fact = await executeInlineEnhancedFormLoaderFixture(jisoLoaderSource);
  assert.deepEqual(fact.listenerEvents, ['click', 'submit', 'input', 'change']);
  assert.equal(fact.listenerOptions.click?.capture, true);
  assert.equal(fact.fetchCalls.length, 1);
  assert.deepEqual(fact.fetchCalls[0], {
    body: { kind: 'form-data' },
    headers: {
      Accept: 'text/vnd.jiso.fragment+html',
      'FW-Fragment': 'true',
      'FW-Idem': 'idem-inline',
      'FW-Targets': 'cart-badge=cart; inventory=inventory stock',
    },
    keepalive: true,
    method: 'POST',
    url: '/_m/cart/add',
  });
  assert.deepEqual(fact.dispatchedQueries, [
    { body: '{"count":1}', key: 'cart:c1', name: 'cart', type: 'jiso:query' },
  ]);
  assert.deepEqual(fact.fragmentHtmlByTarget, { 'cart-badge': '<cart-badge>1</cart-badge>' });
  assert.deepEqual(fact.appendCalls, [['beforeend', '<li>2</li>']]);
});

void test('P2 loader smoke evidence is asserted through runtime behavior', async () => {
  assert.deepEqual(
    await loaderSmokeBehaviorFact({
      applyCompiledQueryUpdatePlan,
      createQueryStore,
      installJisoLoader,
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
      listenerEvents: ['click', 'submit', 'input', 'change'],
      listenerOptions: {
        change: { capture: true },
        click: { capture: true },
        input: { capture: true },
        submit: { capture: true },
      },
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
    '<script type="application/json" fw-query="cart" key="cart:c1">{"html":"\\u003c/script>"}</script>';
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
          'fw-query': 'cart',
          key: 'cart:c1',
          type: 'application/json',
        },
        rawJson: '{"html":"\\u003c/script>"}',
      },
    ],
    headQueryScripts: [
      {
        attrs: {
          'fw-query': 'cart',
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
  assert.equal(renderPageHints({ prefetch: 'moderate', prerenderUrls: ['', ''] }).html, '');
  assert.equal(
    renderPageHints({
      prefetch: 'moderate',
      prerenderUrls: ['', '/products', '/products', '/cart'],
    }).html,
    '<script type="speculationrules">{"prerender":[{"eagerness":"moderate","urls":["/products","/cart"]}]}</script>',
  );
});

void test('P2 compiler merges view transition stamps into existing styles', async () => {
  const result = compileComponentModule({
    fileName: 'components/product-card.tsx',
    source: `
import { component } from '@jiso/core';

export const ProductCard = component('product-card', {
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
      // SPEC §4.2: identity is emitted explicitly on native hosts (fw-c).
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
    FW211: 'on:load eager trigger requires a justification comment.',
    FW212: 'Unknown on:* event or execution trigger name.',
    FW221: 'IDREF references an id not present in component scope.',
    FW224: 'Static id appears in a repeatable component or duplicate page composition.',
    FW225: 'JSX nesting violates the HTML content model.',
    FW226: 'fw-deps or fw-c names an unknown query instance or component.',
  });
  assert.deepEqual(fact.validIdrefDiagnostics, []);
  assert.deepEqual(fact.validContentModelDiagnostics, []);
  assert.deepEqual(fact.validExecutionTriggerDiagnostics, []);
  assert.deepEqual(fact.validResidualStampDiagnostics, []);
  assert.deepEqual(fact.invalidIdrefDiagnostics, [
    {
      code: 'FW221',
      fileName: 'components/cart/cart-search.tsx',
      message: `${diagnosticDefinitions.FW221.message} missing-label`,
      severity: 'error',
    },
    {
      code: 'FW221',
      fileName: 'components/cart/cart-search.tsx',
      message: `${diagnosticDefinitions.FW221.message} missing-help`,
      severity: 'error',
    },
    {
      code: 'FW221',
      fileName: 'components/cart/cart-search.tsx',
      message: `${diagnosticDefinitions.FW221.message} missing-popover`,
      severity: 'error',
    },
  ]);
  assert.deepEqual(fact.invalidStaticIdDiagnostics, [
    {
      code: 'FW224',
      fileName: 'components/cart/cart-shell.tsx',
      message: `${diagnosticDefinitions.FW224.message} duplicate id="cart-title"`,
      severity: 'error',
    },
    {
      code: 'FW224',
      fileName: 'components/cart/cart-list.tsx',
      message: `${diagnosticDefinitions.FW224.message} repeatable id="cart-row"`,
      severity: 'error',
    },
  ]);
  assert.deepEqual(fact.invalidContentModelDiagnostics, [
    {
      code: 'FW225',
      fileName: 'components/cart/cart-shell.tsx',
      message: `${diagnosticDefinitions.FW225.message} <div> cannot appear inside <p>`,
      severity: 'error',
    },
    {
      code: 'FW225',
      fileName: 'components/cart/cart-shell.tsx',
      message: `${diagnosticDefinitions.FW225.message} <tr> must be inside a table section or table`,
      severity: 'error',
    },
  ]);
  assert.deepEqual(fact.invalidExecutionTriggerDiagnostics, [
    {
      code: 'FW211',
      fileName: 'components/execution-triggers.tsx',
      message: `${diagnosticDefinitions.FW211.message} on:load`,
      severity: 'lint',
    },
    {
      code: 'FW212',
      fileName: 'components/execution-triggers.tsx',
      message: `${diagnosticDefinitions.FW212.message} on:media`,
      severity: 'lint',
    },
  ]);
  assert.deepEqual(fact.invalidResidualStampDiagnostics, [
    {
      code: 'FW226',
      fileName: 'components/recommendations.tsx',
      message: `${diagnosticDefinitions.FW226.message} fw-c="unknown-component"`,
      severity: 'error',
    },
    {
      code: 'FW226',
      fileName: 'components/recommendations.tsx',
      message: `${diagnosticDefinitions.FW226.message} fw-deps="missingQuery:p1"`,
      severity: 'error',
    },
  ]);
});

void test('P1 compiler emits FW311 update coverage facts', async () => {
  assert.equal(
    diagnosticDefinitions.FW311.message,
    'Query-dependent DOM position has no update status.',
  );
  const result = compileComponentModule({
    fileName: 'components/cart/cart-badge.tsx',
    source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
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
      detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
      position: 'expression',
      query: 'cart.discount',
      status: 'UNHANDLED',
    },
    {
      component: 'CartBadge',
      detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
      position: 'expression',
      query: 'product.name',
      status: 'UNHANDLED',
    },
  ]);
  assert.deepEqual(compilerDiagnosticFacts(result.diagnostics, ['FW311']), [
    {
      code: 'FW311',
      fileName: 'components/cart/cart-badge.tsx',
      message: `${diagnosticDefinitions.FW311.message} CartBadge cart.discount expression`,
      severity: 'warn',
    },
    {
      code: 'FW311',
      fileName: 'components/cart/cart-badge.tsx',
      message: `${diagnosticDefinitions.FW311.message} CartBadge product.name expression`,
      severity: 'warn',
    },
  ]);
  assert.deepEqual(
    fwCheckAssertionFact(
      fwCheck({
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
          code: 'FW311',
          message: diagnosticDefinitions.FW311.message,
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
      version: 'fw-check/v1',
    },
  );
});

void test('P1 compiler validates binding stamp expression drift', async () => {
  assert.equal(
    diagnosticDefinitions.FW222.message,
    'Hand-written binding stamp disagrees with the typed expression it wraps.',
  );
  assert.equal(
    diagnosticDefinitions.FW223.message,
    'Redundant hand-written binding stamp in sugar; the compiler derives it.',
  );
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/cart/cart-badge.tsx',
        source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
      }).diagnostics,
      ['FW223'],
    ),
    [
      {
        code: 'FW223',
        fileName: 'components/cart/cart-badge.tsx',
        message: `${diagnosticDefinitions.FW223.message} data-bind="cart.count" wraps {cart.count}`,
        severity: 'lint',
      },
    ],
  );
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/cart/cart-badge.tsx',
        source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.total}</span>,
});
`,
      }).diagnostics,
      ['FW222'],
    ),
    [
      {
        code: 'FW222',
        fileName: 'components/cart/cart-badge.tsx',
        message: `${diagnosticDefinitions.FW222.message} data-bind="cart.count" wraps {cart.total}`,
        severity: 'error',
      },
    ],
  );
});

void test('P1 compiler validates primitive composition attribute merges', async () => {
  assert.equal(
    diagnosticDefinitions.FW231.message,
    'Unmergeable attribute conflict in primitive composition.',
  );
  assert.equal(
    diagnosticDefinitions.FW232.message,
    'Author overrides a primitive-owned ARIA or state attribute.',
  );
  assert.equal(diagnosticDefinitions.FW233.message, 'Two writers target the same binding slot.');
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/primitive-merge.tsx',
        source: `
import { component } from '@jiso/core';

export const PrimitiveMerge = component('primitive-merge', {
  render: () => (
    <primitive-merge>
      <dialog id="drawer"></dialog>
      <dialog id="confirm"></dialog>
      <button commandfor="drawer" commandfor="confirm" data-p-id="one" data-p-id="two" fw-c="primitive-merge" fw-c="primitive-merge">Open</button>
      <button aria-expanded="false" aria-expanded="true" role="button" role="link" data-state="closed" data-state="open">Toggle</button>
      <span data-bind="cart.count" data-bind="cart.total" data-bind:hidden="cart.empty" data-bind:hidden="cart.loading">2</span>
    </primitive-merge>
  ),
});
`,
      }).diagnostics,
      ['FW231', 'FW232', 'FW233'],
    ),
    [
      {
        code: 'FW231',
        fileName: 'components/primitive-merge.tsx',
        message: `${diagnosticDefinitions.FW231.message} commandfor`,
        severity: 'error',
      },
      {
        code: 'FW231',
        fileName: 'components/primitive-merge.tsx',
        message: `${diagnosticDefinitions.FW231.message} data-p-id`,
        severity: 'error',
      },
      {
        code: 'FW231',
        fileName: 'components/primitive-merge.tsx',
        message: `${diagnosticDefinitions.FW231.message} fw-c`,
        severity: 'error',
      },
      {
        code: 'FW232',
        fileName: 'components/primitive-merge.tsx',
        message: `${diagnosticDefinitions.FW232.message} aria-expanded`,
        severity: 'lint',
      },
      {
        code: 'FW232',
        fileName: 'components/primitive-merge.tsx',
        message: `${diagnosticDefinitions.FW232.message} role`,
        severity: 'lint',
      },
      {
        code: 'FW232',
        fileName: 'components/primitive-merge.tsx',
        message: `${diagnosticDefinitions.FW232.message} data-state`,
        severity: 'lint',
      },
      {
        code: 'FW233',
        fileName: 'components/primitive-merge.tsx',
        message: `${diagnosticDefinitions.FW233.message} data-bind`,
        severity: 'error',
      },
      {
        code: 'FW233',
        fileName: 'components/primitive-merge.tsx',
        message: `${diagnosticDefinitions.FW233.message} data-bind:hidden`,
        severity: 'error',
      },
    ],
  );
});

void test('P1 compiler validates fragment-target child hoisting failures', async () => {
  assert.equal(
    diagnosticDefinitions.FW230.message,
    'Fragment-target children cannot lower to a component reference.',
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-row.tsx',
      source: `
import { component } from '@jiso/core';

export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
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
import { component } from '@jiso/core';

export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
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
      ['FW230'],
    ),
    [
      {
        code: 'FW230',
        fileName: 'components/cart/cart-row.tsx',
        help: [
          'Would hoist children to: CartRow$slot_children',
          'Blocked children: <span>{window.location.href}</span>',
          'Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.',
        ].join('\n'),
        message: `${diagnosticDefinitions.FW230.message} CartRow`,
        severity: 'error',
      },
    ],
  );
});

void test('P3 typed routes validate navigation targets', async () => {
  assert.equal(
    diagnosticDefinitions.FW220.message,
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
          code: 'FW220',
          fileName: 'components/product-links.tsx',
          message: `${diagnosticDefinitions.FW220.message} /product/p1`,
          severity: 'error',
        },
        {
          code: 'FW220',
          fileName: 'components/product-links.tsx',
          message: `${diagnosticDefinitions.FW220.message} /checkout`,
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
  const transactionEvents = [];
  const transactional = mutation('cart/add', {
    csrf: false,
    guard(request) {
      transactionEvents.push(`guard:${request.user}`);
      return request.user === 'u1';
    },
    input: s.object({ productId: s.string() }),
    async transaction(request, run) {
      transactionEvents.push(`begin:${request.tx === true ? 'tx' : 'plain'}`);
      const value = await run({ ...request, tx: true });
      transactionEvents.push('commit');
      return value;
    },
    handler(input, request) {
      transactionEvents.push(`handler:${request.tx === true ? 'tx' : 'plain'}`);
      return input.productId;
    },
  });

  assert.deepEqual(await runMutation(transactional, { productId: 'p1' }, { user: 'u1' }), {
    changes: [],
    ok: true,
    rerunQueries: [],
    value: 'p1',
  });
  assert.deepEqual(transactionEvents, ['guard:u1', 'begin:plain', 'handler:tx', 'commit']);

  const rollbackEvents = [];
  const failing = mutation('cart/fail', {
    csrf: false,
    errors: {
      OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
    },
    input: s.object({ productId: s.string() }),
    async transaction(request, run) {
      rollbackEvents.push('begin');
      try {
        return await run(request);
      } catch (error) {
        rollbackEvents.push('rollback');
        throw error;
      }
    },
    handler(_input, _request, context) {
      rollbackEvents.push('handler');
      return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
    },
  });
  assert.deepEqual(await runMutation(failing, { productId: 'p1' }, {}), {
    error: {
      code: 'OUT_OF_STOCK',
      payload: { availableQuantity: 0 },
    },
    ok: false,
    status: 422,
  });
  assert.deepEqual(rollbackEvents, ['begin', 'handler', 'rollback']);

  const cart = domain('cart');
  const cartQuery = query('cart', {
    instanceKey: () => 'cart:c1',
    load(_input, context) {
      return { cartId: context.request.session.cartId };
    },
    reads: [cart],
  });
  const addToCart = mutation('cart/add', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    registry: {
      queries: [cartQuery],
      touches: [cart],
    },
    handler(input, request) {
      return `${request.session.cartId}:${input.productId}`;
    },
  });
  assert.deepEqual(
    await renderMutationResponse(addToCart, {
      fragment: true,
      rawInput: { productId: 'p1' },
      request: { session: { cartId: 'c1' } },
    }),
    {
      body: '<fw-query name="cart" key="cart:c1">{"cartId":"c1"}</fw-query>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"cart"}]',
      },
      status: 200,
    },
  );
});

void test('P3 server data-plane APIs stay exported and covered', async () => {
  const product = domain('product');
  const productQuery = query('productDetail', {
    args: s.object({ id: s.string(), max: s.number().int().default(10) }),
    guard: (request) => request.session?.userId === 'u1',
    instanceKey: (input) => `product:${input.id}`,
    load(input, { request }) {
      return { id: input.id, max: input.max, userId: request.session?.userId };
    },
    reads: [product],
    version: (input) => input.max,
  });

  assert.deepEqual(await runQuery(productQuery, { id: 'p1' }, { session: { userId: 'u1' } }), {
    input: { id: 'p1', max: 10 },
    ok: true,
    value: { id: 'p1', max: 10, userId: 'u1' },
  });
  assert.deepEqual(await runQuery(productQuery, {}, { session: { userId: 'u1' } }), {
    error: {
      code: 'VALIDATION',
      payload: { issues: [{ message: 'Expected string', path: ['id'] }] },
    },
    ok: false,
    status: 422,
  });
  assert.deepEqual(await runQuery(productQuery, { id: 'p1' }, { session: null }), {
    error: { code: 'UNAUTHORIZED', payload: {} },
    ok: false,
    status: 422,
  });
  assert.deepEqual(
    await renderQueryEndpointResponse(productQuery, {
      request: { session: { userId: 'u1' } },
      search: new URLSearchParams([
        ['id', 'p1'],
        ['max', '3'],
      ]),
    }),
    {
      body: '<fw-query name="product:p1" version="3">{"id":"p1","max":3,"userId":"u1"}</fw-query>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    },
  );
  assert.deepEqual(
    await renderQueryRegistryEndpointResponse({ queries: [productQuery] }, 'missing', {
      request: {},
    }),
    {
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    },
  );

  const productRoute = serverRoute('/products/:id', {
    guard: (request) => request.session?.userId === 'u1',
    page(context, request) {
      if (context.params.id === 'missing') return notFound();
      return `${request.session.userId}:${context.params.id}:${context.search.tab}`;
    },
    params: s.object({ id: s.string() }),
    search: s.object({ tab: s.string() }),
  });
  assert.deepEqual(
    await runRoutePage(
      productRoute,
      { params: { id: 'p1' }, search: { tab: 'details' } },
      { session: { userId: 'u1' } },
    ),
    {
      ok: true,
      value: 'u1:p1:details',
    },
  );
  assert.deepEqual(
    await renderRoutePageResponse(
      productRoute,
      { params: { id: 'missing' }, search: { tab: 'details' } },
      { session: { userId: 'u1' } },
    ),
    {
      body: 'Not Found',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 404,
    },
  );

  const request = { session: { id: 's1' } };
  const csrf = {
    field: 'csrf',
    secret: 'test-secret',
    sessionId: (candidate) => candidate.session.id,
  };
  let guardCalls = 0;
  const addToCart = mutation('cart/add', {
    csrf,
    guard() {
      guardCalls += 1;
      return true;
    },
    input: s.object({ productId: s.string() }),
    handler(input) {
      return input.productId;
    },
  });
  const token = csrfToken(request, csrf);
  assert.equal(csrfField(request, csrf), `<input type="hidden" name="csrf" value="${token}">`);
  assert.deepEqual(await runMutation(addToCart, { csrf: token, productId: 'p1' }, request), {
    changes: [],
    ok: true,
    rerunQueries: [],
    value: 'p1',
  });
  assert.equal(guardCalls, 1);
  assert.deepEqual(await runMutation(addToCart, { productId: 'p1' }, request), {
    error: { code: 'CSRF', payload: {} },
    ok: false,
    status: 422,
  });
  assert.equal(guardCalls, 1);
});

void test('P3 route and query guard removal is mechanically audited by fw check', () => {
  // SPEC.md section 6.4 and IMPLEMENT_v1.md P3 require route/query guards to surface
  // through the unguarded audit when removed.
  assert.deepEqual(
    fwCheckAssertionFact(
      fwCheck({
        mutations: [
          { guards: ['authed'], key: 'cart/add', writes: ['cart'] },
          { guards: ['rateLimit:session'], key: 'inventory/sync', writes: ['product'] },
        ],
        optimistic: [
          { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
          { mutation: 'inventory/sync', query: 'adminOrders', status: 'await-fragment' },
        ],
        pages: [
          { guards: ['authed'], queries: ['cart'], route: '/cart' },
          { guards: [], queries: ['adminOrders'], route: '/admin' },
        ],
        queries: [
          { domains: ['cart'], guards: ['authed'], query: 'cart' },
          { domains: ['product'], guards: [], query: 'adminOrders' },
        ],
      }),
    ),
    {
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
      version: 'fw-check/v1',
    },
  );
});

void test('P5 morph evidence preserves keyed identity and applies fragments', () => {
  assert.deepEqual(
    morphFragmentBehaviorFact({
      applyMutationResponseToDom,
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
      renderedTargetHtml: '<article fw-key="p1">Old</article><article fw-key="p2">New</article>',
      reorderedText: 'Alpha next',
    },
  );
});

void test('D2 commerce validates keyed append and optimistic reorder', async () => {
  const commerceGraph = await graphFixtureFile(
    projectRootPath,
    'examples/commerce/src/generated/graph.json',
  );
  assert.deepEqual(graphComponentTargetFacts(commerceGraph), [
    { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
    { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
    { fragments: ['order-history'], name: 'OrderHistory', queries: ['orderHistory'] },
  ]);
  assert.deepEqual(graphOptimisticFacts(commerceGraph), [
    { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    { mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' },
    { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
  ]);

  const currentGrid = {
    children: [
      { browserState: { islandState: { pendingMutation: 'cart/add' } }, key: 'p1', type: 'card' },
      { key: 'p2', type: 'card' },
    ],
    key: 'product-grid',
    type: 'section',
  };
  const firstProduct = currentGrid.children[0];
  const appendedGrid = morphStructuralTree(currentGrid, {
    children: [
      { key: 'p1', type: 'card' },
      { key: 'p2', type: 'card' },
      { key: 'p3', type: 'card' },
    ],
    key: 'product-grid',
    type: 'section',
  });
  const reorderedGrid = morphStructuralTree(appendedGrid, {
    children: [
      { key: 'p3', type: 'card' },
      { key: 'p1', type: 'card' },
      { key: 'p2', type: 'card' },
    ],
    key: 'product-grid',
    type: 'section',
  });
  assert.strictEqual(reorderedGrid.children[1], firstProduct);
  assert.deepEqual(reorderedGrid.children[1].browserState, {
    islandState: { pendingMutation: 'cart/add' },
  });

  const productDomain = domain('product');
  const productP1 = query('productDetail', {
    instanceKey: 'product:p1',
    load: () => ({ id: 'p1', stock: 0 }),
    reads: [productDomain],
  });
  const productP2 = query('productDetail', {
    instanceKey: 'product:p2',
    load: () => ({ id: 'p2', stock: 10 }),
    reads: [productDomain],
  });
  const reserveProduct = mutation('product/reserve', {
    csrf: false,
    csrfJustification: 'fw-check synthetic keyed invalidation fixture',
    handler(input) {
      return input.productId;
    },
    input: s.object({ productId: s.string() }),
    registry: {
      inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
      queries: [productP1, productP2],
    },
  });
  assert.deepEqual(await runMutation(reserveProduct, { productId: 'p1' }, {}), {
    changes: [{ domain: 'product', input: { productId: 'p1' }, keys: ['p1'] }],
    ok: true,
    rerunQueries: ['productDetail'],
    rerunQueryInstances: [{ instanceKey: 'product:p1', key: 'productDetail' }],
    value: 'p1',
  });
  assert.deepEqual(
    await renderMutationEndpointResponse(reserveProduct, {
      fragmentRenderers: [],
      headers: { 'FW-Fragment': 'true' },
      rawInput: { productId: 'p1' },
      redirectTo: '/products/p1',
      request: {},
    }),
    {
      body: '<fw-query name="productDetail" key="product:p1">{"id":"p1","stock":0}</fw-query>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"product","keys":["p1"]}]',
      },
      status: 200,
    },
  );

  const store = createQueryStore();
  const rebaser = new OptimisticRebaser(store);
  const target = {
    html: '',
    replaceWithHtml(html) {
      this.html = html;
    },
  };
  store.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
  const result = await submitOptimisticEnhancedMutation({
    fetch: async () => {
      assert.deepEqual(store.get('reviews'), undefined);
      assert.deepEqual(store.get('reviews', 'product:p1'), {
        items: [{ id: 'r1' }, { id: 'draft' }],
      });
      return {
        async text() {
          return [
            '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"},{"id":"server"}]}</fw-query>',
            '<fw-fragment target="reviews:p1"><section>Reviews ready</section></fw-fragment>',
          ].join('\n');
        },
      };
    },
    form: { action: '/_m/reviews/add', method: 'post' },
    formData: new FormData(),
    change: { domain: 'product', input: { reviewId: 'draft' }, keys: ['p1'] },
    idem: 'idem_keyed_optimistic',
    input: { reviewId: 'ignored' },
    optimistic: {
      keys: { reviews: (change) => `product:${change.keys?.[0]}` },
      transforms: {
        reviews(current, input) {
          const reviews = current;
          return { items: [...reviews.items, { id: input.reviewId }] };
        },
      },
    },
    rebaser,
    root: {
      findFragmentTarget(fragmentTarget) {
        return fragmentTarget === 'reviews:p1' ? target : null;
      },
      querySelectorAll() {
        return [];
      },
    },
    store,
  });

  assert.deepEqual(result.queries, ['reviews:product:p1']);
  assert.deepEqual(result.appliedFragments, ['reviews:p1']);
  assert.deepEqual(store.get('reviews'), undefined);
  assert.deepEqual(store.get('reviews', 'product:p1'), {
    items: [{ id: 'r1' }, { id: 'server' }],
  });
  assert.equal(target.html, '<section>Reviews ready</section>');
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
          Accept: 'text/vnd.jiso.fragment+html',
          'FW-Fragment': 'true',
          'FW-Idem': 'idem_bfcache',
          'FW-Targets': '',
        },
        keepalive: true,
        method: 'POST',
      },
      listenerStates: {
        afterDispose: { pagehide: false },
        afterInstall: { pagehide: true, unload: false },
      },
      pendingAttributes: {
        afterPagehide: { 'fw-deps': 'cart' },
        afterSubmit: {
          'aria-busy': 'true',
          'fw-deps': 'cart',
          'fw-pending': '',
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
  const createTransactionalDb = () => {
    const db = {
      commits: 0,
      items: [],
      rollbacks: 0,
      async transaction(run) {
        const draft = { items: this.items.map((item) => ({ ...item })) };
        try {
          const result = await run(draft);
          this.items = draft.items;
          this.commits += 1;
          return result;
        } catch (error) {
          this.rollbacks += 1;
          throw error;
        }
      },
    };
    return db;
  };

  const addToCart = mutation('cart/add', {
    csrf: false,
    errors: {
      OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
    },
    handler(input, request, context) {
      if (input.quantity > 5) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 5 });
      }

      request.db.items.push({ productId: input.productId, qty: input.quantity });
      return { count: request.db.items.length };
    },
    input: s.object({
      productId: s.string(),
      quantity: s.number().int().min(1),
    }),
    transaction(request, run) {
      return request.db.transaction((db) => run({ ...request, db }));
    },
  });

  const db = createTransactionalDb();
  assert.deepEqual(await runMutation(addToCart, { productId: 'p1', quantity: 2 }, { db }), {
    changes: [],
    ok: true,
    rerunQueries: [],
    value: { count: 1 },
  });
  assert.deepEqual(db.items, [{ productId: 'p1', qty: 2 }]);
  assert.equal(db.commits, 1);
  assert.equal(db.rollbacks, 0);

  assert.deepEqual(await runMutation(addToCart, { productId: 'p2', quantity: 99 }, { db }), {
    error: { code: 'OUT_OF_STOCK', payload: { availableQuantity: 5 } },
    ok: false,
    status: 422,
  });
  assert.deepEqual(db.items, [{ productId: 'p1', qty: 2 }]);
  assert.equal(db.commits, 1);
  assert.equal(db.rollbacks, 1);
});

void test('D1 commerce enhanced fragments carry Tailwind stylesheet hints', async () => {
  const stylesheetManifest = [
    {
      criticalCss: 'cart-badge { color: teal; }</style> cart-badge { display: block; }',
      fragmentTargets: ['cart-badge'],
      href: '/assets/tailwind.css',
    },
    {
      fragmentTargets: ['recommendations'],
      href: '/assets/recommendations.css',
      preload: false,
    },
  ];

  assert.deepEqual(stylesheetsForTargets(stylesheetManifest, ['cart-badge']), [
    {
      criticalCss: 'cart-badge { color: teal; }</style> cart-badge { display: block; }',
      fragmentTargets: ['cart-badge'],
      href: '/assets/tailwind.css',
    },
  ]);

  const pageHints = renderPageHints({
    stylesheets: stylesheetsForTargets(stylesheetManifest),
  });
  assert.equal(
    pageHints.html,
    '<style data-jiso-critical-href="/assets/tailwind.css">cart-badge { color: teal; }<\\/style> cart-badge { display: block; }</style><link rel="stylesheet" href="/assets/tailwind.css"><link rel="stylesheet" href="/assets/recommendations.css">',
  );
  assert.deepEqual(pageHints.earlyHints, {
    Link: '</assets/tailwind.css>; rel=preload; as=style',
  });

  const deferred = renderDeferredStream({
    chunks: [
      {
        fragments: [
          {
            html: '<section class="border-slate-200">Ready</section>',
            stylesheets: stylesheetsForTargets(stylesheetManifest, ['recommendations']),
            target: 'recommendations',
          },
        ],
      },
    ],
    shell: '<!doctype html><main><fw-defer target="recommendations"></fw-defer></main>',
  });
  const deferredElements = htmlElementFacts(deferred.body);
  assert.deepEqual(
    deferredElements.map((element) => element.tag),
    ['main', 'fw-defer', 'fw-fragment', 'link', 'section'],
  );
  assert.deepEqual(deferredElements.find((element) => element.tag === 'fw-fragment')?.attrs, {
    target: 'recommendations',
  });
  assert.deepEqual(deferredElements.find((element) => element.tag === 'link')?.attrs, {
    href: '/assets/recommendations.css',
    rel: 'stylesheet',
  });
  assert.deepEqual(deferredElements.find((element) => element.tag === 'section')?.attrs, {
    class: 'border-slate-200',
  });

  const cart = domain('cart');
  const addToCart = mutation('cart/add', {
    csrf: false,
    errors: {
      OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
    },
    handler(_input, _request, context) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
    },
    input: s.object({ productId: s.string() }),
    registry: { touches: [cart] },
  });
  const failure = await renderMutationEndpointResponse(addToCart, {
    failureStylesheets: ['/assets/tailwind.css'],
    failureTarget: 'product-form:p2',
    headers: { 'FW-Fragment': 'true' },
    rawInput: { productId: 'p2' },
    renderFailureFragment: () =>
      '<form class="border-slate-200"><output role="alert">Only 0 left.</output></form>',
    request: {},
  });

  assert.deepEqual(failure, {
    body: '<fw-fragment target="product-form:p2"><link rel="stylesheet" href="/assets/tailwind.css"><form class="border-slate-200"><output role="alert">Only 0 left.</output></form></fw-fragment>',
    headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
    status: 422,
  });
});

void test('D4 commerce adopt-dont-invent features stay represented', async () => {
  const element = (initialAttributes) => {
    const attributes = { ...initialAttributes };

    return {
      getAttribute(name) {
        return attributes[name] ?? null;
      },
      removeAttribute(name) {
        delete attributes[name];
      },
      setAttribute(name, value) {
        attributes[name] = value;
      },
    };
  };
  const commerceGraph = await graphFixtureFile(
    projectRootPath,
    'examples/commerce/src/generated/graph.json',
  );
  const cartPage = commerceGraph.pages.find((page) => page.route === '/cart');
  const receiptMutation = commerceGraph.mutations.find((item) => item.key === 'order/receipt');

  assert.deepEqual(cartPage.i18n, ['en-US:cartLabel,productStock']);
  assert.deepEqual(cartPage.modulepreloads, []);
  assert.equal(cartPage.prefetch, false);
  assert.deepEqual(cartPage.queries, ['cart', 'productGrid', 'orderHistory']);
  assert.equal(cartPage.route, '/cart');
  assert.deepEqual(cartPage.stylesheets, ['/assets/tailwind.css']);
  assert.deepEqual(cartPage.meta, {
    description: 'Browse products and checkout with 0 verifiable cart item.',
    title: 'Jiso Commerce (0)',
  });
  assert.deepEqual(receiptMutation, {
    enctype: 'multipart/form-data',
    fileFields: ['receipt'],
    guards: ['authed', 'rateLimit:session'],
    inputFields: ['orderId', 'receipt'],
    key: 'order/receipt',
    session: 'commerceSession',
    writes: ['attachment'],
  });

  const cartQuery = query('cart', {
    load: () => ({ count: 1 }),
    reads: [domain('cart')],
  });
  const cartMeta = metaFromQuery(cartQuery, (cart) => ({
    description: `Browse products and checkout with ${cart.count} verifiable cart item.`,
    title: `Jiso Commerce (${cart.count})`,
  }));
  const messages = i18n('en-US', {
    cartLabel: 'Cart ({count})',
    productStock: '{stock} in stock',
  });

  assert.equal(t(messages, 'cartLabel', { count: 1 }), 'Cart (1)');
  assert.deepEqual(
    renderPageHints({ i18n: messages, meta: cartMeta }, { queries: { cart: { count: 1 } } }),
    {
      earlyHints: {},
      html: [
        '<title>Jiso Commerce (1)</title>',
        '<meta name="description" content="Browse products and checkout with 1 verifiable cart item.">',
        '<meta property="og:description" content="Browse products and checkout with 1 verifiable cart item.">',
        '<script type="application/json" fw-i18n locale="en-US">{"cartLabel":"Cart ({count})","productStock":"{stock} in stock"}</script>',
      ].join(''),
    },
  );
  assert.throws(
    () => renderPageHints({ meta: cartMeta }),
    /Missing query data for route meta: cart/,
  );

  const commerceSession = session(
    s.object({
      id: s.string(),
      user: s.object({ id: s.string() }),
    }),
  );
  const authenticatedRequest = { session: { id: 's1', user: { id: 'u1' } } };
  const guarded = guards.all(guards.authed(), guards.rateLimit({ max: 1, per: 'session' }));

  assert.deepEqual(commerceSession.parse(authenticatedRequest), {
    id: 's1',
    user: { id: 'u1' },
  });
  assert.equal(await guarded(authenticatedRequest), true);
  assert.equal((await guarded(authenticatedRequest)).code, 'RATE_LIMITED');
  assert.deepEqual(await guards.authed()({ session: null }), {
    auth: 'unauthenticated',
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
  });

  const storedObjects = new Map();
  const storage = {
    async get(key) {
      return storedObjects.get(key);
    },
    async put(key, body, options = {}) {
      const bytes =
        body instanceof ArrayBuffer
          ? new Uint8Array(body)
          : ArrayBuffer.isView(body)
            ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
            : new TextEncoder().encode(String(body));
      const stored = {
        body: bytes,
        contentType: options.contentType,
        key,
        metadata: options.metadata,
        size: bytes.byteLength,
      };
      storedObjects.set(key, stored);
      return stored;
    },
    async stat(key) {
      return storedObjects.get(key);
    },
    async stream(key) {
      const stored = storedObjects.get(key);
      return stored ? { ...stored, body: new Blob([stored.body]).stream() } : undefined;
    },
  };
  const uploadReceipt = mutation('order/receipt', {
    csrf: false,
    input: s.object({
      orderId: s.string(),
      receipt: s.file({ maxBytes: 64 * 1024, mime: ['application/pdf', 'image/png'] }).store({
        key: (file) => `receipts/${file.name}`,
        storage,
      }),
    }),
    handler(input, request) {
      return {
        orderId: input.orderId,
        session: commerceSession.parse(request).user.id,
        storageKey: input.receipt.storage.key,
      };
    },
    registry: { touches: [domain('attachment')] },
  });
  const receiptForm = new FormData();
  receiptForm.set('orderId', 'o1');
  receiptForm.set('receipt', new Blob(['receipt'], { type: 'application/pdf' }), 'receipt.pdf');

  const receiptResult = await runMutation(uploadReceipt, receiptForm, authenticatedRequest);
  assert.deepEqual(receiptResult, {
    changes: [
      {
        domain: 'attachment',
        input: {
          orderId: 'o1',
          receipt: {
            file: receiptForm.get('receipt'),
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
  assert.deepEqual(await storage.stat('receipts/receipt.pdf'), {
    body: new TextEncoder().encode('receipt'),
    contentType: 'application/pdf',
    key: 'receipts/receipt.pdf',
    metadata: { filename: 'receipt.pdf' },
    size: 7,
  });

  const progressElement = element({ 'fw-upload-progress': '', max: '100', value: '0' });
  const pendingElement = element({ 'fw-deps': 'order' });
  const form = {
    ...element({ 'data-mutation': 'order/receipt', enhance: '', 'fw-deps': 'order' }),
    action: '/_m/order/receipt',
    method: 'post',
    querySelectorAll(selector) {
      return selector === '[fw-upload-progress]' ? [progressElement] : [];
    },
  };
  const mutationRoot = {
    findFragmentTarget() {
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[fw-deps]' ? [pendingElement] : [];
    },
  };

  await submitEnhancedMutation({
    fetch: async (_url, options) => ({
      headers: { get: () => null },
      async text() {
        options.onUploadProgress?.({ loaded: 32, total: 64 });
        assert.equal(pendingElement.getAttribute('fw-pending'), '');
        return '<fw-query name="receipt">{"ok":true}</fw-query>';
      },
    }),
    form,
    formData: receiptForm,
    onUploadProgress(progress) {
      const total = progress.total ?? 0;
      progressElement.setAttribute('max', '100');
      progressElement.setAttribute('value', String(Math.round((progress.loaded / total) * 100)));
    },
    pendingQueries: ['order'],
    pendingRoot: mutationRoot,
    root: mutationRoot,
    store: createQueryStore(),
  });
  assert.equal(progressElement.getAttribute('value'), '50');
  assert.equal(progressElement.getAttribute('max'), '100');
  assert.equal(pendingElement.getAttribute('fw-pending'), null);

  const fragmentFailure = mutation('product-grid/reload', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    handler(input) {
      return input;
    },
  });
  const failureResponse = await renderMutationEndpointResponse(fragmentFailure, {
    fragmentRenderers: [
      errorBoundary(
        {
          render() {
            throw new Error('fragment failed');
          },
          stylesheets: ['/assets/tailwind.css'],
          target: 'product-grid',
        },
        {
          render(error) {
            return `<section role="alert">${error.message}</section>`;
          },
          target: 'product-grid-error',
        },
      ),
    ],
    headers: { 'FW-Fragment': 'true', 'FW-Targets': 'product-grid' },
    rawInput: { productId: 'p1' },
    request: {},
  });

  assert.deepEqual(failureResponse, {
    body: '<fw-fragment target="product-grid-error" error-boundary="product-grid"><link rel="stylesheet" href="/assets/tailwind.css"><section role="alert">fragment failed</section></fw-fragment>',
    headers: {
      'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      'FW-Changes': '[]',
    },
    status: 200,
  });
});

void test('P10 commerce graph assertions answer behavior mechanically', async () => {
  const commerceGraph = await graphFixtureFile(
    projectRootPath,
    'examples/commerce/src/generated/graph.json',
  );
  const cartQueryExplain = fwExplain(commerceGraph, { kind: 'query', target: 'cart' });
  const cartAddExplain = fwExplain(commerceGraph, {
    kind: 'mutation',
    optimistic: true,
    target: 'cart/add',
  });
  const uploadReceiptExplain = fwExplain(commerceGraph, {
    kind: 'mutation',
    optimistic: true,
    target: 'order/receipt',
  });

  assert.deepEqual(fwCheckOkAssertionFact(fwCheck(commerceGraph)), {
    exitCode: 0,
    issueCount: 0,
    status: 'ok',
    version: 'fw-check/v1',
  });
  assert.deepEqual(fwExplainQueryAssertionFact(cartQueryExplain), {
    consumers: ['component:CartBadge', 'page:/cart'],
    domainWrites: ['cart.addItem'],
    exitCode: 0,
    invalidatedBy: ['cart/add'],
    reads: ['cart'],
    subject: 'QUERY cart',
    version: 'fw-explain/v1',
  });
  assert.deepEqual(fwExplainMutationAssertionFact(cartAddExplain), {
    exitCode: 0,
    guards: ['authed', 'rateLimit:session'],
    inputFields: ['productId', 'quantity'],
    invalidates: ['cart', 'product', 'order'],
    manualInvalidates: [],
    optimisticStatuses: {
      cart: 'hand-written',
      orderHistory: 'await-fragment',
      productGrid: 'await-fragment',
    },
    optimisticSummary: {
      UNHANDLED: '0',
      'await-fragment': '2',
      'hand-written': '1',
      total: '3',
    },
    session: 'commerceSession',
    subject: 'MUTATION cart/add',
    updateConsumers: [
      { consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' },
      { consumers: ['component:OrderHistory', 'page:/cart'], query: 'orderHistory' },
      { consumers: ['component:ProductGrid', 'page:/cart'], query: 'productGrid' },
    ],
    version: 'fw-explain/v1',
    writes: ['cart', 'product', 'order'],
  });
  assert.deepEqual(fwExplainMutationAssertionFact(uploadReceiptExplain), {
    enctype: 'multipart/form-data',
    exitCode: 0,
    fileFields: ['receipt'],
    guards: ['authed', 'rateLimit:session'],
    inputFields: ['orderId', 'receipt'],
    invalidates: [],
    manualInvalidates: [],
    optimisticSummary: {
      UNHANDLED: '0',
      'await-fragment': '0',
      'hand-written': '0',
      total: '0',
    },
    session: 'commerceSession',
    subject: 'MUTATION order/receipt',
    updateConsumers: [],
    version: 'fw-explain/v1',
    writes: ['attachment'],
  });
  assert.equal(
    diagnosticDefinitions.FW310.message,
    'Invalidated query lacks optimistic transform.',
  );
  assert.equal(
    diagnosticDefinitions.FW311.message,
    'Query-dependent DOM position has no update status.',
  );
  const coverageCheck = fwCheck(
    {
      mutations: [{ key: 'cart/add', writes: ['cart'] }],
      optimistic: [{ mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' }],
      queries: [
        { domains: ['cart'], query: 'cart' },
        { domains: ['order'], query: 'orderHistory' },
      ],
      touchGraph: {
        'order.write': {
          touches: [{ domain: 'order', keys: null, site: 'order.ts:1', via: 'orders' }],
          unresolved: [],
        },
      },
      updateCoverage: [
        {
          component: 'CartBadge',
          query: 'cart.discount',
          status: 'UNHANDLED',
        },
        {
          component: 'OrderHistory',
          query: 'orderHistory',
          status: 'fragment',
        },
      ],
    },
    { family: 'all' },
  );
  assert.deepEqual(fwCheckDiagnosticAssertionFacts(coverageCheck.output), [
    {
      code: 'FW310',
      message: diagnosticDefinitions.FW310.message,
      properties: {},
      severity: 'WARN',
      target: 'cart/add -> cart',
    },
    {
      code: 'FW311',
      message: diagnosticDefinitions.FW311.message,
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
  assert.deepEqual(fwCheckCoverageAssertionFacts(coverageCheck.output), [
    {
      properties: {
        component: 'OrderHistory',
        position: 'undefined',
        query: 'orderHistory',
        status: 'fragment',
      },
    },
  ]);
  assert.deepEqual(graphStaticBehaviorFact(commerceGraph), {
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
      { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
      { mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' },
      { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
    ],
    routes: ['/admin', '/cart'],
    touchGraphKeys: ['cart.addItem', 'order.receipt', 'payment.webhook'],
  });
  const cartBadge = compileComponentModule({
    fileName: 'cart-badge.tsx',
    source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge><span data-bind="cart.count">{cart.count}</span></cart-badge>,
});
`,
  });
  assert.deepEqual(cartBadge.componentGraphFacts, [
    {
      name: 'CartBadge',
      queries: ['cart'],
    },
  ]);
  assert.deepEqual(
    deriveAppGraph({
      components: [cartBadge],
      graph: { queries: [{ domains: ['cart'], query: 'cart' }] },
    }).registryFacts,
    {
      components: ['cart-badge'],
      domainKeys: ['cart'],
      invalidations: {},
      routes: [],
    },
  );
  assert.deepEqual(
    graphTouchGraphKeys(commerceGraph, ['cart.addItem', 'order.receipt', 'payment.webhook']),
    ['cart.addItem', 'order.receipt', 'payment.webhook'],
  );
});

void test('P10 starter wires graph assertions into CI', async () => {
  const starterAcceptance = await starterTemplateAcceptanceFact({
    assertFixpoint,
    assertRenderEquivalence,
    compileComponentModule,
    expectedDevDependencies: [
      '@jiso/compiler',
      '@tailwindcss/vite',
      '@typescript/native-preview',
      'fw',
      'tailwindcss',
      'typescript',
      'vite',
      'vite-plus',
      'vitest',
    ],
    fwCheck,
    fwExplain,
    fwOutputs: starterTemplateFwOutputs,
    ...starterTemplatePaths,
  });

  assert.deepEqual(starterAcceptance.package, {
    dependencies: ['@jiso/better-auth', '@jiso/core', '@jiso/runtime', '@jiso/server'],
    scripts: {
      emitGraph: 'node scripts/emit-graph.mjs',
      fwCheck: undefined,
      graphAssertions: undefined,
    },
  });
  assert.deepEqual(starterAcceptance.devDependencyCoverage, {
    expected: [
      '@jiso/compiler',
      '@tailwindcss/vite',
      '@typescript/native-preview',
      'fw',
      'tailwindcss',
      'typescript',
      'vite',
      'vite-plus',
      'vitest',
    ],
    missing: [],
    present: [
      '@jiso/compiler',
      '@tailwindcss/vite',
      '@typescript/native-preview',
      'fw',
      'tailwindcss',
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
    version: 'fw-check/v1',
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
        title: 'Jiso Starter Cart',
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
    version: 'fw-explain/v1',
  });
  assert.deepEqual(starterAcceptance.explain.cartAdd, {
    exitCode: 0,
    guards: ['authed'],
    inputFields: ['productId', 'quantity'],
    invalidates: ['cart'],
    manualInvalidates: [],
    optimisticStatuses: { cart: 'await-fragment' },
    optimisticSummary: {
      UNHANDLED: '0',
      'await-fragment': '1',
      'hand-written': '0',
      total: '1',
    },
    session: 'starterSession',
    subject: 'MUTATION cart/add',
    updateConsumers: [
      { consumers: ['component:CartBadge', 'component:CartPanel', 'page:/cart'], query: 'cart' },
    ],
    version: 'fw-explain/v1',
    writes: ['cart'],
  });
  assert.deepEqual(starterAcceptance.explain.cartPage, {
    exitCode: 0,
    i18n: ['en-US:cartTitle'],
    meta: 'title=Jiso Starter Cart description=Starter cart backed by query data. image=-',
    modulepreloads: [],
    prefetch: 'false',
    queries: ['cart'],
    stylesheets: ['/src/styles.css'],
    subject: 'PAGE /cart',
    version: 'fw-explain/v1',
    viewTransitions: [],
  });

  assert.deepEqual(starterAcceptance.tasks.fwCheck, {
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
    'vp run fw-check',
    'vp run graph-assertions',
  ]);
  assert.deepEqual(
    starterAcceptance.taskOutputs.map((taskOutput) => taskOutput.output),
    ['emit-graph/v1\nOK\nfw-check/v1\nOK\n', 'emit-graph/v1\nOK\ngraph-assertions/v1\nOK\n'],
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
      body: '<fw-fragment></fw-fragment>',
      boundary: 'starter-boundary',
      morph: 'structural',
      queryPlansMatch: true,
      rootMatches: true,
      storeMatches: true,
    },
    deferredApplied: true,
    fetchCall: {
      body: 'productId=p1',
      headers: { Accept: 'text/vnd.jiso.fragment+html' },
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

  assert.deepEqual(starterAcceptance.cssDirectives, [
    '"../index.html"',
    '"./**/*.{ts,tsx,html}"',
    'inline("bg-emerald-50 text-emerald-700 border-emerald-200 bg-amber-50 text-amber-700 border-amber-200")',
  ]);
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

  execFileSync('pnpm', ['exec', 'vitest', '--run', 'packages/create-jiso/src/index.test.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, CI: '1' },
    stdio: 'pipe',
  });
});

void test('P9 verification layer evidence remains represented', async () => {
  assert.deepEqual(
    await verificationLayerBehaviorFact({
      createDbVerifier,
      createJisoTestHarness,
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
        FW402: 'Write touched an undeclared domain.',
        FW404: 'Write to unmapped table.',
        FW407: 'Query read from undeclared domain.',
        FW408: 'Declared row key differs from observed row predicate.',
        FW410: 'Query result shape failed declared output schema.',
        FW411: 'Query read set includes an exempt table.',
      },
      failures: {
        exemptRawSql: 'FW411 Query read set includes an exempt table: audit_log',
        exemptRead: 'FW411 Query read set includes an exempt table: audit_log',
        invalidOutput:
          'FW410 Query result shape failed declared output schema: product/list Expected string',
        missingNestedRead: 'FW407 Query read from undeclared domain: price, price',
        rowKey:
          'FW408 Declared row key differs from observed row predicate: products expected id observed sku',
        selectSubqueryMissingRead: 'FW407 Query read from undeclared domain: price',
        undeclaredRead: 'FW407 Query read from undeclared domain: product',
        unmappedWrite: 'FW404 Write to unmapped table: unknown_table',
        writeOutsideGraph: 'FW402 Write touched an undeclared domain: audit',
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
        rawMutationFailure: 'FW402 Write touched an undeclared domain: audit',
        transactionFailure: 'FW402 Write touched an undeclared domain: audit',
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

  assert.deepEqual(
    fwCheckAssertionFact(
      fwCheck({
        diagnostics: [
          {
            code: 'FW410',
            site: 'cart.queries.ts:5',
          },
          {
            code: 'FW302',
            message: 'data-bind path is not present in the declared query shape. cart.missing',
            site: 'cart-badge.tsx',
            start: { column: 23, line: 3 },
          },
        ],
        verificationDiagnostics: [
          {
            branch: 'stock-reserve',
            code: 'FW405',
            domain: 'product',
            site: 'cart.domain.ts:2',
          },
          {
            code: 'FW402',
            detail: 'observed table audit_log',
            domain: 'audit',
          },
          {
            code: 'FW403',
            domain: 'order',
          },
          {
            code: 'FW404',
            detail: 'observed table unknown_table',
            domain: 'unknown_table',
          },
          {
            code: 'FW407',
            detail: 'observed table products',
            domain: 'product',
            site: 'cart.queries.ts:7',
          },
          {
            code: 'FW408',
            detail: 'expected id observed sku',
            domain: 'product',
            site: 'product.domain.ts:9',
          },
          {
            code: 'FW410',
            detail: 'cart Expected number',
            domain: 'cart',
            site: 'cart.queries.ts:11',
          },
        ],
      }),
    ),
    {
      coverage: [],
      diagnostics: [
        {
          code: 'FW410',
          message: 'Query result shape failed declared output schema.',
          properties: {},
          severity: 'ERROR',
          target: 'cart.queries.ts:5',
        },
        {
          code: 'FW302',
          message: 'data-bind path is not present in the declared query shape. cart.missing',
          properties: {},
          severity: 'ERROR',
          target: 'cart-badge.tsx:3:23',
        },
        {
          code: 'FW405',
          message:
            'Conditional write branch was never executed under instrumentation. domain=product branch=stock-reserve',
          properties: {},
          severity: 'WARN',
          target: 'cart.domain.ts:2',
        },
        {
          code: 'FW402',
          message: 'Write touched an undeclared domain. domain=audit observed table audit_log',
          properties: {},
          severity: 'ERROR',
          target: 'domain:audit',
        },
        {
          code: 'FW403',
          message: 'Declared domain was never observed written. domain=order',
          properties: {},
          severity: 'WARN',
          target: 'domain:order',
        },
        {
          code: 'FW404',
          message: 'Write to unmapped table. domain=unknown_table observed table unknown_table',
          properties: {},
          severity: 'ERROR',
          target: 'domain:unknown_table',
        },
        {
          code: 'FW407',
          message: 'Query read from undeclared domain. domain=product observed table products',
          properties: {},
          severity: 'ERROR',
          target: 'cart.queries.ts:7',
        },
        {
          code: 'FW408',
          message:
            'Declared row key differs from observed row predicate. domain=product expected id observed sku',
          properties: {},
          severity: 'ERROR',
          target: 'product.domain.ts:9',
        },
        {
          code: 'FW410',
          message:
            'Query result shape failed declared output schema. domain=cart cart Expected number',
          properties: {},
          severity: 'ERROR',
          target: 'cart.queries.ts:11',
        },
      ],
      exitCode: 1,
      status: 'issues',
      version: 'fw-check/v1',
    },
  );
  assert.deepEqual(
    fwCheckAssertionFact(
      fwCheck({
        diagnostics: [{ code: 'FW411', site: 'cart.queries.ts:9' }],
      }),
    ),
    {
      coverage: [],
      diagnostics: [
        {
          code: 'FW411',
          message: 'Query read set includes an exempt table.',
          properties: {},
          severity: 'ERROR',
          target: 'cart.queries.ts:9',
        },
      ],
      exitCode: 1,
      status: 'issues',
      version: 'fw-check/v1',
    },
  );

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
            body: '<fw-query name="cart" key="cart:c1">{"count":2}</fw-query>',
            changes: [{ domain: 'cart', keys: ['c1'] }],
          },
        ],
        fetchHeaders: {
          Accept: 'text/vnd.jiso.fragment+html',
          'FW-Fragment': 'true',
          'FW-Idem': 'idem_change_record',
          'FW-Targets': '',
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
            diagnostics: ['FW233'],
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
    fwExplainComponentAssertionFact(fwExplain(graph, { kind: 'component', target: 'CartBadge' })),
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
          diagnostics: ['FW233'],
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
      version: 'fw-explain/v1',
    },
  );
  assert.deepEqual(fwExplainEndpointAssertionFact(fwExplain(graph, { endpoints: true })), {
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
    version: 'fw-explain/v1',
  });
  assert.deepEqual(fwExplainUnguardedAssertionFact(fwExplain(graph, { unguarded: true })), {
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
    version: 'fw-explain/v1',
  });
  assert.deepEqual(fwExplainScopeAuditAssertionFact(fwExplain(graph, { unscoped: true })), {
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
    version: 'fw-explain/v1',
  });
});

void test('P5 data-bind paths are checked against generated query shape facts', async () => {
  const dataBindFact = compilerDataBindBehaviorFact({
    compileComponentModule,
    diagnosticDefinitions,
    queryShapesFromFacts,
  });
  assert.deepEqual(dataBindFact.diagnostics, {
    FW227Help: [
      'Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.',
      'SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.',
    ].join('\n'),
    FW302Message: 'data-bind path is not present in the declared query shape.',
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
      code: 'FW302',
      message: 'data-bind path is not present in the declared query shape. cart.count',
    },
  ]);
  assert.deepEqual(dataBindFact.invalidListStampDiagnostics, [
    {
      code: 'FW302',
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
      code: 'FW227',
      help: diagnosticDefinitions.FW227.help,
      message:
        'Binding path traverses a nullable segment without ?. product.review.rating (segment: review)',
    },
  ]);
});

void test('S1 production build proves the compiler 1:1 emit contract', async () => {
  const contract = await viteProductionEmitContractFact({
    createPlugin: jisoVitePlugin,
    executeClientModule: executeGeneratedClientModule,
    projectRoot: projectRootPath,
    runtime: generatedModuleRuntime,
  });
  assert.deepEqual(contract.prodEmit, { stderr: '', stdoutLines: ['prod-emit-check/v1', 'OK'] });
  assert.equal(contract.pluginName, 'jiso');
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
import { component } from '@jiso/core';

export const DiagnosticCard = component('diagnostic-card', {
  render: () => <button onClick={() => window.alert('x')}>Add</button>,
});
`;
  const greenSource = `
import { component } from '@jiso/core';

export const DiagnosticCard = component('diagnostic-card', {
  render: () => <button>Add</button>,
});
`;
  const lintSource = `
import { component } from '@jiso/core';

export const DiagnosticCard = component('diagnostic-card', {
  render: () => <button onClick={() => { const response = { ok: true }; return response.ok; }}>Check</button>,
});
`;
  const assertRedTransformMessage = (message) => {
    const diagnosticFact = viteLoweredEventDiagnosticFact(message);

    assert.equal(diagnosticFact.summary, 'Jiso Vite transform failed with 1 error diagnostic.');
    assert.deepEqual(diagnosticFact.diagnostic, {
      code: 'FW201',
      location: `${fileName}:5:25`,
      message: diagnosticDefinitions.FW201.message,
    });
    assert.deepEqual(diagnosticFact.loweredHandler, {
      handlerName: 'DiagnosticCard$button_click',
      modulePath: '/c/routes/diagnostic-card.client.js',
      versionShape: 'lower-hex-8',
    });
    assert.deepEqual(
      diagnosticFact.help.map(({ label }) => label),
      ['Would lower to', 'Blocked expression', 'Element params', 'Fixes', 'help'],
    );
    assert.equal(diagnosticFact.sourceExpression, "() => window.alert('x')");
    assert.equal(diagnosticFact.elementParams, '-');
    assert.deepEqual(diagnosticFact.help.slice(3), [
      {
        label: 'Fixes',
        text: diagnosticDefinitions.FW201.help.split('\n')[0]?.replace(/^Fixes:\s+/, ''),
      },
      { label: 'help', text: diagnosticDefinitions.FW201.help.split('\n')[1] },
    ]);
  };
  const expectedStaticExportError = [
    `Static export refused error diagnostic FW201 at ${fileName}:5:25. ${diagnosticDefinitions.FW201.message}`,
    diagnosticDefinitions.FW201.help,
  ].join('\n');
  const expectedStaticExportCliError = expectedStaticExportError.replaceAll('\n', ' ');

  const plugin = jisoVitePlugin();
  const greenTransform = viteTransformElementFact(plugin, {
    id: componentId,
    selector: { tag: 'button' },
    source: greenSource,
  });
  const greenButtons = greenTransform.elements.map((element) => element.attrs);
  assert.equal(greenTransform.mapIsNull, true);
  assert.deepEqual(greenButtons, [{ 'fw-c': 'diagnostic-card' }]);

  assert.throws(
    () => plugin.transform(redSource, componentId),
    (error) => {
      assertRedTransformMessage(String(error?.message ?? error));
      return true;
    },
  );

  const lintDiagnostics = [];
  const lintPlugin = jisoVitePlugin({
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
  assert.equal(lintButtons[0]?.['fw-c'], 'diagnostic-card');
  assert.equal(lintButtons[0]?.['data-p-ok'], '{response.ok}');
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
    [{ code: 'FW210', fileName, severity: 'lint' }],
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
    packageName: 'jiso-d10-vp-build-fixture',
    projectRoot,
    redSource,
    vitePluginImportUrl: pathToFileURL(join(projectRoot, 'dist/compiler/src/index.mjs')).href,
    vpExecutable: join(projectRoot, 'node_modules/.bin/vp'),
  });
  assertRedTransformMessage(buildFixture.redOutput);
  assert.deepEqual(buildFixture.greenDistEntries, ['assets', 'index.html']);

  const errorDiagnostic = {
    code: 'FW201',
    fileName,
    help: diagnosticDefinitions.FW201.help,
    message: diagnosticDefinitions.FW201.message,
    start: { column: 25, line: 5 },
  };
  const lintDiagnostic = {
    code: 'FW210',
    fileName,
    message: diagnosticDefinitions.FW210.message,
    start: { column: 25, line: 5 },
  };

  const exportBehavior = await fwExportStaticBehaviorFact({
    appCoreModuleUrl: pathToFileURL(join(projectRoot, 'dist/server/src/api/app-shell/core.mjs'))
      .href,
    createApp,
    errorDiagnostic,
    expectedStaticExportCliError,
    expectedStaticExportError,
    exportStaticApp,
    fixturePrefix: 'jiso-d10-fw-export-',
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
        attribute: 'data-fw-check-export',
        mainCount: 1,
        marker: 'api',
      },
      redArtifactWritten: false,
      redError: {
        code: 'FW201',
        diagnosticCodes: ['FW201'],
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
        version: 'fw-export/v1',
      },
      greenMarker: {
        attribute: 'data-fw-check-export',
        mainCount: 1,
        marker: 'cli',
      },
      red: {
        errors: [
          {
            code: 'FW201',
            message: expectedStaticExportCliError,
            route: fileName,
          },
        ],
        exitCode: 1,
        html: [],
        outputStream: 'stderr',
        version: 'fw-export/v1',
      },
      redArtifactWritten: false,
    },
  });

  const redMcp = await handleFwMcpRequest({
    id: 'd10-red',
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      arguments: { fileName, source: redSource },
      name: 'compile_component',
    },
  });
  assert.equal(redMcp.result.version, 'fw-mcp/v1');
  assert.equal(redMcp.result.structuredContent.version, 'compile/v1');
  assert.equal(redMcp.result.structuredContent.ok, false);
  assert.deepEqual(
    redMcp.result.structuredContent.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
    })),
    [
      { code: 'FW210', severity: 'lint' },
      { code: 'FW201', severity: 'error' },
    ],
  );

  const greenMcp = await handleFwMcpRequest({
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
        { code: 'FW210', severity: 'lint' },
        { code: 'FW201', severity: 'error' },
      ],
      id: 'd10-stdio-0',
      ok: false,
      version: 'fw-mcp/v1',
    },
    {
      contentVersion: 'compile/v1',
      diagnostics: [],
      id: 'd10-stdio-1',
      ok: true,
      version: 'fw-mcp/v1',
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
        'packages/drizzle/src/index.test.ts',
        '-t',
        [
          'extracts query result shapes, read domains, and instance keys from Drizzle selects',
          'reports FW410 for opaque query projections without declared output schemas',
          'omits instance keys when Drizzle query predicates do not target an annotated table key',
          'reports FW411 when a query read set includes an exempt table',
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
          code: 'FW410',
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
      code: 'FW410',
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
          code: 'FW411',
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
      code: 'FW411',
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
  assert.deepEqual(fragmentTarget('cart-row', { rowId: 'row-1' }), {
    props: { rowId: 'row-1' },
    target: 'cart-row',
  });

  const result = compileComponentModule({
    fileName: 'cart-row.tsx',
    source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});
`,
  });
  assert.deepEqual(result.componentGraphFacts, [
    {
      fragments: ['cart-row'],
      name: 'CartRow',
    },
  ]);
  await assertGeneratedRegistryConsumerTypes(
    result.files,
    `
import { fragmentTarget } from '@jiso/core';

const cartRow = fragmentTarget('cart-row', { rowId: 'row-1' });
cartRow.props.rowId.toUpperCase();

// @ts-expect-error generated FragmentTargets require rowId.
fragmentTarget('cart-row', {});

// @ts-expect-error generated FragmentTargets keep rowId typed as string.
fragmentTarget('cart-row', { rowId: 1 });

// @ts-expect-error generated FragmentTargets reject undeclared props.
fragmentTarget('cart-row', { rowId: 'row-1', sku: 'sku-1' });
`,
  );
});

void test('D9 FW235 fails fw-check for app-authored lowered IR component modules', async () => {
  const result = compileComponentModule({
    fileName: 'cart-badge.tsx',
    source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => \`<cart-badge fw-deps="cart"><span data-bind="cart.count">\${cart.count}</span></cart-badge>\`,
});
`,
  });
  const diagnostic = result.diagnostics.find((entry) => entry.code === 'FW235');
  assert.ok(diagnostic);

  assert.deepEqual(
    fwCheckAssertionFact(
      fwCheck({
        diagnostics: [
          {
            code: diagnostic.code,
            message: diagnostic.message,
            site: diagnostic.fileName,
            start: diagnostic.start,
          },
        ],
      }),
    ),
    {
      coverage: [],
      diagnostics: [
        {
          code: 'FW235',
          message:
            'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
          properties: {},
          severity: 'ERROR',
          target: 'cart-badge.tsx:4:25',
        },
      ],
      exitCode: 1,
      status: 'issues',
      version: 'fw-check/v1',
    },
  );
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
    fwCheck,
    rootPath: projectRootPath,
  });
  assert.deepEqual(commerceAcceptance.emitCheck, { stderr: '', stdout: '' });
  assert.deepEqual(commerceAcceptance.checklist, {
    emitCheckClean: true,
    fwCheckOk: true,
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
        { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
        { mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' },
        { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
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
    fwExplainQueryAssertionFact(
      fwExplain(commerceAcceptance.artifactGraph, { kind: 'query', target: 'cart' }),
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
    'app-shell-spike': '@jiso/conformance-app-shell-spike',
    'auth-spike': '@jiso/conformance-auth-spike',
    'better-auth-pin': '@jiso/conformance-better-auth-pin',
    'drizzle-pin': '@jiso/conformance-drizzle-pin',
    'webhook-spike': '@jiso/conformance-webhook-spike',
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

  await execFileAsync('pnpm', ['exec', 'vitest', '--run', 'packages/drizzle/src/index.test.ts'], {
    cwd: new URL('..', import.meta.url),
    maxBuffer: 1024 * 1024 * 10,
  });
});

void test('D3 deferred stream responses are consumed by the runtime', async () => {
  const compiled = compileComponentModule({
    fileName: 'cart-badge.tsx',
    source: `
export const CartBadge$isEmpty = derive(['cart'], (cart) => cart.count === 0);

export const CartBadge = component('cart-badge', {
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">0</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <output data-derive="cart.CartBadge$isEmpty">false</output>
      <button disabled={cart.count === 0}>Disabled</button>
      <ul data-bind-list="cart.items" fw-key="productId">
        <template fw-stamp>
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
        'reviews:p1': [{ attrs: { 'fw-key': 'r1' }, innerHtml: '5', tag: 'article' }],
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
import { component } from '@jiso/core';

function removeItem() {}

export const CartBadge = component('cart-badge', {
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
import { component } from '@jiso/core';

function removeItem() {}

export const CartDrawer = component('cart-drawer', {
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
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
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
          'fw-param-types': 'quantity:number',
        },
        {
          'data-p-id': '{item.id}',
          'data-p-selected': '{item.selected}',
          'fw-param-types': 'selected:boolean',
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
import { component } from '@jiso/core';

export const CartTotal = component('cart-total', {
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
    fwCheckAssertionFact(
      fwCheck({
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
      version: 'fw-check/v1',
    },
  );
});

void test('framework-owned browser suite is wired into acceptance', async () => {
  assert.deepEqual(await browserSuiteAcceptanceProjectFact({ rootPath: projectRootPath }), {
    acceptance: {
      browser: 'chromium',
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
      acceptanceBeforeFwCheck: true,
      ciAfterBuild: true,
      ciBeforeFwCheck: true,
    },
    presentInAcceptance: true,
    presentInCi: true,
    runFunction: true,
    scriptName: 'test:p10-perf',
    taskName: 'p10-perf',
  });
});
