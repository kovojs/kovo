import { createHash, randomUUID } from 'node:crypto';

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

export const NAVIGATION_ATTRIBUTION_SCHEMA = 'kovo-navigation-attribution/v3';

const NAVIGATION_TRACE_CATEGORIES =
  'blink.console,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame';
const TRACE_NETWORK_CLOCK_TOLERANCE_MS = 25;
const TRACE_RESOURCE_EVENTS = Object.freeze([
  'ResourceFinish',
  'ResourceReceiveResponse',
  'ResourceSendRequest',
]);

const TRACE_PHASE_EVENTS = Object.freeze({
  documentConstruction: Object.freeze(['ParseHTML']),
  layout: Object.freeze(['Layout']),
  paint: Object.freeze(['CompositeLayers', 'DrawFrame', 'Paint']),
  style: Object.freeze(['RecalculateStyles', 'UpdateLayoutTree']),
});

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
      p95: percentile(values, 95),
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

export async function runScenarios({
  app,
  conditionName,
  iterations,
  origin,
  settle,
  warmups = 0,
}) {
  const browser = await chromium.launch({ headless: true });
  const condition = CONDITIONS[conditionName];
  if (!condition) throw new Error(`Unknown benchmark condition ${conditionName}.`);
  const settleOptions = { ...SETTLE_DEFAULTS, ...settle };

  try {
    const coldLoad = [];
    const ttiProbe = [];
    const navigation = [];

    for (let index = -warmups; index < iterations; index += 1) {
      const record = index >= 0;
      if (app.scenarios?.includes('coldLoad') !== false) {
        const value = await withPage(browser, condition, (page, tracker) =>
          coldLoadScenario(
            page,
            tracker,
            `${origin}${app.paths?.listing ?? '/'}`,
            settleOptions,
            app.id,
            app.lane ?? 'default',
          ),
        );
        if (record) coldLoad.push(value);
      }
      if (app.scenarios?.includes('ttiProbe') !== false) {
        const value = await withPage(browser, condition, (page, tracker) =>
          ttiScenario(
            page,
            tracker,
            `${origin}${app.paths?.listing ?? '/'}`,
            settleOptions,
            app.id,
            app.lane ?? 'default',
          ),
        );
        if (record) ttiProbe.push(value);
      }
      if (app.scenarios?.includes('navigation') !== false) {
        const value = await withPage(browser, condition, (page, tracker) =>
          navigationScenario(page, tracker, `${origin}${app.paths?.listing ?? '/'}`, settleOptions),
        );
        if (record) navigation.push(value);
      }
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
  const destinationMark = `kovo-bench-destination-${randomUUID()}`;
  await page.addInitScript((destinationMark) => {
    window.__kovoBenchLongTasks = [];
    window.__kovoBenchLcp = null;
    window.__kovoBenchDestinationPaintMark = null;
    window.__kovoBenchDestinationPaintMarkedEpochMs = null;
    window.__kovoBenchNavigationClickMark = null;
    addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
        const mark = window.__kovoBenchArmedNavigationClickMark;
        if (!target || typeof mark !== 'string' || !mark) return;
        window.__kovoBenchNavigationClickMark = mark;
        window.__kovoBenchArmedNavigationClickMark = null;
        console.timeStamp(mark);
      },
      true,
    );
    const stampDestination = () => {
      const destination = document.querySelector(
        '[data-benchmark-destination="detail"], main.detail',
      );
      if (!destination || window.__kovoBenchDestinationPaintMark !== null) return;
      window.__kovoBenchDestinationPaintMark = destinationMark;
      window.__kovoBenchDestinationPaintMarkedEpochMs = performance.timeOrigin + performance.now();
      console.timeStamp(destinationMark);
    };
    new MutationObserver(stampDestination).observe(document, { childList: true, subtree: true });
    addEventListener('DOMContentLoaded', stampDestination, { once: true });
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
  }, destinationMark);

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

/**
 * Playwright's `requestfailed` fires for a request that never produced an HTTP response at all.
 * A navigation that replaces the document legitimately aborts the origin document's in-flight
 * subresource requests, and those surface here as `net::ERR_ABORTED` — expected, not a defect. Any
 * OTHER failure text (connection reset, DNS, TLS, timeout) means the entrant's traffic did not
 * complete at the network layer, which no HTTP-status check can ever see.
 */
const ABORT_ERROR_TEXT = 'net::ERR_ABORTED';

function createRequestTracker(page) {
  const settled = [];
  const failures = [];
  let started = 0;
  let completed = 0;
  let lastActivityAt = Date.now();

  const records = new Map();
  page.on('request', (request) => {
    started += 1;
    lastActivityAt = Date.now();
    records.set(request, {
      headers: request.headers(),
      frameScope: requestFrameScope(request, page),
      isNavigationRequest: request.isNavigationRequest(),
      method: request.method(),
      resourceType: request.resourceType(),
      startedEpochMs: Date.now(),
      url: request.url(),
    });
  });
  page.on('requestfailed', (request) => {
    completed += 1;
    lastActivityAt = Date.now();
    failures.push({
      errorText: request.failure()?.errorText ?? 'unknown',
      resourceType: request.resourceType(),
    });
    records.delete(request);
  });
  page.on('requestfinished', (request) => {
    completed += 1;
    lastActivityAt = Date.now();
    settled.push(
      (async () => {
        const [sizes, response] = await Promise.all([request.sizes(), request.response()]);
        const record = records.get(request);
        records.delete(request);
        const timing = requestTimingSnapshot(request);
        return {
          bytes: sizes.responseBodySize + sizes.responseHeadersSize,
          frameScope: record?.frameScope ?? requestFrameScope(request, page),
          headers: record?.headers ?? {},
          isNavigationRequest: record?.isNavigationRequest ?? request.isNavigationRequest(),
          method: record?.method ?? request.method(),
          resourceType: request.resourceType(),
          responseHeaders: await responseHeaderSnapshot(response),
          startedEpochMs: record?.startedEpochMs ?? Date.now(),
          status: response?.status() ?? 0,
          timing,
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
    async collect({ includeRecords = false } = {}) {
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
      // A request that failed at the network layer carries NO HTTP status, so `errorResponses`
      // cannot see it: an iteration whose every subresource was reset would otherwise report a
      // clean zero. Aborts caused by the harness's own document-replacing navigation are counted
      // separately so they cannot spuriously reject an otherwise healthy run.
      const aborted = failures.filter((failure) => failure.errorText.includes(ABORT_ERROR_TEXT));
      const failed = failures.filter((failure) => !failure.errorText.includes(ABORT_ERROR_TEXT));
      const result = {
        abortedRequests: aborted.length,
        bytes: buckets,
        errorResponses,
        failedRequests: failed.length,
        failureReasons: [...new Set(failed.map((failure) => failure.errorText))].sort(),
        rateLimitedResponses,
        requests: finished.length,
      };
      if (includeRecords) result.records = finished.map((request) => ({ ...request }));
      return result;
    },
  };
}

function requestFrameScope(request, page) {
  try {
    return request.frame() === page.mainFrame() ? 'top-level' : 'subframe';
  } catch {
    return request.serviceWorker() === null ? 'unavailable' : 'service-worker';
  }
}

function normalizeRequestTiming(timing) {
  if (!timing || !Number.isFinite(timing.startTime)) return null;
  const result = { startTime: timing.startTime };
  for (const field of ['requestStart', 'responseStart', 'responseEnd']) {
    result[field] = Number.isFinite(timing[field]) && timing[field] >= 0 ? timing[field] : null;
  }
  return result;
}

function requestTimingSnapshot(request) {
  try {
    return normalizeRequestTiming(request.timing());
  } catch {
    return null;
  }
}

async function responseHeaderSnapshot(response) {
  if (!response) return {};
  try {
    return await response.allHeaders();
  } catch {
    try {
      return response.headers();
    } catch {
      return {};
    }
  }
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

async function coldLoadScenario(
  page,
  tracker,
  listingUrl,
  settle,
  expectedFramework,
  expectedLane,
) {
  await page.goto(listingUrl, { waitUntil: 'load' });
  await page.waitForTimeout(LOAD_WINDOW_MS);
  const loadWindow = await tracker.collect();
  const settled = await settleNetwork(page, tracker, settle);
  const perf = await performanceMetrics(page);
  const network = await tracker.collect();
  const fixture = await fixtureIntegrity(page, { expectedFramework, expectedLane });
  return {
    ...fixture,
    ...perf,
    ...network,
    ...settled,
    // The superseded `load` + 150 ms window, kept so every run reports its own understatement.
    loadWindow: { bytes: loadWindow.bytes, requests: loadWindow.requests },
  };
}

async function ttiScenario(page, tracker, listingUrl, settle, expectedFramework, expectedLane) {
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded' });
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
  let stateMutationConfirmed = 0;
  const lane = await page.evaluate(
    () =>
      document.querySelector('[data-benchmark-lane]')?.getAttribute('data-benchmark-lane') ??
      'default',
  );
  if (lane === 'matched-l1') {
    await dialog.getByRole('button', { name: 'Add benchmark item' }).click();
    await page.getByRole('button', { name: /Open cart with 1 items/u }).waitFor();
    stateMutationConfirmed = 1;
  }
  const email = dialog.locator('input[name="email"]');
  if ((await email.getAttribute('readonly')) !== null) {
    await dialog.getByRole('button', { name: 'Use alternate email' }).click();
  } else {
    await email.fill('bench@example.test');
  }
  await dialog.getByRole('button', { name: 'Place order' }).click({ force: true });
  await dialog.locator('[role="status"]').waitFor({ state: 'visible', timeout: 5000 });
  const settled = await settleNetwork(page, tracker, settle);
  const perf = await performanceMetrics(page);
  const network = await tracker.collect();
  const fixture = await fixtureIntegrity(page, { expectedFramework, expectedLane });
  return {
    ...fixture,
    ...perf,
    checkoutConfirmed: 1,
    stateMutationConfirmed,
    ...tti,
    ...network,
    ...settled,
  };
}

/**
 * Measures an in-app navigation to actual paint, not to DOM presence.
 *
 * plans/good-perf.md O15: the old probe waited for `main h1` to exist and reported Kovo at 36.9 ms
 * desktop; measured to paint the same navigation costs 2,125 ms, a ~39x understatement, because
 * Kovo replaces the whole document. Both figures are reported here — `navToPaintMs` is the headline
 * and `navToDomMs` is retained only to keep the size of that gap visible.
 *
 * Click-to-paint duration stays entirely on Chrome's trace clock. Trace timestamps are converted
 * to epoch time only to place network requests into the byte-accounting phases; this avoids mixing
 * page clocks when a document-replacing navigation resets `performance.now()`.
 */
async function navigationScenario(page, tracker, listingUrl, settle) {
  await page.goto(listingUrl, { waitUntil: 'load' });
  const initialEndEpochMs = await epochNow(page);
  await settleNetwork(page, tracker, settle);
  const before = await tracker.collect();

  const link = page.locator('a[aria-label^="View "]').first();
  const targetPath = new URL(await link.getAttribute('href'), listingUrl).pathname;

  await page.evaluate((sentinel) => {
    window.__kovoBenchNavSentinel = sentinel;
  }, NAV_SENTINEL);
  const clickMark = `kovo-bench-click-${randomUUID()}`;
  await page.evaluate((mark) => {
    window.__kovoBenchArmedNavigationClickMark = mark;
  }, clickMark);
  const trace = await startNavigationTrace(page);
  let destination;
  let traceResult;
  try {
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
    destination = await destinationObservation(page, targetPath);
    const settled = await settleNetwork(page, tracker, settle);
    const after = await tracker.collect({ includeRecords: true });
    traceResult = await stopNavigationTrace(trace, {
      clickMark,
      destinationMark: destination.mark,
    });
    const attribution = analyzeNavigationAttribution({
      clickTsUs: traceResult.clickTsUs,
      destinationMarkTsUs: traceResult.destinationMarkTsUs,
      destinationPaintTsUs: traceResult.destinationPaintTsUs,
      epochOffsetMs: trace.epochOffsetMs,
      mainFrameId: trace.mainFrameId,
      networkEvents: trace.networkRequests,
      records: after.records,
      targetPath,
      traceEvents: trace.events,
    });
    const phases = sessionBytePhases(after.records, {
      clickEpochMs: traceResult.clickEpochMs,
      destinationPaintEpochMs: traceResult.destinationPaintEpochMs,
      initialEndEpochMs,
    });
    const traceMarkerEpochSkewMs = traceResult.destinationMarkEpochMs - destination.markedEpochMs;
    if (Math.abs(traceMarkerEpochSkewMs) > 250) {
      throw new Error(
        `Trace/page epoch calibration diverged by ${String(traceMarkerEpochSkewMs)} ms.`,
      );
    }

    const { records: _records, ...networkAfter } = after;
    return {
      navBytesAtPaint: phases.click.total,
      navBytesSettled: after.bytes.total - before.bytes.total,
      // 1 when the navigation destroyed the JS realm, i.e. enhanced navigation did not happen.
      navDocumentReplaced: destination.documentReplaced,
      navErrorResponses: after.errorResponses - before.errorResponses,
      navFailedRequests: after.failedRequests - before.failedRequests,
      // The superseded metric. Do not quote it (plans/good-perf.md "Do not re-propose").
      navLegacyDomPresenceMs: legacyDomEpochMs - traceResult.clickEpochMs,
      navAttribution: attribution,
      navPaintBoundary: traceResult.boundary,
      navRateLimitedResponses: after.rateLimitedResponses - before.rateLimitedResponses,
      navRequests: after.requests - before.requests,
      navSettleTimedOut: settled.settleTimedOut,
      navToDomMs: domEpochMs - traceResult.clickEpochMs,
      navToPaintMs: traceResult.durationMs,
      sessionBytes: phases,
      traceMarkerEpochSkewMs,
      ...networkAfter,
    };
  } finally {
    if (!trace.stopped) await abortNavigationTrace(trace);
  }
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

async function destinationObservation(page, targetPath) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = await page.evaluate(
        async ({ path, sentinel }) => {
          // Never answer from the origin document: a full-document navigation is asynchronous, so
          // an evaluate scheduled during it can still land in the document being replaced.
          if (location.pathname !== path) return null;
          if (!document.querySelector('main h1')) return null;

          return {
            documentReplaced: window.__kovoBenchNavSentinel !== sentinel ? 1 : 0,
            mark: window.__kovoBenchDestinationPaintMark,
            markedEpochMs: window.__kovoBenchDestinationPaintMarkedEpochMs,
          };
        },
        { path: targetPath, sentinel: NAV_SENTINEL },
      );
      if (
        typeof result?.mark === 'string' &&
        result.mark &&
        Number.isFinite(result.markedEpochMs)
      ) {
        return result;
      }
    } catch {
      // The in-flight full-document navigation destroyed this execution context. Retry in the
      // document that replaced it — that retry is itself evidence the document was replaced.
    }
    await page.waitForTimeout(25);
  }
  throw new Error('Timed out waiting for the destination trace signal.');
}

/**
 * Starts one Chrome trace instrument for both full-document and same-document navigations.
 * The page init script emits a TimeStamp from the MutationObserver that first sees the destination
 * marker. The reported boundary is the first compositor frame after that mark in the same trace.
 * Unlike the superseded branch split, both entrants therefore pay the same observation cost and
 * are timed at the same browser event.
 */
async function startNavigationTrace(page) {
  const context = page.context();
  const cdp = await context.newCDPSession(page);
  try {
    const events = [];
    const networkRequests = [];
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', (event) => networkRequests.push(event));
    await cdp.send('Performance.enable');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const timestamp = metrics.find((metric) => metric.name === 'Timestamp')?.value;
    if (!Number.isFinite(timestamp)) throw new Error('CDP Performance.Timestamp was unavailable.');
    const epochOffsetMs = Date.now() - timestamp * 1_000;
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const mainFrameId = frameTree?.frame?.id;
    if (typeof mainFrameId !== 'string' || mainFrameId.length === 0) {
      throw new Error('CDP top-level frame identity was unavailable.');
    }
    cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
    const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.start', {
      categories: NAVIGATION_TRACE_CATEGORIES,
      options: 'record-as-much-as-possible',
      transferMode: 'ReportEvents',
    });
    return {
      cdp,
      complete,
      endRequested: false,
      epochOffsetMs,
      events,
      mainFrameId,
      networkRequests,
      page,
      stopped: false,
    };
  } catch (error) {
    await cdp.detach().catch(() => undefined);
    throw error;
  }
}

async function stopNavigationTrace(trace, { clickMark, destinationMark }) {
  try {
    await trace.page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await endNavigationTrace(trace);
  } finally {
    await closeNavigationTrace(trace);
  }

  const click = findTraceTimestamp(trace.events, clickMark);
  const mark = findTraceTimestamp(trace.events, destinationMark);
  const paint = trace.events
    .filter(
      (event) =>
        Number.isFinite(event.ts) &&
        event.ts >= mark.ts &&
        (event.name === 'DrawFrame' || event.name === 'CompositeLayers' || event.name === 'Paint'),
    )
    .sort((left, right) => left.ts - right.ts)[0];
  if (!paint) throw new Error('Trace did not contain a destination paint/compositor frame.');

  const clickEpochMs = click.ts / 1_000 + trace.epochOffsetMs;
  const destinationPaintEpochMs = paint.ts / 1_000 + trace.epochOffsetMs;
  const destinationMarkEpochMs = mark.ts / 1_000 + trace.epochOffsetMs;
  return {
    boundary: 'first-traced-frame-after-destination-marker',
    clickEpochMs,
    clickTsUs: click.ts,
    destinationMarkEpochMs,
    destinationMarkTsUs: mark.ts,
    destinationPaintEpochMs,
    destinationPaintTsUs: paint.ts,
    durationMs: (paint.ts - click.ts) / 1_000,
  };
}

function findTraceTimestamp(events, expectedMark) {
  const mark = events.find((event) => {
    if (event.name !== 'TimeStamp') return false;
    return (event.args?.data?.message ?? event.args?.message) === expectedMark;
  });
  if (!mark || !Number.isFinite(mark.ts)) {
    throw new Error(`Trace did not contain timestamp ${String(expectedMark)}.`);
  }
  return mark;
}

async function abortNavigationTrace(trace) {
  await closeNavigationTrace(trace);
}

async function endNavigationTrace(trace) {
  if (!trace.endRequested) {
    await trace.cdp.send('Tracing.end');
    trace.endRequested = true;
  }
  await trace.complete;
}

async function closeNavigationTrace(trace) {
  try {
    await endNavigationTrace(trace);
  } catch {
    // The page or browser may already have closed. Detaching below is still mandatory so a failed
    // measurement cannot retain a live CDP session or contaminate the next iteration.
  } finally {
    await trace.cdp.detach().catch(() => undefined);
    trace.stopped = true;
  }
}

/**
 * Turn one authenticated request/trace observation into an honest navigation waterfall.
 *
 * Chrome exposes request start/response start/response end and names style/layout/paint work in
 * the DevTools timeline. It does NOT expose stable boundaries inside an entrant's JavaScript for
 * response text consumption, structured-parts/RSC decoding, document building via createElement,
 * or DOM morphing. Those rows therefore remain explicit `unsupported` facts. The directly
 * observed response-headers-to-destination-marker interval is retained as one combined envelope;
 * it is the smallest common boundary that covers streaming delivery, processing, and DOM apply
 * without asymmetric framework instrumentation or invented residual arithmetic.
 */
export function analyzeNavigationAttribution({
  clickTsUs,
  destinationMarkTsUs,
  destinationPaintTsUs,
  epochOffsetMs,
  mainFrameId,
  networkEvents,
  records,
  targetPath,
  traceEvents,
}) {
  for (const [name, value] of Object.entries({
    clickTsUs,
    destinationMarkTsUs,
    destinationPaintTsUs,
    epochOffsetMs,
  })) {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
  }
  if (!(clickTsUs <= destinationMarkTsUs && destinationMarkTsUs <= destinationPaintTsUs)) {
    throw new TypeError('Navigation attribution trace boundaries are out of order.');
  }
  if (!Array.isArray(records) || !Array.isArray(traceEvents) || !Array.isArray(networkEvents)) {
    throw new TypeError(
      'Navigation attribution requires Playwright records, Network events, and trace events.',
    );
  }
  if (!validTargetPath(targetPath) || typeof mainFrameId !== 'string' || mainFrameId.length === 0) {
    throw new TypeError(
      'Navigation attribution requires an exact destination path and top-level frame identity.',
    );
  }

  const responseSelection = selectPrimaryNavigationResponse(records, networkEvents, traceEvents, {
    clickTsUs,
    destinationPaintTsUs,
    epochOffsetMs,
    mainFrameId,
    targetPath,
  });
  const primaryResponse = responseSelection.primaryResponse;
  const responseTiming = responseSelection.traceTiming ?? null;
  const responseStartTsUs = responseTiming?.responseStartTsUs ?? clickTsUs;
  if (responseTiming !== null && responseStartTsUs > destinationMarkTsUs) {
    throw new Error(
      'Navigation attribution selected a primary response whose headers arrived after the ' +
        'destination marker.',
    );
  }

  const documentConstructionActivity = traceActivity(traceEvents, {
    endTsUs: destinationMarkTsUs,
    names: TRACE_PHASE_EVENTS.documentConstruction,
    startTsUs: responseStartTsUs,
  });
  const styleActivity = traceActivity(traceEvents, {
    endTsUs: destinationPaintTsUs,
    names: TRACE_PHASE_EVENTS.style,
    startTsUs: responseStartTsUs,
  });
  const layoutActivity = traceActivity(traceEvents, {
    endTsUs: destinationPaintTsUs,
    names: TRACE_PHASE_EVENTS.layout,
    startTsUs: responseStartTsUs,
  });
  const paintBoundaryDurationUs = traceEvents.reduce((duration, event) => {
    if (
      TRACE_PHASE_EVENTS.paint.includes(event?.name) &&
      event?.ts === destinationPaintTsUs &&
      Number.isFinite(event?.dur) &&
      event.dur >= 0
    ) {
      return Math.max(duration, event.dur);
    }
    return duration;
  }, 0);
  const paintActivity = traceActivity(traceEvents, {
    endTsUs: destinationPaintTsUs + paintBoundaryDurationUs,
    names: TRACE_PHASE_EVENTS.paint,
    startTsUs: destinationMarkTsUs,
  });
  if (paintActivity.eventCount === 0) {
    throw new Error('Navigation attribution lost the trace event that defines destination paint.');
  }

  const phases = {
    server:
      responseTiming === null
        ? unsupportedPhase(primaryResponse.reason)
        : observedPhase(
            (responseTiming.responseStartTsUs - responseTiming.requestStartTsUs) / 1_000,
            'chromium-devtools-timeline:request-send-to-response-headers',
          ),
    transfer:
      responseTiming === null
        ? unsupportedPhase(primaryResponse.reason)
        : observedPhase(
            (responseTiming.responseEndTsUs - responseTiming.responseStartTsUs) / 1_000,
            'chromium-devtools-timeline:response-headers-to-ResourceFinish.finishTime',
          ),
    responseProcessingDomApply:
      responseTiming === null
        ? unsupportedPhase('A trace-authenticated click-window primary response was not observed.')
        : observedPhase(
            (destinationMarkTsUs - responseStartTsUs) / 1_000,
            'chromium-monotonic-trace:response-headers-to-destination-marker',
            {
              includes: [
                'response-transfer-and-stream-consumption',
                'response-read-decode',
                'document-build-or-morph',
                'main-thread-queueing',
              ],
              scope: 'primary-response-headers-to-destination-marker',
            },
          ),
    responseReadDecode: unsupportedPhase(
      'Chromium exposes the enclosing response-processing/DOM-apply interval but no stable ' +
        'cross-framework boundary for response text or stream consumption plus JSON/RSC decoding.',
    ),
    documentConstruction:
      documentConstructionActivity.eventCount === 0
        ? unsupportedPhase(
            'No ParseHTML event identified document construction. createElement/React work is ' +
              'indistinguishable from surrounding JavaScript without entrant instrumentation.',
          )
        : observedTracePhase(documentConstructionActivity),
    domMorphApply: unsupportedPhase(
      'The DevTools timeline does not expose a stable cross-framework DOM morph/apply boundary; ' +
        'the destination MutationObserver proves completion but not the phase start.',
    ),
    style: observedTracePhase(styleActivity),
    layout: observedTracePhase(layoutActivity),
    paint: observedTracePhase(paintActivity),
  };

  const facts = {
    schema: NAVIGATION_ATTRIBUTION_SCHEMA,
    observationBoundary: {
      clock: 'chromium-monotonic-trace',
      end: 'first-traced-frame-after-destination-marker',
      start: 'capturing-click-timestamp',
      clickTsUs: String(clickTsUs),
      destinationMarkTsUs: String(destinationMarkTsUs),
      destinationPaintTsUs: String(destinationPaintTsUs),
    },
    primaryResponse,
    phases,
    traceEvidence: {
      categories: NAVIGATION_TRACE_CATEGORIES,
      eventCensus: traceEventCensus(traceEvents, [
        ...TRACE_RESOURCE_EVENTS,
        ...TRACE_PHASE_EVENTS.documentConstruction,
        ...TRACE_PHASE_EVENTS.style,
        ...TRACE_PHASE_EVENTS.layout,
        ...TRACE_PHASE_EVENTS.paint,
      ]),
      relevantEventCount: String(
        responseSelection.traceEventCount +
          documentConstructionActivity.eventCount +
          styleActivity.eventCount +
          layoutActivity.eventCount +
          paintActivity.eventCount,
      ),
    },
  };
  const attribution = {
    ...facts,
    evidenceDigest: navigationAttributionDigest(facts),
  };
  const findings = navigationAttributionFindings(attribution);
  if (findings.length > 0) {
    throw new Error(`Navigation attribution evidence is invalid: ${findings.join('; ')}`);
  }
  return attribution;
}

export function navigationAttributionFindings(attribution) {
  const findings = [];
  if (!attribution || attribution.schema !== NAVIGATION_ATTRIBUTION_SCHEMA) {
    return ['navigation attribution schema is unavailable'];
  }
  const { evidenceDigest, ...facts } = attribution;
  if (evidenceDigest !== navigationAttributionDigest(facts)) {
    findings.push('navigation attribution digest is not derived from its evidence');
  }
  const boundary = attribution.observationBoundary;
  if (
    boundary?.clock !== 'chromium-monotonic-trace' ||
    boundary?.start !== 'capturing-click-timestamp' ||
    boundary?.end !== 'first-traced-frame-after-destination-marker' ||
    !finiteNumberText(boundary?.clickTsUs) ||
    !finiteNumberText(boundary?.destinationMarkTsUs) ||
    !finiteNumberText(boundary?.destinationPaintTsUs) ||
    Number(boundary.clickTsUs) > Number(boundary.destinationMarkTsUs) ||
    Number(boundary.destinationMarkTsUs) > Number(boundary.destinationPaintTsUs)
  ) {
    findings.push('navigation attribution boundary is invalid');
  }
  if (!validPrimaryResponse(attribution.primaryResponse)) {
    findings.push('navigation attribution primary response is invalid');
  }
  const expectedPhases = [
    'server',
    'transfer',
    'responseProcessingDomApply',
    'responseReadDecode',
    'documentConstruction',
    'domMorphApply',
    'style',
    'layout',
    'paint',
  ];
  if (
    !attribution.phases ||
    JSON.stringify(Object.keys(attribution.phases)) !== JSON.stringify(expectedPhases)
  ) {
    findings.push('navigation attribution phase census is invalid');
  } else {
    for (const [name, phase] of Object.entries(attribution.phases)) {
      if (!validAttributionPhase(phase)) findings.push(`navigation attribution ${name} is invalid`);
    }
    if (!validResponseProcessingDomApplyPhase(attribution.phases.responseProcessingDomApply)) {
      findings.push('navigation attribution responseProcessingDomApply contract is invalid');
    }
    findings.push(...navigationPhaseContractFindings(attribution));
  }
  if (
    attribution.traceEvidence?.categories !== NAVIGATION_TRACE_CATEGORIES ||
    !validTraceEventCensus(attribution.traceEvidence?.eventCensus) ||
    !safeIntegerText(attribution.traceEvidence?.relevantEventCount, { min: 1 })
  ) {
    findings.push('navigation attribution trace evidence is invalid');
  }
  if (
    attribution.primaryResponse?.status === 'observed' &&
    TRACE_RESOURCE_EVENTS.some(
      (name) => !safeIntegerText(attribution.traceEvidence?.eventCensus?.[name], { min: 1 }),
    )
  ) {
    findings.push('navigation attribution primary response trace census is incomplete');
  }
  return findings;
}

function navigationPhaseContractFindings(attribution) {
  const findings = [];
  const phases = attribution.phases;
  const primary = attribution.primaryResponse;
  if (primary?.status === 'observed') {
    const requestStartTsUs = Number(primary.timing?.requestStartTsUs);
    const responseStartTsUs = Number(primary.timing?.responseStartTsUs);
    const responseEndTsUs = Number(primary.timing?.responseEndTsUs);
    const destinationMarkTsUs = Number(attribution.observationBoundary?.destinationMarkTsUs);
    const destinationPaintTsUs = Number(attribution.observationBoundary?.destinationPaintTsUs);
    if (responseEndTsUs > destinationPaintTsUs) {
      findings.push(
        'navigation attribution primary response completed outside the click-to-paint window',
      );
    }
    if (
      !observedPhaseMatches(
        phases.server,
        (responseStartTsUs - requestStartTsUs) / 1_000,
        'chromium-devtools-timeline:request-send-to-response-headers',
      )
    ) {
      findings.push('navigation attribution server phase does not match its trace boundaries');
    }
    if (
      !observedPhaseMatches(
        phases.transfer,
        (responseEndTsUs - responseStartTsUs) / 1_000,
        'chromium-devtools-timeline:response-headers-to-ResourceFinish.finishTime',
      )
    ) {
      findings.push('navigation attribution transfer phase does not match its trace boundaries');
    }
    if (
      !observedPhaseMatches(
        phases.responseProcessingDomApply,
        (destinationMarkTsUs - responseStartTsUs) / 1_000,
        'chromium-monotonic-trace:response-headers-to-destination-marker',
      )
    ) {
      findings.push(
        'navigation attribution responseProcessingDomApply phase does not match its trace boundaries',
      );
    }
  } else if (
    [phases.server, phases.transfer, phases.responseProcessingDomApply].some(
      (phase) => phase?.status !== 'unsupported',
    )
  ) {
    findings.push(
      'navigation attribution response-dependent phase was observed without a response',
    );
  }

  if (
    phases.responseReadDecode?.status !== 'unsupported' ||
    phases.domMorphApply?.status !== 'unsupported'
  ) {
    findings.push('navigation attribution invented a JS-internal phase boundary');
  }
  if (
    phases.documentConstruction?.status === 'observed' &&
    phases.documentConstruction.source !== 'chromium-devtools-timeline'
  ) {
    findings.push('navigation attribution document construction source is invalid');
  }
  for (const name of ['style', 'layout', 'paint']) {
    if (
      phases[name]?.status !== 'observed' ||
      phases[name].source !== 'chromium-devtools-timeline'
    ) {
      findings.push(`navigation attribution ${name} trace phase is invalid`);
    }
  }
  if (!safeIntegerText(phases.paint?.eventCount, { min: 1 })) {
    findings.push('navigation attribution paint trace event is unavailable');
  }
  return findings;
}

function observedPhaseMatches(phase, durationMs, source) {
  return (
    phase?.status === 'observed' &&
    phase.source === source &&
    Number.isFinite(durationMs) &&
    Math.abs(phase.durationMs - durationMs) <= 1e-9
  );
}

function selectPrimaryNavigationResponse(
  records,
  networkEvents,
  traceEvents,
  { clickTsUs, destinationPaintTsUs, epochOffsetMs, mainFrameId, targetPath },
) {
  const recordCandidates = navigationRecordCandidates(records, {
    clickEpochMs: traceEpochMs(clickTsUs, epochOffsetMs),
    destinationPaintEpochMs: traceEpochMs(destinationPaintTsUs, epochOffsetMs),
    targetPath,
  });
  const traceCandidates = navigationTraceResponseCandidates(networkEvents, traceEvents, {
    clickTsUs,
    destinationPaintTsUs,
    mainFrameId,
    targetPath,
  });
  if (traceCandidates.length > 1) {
    throw new Error(
      `Navigation attribution found ${String(traceCandidates.length)} top-level destination ` +
        'response triplets; exactly one is required.',
    );
  }
  const selected = traceCandidates[0];
  if (!selected) {
    if (recordCandidates.length > 0) {
      throw new Error(
        'Navigation attribution observed a click-window primary response in Playwright but ' +
          'Chromium did not retain its complete ResourceSendRequest/ResourceReceiveResponse/' +
          'ResourceFinish trace witness. ' +
          `Bounded target-trace diagnostics: ${targetTraceDiagnostics(traceEvents, targetPath)}`,
      );
    }
    return {
      primaryResponse: {
        candidateCount: '0',
        durationMs: null,
        reason:
          'No trace-authenticated document or navigation-data response began inside the ' +
          'click-to-paint window; navigation may have consumed pre-click prefetched bytes.',
        status: 'unsupported',
      },
      traceEventCount: 0,
    };
  }

  const matchingRecords = recordCandidates.filter(
    (candidate) =>
      candidate.record.url === selected.url &&
      candidate.record.method === selected.method &&
      candidate.record.status === selected.httpStatus &&
      candidate.contentType === selected.contentType &&
      candidate.selection.name === selected.selection.name,
  );
  if (matchingRecords.length !== 1) {
    throw new Error(
      `Navigation attribution trace response ${selected.requestId} matched ` +
        `${String(matchingRecords.length)} Playwright request records; exactly one is required.`,
    );
  }
  const record = matchingRecords[0];
  const traceTiming = selected.timing;
  const skewFacts = traceNetworkClockSkew(record.timing, traceTiming, epochOffsetMs);
  if (skewFacts.maxAbsoluteSkewMs > TRACE_NETWORK_CLOCK_TOLERANCE_MS) {
    throw new Error(
      `Navigation attribution trace/Playwright request clocks diverged by ` +
        `${String(skewFacts.maxAbsoluteSkewMs)} ms.`,
    );
  }

  const playwrightWitnessFacts = {
    contentType: record.contentType || null,
    httpStatus: String(record.record.status),
    method: record.record.method,
    resourceType: record.record.resourceType,
    frameScope: record.record.frameScope,
    isNavigationRequest: record.record.isNavigationRequest,
    timing: {
      requestStartEpochMs: String(record.timing.requestStartEpochMs),
      responseEndEpochMs: String(record.timing.responseEndEpochMs),
      responseStartEpochMs: String(record.timing.responseStartEpochMs),
      source: record.timing.source,
    },
    url: record.record.url,
  };
  const responseFacts = {
    candidateCount: String(traceCandidates.length),
    contentType: selected.contentType || null,
    httpStatus: String(selected.httpStatus),
    method: selected.method,
    networkWitness: {
      candidateCount: String(recordCandidates.length),
      facts: playwrightWitnessFacts,
      identity: sha256Canonical(playwrightWitnessFacts),
      maxAbsoluteSkewMs: String(skewFacts.maxAbsoluteSkewMs),
      source: 'playwright-request-timing',
      toleranceMs: String(TRACE_NETWORK_CLOCK_TOLERANCE_MS),
    },
    resourceType: selected.resourceType,
    selection: selected.selection.name,
    traceContext: selected.traceContext,
    timing: {
      clock: 'chromium-monotonic-trace',
      requestStartTsUs: String(traceTiming.requestStartTsUs),
      responseEndTsUs: String(traceTiming.responseEndTsUs),
      responseStartTsUs: String(traceTiming.responseStartTsUs),
      source:
        'ResourceSendRequest+ResourceReceiveResponse.args.data.timing/' +
        'ResourceFinish.args.data.finishTime',
    },
    traceRequestId: selected.requestId,
    url: selected.url,
  };
  return {
    primaryResponse: {
      ...responseFacts,
      identity: sha256Canonical(responseFacts),
      status: 'observed',
    },
    traceEventCount: TRACE_RESOURCE_EVENTS.length,
    traceTiming,
  };
}

function targetTraceDiagnostics(traceEvents, targetPath) {
  const facts = [];
  for (const event of traceEvents) {
    if (event?.name !== 'ResourceSendRequest') continue;
    const data = event.args?.data;
    if (requestUrlPath(data?.url) !== targetPath) continue;
    facts.push({
      frame: typeof data?.frame === 'string' ? data.frame : null,
      initiatorFetchType:
        typeof data?.initiator?.fetchType === 'string' ? data.initiator.fetchType : null,
      initiatorType: typeof data?.initiator?.type === 'string' ? data.initiator.type : null,
      keys:
        data && typeof data === 'object' && !Array.isArray(data)
          ? Object.keys(data).sort().slice(0, 32)
          : [],
      loaderId: typeof data?.loaderId === 'string' ? data.loaderId : null,
      requestId: typeof data?.requestId === 'string' ? data.requestId : null,
      resourceType: typeof data?.resourceType === 'string' ? data.resourceType : null,
    });
    if (facts.length >= 4) break;
  }
  return JSON.stringify(facts);
}

function navigationRecordCandidates(
  records,
  { clickEpochMs, destinationPaintEpochMs, targetPath },
) {
  const candidates = [];
  for (const record of records) {
    const timing = requestTimingEpochs(record.timing);
    if (
      timing === null ||
      timing.requestStartEpochMs < clickEpochMs - 10 ||
      timing.requestStartEpochMs > destinationPaintEpochMs + 10
    ) {
      continue;
    }
    if (
      requestUrlPath(record.url) !== targetPath ||
      record.frameScope !== 'top-level' ||
      typeof record.isNavigationRequest !== 'boolean'
    ) {
      continue;
    }
    const contentType = responseMediaType(record.responseHeaders);
    const selection = navigationResponseSelection(record, contentType);
    if (selection === null) continue;
    if ((record.resourceType === 'document') !== record.isNavigationRequest) {
      continue;
    }
    candidates.push({ contentType, record, selection, timing });
  }
  return candidates.sort(
    (left, right) =>
      left.selection.priority - right.selection.priority ||
      left.timing.requestStartEpochMs - right.timing.requestStartEpochMs ||
      left.record.url.localeCompare(right.record.url),
  );
}

function navigationTraceResponseCandidates(
  networkEvents,
  traceEvents,
  { clickTsUs, destinationPaintTsUs, mainFrameId, targetPath },
) {
  const networkRequests = new Map();
  for (const event of networkEvents) {
    const requestId = event?.requestId;
    if (typeof requestId !== 'string' || requestId.length === 0) continue;
    const existing = networkRequests.get(requestId);
    if (existing !== undefined) {
      existing.duplicate = true;
      continue;
    }
    networkRequests.set(requestId, { duplicate: false, event });
  }
  const requests = new Map();
  for (const event of traceEvents) {
    if (!TRACE_RESOURCE_EVENTS.includes(event?.name)) continue;
    const requestId = event.args?.data?.requestId;
    if (typeof requestId !== 'string' || !requestId) continue;
    const entry = requests.get(requestId) ?? {};
    const key =
      event.name === 'ResourceSendRequest'
        ? 'send'
        : event.name === 'ResourceReceiveResponse'
          ? 'response'
          : 'finish';
    if (entry[key] !== undefined) entry.duplicate = true;
    entry[key] = event;
    requests.set(requestId, entry);
  }

  const candidates = [];
  for (const [requestId, events] of requests) {
    const network = networkRequests.get(requestId);
    const networkEvent = network?.event;
    const sendData = events.send?.args?.data;
    const responseData = events.response?.args?.data;
    const finishData = events.finish?.args?.data;
    const resourceTiming = responseData?.timing;
    const requestTime = Number(resourceTiming?.requestTime);
    const sendStartMs = Number(resourceTiming?.sendStart);
    const receiveHeadersEndMs = Number(resourceTiming?.receiveHeadersEnd);
    const requestStartTsUs = (requestTime + sendStartMs / 1_000) * 1_000_000;
    const responseStartTsUs = (requestTime + receiveHeadersEndMs / 1_000) * 1_000_000;
    const responseEndTsUs = Number(finishData?.finishTime) * 1_000_000;
    if (
      !Number.isFinite(events.send?.ts) ||
      !Number.isFinite(events.response?.ts) ||
      !Number.isFinite(requestTime) ||
      !Number.isFinite(sendStartMs) ||
      sendStartMs < 0 ||
      !Number.isFinite(receiveHeadersEndMs) ||
      receiveHeadersEndMs < sendStartMs ||
      !Number.isFinite(requestStartTsUs) ||
      !Number.isFinite(responseStartTsUs) ||
      !Number.isFinite(responseEndTsUs) ||
      events.duplicate === true ||
      network?.duplicate === true ||
      !networkEvent ||
      requestStartTsUs < clickTsUs - 10_000 ||
      events.send.ts < clickTsUs ||
      events.send.ts > destinationPaintTsUs ||
      responseStartTsUs < requestStartTsUs ||
      responseEndTsUs < responseStartTsUs ||
      responseEndTsUs > destinationPaintTsUs ||
      finishData?.didFail !== false ||
      typeof sendData?.url !== 'string' ||
      typeof sendData?.requestMethod !== 'string' ||
      sendData?.frame !== mainFrameId ||
      requestUrlPath(sendData.url) !== targetPath ||
      networkEvent.frameId !== mainFrameId ||
      typeof networkEvent.loaderId !== 'string' ||
      networkEvent.loaderId.length === 0 ||
      networkEvent.request?.url !== sendData.url ||
      networkEvent.request?.method !== sendData.requestMethod ||
      !Number.isInteger(responseData?.statusCode)
    ) {
      continue;
    }
    const contentType = traceResponseMediaType(responseData);
    const recordShape = {
      headers: traceRequestHeaders(sendData),
      resourceType: traceResourceType(sendData),
    };
    const selection = navigationResponseSelection(recordShape, contentType);
    if (selection === null) continue;
    const traceInitiator = traceInitiatorFacts(sendData.initiator);
    const networkInitiator = traceInitiatorFacts(networkEvent.initiator);
    if (
      networkInitiator === null ||
      (traceInitiator === null
        ? recordShape.resourceType !== 'document'
        : traceInitiator.type !== networkInitiator.type)
    ) {
      continue;
    }
    candidates.push({
      contentType,
      httpStatus: responseData.statusCode,
      method: sendData.requestMethod,
      requestId,
      resourceType: recordShape.resourceType,
      selection,
      traceContext: {
        frameId: sendData.frame,
        initiator: networkInitiator,
        loaderId: networkEvent.loaderId,
        scope: 'top-level-frame',
        source: 'Network.requestWillBeSent+ResourceSendRequest',
        targetPath,
      },
      timing: {
        requestStartTsUs,
        responseEndTsUs,
        responseStartTsUs,
      },
      url: sendData.url,
    });
  }
  return candidates.sort(
    (left, right) =>
      left.selection.priority - right.selection.priority ||
      left.timing.requestStartTsUs - right.timing.requestStartTsUs ||
      left.url.localeCompare(right.url) ||
      left.requestId.localeCompare(right.requestId),
  );
}

function traceInitiatorFacts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = value.type;
  const fetchType = value.fetchType ?? null;
  if (
    typeof type !== 'string' ||
    type.length === 0 ||
    type.length > 64 ||
    (fetchType !== null &&
      (typeof fetchType !== 'string' || fetchType.length === 0 || fetchType.length > 64))
  ) {
    return null;
  }
  return { fetchType, type };
}

function validTargetPath(value) {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.includes('?') &&
    !value.includes('#') &&
    requestUrlPath(`http://kovo.invalid${value}`) === value
  );
}

function requestUrlPath(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function requestTimingEpochs(timing) {
  if (
    !timing ||
    !Number.isFinite(timing.startTime) ||
    !Number.isFinite(timing.requestStart) ||
    !Number.isFinite(timing.responseStart) ||
    !Number.isFinite(timing.responseEnd) ||
    timing.requestStart < 0 ||
    timing.responseStart < timing.requestStart ||
    timing.responseEnd < timing.responseStart
  ) {
    return null;
  }
  return {
    requestStartEpochMs: timing.startTime + timing.requestStart,
    responseEndEpochMs: timing.startTime + timing.responseEnd,
    responseStartEpochMs: timing.startTime + timing.responseStart,
    source: 'playwright-request-timing',
  };
}

function navigationResponseSelection(record, contentType) {
  if (contentType === 'application/vnd.kovo.document-parts+json') {
    return { name: 'kovo-document-parts-media-type', priority: 0 };
  }
  if (contentType === 'text/x-component') {
    return { name: 'react-server-component-media-type', priority: 1 };
  }
  if (record.resourceType === 'document') {
    return { name: 'document-resource', priority: 2 };
  }
  const accept = String(headerValue(record.headers, 'accept') ?? '').toLowerCase();
  if (
    (record.resourceType === 'fetch' || record.resourceType === 'xhr') &&
    (contentType === 'text/html' ||
      contentType === 'application/json' ||
      accept.includes('text/x-component') ||
      accept.includes('application/vnd.kovo.document-parts+json'))
  ) {
    return { name: 'navigation-data-request', priority: 3 };
  }
  return null;
}

function responseMediaType(headers) {
  const value = headerValue(headers, 'content-type');
  if (typeof value !== 'string') return '';
  return value.split(';', 1)[0].trim().toLowerCase();
}

function headerValue(headers, expected) {
  if (!headers || typeof headers !== 'object') return undefined;
  if (Array.isArray(headers)) {
    const found = headers.find(
      (header) =>
        typeof header?.name === 'string' && header.name.toLowerCase() === expected.toLowerCase(),
    );
    return found?.value;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === expected.toLowerCase()) return value;
  }
  return undefined;
}

function traceRequestHeaders(data) {
  return data?.requestHeaders ?? data?.headers ?? {};
}

function traceResourceType(data) {
  const resourceType = String(data?.resourceType ?? '').toLowerCase();
  if (resourceType === 'document') return 'document';
  if (resourceType === 'xhr') return 'xhr';
  if (resourceType === 'fetch' || data?.initiator?.fetchType === 'fetch') return 'fetch';
  return resourceType || 'other';
}

function traceResponseMediaType(data) {
  const fromHeader = responseMediaType(data?.headers);
  if (fromHeader) return fromHeader;
  return typeof data?.mimeType === 'string'
    ? data.mimeType.split(';', 1)[0].trim().toLowerCase()
    : '';
}

function traceNetworkClockSkew(recordTiming, traceTiming, epochOffsetMs) {
  const deltas = [
    [recordTiming.requestStartEpochMs, traceTiming.requestStartTsUs],
    [recordTiming.responseStartEpochMs, traceTiming.responseStartTsUs],
    [recordTiming.responseEndEpochMs, traceTiming.responseEndTsUs],
  ].map(([epochMs, timestampUs]) => Math.abs(epochMs - traceEpochMs(timestampUs, epochOffsetMs)));
  return { maxAbsoluteSkewMs: Math.max(...deltas) };
}

function traceActivity(events, { endTsUs, names, startTsUs }) {
  const intervals = [];
  const census = {};
  let eventCount = 0;
  for (const event of events) {
    if (!names.includes(event?.name) || !Number.isFinite(event?.ts)) continue;
    const durationUs = Number.isFinite(event.dur) && event.dur >= 0 ? event.dur : 0;
    const eventEndTsUs = event.ts + durationUs;
    if (event.ts > endTsUs || eventEndTsUs < startTsUs) continue;
    eventCount += 1;
    census[event.name] = (census[event.name] ?? 0) + 1;
    intervals.push([Math.max(startTsUs, event.ts), Math.min(endTsUs, eventEndTsUs)]);
  }
  return {
    durationMs: intervalUnionDurationUs(intervals) / 1_000,
    eventCount,
    eventNames: Object.keys(census).sort(),
    intervals,
  };
}

function traceEventCensus(events, names) {
  const census = Object.fromEntries([...new Set(names)].sort().map((name) => [name, 0]));
  for (const event of events) {
    if (Object.hasOwn(census, event?.name)) census[event.name] += 1;
  }
  return Object.fromEntries(Object.entries(census).map(([name, count]) => [name, String(count)]));
}

function intervalUnionDurationUs(intervals) {
  const sorted = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let total = 0;
  let currentStart = null;
  let currentEnd = null;
  for (const [start, end] of sorted) {
    if (currentStart === null) {
      currentStart = start;
      currentEnd = end;
    } else if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }
  return currentStart === null ? 0 : total + currentEnd - currentStart;
}

function observedPhase(durationMs, source, extra = {}) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new TypeError(`Observed navigation phase duration is invalid: ${String(durationMs)}.`);
  }
  return { durationMs, source, status: 'observed', ...extra };
}

function observedTracePhase(activity) {
  return observedPhase(activity.durationMs, 'chromium-devtools-timeline', {
    eventCount: String(activity.eventCount),
    eventNames: activity.eventNames,
  });
}

function unsupportedPhase(reason) {
  return { durationMs: null, reason, status: 'unsupported' };
}

function validPrimaryResponse(response) {
  if (!response || !['observed', 'unsupported'].includes(response.status)) return false;
  if (response.status === 'unsupported') {
    return response.durationMs === null && typeof response.reason === 'string' && !!response.reason;
  }
  const timing = response.timing;
  const networkWitness = response.networkWitness;
  const traceContext = response.traceContext;
  const { identity, status: _status, ...responseIdentityFacts } = response;
  const witnessFacts = networkWitness?.facts;
  return (
    safeIntegerText(response.candidateCount, { min: 1 }) &&
    identity === sha256Canonical(responseIdentityFacts) &&
    typeof response.url === 'string' &&
    typeof response.method === 'string' &&
    typeof response.resourceType === 'string' &&
    typeof response.selection === 'string' &&
    typeof response.traceRequestId === 'string' &&
    response.traceRequestId.length > 0 &&
    safeIntegerText(response.httpStatus, { max: 599, min: 100 }) &&
    timing?.clock === 'chromium-monotonic-trace' &&
    timing?.source ===
      'ResourceSendRequest+ResourceReceiveResponse.args.data.timing/' +
        'ResourceFinish.args.data.finishTime' &&
    finiteNumberText(timing.requestStartTsUs) &&
    finiteNumberText(timing.responseStartTsUs) &&
    finiteNumberText(timing.responseEndTsUs) &&
    Number(timing.requestStartTsUs) <= Number(timing.responseStartTsUs) &&
    Number(timing.responseStartTsUs) <= Number(timing.responseEndTsUs) &&
    traceContext?.scope === 'top-level-frame' &&
    traceContext?.source === 'Network.requestWillBeSent+ResourceSendRequest' &&
    typeof traceContext?.frameId === 'string' &&
    traceContext.frameId.length > 0 &&
    typeof traceContext?.loaderId === 'string' &&
    traceContext.loaderId.length > 0 &&
    validTargetPath(traceContext?.targetPath) &&
    requestUrlPath(response.url) === traceContext.targetPath &&
    traceInitiatorFacts(traceContext?.initiator) !== null &&
    safeIntegerText(networkWitness?.candidateCount, { min: 1 }) &&
    witnessFacts !== null &&
    typeof witnessFacts === 'object' &&
    !Array.isArray(witnessFacts) &&
    networkWitness?.identity === sha256Canonical(witnessFacts) &&
    networkWitness?.source === 'playwright-request-timing' &&
    networkWitness?.toleranceMs === String(TRACE_NETWORK_CLOCK_TOLERANCE_MS) &&
    finiteNumberText(networkWitness?.maxAbsoluteSkewMs) &&
    Number(networkWitness.maxAbsoluteSkewMs) >= 0 &&
    Number(networkWitness.maxAbsoluteSkewMs) <= TRACE_NETWORK_CLOCK_TOLERANCE_MS &&
    validPlaywrightResponseWitness(witnessFacts, response)
  );
}

function validPlaywrightResponseWitness(facts, response) {
  const timing = facts?.timing;
  return (
    facts?.url === response.url &&
    facts?.method === response.method &&
    facts?.httpStatus === response.httpStatus &&
    facts?.contentType === response.contentType &&
    facts?.resourceType === response.resourceType &&
    facts?.frameScope === 'top-level' &&
    typeof facts?.isNavigationRequest === 'boolean' &&
    (facts.resourceType === 'document') === facts.isNavigationRequest &&
    timing?.source === 'playwright-request-timing' &&
    finiteNumberText(timing.requestStartEpochMs) &&
    finiteNumberText(timing.responseStartEpochMs) &&
    finiteNumberText(timing.responseEndEpochMs) &&
    Number(timing.requestStartEpochMs) <= Number(timing.responseStartEpochMs) &&
    Number(timing.responseStartEpochMs) <= Number(timing.responseEndEpochMs)
  );
}

function validAttributionPhase(phase) {
  if (!phase || !['observed', 'unsupported'].includes(phase.status)) return false;
  return phase.status === 'observed'
    ? Number.isFinite(phase.durationMs) && phase.durationMs >= 0 && typeof phase.source === 'string'
    : phase.durationMs === null && typeof phase.reason === 'string' && !!phase.reason;
}

function validResponseProcessingDomApplyPhase(phase) {
  if (!validAttributionPhase(phase) || phase.status === 'unsupported') return true;
  return (
    phase.source === 'chromium-monotonic-trace:response-headers-to-destination-marker' &&
    phase.scope === 'primary-response-headers-to-destination-marker' &&
    JSON.stringify(phase.includes) ===
      JSON.stringify([
        'response-transfer-and-stream-consumption',
        'response-read-decode',
        'document-build-or-morph',
        'main-thread-queueing',
      ])
  );
}

function validTraceEventCensus(census) {
  if (!census || typeof census !== 'object' || Array.isArray(census)) return false;
  const expectedNames = [
    ...new Set([
      ...TRACE_RESOURCE_EVENTS,
      ...TRACE_PHASE_EVENTS.documentConstruction,
      ...TRACE_PHASE_EVENTS.style,
      ...TRACE_PHASE_EVENTS.layout,
      ...TRACE_PHASE_EVENTS.paint,
    ]),
  ].sort();
  if (JSON.stringify(Object.keys(census)) !== JSON.stringify(expectedNames)) return false;
  return Object.values(census).every((value) => safeIntegerText(value));
}

function finiteNumberText(value) {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value !== '' &&
    Number.isFinite(Number(value))
  );
}

function safeIntegerText(value, { max = Number.MAX_SAFE_INTEGER, min = 0 } = {}) {
  if (!finiteNumberText(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max && String(number) === value;
}

function navigationAttributionDigest(facts) {
  return sha256Canonical(facts);
}

function sha256Canonical(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function traceEpochMs(timestampUs, epochOffsetMs) {
  return timestampUs / 1_000 + epochOffsetMs;
}

function traceTimestampUs(epochMs, epochOffsetMs) {
  return (epochMs - epochOffsetMs) * 1_000;
}

export function sessionBytePhases(
  records,
  { clickEpochMs, destinationPaintEpochMs, initialEndEpochMs = clickEpochMs },
) {
  const phases = {
    automaticPrefetch: emptyByteBucket(),
    click: emptyByteBucket(),
    initial: emptyByteBucket(),
    preClickBackground: emptyByteBucket(),
    postClick: emptyByteBucket(),
  };
  for (const record of records) {
    const explicitPrefetch = isPrefetchRequest(record.headers);
    // Only transport evidence may call traffic prefetch. Deferred runtimes, fonts, analytics, and
    // other requests can also start after load but before the click; folding those into prefetch
    // would manufacture a framework comparison from timing alone.
    const phase =
      record.startedEpochMs < clickEpochMs
        ? explicitPrefetch
          ? 'automaticPrefetch'
          : record.startedEpochMs < initialEndEpochMs
            ? 'initial'
            : 'preClickBackground'
        : record.startedEpochMs <= destinationPaintEpochMs
          ? 'click'
          : 'postClick';
    addRequestBytes(phases[phase], record);
  }
  phases.throughDestinationPaint = sumByteBuckets(
    phases.initial,
    phases.automaticPrefetch,
    phases.preClickBackground,
    phases.click,
  );
  phases.throughClick = sumByteBuckets(
    phases.initial,
    phases.automaticPrefetch,
    phases.preClickBackground,
  );
  phases.settledSession = sumByteBuckets(phases.throughDestinationPaint, phases.postClick);
  return phases;
}

function isPrefetchRequest(headers = {}) {
  return ['purpose', 'sec-purpose', 'next-router-prefetch'].some((name) => {
    const value = headers[name];
    return (
      value === '1' ||
      String(value ?? '')
        .toLowerCase()
        .includes('prefetch')
    );
  });
}

function emptyByteBucket() {
  return { css: 0, html: 0, img: 0, js: 0, other: 0, requests: 0, total: 0 };
}

function addRequestBytes(bucket, request) {
  const key =
    request.resourceType === 'document'
      ? 'html'
      : request.resourceType === 'script'
        ? 'js'
        : request.resourceType === 'stylesheet'
          ? 'css'
          : request.resourceType === 'image'
            ? 'img'
            : 'other';
  bucket[key] += request.bytes;
  bucket.total += request.bytes;
  bucket.requests += 1;
}

function sumByteBuckets(...buckets) {
  const total = emptyByteBucket();
  for (const bucket of buckets) {
    for (const key of Object.keys(total)) total[key] += bucket[key] ?? 0;
  }
  return total;
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

async function fixtureIntegrity(page, { expectedFramework, expectedLane }) {
  return page.evaluate(
    ({ expectedFramework, expectedLane }) => {
      const lane =
        document.querySelector('[data-benchmark-lane]')?.getAttribute('data-benchmark-lane') ??
        'default';
      const cards = document.querySelectorAll('main .card').length;
      const linkedStyles = document.querySelectorAll('link[rel="stylesheet"]').length;
      const scripts = document.scripts.length;
      const cartControl = document.querySelector('button[aria-label^="Open cart"]');
      const expectsScripts = expectedFramework !== 'kovo' || expectedLane === 'matched-l1';
      return {
        fixtureBootstrapValid: Number(expectsScripts ? scripts > 0 : scripts === 0),
        fixtureContentValid: Number(cards === 24),
        fixtureControlsValid: Number(cartControl !== null),
        fixtureCssValid: Number(linkedStyles > 0),
        fixtureLaneValid: Number(lane === expectedLane),
        fixtureScriptCount: scripts,
      };
    },
    { expectedFramework, expectedLane },
  );
}
