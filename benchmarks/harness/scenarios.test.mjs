import { describe, expect, it } from 'vitest';

import { sessionBytePhases, summarizeIterations } from './scenarios.mjs';

describe('benchmark scenario analysis', () => {
  it('reports median, MAD, p95, and sample count from raw iterations', () => {
    const summary = summarizeIterations([
      { metric: 1 },
      { metric: 2 },
      { metric: 3 },
      { metric: 4 },
      { metric: 100 },
    ]);
    expect(summary.metric).toMatchObject({ mad: 1, median: 3, p95: 100, samples: 5 });
  });

  it('separates initial, automatic-prefetch, click-to-paint, and post-click bytes', () => {
    const phases = sessionBytePhases(
      [
        request({ bytes: 100, resourceType: 'document', startedEpochMs: 1_000 }),
        request({ bytes: 200, resourceType: 'script', startedEpochMs: 1_600 }),
        request({
          bytes: 300,
          headers: { 'next-router-prefetch': '1' },
          resourceType: 'other',
          startedEpochMs: 1_200,
        }),
        request({ bytes: 400, resourceType: 'stylesheet', startedEpochMs: 2_100 }),
        request({ bytes: 500, resourceType: 'image', startedEpochMs: 2_600 }),
      ],
      { clickEpochMs: 2_000, destinationPaintEpochMs: 2_500, initialEndEpochMs: 1_500 },
    );

    expect(phases.initial).toMatchObject({ html: 100, requests: 1, total: 100 });
    expect(phases.automaticPrefetch).toMatchObject({
      js: 200,
      other: 300,
      requests: 2,
      total: 500,
    });
    expect(phases.click).toMatchObject({ css: 400, requests: 1, total: 400 });
    expect(phases.postClick).toMatchObject({ img: 500, requests: 1, total: 500 });
    expect(phases.throughClick.total).toBe(600);
    expect(phases.throughDestinationPaint.total).toBe(1_000);
    expect(phases.settledSession.total).toBe(1_500);
  });
});

function request(overrides) {
  return { bytes: 0, headers: {}, resourceType: 'other', startedEpochMs: 0, ...overrides };
}
