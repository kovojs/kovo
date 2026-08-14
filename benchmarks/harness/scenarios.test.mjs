import { describe, expect, it } from 'vitest';

import {
  analyzeNavigationAttribution,
  navigationAttributionFindings,
  sessionBytePhases,
  summarizeIterations,
} from './scenarios.mjs';

const MAIN_FRAME_ID = 'main-frame';
const TARGET_PATH = '/matched/l1/product/a';

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

  it('separates proven prefetch from unclassified pre-click background traffic', () => {
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
      other: 300,
      requests: 1,
      total: 300,
    });
    expect(phases.preClickBackground).toMatchObject({ js: 200, requests: 1, total: 200 });
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
      mainFrameId: MAIN_FRAME_ID,
      networkEvents: [networkRequest({ url: 'http://localhost:4820/matched/l1/product/a' })],
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
      targetPath: TARGET_PATH,
      traceEvents: [
        ...traceResponse({
          contentType: 'application/vnd.kovo.document-parts+json',
          requestStartTsUs: 1_000_000,
          responseEndTsUs: 1_040_000,
          responseStartTsUs: 1_020_000,
          url: 'http://localhost:4820/matched/l1/product/a',
        }),
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
    expect(attribution.phases.responseProcessingDomApply).toMatchObject({
      durationMs: 80,
      includes: [
        'response-transfer-and-stream-consumption',
        'response-read-decode',
        'document-build-or-morph',
        'main-thread-queueing',
      ],
      scope: 'primary-response-headers-to-destination-marker',
      status: 'observed',
    });
    expect(attribution.phases.documentConstruction).toMatchObject({
      durationMs: 10,
      eventCount: '1',
      status: 'observed',
    });
    expect(attribution.phases.style).toMatchObject({ durationMs: 2, status: 'observed' });
    expect(attribution.phases.layout).toMatchObject({ durationMs: 3, status: 'observed' });
    expect(attribution.phases.paint).toMatchObject({ durationMs: 4, status: 'observed' });
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

    const forgedNetworkIdentity = structuredClone(attribution);
    forgedNetworkIdentity.primaryResponse.networkWitness.identity = `sha256:${'0'.repeat(64)}`;
    expect(navigationAttributionFindings(forgedNetworkIdentity)).toContain(
      'navigation attribution primary response is invalid',
    );

    const relabeledEnvelope = structuredClone(attribution);
    relabeledEnvelope.phases.responseProcessingDomApply.source = 'derived-residual';
    expect(navigationAttributionFindings(relabeledEnvelope)).toContain(
      'navigation attribution responseProcessingDomApply contract is invalid',
    );
  });

  it('keeps absent primary-response and JS-internal boundaries explicit instead of inventing zeroes', () => {
    const attribution = analyzeNavigationAttribution({
      clickTsUs: 1_000_000,
      destinationMarkTsUs: 1_050_000,
      destinationPaintTsUs: 1_060_000,
      epochOffsetMs: 1_000,
      mainFrameId: MAIN_FRAME_ID,
      networkEvents: [],
      records: [],
      targetPath: TARGET_PATH,
      traceEvents: [{ name: 'DrawFrame', ts: 1_060_000 }],
    });

    expect(attribution.primaryResponse).toMatchObject({
      candidateCount: '0',
      status: 'unsupported',
    });
    expect(attribution.phases.server).toMatchObject({ durationMs: null, status: 'unsupported' });
    expect(attribution.phases.transfer).toMatchObject({ durationMs: null, status: 'unsupported' });
    expect(attribution.phases.responseProcessingDomApply).toMatchObject({
      durationMs: null,
      status: 'unsupported',
    });
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
  });

  it('uses trace resource timing when a document ResourceSendRequest event is dispatched late', () => {
    const url = 'http://localhost:4821/matched/l1/product/a';
    const events = traceResponse({
      contentType: 'text/html',
      requestStartTsUs: 1_000_000,
      resourceType: 'Document',
      responseEndTsUs: 1_010_000,
      responseStartTsUs: 1_006_000,
      url,
    });
    // Real Chromium Next.js traces dispatch the document ResourceSendRequest event after the
    // requestTime/sendStart and can even dispatch it after the response-headers timing boundary.
    // The timeline event also omits initiator facts for top-level documents; the joined Network
    // event owns that fact.
    events[0].ts = 1_008_000;
    delete events[0].args.data.initiator;
    const attribution = analyzeNavigationAttribution({
      clickTsUs: 990_000,
      destinationMarkTsUs: 1_020_000,
      destinationPaintTsUs: 1_030_000,
      epochOffsetMs: 1_000,
      mainFrameId: MAIN_FRAME_ID,
      networkEvents: [networkRequest({ resourceType: 'Document', url })],
      records: [
        request({
          isNavigationRequest: true,
          method: 'GET',
          resourceType: 'document',
          responseHeaders: { 'content-type': 'text/html; charset=utf-8' },
          status: 200,
          timing: { requestStart: 0, responseEnd: 10, responseStart: 6, startTime: 2_000 },
          url,
        }),
      ],
      targetPath: TARGET_PATH,
      traceEvents: [...events, { name: 'Paint', ts: 1_030_000 }],
    });

    expect(attribution.primaryResponse).toMatchObject({
      resourceType: 'document',
      selection: 'document-resource',
      timing: {
        requestStartTsUs: '1000000',
        responseStartTsUs: '1006000',
      },
    });
    expect(attribution.phases.server.durationMs).toBe(6);
    expect(attribution.phases.responseProcessingDomApply.durationMs).toBe(14);
  });

  it('fails closed when Playwright sees a primary response but its trace triplet is absent', () => {
    expect(() =>
      analyzeNavigationAttribution({
        clickTsUs: 1_000_000,
        destinationMarkTsUs: 1_100_000,
        destinationPaintTsUs: 1_120_000,
        epochOffsetMs: 1_000,
        mainFrameId: MAIN_FRAME_ID,
        networkEvents: [
          networkRequest({ url: 'http://localhost:4820/matched/l1/product/a?_rsc=one' }),
        ],
        records: [
          request({
            method: 'GET',
            resourceType: 'fetch',
            responseHeaders: { 'content-type': 'text/x-component' },
            status: 200,
            timing: { requestStart: 10, responseEnd: 50, responseStart: 30, startTime: 1_990 },
            url: 'http://localhost:4820/matched/l1/product/a?_rsc=one',
          }),
        ],
        targetPath: TARGET_PATH,
        traceEvents: [{ name: 'Paint', ts: 1_120_000 }],
      }),
    ).toThrow(
      'did not retain its complete ResourceSendRequest/ResourceReceiveResponse/ResourceFinish',
    );
  });

  it('rejects a response whose authenticated finish time falls after destination paint', () => {
    const url = 'http://localhost:4820/matched/l1/product/a';
    expect(() =>
      analyzeNavigationAttribution({
        clickTsUs: 1_000_000,
        destinationMarkTsUs: 1_050_000,
        destinationPaintTsUs: 1_060_000,
        epochOffsetMs: 1_000,
        mainFrameId: MAIN_FRAME_ID,
        networkEvents: [networkRequest({ url })],
        records: [
          request({
            headers: { accept: 'application/vnd.kovo.document-parts+json' },
            method: 'GET',
            resourceType: 'fetch',
            responseHeaders: {
              'content-type': 'application/vnd.kovo.document-parts+json',
            },
            status: 200,
            timing: { requestStart: 10, responseEnd: 1_010, responseStart: 30, startTime: 1_990 },
            url,
          }),
        ],
        targetPath: TARGET_PATH,
        traceEvents: [
          ...traceResponse({
            contentType: 'application/vnd.kovo.document-parts+json',
            requestStartTsUs: 1_000_000,
            responseEndTsUs: 2_000_000,
            responseStartTsUs: 1_020_000,
            url,
          }),
          { name: 'Paint', ts: 1_060_000 },
        ],
      }),
    ).toThrow('complete ResourceSendRequest/ResourceReceiveResponse/ResourceFinish trace witness');
  });

  it('binds the selected response to the clicked path and top-level frame', () => {
    const targetUrl = 'http://localhost:4820/matched/l1/product/a';
    const iframeUrl = 'http://localhost:4820/matched/l1/product/a?iframe=1';
    const attribution = analyzeNavigationAttribution({
      clickTsUs: 1_000_000,
      destinationMarkTsUs: 1_080_000,
      destinationPaintTsUs: 1_100_000,
      epochOffsetMs: 1_000,
      mainFrameId: MAIN_FRAME_ID,
      networkEvents: [
        networkRequest({
          frameId: 'iframe',
          requestId: 'iframe-request',
          url: iframeUrl,
        }),
        networkRequest({
          requestId: 'main-request',
          resourceType: 'Document',
          url: targetUrl,
        }),
      ],
      records: [
        request({
          frameScope: 'subframe',
          headers: { accept: 'application/vnd.kovo.document-parts+json' },
          method: 'GET',
          resourceType: 'fetch',
          responseHeaders: { 'content-type': 'application/vnd.kovo.document-parts+json' },
          status: 200,
          timing: { requestStart: 1, responseEnd: 20, responseStart: 10, startTime: 2_000 },
          url: iframeUrl,
        }),
        request({
          isNavigationRequest: true,
          method: 'GET',
          resourceType: 'document',
          responseHeaders: { 'content-type': 'text/html' },
          status: 200,
          timing: { requestStart: 20, responseEnd: 50, responseStart: 35, startTime: 1_990 },
          url: targetUrl,
        }),
      ],
      targetPath: TARGET_PATH,
      traceEvents: [
        ...traceResponse({
          contentType: 'application/vnd.kovo.document-parts+json',
          frameId: 'iframe',
          requestId: 'iframe-request',
          requestStartTsUs: 1_001_000,
          responseEndTsUs: 1_020_000,
          responseStartTsUs: 1_010_000,
          url: iframeUrl,
        }),
        ...traceResponse({
          contentType: 'text/html',
          requestId: 'main-request',
          requestStartTsUs: 1_010_000,
          resourceType: 'Document',
          responseEndTsUs: 1_040_000,
          responseStartTsUs: 1_025_000,
          url: targetUrl,
        }),
        { name: 'Paint', ts: 1_100_000 },
      ],
    });

    expect(attribution.primaryResponse).toMatchObject({
      selection: 'document-resource',
      traceRequestId: 'main-request',
      traceContext: { frameId: MAIN_FRAME_ID, scope: 'top-level-frame' },
    });
  });

  it('fails closed when trace boundaries or digested evidence are changed', () => {
    expect(() =>
      analyzeNavigationAttribution({
        clickTsUs: 2,
        destinationMarkTsUs: 1,
        destinationPaintTsUs: 3,
        epochOffsetMs: 0,
        mainFrameId: MAIN_FRAME_ID,
        networkEvents: [],
        records: [],
        targetPath: TARGET_PATH,
        traceEvents: [],
      }),
    ).toThrow('trace boundaries are out of order');

    const url = 'http://localhost:4820/matched/l1/product/late';
    expect(() =>
      analyzeNavigationAttribution({
        clickTsUs: 1_000_000,
        destinationMarkTsUs: 1_015_000,
        destinationPaintTsUs: 1_030_000,
        epochOffsetMs: 1_000,
        mainFrameId: MAIN_FRAME_ID,
        networkEvents: [networkRequest({ resourceType: 'Document', url })],
        records: [
          request({
            isNavigationRequest: true,
            method: 'GET',
            resourceType: 'document',
            responseHeaders: { 'content-type': 'text/html' },
            status: 200,
            timing: { requestStart: 10, responseEnd: 40, responseStart: 30, startTime: 1_990 },
            url,
          }),
        ],
        targetPath: '/matched/l1/product/late',
        traceEvents: [
          ...traceResponse({
            contentType: 'text/html',
            requestStartTsUs: 1_000_000,
            resourceType: 'Document',
            responseEndTsUs: 1_030_000,
            responseStartTsUs: 1_020_000,
            url,
          }),
          { name: 'Paint', ts: 1_030_000 },
        ],
      }),
    ).toThrow('headers arrived after the destination marker');

    const attribution = analyzeNavigationAttribution({
      clickTsUs: 1,
      destinationMarkTsUs: 2,
      destinationPaintTsUs: 3,
      epochOffsetMs: 0,
      mainFrameId: MAIN_FRAME_ID,
      networkEvents: [],
      records: [],
      targetPath: TARGET_PATH,
      traceEvents: [{ name: 'Paint', ts: 3 }],
    });
    attribution.phases.paint.durationMs = 999;
    expect(navigationAttributionFindings(attribution)).toContain(
      'navigation attribution digest is not derived from its evidence',
    );
  });
});

function request(overrides) {
  return {
    bytes: 0,
    frameScope: 'top-level',
    headers: {},
    isNavigationRequest: false,
    resourceType: 'other',
    startedEpochMs: 0,
    ...overrides,
  };
}

function networkRequest({
  frameId = MAIN_FRAME_ID,
  requestId = 'trace-request-1',
  resourceType = 'Fetch',
  url,
}) {
  return {
    frameId,
    initiator:
      resourceType.toLowerCase() === 'document'
        ? { type: 'other' }
        : { fetchType: 'fetch', type: 'script' },
    loaderId: 'main-loader',
    request: { method: 'GET', url },
    requestId,
    type: resourceType,
  };
}

function traceResponse({
  contentType,
  frameId = MAIN_FRAME_ID,
  requestId = 'trace-request-1',
  requestStartTsUs,
  resourceType = 'Other',
  responseEndTsUs,
  responseStartTsUs,
  url,
}) {
  return [
    {
      args: {
        data: {
          frame: frameId,
          initiator:
            resourceType.toLowerCase() === 'document'
              ? { type: 'other' }
              : { fetchType: 'fetch', type: 'script' },
          loaderId: 'main-loader',
          requestId,
          requestMethod: 'GET',
          resourceType,
          url,
        },
      },
      name: 'ResourceSendRequest',
      ts: requestStartTsUs,
    },
    {
      args: {
        data: {
          headers: [{ name: 'Content-Type', value: contentType }],
          mimeType: contentType,
          requestId,
          statusCode: 200,
          timing: {
            receiveHeadersEnd: (responseStartTsUs - requestStartTsUs) / 1_000,
            requestTime: requestStartTsUs / 1_000_000,
            sendStart: 0,
          },
        },
      },
      name: 'ResourceReceiveResponse',
      ts: responseStartTsUs + 50,
    },
    {
      args: {
        data: {
          didFail: false,
          finishTime: responseEndTsUs / 1_000_000,
          requestId,
        },
      },
      name: 'ResourceFinish',
      ts: responseEndTsUs + 50,
    },
  ];
}
