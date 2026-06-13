import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
  assertOrderedItems,
  commandOutputLines,
  commandSequenceWithoutLast,
  conformanceGateFacts,
  nodeTaskCommand,
  loadVitePlusConfig,
  vitePlusAcceptanceTaskFacts,
  vitePlusTaskInputFacts,
  vitePlusTaskInputPatternEndingWith,
  vitestTaskCommand,
} from '../packages/test/src/command-fixtures.ts';
import {
  compilerDiagnosticFacts,
  compilerDiagnosticMessageFacts,
  compilerGeneratedQueryShapeFact,
  compilerQueryUpdatePlanFacts,
  compilerUpdateCoverageFacts,
} from '../packages/test/src/compiler-fixtures.ts';
import { viteLoweredEventDiagnosticFact } from '../packages/test/src/diagnostic-output-fixtures.ts';
import {
  fwExplainListField,
  fwExplainMutationAssertionFact,
  fwExplainPageAssertionFact,
  fwExplainQueryAssertionFact,
  fwExplainUpdateConsumers,
} from '../packages/test/src/fw-explain-fixtures.ts';
import {
  fwCheckAssertionFact,
  fwCheckCoverageAssertionFacts,
  fwCheckDiagnosticAssertionFacts,
  fwCheckOkAssertionFact,
} from '../packages/test/src/fw-check-fixtures.ts';
import { fwExportCliResultFact } from '../packages/test/src/fw-export-fixtures.ts';
import {
  executeGeneratedClientArtifact,
  executeGeneratedBootstrapModule,
  executeGeneratedClientModule,
  executeInlineEnhancedFormLoaderFixture,
  assertGeneratedRegistryConsumerTypes,
  generatedBootstrapDeferredBehaviorFact,
  generatedCssScopeRulesFromArtifact,
  generatedMinifierNamePreservationBehaviorFact,
  generatedQueryUpdatePlanBehaviorFact,
  generatedRenderEquivalenceBehaviorFact,
  generatedServerDeferredBehaviorFact,
  generatedTypedDataParamCoercionBehaviorFact,
  generatedWireDeferredBehaviorFact,
  generatedRegistryInterfaceMemberTypes,
  generatedRenderedElementFactsFromArtifact,
} from '../packages/test/src/generated-module-fixtures.ts';
import {
  graphComponentTargetFacts,
  graphFixtureFile,
  graphInvalidationFacts,
  graphMutationFact,
  graphOptimisticFacts,
  graphMutationUpdateConsumers,
  graphOptimisticStatusMatrix,
  graphStaticBehaviorFact,
  graphTouchGraphKeys,
} from '../packages/test/src/graph-fixtures.ts';
import {
  fwQueryFacts,
  htmlDocumentRegions,
  htmlElementFacts,
} from '../packages/test/src/html-fragment.ts';
import {
  markdownBoldSectionHeadings,
  markdownCanonicalSpecRuleTitles,
  markdownFields,
  markdownLeadingTitle,
  markdownNumberedListItems,
  markdownNumberedListTitles,
  markdownSection,
  markdownTableRows,
} from '../packages/test/src/markdown-fixtures.ts';
import { mcpCompileResponseFacts } from '../packages/test/src/mcp-fixtures.ts';
import {
  drizzleQueryBehaviorSourceFixtures,
  forbiddenBrowserArchitectureFacts,
  projectQueryBehaviorFacts,
  projectQueryDiagnosticFacts,
  projectTouchGraphBehaviorFacts,
  projectFileSources,
  projectJsonFile,
  projectPackageManifestFacts,
} from '../packages/test/src/source-fixtures.ts';
import { touchGraphProvenanceFact } from '../packages/test/src/touch-graph-fixtures.ts';
import {
  loadStarterTemplateFacts,
  runPnpmFilterTaskCommand,
  runStarterTemplateEmitGraph,
  runStarterTemplateGraphAssertions,
  runStarterTemplateViteTaskCommand,
  starterClientTemplateBehaviorFact,
  starterTemplateDevDependencyCoverage,
} from '../packages/test/src/starter-template-fixtures.ts';
import { loaderSmokeBehaviorFact } from '../packages/test/src/runtime-fixtures.ts';
import {
  viteGeneratedHandlerMiddlewareFact,
  viteHandlerTransformFact,
  vitePluginMiddlewareFact,
  viteRedGreenBuildFixtureFact,
  viteTransformElementFact,
} from '../packages/test/src/vite-fixtures.ts';
import { parseWireFixture, parseWireResponses } from '../packages/test/src/wire-fixtures.ts';
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

const generatedWireBodies = {
  'defer-stream.http': [
    `<!doctype html>
<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer><fw-defer target="recommendations:p1" state="pending"></fw-defer></product-page></main>

--jiso-boundary
<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</fw-query>
<fw-query name="recommendations" key="product:p1">{"items":[{"id":"rec-1"}]}</fw-query>
<fw-fragment target="reviews:p1" priority="5"><link rel="stylesheet" href="/assets/reviews.css"><section fw-c="reviews" fw-deps="product:p1"><article fw-key="r1">5</article></section></fw-fragment>
<fw-fragment target="recommendations:p1"><section fw-c="recommendations" fw-deps="product:p1"><article fw-key="rec-1">Beans</article></section></fw-fragment>
--jiso-boundary--
</body></html>
`,
  ],
  'enhanced-mutation.http': [
    `<fw-query name="cart" key="cart:c1" version="7">{"count":1,"items":[{"productId":"p1","qty":1,"unitPrice":1499}]}</fw-query>
<fw-fragment target="cart-badge"><cart-badge fw-deps="cart"><button commandfor="cart-drawer" command="show-modal"><span data-bind="cart.count">1</span></button></cart-badge></fw-fragment>
<fw-fragment target="recommendations"><section fw-c="recommendations" fw-deps="product:p1"></section></fw-fragment>
`,
  ],
  'no-js-post-redirect-get.http': [
    '',
    `<!doctype html>
<html><body><script type="application/json" fw-query="cart">{"count":1,"items":[{"productId":"p1","qty":1,"unitPrice":1499}]}</script><cart-badge fw-deps="cart"><span data-bind="cart.count">1</span></cart-badge></body></html>
`,
  ],
  'typed-read.http': ['<fw-query name="product:p1">{"name":"Mug","stock":4}</fw-query>\n'],
  'validation-422-fragment.http': [
    `<fw-fragment target="product-form:p1"><form fw-c="product-form" aria-invalid="true"><output role="alert" data-error-code="OUT_OF_STOCK">Only 5 left.</output><input name="productId" value="p1"><input name="quantity" value="99"></form></fw-fragment>
`,
  ],
};

const readWireFixture = async (name) =>
  readFile(new URL(`../fixtures/wire/${name}`, import.meta.url), 'utf8');

const readProjectFile = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
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

const assertHtmlMainMarker = (source, marker, message) => {
  assert.equal(
    htmlElementFacts(source).find((element) => element.tag === 'main')?.attrs[
      'data-fw-check-export'
    ],
    marker,
    message,
  );
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
  const fixtureNames = await readdir(new URL('../fixtures/wire/', import.meta.url));

  assert.deepEqual(fixtureNames.filter((name) => name.endsWith('.http')).sort(), [
    'defer-stream.http',
    'enhanced-mutation.http',
    'no-js-post-redirect-get.http',
    'typed-read.http',
    'validation-422-fragment.http',
  ]);

  for (const name of fixtureNames.filter((entry) => entry.endsWith('.http'))) {
    const transcript = parseWireFixture(await readWireFixture(name));
    assert.notEqual(transcript.title, '', `${name} names the scenario`);
    assert.notEqual(transcript.request.startLine, '', `${name} includes a request transcript`);
    assert.notEqual(transcript.response.startLine, '', `${name} includes a response transcript`);
  }

  for (const name of ['enhanced-mutation.http', 'validation-422-fragment.http']) {
    const transcript = parseWireFixture(await readWireFixture(name));
    assert.equal(
      transcript.request.headers['FW-Fragment'],
      'true',
      `${name} declares enhanced fragment mode`,
    );
    assert.equal(
      transcript.request.headers.Accept,
      'text/vnd.jiso.fragment+html',
      `${name} requests fragment HTML`,
    );
  }
});

void test('Phase 0 wire fixture response bodies match generated contracts byte-for-byte', async () => {
  for (const [name, expectedBodies] of Object.entries(generatedWireBodies)) {
    const responses = parseWireResponses(await readWireFixture(name));

    assert.equal(responses.length, expectedBodies.length, `${name} response count`);

    for (const [index, expectedBody] of expectedBodies.entries()) {
      assert.equal(responses[index].body, expectedBody, `${name} response ${index + 1} body`);
    }
  }
});

void test('Phase 0 wire fixture responses keep stable protocol metadata', async () => {
  const fixtures = {
    'defer-stream.http': [
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
        statusLine: 'HTTP/1.1 200 OK',
      },
    ],
    'enhanced-mutation.http': [
      {
        headers: {
          'content-type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'fw-changes': '[{"domain":"cart"}]',
          'fw-idem': 'idem_01HX',
        },
        statusLine: 'HTTP/1.1 200 OK',
      },
    ],
    'no-js-post-redirect-get.http': [
      {
        headers: {
          'cache-control': 'no-store',
          location: '/cart',
        },
        statusLine: 'HTTP/1.1 303 See Other',
      },
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
        statusLine: 'HTTP/1.1 200 OK',
      },
    ],
    'typed-read.http': [
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
        statusLine: 'HTTP/1.1 200 OK',
      },
    ],
    'validation-422-fragment.http': [
      {
        headers: {
          'content-type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'fw-idem': 'idem_01HY',
        },
        statusLine: 'HTTP/1.1 422 Unprocessable Content',
      },
    ],
  };

  for (const [name, expectedResponses] of Object.entries(fixtures)) {
    const responses = parseWireResponses(await readWireFixture(name));

    assert.equal(responses.length, expectedResponses.length, `${name} response count`);

    for (const [index, expected] of expectedResponses.entries()) {
      assert.equal(
        responses[index].statusLine,
        expected.statusLine,
        `${name} response ${index + 1} status`,
      );
      assert.deepEqual(
        responses[index].headersByName,
        expected.headers,
        `${name} response ${index + 1} headers`,
      );
    }
  }
});

void test('SSE remains a v2 backlog fixture, not a v1 wire contract', async () => {
  const fixtureNames = await readdir(new URL('../fixtures/wire/', import.meta.url));
  const wireResponses = await Promise.all(
    fixtureNames
      .filter((name) => name.endsWith('.http'))
      .map(async (name) => ({
        name,
        responses: parseWireResponses(await readWireFixture(name)),
      })),
  );

  assert.deepEqual(
    wireResponses.map(({ name, responses }) => ({
      contentTypes: responses.map((response) => response.headersByName['content-type'] ?? null),
      name,
    })),
    [
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
    ],
  );
  assert.deepEqual(
    wireResponses.flatMap(({ name, responses }) =>
      responses
        .filter((response) => response.headersByName['content-type'] === 'text/event-stream')
        .map(() => name),
    ),
    [],
  );
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
  const constitutionRows = markdownTableRows(
    markdownSection(spec, '2. The Constitution (Design Tests)'),
  );
  const specHardRuleTitles = markdownNumberedListTitles(
    markdownSection(spec, '5.2 Hard rules (normative)'),
  );
  const compilerRuleTitles = markdownCanonicalSpecRuleTitles(
    markdownNumberedListTitles(compilerRules),
  );
  const compilerRuleItems = markdownNumberedListItems(compilerRules);
  const cssContractHeadings = markdownBoldSectionHeadings(
    markdownSection(spec, '13. Open Design Areas (named, not hand-waved)'),
  );
  const behaviorFixture = compileComponentModule({
    fileName: 'components/docs/doc-card.tsx',
    source: `
import { component } from '@jiso/core';

function choose() {}

export const DocCard = component('doc-card', {
  fragmentTarget: true,
  css: \`
    .title { color: teal; }
  \`,
  render: () => <doc-card><button onClick={choose}>Choose</button><span class="title">Ready</span></doc-card>,
});
`,
  });
  const cssManifest = collectCssAssetManifest(behaviorFixture, { baseHref: '/_jiso/' });

  assert.deepEqual(markdownNumberedListTitles(constitution), [
    'Legibility is load-bearing',
    'Local code must not require global knowledge',
    'Sugar must lower to authorable IR',
    'The wire is the documentation',
    'Server truth always wins',
  ]);
  assert.deepEqual(
    constitutionRows.map((row) => row['#']),
    ['1', '2', '3', '4', '5'],
  );
  assert.deepEqual(
    constitutionRows.map((row) => markdownLeadingTitle(row.Test)),
    markdownCanonicalSpecRuleTitles(markdownNumberedListTitles(constitution)),
  );
  assert.deepEqual(compilerRuleTitles, [
    'Source-derived names',
    '1:1 file mapping',
    'Fixpoint invariant',
    'Platform-behavior emission',
    'Teaching errors',
    'TSX-only authoring',
  ]);
  assert.deepEqual(
    compilerRuleTitles,
    markdownCanonicalSpecRuleTitles(specHardRuleTitles).filter(
      (title) => title !== 'Registry atomicity',
    ),
  );
  assert.equal(
    compilerRuleItems.length,
    compilerRuleTitles.length,
    'compiler hard rules expose one numbered item per parsed title',
  );
  assert.deepEqual(cssContractHeadings, [
    { number: '13.1', title: 'CSS' },
    { number: '13.2', title: 'Lists at scale' },
    { number: '13.3', title: 'Streaming details' },
    { number: '13.4', title: 'Persistent cross-navigation elements' },
    { number: '13.5', title: "Adopt-don't-invent list" },
  ]);
  assert.deepEqual(behaviorFixture.handlerExports, ['DocCard$choose']);
  assert.doesNotThrow(() => assertRenderEquivalence(behaviorFixture));
  assert.equal(cssManifest.stylesheets[0]?.href, '/_jiso/components/docs/doc-card.css');
  assert.deepEqual(cssManifest.stylesheets[0]?.fragmentTargets, ['doc-card']);
  assert.deepEqual(generatedCssScopeRulesFromArtifact(behaviorFixture.files), [
    { limit: ':scope [fw-c]', raw: '@scope (doc-card) to (:scope [fw-c]) {', scope: 'doc-card' },
  ]);
});

void test('P10 legibility study packet is ready but not claimed complete', async () => {
  const study = await readProjectFile('docs/legibility-study.md');
  const fields = markdownFields(study);
  const tasks = markdownTableRows(markdownSection(study, 'Tasks'));
  const results = markdownTableRows(markdownSection(study, 'Results Ledger'));
  const readinessRows = markdownTableRows(markdownSection(study, 'Dated Study Readiness Ledger'));
  const localSessionChecks = markdownTableRows(markdownSection(study, 'Local Session Checklist'));
  const issues = markdownTableRows(markdownSection(study, 'Issues Ledger'));

  assert.equal(fields.get('Status'), 'protocol ready; recruitment, sessions, and results pending');
  assert.equal(
    fields.get('Required participants'),
    'five outside developers who have not worked on Jiso',
  );
  assert.equal(
    fields.get('Passing criterion'),
    'each participant answers every task from browser devtools artifacts alone in under 60 seconds',
  );
  assert.deepEqual(
    tasks.map((row) => row.Task),
    ['Button behavior', 'Island data', 'Mutation effects', 'Optimism', 'Failure path'],
  );
  assert.deepEqual(
    results.map((row) => row.Participant),
    ['pending-1', 'pending-2', 'pending-3', 'pending-4', 'pending-5'],
  );
  for (const row of results) {
    assert.equal(row.Date, 'TBD', `${row.Participant} is not dated as a completed study`);
    assert.equal(row.Commit, 'TBD', `${row.Participant} has no freeze-run commit`);
    assert.equal(row.Result, 'pending', `${row.Participant} remains pending`);
  }
  assert.equal(issues.length, 1);
  assert.equal(issues[0].Status, 'pending');
  assert.deepEqual(
    readinessRows.map((row) => row.Status),
    ['pending', 'pending'],
  );
  assert.deepEqual(
    localSessionChecks.map((row) => row.Step),
    ['1', '2', '3', '4', '5'],
  );
  assert.equal(
    localSessionChecks.every(
      (row) => row['Local check'].length > 0 && row['Evidence to retain outside repo if private'],
    ),
    true,
  );
});

void test('P10 v1 acceptance ledger tracks every freeze criterion', async () => {
  const ledger = await readProjectFile('docs/v1-acceptance.md');
  const spec = await readProjectFile('SPEC.md');
  const specCriteria = markdownNumberedListItems(
    markdownSection(spec, '16. Success Criteria (v1)'),
  ).map((item) => item.split(':')[0]);
  const gateRows = markdownTableRows(markdownSection(ledger, 'Required Gates'));
  const gatesByCriterion = new Map(gateRows.map((row) => [row['SPEC §16 criterion'], row]));
  const auditRows = markdownTableRows(markdownSection(ledger, 'Dated Ledger Audit'));
  const acceptanceRunRows = markdownTableRows(markdownSection(ledger, 'Acceptance Command Set'));
  const cleanCheckoutRows = markdownTableRows(
    markdownSection(ledger, 'Final Clean-Checkout Checklist'),
  );
  const auditStatuses = Object.fromEntries(auditRows.map((row) => [row.Area, row.Status]));

  assert.deepEqual(
    [...gatesByCriterion.keys()],
    specCriteria
      .map((criterion, index) => `16.${index + 1} ${criterion.replace(/ holds$/, '')}`)
      .concat('Pre-launch'),
  );
  assert.equal(
    gatesByCriterion.get('16.5 Coverage')['Current evidence artifact'],
    'Commerce matrix assertions in examples/commerce/src/app.test.ts and fw check optimistic output.',
  );
  assert.equal(
    gatesByCriterion.get('16.6 Navigation typed')['Current evidence artifact'],
    'Commerce route/link/redirect checks plus route-rename proof in packages/runtime/src/index.test.ts.',
  );
  assert.equal(
    gatesByCriterion.get('16.8 Update coverage')['Current evidence artifact'],
    'FW311/update-coverage graph assertions and fw check coverage output.',
  );
  assert.equal(gatesByCriterion.get('16.2 Legibility').Status, 'pending external study');
  assert.equal(gatesByCriterion.get('Pre-launch').Status, 'pending external checks');
  assert.deepEqual(
    acceptanceRunRows.map((row) => ({
      command: row.Command,
      commit: row.Commit,
      result: row.Result,
    })),
    [
      { command: 'pnpm run acceptance', commit: '5e693a7', result: 'passed' },
      { command: 'pnpm run acceptance', commit: '036e494', result: 'passed' },
      { command: 'pnpm run acceptance', commit: 'ec876f5', result: 'passed' },
      { command: 'pnpm run acceptance', commit: 'TBD at freeze run', result: 'pending' },
    ],
  );
  assert.deepEqual(
    {
      legibility: auditStatuses['Outside legibility study'],
      prelaunch: auditStatuses['Pre-launch external checks'],
      prelaunchHonesty: auditStatuses['Pre-launch ledger honesty'],
    },
    {
      legibility: 'pending external study',
      prelaunch: 'pending external checks',
      prelaunchHonesty: 'packet ready; external evidence pending',
    },
  );
  assert.ok(acceptanceRunRows.length >= 4);
  assert.equal(
    acceptanceRunRows.slice(0, -1).every((row) => row.Result === 'passed'),
    true,
  );
  assert.equal(
    acceptanceRunRows.filter(
      (row) => row.Result === 'pending' && row.Commit === 'TBD at freeze run',
    ).length,
    1,
  );
  assert.equal(
    auditRows.filter((row) => row.Status === 'passed local run').length,
    acceptanceRunRows.filter((row) => row.Result === 'passed').length,
    'each passed local acceptance row has a matching dated audit row',
  );
  assert.equal(
    auditRows.filter((row) => row.Status.startsWith('pending')).length,
    2,
    'only the external-evidence blockers are pending audit rows',
  );
  assert.equal(
    auditRows.some(
      (row) => row.Area === 'Local integration acceptance' && row.Status === 'pending',
    ),
    false,
    'the pending final clean-checkout run is not claimed as a dated audit row',
  );
  assert.deepEqual(
    cleanCheckoutRows.map((row) => row.Status),
    ['pending', 'pending', 'pending', 'pending', 'pending', 'pending'],
  );
});

void test('pre-launch checklist is tracked explicitly', async () => {
  const checklist = await readProjectFile('docs/prelaunch-checklist.md');
  const requiredChecks = markdownTableRows(markdownSection(checklist, 'Required Checks'));
  const auditRows = markdownTableRows(markdownSection(checklist, 'Dated Audit Ledger'));
  const runnableChecks = markdownTableRows(markdownSection(checklist, 'Runnable Local Checklist'));
  const evidenceLedgers = {
    Domain: markdownTableRows(markdownSection(checklist, 'Domain Evidence Ledger'))[0],
    'Linguistic screen': markdownTableRows(
      markdownSection(checklist, 'Linguistic Evidence Ledger'),
    )[0],
    'npm scope': markdownTableRows(markdownSection(checklist, 'npm Scope Evidence Ledger'))[0],
    'Trademark screen': markdownTableRows(
      markdownSection(checklist, 'Trademark Evidence Ledger'),
    )[0],
  };
  const auditStatuses = Object.fromEntries(auditRows.map((row) => [row.Reviewer, row.Status]));

  assert.deepEqual(
    requiredChecks.map((row) => row.Check),
    ['Trademark screen', 'Domain', 'npm scope', 'Linguistic screen'],
  );
  assert.deepEqual(
    Object.keys(evidenceLedgers).toSorted((left, right) => left.localeCompare(right)),
    requiredChecks.map((row) => row.Check).toSorted((left, right) => left.localeCompare(right)),
  );
  for (const row of requiredChecks) {
    assert.equal(row.Status, 'pending', `${row.Check} remains pending`);
    assert.ok(evidenceLedgers[row.Check], `${row.Check} has a dedicated evidence ledger row`);
  }
  assert.equal(evidenceLedgers.Domain.Domain, 'jiso.dev');
  assert.equal(evidenceLedgers['npm scope'].Scope, '@jiso');
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(evidenceLedgers).map(([check, row]) => [
        check,
        {
          date: row.Date,
          reviewer: row.Reviewer,
          status: row.Status,
        },
      ]),
    ),
    {
      Domain: { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
      'Linguistic screen': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
      'Trademark screen': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
      'npm scope': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
    },
  );
  assert.deepEqual(
    {
      linguisticMarkets: evidenceLedgers['Linguistic screen']['Markets or languages'],
      trademarkSources: evidenceLedgers['Trademark screen'].Sources,
    },
    {
      linguisticMarkets: 'TBD',
      trademarkSources: 'TBD',
    },
  );
  assert.equal(auditStatuses.Codex, 'packet ready; external evidence pending');
  assert.deepEqual(
    runnableChecks.map((row) => row.Status),
    ['pending', 'pending', 'pending', 'pending'],
  );
  assert.deepEqual(
    Object.values(evidenceLedgers).map((row) => row.Status),
    ['pending', 'pending', 'pending', 'pending'],
  );
  assert.equal(
    auditRows.filter((row) => row.Status === 'packet ready; external evidence pending').length,
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
  const documentRegions = htmlDocumentRegions(document.html);
  const documentQueryScripts = fwQueryFacts(document.html, 'cart');
  const headQueryScripts = fwQueryFacts(documentRegions.head.innerHtml, 'cart');
  const bodyElements = htmlElementFacts(documentRegions.body.innerHtml);

  assert.equal(renderQueryScript(query), queryScript);
  assert.equal(renderDocumentQueryScript(query), queryScript);
  assert.deepEqual(
    headQueryScripts.map((script) => ({
      attrs: script.attrs,
      rawJson: script.rawJson,
    })),
    [
      {
        attrs: {
          'fw-query': 'cart',
          key: 'cart:c1',
          type: 'application/json',
        },
        rawJson: '{"html":"\\u003c/script>"}',
      },
    ],
  );
  assert.deepEqual(bodyElements, [
    { attrs: {}, html: '<main></main>', innerHtml: '', tag: 'main' },
  ]);
  assert.deepEqual(documentQueryScripts[0]?.attrs, {
    'fw-query': 'cart',
    key: 'cart:c1',
    type: 'application/json',
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
  // SPEC §4.2: identity is emitted explicitly on native hosts (fw-c).
  const renderedElements = generatedRenderedElementFactsFromArtifact(result.files);
  const renderedImage = renderedElements.find((element) => element.tag === 'img');
  assert.deepEqual(renderedImage?.attrs, {
    'fw-c': 'product-card',
    src: '/p1.png',
    style: 'opacity: .8; view-transition-name: product-p1-image',
  });
  assert.equal(
    renderedElements.filter((element) => Object.hasOwn(element.attrs, 'style')).length,
    1,
  );
  assert.equal(renderedImage?.attrs.viewTransitionName, undefined);
  assert.deepEqual(await generatedRegistryInterfaceMemberTypes(result.files, 'ViewTransitions'), {
    'product-p1-image': 'unknown',
  });
});

void test('P1 compiler validates component-scoped IDREFs', async () => {
  assert.equal(
    diagnosticDefinitions.FW221.message,
    'IDREF references an id not present in component scope.',
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-search.tsx',
      source: `
import { component } from '@jiso/core';

export const CartSearch = component('cart-search', {
  render: () => (
    <section>
      <label for="cart-query">Search</label>
      <input id="cart-query" aria-describedby="cart-help" />
      <p id="cart-help">Help</p>
    </section>
  ),
});
`,
    }).diagnostics,
    [],
  );
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/cart/cart-search.tsx',
        source: `
import { component } from '@jiso/core';

export const CartSearch = component('cart-search', {
  render: () => (
    <section>
      <label for="missing-label">Search</label>
      <input id="cart-query" aria-describedby="cart-help missing-help" />
      <p id="cart-help">Help</p>
      <button popovertarget="missing-popover">Filters</button>
    </section>
  ),
});
`,
      }).diagnostics,
      ['FW221'],
    ),
    [
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
    ],
  );
});

void test('P1 compiler validates static id uniqueness', async () => {
  assert.equal(
    diagnosticDefinitions.FW224.message,
    'Static id appears in a repeatable component or duplicate page composition.',
  );
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/cart/cart-shell.tsx',
        source: `
import { component } from '@jiso/core';

export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <h2 id="cart-title">Cart</h2>
      <output id="cart-title">2 items</output>
    </section>
  ),
});
`,
      }).diagnostics,
      ['FW224'],
    ),
    [
      {
        code: 'FW224',
        fileName: 'components/cart/cart-shell.tsx',
        message: `${diagnosticDefinitions.FW224.message} duplicate id="cart-title"`,
        severity: 'error',
      },
    ],
  );
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/cart/cart-list.tsx',
        source: `
import { component } from '@jiso/core';

export const CartList = component('cart-list', {
  render: () => (
    <ul data-bind-list="cart.items" fw-key="productId">
      <template fw-stamp>
        <li id="cart-row"><span data-bind=".name">Mug</span></li>
      </template>
    </ul>
  ),
});
`,
      }).diagnostics,
      ['FW224'],
    ),
    [
      {
        code: 'FW224',
        fileName: 'components/cart/cart-list.tsx',
        message: `${diagnosticDefinitions.FW224.message} repeatable id="cart-row"`,
        severity: 'error',
      },
    ],
  );
});

void test('P1 compiler validates HTML content-model parser stability', async () => {
  assert.equal(diagnosticDefinitions.FW225.message, 'JSX nesting violates the HTML content model.');
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-table.tsx',
      registryFacts: {
        components: ['cart-row'],
      },
      source: `
import { component } from '@jiso/core';

export const CartTable = component('cart-table', {
  render: () => (
    <table>
      <tbody>
        <tr fw-c="cart-row">
          <td>Cart row</td>
        </tr>
      </tbody>
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
        fileName: 'components/cart/cart-shell.tsx',
        source: `
import { component } from '@jiso/core';

export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <p>
        Cart intro
        <div>Parser closes the paragraph before this div.</div>
      </p>
      <tr>
        <td>Detached row</td>
      </tr>
    </section>
  ),
});
`,
      }).diagnostics,
      ['FW225'],
    ),
    [
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
    ],
  );
});

void test('P1 compiler validates declared execution trigger names', async () => {
  assert.equal(
    diagnosticDefinitions.FW211.message,
    'on:load eager trigger requires a justification comment.',
  );
  assert.equal(
    diagnosticDefinitions.FW212.message,
    'Unknown on:* event or execution trigger name.',
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/execution-triggers.tsx',
      source: `
import { component } from '@jiso/core';

export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      <button on:click="/c/cart.client.js#Cart$add">Add</button>
      <search-index on:idle="/c/search.client.js#Search$warm"></search-index>
      <sales-chart on:visible="/c/chart.client.js#SalesChart$mount"></sales-chart>
      {/* FW211: stock ticker intentionally starts at parse for market-open pages. */}
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
    }).diagnostics,
    [],
  );
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/execution-triggers.tsx',
        source: `
import { component } from '@jiso/core';

export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
      <video-player on:media="/c/video.client.js#Video$mount"></video-player>
    </section>
  ),
});
`,
      }).diagnostics,
      ['FW211', 'FW212'],
    ),
    [
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
    ],
  );
});

void test('P1 compiler validates residual fw-c and fw-deps stamps', async () => {
  assert.equal(
    diagnosticDefinitions.FW226.message,
    'fw-deps or fw-c names an unknown query instance or component.',
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/recommendations.tsx',
      source: `
import { component } from '@jiso/core';

export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section fw-c="recommendations" fw-deps="cart">{cart.count}</section>
  ),
});
`,
    }).diagnostics,
    [],
  );
  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/recommendations.tsx',
        source: `
import { component } from '@jiso/core';

export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section fw-c="unknown-component" fw-deps="cart missingQuery:p1">{cart.count}</section>
  ),
});
`,
      }).diagnostics,
      ['FW226'],
    ),
    [
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
    ],
  );
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
  assert.equal(
    href('/products/:id', { params: { id: 'p 1' }, search: { max: 10 } }),
    '/products/p%201?max=10',
  );
  assert.deepEqual(redirect('/products/:id', { params: { id: 'p1' } }), {
    location: '/products/p1',
    status: 303,
  });
  assert.deepEqual(route('/products/:id'), { path: '/products/:id' });
  assert.deepEqual(Link('/products/:id', { params: { id: 'p1' } }), { href: '/products/p1' });
  const declaredRoute = serverRoute('/products/:id', { load: () => 'ok' });
  assert.equal(declaredRoute.path, '/products/:id');
  assert.equal(typeof declaredRoute.load, 'function');

  const lowered = compileComponentModule({
    fileName: 'components/product-links.tsx',
    registryFacts: {
      routes: ['/cart', '/products/:id'],
    },
    source: `
import { component, href, Link } from '@jiso/core';

export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <Link to="/products/:id" params={{ id: 'p 1' }} search={{ max: 500 }}>Product</Link>
      <a href={href('/cart')}>Cart</a>
    </nav>
  ),
});
`,
  });
  assert.deepEqual(lowered.diagnostics, []);
  const renderedLinks = generatedRenderedElementFactsFromArtifact(lowered.files, { tag: 'a' });
  assert.deepEqual(
    renderedLinks.map((element) => element.attrs.href),
    ['/products/p%201?max=500', '/cart'],
  );

  await assertGeneratedRegistryConsumerTypes(
    lowered.files,
    `
import { href, Link, redirect, route } from '@jiso/core';

href('/cart', {});
href('/products/:id', { params: { id: 'p 1' }, search: { max: 500 } });
redirect('/products/:id', { params: { id: 'p1' } });
route('/products/:id');
Link('/cart', {});
Link('/products/:id', { params: { id: 'p1' } });

// @ts-expect-error generated RouteRegistry requires params for dynamic routes.
href('/products/:id', {});

// @ts-expect-error generated RouteRegistry keeps id params typed as string.
href('/products/:id', { params: { id: 1 } });

// @ts-expect-error generated RouteRegistry rejects undeclared routes.
href('/checkout', {});
`,
  );

  assert.deepEqual(
    compilerDiagnosticFacts(
      compileComponentModule({
        fileName: 'components/product-links.tsx',
        registryFacts: {
          routes: ['/cart', '/products/:id'],
        },
        source: `
import { component } from '@jiso/core';

export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <a href="/product/p1">Bad</a>
      <form method="get" action="/checkout"></form>
    </nav>
  ),
});
`,
      }).diagnostics,
      ['FW220'],
    ),
    [
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
  const first = {
    browserState: {
      focused: true,
      scroll: { left: 4, top: 24 },
      selection: { direction: 'forward', end: 3, start: 1 },
    },
    children: [{ key: 'label', text: 'Alpha', type: 'span' }],
    key: 'p1',
    type: 'article',
  };
  const second = {
    children: [{ key: 'label', text: 'Beta', type: 'span' }],
    key: 'p2',
    type: 'article',
  };
  const current = { children: [first, second], type: 'section' };

  morphStructuralTree(current, {
    children: [
      {
        children: [{ key: 'label', text: 'Beta next', type: 'span' }],
        key: 'p2',
        type: 'article',
      },
      {
        children: [{ key: 'label', text: 'Alpha next', type: 'span' }],
        key: 'p1',
        type: 'article',
      },
      { key: 'p3', text: 'Gamma', type: 'article' },
    ],
    type: 'section',
  });

  assert.strictEqual(current.children[0], second);
  assert.strictEqual(current.children[1], first);
  assert.deepEqual(current.children[1].browserState, {
    focused: true,
    scroll: { left: 4, top: 24 },
    selection: { direction: 'forward', end: 3, start: 1 },
  });
  assert.equal(current.children[1].children[0].text, 'Alpha next');

  const target = {
    html: '<article fw-key="p1">Old</article>',
    appendHtml(html) {
      this.html += html;
    },
    readHtml() {
      return this.html;
    },
    replaceWithHtml(html) {
      this.html = html;
    },
  };
  const root = {
    findFragmentTarget(fragmentTarget) {
      return fragmentTarget === 'products' ? target : null;
    },
  };
  const store = createQueryStore();
  const result = applyMutationResponseToDom({
    body: [
      '<fw-query name="productGrid" key="category:all">{"count":2}</fw-query>',
      '<fw-fragment target="products" mode="append"><article fw-key="p2">New</article></fw-fragment>',
      '<fw-fragment target="missing"><article>Ignored</article></fw-fragment>',
    ].join('\n'),
    root,
    store,
  });

  assert.deepEqual(result.appliedFragments, ['products']);
  assert.deepEqual(store.get('productGrid', 'category:all'), { count: 2 });
  assert.equal(target.html, '<article fw-key="p1">Old</article><article fw-key="p2">New</article>');
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
  const listeners = new Map();
  const lifecycleRoot = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const pendingElement = {
    attributes: { 'fw-deps': 'cart' },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const pendingRoot = {
    querySelectorAll(selector) {
      return selector === '[fw-deps]' ? [pendingElement] : [];
    },
  };
  const store = createQueryStore();
  const rebaser = new OptimisticRebaser(store);
  store.set('cart', { count: 1 });

  const dispose = installPagehideOptimismCleanup({
    discardPendingOptimism() {
      const discarded = rebaser.discardPendingOptimism();
      stampPendingQueries(pendingRoot, discarded, false);
      return discarded;
    },
    root: lifecycleRoot,
  });
  assert.equal(listeners.has('pagehide'), true);
  assert.equal(listeners.has('unload'), false);

  let fetchOptions;
  let releaseFetch;
  const formData = new FormData();
  formData.set('quantity', '2');
  const submit = submitOptimisticEnhancedMutation({
    fetch(_url, options) {
      fetchOptions = options;
      return new Promise((resolve) => {
        releaseFetch = () => {
          resolve({
            headers: { get: () => null },
            async text() {
              return '<fw-query name="cart">{"count":2}</fw-query>';
            },
          });
        };
      });
    },
    form: { action: '/_m/cart/add', method: 'post' },
    formData,
    idem: 'idem_bfcache',
    input: { quantity: 2 },
    optimistic: {
      transforms: {
        cart(current, input) {
          return { count: current.count + input.quantity };
        },
      },
    },
    pendingRoot,
    rebaser,
    root: {
      findFragmentTarget() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    store,
  });

  assert.deepEqual(store.get('cart'), { count: 3 });
  assert.equal(rebaser.pendingCount('cart'), 1);
  assert.deepEqual(fetchOptions, {
    body: formData,
    headers: {
      Accept: 'text/vnd.jiso.fragment+html',
      'FW-Fragment': 'true',
      'FW-Idem': 'idem_bfcache',
      'FW-Targets': '',
    },
    keepalive: true,
    method: 'POST',
  });
  assert.deepEqual(pendingElement.attributes, {
    'aria-busy': 'true',
    'fw-deps': 'cart',
    'fw-pending': '',
  });

  listeners.get('pagehide')?.({ target: null, type: 'pagehide' });
  assert.deepEqual(store.get('cart'), { count: 1 });
  assert.equal(rebaser.pendingCount('cart'), 0);
  assert.deepEqual(pendingElement.attributes, { 'fw-deps': 'cart' });

  releaseFetch();
  assert.deepEqual(await submit, {
    appliedFragments: [],
    changes: [],
    fragments: [],
    idem: 'idem_bfcache',
    queries: ['cart'],
    targets: [],
  });
  assert.deepEqual(store.get('cart'), { count: 2 });
  assert.equal(rebaser.pendingCount('cart'), 0);

  dispose();
  assert.equal(listeners.has('pagehide'), false);
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
  const starterFacts = await loadStarterTemplateFacts(starterTemplatePaths);
  const appSource = starterFacts.appSource;
  const clientSource = starterFacts.clientSource;
  assert.equal(typeof appSource, 'string');
  assert.equal(typeof clientSource, 'string');
  const packageFacts = starterFacts.package;
  const viteTasks = starterFacts.viteTasks;
  const starterGraph = starterFacts.graph;
  const cartQueryExplain = fwExplain(starterGraph, { kind: 'query', target: 'cart' });
  const cartAddExplain = fwExplain(starterGraph, {
    kind: 'mutation',
    optimistic: true,
    target: 'cart/add',
  });
  const cartPageExplain = fwExplain(starterGraph, { kind: 'page', target: '/cart' });

  assert.equal(packageFacts.scripts['emit-graph'], 'node scripts/emit-graph.mjs');
  assert.equal(packageFacts.scripts['fw-check'], undefined);
  assert.equal(packageFacts.scripts['graph-assertions'], undefined);
  assert.deepEqual(packageFacts.dependencies, [
    '@jiso/better-auth',
    '@jiso/core',
    '@jiso/runtime',
    '@jiso/server',
  ]);
  assert.deepEqual(
    starterTemplateDevDependencyCoverage(packageFacts, [
      '@jiso/compiler',
      '@tailwindcss/vite',
      '@typescript/native-preview',
      'fw',
      'tailwindcss',
      'typescript',
      'vite',
      'vite-plus',
      'vitest',
    ]),
    {
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
    },
  );

  assert.deepEqual(fwCheckOkAssertionFact(fwCheck(starterGraph)), {
    exitCode: 0,
    issueCount: 0,
    status: 'ok',
    version: 'fw-check/v1',
  });
  assert.deepEqual(
    starterGraph.components?.map((component) => component.name),
    ['CartBadge', 'CartPanel'],
  );
  assert.deepEqual(starterGraph.mutations, [
    {
      guards: ['authed'],
      invalidates: ['cart'],
      inputFields: ['productId', 'quantity'],
      key: 'cart/add',
      session: 'starterSession',
      writes: ['cart'],
    },
  ]);
  assert.deepEqual(starterGraph.optimistic, [
    { mutation: 'cart/add', query: 'cart', status: 'await-fragment' },
  ]);
  assert.deepEqual(starterGraph.pages, [
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
  assert.deepEqual(starterGraph.queries, [{ domains: ['cart'], query: 'cart' }]);
  assert.deepEqual(starterGraph.touchGraph?.['cart.addItem']?.touches, [
    { domain: 'cart', keys: null, site: 'src/cart.ts:12', via: 'cart_items' },
  ]);
  assert.deepEqual(fwExplainQueryAssertionFact(cartQueryExplain), {
    consumers: ['component:CartBadge', 'component:CartPanel', 'page:/cart'],
    domainWrites: ['cart.addItem'],
    exitCode: 0,
    invalidatedBy: ['cart/add'],
    reads: ['cart'],
    subject: 'QUERY cart',
    version: 'fw-explain/v1',
  });
  assert.deepEqual(fwExplainMutationAssertionFact(cartAddExplain), {
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
  assert.deepEqual(fwExplainPageAssertionFact(cartPageExplain), {
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

  assert.deepEqual(
    {
      input: viteTasks['fw-check']?.input,
      output: viteTasks['fw-check']?.output,
    },
    {
      input: [
        { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
        { pattern: 'src/**/*', base: 'workspace' },
      ],
      output: ['graph.json'],
    },
  );
  assert.deepEqual(
    {
      input: viteTasks['graph-assertions']?.input,
      output: viteTasks['graph-assertions']?.output,
    },
    {
      input: [
        { pattern: 'graph.json', base: 'workspace' },
        { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
        { pattern: 'scripts/graph-assertions.mjs', base: 'workspace' },
        { pattern: 'src/**/*', base: 'workspace' },
      ],
      output: undefined,
    },
  );
  assert.deepEqual(starterFacts.ciRunCommands, [
    'vp install',
    'vp check',
    'vp test',
    'vp run build',
    'vp run fw-check',
    'vp run graph-assertions',
  ]);

  const taskOutputs = await Promise.all([
    runStarterTemplateViteTaskCommand(
      viteTasks['fw-check'].command,
      starterTemplatePaths,
      starterTemplateFwOutputs,
    ),
    runStarterTemplateViteTaskCommand(
      viteTasks['graph-assertions'].command,
      starterTemplatePaths,
      starterTemplateFwOutputs,
    ),
  ]);
  assert.deepEqual(
    taskOutputs.map((taskOutput) => taskOutput.output),
    ['emit-graph/v1\nOK\nfw-check/v1\nOK\n', 'emit-graph/v1\nOK\ngraph-assertions/v1\nOK\n'],
  );
  assert.deepEqual(
    taskOutputs.map((taskOutput) => taskOutput.graph),
    [starterGraph, starterGraph],
  );

  const emittedGraph = await runStarterTemplateEmitGraph(starterTemplatePaths);
  assert.equal(emittedGraph.output, 'emit-graph/v1\nOK\n');
  assert.deepEqual(emittedGraph.graph, starterGraph);
  assert.equal(
    await runStarterTemplateGraphAssertions(starterTemplatePaths, starterTemplateFwOutputs),
    'graph-assertions/v1\nOK\n',
  );

  const starterAppCompile = compileComponentModule({
    fileName: 'src/app.tsx',
    source: appSource,
  });
  assert.doesNotThrow(() => assertFixpoint(starterAppCompile));
  assert.doesNotThrow(() => assertRenderEquivalence(starterAppCompile));

  assert.deepEqual(await starterClientTemplateBehaviorFact(clientSource), {
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

  assert.deepEqual(starterFacts.cssDirectives, [
    '"../index.html"',
    '"./**/*.{ts,tsx,html}"',
    'inline("bg-emerald-50 text-emerald-700 border-emerald-200 bg-amber-50 text-amber-700 border-amber-200")',
  ]);
  assert.deepEqual(starterFacts.indexHtml.tags, [
    'html',
    'head',
    'meta',
    'meta',
    'link',
    'title',
    'body',
  ]);
  assert.deepEqual(starterFacts.indexHtml.htmlAttrs, { lang: 'en' });
  assert.deepEqual(starterFacts.indexHtml.metaAttrs, [
    { charset: 'UTF-8' },
    { content: 'width=device-width, initial-scale=1.0', name: 'viewport' },
  ]);
  assert.deepEqual(starterFacts.indexHtml.linkAttrs, [
    { rel: 'stylesheet', href: '/src/styles.css' },
  ]);
  assert.deepEqual(starterFacts.indexHtml.scriptAttrs, []);

  execFileSync('pnpm', ['exec', 'vitest', '--run', 'packages/create-jiso/src/index.test.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, CI: '1' },
    stdio: 'pipe',
  });
});

void test('P9 verification layer evidence remains represented', async () => {
  const createFakeDb = () => {
    const tables = new Map();
    return {
      read(table, options) {
        void options;
        return tables.get(table) ?? [];
      },
      sql() {
        return [];
      },
      write(table, value, options) {
        void options;
        tables.set(table, [...(tables.get(table) ?? []), value]);
      },
    };
  };
  const assertThrowsMessage = (callback, expected) => {
    assert.throws(callback, (error) => error instanceof Error && error.message === expected);
  };
  const assertRejectsMessage = (promise, expected) =>
    assert.rejects(promise, (error) => error instanceof Error && error.message === expected);

  for (const code of ['FW402', 'FW404', 'FW407', 'FW408', 'FW410', 'FW411']) {
    assert.equal(typeof diagnosticDefinitions[code].message, 'string');
  }

  const csrfRequest = { session: { id: 's1' } };
  const csrf = {
    field: 'csrf',
    secret: 'test-secret',
    sessionId(request) {
      return request.session.id;
    },
  };
  let csrfMutationExecutions = 0;
  const csrfMutation = mutation('cart/add', {
    csrf,
    input: s.object({ csrf: s.string(), productId: s.string() }),
    handler(input) {
      csrfMutationExecutions += 1;
      return input.productId;
    },
  });
  const csrfHarness = createJisoTestHarness({
    db: {},
    request: csrfRequest,
  });
  const token = csrfToken(csrfRequest, csrf);
  assert.equal(csrfField(csrfRequest, csrf), `<input type="hidden" name="csrf" value="${token}">`);
  assert.deepEqual(await csrfHarness.exec(csrfMutation, { csrf: token, productId: 'p1' }), {
    changes: [],
    ok: true,
    rerunQueries: [],
    value: 'p1',
  });
  assert.equal(csrfMutationExecutions, 1);
  assert.deepEqual(await csrfHarness.exec(csrfMutation, { csrf: 'wrong', productId: 'p2' }), {
    error: { code: 'CSRF', payload: {} },
    ok: false,
    status: 422,
  });
  assert.equal(csrfMutationExecutions, 1);

  const writeMutation = mutation('cart/add', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    handler(input, request) {
      request.db.write('cart_items', input.productId);
      return input.productId;
    },
  });
  const writeHarness = createJisoTestHarness({
    db: createFakeDb(),
    touchGraph: {
      'cart.add': {
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
        unresolved: [],
      },
    },
    verification: { domainByTable: { audit_log: 'audit', cart_items: 'cart' } },
  });
  assert.deepEqual(
    await writeHarness.exec(writeMutation, { productId: 'p1' }, { touchGraphKey: 'cart.add' }),
    {
      changes: [],
      ok: true,
      rerunQueries: [],
      value: 'p1',
    },
  );

  const writeOutsideGraph = mutation('cart/add', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    handler(input, request) {
      request.db.write('audit_log', input.productId);
      return input.productId;
    },
  });
  await assertRejectsMessage(
    writeHarness.exec(writeOutsideGraph, { productId: 'p1' }, { touchGraphKey: 'cart.add' }),
    'FW402 Write touched an undeclared domain: audit',
  );

  const unmappedVerifier = createDbVerifier(
    { write: { touches: [], unresolved: [] } },
    { domainByTable: {} },
  );
  const unmappedDb = unmappedVerifier.wrap(createFakeDb());
  unmappedDb.write('unknown_table', 'p1');
  assertThrowsMessage(
    () => unmappedVerifier.assertCovered('write'),
    'FW404 Write to unmapped table: unknown_table',
  );

  const exemptWriteVerifier = createDbVerifier(
    {},
    { domainByTable: {}, exemptTables: ['audit_log'] },
  );
  const exemptWriteDb = exemptWriteVerifier.wrap(createFakeDb());
  exemptWriteDb.write('audit_log', { event: 'restock' });
  assert.doesNotThrow(() => exemptWriteVerifier.assertCovered());

  const exemptReadVerifier = createDbVerifier(
    {},
    { domainByTable: { cart_items: 'cart' }, exemptTables: ['audit_log'] },
  );
  const exemptReadDb = exemptReadVerifier.wrap(createFakeDb());
  exemptReadDb.read('audit_log');
  assertThrowsMessage(
    () => exemptReadVerifier.assertReadsCovered(['cart']),
    'FW411 Query read set includes an exempt table: audit_log',
  );

  const cart = domain('cart');
  const product = domain('product');
  const queryHarness = createJisoTestHarness({
    db: createFakeDb(),
    touchGraph: {},
    verification: {
      domainByTable: { audit_log: 'audit', cart_items: 'cart', products: 'product' },
    },
  });
  const undeclaredReadQuery = query('cart', {
    load() {
      queryHarness.db.read('products');
      return queryHarness.db.read('cart_items');
    },
    reads: [cart],
  });
  await assertRejectsMessage(
    queryHarness.query(undeclaredReadQuery),
    'FW407 Query read from undeclared domain: product',
  );
  const validOutputQuery = query('cart/count', {
    load() {
      queryHarness.db.read('cart_items');
      return { count: 2 };
    },
    output: s.object({ count: s.number().int().min(0) }),
    reads: [cart],
  });
  assert.deepEqual(await queryHarness.query(validOutputQuery), { count: 2 });
  const invalidOutputQuery = query('product/list', {
    load() {
      queryHarness.db.read('products');
      return { items: [{ id: 7 }] };
    },
    output: s.object({ items: s.array(s.object({ id: s.string() })) }),
    reads: [product],
  });
  await assertRejectsMessage(
    queryHarness.query(invalidOutputQuery),
    'FW410 Query result shape failed declared output schema: product/list Expected string',
  );
  const exemptRawSqlQuery = query('cart/audit', {
    load() {
      exemptRawSqlHarness.db.sql('select * from audit_log');
      return [];
    },
    reads: [cart],
  });
  const exemptRawSqlHarness = createJisoTestHarness({
    db: createFakeDb(),
    touchGraph: {},
    verification: { domainByTable: { cart_items: 'cart' }, exemptTables: ['audit_log'] },
  });
  await assertRejectsMessage(
    exemptRawSqlHarness.query(exemptRawSqlQuery),
    'FW411 Query read set includes an exempt table: audit_log',
  );

  const structuredSqlVerifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
  const structuredStatementCalls = [];
  const structuredSqlDb = structuredSqlVerifier.wrap({
    exec(statement) {
      structuredStatementCalls.push(statement);
      return [];
    },
    query() {
      return [];
    },
  });
  const structuredStatement = { text: 'select * from cart_items', values: ['c1'] };
  structuredSqlDb.exec(structuredStatement);
  assert.deepEqual(structuredStatementCalls, [structuredStatement]);
  assert.deepEqual(structuredSqlVerifier.observed, [
    {
      branch: undefined,
      domain: 'cart',
      kind: 'read',
      mutationRead: undefined,
      rowKey: undefined,
      sql: 'select * from cart_items',
      table: 'cart_items',
    },
  ]);

  const nestedVerifier = createDbVerifier(
    {
      'product.syncPrice': {
        reads: [
          {
            domain: 'price',
            keys: null,
            site: 'product.ts:2',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [{ domain: 'product', keys: null, site: 'product.ts:1', via: 'products' }],
        unresolved: [],
      },
    },
    { domainByTable: { prices: 'price', products: 'product' } },
  );
  const nestedDb = nestedVerifier.wrap(createFakeDb());
  nestedDb.sql(
    'update products set price = prices.amount from prices where prices.product_id = products.id',
  );
  assert.doesNotThrow(() => nestedVerifier.assertCovered('product.syncPrice'));
  assert.doesNotThrow(() => nestedVerifier.assertReadsCovered(['price']));

  const missingNestedReadVerifier = createDbVerifier(
    {
      'product.syncPrice': {
        touches: [{ domain: 'product', keys: null, site: 'product.ts:1', via: 'products' }],
        unresolved: [],
      },
    },
    { domainByTable: { prices: 'price', products: 'product' } },
  );
  const missingNestedReadDb = missingNestedReadVerifier.wrap(createFakeDb());
  missingNestedReadDb.sql(
    [
      'update products set unit_price = (select max(amount) from prices)',
      'where id in (select product_id from prices)',
    ].join(' '),
  );
  assertThrowsMessage(
    () => missingNestedReadVerifier.assertCovered('product.syncPrice'),
    'FW407 Query read from undeclared domain: price, price',
  );

  const selectSubqueryVerifier = createDbVerifier(
    {},
    { domainByTable: { prices: 'price', products: 'product' } },
  );
  const selectSubqueryDb = selectSubqueryVerifier.wrap(createFakeDb());
  selectSubqueryDb.sql('select * from products where id in (select product_id from prices)');
  assertThrowsMessage(
    () => selectSubqueryVerifier.assertReadsCovered(['product']),
    'FW407 Query read from undeclared domain: price',
  );
  assert.doesNotThrow(() => selectSubqueryVerifier.assertReadsCovered(['product', 'price']));

  const rowKeyVerifier = createDbVerifier(
    {
      'product.reserve': {
        touches: [
          { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
        ],
        unresolved: [],
      },
    },
    { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
  );
  const rowKeyDb = rowKeyVerifier.wrap(createFakeDb());
  rowKeyDb.sql("update products set reserved = true where sku = 'sku-1'");
  assertThrowsMessage(
    () => rowKeyVerifier.assertCovered('product.reserve'),
    'FW408 Declared row key differs from observed row predicate: products expected id observed sku',
  );

  const compoundRowKeyVerifier = createDbVerifier(
    {
      'product.reserve': {
        touches: [
          { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
        ],
        unresolved: [],
      },
    },
    { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
  );
  const compoundRowKeyDb = compoundRowKeyVerifier.wrap(createFakeDb());
  compoundRowKeyDb.sql("update products set reserved = true where sku = 'sku-1' and id = 'p1'");
  assert.doesNotThrow(() => compoundRowKeyVerifier.assertCovered('product.reserve'));

  const pgliteHandle = {
    exec() {
      return [];
    },
    query() {
      return [];
    },
    transaction(callback) {
      return callback({
        exec() {
          return [];
        },
        query() {
          return [];
        },
      });
    },
  };
  const pgliteHarness = createJisoTestHarness({
    db: { pglite: pgliteHandle },
    touchGraph: {
      'cart.add': {
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
        unresolved: [],
      },
    },
    verification: { domainByTable: { audit_log: 'audit', cart_items: 'cart' } },
  });
  const rawPgliteMutation = mutation('cart/add', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    async handler(input, request) {
      await request.db.pglite.query('insert into audit_log (product_id) values ($1)', [
        input.productId,
      ]);
      return input.productId;
    },
  });
  await assertRejectsMessage(
    pgliteHarness.exec(rawPgliteMutation, { productId: 'p1' }, { touchGraphKey: 'cart.add' }),
    'FW402 Write touched an undeclared domain: audit',
  );
  const transactionMutation = mutation('cart/add-transaction', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    async handler(input, request) {
      await request.db.pglite.transaction(async (tx) => {
        await tx.query('insert into audit_log (product_id) values ($1)', [input.productId]);
      });
      return input.productId;
    },
  });
  await assertRejectsMessage(
    pgliteHarness.exec(transactionMutation, { productId: 'p2' }, { touchGraphKey: 'cart.add' }),
    'FW402 Write touched an undeclared domain: audit',
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

  const noFragmentRoot = {
    findFragmentTarget() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const broadcastEvents = [];
  const enhancedStore = createQueryStore();
  const enhancedResult = await submitEnhancedMutation({
    broadcast: {
      close() {},
      publish(body, changes) {
        broadcastEvents.push({ body, changes });
      },
    },
    fetch: async (_url, options) => {
      assert.deepEqual(options.headers, {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_change_record',
        'FW-Targets': '',
      });
      return {
        headers: {
          get(name) {
            return name === 'FW-Changes'
              ? '[{"domain":"cart","keys":["c1"],"input":"ignored"},{"domain":"bad","keys":[7]},{"keys":["missing-domain"]}]'
              : null;
          },
        },
        async text() {
          return '<fw-query name="cart" key="cart:c1">{"count":2}</fw-query>';
        },
      };
    },
    form: { action: '/_m/cart/add', method: 'post' },
    formData: new FormData(),
    idem: 'idem_change_record',
    root: noFragmentRoot,
    store: enhancedStore,
  });
  assert.deepEqual(enhancedResult.changes, [{ domain: 'cart', keys: ['c1'] }]);
  assert.deepEqual(enhancedResult.queries, ['cart:c1']);
  assert.deepEqual(enhancedStore.get('cart', 'cart:c1'), { count: 2 });
  assert.deepEqual(broadcastEvents, [
    {
      body: '<fw-query name="cart" key="cart:c1">{"count":2}</fw-query>',
      changes: [{ domain: 'cart', keys: ['c1'] }],
    },
  ]);

  const malformedHeaderErrors = [];
  const malformedResult = await submitEnhancedMutation({
    fetch: async () => ({
      headers: {
        get(name) {
          return name === 'FW-Changes' ? '{bad json' : null;
        },
      },
      async text() {
        return '<fw-query name="cart">{"count":3}</fw-query>';
      },
    }),
    form: { action: '/_m/cart/add', method: 'post' },
    formData: new FormData(),
    onError(error) {
      malformedHeaderErrors.push(error);
    },
    root: noFragmentRoot,
    store: createQueryStore(),
  });
  assert.deepEqual(malformedResult.changes, []);
  assert.equal(malformedHeaderErrors.length, 1);
  assert.equal(
    malformedHeaderErrors[0].message.startsWith('Malformed JSON in FW-Changes header:'),
    true,
  );

  const optimisticStore = createQueryStore();
  optimisticStore.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
  const rebaser = new OptimisticRebaser(optimisticStore);
  const pendingElement = {
    attributes: { 'fw-deps': 'reviews' },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const optimisticResult = await submitOptimisticEnhancedMutation({
    fetch: async (_url, options) => {
      assert.equal(options.headers['FW-Idem'], 'idem_optimistic_change');
      assert.deepEqual(optimisticStore.get('reviews', 'product:p1'), {
        items: [{ id: 'r1' }, { id: 'draft' }],
      });
      assert.equal(pendingElement.getAttribute('fw-pending'), '');
      return {
        headers: {
          get(name) {
            return name === 'FW-Changes' ? '[{"domain":"product","keys":["p1"]}]' : null;
          },
        },
        async text() {
          return '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"},{"id":"server"}]}</fw-query>';
        },
      };
    },
    form: { action: '/_m/reviews/add', method: 'post' },
    formData: new FormData(),
    change: { domain: 'product', keys: ['p1'], input: { reviewId: 'draft' } },
    idem: 'idem_optimistic_change',
    input: { reviewId: 'unused' },
    optimistic: {
      keys: { reviews: (change) => `product:${change.keys?.[0]}` },
      transforms: {
        reviews(current, input) {
          return { items: [...current.items, { id: input.reviewId }] };
        },
      },
    },
    pendingRoot: {
      querySelectorAll(selector) {
        return selector === '[fw-deps]' ? [pendingElement] : [];
      },
    },
    rebaser,
    root: noFragmentRoot,
    store: optimisticStore,
  });
  assert.deepEqual(optimisticResult.changes, [{ domain: 'product', keys: ['p1'] }]);
  assert.deepEqual(optimisticResult.queries, ['reviews:product:p1']);
  assert.deepEqual(optimisticStore.get('reviews', 'product:p1'), {
    items: [{ id: 'r1' }, { id: 'server' }],
  });
  assert.equal(pendingElement.getAttribute('fw-pending'), null);
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

  assert.equal(
    fwExplain(graph, { kind: 'component', target: 'CartBadge' }).output,
    [
      'fw-explain/v1',
      'COMPONENT CartBadge',
      'queries: cart',
      'fragments: -',
      'HANDLER click export=CartBadge$button_click ref=/components/cart-badge.js#CartBadge$button_click captures=ctx,element-params params=itemId substitution=-',
      'DERIVE CartBadge$isEmpty inputs=cart ref=/components/cart-badge.js#CartBadge$isEmpty target=data-bind:hidden',
      'TRIGGER visible export=CartBadge$mountChart ref=/components/cart-badge.js#CartBadge$mountChart deps=cart justification=charts are below the fold',
      'MERGE button attr=aria-expanded rule=primitive-owned decision=primitive diagnostics=-',
      'MERGE button attr=data-bind:hidden rule=single-binding-writer decision=diagnostic diagnostics=FW233',
      '',
    ].join('\n'),
  );
  assert.equal(
    fwExplain(graph, { endpoints: true }).output,
    [
      'fw-explain/v1',
      'ENDPOINTS',
      'ENDPOINT health method=GET path=/health mount=exact auth=- csrf=checked writes=-',
      'ENDPOINT stripe/webhook method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature csrf=exempt:stripe-signature writes=payment',
      'SUMMARY total=2',
      '',
    ].join('\n'),
  );
  assert.equal(
    fwExplain(graph, { unguarded: true }).output,
    [
      'fw-explain/v1',
      'UNGUARDED',
      'ENDPOINT health method=GET path=/health mount=exact auth=- csrf=checked',
      'MUTATION cart/add guards=- writes=cart invalidates=- manual-invalidates=-',
      'PAGE /cart guards=- queries=cart',
      'QUERY cart guards=- reads=cart',
      'SUMMARY total=4',
      '',
    ].join('\n'),
  );
  assert.equal(
    fwExplain(graph, { unscoped: true }).output,
    [
      'fw-explain/v1',
      'UNSCOPED',
      'UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21 where eq(carts.id, args.cartId)',
      'SUMMARY total=1',
      '',
    ].join('\n'),
  );
});

void test('P5 data-bind paths are checked against generated query shape facts', async () => {
  assert.equal(
    diagnosticDefinitions.FW302.message,
    'data-bind path is not present in the declared query shape.',
  );
  assert.equal(
    diagnosticDefinitions.FW227.help,
    [
      'Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.',
      'SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.',
    ].join('\n'),
  );

  const generatedCartShapeFacts = [
    compilerGeneratedQueryShapeFact({
      query: 'cart',
      shape: {
        count: 'number',
        empty: 'boolean',
        items: [{ name: 'string', productId: 'string', qty: 'number' }],
      },
    }),
  ];
  assert.deepEqual(queryShapesFromFacts(generatedCartShapeFacts), {
    cart: {
      count: 'number',
      empty: 'boolean',
      items: [{ name: 'string', productId: 'string', qty: 'number' }],
    },
  });

  const validCartBindings = compileComponentModule({
    fileName: 'cart-badge.tsx',
    queryShapeFacts: generatedCartShapeFacts,
    source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">2</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
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
  assert.deepEqual(validCartBindings.diagnostics, []);
  assert.deepEqual(compilerQueryUpdatePlanFacts(validCartBindings.queryUpdatePlans), [
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
          itemBindings: ['.name', '.qty'],
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

  const staleGeneratedShape = compileComponentModule({
    fileName: 'cart-badge.tsx',
    queryShapeFacts: [
      compilerGeneratedQueryShapeFact({
        query: 'cart',
        shape: { itemCount: 'number' },
      }),
    ],
    source: `
export const CartBadge = component('cart-badge', {
  render: () => <span data-bind="cart.count">2</span>,
});
`,
  });
  assert.deepEqual(compilerDiagnosticMessageFacts(staleGeneratedShape.diagnostics), [
    {
      code: 'FW302',
      message: 'data-bind path is not present in the declared query shape. cart.count',
    },
  ]);

  const invalidListStamp = compileComponentModule({
    fileName: 'cart-badge.tsx',
    queryShapeFacts: generatedCartShapeFacts,
    source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <ul data-bind-list="cart.items" fw-key="sku">
      <template fw-stamp>
        <li><span data-bind=".missing">0</span></li>
      </template>
    </ul>
  ),
});
`,
  });
  assert.deepEqual(compilerDiagnosticMessageFacts(invalidListStamp.diagnostics), [
    {
      code: 'FW302',
      message: 'data-bind path is not present in the declared query shape. cart.items',
    },
  ]);

  const nullableFacts = [
    compilerGeneratedQueryShapeFact({
      query: 'product',
      shape: {
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
    }),
  ];
  assert.deepEqual(queryShapesFromFacts(nullableFacts), {
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
  const optionalNullablePath = compileComponentModule({
    fileName: 'product-card.tsx',
    queryShapeFacts: nullableFacts,
    source: `
export const ProductCard = component('product-card', {
  render: () => <span data-bind="product.review?.rating">5</span>,
});
`,
  });
  assert.deepEqual(optionalNullablePath.diagnostics, []);

  const unsafeNullablePath = compileComponentModule({
    fileName: 'product-card.tsx',
    queryShapeFacts: nullableFacts,
    source: `
export const ProductCard = component('product-card', {
  render: () => <span data-bind="product.review.rating">5</span>,
});
`,
  });
  assert.deepEqual(compilerDiagnosticMessageFacts(unsafeNullablePath.diagnostics), [
    {
      code: 'FW227',
      help: diagnosticDefinitions.FW227.help,
      message:
        'Binding path traverses a nullable segment without ?. product.review.rating (segment: review)',
    },
  ]);
});

void test('S1 production build proves the compiler 1:1 emit contract', async () => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const prodEmit = await execFileAsync('node', ['scripts/prod-emit-check.mjs'], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024 * 10,
  });
  assert.equal(prodEmit.stderr, '');
  assert.deepEqual(commandOutputLines(prodEmit.stdout), ['prod-emit-check/v1', 'OK']);

  const plugin = jisoVitePlugin();
  const middlewareFact = vitePluginMiddlewareFact(plugin, { root: projectRoot });
  assert.equal(middlewareFact.pluginName, 'jiso');

  const handlerTransform = viteHandlerTransformFact(plugin, {
    id: join(projectRoot, 'routes/products/product-card.tsx'),
    selector: { tag: 'button' },
    source: `
import { component } from '@jiso/core';

export const ProductCard = component('product-card', {
  render: () => (
    <article>
      <button onClick={() => addToCart(product.id)}>Add</button>
    </article>
  ),
});
`,
  });
  assert.equal(handlerTransform.mapIsNull, true);
  assert.equal(handlerTransform.elements[0]?.attrs['data-p-id'], '{product.id}');
  assert.deepEqual(handlerTransform.handlerSummary, {
    handlerName: 'ProductCard$button_click',
    modulePath: '/c/routes/products/product-card.client.js',
    versionShape: 'lower-hex-8',
  });
  const cartEvents = [];
  const middlewareResult = viteGeneratedHandlerMiddlewareFact({
    context: {
      addToCart(id) {
        cartEvents.push(id);
        return `added:${id}`;
      },
    },
    executeClientModule: executeGeneratedClientModule,
    handlerReference: handlerTransform.handlerReference,
    invocation: { ctx: { params: { id: 'p1' } }, event: 'click' },
    middleware: middlewareFact.middleware,
    runtime: generatedModuleRuntime,
  });
  assert.equal(middlewareResult.nextCallsAfterHit, 0);
  assert.equal(middlewareResult.statusCode, 200);
  assert.equal(middlewareResult.contentType, 'text/javascript');
  assert.equal(middlewareResult.invocationResult, 'added:p1');
  assert.deepEqual(cartEvents, ['p1']);
  assert.equal(middlewareResult.nextCallsAfterStale, 1);
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

  const outDir = await mkdtemp(join(tmpdir(), 'jiso-d10-export-'));
  const app = createApp({
    routes: [
      serverRoute('/', {
        page: () => '<main data-fw-check-export="api"></main>',
      }),
    ],
  });
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

  try {
    await assert.rejects(
      exportStaticApp(app, { diagnostics: [errorDiagnostic], outDir }),
      (error) => {
        assert.equal(error?.name, 'StaticExportError');
        assert.equal(error?.code, 'FW201');
        assert.deepEqual(
          error?.diagnostics?.map((diagnostic) => diagnostic.code),
          ['FW201'],
        );
        assert.equal(String(error?.message ?? error), expectedStaticExportError);
        return true;
      },
    );
    await assert.rejects(readFile(join(outDir, 'index.html'), 'utf8'));

    const exported = await exportStaticApp(app, { diagnostics: [lintDiagnostic], outDir });
    assert.equal(exported.artifacts[0]?.path, '/index.html');
    assert.equal(exported.diagnostics.length, 0);
    const exportedHtml = await readFile(join(outDir, 'index.html'), 'utf8');
    assert.equal(exported.artifacts[0]?.body, exportedHtml);
    assertHtmlMainMarker(exportedHtml, 'api', 'static export writes the rendered main marker');
  } finally {
    await rm(outDir, { force: true, recursive: true });
  }

  const cliFixtureRoot = await mkdtemp(join(tmpdir(), 'jiso-d10-fw-export-'));
  const cliRedOutDir = join(cliFixtureRoot, 'red-out');
  const cliGreenOutDir = join(cliFixtureRoot, 'green-out');
  const cliRedModule = join(cliFixtureRoot, 'red-app.mjs');
  const cliGreenModule = join(cliFixtureRoot, 'green-app.mjs');
  const cliAppModuleSource = (diagnostics) => `
import { route as serverRoute } from ${JSON.stringify(
    pathToFileURL(join(projectRoot, 'dist/server/src/index.mjs')).href,
  )};
import { createApp } from ${JSON.stringify(
    pathToFileURL(join(projectRoot, 'dist/server/src/api/app-shell/core.mjs')).href,
  )};

export const diagnostics = ${JSON.stringify(diagnostics, null, 2)};

export default createApp({
  routes: [
    serverRoute('/', {
      page: () => '<main data-fw-check-export="cli"></main>',
    }),
  ],
});
`;

  try {
    await writeFile(cliRedModule, cliAppModuleSource([errorDiagnostic]), 'utf8');
    const redExport = await runCliCommand(['export', cliRedModule, '--out', cliRedOutDir]);
    assert.deepEqual(fwExportCliResultFact(redExport), {
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
    });
    await assert.rejects(readFile(join(cliRedOutDir, 'index.html'), 'utf8'));

    await writeFile(cliGreenModule, cliAppModuleSource([lintDiagnostic]), 'utf8');
    const greenExport = await runCliCommand(['export', cliGreenModule, '--out', cliGreenOutDir]);
    assert.deepEqual(fwExportCliResultFact(greenExport), {
      errors: [],
      exitCode: 0,
      html: [{ bytesArePositive: true, path: '/index.html', status: 200 }],
      outputStream: 'stdout',
      summary: {
        clientModules: '0',
        diagnostics: '0',
        html: '1',
        outDir: JSON.stringify(cliGreenOutDir),
      },
      version: 'fw-export/v1',
    });
    assertHtmlMainMarker(
      await readFile(join(cliGreenOutDir, 'index.html'), 'utf8'),
      'cli',
      'fw export writes the rendered main marker',
    );
  } finally {
    await rm(cliFixtureRoot, { force: true, recursive: true });
  }

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
    const importFailure = String(error?.stack ?? error);
    assert.equal(
      importFailure.includes('__filename is not defined in ES module scope') ||
        importFailure.includes('packages/core/src/diagnostics.js'),
      true,
      'unexpected Drizzle static import failure',
    );
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
  const commerceGraph = await graphFixtureFile(
    projectRootPath,
    'examples/commerce/src/generated/graph.json',
  );
  const emitGraphCheck = await execFileAsync('node', ['scripts/emit-graph.mjs', '--check'], {
    cwd: new URL('../examples/commerce/', import.meta.url),
    env: { ...process.env, CI: '1' },
  });
  assert.deepEqual(
    {
      stderr: emitGraphCheck.stderr,
      stdout: emitGraphCheck.stdout,
    },
    { stderr: '', stdout: '' },
  );
  const provenance = await touchGraphProvenanceFact(projectRootPath, commerceGraph.touchGraph);
  assert.deepEqual(provenance.siteSummary, {
    count: 5,
    linesArePositive: true,
    paths: ['examples/commerce/src/app.ts'],
  });
  assert.deepEqual(provenance.sourceLineMismatches, []);
  assert.deepEqual(provenance.unresolvedMutations, []);
  assert.deepEqual(provenance.entries, {
    'cart.addItem': {
      reads: [],
      touches: [
        {
          domain: 'cart',
          keys: null,
          predicate: undefined,
          sitePath: 'examples/commerce/src/app.ts',
          via: 'cart_items',
        },
        {
          domain: 'order',
          keys: null,
          predicate: undefined,
          sitePath: 'examples/commerce/src/app.ts',
          via: 'orders',
        },
        {
          domain: 'product',
          keys: 'arg:productId',
          predicate: 'eq',
          sitePath: 'examples/commerce/src/app.ts',
          via: 'products',
        },
      ],
      unresolved: [],
    },
    'payment.webhook': {
      reads: [],
      touches: [
        {
          domain: 'order',
          keys: 'arg:data.object.id',
          predicate: 'eq',
          sitePath: 'examples/commerce/src/app.ts',
          via: 'orders',
        },
      ],
      unresolved: [],
    },
    'order.receipt': {
      reads: [],
      touches: [
        {
          domain: 'attachment',
          keys: 'arg:orderId',
          predicate: 'eq',
          sitePath: 'examples/commerce/src/app.ts',
          via: 'attachments',
        },
      ],
      unresolved: [],
    },
  });
  // SPEC §11.1/§11.2: the committed static graph must stay source-derived
  // because runtime verification checks observed effects against these facts.
  assert.deepEqual(fwCheckOkAssertionFact(fwCheck(commerceGraph)), {
    exitCode: 0,
    issueCount: 0,
    status: 'ok',
    version: 'fw-check/v1',
  });
  assert.deepEqual(
    fwExplainListField(
      fwExplain(commerceGraph, { kind: 'query', target: 'cart' }).output,
      'domain-writes',
    ),
    ['cart.addItem'],
  );
  assert.deepEqual(graphInvalidationFacts(commerceGraph), {
    'cart/add': ['cart', 'orderHistory', 'productGrid'],
  });
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
  assert.deepEqual(compiled.queryUpdatePlans, [
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
          itemBindings: ['.name', '.qty'],
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

  const fixtureBody = parseWireResponses(await readWireFixture('defer-stream.http'))[0].body;
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
  const packageJson = await projectJsonFile(projectRootPath, 'package.json');
  const ciWorkflow = await readProjectFile('.github/workflows/ci.yml');
  const browserGate = vitePlusAcceptanceTaskFacts({
    ciWorkflowSource: ciWorkflow,
    packageJson,
    scriptName: 'test:browser',
    viteConfig: await loadProjectVitePlusConfig(),
  });
  const { configPath } = vitestTaskCommand(browserGate.task.command);
  const browserAcceptancePattern = vitePlusTaskInputPatternEndingWith(
    browserGate.task,
    '/browser-acceptance.mjs',
  );
  const { browserSuiteAcceptance } = await import(
    new URL(`../${browserAcceptancePattern}`, import.meta.url).href
  );

  assert.equal(browserGate.presentInAcceptance, true);
  assert.equal(browserGate.presentInCi, true);
  assert.deepEqual(vitePlusTaskInputFacts(browserGate.task), [
    { auto: true },
    { base: 'workspace', pattern: configPath },
    { base: 'workspace', pattern: browserAcceptancePattern },
    { base: 'workspace', pattern: browserSuiteAcceptance.include[0] },
  ]);
  assert.deepEqual(browserSuiteAcceptance, {
    browser: 'chromium',
    headless: true,
    include: ['packages/runtime/src/**/*.browser.test.ts'],
    providerPackage: '@vitest/browser-playwright',
  });
});

void test('P10 perf acceptance is wired through Playwright and CDP', async () => {
  const packageJson = await projectJsonFile(projectRootPath, 'package.json');
  const ciWorkflow = await readProjectFile('.github/workflows/ci.yml');
  const perfGate = vitePlusAcceptanceTaskFacts({
    ciWorkflowSource: ciWorkflow,
    packageJson,
    scriptName: 'test:p10-perf',
    viteConfig: await loadProjectVitePlusConfig(),
  });
  const { modulePath } = nodeTaskCommand(perfGate.task.command);
  const { p10PerfAcceptance, runP10PerfAcceptance } = await import(
    new URL(`../${modulePath}`, import.meta.url).href
  );

  assert.equal(typeof runP10PerfAcceptance, 'function');
  assert.equal(perfGate.presentInAcceptance, true);
  assertOrderedItems(perfGate.acceptanceScripts, 'check:build', 'test:p10-perf');
  assertOrderedItems(perfGate.acceptanceScripts, 'test:p10-perf', 'check:fw');
  assertOrderedItems(perfGate.ciTaskNames, 'build', perfGate.taskName);
  assertOrderedItems(perfGate.ciTaskNames, perfGate.taskName, 'fw-check');
  assert.equal(perfGate.presentInCi, true);
  assert.deepEqual(vitePlusTaskInputFacts(perfGate.task), [
    { auto: true },
    { base: 'workspace', pattern: modulePath },
    { base: 'workspace', pattern: 'dist/**' },
  ]);
  assert.deepEqual(p10PerfAcceptance, {
    browser: 'chromium',
    cdpMethods: ['HeapProfiler.collectGarbage', 'Runtime.getHeapUsage'],
    heapNoiseBudget: 65536,
    navigationCount: 100,
    paintEntry: 'first-contentful-paint',
    prerenderTimingField: 'activationStart',
    ttiMetric: 'ttiMinusFcpMs',
  });
});
