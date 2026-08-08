import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';

import { percentile } from './scenarios.mjs';

const RUNS = [
  { formFactor: 'desktop', path: '/' },
  { formFactor: 'desktop', path: '/product/linen-field-jacket' },
  { formFactor: 'mobile', path: '/' },
  { formFactor: 'mobile', path: '/product/linen-field-jacket' },
];

const METRIC_KEYS = [
  'bytes',
  'fcpMs',
  'lcpMs',
  'performanceScore',
  'speedIndexMs',
  'tbtMs',
  'ttiMs',
];

/** Default repeat count per cell. A single sample is not reportable (plans/good-perf.md O15). */
export const DEFAULT_LIGHTHOUSE_REPEATS = 3;

/**
 * Runs each Lighthouse cell `repeats` times and reports the median plus the observed spread.
 *
 * plans/good-perf.md O15: the previous harness ran each cell exactly once. One recorded cell
 * returned null for every metric, and a 3-run probe of the same URL returned performance scores
 * 0.69 / 0.88 / 0.87 — a 19-point spread that a single sample cannot expose. `metrics` keeps the
 * original key names (now medians) so downstream readers do not silently switch meaning; `spread`
 * and `nullSamples` are additive and make an unreportable cell visible instead of plausible.
 */
export async function runLighthouse(origin, { repeats = DEFAULT_LIGHTHOUSE_REPEATS } = {}) {
  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new Error(`Lighthouse repeats must be a positive integer, got ${repeats}.`);
  }
  const chrome = await launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });

  try {
    const results = [];
    for (const run of RUNS) {
      const flags = {
        formFactor: run.formFactor,
        logLevel: 'error',
        onlyCategories: ['performance'],
        output: 'json',
        port: chrome.port,
        screenEmulation:
          run.formFactor === 'desktop'
            ? { disabled: false, deviceScaleFactor: 1, height: 940, mobile: false, width: 1350 }
            : undefined,
      };
      const samples = [];
      const networkSamples = [];
      for (let index = 0; index < repeats; index += 1) {
        const result = await lighthouse(`${origin}${run.path}`, flags).catch(() => undefined);
        samples.push(extractMetrics(result?.lhr));
        networkSamples.push(extractNetworkStatuses(result?.lhr));
      }
      results.push({
        formFactor: run.formFactor,
        metrics: aggregate(samples, (values) => percentile(values, 50)),
        // Lighthouse drives 4 cells x `repeats` page loads of its own, and that traffic used to be
        // invisible to the run's integrity gate: a Lighthouse cell could be entirely shaped by 429
        // load shedding and still be published. See `extractNetworkStatuses`.
        network: mergeNetwork(networkSamples),
        nullSamples: countNullSamples(samples),
        path: run.path,
        repeats,
        samples,
        spread: aggregate(samples, (values) =>
          values.length === 0 ? null : Math.max(...values) - Math.min(...values),
        ),
      });
    }
    return results;
  } finally {
    await chrome.kill();
  }
}

function aggregate(samples, reduce) {
  const output = {};
  for (const key of METRIC_KEYS) {
    const values = samples
      .map((sample) => sample[key])
      .filter((value) => typeof value === 'number' && Number.isFinite(value));
    output[key] = reduce(values);
  }
  return output;
}

function countNullSamples(samples) {
  const output = {};
  for (const key of METRIC_KEYS) {
    output[key] = samples.filter(
      (sample) => typeof sample[key] !== 'number' || !Number.isFinite(sample[key]),
    ).length;
  }
  return output;
}

/**
 * Per-request HTTP statuses for one Lighthouse sample, from the `network-requests` diagnostic
 * audit.
 *
 * That audit is part of the performance category's `auditRefs`, so it is collected under
 * `onlyCategories: ['performance']` — verified against the installed lighthouse default config
 * rather than assumed. When it is missing (a sample that threw, or a future config that drops it)
 * this returns `tracked: false` so the integrity gate can say "not measured" instead of "clean":
 * an untracked probe must never be reported as a passing one.
 */
function extractNetworkStatuses(lhr) {
  const items = lhr?.audits?.['network-requests']?.details?.items;
  if (!Array.isArray(items)) {
    return {
      errorResponses: 0,
      faviconMisses: 0,
      rateLimitedResponses: 0,
      requests: 0,
      tracked: false,
    };
  }
  let errorResponses = 0;
  let faviconMisses = 0;
  let rateLimitedResponses = 0;
  for (const item of items) {
    const status = typeof item?.statusCode === 'number' ? item.statusCode : 0;
    if (status === 429) rateLimitedResponses += 1;
    else if (status === 404 && isFaviconProbe(item.url)) faviconMisses += 1;
    else if (status >= 400) errorResponses += 1;
  }
  return {
    errorResponses,
    faviconMisses,
    rateLimitedResponses,
    requests: items.length,
    tracked: true,
  };
}

/**
 * A missing `/favicon.ico` is counted separately, not as a server error.
 *
 * The browser asks for it on its own; no entrant's document references it and none of them ship
 * one. Lighthouse drives full headless Chrome, which makes that request, while the custom
 * scenarios drive Playwright's `chrome-headless-shell`, which does not — so counting it as an
 * error would reject every run on a difference between two BROWSER BUILDS rather than anything
 * about the entrants. Measured on this harness: 1 of 8 requests on the Kovo desktop `/` cell.
 *
 * Deliberately narrow. Only 404 is exempt: a 429 or a 5xx on the same URL still means the server
 * shed or failed, and still rejects the run. The count is reported so it is visible, not dropped.
 */
function isFaviconProbe(url) {
  try {
    return new URL(url).pathname === '/favicon.ico';
  } catch {
    return false;
  }
}

function mergeNetwork(networkSamples) {
  return {
    errorResponses: networkSamples.reduce((sum, sample) => sum + sample.errorResponses, 0),
    faviconMisses: networkSamples.reduce((sum, sample) => sum + sample.faviconMisses, 0),
    rateLimitedResponses: networkSamples.reduce(
      (sum, sample) => sum + sample.rateLimitedResponses,
      0,
    ),
    requests: networkSamples.reduce((sum, sample) => sum + sample.requests, 0),
    // Every sample must have been observable for the cell to count as tracked.
    tracked: networkSamples.length > 0 && networkSamples.every((sample) => sample.tracked),
    untrackedSamples: networkSamples.filter((sample) => !sample.tracked).length,
  };
}

function extractMetrics(lhr) {
  const audits = lhr?.audits ?? {};
  return {
    bytes: audits['total-byte-weight']?.numericValue ?? null,
    fcpMs: audits['first-contentful-paint']?.numericValue ?? null,
    lcpMs: audits['largest-contentful-paint']?.numericValue ?? null,
    performanceScore: lhr?.categories?.performance?.score ?? null,
    speedIndexMs: audits['speed-index']?.numericValue ?? null,
    tbtMs: audits['total-blocking-time']?.numericValue ?? null,
    ttiMs: audits.interactive?.numericValue ?? null,
  };
}
