import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

import { missingBuildMessage } from '../scripts/fw-check.mjs';
import { parseWireResponses } from './wire-transcript.mjs';
import { fwCheck, fwExplain } from '../dist/cli/src/index.mjs';
import {
  assertRenderEquivalence,
  collectMinifierReservedNames,
  compileComponentModule,
  queryShapesFromFacts,
} from '../dist/compiler/src/index.mjs';
import { diagnosticDefinitions } from '../dist/core/src/index.mjs';
import {
  applyMutationResponseToDom,
  applyCompiledQueryUpdatePlan,
  createQueryStore,
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
  assert.ok(jisoLoaderSource.startsWith('(function installInlineJisoLoader(importModule)'));
  assert.ok(jisoLoaderSource.endsWith(')((url)=>import(url));'));
  assert.ok(
    gzipSync(jisoLoaderSource).byteLength <= 4096,
    `inline loader gzip size ${gzipSync(jisoLoaderSource).byteLength} exceeds 4096 bytes`,
  );
  assert.match(jisoLoaderSource, /signal:\s*new AbortController\(\)\.signal/);
  assert.match(jisoLoaderSource, /IntersectionObserver/);
  assert.match(jisoLoaderSource, /FW-Targets/);
  assert.match(jisoLoaderSource, /keepalive:\s*true/);
  assert.match(jisoLoaderSource, /DOMParser/);
  assert.match(jisoLoaderSource, /fw-fragment/);
  assert.match(jisoLoaderSource, /on\\\\:load/);
  assert.match(jisoLoaderSource, /on\\\\:idle/);
  assert.doesNotMatch(
    jisoLoaderSource,
    /\bcustomElements\.define\b|attachShadow|\bunload\b/,
    'loader has no upgrade/unload path',
  );
  assert.doesNotMatch(
    jisoLoaderSource,
    /installInlineJisoLoader\.toString\(\)|Function\.prototype\.toString|minifyInlineLoaderSource/,
    'inline loader source is a shipped artifact, not function-source regex minification',
  );
});

void test('P2 loader smoke evidence is asserted through runtime behavior', async () => {
  const listeners = new Map();
  const rootElements = new Map();
  const root = {
    addEventListener(type, listener, options) {
      listeners.set(type, { listener, options });
    },
    removeEventListener(type, listener) {
      if (listeners.get(type)?.listener === listener) listeners.delete(type);
    },
    querySelectorAll(selector) {
      return rootElements.get(selector) ?? [];
    },
    visibilityState: 'visible',
  };
  const eventElement = (attributes) => ({
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    closest(selector) {
      const trigger = selector.match(/^\[on\\:(.+)\]$/)?.[1];
      if (trigger && attributes[`on:${trigger}`] !== undefined) return this;
      if (selector === '[fw-state]' && attributes['fw-state'] !== undefined) return this;
      return null;
    },
  });
  const calls = [];
  const waitForCalls = async (count) => {
    for (let attempts = 0; attempts < 10 && calls.length < count; attempts += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    assert.equal(calls.length, count);
  };
  const handlers = {
    idle(_event, context) {
      calls.push(['idle', context.signal instanceof AbortSignal]);
    },
    load(_event, context) {
      calls.push(['load', context.signal instanceof AbortSignal]);
    },
    visible(_event, context) {
      calls.push(['visible', context.signal instanceof AbortSignal]);
    },
  };
  const loadElement = eventElement({ 'on:load': '/loader.js#load' });
  const idleElement = eventElement({ 'on:idle': '/loader.js#idle' });
  const visibleElement = eventElement({ 'on:visible': '/loader.js#visible' });
  const idleCallbacks = [];
  let visibleCallback;
  const observer = {
    observed: [],
    unobserved: [],
    observe(element) {
      this.observed.push(element);
    },
    unobserve(element) {
      this.unobserved.push(element);
    },
  };
  rootElements.set('[on\\:load]', [loadElement]);
  rootElements.set('[on\\:idle]', [idleElement]);
  rootElements.set('[on\\:visible]', [visibleElement]);
  let importCount = 0;

  const loader = installJisoLoader({
    importModule: async () => {
      importCount += 1;
      return handlers;
    },
    requestIdle(callback) {
      idleCallbacks.push(callback);
    },
    root,
    visibleObserver(callback) {
      visibleCallback = callback;
      return observer;
    },
  });

  assert.deepEqual(loader.events, ['click', 'submit', 'input', 'change']);
  assert.deepEqual([...listeners.keys()], ['click', 'submit', 'input', 'change']);
  assert.equal(listeners.get('click')?.options.capture, true);
  assert.equal(importCount, 0);
  await waitForCalls(1);
  assert.deepEqual(calls, [['load', true]]);

  idleCallbacks[0]();
  await waitForCalls(2);
  assert.deepEqual(calls, [
    ['load', true],
    ['idle', true],
  ]);

  assert.deepEqual(observer.observed, [visibleElement]);
  visibleCallback([{ isIntersecting: true, target: visibleElement }]);
  await waitForCalls(3);
  visibleCallback([{ isIntersecting: true, target: visibleElement }]);
  assert.deepEqual(calls, [
    ['load', true],
    ['idle', true],
    ['visible', true],
  ]);
  assert.deepEqual(observer.unobserved, [visibleElement]);

  const store = createQueryStore();
  const refetched = await refetchQueries({
    fetch: async (url, options) => {
      assert.equal(url, '/_q/cart');
      assert.deepEqual(options, {
        headers: {
          Accept: 'text/html',
          'FW-Fragment': 'true',
        },
        method: 'GET',
      });
      return {
        ok: true,
        status: 200,
        async text() {
          return '<fw-query name="cart">{"count":2}</fw-query>';
        },
      };
    },
    queries: ['cart'],
    queryStore: store,
  });
  assert.deepEqual(refetched, [{ fragments: [], queries: ['cart'] }]);
  assert.deepEqual(store.get('cart'), { count: 2 });

  let reconciledItems;
  const templateHost = {
    getAttribute() {
      return null;
    },
    reconcileTemplateStamp(items) {
      reconciledItems = items;
    },
  };
  const applied = applyCompiledQueryUpdatePlan(
    {
      querySelectorAll(selector) {
        return selector === '[data-list]' ? [templateHost] : [];
      },
    },
    'cart',
    { items: [{ id: 'p1', qty: 2 }] },
    {
      templateStamps: [
        {
          key: 'id',
          list: 'items',
          render: (item) => `<li>${item.id}:${item.qty}</li>`,
          selector: '[data-list]',
        },
      ],
    },
  );
  assert.deepEqual(applied.templateStamps, ['[data-list]']);
  assert.deepEqual(reconciledItems, [
    {
      html: '<li>p1:2</li>',
      index: 0,
      key: 'p1',
      value: { id: 'p1', qty: 2 },
    },
  ]);

  loader.dispose();
  assert.deepEqual([...listeners.keys()], []);
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
    [
      {
        code: 'FW225',
        fileName: 'components/cart/cart-shell.tsx',
        length: 5,
        message: `${diagnosticDefinitions.FW225.message} <div> cannot appear inside <p>`,
        severity: 'error',
        start: { column: 9, line: 9 },
      },
      {
        code: 'FW225',
        fileName: 'components/cart/cart-shell.tsx',
        length: 4,
        message: `${diagnosticDefinitions.FW225.message} <tr> must be inside a table section or table`,
        severity: 'error',
        start: { column: 7, line: 11 },
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
    [
      {
        code: 'FW211',
        fileName: 'components/execution-triggers.tsx',
        length: 7,
        message: `${diagnosticDefinitions.FW211.message} on:load`,
        severity: 'lint',
        start: { column: 21, line: 7 },
      },
      {
        code: 'FW212',
        fileName: 'components/execution-triggers.tsx',
        length: 8,
        message: `${diagnosticDefinitions.FW212.message} on:media`,
        severity: 'lint',
        start: { column: 21, line: 8 },
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
    [
      {
        code: 'FW226',
        fileName: 'components/recommendations.tsx',
        length: 24,
        message: `${diagnosticDefinitions.FW226.message} fw-c="unknown-component"`,
        severity: 'error',
        start: { column: 14, line: 9 },
      },
      {
        code: 'FW226',
        fileName: 'components/recommendations.tsx',
        length: 30,
        message: `${diagnosticDefinitions.FW226.message} fw-deps="missingQuery:p1"`,
        severity: 'error',
        start: { column: 39, line: 9 },
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

  assert.deepEqual(result.updateCoverage, [
    {
      componentName: 'CartBadge',
      detail: 'data-bind',
      position: 'binding',
      query: 'cart.count',
      status: 'plan',
    },
    {
      componentName: 'CartBadge',
      detail: 'data-bind:hidden',
      position: 'attribute',
      query: 'cart.empty',
      status: 'plan',
    },
    {
      componentName: 'CartBadge',
      detail: 'declared renderOnce',
      position: 'expression',
      query: 'cart.currency',
      status: 'renderOnce',
    },
    {
      componentName: 'CartBadge',
      detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
      position: 'expression',
      query: 'cart.discount',
      status: 'UNHANDLED',
    },
    {
      componentName: 'CartBadge',
      detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
      position: 'expression',
      query: 'product.name',
      status: 'UNHANDLED',
    },
  ]);
  assert.deepEqual(
    result.diagnostics.filter((diagnostic) => diagnostic.code === 'FW311'),
    [
      {
        code: 'FW311',
        fileName: 'components/cart/cart-badge.tsx',
        length: 13,
        message: `${diagnosticDefinitions.FW311.message} CartBadge cart.discount expression`,
        severity: 'warn',
        start: { column: 26, line: 11 },
      },
      {
        code: 'FW311',
        fileName: 'components/cart/cart-badge.tsx',
        length: 12,
        message: `${diagnosticDefinitions.FW311.message} CartBadge product.name expression`,
        severity: 'warn',
        start: { column: 22, line: 12 },
      },
    ],
  );
  assert.equal(
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
    }).output,
    [
      'fw-check/v1',
      'COVERAGE component=CartBadge query=cart.count position="text" status=plan detail="text binding"',
      'WARN FW311 component=CartBadge query=cart.discount position="conditional <dot>" Query-dependent DOM position has no update status.',
      '',
    ].join('\n'),
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
    [
      {
        code: 'FW223',
        fileName: 'components/cart/cart-badge.tsx',
        length: 22,
        message: `${diagnosticDefinitions.FW223.message} data-bind="cart.count" wraps {cart.count}`,
        severity: 'lint',
        start: { column: 31, line: 6 },
      },
    ],
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.total}</span>,
});
`,
    }).diagnostics.filter((diagnostic) => diagnostic.code === 'FW222'),
    [
      {
        code: 'FW222',
        fileName: 'components/cart/cart-badge.tsx',
        length: 22,
        message: `${diagnosticDefinitions.FW222.message} data-bind="cart.count" wraps {cart.total}`,
        severity: 'error',
        start: { column: 31, line: 6 },
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
    }).diagnostics.filter((diagnostic) => ['FW231', 'FW232', 'FW233'].includes(diagnostic.code)),
    [
      {
        code: 'FW231',
        fileName: 'components/primitive-merge.tsx',
        length: 19,
        message: `${diagnosticDefinitions.FW231.message} commandfor`,
        severity: 'error',
        start: { column: 15, line: 9 },
      },
      {
        code: 'FW231',
        fileName: 'components/primitive-merge.tsx',
        length: 15,
        message: `${diagnosticDefinitions.FW231.message} data-p-id`,
        severity: 'error',
        start: { column: 56, line: 9 },
      },
      {
        code: 'FW231',
        fileName: 'components/primitive-merge.tsx',
        length: 22,
        message: `${diagnosticDefinitions.FW231.message} fw-c`,
        severity: 'error',
        start: { column: 88, line: 9 },
      },
      {
        code: 'FW232',
        fileName: 'components/primitive-merge.tsx',
        length: 21,
        message: `${diagnosticDefinitions.FW232.message} aria-expanded`,
        severity: 'lint',
        start: { column: 15, line: 10 },
      },
      {
        code: 'FW232',
        fileName: 'components/primitive-merge.tsx',
        length: 13,
        message: `${diagnosticDefinitions.FW232.message} role`,
        severity: 'lint',
        start: { column: 58, line: 10 },
      },
      {
        code: 'FW232',
        fileName: 'components/primitive-merge.tsx',
        length: 19,
        message: `${diagnosticDefinitions.FW232.message} data-state`,
        severity: 'lint',
        start: { column: 84, line: 10 },
      },
      {
        code: 'FW233',
        fileName: 'components/primitive-merge.tsx',
        length: 22,
        message: `${diagnosticDefinitions.FW233.message} data-bind`,
        severity: 'error',
        start: { column: 13, line: 11 },
      },
      {
        code: 'FW233',
        fileName: 'components/primitive-merge.tsx',
        length: 29,
        message: `${diagnosticDefinitions.FW233.message} data-bind:hidden`,
        severity: 'error',
        start: { column: 59, line: 11 },
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
    [
      {
        code: 'FW230',
        fileName: 'components/cart/cart-row.tsx',
        help: [
          'Would hoist children to: CartRow$slot_children',
          'Blocked children: <span>{window.location.href}</span>',
          'Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.',
        ].join('\n'),
        length: 35,
        message: `${diagnosticDefinitions.FW230.message} CartRow`,
        severity: 'error',
        start: { column: 9, line: 14 },
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
  const serverSource = lowered.files.find((file) => file.kind === 'server')?.source ?? '';
  const registrySource = lowered.files.find((file) => file.kind === 'registry')?.source ?? '';
  assert.deepEqual(lowered.diagnostics, []);
  assert.match(serverSource, /<a href="\/products\/p%201\?max=500">Product<\/a>/);
  assert.match(serverSource, /<a href="\/cart">Cart<\/a>/);
  assert.doesNotMatch(serverSource, /<Link|href\('/);
  assert.match(registrySource, /'\/cart': import\('@jiso\/core'\)\.Route<'\/cart'>;/);
  assert.match(
    registrySource,
    /'\/products\/:id': import\('@jiso\/core'\)\.Route<'\/products\/:id'>;/,
  );

  assert.deepEqual(
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
    [
      {
        code: 'FW220',
        fileName: 'components/product-links.tsx',
        length: 18,
        message: `${diagnosticDefinitions.FW220.message} /product/p1`,
        severity: 'error',
        start: { column: 10, line: 7 },
      },
      {
        code: 'FW220',
        fileName: 'components/product-links.tsx',
        length: 18,
        message: `${diagnosticDefinitions.FW220.message} /checkout`,
        severity: 'error',
        start: { column: 26, line: 8 },
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
  const commerceGraph = JSON.parse(
    await readProjectFile('examples/commerce/src/generated/graph.json'),
  );
  assert.deepEqual(
    commerceGraph.components.map((component) => [
      component.name,
      component.fragments,
      component.queries,
    ]),
    [
      ['CartBadge', ['cart-badge'], ['cart']],
      ['ProductGrid', ['product-grid'], ['productGrid']],
      ['OrderHistory', ['order-history'], ['orderHistory']],
    ],
  );
  assert.deepEqual(commerceGraph.optimistic, [
    { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
    { mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' },
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

  assert.deepEqual(result.queries, ['reviews']);
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
  assert.match(
    deferred.body,
    /<fw-fragment target="recommendations"><link rel="stylesheet" href="\/assets\/recommendations\.css"><section class="border-slate-200">Ready<\/section><\/fw-fragment>/,
  );

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
  const commerceGraph = JSON.parse(
    await readProjectFile('examples/commerce/src/generated/graph.json'),
  );
  const cartPage = commerceGraph.pages.find((page) => page.route === '/cart');
  const receiptMutation = commerceGraph.mutations.find((item) => item.key === 'order/receipt');

  assert.deepEqual(cartPage, {
    i18n: ['en-US:cartLabel,productStock'],
    meta: {
      description: 'Browse products and checkout with 1 verifiable cart item.',
      title: 'Jiso Commerce (1)',
    },
    modulepreloads: [],
    prefetch: false,
    queries: ['cart', 'productGrid', 'orderHistory'],
    route: '/cart',
    stylesheets: ['/assets/tailwind.css'],
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
  assert.deepEqual(enhancedResult.queries, ['cart']);
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
  assert.match(malformedHeaderErrors[0].message, /Malformed JSON in FW-Changes header/);

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
  assert.deepEqual(optimisticResult.queries, ['reviews']);
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
    {
      query: 'cart',
      shape: {
        count: 'number',
        empty: 'boolean',
        items: [{ name: 'string', productId: 'string', qty: 'number' }],
      },
      source: 'generated/queries/cart.shape.ts',
    },
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
  assert.deepEqual(validCartBindings.queryUpdatePlans, [
    {
      componentName: 'CartBadge',
      paths: ['cart.count', 'cart.empty', 'cart.items'],
      query: 'cart',
      templateStamps: [
        {
          itemBindings: ['.name', '.qty'],
          key: 'productId',
          list: 'cart.items',
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
      {
        query: 'cart',
        shape: { itemCount: 'number' },
        source: 'generated/queries/cart.shape.ts',
      },
    ],
    source: `
export const CartBadge = component('cart-badge', {
  render: () => <span data-bind="cart.count">2</span>,
});
`,
  });
  assert.deepEqual(
    staleGeneratedShape.diagnostics.map(({ code, message }) => ({ code, message })),
    [
      {
        code: 'FW302',
        message: 'data-bind path is not present in the declared query shape. cart.count',
      },
    ],
  );

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
  assert.deepEqual(
    invalidListStamp.diagnostics.map(({ code, message }) => ({ code, message })),
    [
      {
        code: 'FW302',
        message: 'data-bind path is not present in the declared query shape. cart.items',
      },
    ],
  );

  const nullableFacts = [
    {
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
      source: 'generated/queries/product.shape.ts',
    },
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
  assert.deepEqual(
    unsafeNullablePath.diagnostics.map(({ code, help, message }) => ({ code, help, message })),
    [
      {
        code: 'FW227',
        help: diagnosticDefinitions.FW227.help,
        message:
          'Binding path traverses a nullable segment without ?. product.review.rating (segment: review)',
      },
    ],
  );
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
  let drizzle;
  try {
    drizzle = await import('../dist/drizzle/src/index.mjs');
  } catch (error) {
    assert.match(
      String(error?.stack ?? error),
      /__filename is not defined in ES module scope/,
      'unexpected Drizzle bundle import failure',
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

  const {
    diagnosticsForQueryFacts,
    extractQueryFactsFromProject,
    extractQueryFactsFromSource,
    extractTouchGraphFromSource,
  } = drizzle;

  const sourceFacts = extractQueryFactsFromSource([
    {
      fileName: 'cart.queries.ts',
      source: `
        export const cartItems = pgTable("cart_items", {
          cartId: text("cart_id").notNull(),
          productId: text("product_id"),
          qty: integer("qty").notNull(),
        }, jiso({ domain: "cart", key: "cartId" }));
        export const products = pgTable("products", {
          id: text("id").primaryKey(),
          name: text("name").notNull(),
        }, jiso({ domain: "product", key: "id" }));

        export const cartQuery = query("cart", {
          output: s.object({ count: s.number() }),
          async load(input, db) {
            return db.select({
              count: sql<number>\`count(*)\`,
              productId: products.id,
              item: {
                qty: cartItems.qty,
              },
            }).from(cartItems).innerJoin(products, eq(products.id, cartItems.productId)).where(eq(cartItems.cartId, input.cartId));
          },
        });
      `,
    },
  ]);

  assert.deepEqual(sourceFacts, [
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
  ]);

  const opaqueProjectionFacts = extractQueryFactsFromSource([
    {
      fileName: 'cart.queries.ts',
      source: `
        export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));

        export const cartQuery = query("cart", {
          async load(input, db) {
            return db.select({
              count: sql<number>\`count(*)\`,
            }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
          },
        });
      `,
    },
  ]);

  assert.deepEqual(opaqueProjectionFacts, [
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
  assert.deepEqual(diagnosticsForQueryFacts(opaqueProjectionFacts), [
    {
      code: 'FW410',
      message:
        'Opaque query projection requires a declared output schema. cart.count uses sql/raw projection without output.',
      severity: 'error',
      site: 'cart.queries.ts:4',
    },
  ]);

  const nonKeyPredicateFacts = extractQueryFactsFromSource([
    {
      fileName: 'product.queries.ts',
      source: `
        export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

        export const productQuery = query("product", {
          load(input, db) {
            return db.select({ sku: products.sku }).from(products).where(eq(products.sku, input.sku));
          },
        });
      `,
    },
  ]);

  assert.deepEqual(nonKeyPredicateFacts, [
    {
      query: 'product',
      reads: ['product'],
      shape: {
        sku: 'string',
      },
      site: 'product.queries.ts:4',
    },
  ]);

  const exemptReadFacts = extractQueryFactsFromSource([
    {
      fileName: 'product.queries.ts',
      source: `
        export const auditLog = pgTable("audit_log", {}, jiso({ exempt: true }));
        export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

        export const productQuery = query("product", {
          async load(_input, db) {
            return db.select({
              message: auditLog.message,
              name: products.name,
            }).from(products).leftJoin(auditLog, eq(auditLog.productId, products.id));
          },
        });
      `,
    },
  ]);

  assert.deepEqual(exemptReadFacts, [
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
  assert.deepEqual(diagnosticsForQueryFacts(exemptReadFacts), [
    {
      code: 'FW411',
      message: 'Query read set includes an exempt table. Tables: audit_log.',
      severity: 'error',
      site: 'product.queries.ts:5',
    },
  ]);

  assert.deepEqual(
    extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const auditLog = pgTable("audit_log", {}, jiso({ exempt: true }));
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));

          export async function writeAudit(db) {
            await db.insert(auditLog).values({ event: "cart" });
          }

          export async function addItem(db, cartId) {
            await db.insert(cartItems).values({ cartId });
          }
        `,
      },
    ]),
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

  const projectFacts = extractQueryFactsFromProject({
    files: [
      {
        fileName: 'cart.schema.ts',
        source: `
          export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));
        `,
      },
      {
        fileName: 'order.schema.ts',
        source: `
          export const items = pgTable("order_items", {}, jiso({ domain: "order", key: "id" }));
        `,
      },
      {
        fileName: 'cart.queries.ts',
        source: `
          import { items } from "./cart.schema";

          export const cartQuery = query("cart", {
            load(input, db) {
              return db.select({ id: items.id }).from(items).where(eq(items.id, input.id));
            },
          });
        `,
      },
    ],
  });

  assert.deepEqual(projectFacts, [
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
  ]);
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
  const registrySource = result.files.find((file) => file.kind === 'registry')?.source ?? '';

  assert.deepEqual(result.componentGraphFacts, [
    {
      fragments: ['cart-row'],
      name: 'CartRow',
    },
  ]);
  assert.match(
    registrySource,
    /interface FragmentTargets \{\n  'cart-row': \{ rowId: string \};\n\}/,
  );
  assert.doesNotMatch(registrySource, /'cart-row': unknown;/);
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
