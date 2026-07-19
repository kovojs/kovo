// @kovo-security-classifier-corpus finite-security-operation-ir
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CacheInfluenceManifest } from '@kovojs/core/internal/cache-influence';
import { afterEach, describe, expect, it } from 'vitest';

import { publicAccess } from './access.js';
import { createApp, createRequestHandler } from './app.js';
import {
  installGeneratedCacheInfluenceManifestForCommand,
} from './generated-cache-influence-registry.js';
import { query, renderQueryEndpointResponse } from './query.js';
import { respond } from './response.js';
import { route } from './route.js';
import { s } from './schema.js';

interface CachedRepresentation {
  body: string;
  headers: Record<string, string>;
  status: number;
  url: string;
  vary: readonly string[];
  varyValues: readonly string[];
}

const servers: Server[] = [];
let releaseManifest: (() => void) | undefined;

afterEach(async () => {
  releaseManifest?.();
  releaseManifest = undefined;
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.entries());
}

function requestHeaderValue(headers: Headers, name: string): string {
  return headers.get(name) ?? '';
}

function matchingRepresentation(
  cache: readonly CachedRepresentation[],
  url: string,
  headers: Headers,
): CachedRepresentation | undefined {
  return cache.find(
    (entry) =>
      entry.url === url &&
      entry.vary.every(
        (name, index) => requestHeaderValue(headers, name) === entry.varyValues[index],
      ),
  );
}

function intermediary(origin: string): Server {
  const cache: CachedRepresentation[] = [];
  return createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url ?? '/', 'http://intermediary.test');
    const requestHeaders = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value === undefined || name === 'host' || name === 'connection') continue;
      requestHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
    }

    const cached = matchingRepresentation(cache, url.pathname + url.search, requestHeaders);
    if (cached !== undefined) {
      outgoing.statusCode = cached.status;
      for (const [name, value] of Object.entries(cached.headers)) outgoing.setHeader(name, value);
      outgoing.setHeader('x-intermediary-cache', 'HIT');
      outgoing.end(cached.body);
      return;
    }

    const originResponse = await fetch(`${origin}${url.pathname}${url.search}`, {
      headers: requestHeaders,
    });
    const body = await originResponse.text();
    const headers = responseHeaders(originResponse);
    const cacheControl = headers['cache-control'] ?? '';
    const vary = (headers.vary ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    if (
      /(?:^|,)\s*public(?:\s|,|$)/iu.test(cacheControl) &&
      !/(?:^|,)\s*(?:private|no-store)(?:\s|,|$)/iu.test(cacheControl)
    ) {
      cache.push({
        body,
        headers,
        status: originResponse.status,
        url: url.pathname + url.search,
        vary,
        varyValues: vary.map((name) => requestHeaderValue(requestHeaders, name)),
      });
    }
    outgoing.statusCode = originResponse.status;
    for (const [name, value] of Object.entries(headers)) outgoing.setHeader(name, value);
    outgoing.setHeader('x-intermediary-cache', 'MISS');
    outgoing.end(body);
  });
}

async function bodyAndCache(
  base: string,
  path: string,
  headers: HeadersInit = {},
): Promise<{ body: string; cache: string; cacheControl: string; vary: string }> {
  const response = await fetch(`${base}${path}`, { headers });
  return {
    body: await response.text(),
    cache: response.headers.get('x-intermediary-cache') ?? '',
    cacheControl: response.headers.get('cache-control') ?? '',
    vary: response.headers.get('vary') ?? '',
  };
}

describe('cache generality through a real intermediary', () => {
  it('does not let a runtime document header widen a missing compiler verdict', async () => {
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/public-looking-document', {
            access: publicAccess('negative cache manifest fixture'),
            page: () =>
              respond.file('catalog', {
                contentType: 'text/plain; charset=utf-8',
                headers: { 'Cache-Control': 'public, max-age=60' },
              }),
          }),
        ],
      }),
    );

    for (const headers of [
      undefined,
      { authorization: 'Bearer principal-a' },
      { cookie: 'session=principal-a' },
    ]) {
      const response = await handler(
        new Request('https://cache.example.test/public-looking-document', { headers }),
      );
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('vary')).toContain('Cookie');
    }
  });

  it('proves prime/reuse across principals, cookies, Authorization, query variants, header variants, and branch changes', async () => {
    // @kovo-security-certifies C13 cache-influence-real-intermediary
    const manifest: CacheInfluenceManifest = {
      entries: [
        {
          authored: { cacheControl: 'public, max-age=60', posture: 'public' },
          axes: [
            { kind: 'url-path', role: 'cache-key' },
            { kind: 'url-search', role: 'cache-key' },
            { kind: 'request-header', name: 'accept-language', role: 'vary' },
            { kind: 'request-header', name: 'x-branch', role: 'vary' },
          ],
          closedReasons: [],
          root: 'query:cache-oracle',
          surface: 'query',
          vary: ['accept-language', 'x-branch'],
          verdict: 'public-proved',
        },
      ],
      schema: 'kovo-cache-influence/v1',
    };
    releaseManifest = installGeneratedCacheInfluenceManifestForCommand(manifest);

    let originHits = 0;
    const cacheOracle = query('cache-oracle', {
      access: publicAccess('real intermediary cache-generality oracle'),
      args: s.object({ item: s.string() }),
      load(input, context) {
        originHits += 1;
        const request = context?.request as Request;
        return {
          authorization: request.headers.get('authorization') ?? 'none',
          branch: request.headers.get('x-branch') ?? 'stable',
          hit: originHits,
          item: input.item,
          language: request.headers.get('accept-language') ?? 'en',
          principal: request.headers.get('cookie') ?? 'anonymous',
        };
      },
      read: { cacheControl: 'public, max-age=60' },
      reads: [],
    });
    const originServer = createServer(async (incoming, outgoing) => {
      const originUrl = new URL(incoming.url ?? '/', 'http://origin.test');
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const result = await renderQueryEndpointResponse(cacheOracle, {
        request: new Request(originUrl, { headers }),
        search: originUrl.searchParams,
      });
      outgoing.statusCode = result.status;
      for (const [name, value] of Object.entries(result.headers)) {
        outgoing.setHeader(name, value);
      }
      outgoing.end(result.body);
    });
    const originPort = await listen(originServer);
    const intermediaryServer = intermediary(`http://127.0.0.1:${originPort}`);
    const intermediaryPort = await listen(intermediaryServer);
    const base = `http://127.0.0.1:${intermediaryPort}`;

    const enPrime = await bodyAndCache(base, '/_q/cache-oracle?item=one', {
      'accept-language': 'en',
    });
    const enReuse = await bodyAndCache(base, '/_q/cache-oracle?item=one', {
      'accept-language': 'en',
    });
    expect(enPrime.cache).toBe('MISS');
    expect(enReuse).toMatchObject({ body: enPrime.body, cache: 'HIT' });
    expect(enPrime.vary.toLowerCase()).toBe('accept-language, x-branch');

    const queryVariant = await bodyAndCache(base, '/_q/cache-oracle?item=two', {
      'accept-language': 'en',
    });
    const headerVariant = await bodyAndCache(base, '/_q/cache-oracle?item=one', {
      'accept-language': 'fr',
    });
    const branchVariant = await bodyAndCache(base, '/_q/cache-oracle?item=one', {
      'accept-language': 'en',
      'x-branch': 'beta',
    });
    expect(queryVariant.cache).toBe('MISS');
    expect(queryVariant.body).toContain('"item":"two"');
    expect(headerVariant.cache).toBe('MISS');
    expect(headerVariant.body).toContain('"language":"fr"');
    expect(branchVariant.cache).toBe('MISS');
    expect(branchVariant.body).toContain('"branch":"beta"');

    const principalA = await bodyAndCache(base, '/_q/cache-oracle?item=one', {
      cookie: 'session=principal-a',
    });
    const principalB = await bodyAndCache(base, '/_q/cache-oracle?item=one', {
      cookie: 'session=principal-b',
    });
    const authorizationA = await bodyAndCache(base, '/_q/cache-oracle?item=one', {
      authorization: 'Bearer principal-a',
    });
    const authorizationB = await bodyAndCache(base, '/_q/cache-oracle?item=one', {
      authorization: 'Bearer principal-b',
    });
    for (const response of [principalA, principalB, authorizationA, authorizationB]) {
      expect(response.cache).toBe('MISS');
      expect(response.cacheControl).toBe('private, no-store');
    }
    expect(principalA.body).toContain('principal-a');
    expect(principalB.body).toContain('principal-b');
    expect(authorizationA.body).toContain('principal-a');
    expect(authorizationB.body).toContain('principal-b');
  });
});
