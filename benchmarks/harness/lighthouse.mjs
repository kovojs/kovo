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
      for (let index = 0; index < repeats; index += 1) {
        const result = await lighthouse(`${origin}${run.path}`, flags).catch(() => undefined);
        samples.push(extractMetrics(result?.lhr));
      }
      results.push({
        formFactor: run.formFactor,
        metrics: aggregate(samples, (values) => percentile(values, 50)),
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
