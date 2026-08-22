import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import { chromium } from 'playwright';

import { percentile } from './scenarios.mjs';
import {
  LIGHTHOUSE_AUDIT_IDS,
  LIGHTHOUSE_BROWSER_IDENTITY_SCHEMA,
  LIGHTHOUSE_METRIC_KEYS,
  LIGHTHOUSE_SAMPLE_FAILURE_SCHEMA,
  lighthouseTimeoutPolicy,
} from './lighthouse-policy.mjs';

const execFileAsync = promisify(execFile);
const BROWSER_VERSION_TIMEOUT_MS = 10_000;
const MAX_BROWSER_VERSION_BYTES = 8 * 1024;
const LIGHTHOUSE_INVOCATION_TIMEOUT_CODE = 'KOVO_LIGHTHOUSE_INVOCATION_TIMEOUT';

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
export async function runLighthouse(
  origin,
  { listingPath = '/', repeats = DEFAULT_LIGHTHOUSE_REPEATS } = {},
  dependencies = {},
) {
  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new Error(`Lighthouse repeats must be a positive integer, got ${repeats}.`);
  }
  const browserType = dependencies.browserType ?? chromium;
  const authenticateBrowser =
    dependencies.authenticateBrowser ?? authenticateLighthouseBrowserExecutable;
  const selectedExecutable = browserType.executablePath();
  const authenticated = await authenticateBrowser(selectedExecutable);
  const browserIdentity = authenticated.identity;
  const timeoutPolicy = lighthouseTimeoutPolicy();
  const launchChrome = dependencies.launchChrome ?? launch;
  const lighthouseRunner = dependencies.lighthouseRunner ?? lighthouse;
  const invocationTimeoutMs = dependencies.invocationTimeoutMs ?? timeoutPolicy.invocationTimeoutMs;
  const writeIdentity = dependencies.writeIdentity ?? ((line) => process.stdout.write(line));
  writeIdentity(`${lighthouseBrowserIdentityLine(browserIdentity)}\n`);

  const chrome = await launchChrome({
    // `chrome-launcher` otherwise discovers an ambient system browser. The workflow installs the
    // Playwright binary declared by benchmarks/harness/pnpm-lock.yaml, so launch exactly that path.
    chromePath: authenticated.executablePath,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });
  let killPromise = null;
  const killChrome = () => {
    killPromise ??= Promise.resolve()
      .then(() => chrome.kill())
      .catch(() => undefined);
    return killPromise;
  };

  try {
    const productPath = `${listingPath === '/' ? '' : listingPath}/product/linen-field-jacket`;
    const runs = [
      { formFactor: 'desktop', path: listingPath },
      { formFactor: 'desktop', path: productPath },
      { formFactor: 'mobile', path: listingPath },
      { formFactor: 'mobile', path: productPath },
    ];
    const results = [];
    let abortedAfterTimeout = false;
    for (const run of runs) {
      const flags = {
        formFactor: run.formFactor,
        logLevel: 'error',
        maxWaitForFcp: timeoutPolicy.maxWaitForFcpMs,
        maxWaitForLoad: timeoutPolicy.maxWaitForLoadMs,
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
      const failures = [];
      for (let index = 0; index < repeats; index += 1) {
        if (abortedAfterTimeout) {
          samples.push(emptyMetrics());
          networkSamples.push(extractNetworkStatuses(undefined));
          failures.push(
            sampleFailure({
              message: 'not attempted after a prior Lighthouse invocation exceeded its deadline',
              sampleIndex: index,
              scope: 'invocation',
            }),
          );
          continue;
        }
        let result;
        try {
          result = await withTimeout(
            () => lighthouseRunner(`${origin}${run.path}`, flags),
            invocationTimeoutMs,
            {
              clearTimer: dependencies.clearTimer,
              onTimeout: () => {
                void killChrome();
              },
              setTimer: dependencies.setTimer,
            },
          );
        } catch (error) {
          const message = boundedDiagnostic(error, [authenticated.executablePath]);
          samples.push(emptyMetrics());
          networkSamples.push(extractNetworkStatuses(undefined));
          failures.push(sampleFailure({ message, sampleIndex: index, scope: 'invocation' }));
          if (error?.code === LIGHTHOUSE_INVOCATION_TIMEOUT_CODE) abortedAfterTimeout = true;
          continue;
        }
        if (!result?.lhr) {
          samples.push(emptyMetrics());
          networkSamples.push(extractNetworkStatuses(undefined));
          failures.push(
            sampleFailure({
              message: 'Lighthouse returned no runner result',
              sampleIndex: index,
              scope: 'invocation',
            }),
          );
          continue;
        }
        const sample = extractMetrics(result.lhr);
        samples.push(sample);
        networkSamples.push(extractNetworkStatuses(result.lhr));
        failures.push(...metricFailures(result.lhr, sample, index));
      }
      results.push({
        browser: browserIdentity,
        failures,
        formFactor: run.formFactor,
        metrics: aggregate(samples, (values) => percentile(values, 50)),
        // Lighthouse drives 4 cells x `repeats` page loads of its own, and that traffic used to be
        // invisible to the run's integrity gate: a Lighthouse cell could be entirely shaped by 429
        // load shedding and still be published. See `extractNetworkStatuses`.
        network: mergeNetwork(networkSamples),
        nullSamples: countNullSamples(samples),
        path: run.path,
        policy: timeoutPolicy,
        repeats,
        samples,
        spread: aggregate(samples, (values) =>
          values.length === 0 ? null : Math.max(...values) - Math.min(...values),
        ),
      });
    }
    return results;
  } finally {
    await killChrome();
  }
}

export async function authenticateLighthouseBrowserExecutable(executablePath) {
  const resolvedPath = await realpath(executablePath);
  const executableStat = await stat(resolvedPath);
  if (!executableStat.isFile() || executableStat.size <= 0) {
    throw new Error('Playwright Chromium executable is absent or is not a regular file.');
  }
  const { stdout } = await execFileAsync(resolvedPath, ['--version'], {
    encoding: 'utf8',
    maxBuffer: MAX_BROWSER_VERSION_BYTES,
    timeout: BROWSER_VERSION_TIMEOUT_MS,
  });
  const version = String(stdout).match(/\b\d+\.\d+\.\d+\.\d+\b/u)?.[0];
  if (!version) throw new Error('Playwright Chromium did not report a four-part browser version.');
  return {
    executablePath: resolvedPath,
    identity: {
      executable: {
        basename: path.basename(resolvedPath),
        bytes: executableStat.size,
        // This digest authenticates which resolved path Playwright selected without serializing a
        // host path. It is not an executable-byte digest; provider, size, and observed version are
        // recorded alongside it, while the pinned harness lock owns installation provenance.
        pathSha256: sha256(resolvedPath),
      },
      provider: 'playwright.chromium',
      schema: LIGHTHOUSE_BROWSER_IDENTITY_SCHEMA,
      version,
    },
  };
}

export function lighthouseBrowserIdentityLine(identity) {
  return [
    LIGHTHOUSE_BROWSER_IDENTITY_SCHEMA,
    `provider=${identity.provider}`,
    `version=${identity.version}`,
    `executable=${JSON.stringify(identity.executable.basename)}`,
    `executable-bytes=${String(identity.executable.bytes)}`,
    `path-sha256=${identity.executable.pathSha256}`,
  ].join(' ');
}

function withTimeout(operation, timeoutMs, dependencies = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Lighthouse invocation timeout must be a positive safe integer.');
  }
  const schedule = dependencies.setTimer ?? setTimeout;
  const cancel = dependencies.clearTimer ?? clearTimeout;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cancel(timer);
      callback(value);
    };
    timer = schedule(() => {
      dependencies.onTimeout?.();
      const error = new Error(`Lighthouse invocation exceeded its ${String(timeoutMs)}ms deadline`);
      error.code = LIGHTHOUSE_INVOCATION_TIMEOUT_CODE;
      finish(reject, error);
    }, timeoutMs);
    timer?.unref?.();
    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
  });
}

function aggregate(samples, reduce) {
  const output = {};
  for (const key of LIGHTHOUSE_METRIC_KEYS) {
    const values = samples
      .map((sample) => sample[key])
      .filter((value) => typeof value === 'number' && Number.isFinite(value));
    output[key] = reduce(values);
  }
  return output;
}

function countNullSamples(samples) {
  const output = {};
  for (const key of LIGHTHOUSE_METRIC_KEYS) {
    output[key] = samples.filter(
      (sample) => typeof sample[key] !== 'number' || !Number.isFinite(sample[key]),
    ).length;
  }
  return output;
}

function metricFailures(lhr, sample, sampleIndex) {
  const failures = [];
  for (const metric of LIGHTHOUSE_METRIC_KEYS) {
    if (Number.isFinite(sample[metric])) continue;
    if (metric === 'performanceScore') {
      failures.push(
        sampleFailure({
          message: boundedDiagnostic(
            lhr?.runtimeError?.message ?? 'performance category score is absent',
          ),
          metric,
          sampleIndex,
          scope: 'metric',
        }),
      );
      continue;
    }
    const auditId = LIGHTHOUSE_AUDIT_IDS[metric];
    const audit = lhr?.audits?.[auditId];
    failures.push(
      sampleFailure({
        message: boundedDiagnostic(
          `${auditId}: ${audit?.errorMessage ?? 'numericValue is absent'}`,
        ),
        metric,
        sampleIndex,
        scope: 'metric',
      }),
    );
  }
  return failures;
}

function sampleFailure({ message, metric = null, sampleIndex, scope }) {
  return {
    message: boundedDiagnostic(message),
    metric,
    sampleIndex,
    schema: LIGHTHOUSE_SAMPLE_FAILURE_SCHEMA,
    scope,
  };
}

function boundedDiagnostic(error, redactions = []) {
  let value = error instanceof Error ? error.message : String(error);
  for (const redaction of redactions) {
    if (redaction) value = value.split(redaction).join('<playwright-chromium>');
  }
  return value.replace(/[\r\n\0]+/gu, ' ').slice(0, 512) || '<empty>';
}

function emptyMetrics() {
  return Object.fromEntries(LIGHTHOUSE_METRIC_KEYS.map((key) => [key, null]));
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
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
