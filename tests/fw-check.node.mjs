import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

const responseMarker = '<<< RESPONSE';
const requestMarker = '>>> REQUEST';

const generatedWireBodies = {
  'defer-stream.http': [
    `<!doctype html>
<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer></product-page></main>

--jiso-boundary
<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</fw-query>
<fw-fragment target="reviews:p1"><section fw-c="reviews" fw-deps="product:p1"><article data-key="r1">5</article></section></fw-fragment>
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
  'validation-422-fragment.http': [
    `<fw-fragment target="product-form:p1"><form fw-c="product-form" aria-invalid="true"><output role="alert" data-error-code="OUT_OF_STOCK">Only 5 left.</output><input name="productId" value="p1"><input name="quantity" value="99"></form></fw-fragment>
`,
  ],
};

const parseWireResponses = (fixtureBody) => {
  const responses = [];
  let cursor = 0;

  while (true) {
    const markerStart = fixtureBody.indexOf(responseMarker, cursor);
    if (markerStart === -1) {
      return responses;
    }

    const responseStart = fixtureBody.indexOf('\n', markerStart);
    assert.notEqual(responseStart, -1, 'response marker must be followed by a status line');

    const nextRequestStart = fixtureBody.indexOf(`\n${requestMarker}`, responseStart + 1);
    const responseBlock =
      nextRequestStart === -1
        ? fixtureBody.slice(responseStart + 1)
        : fixtureBody.slice(responseStart + 1, nextRequestStart);

    const headerEnd = responseBlock.indexOf('\n\n');
    const headerText =
      headerEnd === -1 ? responseBlock.trimEnd() : responseBlock.slice(0, headerEnd);
    const responseBody = headerEnd === -1 ? '' : responseBlock.slice(headerEnd + 2);
    const headerLines = headerText.split('\n');
    const statusLine = headerLines.shift();
    assert.match(statusLine, /^HTTP\/1\.1 \d{3} /, 'response includes an HTTP status line');

    const headers = Object.fromEntries(
      headerLines.map((line) => {
        const separator = line.indexOf(':');
        assert.notEqual(separator, -1, `malformed response header: ${line}`);
        return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
      }),
    );

    responses.push({
      body: responseBody,
      headers,
      statusLine,
    });
    cursor = nextRequestStart === -1 ? fixtureBody.length : nextRequestStart + 1;
  }
};

const readWireFixture = async (name) =>
  readFile(new URL(`../fixtures/wire/${name}`, import.meta.url), 'utf8');

const readProjectFile = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const listProjectFiles = async (dir, predicate) => {
  const entries = await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;

    if (entry.isDirectory()) {
      files.push(...(await listProjectFiles(path, predicate)));
    } else if (predicate(path)) {
      files.push(path);
    }
  }

  return files;
};

void test('Phase 0 wire fixtures are present and explicit', async () => {
  const fixtureNames = await readdir(new URL('../fixtures/wire/', import.meta.url));

  assert.deepEqual(fixtureNames.filter((name) => name.endsWith('.http')).sort(), [
    'defer-stream.http',
    'enhanced-mutation.http',
    'no-js-post-redirect-get.http',
    'validation-422-fragment.http',
  ]);

  for (const name of fixtureNames.filter((entry) => entry.endsWith('.http'))) {
    const body = await readWireFixture(name);
    assert.match(body, /^### /m, `${name} names the scenario`);
    assert.match(body, /^>>> REQUEST/m, `${name} includes a request transcript`);
    assert.match(body, /^<<< RESPONSE/m, `${name} includes a response transcript`);
  }

  for (const name of ['enhanced-mutation.http', 'validation-422-fragment.http']) {
    const body = await readWireFixture(name);
    assert.match(body, /^FW-Fragment: true$/m, `${name} declares enhanced fragment mode`);
    assert.match(
      body,
      /^Accept: text\/vnd\.jiso\.fragment\+html$/m,
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
          'transfer-encoding': 'chunked',
        },
        statusLine: 'HTTP/1.1 200 OK',
      },
    ],
    'enhanced-mutation.http': [
      {
        headers: {
          'content-type': 'text/vnd.jiso.fragment+html; charset=utf-8',
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
        responses[index].headers,
        expected.headers,
        `${name} response ${index + 1} headers`,
      );
    }
  }
});

void test('SSE remains a v2 backlog fixture, not a v1 wire contract', async () => {
  const body = await readFile(new URL('../fixtures/wire/README.md', import.meta.url), 'utf8');

  assert.match(body, /SSE.*v2 backlog/i);
});

void test('P10 constitution rejects forbidden browser architecture in framework code', async () => {
  const sourcePaths = await listProjectFiles(
    'packages',
    (path) => path.endsWith('.ts') && path.includes('/src/') && !path.endsWith('.test.ts'),
  );
  const forbiddenPatterns = [
    /\bcustomElements\.define\b/,
    /\battachShadow\b/,
    /\baddEventListener\(['"]unload['"]/,
    /\bonunload\b/,
    /<script\b[^>]*type=["']importmap["']/i,
    /\bcreateBrowserRouter\b/,
    /\bhydrateRoot\b/,
  ];

  for (const path of sourcePaths) {
    const source = await readProjectFile(path);

    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${path} must not match ${pattern}`);
    }
  }
});

void test('P10 commerce keeps app invalidation declarative', async () => {
  const source = await readProjectFile('examples/commerce/src/app.ts');

  assert.doesNotMatch(
    source,
    /\binvalidate\s*\(/,
    'commerce app should use inferred touch graph wiring instead of direct invalidate() calls',
  );
});

void test('P10 normative docs cover the constitution and compiler hard rules', async () => {
  const constitution = await readProjectFile('docs/constitution.md');
  const compilerRules = await readProjectFile('docs/compiler-hard-rules.md');
  const spec = await readProjectFile('SPEC.md');

  assert.match(constitution, /`SPEC\.md` is the source of truth/);
  assert.match(constitution, /Legibility is load-bearing/);
  assert.match(constitution, /Sugar must lower to authorable IR/);
  assert.match(constitution, /The wire is the documentation/);
  assert.match(constitution, /Server truth always wins/);
  assert.match(compilerRules, /Source-derived names/);
  assert.match(compilerRules, /capture channels \(`ctx`, `element-params`, `module-scope`\)/);
  assert.match(compilerRules, /One-to-one file mapping/);
  assert.match(compilerRules, /Fixpoint invariant/);
  assert.match(compilerRules, /Platform behavior emission/);
  assert.match(compilerRules, /Teaching errors/);
  assert.match(spec, /\*\*13\.1 CSS\.\*\* Jiso v1 is Tailwind-first/);
  assert.match(spec, /dynamic classes must be safelisted explicitly/);
  assert.match(spec, /wraps them in `@scope` keyed to the host/);
  assert.doesNotMatch(spec, /needs a design pass before v1 freeze/);
});

void test('P10 legibility study packet is ready but not claimed complete', async () => {
  const study = await readProjectFile('docs/legibility-study.md');

  assert.match(study, /SPEC\.md` section 16\.2 requires an actual usability study/);
  assert.match(study, /Required participants: 5 outside developers/);
  assert.match(study, /under 60 seconds/);
  assert.match(study, /Button behavior/);
  assert.match(study, /Island data/);
  assert.match(study, /Mutation effects/);
  assert.match(study, /Optimism/);
  assert.match(study, /Failure path/);
  assert.match(study, /pending-5/);
  assert.match(study, /Do not mark v1 legibility complete/);
});

void test('Appendix B pre-launch checklist is tracked explicitly', async () => {
  const checklist = await readProjectFile('docs/prelaunch-checklist.md');

  assert.match(checklist, /SPEC\.md` Appendix B/);
  assert.match(checklist, /Trademark screen/);
  assert.match(checklist, /jiso\.dev/);
  assert.match(checklist, /`@jiso` npm/);
  assert.match(checklist, /Linguistic screen/);
  assert.match(checklist, /Do not mark v1 pre-launch complete/);
});

void test('S2 loader budget and L0 no-upgrade path are acceptance evidence', async () => {
  const runtimeSource = await readProjectFile('packages/runtime/src/index.ts');
  const loaderMatch = /export const jisoLoaderSource = `(?<source>[\s\S]*?)`;/m.exec(runtimeSource);
  assert.ok(loaderMatch?.groups?.source, 'runtime exports jisoLoaderSource');

  const loaderSource = loaderMatch.groups.source;
  assert.ok(gzipSync(loaderSource).byteLength <= 1024, 'loader remains inside the 1KB gzip budget');
  assert.match(loaderSource, /import\(r\.slice\(0,i\)\)/, 'handlers import only from event refs');
  assert.match(loaderSource, /FW-Targets/, 'enhanced form submits send live targets');
  assert.match(loaderSource, /keepalive:!0/, 'enhanced form submits use keepalive');
  assert.match(loaderSource, /<fw-fragment/, 'loader parses fragment chunks');
  assert.doesNotMatch(
    loaderSource,
    /customElements|attachShadow|unload/,
    'loader has no upgrade/unload path',
  );
});

void test('P2 loader smoke evidence remains represented in runtime tests', async () => {
  const runtimeTests = await readProjectFile('packages/runtime/src/index.test.ts');
  const browserTests = await readProjectFile('packages/runtime/src/index.browser.test.ts');

  assert.match(
    runtimeTests,
    /registers delegated capture listeners without importing handler modules/,
  );
  assert.match(
    runtimeTests,
    /expect\(\[\.\.\.root\.listeners\.keys\(\)\]\)\.toEqual\(\['click', 'submit', 'input', 'change'\]\)/,
  );
  assert.match(runtimeTests, /expect\(importModule\)\.not\.toHaveBeenCalled\(\)/);
  assert.match(runtimeTests, /expect\(jisoLoaderSource\)\.not\.toContain\('customElements'\)/);
  assert.match(runtimeTests, /ships an inline enhanced form round trip in the bootstrap source/);
  assert.match(
    browserTests,
    /keeps the loader idle until the first delegated interaction/,
    'browser suite covers first-interaction handler import',
  );
  assert.match(
    browserTests,
    /preserves L0 light-DOM IDREF and form behavior without handler imports/,
    'browser suite covers L0 platform behavior through light DOM',
  );
  assert.match(browserTests, /new FormData\(form\)\.get\('query'\)/);
});

void test('P3 server renders initial query scripts for document-load hydration', async () => {
  const serverSource = await readProjectFile('packages/server/src/index.ts');
  const serverTests = await readProjectFile('packages/server/src/index.test.ts');

  assert.match(serverSource, /export function renderQueryScript/);
  assert.match(serverSource, /fw-query="\$\{escapeAttribute\(options\.name\)\}"/);
  assert.match(serverSource, /escapeScriptJson\(JSON\.stringify\(options\.value\)\)/);
  assert.match(serverTests, /renders initial query scripts for document-load hydration/);
  assert.match(serverTests, /key="cart:c1"/);
  assert.match(serverTests, /\\\\u003c\/script>/);
});

void test('P2 page hints keep speculation rules opt-in and non-empty', async () => {
  const serverSource = await readProjectFile('packages/server/src/index.ts');
  const serverTests = await readProjectFile('packages/server/src/index.test.ts');

  assert.match(serverSource, /const prerenderUrls = dedupe\(urls\)/);
  assert.match(serverSource, /prerenderUrls\.length === 0/);
  assert.match(serverTests, /prefetch: 'moderate', prerenderUrls: \['', ''\]/);
});

void test('P2 compiler merges view transition stamps into existing styles', async () => {
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');

  assert.match(compilerSource, /appendViewTransitionStyle/);
  assert.match(compilerTests, /merges cross-document view transition stamps/);
  assert.match(compilerTests, /opacity: \.8; view-transition-name: product-p1-image/);
  assert.match(compilerTests, /serverSource\.match\(\/\\sstyle=\/g\)/);
});

void test('P3 mutation lifecycle includes an explicit transaction boundary', async () => {
  const serverSource = await readProjectFile('packages/server/src/index.ts');
  const serverTests = await readProjectFile('packages/server/src/index.test.ts');

  assert.match(serverSource, /transaction\?: <Result>/);
  assert.match(serverSource, /definition\.transaction/);
  assert.match(serverSource, /class MutationRollback extends Error/);
  assert.match(serverTests, /runs guarded mutation handlers inside the configured transaction/);
  assert.match(serverTests, /rolls back configured transactions for typed mutation failures/);
  assert.match(
    serverTests,
    /renders mutation query chunks after the configured transaction commits/,
  );
});

void test('P5 morph evidence includes structural and browser survival suites', async () => {
  const runtimeTests = await readProjectFile('packages/runtime/src/index.test.ts');
  const browserTests = await readProjectFile('packages/runtime/src/index.browser.test.ts');

  assert.match(runtimeTests, /preserves keyed structural node identity when sibling order changes/);
  assert.match(runtimeTests, /preserves keyed browser state across fragment morphs and reorders/);
  assert.match(runtimeTests, /focused: true/);
  assert.match(runtimeTests, /scroll: \{ left: 4, top: 24 \}/);
  assert.match(runtimeTests, /selection: \{ direction: 'forward', end: 3, start: 1 \}/);
  assert.match(runtimeTests, /appends fragment chunks when the wire mode is append/);
  assert.match(
    runtimeTests,
    /preserves keyed list identity across append fragments and later reorders/,
  );
  assert.match(
    browserTests,
    /preserves focus, selection, scroll, and keyed identity during a real DOM fragment morph/,
  );
  assert.match(browserTests, /document\.activeElement/);
  assert.match(browserTests, /selectionStart/);
  assert.match(browserTests, /scrollTop/);
});

void test('D2 commerce validates keyed append and optimistic reorder', async () => {
  const commerceTests = await readProjectFile('examples/commerce/src/app.test.ts');
  const runtimeTests = await readProjectFile('packages/runtime/src/index.test.ts');
  const serverTests = await readProjectFile('packages/server/src/index.test.ts');

  assert.match(
    commerceTests,
    /preserves commerce list identity through append and simultaneous optimistic reorder/,
  );
  assert.match(commerceTests, /renderProductGridPageFragment/);
  assert.match(commerceTests, /morphStructuralTree/);
  assert.match(commerceTests, /pendingMutation: 'cart\/add'/);
  assert.match(commerceTests, /order-history/);
  assert.match(serverTests, /narrows post-commit rerun query instances by row keys/);
  assert.match(
    serverTests,
    /rerenders only matching keyed query instances in enhanced mutation responses/,
  );
  assert.match(runtimeTests, /keeps keyed query chunks isolated by instance key/);
  assert.match(runtimeTests, /rebroadcasts keyed query chunks to the matching keyed store entry/);
  assert.match(runtimeTests, /applies hand-written optimistic transforms to keyed query instances/);
  assert.match(runtimeTests, /rebases pending optimistic transforms over keyed server truth/);
  assert.match(
    runtimeTests,
    /reconciles keyed optimistic enhanced submits with keyed query chunks/,
  );
});

void test('P3 commerce mutation runs through the transaction lifecycle', async () => {
  const commerceSource = await readProjectFile('examples/commerce/src/app.ts');
  const commerceTests = await readProjectFile('examples/commerce/src/app.test.ts');

  assert.match(commerceSource, /transaction<Result>\(run: \(db: CommerceDb\)/);
  assert.match(commerceSource, /cloneCommerceDb/);
  assert.match(commerceSource, /request\.db\.transaction/);
  assert.match(commerceTests, /commits and rolls back commerce database transactions/);
  assert.match(commerceTests, /expect\(transactions\)\.toBe\(2\)/);
});

void test('D1 commerce enhanced fragments carry Tailwind stylesheet hints', async () => {
  const commerceSource = await readProjectFile('examples/commerce/src/app.ts');
  const commerceTests = await readProjectFile('examples/commerce/src/app.test.ts');
  const serverSource = await readProjectFile('packages/server/src/index.ts');
  const serverTests = await readProjectFile('packages/server/src/index.test.ts');

  assert.match(commerceSource, /commerceStylesheets = \['\/assets\/tailwind\.css'\] as const/);
  assert.match(commerceSource, /stylesheets: commerceStylesheets/);
  assert.match(commerceTests, /response\.body\.match/);
  assert.match(commerceTests, /toHaveLength\(3\)/);
  assert.match(commerceTests, /<link rel="stylesheet" href="\/assets\/tailwind\.css">/);
  assert.match(serverSource, /error-boundary=.*renderStylesheetLinks\(renderer\.stylesheets/);
  assert.match(serverTests, /recommendations\.css/);
});

void test('D4 commerce adopt-dont-invent features stay represented', async () => {
  const commerceSource = await readProjectFile('examples/commerce/src/app.ts');
  const commerceTests = await readProjectFile('examples/commerce/src/app.test.ts');

  assert.match(commerceSource, /meta\(\{/);
  assert.match(commerceSource, /i18n\('en-US'/);
  assert.match(commerceSource, /s\.file\(\{ maxBytes: 64 \* 1024/);
  assert.match(commerceSource, /errorBoundary\(/);
  assert.match(commerceSource, /commerceSession = session\(/);
  assert.match(commerceSource, /guards\.rateLimit<CommerceRequest>/);
  assert.match(commerceTests, /coerces commerce receipt uploads through s\.file\(\)/);
  assert.match(
    commerceTests,
    /contains product-grid fragment failures with a per-island error boundary/,
  );
  assert.match(commerceTests, /uses the typed commerce session schema in authenticated mutations/);
  assert.match(commerceTests, /fw-i18n locale="en-US"/);
});

void test('P10 commerce graph assertions answer behavior mechanically', async () => {
  const commerceTests = await readProjectFile('examples/commerce/src/app.test.ts');

  assert.match(
    commerceTests,
    /answers cart\/add update intent mechanically from fw explain output/,
  );
  assert.match(
    commerceTests,
    /answers commerce optimistic coverage mechanically from fw explain output/,
  );
  assert.match(commerceTests, /mutationUpdateConsumers\(mutation\.output\)/);
  assert.match(commerceTests, /const queryExplain = fwExplain\(commerceGraph, \{ kind: 'query'/);
  assert.match(commerceTests, /expect\(updates\.get\(query\)\)\.toContain\('page:\/cart'\)/);
  assert.match(commerceTests, /expect\(statuses\.get\(query\)\)\.not\.toBe\('UNHANDLED'\)/);
});

void test('P10 starter wires graph assertions into CI', async () => {
  const starterSource = await readProjectFile('packages/create-jiso/src/index.ts');
  const starterTests = await readProjectFile('packages/create-jiso/src/index.test.ts');

  assert.match(starterSource, /'graph-assertions': 'vp run graph-assertions'/);
  assert.match(starterSource, /command: 'node scripts\/graph-assertions\.mjs'/);
  assert.match(starterSource, /- run: vp run graph-assertions/);
  assert.match(starterSource, /path: 'scripts\/graph-assertions\.mjs'/);
  assert.match(starterSource, /OPTIMISTIC-SUMMARY \.\*UNHANDLED=0/);
  assert.doesNotMatch(starterSource, /src\/main\.ts/);
  assert.doesNotMatch(starterSource, /innerHTML = App\.definition\.render\(\)/);
  assert.match(starterSource, /@source "\.\.\/index\.html";/);
  assert.match(starterSource, /@source "\.\/\*\*\/\*\.\{ts,tsx,html\}";/);
  assert.match(starterSource, /<link rel="stylesheet" href="\/src\/styles\.css" \/>/);
  assert.match(starterTests, /vp run graph-assertions/);
  assert.match(starterTests, /create-jiso: wrote 13 files/);
});

void test('P9 verification layer evidence remains represented', async () => {
  const testHarnessSource = await readProjectFile('packages/test/src/index.ts');
  const testHarnessTests = await readProjectFile('packages/test/src/index.test.ts');

  assert.match(testHarnessSource, /observeSql\(statement, config, observed\)/);
  assert.match(testHarnessSource, /prop === 'pglite'/);
  assert.match(testHarnessSource, /prop === 'transaction'/);
  assert.match(
    testHarnessTests,
    /verifies observed writes against the static touch graph after exec/,
  );
  assert.match(testHarnessTests, /verifies raw pglite handle calls against the static touch graph/);
  assert.match(
    testHarnessTests,
    /verifies raw pglite transaction handle calls against the static touch graph/,
  );
  assert.match(
    testHarnessTests,
    /fails query-loader verification for reads outside declared domains/,
  );
  assert.match(testHarnessTests, /verifies update-from SQL as a target write plus source reads/);
  assert.match(
    testHarnessTests,
    /accepts raw SQL compound predicates when one observed row key matches/,
  );
  assert.match(testHarnessTests, /FW408 Declared row key differs from observed row predicate/);
  assert.match(testHarnessSource, /diagnosticMessage\('FW402'/);
  assert.match(testHarnessSource, /diagnosticMessage\('FW404'/);
  assert.match(testHarnessSource, /diagnosticMessage\('FW407'/);
  assert.match(testHarnessSource, /diagnosticMessage\('FW408'/);
  assert.match(testHarnessSource, /diagnosticDefinitions\[code\]\.message/);
});

void test('P8 component explain includes handler capture channels', async () => {
  const cliSource = await readProjectFile('packages/cli/src/index.ts');
  const cliTests = await readProjectFile('packages/cli/src/index.test.ts');

  assert.match(
    cliSource,
    /export type CaptureChannel = 'ctx' \| 'element-params' \| 'module-scope'/,
  );
  assert.match(cliSource, /captures=\$\{list\(handler\.captures\)\}/);
  assert.match(cliTests, /captures: \['ctx', 'element-params'\]/);
  assert.match(cliTests, /captures=ctx,element-params params=itemId/);
});

void test('Drizzle pinned conformance suite is an explicit gate', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const viteConfig = await readProjectFile('vite.config.ts');
  const ciWorkflow = await readProjectFile('.github/workflows/ci.yml');
  const conformanceTest = await readProjectFile('conformance/drizzle-pin/src/index.test.ts');
  const drizzleTests = await readProjectFile('packages/drizzle/src/index.test.ts');

  assert.match(packageJson.scripts.acceptance, /pnpm run test:conformance/);
  assert.equal(packageJson.scripts['test:conformance'], 'vp run conformance-drizzle');
  assert.match(viteConfig, /'conformance-drizzle':\s*\{/);
  assert.match(ciWorkflow, /vp run conformance-drizzle/);
  assert.match(conformanceTest, /Drizzle pinned subset conformance/);
  assert.match(conformanceTest, /from 'drizzle-orm'/);
  assert.match(conformanceTest, /from 'drizzle-orm\/pg-core'/);
  assert.match(conformanceTest, /imports the pinned real Drizzle Postgres subset/);
  assert.match(conformanceTest, /pins direct table source extraction/);
  assert.match(conformanceTest, /pins local conditional table resolution/);
  assert.match(drizzleTests, /folds local helper writes and reads into caller summaries/);
  assert.match(drizzleTests, /dedupes recursive helper summaries at a fixed point/);
  assert.equal(
    JSON.parse(await readProjectFile('conformance/drizzle-pin/package.json')).devDependencies[
      'drizzle-orm'
    ],
    '0.45.2',
  );
});

void test('D3 deferred stream responses are consumed by the runtime', async () => {
  const runtimeSource = await readProjectFile('packages/runtime/src/index.ts');
  const runtimeTests = await readProjectFile('packages/runtime/src/index.test.ts');

  assert.match(runtimeSource, /applyDeferredStreamResponseToDom/);
  assert.match(runtimeSource, /deferredStreamChunks/);
  assert.match(runtimeSource, /--\$\{boundary\}/);
  assert.match(runtimeTests, /applies full deferred stream responses in boundary order/);
  assert.match(runtimeTests, /--jiso-boundary--/);
  assert.match(runtimeTests, /reviews-plan/);
  assert.match(runtimeTests, /morph:<section>Reviews ready<\/section>/);
});

void test('P1 minifier name preservation evidence remains represented', async () => {
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');

  assert.match(compilerSource, /collectMinifierReservedNames/);
  assert.match(compilerSource, /handlerExportPattern/);
  assert.match(compilerTests, /collects emitted handler export names for minifier preservation/);
  assert.match(compilerTests, /CartBadge\$button_click/);
  assert.match(compilerTests, /CartDrawer\$removeItem/);
});

void test('framework-owned browser suite is wired into acceptance', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const ciWorkflow = await readProjectFile('.github/workflows/ci.yml');
  const viteConfig = await readProjectFile('vite.config.ts');
  const browserConfig = await readProjectFile('vitest.browser.config.ts');

  assert.match(packageJson.scripts.acceptance, /pnpm run test:browser/);
  assert.equal(packageJson.scripts['test:browser'], 'vp run browser');
  assert.match(ciWorkflow, /vp run browser/);
  assert.match(viteConfig, /browser:\s*\{/);
  assert.match(viteConfig, /vitest --config vitest\.browser\.config\.ts --run/);
  assert.match(browserConfig, /@vitest\/browser-playwright/);
  assert.match(browserConfig, /browser: 'chromium'/);
});

void test('P10 perf acceptance is wired through Playwright and CDP', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const ciWorkflow = await readProjectFile('.github/workflows/ci.yml');
  const viteConfig = await readProjectFile('vite.config.ts');
  const perfScript = await readProjectFile('tests/p10-perf.node.mjs');

  assert.match(packageJson.scripts.acceptance, /pnpm run test:p10-perf/);
  assert.equal(packageJson.scripts['test:p10-perf'], 'vp run p10-perf');
  assert.match(ciWorkflow, /vp run build[\s\S]*vp run p10-perf[\s\S]*vp run fw-check/);
  assert.match(viteConfig, /'p10-perf':\s*\{/);
  assert.match(perfScript, /first-contentful-paint/);
  assert.match(perfScript, /activationStart/);
  assert.match(perfScript, /Runtime\.getHeapUsage/);
  assert.match(perfScript, /navigationCount,\s*100/);
});
