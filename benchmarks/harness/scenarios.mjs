import { chromium } from 'playwright';

const MOBILE_NETWORK = {
  downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8),
  latency: 150,
  offline: false,
  uploadThroughput: Math.round((0.75 * 1024 * 1024) / 8),
};

const CONDITIONS = {
  desktop: {
    cpuThrottle: 1,
    isMobile: false,
    network: null,
    viewport: { height: 900, width: 1440 },
  },
  mobile: {
    cpuThrottle: 4,
    isMobile: true,
    network: MOBILE_NETWORK,
    viewport: { height: 844, width: 390 },
  },
};

/**
 * The old collection window: `load` + 150 ms. Retained ONLY so each run can report how much the
 * old window understated the truth (plans/good-perf.md O15). Never use it as the headline number.
 */
const LOAD_WINDOW_MS = 150;

/** Network-quiescence settings for the real byte-accounting window. */
export const SETTLE_DEFAULTS = Object.freeze({ maxMs: 10_000, quietMs: 750 });

/**
 * Marker written into the page before an in-app navigation. It cannot survive a document
 * replacement, so its absence afterwards is proof the navigation destroyed the JS realm.
 */
const NAV_SENTINEL = 'kovo-bench-nav-sentinel';

export function percentile(values, pct) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index];
}

/** Median absolute deviation — the spread figure the perf ledger quotes alongside every median. */
export function medianAbsoluteDeviation(values) {
  if (values.length === 0) return null;
  const median = percentile(values, 50);
  return percentile(
    values.map((value) => Math.abs(value - median)),
    50,
  );
}

export function summarizeIterations(iterations) {
  const keys = new Set();
  for (const iteration of iterations) {
    for (const [key, value] of Object.entries(flattenMetrics(iteration))) {
      if (typeof value === 'number' && Number.isFinite(value)) keys.add(key);
    }
  }

  const summary = {};
  for (const key of keys) {
    const values = iterations
      .map((iteration) => flattenMetrics(iteration)[key])
      .filter((value) => typeof value === 'number' && Number.isFinite(value));
    summary[key] = {
      mad: medianAbsoluteDeviation(values),
      max: values.length === 0 ? null : Math.max(...values),
      median: percentile(values, 50),
      min: values.length === 0 ? null : Math.min(...values),
      p75: percentile(values, 75),
      samples: values.length,
    };
  }
  return summary;
}

function flattenMetrics(value, prefix = '', output = {}) {
  for (const [key, child] of Object.entries(value ?? {})) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenMetrics(child, next, output);
    } else {
      output[next] = child;
    }
  }
  return output;
}

export async function runScenarios({ app: _app, conditionName, iterations, origin, settle }) {
  const browser = await chromium.launch({ headless: true });
  const condition = CONDITIONS[conditionName];
  if (!condition) throw new Error(`Unknown benchmark condition ${conditionName}.`);
  const settleOptions = { ...SETTLE_DEFAULTS, ...settle };

  try {
    const coldLoad = [];
    const ttiProbe = [];
    const navigation = [];

    for (let index = 0; index < iterations; index += 1) {
      coldLoad.push(
        await withPage(browser, condition, (page, tracker) =>
          coldLoadScenario(page, tracker, origin, settleOptions),
        ),
      );
      ttiProbe.push(
        await withPage(browser, condition, (page, tracker) =>
          ttiScenario(page, tracker, origin, settleOptions),
        ),
      );
      navigation.push(
        await withPage(browser, condition, (page, tracker) =>
          navigationScenario(page, tracker, origin, settleOptions),
        ),
      );
    }

    return {
      coldLoad: { iterations: coldLoad, summary: summarizeIterations(coldLoad) },
      navigation: { iterations: navigation, summary: summarizeIterations(navigation) },
      settle: settleOptions,
      ttiProbe: { iterations: ttiProbe, summary: summarizeIterations(ttiProbe) },
    };
  } finally {
    await browser.close();
  }
}

async function withPage(browser, condition, run) {
  const context = await browser.newContext({
    deviceScaleFactor: condition.isMobile ? 2 : 1,
    isMobile: condition.isMobile,
    viewport: condition.viewport,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const tracker = createRequestTracker(page);

  await cdp.send('Network.enable');
  if (condition.cpuThrottle > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: condition.cpuThrottle });
  }
  if (condition.network) {
    await cdp.send('Network.emulateNetworkConditions', condition.network);
  }
  await page.addInitScript(() => {
    window.__kovoBenchLongTasks = [];
    window.__kovoBenchLcp = null;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__kovoBenchLongTasks.push(entry.duration);
      }).observe({ buffered: true, type: 'longtask' });
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        window.__kovoBenchLcp = entries[entries.length - 1]?.startTime ?? null;
      }).observe({ buffered: true, type: 'largest-contentful-paint' });
    } catch {
      // Older browser builds may reject one observer type; missing values stay null.
    }
  });

  let pageErrors = 0;
  page.on('pageerror', () => {
    pageErrors += 1;
  });

  try {
    const result = await run(page, tracker);
    return { ...result, pageErrors };
  } finally {
    await context.close();
  }
}

function createRequestTracker(page) {
  const settled = [];
  let started = 0;
  let completed = 0;
  let lastActivityAt = Date.now();

  page.on('request', () => {
    started += 1;
    lastActivityAt = Date.now();
  });
  page.on('requestfailed', () => {
    completed += 1;
    lastActivityAt = Date.now();
  });
  page.on('requestfinished', (request) => {
    completed += 1;
    lastActivityAt = Date.now();
    settled.push(
      (async () => {
        const [sizes, response] = await Promise.all([request.sizes(), request.response()]);
        return {
          bytes: sizes.responseBodySize + sizes.responseHeadersSize,
          resourceType: request.resourceType(),
          status: response?.status() ?? 0,
          url: request.url(),
        };
      })().catch(() => null),
    );
  });

  return {
    /** Live counters used to detect network quiescence without awaiting size resolution. */
    activity() {
      return { completed, lastActivityAt, pending: started - completed, started };
    },
    async collect() {
      const finished = (await Promise.all(settled)).filter(Boolean);
      const buckets = { css: 0, html: 0, img: 0, js: 0, other: 0, total: 0 };
      let errorResponses = 0;
      let rateLimitedResponses = 0;
      for (const request of finished) {
        const bucket =
          request.resourceType === 'document'
            ? 'html'
            : request.resourceType === 'script'
              ? 'js'
              : request.resourceType === 'stylesheet'
                ? 'css'
                : request.resourceType === 'image'
                  ? 'img'
                  : 'other';
        buckets[bucket] += request.bytes;
        buckets.total += request.bytes;
        if (request.status === 429) rateLimitedResponses += 1;
        else if (request.status >= 400) errorResponses += 1;
      }
      return {
        bytes: buckets,
        errorResponses,
        rateLimitedResponses,
        requests: finished.length,
      };
    },
  };
}

/**
 * Waits for real network quiescence instead of stopping at `load` + 150 ms.
 *
 * plans/good-perf.md O15: Kovo's inline bootstrap schedules its deferred-runtime import on a
 * double rAF AFTER `load`, so the old window recorded `total 164,673 / js 0` on mobile for a build
 * that actually ships 267,948 B of JS (a 2.64x understatement of total bytes). Yield two frames so
 * the import is at least scheduled, then require `quietMs` with zero in-flight requests.
 *
 * Returns `settleTimedOut: 1` when quiescence was never reached, so a capped window is visible in
 * the results rather than silently reported as a complete one.
 */
async function settleNetwork(page, tracker, { maxMs, quietMs }) {
  const startedAt = Date.now();
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
        }),
    )
    .catch(() => undefined);

  for (;;) {
    const { lastActivityAt, pending } = tracker.activity();
    if (pending === 0 && Date.now() - lastActivityAt >= quietMs) {
      return { settleMs: Date.now() - startedAt, settleTimedOut: 0 };
    }
    if (Date.now() - startedAt >= maxMs) {
      return { settleMs: Date.now() - startedAt, settleTimedOut: 1 };
    }
    await page.waitForTimeout(25);
  }
}

async function coldLoadScenario(page, tracker, origin, settle) {
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  await page.waitForTimeout(LOAD_WINDOW_MS);
  const loadWindow = await tracker.collect();
  const settled = await settleNetwork(page, tracker, settle);
  const perf = await performanceMetrics(page);
  const network = await tracker.collect();
  return {
    ...perf,
    ...network,
    ...settled,
    // The superseded `load` + 150 ms window, kept so every run reports its own understatement.
    loadWindow: { bytes: loadWindow.bytes, requests: loadWindow.requests },
  };
}

async function ttiScenario(page, tracker, origin, settle) {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  const tti = await page.evaluate(async () => {
    const deadline = performance.now() + 10000;
    let firstClick = null;
    while (performance.now() < deadline) {
      const button =
        document.querySelector('button[aria-label^="Open cart"]') ??
        Array.from(document.querySelectorAll('button')).find((candidate) =>
          candidate.textContent?.includes('Cart'),
        );
      if (button) {
        firstClick ??= performance.now();
        button.click();
      }
      const dialog = document.querySelector('[role="dialog"]');
      const box = dialog?.getBoundingClientRect();
      if (
        dialog &&
        box &&
        box.width > 0 &&
        box.height > 0 &&
        getComputedStyle(dialog).visibility !== 'hidden' &&
        getComputedStyle(dialog).display !== 'none'
      ) {
        return {
          firstSuccessfulClickMs: firstClick,
          ttiProxyMs: performance.now(),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    throw new Error('Timed out waiting for cart dialog to open.');
  });
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name="email"]').fill('bench@example.test');
  await dialog.getByRole('button', { name: 'Place order' }).click({ force: true });
  await dialog.locator('[role="status"]').waitFor({ state: 'visible', timeout: 5000 });
  const settled = await settleNetwork(page, tracker, settle);
  const perf = await performanceMetrics(page);
  const network = await tracker.collect();
  return { ...perf, checkoutConfirmed: 1, ...tti, ...network, ...settled };
}

/**
 * Measures an in-app navigation to actual paint, not to DOM presence.
 *
 * plans/good-perf.md O15: the old probe waited for `main h1` to exist and reported Kovo at 36.9 ms
 * desktop; measured to paint the same navigation costs 2,125 ms, a ~39x understatement, because
 * Kovo replaces the whole document. Both figures are reported here — `navToPaintMs` is the headline
 * and `navToDomMs` is retained only to keep the size of that gap visible.
 *
 * Timestamps are absolute (`performance.timeOrigin + …`) precisely because a document-replacing
 * navigation resets `performance.now()` and destroys any mark set before the click.
 */
async function navigationScenario(page, tracker, origin, settle) {
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  await settleNetwork(page, tracker, settle);
  const before = await tracker.collect();

  const link = page.locator('a[aria-label^="View "]').first();
  const targetPath = new URL(await link.getAttribute('href'), origin).pathname;

  await page.evaluate((sentinel) => {
    window.__kovoBenchNavSentinel = sentinel;
  }, NAV_SENTINEL);
  const startEpochMs = await epochNow(page);

  await link.click();

  // The superseded probe, reproduced exactly: wait for `main h1` to exist and stop. It is not a
  // navigation measurement at all — the LISTING page also has a `main h1`, so the selector is
  // already satisfied by the ORIGIN document and this resolves before the navigation commits.
  // Keeping it makes the size of that error visible in every run instead of asserted in prose.
  await page.waitForSelector('main h1');
  const legacyDomEpochMs = await epochNow(page);

  // Real commit: the destination URL, then the destination's own heading.
  await page.waitForURL((url) => url.pathname === targetPath);
  await page.waitForSelector('main h1');
  const domEpochMs = await epochNow(page);
  const paint = await navigationPaint(page, targetPath);
  const atPaint = await tracker.collect();

  const settled = await settleNetwork(page, tracker, settle);
  const after = await tracker.collect();

  return {
    navBytesAtPaint: atPaint.bytes.total - before.bytes.total,
    navBytesSettled: after.bytes.total - before.bytes.total,
    // 1 when the navigation destroyed the JS realm, i.e. enhanced navigation did not happen.
    navDocumentReplaced: paint.documentReplaced,
    navErrorResponses: after.errorResponses - before.errorResponses,
    // The superseded metric. Do not quote it (plans/good-perf.md "Do not re-propose").
    navLegacyDomPresenceMs: legacyDomEpochMs - startEpochMs,
    navPaintFromDocumentFcp: paint.fromDocumentFcp,
    navRateLimitedResponses: after.rateLimitedResponses - before.rateLimitedResponses,
    navRequests: after.requests - before.requests,
    navSettleTimedOut: settled.settleTimedOut,
    navToDomMs: domEpochMs - startEpochMs,
    navToPaintMs: paint.epochMs - startEpochMs,
    ...after,
  };
}

/**
 * Absolute (epoch) timestamp from inside the page.
 *
 * Absolute, not `performance.now()`, because a document-replacing navigation resets the document
 * timeline to 0 and destroys any mark set before the click — the exact reason the superseded probe
 * could not measure a Kovo navigation. Retries across execution-context destruction.
 */
async function epochNow(page) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await page.evaluate(() => performance.timeOrigin + performance.now());
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await page.waitForTimeout(25);
    }
  }
}

async function navigationPaint(page, targetPath) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = await page.evaluate(
        async ({ path, sentinel }) => {
          // Never answer from the origin document: a full-document navigation is asynchronous, so
          // an evaluate scheduled during it can still land in the document being replaced.
          if (location.pathname !== path) return null;
          if (!document.querySelector('main h1')) return null;

          const replaced = window.__kovoBenchNavSentinel !== sentinel;
          if (replaced) {
            // A new document was created: its browser-recorded first contentful paint IS the moment
            // the user first sees the destination, with no polling overshoot.
            const fcp = performance.getEntriesByName('first-contentful-paint')[0];
            if (!fcp) return null;
            return {
              documentReplaced: 1,
              epochMs: performance.timeOrigin + fcp.startTime,
              fromDocumentFcp: 1,
            };
          }
          // Same document: no new paint entry is emitted, so take the timestamp of the first frame
          // rendered after the destination content is in the DOM.
          await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
          });
          return {
            documentReplaced: 0,
            epochMs: performance.timeOrigin + performance.now(),
            fromDocumentFcp: 0,
          };
        },
        { path: targetPath, sentinel: NAV_SENTINEL },
      );
      if (result) return result;
    } catch {
      // The in-flight full-document navigation destroyed this execution context. Retry in the
      // document that replaced it — that retry is itself evidence the document was replaced.
    }
    await page.waitForTimeout(25);
  }
  throw new Error('Timed out waiting for the post-navigation paint signal.');
}

async function performanceMetrics(page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const longTasks = window.__kovoBenchLongTasks ?? [];
    const tbt = longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0);

    // Time to first byte. `PerformanceNavigationTiming.startTime` is always 0, so `responseStart`
    // is already TTFB measured from navigation start, matching the web-vitals TTFB definition.
    // `requestStart` is kept alongside it so the connection-setup share (DNS/TCP/TLS) can be
    // separated from the server's own think time via `serverResponseMs`.
    const ttfb = navigation?.responseStart ?? null;
    const requestStart = navigation?.requestStart ?? null;
    return {
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      fcpMs: fcp?.startTime ?? null,
      lcpMs: window.__kovoBenchLcp ?? null,
      loadMs: navigation?.loadEventEnd ?? null,
      requestStartMs: requestStart,
      responseEndMs: navigation?.responseEnd ?? null,
      // Server think time + response transfer start, excluding DNS/TCP/TLS setup.
      serverResponseMs:
        typeof ttfb === 'number' && typeof requestStart === 'number' ? ttfb - requestStart : null,
      tbtMs: tbt,
      ttfbMs: ttfb,
    };
  });
}
