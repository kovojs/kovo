import { describe, expect, it } from 'vitest';

import {
  analyzeNavigationAttribution,
  navigationAttributionFindings,
  sessionBytePhases,
  summarizeIterations,
} from './scenarios.mjs';

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

  it('attributes only request and trace phases that Chromium directly observes', () => {
    const attribution = analyzeNavigationAttribution({
      clickTsUs: 1_000_000,
      destinationMarkTsUs: 1_100_000,
      destinationPaintTsUs: 1_120_000,
      epochOffsetMs: 1_000,
      records: [
        request({
          headers: { accept: 'application/vnd.kovo.document-parts+json' },
          method: 'GET',
          resourceType: 'fetch',
          responseHeaders: {
            'content-type': 'application/vnd.kovo.document-parts+json; charset=utf-8',
          },
          status: 200,
          timing: { requestStart: 10, responseEnd: 50, responseStart: 30, startTime: 1_990 },
          url: 'http://localhost:4820/matched/l1/product/a',
        }),
      ],
      traceEvents: [
        { dur: 10_000, name: 'ParseHTML', ts: 1_050_000 },
        { dur: 2_000, name: 'UpdateLayoutTree', ts: 1_100_000 },
        { dur: 3_000, name: 'Layout', ts: 1_103_000 },
        { dur: 4_000, name: 'Paint', ts: 1_120_000 },
      ],
    });

    expect(attribution.primaryResponse).toMatchObject({
      candidateCount: '1',
      contentType: 'application/vnd.kovo.document-parts+json',
      httpStatus: '200',
      selection: 'kovo-document-parts-media-type',
      status: 'observed',
    });
    expect(attribution.phases.server).toMatchObject({ durationMs: 20, status: 'observed' });
    expect(attribution.phases.transfer).toMatchObject({ durationMs: 20, status: 'observed' });
    expect(attribution.phases.documentConstruction).toMatchObject({
      durationMs: 10,
      eventCount: '1',
      status: 'observed',
    });
    expect(attribution.phases.style).toMatchObject({ durationMs: 2, status: 'observed' });
    expect(attribution.phases.layout).toMatchObject({ durationMs: 3, status: 'observed' });
    expect(attribution.phases.paint).toMatchObject({ durationMs: 4, status: 'observed' });
    expect(attribution.phases.unattributed).toMatchObject({
      durationMs: 50,
      status: 'observed',
    });
    expect(attribution.phases.responseReadDecode).toMatchObject({
      durationMs: null,
      status: 'unsupported',
    });
    expect(attribution.phases.domMorphApply).toMatchObject({
      durationMs: null,
      status: 'unsupported',
    });
    expect(attribution.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(navigationAttributionFindings(attribution)).toEqual([]);
  });

  it('keeps absent primary-response and JS-internal boundaries explicit instead of inventing zeroes', () => {
    const attribution = analyzeNavigationAttribution({
      clickTsUs: 1_000_000,
      destinationMarkTsUs: 1_050_000,
      destinationPaintTsUs: 1_060_000,
      epochOffsetMs: 1_000,
      records: [],
      traceEvents: [{ name: 'DrawFrame', ts: 1_060_000 }],
    });

    expect(attribution.primaryResponse).toMatchObject({
      candidateCount: '0',
      status: 'unsupported',
    });
    expect(attribution.phases.server).toMatchObject({ durationMs: null, status: 'unsupported' });
    expect(attribution.phases.transfer).toMatchObject({ durationMs: null, status: 'unsupported' });
    expect(attribution.phases.documentConstruction).toMatchObject({
      durationMs: null,
      status: 'unsupported',
    });
    expect(attribution.phases.style).toMatchObject({ durationMs: 0, status: 'observed' });
    expect(attribution.phases.layout).toMatchObject({ durationMs: 0, status: 'observed' });
    expect(attribution.phases.paint).toMatchObject({
      durationMs: 0,
      eventCount: '1',
      status: 'observed',
    });
    expect(attribution.phases.unattributed).toMatchObject({
      durationMs: null,
      status: 'unsupported',
    });
  });

  it('fails closed when trace boundaries or digested evidence are changed', () => {
    expect(() =>
      analyzeNavigationAttribution({
        clickTsUs: 2,
        destinationMarkTsUs: 1,
        destinationPaintTsUs: 3,
        epochOffsetMs: 0,
        records: [],
        traceEvents: [],
      }),
    ).toThrow('trace boundaries are out of order');

    const attribution = analyzeNavigationAttribution({
      clickTsUs: 1,
      destinationMarkTsUs: 2,
      destinationPaintTsUs: 3,
      epochOffsetMs: 0,
      records: [],
      traceEvents: [{ name: 'Paint', ts: 3 }],
    });
    attribution.phases.paint.durationMs = 999;
    expect(navigationAttributionFindings(attribution)).toContain(
      'navigation attribution digest is not derived from its evidence',
    );
  });
});

function request(overrides) {
  return { bytes: 0, headers: {}, resourceType: 'other', startedEpochMs: 0, ...overrides };
}
