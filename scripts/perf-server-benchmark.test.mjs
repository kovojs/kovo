import http from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  dynamicCachePostureFindings,
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
});
