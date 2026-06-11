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

  assert.match(constitution, /`SPEC\.md` is the source of truth/);
  assert.match(constitution, /Legibility is load-bearing/);
  assert.match(constitution, /Sugar must lower to authorable IR/);
  assert.match(constitution, /The wire is the documentation/);
  assert.match(constitution, /Server truth always wins/);
  assert.match(compilerRules, /Source-derived names/);
  assert.match(compilerRules, /One-to-one file mapping/);
  assert.match(compilerRules, /Fixpoint invariant/);
  assert.match(compilerRules, /Platform behavior emission/);
  assert.match(compilerRules, /Teaching errors/);
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

  assert.match(
    commerceTests,
    /preserves commerce list identity through append and simultaneous optimistic reorder/,
  );
  assert.match(commerceTests, /renderProductGridPageFragment/);
  assert.match(commerceTests, /morphStructuralTree/);
  assert.match(commerceTests, /pendingMutation: 'cart\/add'/);
  assert.match(commerceTests, /order-history/);
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
  const viteConfig = await readProjectFile('vite.config.ts');
  const browserConfig = await readProjectFile('vitest.browser.config.ts');

  assert.match(packageJson.scripts.acceptance, /pnpm run test:browser/);
  assert.equal(packageJson.scripts['test:browser'], 'vp run browser');
  assert.match(viteConfig, /browser:\s*\{/);
  assert.match(viteConfig, /vitest --config vitest\.browser\.config\.ts --run/);
  assert.match(browserConfig, /@vitest\/browser-playwright/);
  assert.match(browserConfig, /browser: 'chromium'/);
});

void test('P10 perf acceptance is wired through Playwright and CDP', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const viteConfig = await readProjectFile('vite.config.ts');
  const perfScript = await readProjectFile('tests/p10-perf.node.mjs');

  assert.match(packageJson.scripts.acceptance, /pnpm run test:p10-perf/);
  assert.equal(packageJson.scripts['test:p10-perf'], 'vp run p10-perf');
  assert.match(viteConfig, /'p10-perf':\s*\{/);
  assert.match(perfScript, /first-contentful-paint/);
  assert.match(perfScript, /activationStart/);
  assert.match(perfScript, /Runtime\.getHeapUsage/);
  assert.match(perfScript, /navigationCount,\s*100/);
});
