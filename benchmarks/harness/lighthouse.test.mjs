import { describe, expect, it } from 'vitest';

import { runLighthouse } from './lighthouse.mjs';
import {
  LIGHTHOUSE_BROWSER_IDENTITY_SCHEMA,
  LIGHTHOUSE_INVOCATION_TIMEOUT_MS,
  LIGHTHOUSE_MAX_WAIT_FOR_FCP_MS,
  LIGHTHOUSE_MAX_WAIT_FOR_LOAD_MS,
  LIGHTHOUSE_SAMPLE_FAILURE_SCHEMA,
  lighthouseInvocationPhaseMaximumMs,
  lighthouseTimeoutPolicy,
} from './lighthouse-policy.mjs';

const browserIdentity = {
  executable: {
    basename: 'chrome',
    bytes: 123_456,
    pathSha256: `sha256:${'a'.repeat(64)}`,
  },
  provider: 'playwright.chromium',
  schema: LIGHTHOUSE_BROWSER_IDENTITY_SCHEMA,
  version: '148.0.7778.96',
};

describe('pinned Lighthouse browser policy', () => {
  it('launches the authenticated Playwright executable and records its exact identity and policy', async () => {
    const launches = [];
    const invocations = [];
    const identityLines = [];
    let kills = 0;
    const results = await runLighthouse(
      'http://localhost:4310',
      { repeats: 1 },
      fakeDependencies({
        launchChrome: async (options) => {
          launches.push(options);
          return { kill: async () => (kills += 1), port: 9_222 };
        },
        lighthouseRunner: async (url, flags) => {
          invocations.push({ flags, url });
          return { lhr: cleanLhr() };
        },
        writeIdentity: (line) => identityLines.push(line),
      }),
    );

    expect(launches).toEqual([
      {
        chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
        chromePath: '/resolved/playwright/chrome',
      },
    ]);
    expect(invocations).toHaveLength(4);
    expect(invocations.every(({ flags }) => flags.port === 9_222)).toBe(true);
    expect(
      invocations.every(({ flags }) => flags.maxWaitForFcp === LIGHTHOUSE_MAX_WAIT_FOR_FCP_MS),
    ).toBe(true);
    expect(
      invocations.every(({ flags }) => flags.maxWaitForLoad === LIGHTHOUSE_MAX_WAIT_FOR_LOAD_MS),
    ).toBe(true);
    expect(results).toHaveLength(4);
    expect(
      results.every((cell) => JSON.stringify(cell.browser) === JSON.stringify(browserIdentity)),
    ).toBe(true);
    expect(
      results.every(
        (cell) =>
          JSON.stringify(cell.policy) === JSON.stringify(lighthouseTimeoutPolicy()) &&
          cell.failures.length === 0,
      ),
    ).toBe(true);
    expect(identityLines).toEqual([
      expect.stringContaining(
        `${LIGHTHOUSE_BROWSER_IDENTITY_SCHEMA} provider=playwright.chromium version=148.0.7778.96`,
      ),
    ]);
    expect(identityLines[0]).not.toContain('/resolved/playwright');
    expect(kills).toBe(1);
  });

  it('keeps an absent TTI audit null and retains its bounded Lighthouse diagnostic', async () => {
    const lhr = cleanLhr();
    delete lhr.audits.interactive.numericValue;
    lhr.audits.interactive.errorMessage = 'NO_TTI_CPU_IDLE_PERIOD\ntrace did not become quiet';
    const results = await runLighthouse(
      'http://localhost:4310',
      { repeats: 1 },
      fakeDependencies({ lighthouseRunner: async () => ({ lhr }) }),
    );

    expect(results[0].samples[0].ttiMs).toBeNull();
    expect(results[0].metrics.ttiMs).toBeNull();
    expect(results[0].nullSamples.ttiMs).toBe(1);
    expect(results[0].failures).toEqual([
      {
        message: 'interactive: NO_TTI_CPU_IDLE_PERIOD trace did not become quiet',
        metric: 'ttiMs',
        sampleIndex: 0,
        schema: LIGHTHOUSE_SAMPLE_FAILURE_SCHEMA,
        scope: 'metric',
      },
    ]);
  });

  it('retains a sanitized invocation exception instead of collapsing it into anonymous nulls', async () => {
    let calls = 0;
    const results = await runLighthouse(
      'http://localhost:4310',
      { repeats: 1 },
      fakeDependencies({
        lighthouseRunner: async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error('/resolved/playwright/chrome failed\nwith protocol error');
          }
          return { lhr: cleanLhr() };
        },
      }),
    );

    expect(calls).toBe(4);
    expect(results[0].failures).toEqual([
      {
        message: '<playwright-chromium> failed with protocol error',
        metric: null,
        sampleIndex: 0,
        schema: LIGHTHOUSE_SAMPLE_FAILURE_SCHEMA,
        scope: 'invocation',
      },
    ]);
    expect(Object.values(results[0].samples[0]).every((value) => value === null)).toBe(true);
    expect(results.slice(1).every((cell) => cell.failures.length === 0)).toBe(true);
  });

  it('bounds an invocation, retires Chrome, and marks the rest of the matrix unattempted', async () => {
    let calls = 0;
    let kills = 0;
    const results = await runLighthouse(
      'http://localhost:4310',
      { repeats: 1 },
      fakeDependencies({
        invocationTimeoutMs: 37,
        launchChrome: async () => ({ kill: async () => (kills += 1), port: 9_222 }),
        lighthouseRunner: async () => {
          calls += 1;
          return new Promise(() => undefined);
        },
        setTimer: (callback) => {
          callback();
          return { unref: () => undefined };
        },
      }),
    );

    expect(calls).toBe(1);
    expect(kills).toBe(1);
    expect(results[0].failures[0].message).toBe('Lighthouse invocation exceeded its 37ms deadline');
    expect(
      results.slice(1).every((cell) => cell.failures[0].message.startsWith('not attempted')),
    ).toBe(true);
  });

  it('leaves explicit workflow headroom after the full three-lane, two-framework matrix', () => {
    const workflowBudgetMs = 360 * 60_000;
    const nonLighthouseAllowanceMs = 120 * 60_000;
    const comparisonLighthouseMaximumMs = 3 * 2 * lighthouseInvocationPhaseMaximumMs(5);
    const remainingHeadroomMs =
      workflowBudgetMs - comparisonLighthouseMaximumMs - nonLighthouseAllowanceMs;

    expect(LIGHTHOUSE_INVOCATION_TIMEOUT_MS).toBe(105_000);
    expect(lighthouseInvocationPhaseMaximumMs(5)).toBe(2_100_000);
    // Five repeats are split across the two K,N,N,K occurrences. Across three lanes and both
    // frameworks that is at most 210 minutes of supervised Lighthouse invocations.
    expect(comparisonLighthouseMaximumMs).toBe(210 * 60_000);
    // Reserve two hours for production preparation, Playwright scenarios, bfcache, report writing,
    // and artifact upload. The six-hour parent still retains another explicit 30-minute margin.
    expect(nonLighthouseAllowanceMs).toBe(120 * 60_000);
    expect(remainingHeadroomMs).toBe(30 * 60_000);
    expect(remainingHeadroomMs).toBeGreaterThan(0);
  });
});

function fakeDependencies(overrides = {}) {
  return {
    authenticateBrowser: async (selectedPath) => {
      expect(selectedPath).toBe('/selected/playwright/chrome');
      return {
        executablePath: '/resolved/playwright/chrome',
        identity: browserIdentity,
      };
    },
    browserType: { executablePath: () => '/selected/playwright/chrome' },
    launchChrome: async () => ({ kill: async () => undefined, port: 9_222 }),
    lighthouseRunner: async () => ({ lhr: cleanLhr() }),
    writeIdentity: () => undefined,
    ...overrides,
  };
}

function cleanLhr() {
  return {
    audits: {
      'first-contentful-paint': { numericValue: 10 },
      interactive: { numericValue: 25 },
      'largest-contentful-paint': { numericValue: 20 },
      'network-requests': {
        details: { items: [{ statusCode: 200, url: 'http://localhost:4310/' }] },
      },
      'speed-index': { numericValue: 12 },
      'total-blocking-time': { numericValue: 0 },
      'total-byte-weight': { numericValue: 100 },
    },
    categories: { performance: { score: 1 } },
  };
}
