import http from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  dynamicCachePostureFindings,
  establishServerExpectation,
  responseFindings,
  runKeepAliveWindow,
  serverConditionKey,
  serverConditionPath,
  serverConditions,
} from './perf-server-benchmark.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe('production server benchmark adapter', () => {
  it('declares the complete 36-condition Phase 3 matrix', () => {
    const conditions = serverConditions();
    expect(conditions).toHaveLength(36);
    expect(new Set(conditions.map((condition) => condition.key)).size).toBe(36);
    expect(
      serverConditionKey({ concurrency: 32, encoding: 'br', mode: '304', route: 'detail' }),
    ).toBe('304-detail-br-c32');
    expect(serverConditionPath({ mode: 'HIT', route: 'listing' })).toBe('/matched/l0');
    expect(serverConditionPath({ mode: 'dynamic', route: 'detail' })).toBe(
      '/matched/runtime/dynamic/product/linen-field-jacket',
    );
    expect(() => serverConditions({ modes: [] })).toThrow(/non-empty/u);
    expect(() => serverConditions({ routes: ['listing', 'listing'] })).toThrow(/duplicates/u);
  });

  it('requires Kovo dynamic documents to retain the normative private/no-store Cookie floor', () => {
    expect(
      dynamicCachePostureFindings({ cacheControl: '', framework: 'kovo', vary: 'Accept' }),
    ).toEqual(['Cache-Control private', 'Cache-Control no-store', 'Vary Cookie']);
    expect(
      dynamicCachePostureFindings({
        cacheControl: 'private, no-store',
        framework: 'kovo',
        vary: 'Accept, Cookie',
      }),
    ).toEqual([]);
    expect(
      dynamicCachePostureFindings({
        cacheControl: 'private, no-store',
        framework: 'nextjs',
        vary: 'Accept-Encoding',
      }),
    ).toEqual([]);
  });

  it('rejects status, exact-header, body, and missing Kovo-Pad evidence', () => {
    const expectation = {
      body: Buffer.from('expected'),
      headers: { 'cache-control': 'public, max-age=0, must-revalidate', etag: '"v1"' },
      kovoPad: 'required-fresh',
      statusCode: 200,
    };
    const state = { kovoPads: new Set() };
    expect(
      responseFindings(
        {
          body: Buffer.from('wrong'),
          headers: { 'cache-control': 'private, no-store', etag: '"v2"' },
          statusCode: 304,
        },
        expectation,
        state,
      ),
    ).toEqual([
      'status 304 != 200',
      'cache-control "private, no-store" != "public, max-age=0, must-revalidate"',
      'etag "\\"v2\\"" != "\\"v1\\""',
      'wire body differed from primed bytes',
      'Kovo-Pad was missing from a compressed Kovo response',
    ]);
  });

  it('uses node:http keep-alive and validates every response in a timed window', async () => {
    const body = Buffer.from('matched-body');
    const server = http.createServer((_request, response) => {
      response.writeHead(200, {
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'Content-Length': String(body.byteLength),
        ETag: '"v1"',
      });
      response.end(body);
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, 'localhost', resolve));
    const address = server.address();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 2 });
    try {
      const result = await runKeepAliveWindow({
        agent,
        concurrency: 2,
        durationMs: 50,
        expectation: {
          body,
          headers: {
            'cache-control': 'public, max-age=0, must-revalidate',
            etag: '"v1"',
          },
          kovoPad: 'absent',
          statusCode: 200,
        },
        headers: { 'accept-encoding': 'identity' },
        origin: `http://localhost:${String(address.port)}`,
        path: '/',
      });
      expect(result).toMatchObject({ failedRequests: 0, misses: 0 });
      expect(result.requests).toBeGreaterThan(2);
      expect(result.reusedSockets).toBeGreaterThan(0);
      expect(result.statusCounts).toEqual({ 200: result.requests });
    } finally {
      agent.destroy();
    }
  });

  it('preserves Next.js identity-to-Brotli evidence as unsupported without a timing expectation', async () => {
    const body = Buffer.from(
      '<main data-benchmark-destination="listing">Field goods for everyday carry</main>',
    );
    const headers = {
      'cache-control': 'public, max-age=0, must-revalidate',
      'content-type': 'text/html; charset=utf-8',
      etag: '"next-listing-v1"',
      'x-nextjs-cache': 'HIT',
    };
    const requests = [];
    const result = await establishServerExpectation({
      agent: null,
      condition: { concurrency: 1, encoding: 'br', mode: 'HIT', route: 'listing' },
      framework: 'nextjs',
      origin: 'http://localhost:1',
      request: async ({ headers: requestHeaders }) => {
        requests.push(requestHeaders);
        return { body, headers, reusedSocket: true, statusCode: 200 };
      },
    });

    expect(requests).toHaveLength(2);
    expect(requests[1]['accept-encoding']).toBe('br');
    expect(result).toMatchObject({
      expectation: null,
      requestEtag: null,
      support: {
        observedContentEncoding: null,
        reason: 'requested Brotli returned the identity representation',
        requestedContentEncoding: 'br',
        status: 'unsupported',
      },
    });
    expect(result.evidence).toMatchObject({
      bodyBytes: body.byteLength,
      contentEncoding: null,
      requestAcceptEncoding: 'br',
      selectedResponse: { bodyBytes: body.byteLength, contentEncoding: null, status: 200 },
      status: 200,
      wireBodyBytes: body.byteLength,
    });
    expect(result.evidence.bodySha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.evidence.selectedResponse.bodySha256).toBe(result.evidence.bodySha256);
  });

  it('does not downgrade Kovo or a non-identity encoding mismatch to unsupported', async () => {
    const body = Buffer.from(
      '<main data-benchmark-destination="listing">Field goods for everyday carry</main>',
    );
    const identity = {
      body,
      headers: {
        'cache-control': 'public, max-age=0, must-revalidate',
        'content-type': 'text/html',
        etag: '"v1"',
        'last-modified': 'Wed, 12 Aug 2026 00:00:00 GMT',
      },
      statusCode: 200,
    };
    const kovoResponses = [identity, identity];
    await expect(
      establishServerExpectation({
        agent: null,
        condition: { concurrency: 1, encoding: 'br', mode: 'HIT', route: 'listing' },
        framework: 'kovo',
        origin: 'http://localhost:1',
        request: async () => kovoResponses.shift(),
      }),
    ).rejects.toThrow(/Content-Encoding: br/u);

    const nextResponses = [
      { ...identity, headers: { ...identity.headers, 'x-nextjs-cache': 'HIT' } },
      {
        ...identity,
        headers: { ...identity.headers, 'content-encoding': 'gzip', 'x-nextjs-cache': 'HIT' },
      },
    ];
    await expect(
      establishServerExpectation({
        agent: null,
        condition: { concurrency: 1, encoding: 'br', mode: 'HIT', route: 'listing' },
        framework: 'nextjs',
        origin: 'http://localhost:1',
        request: async () => nextResponses.shift(),
      }),
    ).rejects.toThrow(/Content-Encoding: br/u);
  });
});
