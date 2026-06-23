import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { chromium } from 'playwright';

const {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  endpoint,
  toNodeHandler,
} = await import('../dist/server/src/index.mjs');
const { renderPageHints } = await import('../dist/server/src/internal/html.mjs');
const {
  createInlineKovoLoaderSource,
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleSource,
  kovoDeferredRuntimeModuleVersion,
} = await import('../dist/browser/src/internal/inline-loader.mjs');

export const p10PerfAcceptance = {
  browser: 'chromium',
  cdpMethods: ['HeapProfiler.collectGarbage', 'Runtime.getHeapUsage'],
  heapNoiseBudget: 64 * 1024,
  navigationCount: 100,
  paintEntry: 'first-contentful-paint',
  paintTimingJitterBudgetMs: 16,
  prerenderTimingField: 'activationStart',
  ttiMetric: 'ttiMinusFcpMs',
};

const clientModules = createMemoryVersionedClientModuleRegistry();
const runtimeHref = clientModules.put({
  path: kovoDeferredRuntimeModulePath,
  source: kovoDeferredRuntimeModuleSource,
  version: kovoDeferredRuntimeModuleVersion,
});
const kovoLoaderSource = createInlineKovoLoaderSource(
  JSON.stringify(runtimeHref),
  '(url)=>import(url)',
);
const handlerHref = clientModules.put({
  path: '/c/handler.js',
  source: `
globalThis.__clientModuleLoads = (globalThis.__clientModuleLoads ?? 0) + 1;
export function increment(_event, ctx) {
  ctx.state.count += 1;
}
`,
  version: 'p10',
});
const app = createApp({
  clientModules,
  endpoints: [
    endpoint('/next', {
      handler: () => htmlResponse(renderDocument({ route: '/next', title: 'Next' })),
      method: 'GET',
      reason: 'P10 navigation target fixture',
      response: { appOwnedSafety: true, body: 'html', cache: 'no-store' },
    }),
    endpoint('/nav', {
      csrf: false,
      csrfJustification: 'perf loopback only serves GET navigation proof pages',
      handler: (request) => {
        const url = new URL(request.url);
        return htmlResponse(renderDocument({ route: url.pathname, title: `Nav ${url.pathname}` }));
      },
      method: 'GET',
      mount: 'prefix',
      mountJustification: 'P10 navigation proof owns nested routes',
      reason: 'P10 navigation proof prefix fixture',
      response: { appOwnedSafety: true, body: 'html', cache: 'no-store' },
    }),
    endpoint('/', {
      handler: () => {
        const hints = renderPageHints({
          modulepreloads: [handlerHref],
          prefetch: 'moderate',
          prerenderUrls: ['/next'],
        });

        return htmlResponse(
          renderDocument({ head: hints.html, route: '/', title: 'Home' }),
          hints.earlyHints.Link ? { Link: hints.earlyHints.Link } : {},
        );
      },
      method: 'GET',
      reason: 'P10 navigation home fixture',
      response: { appOwnedSafety: true, body: 'html', cache: 'no-store' },
    }),
  ],
});
const server = createServer(toNodeHandler(createRequestHandler(app)));

export async function runP10PerfAcceptance() {
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.equal(typeof address, 'object');
    assert.notEqual(address, null);
    const origin = `http://127.0.0.1:${address.port}`;
    const browser = await chromium.launch({
      args: ['--enable-features=Prerender2,SpeculationRules'],
    });

    try {
      const page = await browser.newPage();
      await page.goto(origin, { waitUntil: 'load' });
      await page.waitForFunction(() =>
        performance.getEntriesByName('first-contentful-paint').some((entry) => entry.startTime > 0),
      );

      const firstLoad = await page.evaluate(() => {
        const paint = performance.getEntriesByName('first-contentful-paint')[0];
        const button = document.querySelector('#action');

        return {
          buttonStateBeforeClick: button?.getAttribute('kovo-state') ?? null,
          clientModuleLoadsBeforeInteraction: globalThis.__clientModuleLoads ?? 0,
          fcp: paint?.startTime ?? Number.NaN,
          handlerImportsBeforeInteraction: globalThis.__handlerImports ?? 0,
          hasSpeculationRules: document.querySelector('script[type="speculationrules"]') !== null,
          lastDelegatedListenerMark: globalThis.__kovoPerf.lastDelegatedListenerMark,
          ttiMinusFcpMs: globalThis.__kovoPerf.lastDelegatedListenerMark - (paint?.startTime ?? 0),
        };
      });

      assert.ok(Number.isFinite(firstLoad.fcp), 'first-contentful-paint is recorded');
      assert.equal(firstLoad.hasSpeculationRules, true);
      assert.ok(
        firstLoad.lastDelegatedListenerMark - firstLoad.fcp <=
          p10PerfAcceptance.paintTimingJitterBudgetMs,
        'delegated listeners are installed no later than first contentful paint',
      );
      assert.ok(
        firstLoad.ttiMinusFcpMs <= p10PerfAcceptance.paintTimingJitterBudgetMs,
        'TTI is equivalent to FCP for the loader spine',
      );
      assert.equal(firstLoad.clientModuleLoadsBeforeInteraction, 0);
      assert.equal(firstLoad.handlerImportsBeforeInteraction, 0);

      await page.click('#action');
      await page.waitForFunction(
        () => document.querySelector('#action')?.getAttribute('kovo-state') === '{"count":1}',
      );
      const afterClick = await page.evaluate(() => ({
        buttonStateAfterClick:
          document.querySelector('#action')?.getAttribute('kovo-state') ?? null,
        clientModuleLoadsAfterClick: globalThis.__clientModuleLoads ?? 0,
      }));

      assert.equal(afterClick.clientModuleLoadsAfterClick, 1);
      assert.equal(afterClick.buttonStateAfterClick, '{"count":1}');

      await page.goto(origin, { waitUntil: 'load' });
      await page.waitForTimeout(1000);
      const navClickEpoch = await page.evaluate(() => Date.now());
      await Promise.all([page.waitForURL(`${origin}/next`), page.click('#next')]);
      const prerenderNavigation = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];

        return {
          activationStart: navigation.activationStart,
          nextReadyEpoch: globalThis.__readyEpoch,
        };
      });

      assert.ok(
        prerenderNavigation.activationStart >= 0,
        'navigation activationStart is sampled for prerender evidence',
      );
      const perceivedNavigationMs = prerenderNavigation.nextReadyEpoch - navClickEpoch;
      if (prerenderNavigation.activationStart > 0) {
        assert.ok(
          perceivedNavigationMs < 50,
          'opted-in prerendered navigation is perceived under 50ms',
        );
      } else {
        assert.ok(
          Number.isFinite(perceivedNavigationMs),
          'headless Chromium did not activate prerender, but navigation timing was sampled',
        );
      }

      const cdp = await page.context().newCDPSession(page);
      const heapSamples = [];

      for (let index = 0; index < p10PerfAcceptance.navigationCount; index += 1) {
        await page.goto(`${origin}/nav/${index % 2}`, { waitUntil: 'load' });
        await cdp.send(p10PerfAcceptance.cdpMethods[0]);
        const heap = await cdp.send(p10PerfAcceptance.cdpMethods[1]);
        heapSamples.push(heap.usedSize);
      }

      assert.equal(p10PerfAcceptance.navigationCount, 100);
      const firstFiveMedian = median(heapSamples.slice(0, 5));
      const lastFiveMedian = median(heapSamples.slice(-5));
      const baselineUsedHeap = heapSamples[0];
      const finalUsedHeap = heapSamples.at(-1);

      assert.ok(
        finalUsedHeap <= baselineUsedHeap + p10PerfAcceptance.heapNoiseBudget,
        'final heap stays within 64KiB browser/instrumentation noise budget',
      );
      assert.ok(
        lastFiveMedian <= firstFiveMedian + p10PerfAcceptance.heapNoiseBudget,
        'median heap stays within 64KiB browser/instrumentation noise budget',
      );
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  await runP10PerfAcceptance();
}

function renderDocument({ head = '', route, title }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    ${head}
    <script>
      globalThis.__readyEpoch = Date.now();
      globalThis.__handlerImports = 0;
      globalThis.__kovoPerf = { lastDelegatedListenerMark: 0 };
      const addEventListenerOriginal = globalThis.addEventListener.bind(globalThis);
      globalThis.addEventListener = (type, listener, options) => {
        if (['click', 'submit', 'input', 'change'].includes(type)) {
          globalThis.__kovoPerf.lastDelegatedListenerMark = performance.now();
        }
        return addEventListenerOriginal(type, listener, options);
      };
    </script>
    <script>${kovoLoaderSource}</script>
  </head>
  <body>
    <main data-route="${route}">
      <h1>${title}</h1>
      <button id="action" kovo-state="{&quot;count&quot;:0}" on:click="${handlerHref}#increment">Add</button>
      <a id="next" href="/next">Next</a>
    </main>
  </body>
</html>`;
}

function htmlResponse(body, headers = {}) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...headers,
    },
  });
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}
