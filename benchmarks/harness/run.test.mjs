import { describe, expect, it } from 'vitest';

import { summarizeAppBenchmarkIntegrity } from './run.mjs';
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
  return {
    errorResponses: 0,
    failedRequests: 0,
    pageErrors: 0,
    rateLimitedResponses: 0,
    settleTimedOut: 0,
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
      records: [],
      traceEvents: [{ name: 'Paint', ts: 3 }],
    }),
    navSettleTimedOut: 0,
    pageErrors: 0,
    rateLimitedResponses: 0,
  };
}
