import { describe, expect, it } from 'vitest';

import { summarizeAppBenchmarkIntegrity } from './run.mjs';
import {
  LIGHTHOUSE_BROWSER_IDENTITY_SCHEMA,
  LIGHTHOUSE_SAMPLE_FAILURE_SCHEMA,
  lighthouseTimeoutPolicy,
} from './lighthouse-policy.mjs';
import { analyzeNavigationAttribution } from './scenarios.mjs';

describe('browser adapter integrity', () => {
  it('materializes a complete verdict only for clean policy-matched evidence', () => {
    const result = cleanResult();
    const policy = {
      bfcacheIterations: 1,
      iterations: 1,
      lighthouse: false,
      lighthouseRepeats: 3,
      listingPath: '/',
      scenarios: ['coldLoad'],
      warmups: 0,
    };
    expect(summarizeAppBenchmarkIntegrity(result, policy)).toEqual({
      complete: true,
      errors: [],
      policy: {
        bfcacheIterations: 1,
        iterations: 1,
        lighthouseRepeats: 0,
        listingPath: '/',
        scenarios: ['coldLoad'],
        warmups: 0,
      },
    });

    result.conditions.mobile.coldLoad.iterations[0].pageErrors = 1;
    expect(summarizeAppBenchmarkIntegrity(result, policy)).toMatchObject({
      complete: false,
      errors: ['mobile/coldLoad[0]: pageErrors was not zero'],
    });
  });

  it('fails closed when a navigation attribution witness is absent or changed', () => {
    const result = cleanResult();
    for (const condition of Object.values(result.conditions)) {
      condition.coldLoad.iterations = [];
      condition.navigation.iterations = [cleanNavigationScenario()];
    }
    const policy = {
      bfcacheIterations: 1,
      iterations: 1,
      lighthouse: false,
      lighthouseRepeats: 3,
      listingPath: '/',
      scenarios: ['navigation'],
      warmups: 0,
    };
    expect(summarizeAppBenchmarkIntegrity(result, policy)).toMatchObject({
      complete: true,
      errors: [],
    });

    result.conditions.desktop.navigation.iterations[0].navAttribution.phases.paint.durationMs = 1;
    expect(summarizeAppBenchmarkIntegrity(result, policy)).toMatchObject({
      complete: false,
      errors: [
        'desktop/navigation[0]: navigation attribution digest is not derived from its evidence',
      ],
    });
  });

  it('requires identical pinned Lighthouse identity and surfaces per-metric diagnostics', () => {
    const result = cleanResult();
    result.bfcache.browser = '148.0.7778.96';
    result.lighthouse = Array.from({ length: 4 }, () => cleanLighthouseCell());
    const policy = {
      bfcacheIterations: 1,
      iterations: 1,
      lighthouse: true,
      lighthouseRepeats: 1,
      listingPath: '/',
      scenarios: ['coldLoad'],
      warmups: 0,
    };
    expect(summarizeAppBenchmarkIntegrity(result, policy)).toMatchObject({
      complete: true,
      errors: [],
    });

    result.lighthouse[1].failures.push({
      message: 'interactive: NO_TTI_CPU_IDLE_PERIOD',
      metric: 'ttiMs',
      sampleIndex: 0,
      schema: LIGHTHOUSE_SAMPLE_FAILURE_SCHEMA,
      scope: 'metric',
    });
    result.lighthouse[1].samples[0].ttiMs = null;
    result.lighthouse[1].metrics.ttiMs = null;
    result.lighthouse[1].nullSamples.ttiMs = 1;
    expect(summarizeAppBenchmarkIntegrity(result, policy)).toMatchObject({
      complete: false,
      errors: expect.arrayContaining([
        'lighthouse[1]/sample[0]/ttiMs: interactive: NO_TTI_CPU_IDLE_PERIOD',
        'lighthouse[1]: null metric samples were observed',
        'lighthouse[1]: aggregate metric is absent',
      ]),
    });
  });
});

function cleanResult() {
  const condition = () => ({
    coldLoad: { iterations: [cleanScenario()] },
    navigation: { iterations: [] },
    ttiProbe: { iterations: [] },
  });
  return {
    bfcache: {
      available: true,
      iterations: [
        {
          applicable: false,
          evidenceComplete: true,
          finalListing: { contentValid: true, pathname: '/' },
          listingPath: '/',
          network: {
            errorResponses: 0,
            failedRequests: 0,
            pageErrors: 0,
            rateLimitedResponses: 0,
            requests: 2,
          },
          notApplicableReason: 'in-app navigation stayed in one document',
          notRestoredReasons: [],
          originSentinelPresent: true,
          restored: false,
        },
      ],
    },
    conditions: { desktop: condition(), mobile: condition() },
    lighthouse: [],
  };
}

function cleanScenario() {
  const digest = `sha256:${'a'.repeat(64)}`;
  return {
    errorResponses: 0,
    failedRequests: 0,
    fcpMs: 10,
    fixtureEvidenceDigest: digest,
    fixtureEvidenceValid: 1,
    fixtureIdentityDigest: digest,
    fixtureRenderedContractDigest: digest,
    lcpMs: 20,
    pageErrors: 0,
    rateLimitedResponses: 0,
    settleTimedOut: 0,
  };
}

function cleanLighthouseCell() {
  const metrics = {
    bytes: 100,
    fcpMs: 10,
    lcpMs: 20,
    performanceScore: 1,
    speedIndexMs: 12,
    tbtMs: 0,
    ttiMs: 25,
  };
  return {
    browser: {
      executable: {
        basename: 'chrome',
        bytes: 123_456,
        pathSha256: `sha256:${'a'.repeat(64)}`,
      },
      provider: 'playwright.chromium',
      schema: LIGHTHOUSE_BROWSER_IDENTITY_SCHEMA,
      version: '148.0.7778.96',
    },
    failures: [],
    metrics: { ...metrics },
    network: {
      errorResponses: 0,
      rateLimitedResponses: 0,
      requests: 1,
      tracked: true,
    },
    nullSamples: Object.fromEntries(Object.keys(metrics).map((name) => [name, 0])),
    policy: lighthouseTimeoutPolicy(),
    repeats: 1,
    samples: [{ ...metrics }],
    spread: Object.fromEntries(Object.keys(metrics).map((name) => [name, 0])),
  };
}

function cleanNavigationScenario() {
  return {
    errorResponses: 0,
    failedRequests: 0,
    navAttribution: analyzeNavigationAttribution({
      clickTsUs: 1,
      destinationMarkTsUs: 2,
      destinationPaintTsUs: 3,
      epochOffsetMs: 0,
      mainFrameId: 'main-frame',
      networkEvents: [],
      records: [],
      targetPath: '/matched/l1/product/a',
      traceEvents: [{ name: 'Paint', ts: 3 }],
    }),
    sessionBytes: emptySessionBytes(),
    navSettleTimedOut: 0,
    pageErrors: 0,
    rateLimitedResponses: 0,
  };
}

function emptySessionBytes() {
  const bucket = () => ({ css: 0, html: 0, img: 0, js: 0, other: 0, requests: 0, total: 0 });
  return Object.fromEntries(
    [
      'initial',
      'automaticPrefetch',
      'preClickBackground',
      'click',
      'postClick',
      'throughClick',
      'throughDestinationPaint',
      'settledSession',
    ].map((name) => [name, bucket()]),
  );
}
