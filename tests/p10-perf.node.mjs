import '../dist/server/src/runtime-bootstrap.mjs';

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';

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
    await runP10BrowserWorker(origin);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function runP10BrowserWorker(origin) {
  // Playwright's vendored source-map code installs own prototype methods while loading. Keep that
  // package-only browser driver in an isolated realm; the request-serving Kovo realm above stays
  // locked before every app/package dependency (SPEC §6.6 rule 6).
  return new Promise((resolve, reject) => {
    let failed = false;
    const worker = new Worker(new URL('./p10-perf-browser-worker.mjs', import.meta.url), {
      workerData: { acceptance: p10PerfAcceptance, origin },
    });
    worker.once('error', (error) => {
      failed = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (failed) return;
      if (code === 0) resolve();
      else reject(new Error(`P10 browser worker exited with code ${code}.`));
    });
  });
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
      globalThis.__kovoPerf = { firstDelegatedListenerMark: 0, lastDelegatedListenerMark: 0 };
      const addEventListenerOriginal = globalThis.addEventListener.bind(globalThis);
      globalThis.addEventListener = (type, listener, options) => {
        if (['click', 'submit', 'input', 'change'].includes(type)) {
          const mark = performance.now();
          if (!globalThis.__kovoPerf.firstDelegatedListenerMark) {
            globalThis.__kovoPerf.firstDelegatedListenerMark = mark;
          }
          globalThis.__kovoPerf.lastDelegatedListenerMark = mark;
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
