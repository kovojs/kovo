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

export function percentile(values, pct) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index];
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
      median: percentile(values, 50),
      min: values.length === 0 ? null : Math.min(...values),
      p75: percentile(values, 75),
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

export async function runScenarios({ app, conditionName, iterations, origin }) {
  const browser = await chromium.launch({ headless: true });
  const condition = CONDITIONS[conditionName];
  if (!condition) throw new Error(`Unknown benchmark condition ${conditionName}.`);

  try {
    const coldLoad = [];
    const ttiProbe = [];
    const navigation = [];

    for (let index = 0; index < iterations; index += 1) {
      coldLoad.push(await withPage(browser, condition, (page, tracker) => coldLoadScenario(page, tracker, origin)));
      ttiProbe.push(await withPage(browser, condition, (page, tracker) => ttiScenario(page, tracker, origin)));
      navigation.push(
        await withPage(browser, condition, (page, tracker) => navigationScenario(page, tracker, origin)),
      );
    }

    return {
      coldLoad: { iterations: coldLoad, summary: summarizeIterations(coldLoad) },
      navigation: { iterations: navigation, summary: summarizeIterations(navigation) },
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

  try {
    return await run(page, tracker);
  } finally {
    await context.close();
  }
}

function createRequestTracker(page) {
  const requests = [];
  page.on('requestfinished', (request) => {
    requests.push(
      request
        .sizes()
        .then((sizes) => ({
          bytes: sizes.responseBodySize + sizes.responseHeadersSize,
          resourceType: request.resourceType(),
          url: request.url(),
        }))
        .catch(() => null),
    );
  });

  return {
    async collect() {
      const finished = (await Promise.all(requests)).filter(Boolean);
      const buckets = { css: 0, html: 0, img: 0, js: 0, other: 0, total: 0 };
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
      }
      return { bytes: buckets, requests: finished.length };
    },
  };
}

async function coldLoadScenario(page, tracker, origin) {
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  await page.waitForTimeout(150);
  const perf = await performanceMetrics(page);
  const network = await tracker.collect();
  return { ...perf, ...network };
}

async function ttiScenario(page, tracker, origin) {
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
  const perf = await performanceMetrics(page);
  const network = await tracker.collect();
  return { ...perf, checkoutConfirmed: 1, ...tti, ...network };
}

async function navigationScenario(page, tracker, origin) {
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  await page.evaluate(() => performance.mark('bench-nav-start'));
  const firstProduct = page.locator('a[aria-label^="View "]').first();
  await firstProduct.click();
  await page.waitForSelector('main h1');
  const navMs = await page.evaluate(() => {
    performance.mark('bench-nav-end');
    const measure = performance.measure('bench-nav', 'bench-nav-start', 'bench-nav-end');
    return measure.duration;
  });
  const network = await tracker.collect();
  return { navToDetailMs: navMs, ...network };
}

async function performanceMetrics(page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const longTasks = window.__kovoBenchLongTasks ?? [];
    const tbt = longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0);
    return {
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      fcpMs: fcp?.startTime ?? null,
      lcpMs: window.__kovoBenchLcp ?? null,
      loadMs: navigation?.loadEventEnd ?? null,
      tbtMs: tbt,
    };
  });
}
