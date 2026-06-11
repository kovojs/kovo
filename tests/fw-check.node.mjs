import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { missingBuildMessage } from '../scripts/fw-check.mjs';
import { fwCheck, fwExplain } from '../dist/cli/src/index.mjs';
import {
  assertRenderEquivalence,
  collectMinifierReservedNames,
  compileComponentModule,
} from '../dist/compiler/src/index.mjs';
import { diagnosticDefinitions } from '../dist/core/src/index.mjs';
import { readElementParams } from '../dist/runtime/src/index.mjs';
import {
  renderDocument,
  renderDocumentQueryScript,
  renderPageHints,
  renderQueryScript,
} from '../dist/server/src/index.mjs';

const responseMarker = '<<< RESPONSE';
const requestMarker = '>>> REQUEST';

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

const lineNumberFor = (source, needle) => {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `source contains ${needle}`);
  return source.slice(0, index).split('\n').length;
};

const explainValue = (output, prefix) => {
  const line = output.split('\n').find((item) => item.startsWith(prefix));
  assert.ok(line, `explain output includes ${prefix}`);
  return line.slice(prefix.length);
};

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
  assert.match(compilerRules, /render-equivalence gate/);
  assert.match(compilerRules, /Platform behavior emission/);
  assert.match(compilerRules, /Teaching errors/);
  assert.match(spec, /\*\*13\.1 CSS\.\*\* Jiso v1 is Tailwind-first/);
  assert.match(spec, /dynamic classes must be safelisted explicitly/);
  assert.match(spec, /@source inline\("\.\.\."\)/);
  assert.match(spec, /wraps them in `@scope` keyed to the host/);
  assert.doesNotMatch(spec, /needs a design pass before v1 freeze/);
});

void test('P10 legibility study packet is ready but not claimed complete', async () => {
  const study = await readProjectFile('docs/legibility-study.md');

  assert.match(study, /SPEC\.md` section 16\.2 requires an actual usability study/);
  assert.match(study, /Required participants: five outside developers/);
  assert.match(study, /under 60 seconds/);
  assert.match(study, /Button behavior/);
  assert.match(study, /Island data/);
  assert.match(study, /Mutation effects/);
  assert.match(study, /Optimism/);
  assert.match(study, /Failure path/);
  assert.match(study, /pending-5/);
  assert.match(study, /Do not mark SPEC §16\.2 or P10 legibility complete/);
});

void test('P10 v1 acceptance ledger tracks every freeze criterion', async () => {
  const ledger = await readProjectFile('docs/v1-acceptance.md');

  assert.match(ledger, /`SPEC\.md` section 16 is the normative acceptance contract/);
  assert.match(ledger, /Perf/);
  assert.match(ledger, /Legibility/);
  assert.match(ledger, /Verifiability/);
  assert.match(ledger, /Constitution/);
  assert.match(ledger, /Coverage/);
  assert.match(ledger, /Commerce matrix assertions in `examples\/commerce\/src\/app\.test\.ts`/);
  assert.match(ledger, /Navigation typed/);
  assert.match(
    ledger,
    /Commerce route\/link\/redirect checks plus route-rename proof in `packages\/runtime\/src\/index\.test\.ts`/,
  );
  assert.match(ledger, /Declared execution/);
  assert.match(ledger, /Update coverage/);
  assert.match(ledger, /FW311\/update-coverage graph assertions and `fw check coverage` output/);
  assert.match(ledger, /Pre-launch/);
  assert.match(ledger, /Do not mark `IMPLEMENT_v1\.md` P10 complete/);
});

void test('pre-launch checklist is tracked explicitly', async () => {
  const checklist = await readProjectFile('docs/prelaunch-checklist.md');

  assert.match(checklist, /launch-readiness checks/);
  assert.match(checklist, /before v1 freeze/);
  assert.match(checklist, /Trademark screen/);
  assert.match(checklist, /jiso\.dev/);
  assert.match(checklist, /`@jiso` npm/);
  assert.match(checklist, /Linguistic screen/);
  assert.match(checklist, /Do not mark v1 pre-launch complete/);
});

void test('S2 loader budget and L0 no-upgrade path are acceptance evidence', async () => {
  const runtimeSource = await readProjectFile('packages/runtime/src/index.ts');
  const runtimeTests = await readProjectFile('packages/runtime/src/index.test.ts');
  const inlineLoaderStart = runtimeSource.indexOf('const inlineJisoLoaderInstallerSource');
  const inlineLoaderEnd = runtimeSource.indexOf('export const jisoLoaderSource');
  assert.notEqual(inlineLoaderStart, -1, 'runtime has a pinned inline loader source');
  assert.notEqual(inlineLoaderEnd, -1, 'runtime exports generated inline loader source');
  const inlineLoaderSource = runtimeSource.slice(inlineLoaderStart, inlineLoaderEnd);

  assert.match(runtimeSource, /export function installInlineJisoLoader/);
  assert.match(runtimeSource, /inlineJisoLoaderInstallerSource/);
  assert.match(
    runtimeSource,
    /export const jisoLoaderSource = `\(\$\{inlineJisoLoaderInstallerSource\}\)\(\(url\)=>import\(url\)\);`/,
  );
  assert.doesNotMatch(
    runtimeSource,
    /installInlineJisoLoader\.toString\(\)|Function\.prototype\.toString|minifyInlineLoaderSource/,
    'inline loader source is pinned instead of regex-minified from function source',
  );
  assert.match(runtimeSource, /\(\(url\)=>import\(url\)\)/, 'handlers import only from event refs');
  assert.match(
    inlineLoaderSource,
    /signal: new AbortController\(\)\.signal/,
    'inline handlers receive ctx.signal',
  );
  assert.match(
    inlineLoaderSource,
    /IntersectionObserver/,
    'inline loader schedules declared visible triggers',
  );
  assert.match(inlineLoaderSource, /FW-Targets/, 'enhanced form submits send live targets');
  assert.match(inlineLoaderSource, /keepalive: true/, 'enhanced form submits use keepalive');
  assert.match(inlineLoaderSource, /DOMParser/, 'loader parses mutation response chunks');
  assert.match(inlineLoaderSource, /fw-fragment/, 'loader applies fragment chunks');
  assert.match(inlineLoaderSource, /on\\\\:load/, 'inline loader schedules declared load triggers');
  assert.match(inlineLoaderSource, /on\\\\:idle/, 'inline loader schedules declared idle triggers');
  assert.doesNotMatch(
    inlineLoaderSource,
    /\bcustomElements\.define\b|attachShadow|\bunload\b/,
    'loader has no upgrade/unload path',
  );
  assert.match(runtimeTests, /gzipSync\(jisoLoaderSource\)\.byteLength/);
  assert.match(runtimeTests, /toBeLessThanOrEqual\(4096\)/);
  assert.match(runtimeTests, /generated bootstrap source/);
  assert.match(runtimeTests, /shared inline loader source/);
  assert.match(runtimeTests, /FW-Targets': 'cart-badge=cart; inventory=inventory stock'/);
  assert.match(runtimeTests, /key: 'cart:c1'/);
});

void test('P2 loader smoke evidence remains represented in runtime tests', async () => {
  const runtimeSource = await readProjectFile('packages/runtime/src/index.ts');
  const runtimeHandlersSource = await readProjectFile('packages/runtime/src/handlers.ts');
  const runtimeMorphSource = await readProjectFile('packages/runtime/src/morph.ts');
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
  assert.match(runtimeSource, /export function installInlineJisoLoader/);
  assert.match(runtimeSource, /insertAdjacentHTML\(['"]beforeend['"]/);
  assert.match(runtimeHandlersSource, /signal: createHandlerSignal\(element, islandSignalScope\)/);
  assert.match(runtimeHandlersSource, /islandSignalControllers/);
  assert.match(
    runtimeMorphSource,
    /abortRemovedIslandSignals\(target\.readHtml\?\.\(\) \?\? '', fragment\.html, islandSignalScope\)/,
  );
  assert.match(runtimeSource, /visibleObserver\?: VisibleObserverFactory/);
  assert.match(runtimeSource, /export async function refetchQueries/);
  assert.match(runtimeSource, /`\/_q\/\$\{encodeURIComponent\(query\)\}`/);
  assert.match(runtimeSource, /Accept: 'text\/html'/);
  assert.match(runtimeSource, /interface CompiledQueryTemplateStamp/);
  assert.match(runtimeSource, /reconcileTemplateStamp\(items\)/);
  assert.match(runtimeSource, /readTemplateStampKey/);
  assert.match(runtimeTests, /invokes chained handler refs left-to-right with one context/);
  assert.match(
    runtimeTests,
    /scopes ctx\.signal to the island and aborts when fragment morph removes it/,
  );
  assert.match(runtimeTests, /aborts removed island ctx\.signal during fragment application/);
  assert.match(runtimeTests, /installs declared load, idle, and visible execution triggers/);
  assert.match(runtimeTests, /ships an inline enhanced form round trip through %s/);
  assert.match(runtimeTests, /refetches typed read endpoints and applies returned query chunks/);
  assert.match(
    runtimeTests,
    /uses typed read refetching from visible-return listeners when configured/,
  );
  assert.match(runtimeTests, /dedupes overlapping visible-return refetches/);
  assert.match(
    runtimeTests,
    /disposes loader listeners, visible observers, and auto-created broadcasts/,
  );
  assert.match(runtimeTests, /does not close caller-owned mutation broadcasts on dispose/);
  assert.match(runtimeTests, /reconciles compiled template stamps with keyed item descriptors/);
  assert.match(
    browserTests,
    /keeps the loader idle until the first delegated interaction/,
    'browser suite covers first-interaction handler import',
  );
  assert.match(
    browserTests,
    /refetches typed reads on document visible-return without a window focus duplicate/,
    'browser suite covers visible-return refetch without window focus duplication',
  );
  assert.match(
    browserTests,
    /preserves L0 light-DOM IDREF and form behavior without handler imports/,
    'browser suite covers L0 platform behavior through light DOM',
  );
  assert.match(
    browserTests,
    /preserves L0 popover behavior without handler imports/,
    'browser suite covers declarative L0 popover behavior',
  );
  assert.match(
    browserTests,
    /keeps the P2 L0\+L1 demo interactive at first paint with zero JS before declared triggers/,
    'browser suite covers the P2 exit demo as a standalone smoke',
  );
  assert.match(browserTests, /commandfor="details-dialog"/);
  assert.match(browserTests, /fw-c="catalog-tabs"/);
  assert.match(browserTests, /fw-c="catalog-filter"/);
  assert.match(browserTests, /fw-c="sales-chart" on:visible="\/demo\/chart\.js#mount"/);
  assert.match(browserTests, /expect\(imports\)\.toEqual\(\[\]\)/);
  assert.match(
    browserTests,
    /expect\(imports\)\.toEqual\(\['\/demo\/filter\.js', '\/demo\/tabs\.js', '\/demo\/chart\.js'\]\)/,
  );
  assert.match(browserTests, /:popover-open/);
  assert.match(browserTests, /new FormData\(form\)\.get\('query'\)/);
});

void test('P3 server renders initial query scripts for document-load hydration', async () => {
  const query = {
    key: 'cart:c1',
    name: 'cart',
    value: { html: '</script>' },
  };
  const queryScript =
    '<script type="application/json" fw-query="cart" key="cart:c1">{"html":"\\u003c/script>"}</script>';

  assert.equal(renderQueryScript(query), queryScript);
  assert.equal(renderDocumentQueryScript(query), queryScript);
  assert.match(
    renderDocument({
      body: '<main></main>',
      queries: [query],
    }).html,
    /<head>[\s\S]*<script type="application\/json" fw-query="cart" key="cart:c1">\{"html":"\\u003c\/script>"\}<\/script>[\s\S]*<\/head><body><main><\/main><\/body>/,
  );
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
  const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
  const registrySource = result.files.find((file) => file.kind === 'registry')?.source ?? '';

  assert.deepEqual(result.viewTransitions, [{ name: 'product-p1-image' }]);
  assert.match(
    serverSource,
    /<img style="opacity: \.8; view-transition-name: product-p1-image" src="\/p1\.png" \/>/,
  );
  assert.equal(serverSource.match(/\sstyle=/g)?.length, 1);
  assert.doesNotMatch(serverSource, /viewTransitionName=/);
  assert.match(registrySource, /'product-p1-image': unknown;/);
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
    [
      {
        code: 'FW221',
        fileName: 'components/cart/cart-search.tsx',
        length: 19,
        message: `${diagnosticDefinitions.FW221.message} missing-label`,
        severity: 'error',
        start: { column: 14, line: 7 },
      },
      {
        code: 'FW221',
        fileName: 'components/cart/cart-search.tsx',
        length: 41,
        message: `${diagnosticDefinitions.FW221.message} missing-help`,
        severity: 'error',
        start: { column: 30, line: 8 },
      },
      {
        code: 'FW221',
        fileName: 'components/cart/cart-search.tsx',
        length: 31,
        message: `${diagnosticDefinitions.FW221.message} missing-popover`,
        severity: 'error',
        start: { column: 15, line: 10 },
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
    [
      {
        code: 'FW224',
        fileName: 'components/cart/cart-shell.tsx',
        length: 15,
        message: `${diagnosticDefinitions.FW224.message} duplicate id="cart-title"`,
        severity: 'error',
        start: { column: 15, line: 8 },
      },
    ],
  );
  assert.deepEqual(
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
    [
      {
        code: 'FW224',
        fileName: 'components/cart/cart-list.tsx',
        length: 13,
        message: `${diagnosticDefinitions.FW224.message} repeatable id="cart-row"`,
        severity: 'error',
        start: { column: 13, line: 8 },
      },
    ],
  );
});

void test('P1 compiler validates HTML content-model parser stability', async () => {
  const coreSource = await readProjectFile('packages/core/src/diagnostics.ts');
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerMarkupSource = await readProjectFile('packages/compiler/src/validate/markup.ts');
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');

  assert.match(coreSource, /FW225/);
  assert.match(coreSource, /JSX nesting violates the HTML content model/);
  assert.match(compilerSource, /validateHtmlContentModel/);
  assert.match(compilerMarkupSource, /blockTagsThatCloseParagraph/);
  assert.match(compilerMarkupSource, /diagnosticDefinitions\.FW225\.message/);
  assert.match(
    compilerTests,
    /accepts native table rows when the parser keeps the authored tree shape/,
  );
  assert.match(compilerTests, /reports FW225 for parser-reparented HTML content-model violations/);
});

void test('P1 compiler validates declared execution trigger names', async () => {
  const coreSource = await readProjectFile('packages/core/src/diagnostics.ts');
  const compilerEventTriggerSource = await readProjectFile(
    'packages/compiler/src/validate/event-triggers.ts',
  );
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');

  assert.match(coreSource, /FW211/);
  assert.match(coreSource, /FW212/);
  assert.match(compilerSource, /validateEventTriggerNames/);
  assert.match(compilerEventTriggerSource, /declaredExecutionTriggers/);
  assert.match(compilerEventTriggerSource, /hasFw211Justification/);
  assert.match(compilerTests, /accepts known delegated events and declared execution triggers/);
  assert.match(
    compilerTests,
    /reports FW211 and FW212 for unjustified eager execution and unknown triggers/,
  );
});

void test('P1 compiler validates residual fw-c and fw-deps stamps', async () => {
  const coreSource = await readProjectFile('packages/core/src/diagnostics.ts');
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerMarkupSource = await readProjectFile('packages/compiler/src/validate/markup.ts');
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');

  assert.match(coreSource, /FW226/);
  assert.match(coreSource, /fw-deps or fw-c names an unknown query instance or component/);
  assert.match(compilerSource, /validateResidualStamps/);
  assert.match(compilerMarkupSource, /fw226Diagnostic/);
  assert.match(
    compilerTests,
    /validates residual fw-c and fw-deps stamps against known component and query facts/,
  );
  assert.match(
    compilerTests,
    /reports FW226 for residual stamps naming unknown components or query instances/,
  );
});

void test('P1 compiler emits FW311 update coverage facts', async () => {
  const coreSource = await readProjectFile('packages/core/src/diagnostics.ts');
  const componentContractsSource = await readProjectFile(
    'packages/compiler/src/validate/component-contracts.ts',
  );
  const compilerDiagnosticsSource = await readProjectFile('packages/compiler/src/diagnostics.ts');
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerBindingsSource = await readProjectFile(
    'packages/compiler/src/validate/bindings.ts',
  );
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');

  assert.match(coreSource, /FW311/);
  assert.match(coreSource, /Query-dependent DOM position has no update status/);
  assert.match(compilerSource, /interface QueryUpdateCoverageFact/);
  assert.match(compilerDiagnosticsSource, /interface SourcePosition/);
  assert.match(compilerDiagnosticsSource, /function offsetToPosition/);
  assert.match(compilerSource, /collectQueryUpdateCoverage/);
  assert.match(componentContractsSource, /fw311Diagnostic/);
  assert.match(compilerBindingsSource, /status: 'renderOnce'/);
  assert.match(compilerBindingsSource, /status: 'isomorphic'/);
  assert.match(compilerBindingsSource, /status: 'UNHANDLED'/);
  assert.match(compilerTests, /classifies query-dependent render positions for FW311 coverage/);
  assert.match(compilerTests, /status: 'plan'/);
  assert.match(compilerTests, /status: 'renderOnce'/);
  assert.match(
    compilerTests,
    /classifies query-dependent render positions as isomorphic when declared/,
  );
  assert.match(compilerTests, /code: 'FW311'/);
});

void test('P1 compiler validates binding stamp expression drift', async () => {
  const coreSource = await readProjectFile('packages/core/src/diagnostics.ts');
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerBindingsSource = await readProjectFile(
    'packages/compiler/src/validate/bindings.ts',
  );
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');

  assert.match(coreSource, /FW222/);
  assert.match(coreSource, /FW223/);
  assert.match(coreSource, /Hand-written binding stamp disagrees/);
  assert.match(coreSource, /Redundant hand-written binding stamp/);
  assert.match(compilerSource, /validateStampExpressionDrift/);
  assert.match(compilerBindingsSource, /bindingExpressionStamps/);
  assert.match(compilerBindingsSource, /soleWrappedQueryExpression/);
  assert.match(
    compilerTests,
    /reports FW222 and FW223 for hand-written stamps around typed expressions in sugar/,
  );
  assert.match(compilerTests, /data-bind="cart\.count" wraps \{cart\.total\}/);
});

void test('P1 compiler validates primitive composition attribute merges', async () => {
  const coreSource = await readProjectFile('packages/core/src/diagnostics.ts');
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerMarkupSource = await readProjectFile('packages/compiler/src/validate/markup.ts');
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');

  assert.match(coreSource, /FW231/);
  assert.match(coreSource, /FW232/);
  assert.match(coreSource, /FW233/);
  assert.match(coreSource, /Unmergeable attribute conflict/);
  assert.match(coreSource, /Author overrides a primitive-owned ARIA or state attribute/);
  assert.match(coreSource, /Two writers target the same binding slot/);
  const compilerParseSource = await readProjectFile('packages/compiler/src/scan/parse.ts');
  assert.match(compilerSource, /validateAttributeMergeConflicts/);
  assert.match(compilerParseSource, /interface JsxAttributeModel/);
  assert.match(compilerParseSource, /function jsxElements/);
  assert.match(compilerMarkupSource, /ambiguousRelationshipAttributes/);
  assert.match(compilerMarkupSource, /primitiveOwnedOverrideAttributes/);
  assert.match(compilerMarkupSource, /attributeMergeDiagnostic/);
  assert.match(
    compilerTests,
    /reports FW231, FW232, and FW233 for residual attribute merge conflicts/,
  );
  assert.match(compilerTests, /data-bind:hidden/);
});

void test('P1 compiler validates fragment-target child hoisting failures', async () => {
  const coreSource = await readProjectFile('packages/core/src/diagnostics.ts');
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const componentContractsSource = await readProjectFile(
    'packages/compiler/src/validate/component-contracts.ts',
  );
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');

  assert.match(coreSource, /FW230/);
  assert.match(coreSource, /Fragment-target children cannot lower to a component reference/);
  assert.match(compilerSource, /validateFragmentTargetChildren/);
  assert.match(componentContractsSource, /fragmentTargetUsageNames/);
  assert.match(componentContractsSource, /fragmentTargetChildBodies/);
  assert.match(componentContractsSource, /fw230Diagnostic/);
  assert.match(
    compilerTests,
    /accepts fragment target children that can hoist through serializable props/,
  );
  assert.match(
    compilerTests,
    /reports FW230 when fragment target children capture unserializable values/,
  );
  assert.match(compilerTests, /Would hoist children to: CartRow\$slot_children/);
});

void test('P3 typed routes validate navigation targets', async () => {
  const coreSource = await readProjectFile('packages/core/src/index.ts');
  const coreTests = await readProjectFile('packages/core/src/index.test.ts');
  const diagnosticsSource = await readProjectFile('packages/core/src/diagnostics.ts');
  const compilerGraphSource = await readProjectFile('packages/compiler/src/graph.ts');
  const compilerRegistrySource = await readProjectFile('packages/compiler/src/emit/registry.ts');
  const compilerNavigationLoweringSource = await readProjectFile(
    'packages/compiler/src/lower/navigation.ts',
  );
  const compilerNavigationSource = await readProjectFile(
    'packages/compiler/src/validate/navigation.ts',
  );
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');
  const serverSource = await readProjectFile('packages/server/src/index.ts');
  const serverTests = await readProjectFile('packages/server/src/index.test.ts');

  assert.match(diagnosticsSource, /FW220/);
  assert.match(diagnosticsSource, /Literal href or form action matches no declared route/);
  assert.match(coreSource, /interface RouteRegistry/);
  assert.match(coreSource, /function route/);
  assert.match(coreSource, /function href/);
  assert.match(coreSource, /function Link/);
  assert.match(coreSource, /function redirect/);
  assert.match(coreSource, /GetForm</);
  assert.match(coreSource, /get: getRouteForm/);
  assert.match(coreTests, /builds typed route hrefs, links, and redirects/);
  assert.match(coreTests, /types GET form fields against route search schemas/);
  assert.match(coreTests, /productFilter\.input\('max'\)/);
  assert.match(coreTests, /productFilter\.input\('sku'\)/);
  assert.match(compilerGraphSource, /routes\?: readonly string\[\]/);
  assert.match(compilerNavigationLoweringSource, /lowerNavigationSugar/);
  assert.match(compilerNavigationLoweringSource, /lowerStaticLinks/);
  assert.match(compilerNavigationLoweringSource, /lowerStaticHrefCalls/);
  assert.match(compilerNavigationSource, /validateLiteralHrefs/);
  assert.match(compilerRegistrySource, /routeRegistryFactLines/);
  assert.match(
    compilerTests,
    /reports FW220 for literal navigation targets outside the route table/,
  );
  assert.match(compilerTests, /lowers static Link navigation sugar to plain anchors/);
  assert.match(
    compilerTests,
    /lowers static href calls to literal anchor hrefs before FW220 validation/,
  );
  assert.match(serverSource, /export function route/);
  assert.match(serverSource, /interface RouteDeclaration/);
  assert.match(serverSource, /function parseRouteRequest/);
  assert.match(serverSource, /export \{ Link, href, redirect \} from '@jiso\/core'/);
  assert.match(serverTests, /declares route schemas, route-owned hints, and typed PRG redirects/);
  assert.match(serverTests, /sku is not part of the generated route search schema/);
});

void test('P3 mutation lifecycle includes an explicit transaction boundary', async () => {
  const serverSource = await readProjectFile('packages/server/src/index.ts');
  const serverTests = await readProjectFile('packages/server/src/index.test.ts');
  const testHarnessSource = await readProjectFile('packages/test/src/index.ts');

  assert.match(serverSource, /transaction\?: <Result>/);
  assert.match(serverSource, /run: \(transactionRequest: GuardedRequest\) => Promise<Result>/);
  assert.match(serverSource, /definition\.transaction/);
  assert.match(serverSource, /class MutationRollback extends Error/);
  assert.match(serverSource, /interface QueryLoadContext/);
  assert.match(serverSource, /resolveLifecycleRequest\(request, options\)/);
  assert.match(serverSource, /definition\.load\(input, \{ request: lifecycleRequest \}\)/);
  assert.match(serverTests, /runs guarded mutation handlers inside the configured transaction/);
  assert.match(serverTests, /types transaction callbacks with the mutation request shape/);
  assert.match(serverTests, /transaction callbacks must receive the typed request shape/);
  assert.match(serverTests, /rolls back configured transactions for typed mutation failures/);
  assert.match(
    serverTests,
    /renders mutation query chunks after the configured transaction commits/,
  );
  assert.match(serverTests, /reruns post-commit queries with the same request context/);
  assert.match(testHarnessSource, /request: \{\n\s+\.\.\.options\.request,\n\s+db,/);
});

void test('P3 server data-plane APIs stay exported and covered', async () => {
  const serverSource = await readProjectFile('packages/server/src/index.ts');
  const serverTests = await readProjectFile('packages/server/src/index.test.ts');

  assert.match(serverSource, /export async function runQuery/);
  assert.match(serverSource, /export async function renderQueryEndpointResponse/);
  assert.match(serverSource, /export async function renderQueryRegistryEndpointResponse/);
  assert.match(serverSource, /args\?: Schema<Input>/);
  assert.match(serverSource, /guard\?: Guard<Request>/);
  assert.match(serverSource, /load\?\(input: Input, context\?: QueryLoadContext<Request>\)/);
  assert.match(serverSource, /export async function runRoutePage/);
  assert.match(serverSource, /export async function renderRoutePageResponse/);
  assert.match(serverSource, /export function notFound/);
  assert.match(serverSource, /export function csrfToken/);
  assert.match(serverSource, /export function csrfField/);
  assert.match(serverSource, /csrf\?: CsrfValidationOptions<Request> \| false/);
  assert.match(serverSource, /function mutationCsrfOptions/);
  assert.match(serverSource, /csrf === undefined \|\|/);
  assert.match(
    serverTests,
    /runs query endpoints through args schemas, guards, and request context/,
  );
  assert.match(serverTests, /matches the typed read wire fixture response byte-for-byte/);
  assert.match(
    serverTests,
    /matches the P0 wire fixtures through a live HTTP server byte-for-byte/,
  );
  assert.match(serverTests, /fetchWireFixture/);
  assert.match(serverTests, /dispatches typed read endpoints through a query registry/);
  assert.match(serverTests, /runs route pages through guards and notFound page outcomes/);
  assert.match(serverTests, /validates mutation CSRF tokens before running guards/);
  assert.match(serverTests, /uses default mutation CSRF options before schema parsing/);
  assert.match(serverTests, /preserves legacy mutation execution when csrf is explicitly false/);
});

void test('P3 route and query guard removal is mechanically audited by fw check', () => {
  // SPEC.md section 6.4 and IMPLEMENT_v1.md P3 require route/query guards to surface
  // through the unguarded audit when removed.
  assert.deepEqual(
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
    {
      exitCode: 0,
      output: [
        'fw-check/v1',
        'WARN UNGUARDED inventory/sync mutation is reachable without an auth guard.',
        'WARN UNGUARDED page /admin is reachable without an auth guard.',
        'WARN UNGUARDED query adminOrders is reachable without an auth guard.',
        '',
      ].join('\n'),
    },
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
  assert.match(browserTests, /appends real DOM fragments without replacing keyed list nodes/);
  assert.match(browserTests, /document\.activeElement/);
  assert.match(browserTests, /selectionStart/);
  assert.match(browserTests, /scrollTop/);
  assert.match(browserTests, /fw-key="p1"/);
  assert.match(browserTests, /getAttribute\('fw-key'\)/);
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
  assert.match(commerceTests, /fw-key="p1"/);
  assert.match(commerceTests, /fw-key="order-1"/);
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

void test('P6 navigation bfcache optimism cleanup acceptance is represented', async () => {
  const runtimeSource = await readProjectFile('packages/runtime/src/index.ts');
  const runtimeTests = await readProjectFile('packages/runtime/src/index.test.ts');

  assert.match(runtimeSource, /export function installPagehideOptimismCleanup/);
  assert.match(runtimeSource, /options\.root\.addEventListener\('pagehide'/);
  assert.match(runtimeSource, /keepalive: true/);
  assert.doesNotMatch(runtimeSource, /\baddEventListener\(['"]unload['"]/);
  assert.match(
    runtimeTests,
    /cleans up mid-flight optimistic navigation while the keepalive mutation continues/,
  );
  assert.match(runtimeTests, /SPEC\.md §8\/§10\.4/);
  assert.match(runtimeTests, /discardPendingOptimism\(\)/);
  assert.match(runtimeTests, /stampPendingQueries\(pendingRoot, discarded, false\)/);
  assert.match(runtimeTests, /expect\(options\.keepalive\)\.toBe\(true\)/);
  assert.match(runtimeTests, /type: 'pagehide'/);
  assert.match(runtimeTests, /expect\(store\.get\('cart'\)\)\.toEqual\(\{ count: 1 \}\)/);
  assert.match(runtimeTests, /expect\(store\.get\('cart'\)\)\.toEqual\(\{ count: 2 \}\)/);
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
  const compilerCssSource = await readProjectFile('packages/compiler/src/css.ts');
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');
  const serverHintsSource = await readProjectFile('packages/server/src/hints.ts');
  const serverSource = await readProjectFile('packages/server/src/index.ts');
  const serverTests = await readProjectFile('packages/server/src/index.test.ts');

  assert.match(commerceSource, /commerceStylesheets = \['\/assets\/tailwind\.css'\] as const/);
  assert.match(commerceSource, /failureStylesheets: commerceStylesheets/);
  assert.match(commerceSource, /stylesheets: commerceStylesheets/);
  assert.match(commerceSource, /renderProductGridDeferredStream/);
  assert.match(commerceSource, /renderDeferredStream/);
  assert.match(commerceSource, /stylesheets: commerceStylesheets/);
  assert.match(commerceSource, /renderFailureFragment: \(failure\) =>/);
  assert.match(
    commerceSource,
    /renderAddToCartFailureFragment\(request\.db, rawInput, failure, request\)/,
  );
  assert.match(commerceSource, /return renderAddToCartForm\(product, failure, request\)/);
  assert.match(commerceTests, /response\.body\.match/);
  assert.match(commerceTests, /toHaveLength\(3\)/);
  assert.match(commerceTests, /enhanced addToCart failures as a rerendered form fragment/);
  assert.match(
    commerceTests,
    /streams deferred product grid fragments with Tailwind stylesheet hints/,
  );
  assert.match(commerceTests, /fw-fragment-target="product-form:p2"/);
  assert.match(commerceTests, /<link rel="stylesheet" href="\/assets\/tailwind\.css">/);
  assert.match(commerceTests, /border-slate-200/);
  assert.match(serverSource, /failureStylesheets\?: readonly \(string \| StylesheetAsset\)\[\]/);
  assert.match(serverHintsSource, /criticalCss\?: string/);
  assert.match(serverHintsSource, /data-jiso-critical-href/);
  assert.match(serverHintsSource, /escapeStyleText/);
  assert.match(compilerCssSource, /criticalCss\?: string/);
  assert.match(compilerCssSource, /cssAsset\.criticalCss/);
  assert.match(compilerSource, /from '\.\/css\.js'/);
  assert.match(compilerTests, /criticalCss: expect\.stringContaining/);
  assert.match(serverSource, /renderStylesheetLinks\(wireRequest\.failureStylesheets/);
  assert.match(serverSource, /error-boundary=.*renderStylesheetLinks\(renderer\.stylesheets/);
  assert.match(serverTests, /inlines critical component CSS without losing stylesheet identity/);
  assert.match(serverTests, /delivers late stylesheets with enhanced mutation failure fragments/);
  assert.match(serverTests, /recommendations\.css/);
});

void test('D4 commerce adopt-dont-invent features stay represented', async () => {
  const commerceSource = await readProjectFile('examples/commerce/src/app.ts');
  const commerceTests = await readProjectFile('examples/commerce/src/app.test.ts');
  const runtimeSource = await readProjectFile('packages/runtime/src/index.ts');
  const runtimeTests = await readProjectFile('packages/runtime/src/index.test.ts');
  const serverHintsSource = await readProjectFile('packages/server/src/hints.ts');
  const serverSource = await readProjectFile('packages/server/src/index.ts');
  const serverTests = await readProjectFile('packages/server/src/index.test.ts');

  assert.match(commerceSource, /meta\(\{/);
  assert.match(commerceSource, /metaFromQuery\(cartQuery, \(cart\)/);
  assert.match(commerceSource, /renderCommercePageHints\(loadCartQuery\(db\)\)/);
  assert.match(commerceSource, /queries: \{ cart \}/);
  assert.match(serverSource, /function metaFromQuery/);
  assert.match(serverHintsSource, /Missing query data for route meta/);
  assert.match(serverSource, /interface Guard<Request, RefinedRequest extends Request = Request>/);
  assert.match(serverSource, /AuthenticatedRequest<Request extends SessionRequestLike>/);
  assert.match(serverSource, /guard\?: Guard<Request, GuardedRequest>/);
  assert.match(serverSource, /lifecycleRequest as GuardedRequest/);
  assert.match(serverTests, /resolves app session providers before route and query guards/);
  assert.match(
    serverTests,
    /maps route and query guard failures to login redirects and 403 shells/,
  );
  assert.match(serverTests, /derives typed route meta from query results/);
  assert.match(serverTests, /refines typed session users inside authed mutation handlers/);
  assert.match(commerceTests, /resolves commerce route meta from loaded cart query data/);
  assert.match(commerceSource, /i18n\('en-US'/);
  assert.match(commerceSource, /s\.file\(\{ maxBytes: 64 \* 1024/);
  assert.match(commerceSource, /fw-upload-progress/);
  assert.match(commerceSource, /errorBoundary\(/);
  assert.match(commerceSource, /commerceSession = session\(/);
  assert.match(commerceSource, /guards\.rateLimit<CommerceRequest>/);
  assert.match(commerceSource, /inputFields: \['orderId', 'receipt'\]/);
  assert.match(commerceSource, /fileFields: \['receipt'\]/);
  assert.match(commerceSource, /i18n: \['en-US:cartLabel,productStock'\]/);
  assert.match(
    commerceTests,
    /coerces commerce receipt uploads through storage-backed s\.file\(\)/,
  );
  assert.match(commerceTests, /fw-upload-progress value="0" max="100"/);
  assert.match(commerceTests, /session: commerceSession/);
  assert.match(commerceTests, /file-fields: receipt/);
  assert.match(commerceTests, /meta: title=Jiso Commerce/);
  assert.match(commerceTests, /Jiso Commerce \(1\)/);
  assert.match(runtimeTests, /FormFailure<typeof addToCart>/);
  assert.match(runtimeTests, /failure\.code === 'VALIDATION'/);
  assert.match(runtimeSource, /onUploadProgress\?: \(progress: UploadProgress/);
  assert.match(runtimeSource, /updateUploadProgressElements\(form, progress\)/);
  assert.match(runtimeSource, /stampEnhancedMutationPending\(options, true\)/);
  assert.match(runtimeTests, /onUploadProgress: uploadProgress/);
  assert.match(runtimeTests, /progressElement\.getAttribute\('value'\)/);
  assert.match(runtimeTests, /'fw-deps': 'order'/);
  assert.match(
    commerceTests,
    /contains product-grid fragment failures with a per-island error boundary/,
  );
  assert.match(commerceTests, /uses the typed commerce session schema in authenticated mutations/);
  assert.match(commerceTests, /fw-i18n locale="en-US"/);
});

void test('P10 commerce graph assertions answer behavior mechanically', async () => {
  const cliSource = await readProjectFile('packages/cli/src/index.ts');
  const cliTests = await readProjectFile('packages/cli/src/index.test.ts');
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');
  const coreSource = await readProjectFile('packages/core/src/index.ts');
  const fwCheckRunner = await readProjectFile('scripts/fw-check.mjs');
  const graphArtifact = await readProjectFile('examples/commerce/src/generated/graph.json');
  const runtimeSource = await readProjectFile('packages/runtime/src/index.ts');
  const runtimeTests = await readProjectFile('packages/runtime/src/index.test.ts');
  const viteConfig = await readProjectFile('vite.config.ts');
  const commerceGraph = JSON.parse(graphArtifact);
  const cartQueryExplain = fwExplain(commerceGraph, { kind: 'query', target: 'cart' }).output;
  const cartAddExplain = fwExplain(commerceGraph, {
    kind: 'mutation',
    optimistic: true,
    target: 'cart/add',
  }).output;
  const uploadReceiptExplain = fwExplain(commerceGraph, {
    kind: 'mutation',
    optimistic: true,
    target: 'order/receipt',
  }).output;

  assert.deepEqual(fwCheck(commerceGraph), { exitCode: 0, output: 'fw-check/v1\nOK\n' });
  assert.equal(explainValue(cartQueryExplain, 'consumers: '), 'component:CartBadge,page:/cart');
  assert.equal(explainValue(cartQueryExplain, 'invalidated-by: '), 'cart/add');
  assert.equal(explainValue(cartQueryExplain, 'domain-writes: '), 'cart.addItem');
  assert.equal(explainValue(cartAddExplain, 'session: '), 'commerceSession');
  assert.equal(explainValue(cartAddExplain, 'input-fields: '), 'productId,quantity');
  assert.equal(explainValue(cartAddExplain, 'writes: '), 'cart,product,order');
  assert.equal(explainValue(cartAddExplain, 'invalidates: '), 'cart,product,order');
  assert.match(explainValue(cartAddExplain, 'updates: '), /cart->component:CartBadge,page:\/cart/);
  assert.match(
    explainValue(cartAddExplain, 'updates: '),
    /productGrid->component:ProductGrid,page:\/cart/,
  );
  assert.match(
    explainValue(cartAddExplain, 'updates: '),
    /orderHistory->component:OrderHistory,page:\/cart/,
  );
  assert.match(cartAddExplain, /^OPTIMISTIC-SUMMARY .*UNHANDLED=0$/m);
  assert.equal(explainValue(uploadReceiptExplain, 'file-fields: '), 'receipt');
  assert.equal(explainValue(uploadReceiptExplain, 'invalidates: '), '-');
  assert.match(cliTests, /hand-write in the mutation module, or declare 'await-fragment'/);
  assert.match(cliTests, /ignores unrelated statuses/);
  assert.match(cliSource, /diagnosticDefinitions\.FW310\.message/);
  assert.match(cliTests, /prints stable FW311 update coverage rows and warnings/);
  assert.match(cliTests, /prints static diagnostic source positions when present/);
  assert.match(cliTests, /fails fw check coverage as a CLI command when coverage is unhandled/);
  assert.match(cliTests, /WARN FW311 component=CartBadge query=cart\.discount/);
  assert.match(coreSource, /interface InvalidationSets/);
  assert.match(await readProjectFile('packages/core/src/diagnostics.ts'), /FW311/);
  assert.match(compilerSource, /componentGraphFacts: readonly ComponentGraphFact\[\]/);
  const compilerGraphSource = await readProjectFile('packages/compiler/src/graph.ts');
  assert.match(compilerGraphSource, /function deriveAppGraph/);
  assert.match(
    compilerGraphSource,
    /invalidations\?: Readonly<Record<string, readonly string\[\]>>/,
  );
  assert.match(compilerGraphSource, /function deriveRegistryFactsFromGraph/);
  assert.match(compilerGraphSource, /function deriveInvalidationFactsFromGraph/);
  assert.match(
    await readProjectFile('packages/compiler/src/emit/registry.ts'),
    /function invalidationSetFactLines/,
  );
  assert.match(compilerTests, /export interface InvalidationSets/);
  assert.match(compilerTests, /derives app graph component facts from compiled component results/);
  assert.match(compilerTests, /derives registry facts from graph query, mutation, and page facts/);
  assert.match(runtimeSource, /type InvalidatedQueryValues/);
  assert.match(runtimeSource, /OptimisticEntry/);
  assert.match(
    runtimeTests,
    /requires optimistic coverage from generated invalidation sets by default/,
  );
  assert.match(runtimeTests, /productGrid: 'await-fragment'/);
  assert.match(fwCheckRunner, /tests\/fw-check\.node\.mjs/);
  assert.match(fwCheckRunner, /dist\/cli\/src\/index\.mjs/);
  assert.match(fwCheckRunner, /examples\/commerce\/src\/generated\/graph\.json/);
  assert.match(viteConfig, /command: 'node scripts\/fw-check\.mjs'/);
  assert.match(viteConfig, /examples\/commerce\/src\/generated\/graph\.json/);
  assert.deepEqual(
    Object.keys(commerceGraph.touchGraph)
      .filter((key) => ['cart.addItem', 'order.receipt', 'payment.webhook'].includes(key))
      .sort(),
    ['cart.addItem', 'order.receipt', 'payment.webhook'],
  );
});

void test('P10 starter wires graph assertions into CI', async () => {
  const [
    packageJsonSource,
    viteConfigSource,
    ciWorkflow,
    starterGraphSource,
    emitGraphSource,
    graphAssertionsSource,
    clientSource,
    appFixpointTest,
    stylesSource,
    indexHtml,
  ] = await Promise.all([
    readProjectFile('packages/create-jiso/templates/package.json'),
    readProjectFile('packages/create-jiso/templates/vite.config.ts'),
    readProjectFile('packages/create-jiso/templates/.github/workflows/ci.yml'),
    readProjectFile('packages/create-jiso/templates/graph.json'),
    readProjectFile('packages/create-jiso/templates/scripts/emit-graph.mjs'),
    readProjectFile('packages/create-jiso/templates/scripts/graph-assertions.mjs'),
    readProjectFile('packages/create-jiso/templates/src/client.ts'),
    readProjectFile('packages/create-jiso/templates/src/app.fixpoint.test.ts'),
    readProjectFile('packages/create-jiso/templates/src/styles.css'),
    readProjectFile('packages/create-jiso/templates/index.html'),
  ]);
  const starterTests = await readProjectFile('packages/create-jiso/src/index.test.ts');
  const packageJson = JSON.parse(packageJsonSource);
  const starterGraph = JSON.parse(starterGraphSource);
  const cartQueryExplain = fwExplain(starterGraph, { kind: 'query', target: 'cart' }).output;
  const cartAddExplain = fwExplain(starterGraph, {
    kind: 'mutation',
    optimistic: true,
    target: 'cart/add',
  }).output;
  const cartPageExplain = fwExplain(starterGraph, { kind: 'page', target: '/cart' }).output;

  assert.equal(packageJson.scripts['emit-graph'], 'node scripts/emit-graph.mjs');
  assert.equal(packageJson.scripts['fw-check'], 'vp run fw-check');
  assert.equal(packageJson.scripts['graph-assertions'], 'vp run graph-assertions');
  assert.equal(packageJson.dependencies['@jiso/runtime'], 'workspace:*');
  assert.equal(packageJson.devDependencies['@jiso/compiler'], 'workspace:*');
  assert.equal(packageJson.devDependencies['@tailwindcss/vite'], '^4.1.0');
  assert.equal(packageJson.devDependencies.tailwindcss, '^4.1.0');

  assert.deepEqual(fwCheck(starterGraph), { exitCode: 0, output: 'fw-check/v1\nOK\n' });
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
  assert.equal(
    explainValue(cartQueryExplain, 'consumers: '),
    'component:CartBadge,component:CartPanel,page:/cart',
  );
  assert.equal(explainValue(cartQueryExplain, 'invalidated-by: '), 'cart/add');
  assert.equal(explainValue(cartQueryExplain, 'domain-writes: '), 'cart.addItem');
  assert.equal(explainValue(cartAddExplain, 'session: '), 'starterSession');
  assert.equal(explainValue(cartAddExplain, 'input-fields: '), 'productId,quantity');
  assert.equal(
    explainValue(cartAddExplain, 'updates: '),
    'cart->component:CartBadge,component:CartPanel,page:/cart',
  );
  assert.match(cartAddExplain, /^OPTIMISTIC cart await-fragment$/m);
  assert.match(cartAddExplain, /^OPTIMISTIC-SUMMARY .*UNHANDLED=0$/m);
  assert.equal(
    explainValue(cartPageExplain, 'meta: '),
    'title=Jiso Starter Cart description=Starter cart backed by query data. image=-',
  );
  assert.equal(explainValue(cartPageExplain, 'i18n: '), 'en-US:cartTitle');
  assert.equal(explainValue(cartPageExplain, 'queries: '), 'cart');
  assert.equal(explainValue(cartPageExplain, 'stylesheets: '), '/src/styles.css');

  assert.match(
    viteConfigSource,
    /command: 'node scripts\/emit-graph\.mjs && fw check graph\.json'/,
  );
  assert.match(
    viteConfigSource,
    /command: 'node scripts\/emit-graph\.mjs && node scripts\/graph-assertions\.mjs'/,
  );
  assert.match(viteConfigSource, /'scripts\/emit-graph\.mjs'/);
  assert.match(viteConfigSource, /'scripts\/graph-assertions\.mjs'/);
  assert.match(ciWorkflow, /- run: vp run fw-check/);
  assert.match(ciWorkflow, /- run: vp run graph-assertions/);
  assert.match(emitGraphSource, /deriveAppGraph/);
  assert.match(graphAssertionsSource, /fwExplain\(\['page', '\/cart'\]\)/);
  assert.match(appFixpointTest, /assertRenderEquivalence/);
  assert.match(clientSource, /installJisoLoader\(\{/);
  assert.match(clientSource, /enhancedMutations: \{/);
  assert.match(clientSource, /queryPlans,/);
  assert.match(clientSource, /applyDeferredStreamResponseToDom/);
  assert.match(clientSource, /applyJisoDeferredStreamResponse/);
  assert.doesNotMatch(clientSource, /innerHTML = App\.definition\.render\(\)/);
  assert.match(stylesSource, /@source "\.\.\/index\.html";/);
  assert.match(stylesSource, /@source "\.\/\*\*\/\*\.\{ts,tsx,html\}";/);
  assert.match(stylesSource, /@source inline\("bg-emerald-50 text-emerald-700/);
  assert.match(indexHtml, /<link rel="stylesheet" href="\/src\/styles\.css" \/>/);
  assert.match(indexHtml, /<script type="module" src="\/src\/client\.ts"><\/script>/);
  assert.doesNotMatch(indexHtml, /src\/main\.ts/);
  assert.match(starterTests, /vp run graph-assertions/);
  assert.match(starterTests, /src\/app\.fixpoint\.test\.ts/);
  assert.match(
    starterTests,
    /builds generated starter CSS with static and safelisted Tailwind utilities/,
  );
  assert.match(starterTests, /resolveBin\('vite'\)/);
  assert.match(starterTests, /\.bg-emerald-50/);
  assert.match(starterTests, /create-jiso: wrote 15 files/);
});

void test('P9 verification layer evidence remains represented', async () => {
  const runtimeSource = await readProjectFile('packages/runtime/src/index.ts');
  const runtimeTests = await readProjectFile('packages/runtime/src/index.test.ts');
  const testHarnessSource = await readProjectFile('packages/test/src/index.ts');
  const testHarnessTests = await readProjectFile('packages/test/src/index.test.ts');

  assert.match(testHarnessSource, /observeSql\(statement, config, observed\)/);
  assert.match(testHarnessSource, /csrf\?: CsrfValidationOptions<Request>/);
  assert.match(testHarnessSource, /const result = await runMutation\(/);
  assert.match(
    testHarnessSource,
    /execOptions\?\.csrf === undefined \? \{\} : \{ csrf: execOptions\.csrf \}/,
  );
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
  assert.match(testHarnessSource, /exemptTables\?: readonly string\[\]/);
  assert.match(testHarnessSource, /assertNoExemptReads/);
  assert.match(testHarnessTests, /fails read-side verification for exempt table reads/);
  assert.match(
    testHarnessTests,
    /fails query-loader verification for raw SQL reads of exempt tables/,
  );
  assert.match(testHarnessTests, /allows observed writes to exempt tables/);
  assert.match(testHarnessTests, /verifies update-from SQL as a target write plus source reads/);
  assert.match(testHarnessSource, /operationsForNestedStatements/);
  assert.match(testHarnessTests, /verifies update expression subqueries as mutation reads/);
  assert.match(testHarnessTests, /verifies select expression subqueries as query reads/);
  assert.match(
    testHarnessTests,
    /accepts raw SQL compound predicates when one observed row key matches/,
  );
  assert.match(testHarnessTests, /checks row keys parsed from raw SQL query predicates/);
  assert.match(testHarnessTests, /FW408 Declared row key differs from observed row predicate/);
  assert.match(testHarnessSource, /diagnosticMessage\('FW402'/);
  assert.match(testHarnessSource, /diagnosticMessage\('FW404'/);
  assert.match(testHarnessSource, /diagnosticMessage\('FW407'/);
  assert.match(testHarnessSource, /diagnosticMessage\('FW408'/);
  assert.match(testHarnessSource, /diagnosticMessage\(\s*'FW410'/);
  assert.match(testHarnessSource, /FW411_MESSAGE = 'Query read set includes an exempt table'/);
  assert.match(testHarnessSource, /FW411 \$\{FW411_MESSAGE\}/);
  assert.match(testHarnessTests, /validates query loader results against declared output schemas/);
  assert.match(
    testHarnessTests,
    /fails query output verification when observed result shape violates the schema/,
  );
  assert.match(testHarnessTests, /reports FW410 for nested query output shape mismatches/);
  assert.match(testHarnessSource, /diagnosticDefinitions\[code\]\.message/);
  assert.equal(
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
    }).output,
    [
      'fw-check/v1',
      'ERROR FW410 cart.queries.ts:5 Query result shape failed declared output schema.',
      'ERROR FW302 cart-badge.tsx:3:23 data-bind path is not present in the declared query shape. cart.missing',
      'WARN FW405 cart.domain.ts:2 Conditional write branch was never executed under instrumentation. domain=product branch=stock-reserve',
      'ERROR FW402 domain:audit Write touched an undeclared domain. domain=audit observed table audit_log',
      'WARN FW403 domain:order Declared domain was never observed written. domain=order',
      'ERROR FW404 domain:unknown_table Write to unmapped table. domain=unknown_table observed table unknown_table',
      'ERROR FW407 cart.queries.ts:7 Query read from undeclared domain. domain=product observed table products',
      'ERROR FW408 product.domain.ts:9 Declared row key differs from observed row predicate. domain=product expected id observed sku',
      'ERROR FW410 cart.queries.ts:11 Query result shape failed declared output schema. domain=cart cart Expected number',
      '',
    ].join('\n'),
  );
  assert.equal(
    fwCheck({
      diagnostics: [{ code: 'FW411', site: 'cart.queries.ts:9' }],
    }).output,
    [
      'fw-check/v1',
      'ERROR FW411 cart.queries.ts:9 Query read set includes an exempt table.',
      '',
    ].join('\n'),
  );
  assert.match(runtimeSource, /export interface MutationChangeRecord/);
  assert.match(runtimeSource, /export interface OptimisticChange/);
  assert.match(runtimeSource, /change\?: OptimisticChange<Input>/);
  assert.match(runtimeSource, /function resolveOptimisticKeys/);
  assert.match(runtimeSource, /readMutationChangeHeader\(response, options\.onError\)/);
  assert.doesNotMatch(runtimeSource, /function reportMalformedMutationChangeHeader/);
  assert.match(runtimeSource, /publishSuccessfulMutation\(options, response, body, changes\)/);
  assert.match(runtimeTests, /submits enhanced mutations with optimistic transforms/);
  assert.match(
    runtimeTests,
    /applies optimistic transforms from unified change records and derives query keys/,
  );
  assert.match(
    runtimeTests,
    /keys: \{ reviews: \(change\) => `product:\$\{change\.keys\?\.\[0\]\}` \}/,
  );
  assert.match(runtimeTests, /expect\(result\.changes\)\.toEqual/);
  assert.match(runtimeTests, /changes: \[\{ domain: 'cart' \}\]/);
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
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerBindingsSource = await readProjectFile(
    'packages/compiler/src/validate/bindings.ts',
  );
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');
  const drizzlePinTests = await readProjectFile('conformance/drizzle-pin/src/index.test.ts');

  assert.match(compilerSource, /queryShapeFacts\?: readonly QueryShapeFact\[\]/);
  assert.match(compilerBindingsSource, /queryShapesFromFacts/);
  assert.match(compilerBindingsSource, /function dataBindListStamps/);
  assert.match(compilerSource, /interface QueryTemplateStampFact/);
  assert.match(compilerSource, /templateStamps/);
  assert.match(compilerTests, /validates data-bind paths against generated query shape facts/);
  assert.match(
    compilerTests,
    /reports FW302 when generated query shape facts no longer contain a binding path/,
  );
  assert.match(compilerTests, /validates ejected list stamps against array element query shapes/);
  assert.match(compilerTests, /data-bind-list="cart\.items"/);
  assert.match(compilerTests, /templateStamps: \[/);
  assert.match(compilerTests, /generated\/queries\/cart\.shape\.ts/);
  assert.match(
    compilerTests,
    /data-bind path is not present in the declared query shape\. cart\.count/,
  );
  assert.match(drizzlePinTests, /pins nullable project query shapes for real Drizzle left joins/);
  assert.match(drizzlePinTests, /\.leftJoin\(reviews, eq\(reviews\.productId, products\.id\)\)/);
  assert.match(
    compilerTests,
    /accepts optional binding path segments through nullable query shape metadata/,
  );
  assert.match(
    compilerTests,
    /reports FW227 when binding paths traverse nullable query shape metadata without optional segments/,
  );
  assert.match(compilerTests, /product\.details\?\.name/);
  assert.match(compilerTests, /product\.details\.name \(segment: details\)/);
});

void test('S1 production build proves the compiler 1:1 emit contract', async () => {
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerViteSource = await readProjectFile('packages/compiler/src/vite.ts');
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');
  const viteConfig = await readProjectFile('vite.config.ts');
  const prodEmitCheck = await readProjectFile('scripts/prod-emit-check.mjs');

  assert.match(compilerSource, /createJisoVitePlugin/);
  assert.match(compilerViteSource, /configureServer/);
  assert.match(compilerViteSource, /devClientModuleKey/);
  assert.match(compilerViteSource, /URLSearchParams\(query\)\.get\('v'\)/);
  assert.match(compilerViteSource, /clientModules\.set/);
  assert.match(compilerTests, /serves emitted client modules from Vite dev middleware/);
  assert.match(viteConfig, /command: 'vp pack && node scripts\/prod-emit-check\.mjs'/);
  assert.match(viteConfig, /scripts\/prod-emit-check\.mjs/);
  assert.match(viteConfig, /packages\/compiler\/src\/\*\*/);
  assert.match(prodEmitCheck, /compileComponentModule/);
  assert.match(prodEmitCheck, /product-card\.server\.js/);
  assert.match(prodEmitCheck, /product-card\.client\.js/);
  assert.match(prodEmitCheck, /ProductCard\\\$button_click/);
  assert.match(prodEmitCheck, /prod-emit-check\/v1/);
});

void test('P3 Drizzle query facts include select shapes and instance keys', async () => {
  const drizzleSource = await readProjectFile('packages/drizzle/src/index.ts');
  const drizzleTests = await readProjectFile('packages/drizzle/src/index.test.ts');

  assert.match(drizzleSource, /export interface QueryFact/);
  assert.match(drizzleSource, /diagnostics\?: readonly TouchGraphDiagnostic/);
  assert.match(drizzleSource, /diagnosticsForQueryFacts/);
  assert.match(drizzleSource, /extractQueryFactsFromProject/);
  assert.match(drizzleSource, /extractQueryFactsFromSource/);
  assert.match(drizzleSource, /selectShapeFromQueryBody/);
  assert.match(drizzleSource, /opaqueProjectionDiagnostics/);
  assert.match(drizzleSource, /queryInstanceKey/);
  assert.match(
    drizzleTests,
    /extracts query result shapes, read domains, and instance keys from Drizzle selects/,
  );
  assert.match(drizzleTests, /instanceKey: \{\s*domain: 'cart',\s*key: 'arg:cartId'/);
  assert.match(drizzleTests, /reads: \['cart', 'product'\]/);
  assert.match(
    drizzleTests,
    /reports FW410 for opaque query projections without declared output schemas/,
  );
  assert.match(drizzleSource, /jiso\(annotation: JisoTableAnnotation\)/);
  assert.match(drizzleSource, /exemptQueryReadDiagnostics/);
  assert.match(drizzleTests, /reports FW411 when a query read set includes an exempt table/);
  assert.match(drizzleTests, /Query read set includes an exempt table\. Tables: audit_log\./);
  assert.match(drizzleTests, /omits write-side-only exempt table writes from the touch graph/);
  assert.match(
    drizzleTests,
    /omits instance keys when Drizzle query predicates do not target an annotated table key/,
  );
  assert.match(drizzleTests, /resolves imported table symbols in project query facts/);
});

void test('P1 fragment targets emit typed registry facts', async () => {
  const coreSource = await readProjectFile('packages/core/src/index.ts');
  const coreTests = await readProjectFile('packages/core/src/index.test.ts');
  const compilerGraphSource = await readProjectFile('packages/compiler/src/graph.ts');
  const compilerRegistrySource = await readProjectFile('packages/compiler/src/emit/registry.ts');
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');

  assert.match(coreSource, /interface FragmentTargets/);
  assert.match(coreSource, /function fragmentTarget/);
  assert.match(coreTests, /fragment target names and props from generated registry facts/);
  assert.match(compilerGraphSource, /fragmentTargetPropsType/);
  assert.match(compilerRegistrySource, /interface FragmentTargets \{/);
  assert.match(compilerTests, /'cart-row': \{ rowId: string \};/);
  assert.doesNotMatch(compilerTests, /'cart-row': unknown;/);
});

void test('P4 commerce touch graph is a committed generated artifact', async () => {
  const commerceSource = await readProjectFile('examples/commerce/src/app.ts');
  const touchGraphSource = await readProjectFile('examples/commerce/src/generated/touch-graph.ts');
  const cartItemsLine = lineNumberFor(commerceSource, "request.db.write('cart_items'");
  const ordersLine = lineNumberFor(commerceSource, "request.db.write('orders'");
  const productsLine = lineNumberFor(commerceSource, "request.db.write('products'");
  const attachmentsLine = lineNumberFor(commerceSource, "request.db.write('attachments'");
  const webhookOrdersLine = lineNumberFor(commerceSource, "tx.write('orders'");

  assert.match(commerceSource, /from '\.\/generated\/touch-graph\.js'/);
  assert.doesNotMatch(commerceSource, /extractTouchGraphFromSource/);
  // SPEC §11.1/§11.2: the committed static graph must stay source-derived
  // because runtime verification checks observed effects against these facts.
  assert.equal(
    touchGraphSource,
    `import type { CartQueryResult, CommerceDb, ProductGridResult } from '../app.js';

export const commerceTouchGraph = {
  'cart.addItem': {
    touches: [
      {
        domain: 'cart',
        keys: null,
        site: 'examples/commerce/src/app.ts:${cartItemsLine}',
        via: 'cart_items',
      },
      {
        domain: 'order',
        keys: null,
        site: 'examples/commerce/src/app.ts:${ordersLine}',
        via: 'orders',
      },
      {
        domain: 'product',
        keys: 'arg:productId',
        predicate: 'eq',
        site: 'examples/commerce/src/app.ts:${productsLine}',
        via: 'products',
      },
    ],
    reads: [],
    unresolved: [],
  },
  'order.receipt': {
    touches: [
      {
        domain: 'attachment',
        keys: 'arg:orderId',
        predicate: 'eq',
        site: 'examples/commerce/src/app.ts:${attachmentsLine}',
        via: 'attachments',
      },
    ],
    reads: [],
    unresolved: [],
  },
  'payment.webhook': {
    touches: [
      {
        domain: 'order',
        keys: 'arg:data.object.id',
        predicate: 'eq',
        site: 'examples/commerce/src/app.ts:${webhookOrdersLine}',
        via: 'orders',
      },
    ],
    reads: [],
    unresolved: [],
  },
} as const;

export const commerceInvalidationSets = {
  'cart/add': [
    { query: 'cart', domains: ['cart'], keys: null },
    { query: 'orderHistory', domains: ['order'], keys: null },
    { query: 'productGrid', domains: ['product'], keys: null },
  ],
} as const;

export interface CommerceInvalidationSets {
  'cart/add': 'cart' | 'orderHistory' | 'productGrid';
}

declare module '@jiso/core' {
  interface QueryRegistry {
    cart: CartQueryResult;
    productGrid: ProductGridResult;
    orderHistory: { items: CommerceDb['orders'] };
  }

  interface InvalidationSets extends CommerceInvalidationSets {}
}
`,
  );
});

void test('Conformance suites are an explicit gate', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const viteConfig = await readProjectFile('vite.config.ts');
  const ciWorkflow = await readProjectFile('.github/workflows/ci.yml');
  const conformanceTest = await readProjectFile('conformance/drizzle-pin/src/index.test.ts');
  const authSpikePackageJson = JSON.parse(
    await readProjectFile('conformance/auth-spike/package.json'),
  );
  const webhookSpikePackageJson = JSON.parse(
    await readProjectFile('conformance/webhook-spike/package.json'),
  );
  const appShellSpikePackageJson = JSON.parse(
    await readProjectFile('conformance/app-shell-spike/package.json'),
  );
  const drizzlePackageJson = JSON.parse(await readProjectFile('packages/drizzle/package.json'));
  const drizzleSource = await readProjectFile('packages/drizzle/src/index.ts');
  const drizzleTests = await readProjectFile('packages/drizzle/src/index.test.ts');

  assert.match(packageJson.scripts.acceptance, /pnpm run test:conformance/);
  assert.equal(packageJson.scripts['test:conformance'], 'vp run conformance');
  assert.equal(drizzlePackageJson.dependencies['ts-morph'], '^28.0.0');
  assert.match(drizzleSource, /function extractTouchGraphFromProject/);
  assert.match(drizzleSource, /function isDrizzleReceiver/);
  assert.match(viteConfig, /conformance:\s*\{/);
  assert.match(viteConfig, /'conformance-drizzle':\s*\{/);
  assert.match(viteConfig, /@jiso\/conformance-drizzle-pin/);
  assert.match(viteConfig, /@jiso\/conformance-auth-spike/);
  assert.match(viteConfig, /@jiso\/conformance-webhook-spike/);
  assert.match(viteConfig, /@jiso\/conformance-app-shell-spike/);
  assert.match(ciWorkflow, /vp run conformance/);
  assert.equal(authSpikePackageJson.name, '@jiso/conformance-auth-spike');
  assert.equal(webhookSpikePackageJson.name, '@jiso/conformance-webhook-spike');
  assert.equal(appShellSpikePackageJson.name, '@jiso/conformance-app-shell-spike');
  assert.match(conformanceTest, /Drizzle pinned subset conformance/);
  assert.match(conformanceTest, /from 'drizzle-orm'/);
  assert.match(conformanceTest, /from 'drizzle-orm\/pg-core'/);
  assert.match(conformanceTest, /imports the pinned real Drizzle Postgres subset/);
  assert.match(conformanceTest, /recognizes real Drizzle receiver types in project extraction/);
  assert.match(conformanceTest, /pins project query facts for the real Drizzle Postgres subset/);
  assert.match(conformanceTest, /diagnosticsForQueryFacts/);
  assert.match(conformanceTest, /pins direct table source extraction/);
  assert.match(conformanceTest, /pins local conditional table resolution/);
  assert.match(conformanceTest, /pins domain write callback extraction/);
  assert.match(drizzleTests, /folds local helper writes and reads into caller summaries/);
  assert.match(drizzleTests, /dedupes recursive helper summaries at a fixed point/);
  assert.match(drizzleTests, /extracts write callback bodies from domain authoring surfaces/);
  assert.match(
    drizzleTests,
    /extracts configured write callbacks and folds local helper summaries/,
  );
  assert.match(drizzleTests, /resolves namespace-imported Drizzle schema identifiers/);
  assert.match(drizzleTests, /resolves named import and re-export Drizzle schema aliases/);
  assert.match(
    drizzleTests,
    /uses typed receiver origins instead of likely receiver names in project extraction/,
  );
  assert.match(drizzleTests, /recognizes renamed Drizzle receiver parameters/);
  assert.match(drizzleTests, /recognizes destructured Drizzle receiver aliases/);
  assert.match(drizzleTests, /marks external helpers receiving a Drizzle receiver as FW406/);
  assert.equal(
    JSON.parse(await readProjectFile('conformance/drizzle-pin/package.json')).devDependencies[
      'drizzle-orm'
    ],
    '0.45.2',
  );
});

void test('D3 deferred stream responses are consumed by the runtime', async () => {
  const compilerBootstrapSource = await readProjectFile('packages/compiler/src/emit/bootstrap.ts');
  const compilerBindingValidationSource = await readProjectFile(
    'packages/compiler/src/validate/bindings.ts',
  );
  const compilerClientEmitSource = await readProjectFile('packages/compiler/src/emit/client.ts');
  const compilerSource = await readProjectFile('packages/compiler/src/index.ts');
  const compilerTests = await readProjectFile('packages/compiler/src/index.test.ts');
  const serverDeferredStreamSource = await readProjectFile(
    'packages/server/src/deferred-stream.ts',
  );
  const serverHintsSource = await readProjectFile('packages/server/src/hints.ts');
  const serverTests = await readProjectFile('packages/server/src/index.test.ts');
  const runtimeSource = await readProjectFile('packages/runtime/src/index.ts');
  const runtimeWireParserSource = await readProjectFile('packages/runtime/src/wire-parser.ts');
  const runtimeTests = await readProjectFile('packages/runtime/src/index.test.ts');

  assert.match(compilerBindingValidationSource, /collectQueryUpdatePlans/);
  assert.match(compilerClientEmitSource, /\$queryUpdatePlans/);
  assert.match(compilerSource, /emitQueryPlanBootstrapModule/);
  assert.match(compilerBootstrapSource, /installJisoLoader/);
  assert.match(compilerBootstrapSource, /enhancedMutations: \{/);
  assert.match(compilerBootstrapSource, /applyDeferredStreamResponseToDom/);
  assert.match(compilerBootstrapSource, /applyJisoDeferredStreamResponse/);
  assert.match(compilerClientEmitSource, /applyCompiledQueryUpdatePlan/);
  assert.match(compilerClientEmitSource, /emitDerivePlan/);
  assert.match(compilerClientEmitSource, /emitStampPlan/);
  assert.match(compilerClientEmitSource, /deriveExports/);
  assert.match(compilerTests, /emits per-query data-bind update plans for compiled components/);
  assert.match(compilerTests, /emits named derives into compiled query update plans/);
  assert.match(
    compilerTests,
    /lowers inline attribute expressions into compiled query update stamps/,
  );
  assert.match(compilerTests, /derives data-bind stamps for sole text-child query expressions/);
  assert.match(compilerTests, /wraps mixed text query expressions in synthesized data-bind spans/);
  assert.match(
    compilerTests,
    /emits an app bootstrap that wires compiled query plans into the loader/,
  );
  assert.match(compilerTests, /\.\.\.CartBadge\$queryUpdatePlans/);
  assert.match(compilerTests, /export function applyJisoDeferredStreamResponse/);
  assert.match(compilerTests, /return applyDeferredStreamResponseToDom/);
  assert.match(runtimeSource, /applyDeferredStreamResponseToDom/);
  assert.match(runtimeSource, /export function applyCompiledQueryUpdatePlan/);
  assert.match(runtimeSource, /bindings[\s\S]*derives[\s\S]*stamps/);
  assert.match(runtimeSource, /export function applyQueryBindings/);
  assert.match(runtimeSource, /deferredStreamChunks/);
  assert.match(runtimeWireParserSource, /export function deferredStreamChunks/);
  assert.match(runtimeWireParserSource, /--\$\{boundary\}/);
  assert.match(serverDeferredStreamSource, /mode\?: 'append' \| 'replace'/);
  assert.match(serverHintsSource, /bootstrapScript\?: string/);
  assert.match(
    serverHintsSource,
    /<script type="module" src="\$\{escapeAttribute\(options\.bootstrapScript\)\}"><\/script>/,
  );
  assert.match(
    serverTests,
    /renders deferred append fragment mode for streamed pagination fragments/,
  );
  assert.match(serverTests, /renders and preloads the generated app bootstrap script/);
  assert.match(
    runtimeTests,
    /applies query update bindings from mutation chunks without requiring a fragment/,
  );
  assert.match(
    runtimeTests,
    /runs compiled query update plans in bindings -> named derives -> stamps order/,
  );
  assert.match(runtimeSource, /queryPlans\?: CompiledQueryUpdatePlans/);
  assert.match(
    runtimeSource,
    /installMutationBroadcast[\s\S]*queryPlans\?: CompiledQueryUpdatePlans/,
  );
  assert.match(runtimeTests, /morph:1:1 items:1/);
  assert.match(runtimeTests, /morph:6:6 items/);
  assert.match(runtimeTests, /morph:2:2 items/);
  assert.match(runtimeTests, /applies full deferred stream responses in boundary order/);
  assert.match(runtimeTests, /1 review:1/);
  const deferredFixture = await readProjectFile('fixtures/wire/defer-stream.http');
  assert.match(deferredFixture, /priority="5"/);
  assert.match(deferredFixture, /<link rel="stylesheet" href="\/assets\/reviews\.css">/);
  assert.match(runtimeTests, /--jiso-boundary--/);
  assert.match(runtimeTests, /reviews-plan/);
  assert.match(runtimeTests, /morph:<section>Reviews ready<\/section>/);
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
  const cartBadgeClientSource = cartBadge.files.find(
    (file) =>
      file.source.includes("import { handler } from '@jiso/runtime'") &&
      file.source.includes('CartBadge$removeItem'),
  )?.source;
  assert.ok(cartBadgeClientSource, 'compiled output includes the cart badge client module');

  assert.deepEqual(cartBadge.handlerExports, [
    'CartBadge$removeItem',
    'CartBadge$button_click',
    'CartBadge$button_click_2',
  ]);
  assert.match(cartBadgeClientSource, /export const CartBadge\$removeItem = handler/);
  assert.match(cartBadgeClientSource, /export const CartBadge\$button_click = handler/);
  assert.match(cartBadgeClientSource, /export const CartBadge\$button_click_2 = handler/);
  assert.match(cartBadgeClientSource, /return ctx\.state\.count \+= ctx\.params\.quantity;/);
  assert.match(
    cartBadgeClientSource,
    /return ctx\.state\.count = ctx\.state\.count - ctx\.params\.quantity;/,
  );
  assert.deepEqual(collectMinifierReservedNames([cartDrawer, cartBadge, cartBadge]), [
    'CartBadge$button_click',
    'CartBadge$button_click_2',
    'CartBadge$removeItem',
    'CartDrawer$removeItem',
  ]);
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
  const serverSource = result.files.find((file) => file.source.includes('renderSource'))?.source;
  assert.ok(serverSource, 'compiled output includes server render source');
  assert.match(serverSource, /fw-param-types="quantity:number"/);
  assert.match(serverSource, /fw-param-types="selected:boolean"/);
  assert.deepEqual(
    readElementParams({
      attributes: [
        { name: 'data-p-product-id', value: 'p1' },
        { name: 'data-p-quantity', value: '2' },
        { name: 'data-p-featured', value: 'false' },
      ],
      getAttribute: (name) =>
        name === 'fw-param-types' ? 'quantity:number featured:boolean' : null,
    }),
    {
      featured: false,
      productId: 'p1',
      quantity: 2,
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
  assert.equal(result.renderEquivalenceChecks.length, 1);
  assert.equal(result.renderEquivalenceChecks[0]?.artifact, 'components/cart/cart-total.server.js');
  assert.equal(result.renderEquivalenceChecks[0]?.ok, true);
  assert.match(result.renderEquivalenceChecks[0]?.actual ?? '', /component\('cart-total'/);
  assert.equal(
    result.renderEquivalenceChecks[0]?.actual,
    result.renderEquivalenceChecks[0]?.expected,
  );
  assert.doesNotThrow(() => assertRenderEquivalence(result));
  assert.throws(
    () =>
      assertRenderEquivalence({
        ...result,
        renderEquivalenceChecks: [
          {
            actual: '<cart-total>0</cart-total>',
            artifact: 'components/cart/cart-total.server.js',
            expected: '<cart-total>1</cart-total>',
            ok: false,
          },
        ],
      }),
    /Render equivalence failed for components\/cart\/cart-total\.server\.js/,
  );
  assert.equal(
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
    }).output,
    [
      'fw-check/v1',
      'ERROR RENDER_EQUIV components/a.server.js Authored and lowered render output must match byte-for-byte.',
      'ERROR RENDER_EQUIV components/z.server.js render(src) differed from render(compile(src)). expected="sha256:authored" actual="sha256:lowered"',
      '',
    ].join('\n'),
  );
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
  assert.match(perfScript, /ttiMinusFcpMs/);
  assert.match(perfScript, /TTI is equivalent to FCP/);
  assert.match(perfScript, /activationStart/);
  assert.match(perfScript, /Runtime\.getHeapUsage/);
  assert.match(perfScript, /navigationCount,\s*100/);
});
