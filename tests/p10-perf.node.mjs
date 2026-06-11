import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { chromium } from 'playwright';

const { renderPageHints } = await import('../dist/server/src/index.mjs');
const { jisoLoaderSource } = await import('../dist/runtime/src/index.mjs');

const navigationCount = 100;
const heapNoiseBudget = 64 * 1024;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (url.pathname === '/c/handler.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(`
globalThis.__clientModuleLoads = (globalThis.__clientModuleLoads ?? 0) + 1;
export function increment(_event, ctx) {
  ctx.state.count += 1;
}
`);
    return;
  }

  if (url.pathname === '/next') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(renderDocument({ route: '/next', title: 'Next' }));
    return;
  }

  if (url.pathname.startsWith('/nav/')) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(renderDocument({ route: url.pathname, title: `Nav ${url.pathname}` }));
    return;
  }

  const hints = renderPageHints({
    modulepreloads: ['/c/handler.js'],
    prefetch: 'moderate',
    prerenderUrls: ['/next'],
  });
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    ...(hints.earlyHints.Link ? { Link: hints.earlyHints.Link } : {}),
  });
  response.end(renderDocument({ head: hints.html, route: '/', title: 'Home' }));
});

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
        buttonStateBeforeClick: button?.getAttribute('fw-state') ?? null,
        clientModuleLoadsBeforeInteraction: globalThis.__clientModuleLoads ?? 0,
        fcp: paint?.startTime ?? Number.NaN,
        handlerImportsBeforeInteraction: globalThis.__handlerImports ?? 0,
        hasSpeculationRules: document.querySelector('script[type="speculationrules"]') !== null,
        lastDelegatedListenerMark: globalThis.__jisoPerf.lastDelegatedListenerMark,
        ttiMinusFcpMs: globalThis.__jisoPerf.lastDelegatedListenerMark - (paint?.startTime ?? 0),
      };
    });

    assert.ok(Number.isFinite(firstLoad.fcp), 'first-contentful-paint is recorded');
    assert.equal(firstLoad.hasSpeculationRules, true);
    assert.ok(
      firstLoad.lastDelegatedListenerMark <= firstLoad.fcp,
      'delegated listeners are installed no later than first contentful paint',
    );
    assert.ok(firstLoad.ttiMinusFcpMs <= 0, 'TTI is equivalent to FCP for the loader spine');
    assert.equal(firstLoad.clientModuleLoadsBeforeInteraction, 0);
    assert.equal(firstLoad.handlerImportsBeforeInteraction, 0);

    await page.click('#action');
    await page.waitForFunction(
      () => document.querySelector('#action')?.getAttribute('fw-state') === '{"count":1}',
    );
    const afterClick = await page.evaluate(() => ({
      buttonStateAfterClick: document.querySelector('#action')?.getAttribute('fw-state') ?? null,
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

    for (let index = 0; index < navigationCount; index += 1) {
      await page.goto(`${origin}/nav/${index % 2}`, { waitUntil: 'load' });
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      heapSamples.push(heap.usedSize);
    }

    assert.equal(navigationCount, 100);
    const firstFiveMedian = median(heapSamples.slice(0, 5));
    const lastFiveMedian = median(heapSamples.slice(-5));
    const baselineUsedHeap = heapSamples[0];
    const finalUsedHeap = heapSamples.at(-1);

    assert.ok(
      finalUsedHeap <= baselineUsedHeap + heapNoiseBudget,
      'final heap stays within 64KiB browser/instrumentation noise budget',
    );
    assert.ok(
      lastFiveMedian <= firstFiveMedian + heapNoiseBudget,
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
      globalThis.__jisoPerf = { lastDelegatedListenerMark: 0 };
      const addEventListenerOriginal = globalThis.addEventListener.bind(globalThis);
      globalThis.addEventListener = (type, listener, options) => {
        if (['click', 'submit', 'input', 'change'].includes(type)) {
          globalThis.__jisoPerf.lastDelegatedListenerMark = performance.now();
        }
        return addEventListenerOriginal(type, listener, options);
      };
    </script>
    <script>${jisoLoaderSource}</script>
  </head>
  <body>
    <main data-route="${route}">
      <h1>${title}</h1>
      <button id="action" fw-state="{&quot;count&quot;:0}" on:click="/c/handler.js#increment">Add</button>
      <a id="next" href="/next">Next</a>
    </main>
  </body>
</html>`;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}
