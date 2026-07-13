import { EventEmitter } from 'node:events';
import {
  Agent,
  request as httpRequest,
  createServer,
  ServerResponse as NativeServerResponse,
} from 'node:http';
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from 'node:http';
import {
  connect as http2Connect,
  createServer as createHttp2Server,
  Http2ServerRequest as NativeHttp2ServerRequest,
} from 'node:http2';
import { connect as netConnect } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { Readable } from 'node:stream';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp, createRequestHandler } from './app.js';
import { resolveRequestClientIp } from './app-load-shed.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { csrfToken } from './csrf.js';
import { domain } from './domain.js';
import { mutation } from './mutation.js';
import { nodeRequestToWebRequest, toNodeHandler, writeWebResponseToNode } from './node.js';
import { query } from './query.js';
import { endpointRequestWithoutSession, resolveKovoLifecycleRequest } from './response-posture.js';
import { route } from './route.js';
import { s } from './schema.js';

function nodeRequest(url: string): IncomingMessage {
  const request = new EventEmitter() as IncomingMessage;
  request.headers = { host: 'internal.example' };
  request.method = 'GET';
  request.socket = new EventEmitter() as Socket;
  request.url = url;
  return request;
}

describe('server node adapter', () => {
  it('uses a pinned origin for absolute-form and protocol-relative request targets', () => {
    const absolute = nodeRequestToWebRequest(nodeRequest('http://evil.example/admin?next=1'), {
      origin: 'https://app.example',
    });
    const protocolRelative = nodeRequestToWebRequest(nodeRequest('//evil.example/admin?next=1'), {
      origin: 'https://app.example',
    });
    const absoluteDoubleSlashPath = nodeRequestToWebRequest(
      nodeRequest('http://evil.example//other.example/admin?next=1'),
      { origin: 'https://app.example' },
    );

    expect(absolute.url).toBe('https://app.example/admin?next=1');
    expect(protocolRelative.url).toBe('https://app.example/evil.example/admin?next=1');
    expect(absoluteDoubleSlashPath.url).toBe('https://app.example//other.example/admin?next=1');
  });

  it('uses captured URL, Request, and Headers constructors after app evaluation', () => {
    const OriginalHeaders = globalThis.Headers;
    const OriginalRequest = globalThis.Request;
    const OriginalURL = globalThis.URL;
    try {
      globalThis.Headers = class PoisonedHeaders {
        constructor() {
          throw new Error('poisoned Headers reached');
        }
      } as never;
      globalThis.Request = class PoisonedRequest {
        constructor() {
          throw new Error('poisoned Request reached');
        }
      } as never;
      globalThis.URL = class PoisonedURL {
        constructor() {
          throw new Error('poisoned URL reached');
        }
      } as never;

      const converted = nodeRequestToWebRequest(nodeRequest('/captured?ok=1'), {
        origin: 'https://app.example',
      });
      expect(converted.url).toBe('https://app.example/captured?ok=1');
      expect(converted.headers.get('host')).toBe('internal.example');
    } finally {
      globalThis.Headers = OriginalHeaders;
      globalThis.Request = OriginalRequest;
      globalThis.URL = OriginalURL;
    }
  });

  it('trusts forwarded schemes only when the Node adapter opts into trustedProxy', () => {
    const request = nodeRequest('/account');
    request.headers = {
      host: 'app.example',
      'x-forwarded-proto': 'https',
    };
    (request.socket as Socket & { encrypted?: boolean }).encrypted = false;

    expect(nodeRequestToWebRequest(request).url).toBe('http://app.example/account');
    expect(nodeRequestToWebRequest(request, { trustedProxy: true }).url).toBe(
      'https://app.example/account',
    );
  });

  it('threads the socket peer address into default pre-dispatch per-IP limiting', async () => {
    const cartQuery = query('cart/node-peer-rate-limit', {
      load: () => ({ ok: true }),
      reads: [],
    });
    const handler = createRequestHandler(
      createApp({
        queries: [cartQuery],
        requestLimits: {
          global: false,
          maxBodyBytes: false,
          mutations: { global: false, perIp: false },
          perIp: false,
          queries: { global: false, perIp: { max: 1, windowMs: 60_000 } },
        },
      }),
    );
    const makeRequest = (remoteAddress: string) => {
      const request = Object.assign(Readable.from([]) as IncomingMessage, {
        headers: { host: 'app.example' },
        method: 'GET',
        socket: Object.assign(new EventEmitter() as Socket, { remoteAddress }),
        url: '/_q/cart/node-peer-rate-limit',
      });
      return nodeRequestToWebRequest(request);
    };

    expect((await handler(makeRequest('203.0.113.10'))).status).toBe(200);
    expect((await handler(makeRequest('203.0.113.11'))).status).toBe(200);
    expect((await handler(makeRequest('203.0.113.10'))).status).toBe(429);
  });

  it('preserves the Node peer address across authority-neutral endpoint and mutation copies', async () => {
    const app = createApp({});
    const makeRequest = () => {
      const request = Object.assign(Readable.from([]) as IncomingMessage, {
        headers: { cookie: 'sid=victim', host: 'app.example' },
        method: 'POST',
        socket: Object.assign(new EventEmitter() as Socket, {
          remoteAddress: '203.0.113.42',
        }),
        url: '/machine',
      });
      return nodeRequestToWebRequest(request);
    };
    const clientIp = (request: Request) => resolveRequestClientIp(app, request);

    const endpointRequest = await resolveKovoLifecycleRequest(makeRequest(), {
      clientIp,
      surface: 'endpoint',
    });
    const mutationRequest = await resolveKovoLifecycleRequest(
      endpointRequestWithoutSession(makeRequest()),
      {
        clientIp,
        csrf: { mode: 'exempt' },
        idempotency: { mode: 'none' },
        surface: 'mutation',
      },
    );

    expect(endpointRequest.clientIp).toBe('203.0.113.42');
    expect(endpointRequest.headers.get('cookie')).toBeNull();
    expect(mutationRequest.clientIp).toBe('203.0.113.42');
    expect(mutationRequest.headers.get('cookie')).toBeNull();
  });

  it('serves web-standard handlers through node:http with request bodies and early hints', async () => {
    const server = await serveWithNode(
      toNodeHandler(async (request) => {
        if (new URL(request.url).pathname === '/echo') {
          return new Response(await request.text(), {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              Link: '</app.css>; rel=preload; as=style',
            },
            status: 201,
            statusText: 'Created',
          });
        }

        return new Response('missing', { status: 404 });
      }),
    );

    try {
      const response = await server.fetch('/echo?tab=details', {
        body: 'hello=node',
        headers: { 'Content-Type': 'text/plain' },
        method: 'POST',
      });

      expect(response).toMatchObject({
        body: 'hello=node',
        earlyHints: [{ link: '</app.css>; rel=preload; as=style' }],
        headers: expect.objectContaining({
          'content-type': 'text/plain; charset=utf-8',
          link: '</app.css>; rel=preload; as=style',
        }),
        status: 201,
      });
    } finally {
      await server.close();
    }
  });

  it('suppresses response bodies for HEAD requests', async () => {
    const server = await serveWithNode(
      toNodeHandler(async () => new Response('body', { status: 200 })),
    );

    try {
      const response = await server.fetch('/head', { method: 'HEAD' });

      expect(response).toMatchObject({
        body: '',
        status: 200,
      });
    } finally {
      await server.close();
    }
  });

  it('can suppress early hints while preserving final Link headers', async () => {
    const server = await serveWithNode(
      toNodeHandler(
        async () =>
          new Response('asset-linked', {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              Link: '</app.css>; rel=preload; as=style',
            },
          }),
        { earlyHints: false },
      ),
    );

    try {
      const response = await server.fetch('/linked');

      expect(response).toMatchObject({
        body: 'asset-linked',
        earlyHints: [],
        headers: expect.objectContaining({
          link: '</app.css>; rel=preload; as=style',
        }),
        status: 200,
      });
    } finally {
      await server.close();
    }
  });

  it('serves multiple Early Hints Link values through node:http', async () => {
    const link = '</assets/app.css>; rel=preload; as=style, </c/app.client.js>; rel=modulepreload';
    const server = await serveWithNode(
      toNodeHandler(
        async () =>
          new Response('multi-linked', {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              Link: link,
            },
          }),
        { compression: false },
      ),
    );

    try {
      const response = await server.fetch('/multi-linked');

      expect(response).toMatchObject({
        body: 'multi-linked',
        earlyHints: [
          {
            link,
          },
        ],
        headers: expect.objectContaining({
          link,
        }),
        status: 200,
      });
    } finally {
      await server.close();
    }
  });

  it('compresses eligible text responses by default when the client accepts Brotli', async () => {
    const server = await serveWithNode(
      toNodeHandler(
        async () =>
          new Response('compress me'.repeat(128), {
            headers: {
              'Content-Length': String('compress me'.repeat(128).length),
              'Content-Type': 'text/html; charset=utf-8',
            },
          }),
      ),
    );

    try {
      const response = await server.fetch('/compressed', {
        headers: { 'Accept-Encoding': 'br,gzip' },
      });

      expect(response.headers).toMatchObject({
        'content-encoding': 'br',
        'content-type': 'text/html; charset=utf-8',
        vary: 'Accept-Encoding',
      });
      expect(response.headers['content-length']).toBeUndefined();
      expect(brotliDecompressSync(response.encodedBody).toString('utf8')).toBe(
        'compress me'.repeat(128),
      );
    } finally {
      await server.close();
    }
  });

  it('allows Node adapter compression to be opted out', async () => {
    const server = await serveWithNode(
      toNodeHandler(
        async () =>
          new Response('plain response', {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          }),
        { compression: false },
      ),
    );

    try {
      const response = await server.fetch('/plain', {
        headers: { 'Accept-Encoding': 'br,gzip' },
      });

      expect(response.headers['content-encoding']).toBeUndefined();
      expect(response.headers.vary).toBeUndefined();
      expect(response.body).toBe('plain response');
    } finally {
      await server.close();
    }
  });

  it('honors Accept-Encoding quality values when selecting gzip vs Brotli', async () => {
    const server = await serveWithNode(
      toNodeHandler(
        async () =>
          new Response('gzip preferred'.repeat(128), {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }),
      ),
    );

    try {
      const response = await server.fetch('/gzip', {
        headers: { 'Accept-Encoding': 'br;q=0.1, gzip;q=1' },
      });

      expect(response.headers['content-encoding']).toBe('gzip');
      expect(gunzipSync(response.encodedBody).toString('utf8')).toBe('gzip preferred'.repeat(128));
    } finally {
      await server.close();
    }
  });

  it('skips compression for no-transform, already encoded, bodyless, and binary responses', async () => {
    const server = await serveWithNode(
      toNodeHandler(async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/no-transform') {
          return new Response('do not transform', {
            headers: {
              'Cache-Control': 'no-transform',
              'Content-Type': 'text/plain; charset=utf-8',
            },
          });
        }
        if (pathname === '/encoded') {
          return new Response('already encoded', {
            headers: {
              'Content-Encoding': 'gzip',
              'Content-Type': 'text/plain; charset=utf-8',
            },
          });
        }
        if (pathname === '/binary') {
          return new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'Content-Type': 'application/octet-stream' },
          });
        }
        return new Response(null, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          status: 204,
        });
      }),
    );

    try {
      const requestOptions = { headers: { 'Accept-Encoding': 'br,gzip' } };
      expect(
        (await server.fetch('/no-transform', requestOptions)).headers['content-encoding'],
      ).toBeUndefined();
      expect((await server.fetch('/encoded', requestOptions)).headers['content-encoding']).toBe(
        'gzip',
      );
      expect(
        (await server.fetch('/binary', requestOptions)).headers['content-encoding'],
      ).toBeUndefined();
      expect(
        (await server.fetch('/empty', requestOptions)).headers['content-encoding'],
      ).toBeUndefined();
      expect(
        (await server.fetch('/head', { ...requestOptions, method: 'HEAD' })).headers[
          'content-encoding'
        ],
      ).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('skips default compression for private no-store and cookie-bearing responses', async () => {
    const server = await serveWithNode(
      toNodeHandler(async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/private') {
          return new Response('private response'.repeat(128), {
            headers: {
              'Cache-Control': 'private, no-store',
              'Content-Type': 'text/plain; charset=utf-8',
            },
          });
        }
        if (pathname === '/cookie') {
          return new Response('cookie response'.repeat(128), {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Set-Cookie': 'session=s1; Path=/; HttpOnly',
            },
          });
        }
        return new Response('vary cookie response'.repeat(128), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            Vary: 'Cookie',
          },
        });
      }),
    );

    try {
      const requestOptions = { headers: { 'Accept-Encoding': 'br,gzip' } };
      expect(
        (await server.fetch('/private', requestOptions)).headers['content-encoding'],
      ).toBeUndefined();
      expect(
        (await server.fetch('/cookie', requestOptions)).headers['content-encoding'],
      ).toBeUndefined();
      expect(
        (await server.fetch('/vary-cookie', requestOptions)).headers['content-encoding'],
      ).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('keeps Vary-Cookie responses uncompressed after authored collection poisoning', async () => {
    const originalIncludes = Array.prototype.includes;
    const originalReflectApply = Reflect.apply;
    const server = await serveWithNode(
      toNodeHandler(async () => {
        Array.prototype.includes = function selectiveSensitiveTokenOmission(
          searchElement: unknown,
          fromIndex?: number,
        ): boolean {
          if (searchElement === 'cookie' && this.length === 1 && this[0] === 'cookie') return false;
          return originalReflectApply(originalIncludes, this, [searchElement, fromIndex]);
        };
        return new Response('COOKIE-BOUND-SECRET'.repeat(128), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            Vary: 'Cookie',
          },
        });
      }),
    );

    try {
      const response = await server.fetch('/vary-cookie-poison', {
        headers: { 'Accept-Encoding': 'br,gzip' },
      });
      expect(response.headers['content-encoding']).toBeUndefined();
    } finally {
      Array.prototype.includes = originalIncludes;
      await server.close();
    }
  });

  it('keeps the wire Origin exact after a prior request poisons header enumeration', async () => {
    const originalEntries = Object.entries;
    const originalReflectApply = Reflect.apply;
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const csrf = {
      secret: 'node-request-bridge-csrf-secret-0123456789',
      sessionId(request: { headers?: Headers }) {
        return request.headers?.get('cookie')?.match(/(?:^|;\s*)sid=([^;]+)/)?.[1];
      },
    };
    const appHandler = createRequestHandler(
      createApp({
        csrf,
        mutations: [
          mutation('account/delete', {
            handler: mutationHandler,
            input: s.object({}),
          }),
        ],
      }),
    );
    let trustedOrigin = '';
    const server = await serveWithNode(
      toNodeHandler(async (request) => {
        if (new URL(request.url).pathname === '/arm') {
          Object.entries = function selectiveOriginSubstitution(value: object) {
            const entries = originalReflectApply(originalEntries, Object, [value]);
            if (entries.some(([name]) => name === 'origin')) {
              return entries.map(([name, entry]) => [
                name,
                name === 'origin' ? trustedOrigin : entry,
              ]);
            }
            return entries;
          } as typeof Object.entries;
          return new Response('armed');
        }
        return appHandler(request);
      }),
    );
    trustedOrigin = server.origin;

    try {
      await server.fetch('/arm');
      const form = new FormData();
      form.set(
        'kovo-csrf',
        csrfToken({ headers: new Headers({ Cookie: 'sid=victim' }) }, csrf, {
          audience: 'account/delete',
        }),
      );
      const response = await fetch(`${server.origin}/_m/account/delete`, {
        body: form,
        headers: {
          Cookie: 'sid=victim',
          Origin: 'https://attacker.example',
        },
        method: 'POST',
        redirect: 'manual',
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(mutationHandler).not.toHaveBeenCalled();
    } finally {
      Object.entries = originalEntries;
      await server.close();
    }
  });

  it('keeps request body and signal construction exact after prior-request constructor poisoning', async () => {
    const originalObjectKeys = Object.keys;
    const originalReadableToWeb = Readable.toWeb;
    const OriginalAbortController = globalThis.AbortController;
    const server = await serveWithNode(
      toNodeHandler(async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/arm-request-controls') {
          Object.keys = function selectiveHeaderKeySubstitution(value: object) {
            const keys = Reflect.apply(originalObjectKeys, Object, [value]);
            return keys.includes('origin') ? ['origin'] : keys;
          } as typeof Object.keys;
          Readable.toWeb = function attackerReadableToWeb() {
            return Reflect.apply(originalReadableToWeb, Readable, [
              Readable.from(['ATTACKER-BODY']),
            ]);
          } as typeof Readable.toWeb;
          globalThis.AbortController = class PoisonedAbortController {
            constructor() {
              throw new Error('live AbortController reached');
            }
          } as typeof AbortController;
          return new Response('armed');
        }
        return new Response(
          `${request.method}:${request.headers.get('origin')}:${await request.text()}`,
        );
      }),
    );

    try {
      await server.fetch('/arm-request-controls');
      const response = await server.fetch('/echo-request-controls', {
        body: 'VICTIM-BODY',
        headers: {
          'Content-Type': 'text/plain',
          Origin: 'https://attacker.example',
          'X-Kovo-Proof': 'kept',
        },
        method: 'POST',
      });
      expect(response.status).toBe(200);
      expect(response.body).toBe('POST:https://attacker.example:VICTIM-BODY');
    } finally {
      Object.keys = originalObjectKeys;
      Readable.toWeb = originalReadableToWeb;
      globalThis.AbortController = OriginalAbortController;
      await server.close();
    }
  });

  it('serves a SPEC §9.5 app shell surface through node:http', async () => {
    const cart = domain('cart');
    const db = { count: 0 };
    const cartQuery = query('cart', {
      load: () => ({ count: db.count }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ quantity: s.number().int().min(1).default(1) }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        db.count += input.quantity;
        return { count: db.count };
      },
    });
    const clientModules = createMemoryVersionedClientModuleRegistry();
    const clientHref = clientModules.put({
      path: '/c/cart.client.js',
      source: 'export const cartClient = true;',
      version: 'cart-v1',
    });
    const app = createApp({
      clientModules,
      mutations: [addToCart],
      queries: [cartQuery],
      routes: [
        route('/cart', {
          modulepreloads: [clientHref],
          page: () => trustedHtml(`<main>Cart ${db.count}</main>`),
        }),
      ],
    });
    const server = await serveWithNode(toNodeHandler(createRequestHandler(app)));

    try {
      const document = await server.fetch('/cart');
      expect(document).toMatchObject({
        body: expect.stringContaining('<main>Cart 0</main>'),
        headers: expect.objectContaining({
          'content-type': 'text/html; charset=utf-8',
          link: `</c/__v/cart-v1/cart.client.js>; rel=modulepreload`,
        }),
        status: 200,
      });

      const queryResponse = await server.fetch('/_q/cart');
      expect(queryResponse).toMatchObject({
        body: '<kovo-query name="cart">{"count":0}</kovo-query>',
        headers: expect.objectContaining({
          'content-type': 'text/html; charset=utf-8',
        }),
        status: 200,
      });

      const moduleResponse = await server.fetch(clientHref);
      expect(moduleResponse).toMatchObject({
        body: 'export const cartClient = true;',
        headers: expect.objectContaining({
          'cache-control': 'public, max-age=31536000, immutable',
          'cross-origin-resource-policy': 'same-origin',
          'content-type': 'text/javascript; charset=utf-8',
        }),
        status: 200,
      });

      const mutationResponse = await server.fetch('/_m/cart/add', {
        body: formBody({ quantity: '2' }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      });
      expect(mutationResponse).toMatchObject({
        body: '',
        headers: expect.objectContaining({
          location: '/',
        }),
        status: 303,
      });

      const refreshedQuery = await server.fetch('/_q/cart');
      expect(refreshedQuery).toMatchObject({
        body: '<kovo-query name="cart">{"count":2}</kovo-query>',
        status: 200,
      });
    } finally {
      await server.close();
    }
  });
});

describe('toNodeHandler incomplete request transport closure', () => {
  const oversized = (): Response =>
    new Response('Payload Too Large', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 413,
    });

  function requestHandler(): RequestListener {
    return toNodeHandler(async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/declared') return oversized();
      if (pathname === '/chunked') {
        await request.body?.getReader().read();
        return oversized();
      }
      if (pathname === '/complete') {
        await request.text();
        return oversized();
      }
      return new Response('ok');
    });
  }

  it.each([
    [
      'declared Content-Length',
      'POST /declared HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\nContent-Length: 1000000\r\n\r\n',
    ],
    [
      'unterminated chunked body',
      'POST /chunked HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nabcde\r\n',
    ],
  ])('flushes the 413 and closes an incomplete %s request', async (_shape, wireRequest) => {
    const server = await serveWithNode(requestHandler());
    try {
      const wireResponse = await rawHttpExchange(server.origin, wireRequest);
      expect(wireResponse).toContain('HTTP/1.1 413');
      expect(wireResponse).toMatch(/connection: close/i);
      expect(wireResponse).toContain('Payload Too Large');
    } finally {
      await server.close();
    }
  });

  it('keeps a completed request reusable on the same keep-alive connection', async () => {
    const sockets: Socket[] = [];
    const nodeHandler = requestHandler();
    const server = await serveWithNode((request, response) => {
      if (!sockets.includes(request.socket)) sockets.push(request.socket);
      return nodeHandler(request, response);
    });
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });

    try {
      const first = await keepAliveRequest(server.origin, '/complete', agent, {
        body: 'abcde',
        headers: { 'Content-Length': '5' },
        method: 'POST',
      });
      const second = await keepAliveRequest(server.origin, '/ok', agent);

      expect(first).toEqual({ body: 'Payload Too Large', status: 413 });
      expect(second).toEqual({ body: 'ok', status: 200 });
      expect(sockets).toHaveLength(1);
    } finally {
      agent.destroy();
      await server.close();
    }
  });

  it('rejects encoded mutation path aliases before policy or handler dispatch', async () => {
    const db = vi.fn(() => ({}));
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const app = createApp({
      db,
      mutations: [
        mutation('a/b', {
          csrf: false,
          csrfJustification: 'test fixture uses a non-browser caller',
          handler: mutationHandler,
          input: s.object({}),
        }),
      ],
      requestLimits: {
        global: false,
        maxBodyBytes: 1_024,
        mutations: { global: false, perIp: false },
        perIp: false,
        queries: { global: false, perIp: false },
      },
    });
    const server = await serveWithNode(toNodeHandler(createRequestHandler(app)));
    const credential = 'NODE_ALIAS_CREDENTIAL_MUST_NOT_ECHO';
    const aliases = [
      '/%2e/_m/a/b',
      '/x/%2e%2e/_m/a/b',
      '//_m/a/b',
      '////_m/a/b',
      '/_m/a/%2e/b',
      '/_m/a/%2E/b',
      '/_m/x/a/%2e%2E/b',
      '/_m/a/%2f/b',
      '/_m/a/%5C/b',
      '/_m/a/./b',
      '/_m/x/a/../b',
      'http://proxy.invalid/_m/a/%2e/b',
      'http://attacker.test/_m/a/b',
    ];
    aliases.push(`${server.origin}/_m/a/b`);

    try {
      for (const target of aliases) {
        const wireResponse = await rawHttpExchange(
          server.origin,
          mutationWireRequest(target, credential),
        );
        expect(wireResponse).toContain('HTTP/1.1 404');
        expect(wireResponse).toContain('Not Found');
        expect(wireResponse).toMatch(/cache-control: no-store/i);
        expect(wireResponse).not.toContain(target);
        expect(wireResponse).not.toContain(credential);
      }

      expect(db).not.toHaveBeenCalled();
      expect(mutationHandler).not.toHaveBeenCalled();

      const canonical = await rawHttpExchange(
        server.origin,
        mutationWireRequest('/_m/a/b', credential),
      );
      expect(canonical).toContain('HTTP/1.1 303');
      expect(mutationHandler).toHaveBeenCalledTimes(1);
      expect(db).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });

  it('refuses an encoded reserved mutation target in direct Node request conversion', () => {
    for (const target of [
      '/%2e/_m/a/b',
      '/x/%2e%2e/_m/a/b',
      '//_m/a/b',
      '////_m/a/b',
      '/_m/a/%2e/b',
      '\\_m\\a\\b',
      'http://attacker.test/_m/a/b',
      'https://internal.example/_m/a/b',
      'http://proxy.invalid\\_m\\a\\%2e\\b',
    ]) {
      const request = nodeRequest(target);
      request.method = 'POST';
      expect(() => nodeRequestToWebRequest(request)).toThrow(
        'Reserved mutation request targets must use their canonical raw path.',
      );
    }

    expect(
      nodeRequestToWebRequest(nodeRequest('/_m/a/b'), { origin: 'https://internal.example' }).url,
    ).toBe('https://internal.example/_m/a/b');
  });

  it('keeps raw mutation target classification after String, RegExp, and Math poisoning', () => {
    const originalStartsWith = String.prototype.startsWith;
    const originalIncludes = String.prototype.includes;
    const originalRegExpTest = RegExp.prototype.test;
    const originalMin = Math.min;
    String.prototype.startsWith = () => false;
    String.prototype.includes = () => false;
    RegExp.prototype.test = () => false;
    Math.min = () => 1 / 0;
    try {
      for (const target of [
        '/_m/a/%2f/b',
        '/_m/a/%2e/b',
        '/_m/a/./b',
        '\\_m\\a\\b',
        'http://attacker.test/_m/a/b',
      ]) {
        const request = nodeRequest(target);
        request.method = 'POST';
        expect(() => nodeRequestToWebRequest(request)).toThrow(
          'Reserved mutation request targets must use their canonical raw path.',
        );
      }

      expect(
        nodeRequestToWebRequest(nodeRequest('/_m/a/b'), { origin: 'https://internal.example' }).url,
      ).toBe('https://internal.example/_m/a/b');
    } finally {
      String.prototype.startsWith = originalStartsWith;
      String.prototype.includes = originalIncludes;
      RegExp.prototype.test = originalRegExpTest;
      Math.min = originalMin;
    }
  });
});

describe('responseHeadersToNodeHeaders (B1)', () => {
  it('pins the final Response fields before authored prototype replacements can substitute output', async () => {
    const properties = ['body', 'headers', 'status', 'statusText'] as const;
    const descriptors = new Map(
      properties.map((property) => [
        property,
        Object.getOwnPropertyDescriptor(Response.prototype, property)!,
      ]),
    );
    const safe = new Response('SAFE-RESPONSE', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      status: 200,
    });
    const attacker = new Response('<script>attackerOutput()</script>', {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': 'admin=attacker; Path=/; HttpOnly',
      },
      status: 201,
      statusText: 'ATTACKER',
    });
    const server = await serveWithNode(
      toNodeHandler(async () => {
        for (const property of properties) {
          const descriptor = descriptors.get(property)!;
          Object.defineProperty(Response.prototype, property, {
            ...descriptor,
            get(this: Response) {
              return Reflect.apply(descriptor.get!, this === safe ? attacker : this, []);
            },
          });
        }
        return safe;
      }),
    );

    try {
      const response = await fetch(server.origin);

      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toBeNull();
      await expect(response.text()).resolves.toBe('SAFE-RESPONSE');
    } finally {
      for (const property of properties) {
        Object.defineProperty(Response.prototype, property, descriptors.get(property)!);
      }
      await server.close();
    }
  });

  it('pins native response writers before an authored handler can replace the transport', async () => {
    const originalWriteHead = NativeServerResponse.prototype.writeHead;
    const originalEnd = NativeServerResponse.prototype.end;
    const server = await serveWithNode(
      toNodeHandler(async () => {
        NativeServerResponse.prototype.writeHead = function attackerWriteHead() {
          return Reflect.apply(originalWriteHead, this, [
            202,
            'ATTACKER',
            {
              'content-type': 'text/html; charset=utf-8',
              'set-cookie': 'admin=attacker; Path=/; HttpOnly',
            },
          ]);
        } as typeof NativeServerResponse.prototype.writeHead;
        NativeServerResponse.prototype.end = function attackerEnd() {
          return Reflect.apply(originalEnd, this, ['<script>nativeTransportAttacker()</script>']);
        } as typeof NativeServerResponse.prototype.end;
        return new Response('SAFE-NATIVE-TRANSPORT', {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          status: 200,
        });
      }),
    );

    try {
      const response = await fetch(server.origin);
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toBeNull();
      await expect(response.text()).resolves.toBe('SAFE-NATIVE-TRANSPORT');
    } finally {
      NativeServerResponse.prototype.writeHead = originalWriteHead;
      NativeServerResponse.prototype.end = originalEnd;
      await server.close();
    }
  });

  // SPEC §9.4/§9.1.1: multiple Set-Cookie headers must not be collapsed to the last.
  it('preserves multiple Set-Cookie headers as a string array (B1)', async () => {
    const response = new Response(null, { status: 200 });
    response.headers.append('set-cookie', 'session=abc; HttpOnly; Path=/');
    response.headers.append('set-cookie', 'csrf=xyz; SameSite=Strict; Path=/');

    let capturedSetCookie: string | string[] | undefined;
    const fakeNodeResponse = {
      writeHead: vi.fn(
        (_status: number, _statusText: string, headers: Record<string, string | string[]>) => {
          capturedSetCookie = headers['set-cookie'];
        },
      ),
      end: vi.fn(),
    } as unknown as ServerResponse;

    await writeWebResponseToNode(response, fakeNodeResponse, 'GET');

    expect(Array.isArray(capturedSetCookie)).toBe(true);
    const cookies = capturedSetCookie as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toBe('session=abc; HttpOnly; Path=/');
    expect(cookies[1]).toBe('csrf=xyz; SameSite=Strict; Path=/');
  });
});

describe('toNodeHandler mid-stream error handling (E1)', () => {
  // SPEC §9.5/§9.2: a streaming render that throws AFTER the first chunk must not append
  // "Internal Server Error" onto the already-committed 200 body. The headersSent guard only
  // protected writeHead; the catch still ran end('Internal Server Error'), yielding a 200
  // whose body was "partial-Internal Server Error". The fix tears the socket (destroy) on
  // the pipe error path so the client sees a truncated/aborted read, never a corrupt 200.
  it('aborts the transfer instead of corrupting a committed 200 body when the stream throws mid-flight', async () => {
    const server = await serveWithNode(
      toNodeHandler(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial-'));
          },
          pull() {
            throw new Error('boom mid-stream');
          },
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          status: 200,
        });
      }),
    );

    try {
      const outcome = await server.fetchRaw('/stream-error');
      // The client must NEVER observe a clean 200 with appended error text.
      if (outcome.kind === 'response') {
        expect(outcome.body).not.toContain('Internal Server Error');
        expect(outcome.body).not.toBe('partial-Internal Server Error');
        // A committed 200 that then errors must surface as a transport error
        // (aborted/incomplete read), not a successful completed body.
        expect(outcome.complete).toBe(false);
      } else {
        // The socket was torn down — a transport-level error is the acceptable signal.
        expect(outcome.kind).toBe('error');
      }
    } finally {
      await server.close();
    }
  });
});

describe('nodeRequestToWebRequest HTTP/2 pseudo-headers (E2)', () => {
  // SPEC §9.5: under Node's HTTP/2 compat API, req.headers carries :path/:method/:authority/
  // :scheme. The web Headers constructor rejects names starting with ':', so the copy loop
  // threw synchronously → every HTTP/2 request answered 500. The fix skips pseudo-headers.
  it('serves an HTTP/2 request without 500ing on the :path/:method pseudo-headers', async () => {
    const nodeHandler = toNodeHandler(async (request) => {
      const url = new URL(request.url);
      return new Response(`ok ${url.pathname}`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status: 200,
      });
    });
    // The Node http2 compat (req,res) are structurally compatible with the http1
    // handler at runtime (this test proves E2 — pseudo-headers no longer throw);
    // cast through the http2 callback shape to satisfy createServer's typing.
    const server = createHttp2Server((req, res) => {
      void (nodeHandler as (q: unknown, s: unknown) => unknown)(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const client = http2Connect(`http://127.0.0.1:${address.port}`);

    try {
      const { status, body } = await new Promise<{ body: string; status: number }>(
        (resolve, reject) => {
          const req = client.request({ ':method': 'GET', ':path': '/h2-path' });
          let received = '';
          let statusCode = 0;
          req.on('response', (headers) => {
            statusCode = Number(headers[':status'] ?? 0);
          });
          req.setEncoding('utf8');
          req.on('data', (chunk: string) => {
            received += chunk;
          });
          req.on('end', () => resolve({ body: received, status: statusCode }));
          req.on('error', reject);
          req.end();
        },
      );

      expect(status).toBe(200);
      expect(body).toBe('ok /h2-path');
    } finally {
      client.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('uses boot-captured HTTP/2 request getters after a prior handler poisons the prototypes', async () => {
    const methodDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttp2ServerRequest.prototype,
      'method',
    )!;
    const urlDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttp2ServerRequest.prototype,
      'url',
    )!;
    const headersDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttp2ServerRequest.prototype,
      'headers',
    )!;
    const httpVersionDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttp2ServerRequest.prototype,
      'httpVersion',
    )!;
    const poison = (): void => {
      Object.defineProperty(NativeHttp2ServerRequest.prototype, 'method', {
        ...methodDescriptor,
        get: () => 'POST',
      });
      Object.defineProperty(NativeHttp2ServerRequest.prototype, 'url', {
        ...urlDescriptor,
        get: () => '/forged-target',
      });
      Object.defineProperty(NativeHttp2ServerRequest.prototype, 'headers', {
        ...headersDescriptor,
        get: () => ({
          ':authority': 'trusted.example',
          ':scheme': 'https',
          origin: 'https://trusted.example',
        }),
      });
      Object.defineProperty(NativeHttp2ServerRequest.prototype, 'httpVersion', {
        ...httpVersionDescriptor,
        get: () => '1.0',
      });
    };
    const restore = (): void => {
      Object.defineProperty(NativeHttp2ServerRequest.prototype, 'method', methodDescriptor);
      Object.defineProperty(NativeHttp2ServerRequest.prototype, 'url', urlDescriptor);
      Object.defineProperty(NativeHttp2ServerRequest.prototype, 'headers', headersDescriptor);
      Object.defineProperty(
        NativeHttp2ServerRequest.prototype,
        'httpVersion',
        httpVersionDescriptor,
      );
    };
    const nodeHandler = toNodeHandler(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/arm-h2-request-controls') {
        poison();
        return new Response('armed');
      }
      return new Response(
        `${request.method}:${url.pathname}:${request.headers.get('origin')}:${url.protocol}`,
      );
    });
    const server = createHttp2Server((request, response) => {
      void (nodeHandler as (q: unknown, s: unknown) => unknown)(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const client = http2Connect(`http://127.0.0.1:${address.port}`);
    const exchange = (headers: Record<string, string>): Promise<string> =>
      new Promise((resolve, reject) => {
        const request = client.request(headers);
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
          body += chunk;
        });
        request.on('end', () => resolve(body));
        request.on('error', reject);
        request.end();
      });

    try {
      await expect(
        exchange({ ':method': 'GET', ':path': '/arm-h2-request-controls' }),
      ).resolves.toBe('armed');
      await expect(
        exchange({
          ':authority': `127.0.0.1:${address.port}`,
          ':method': 'GET',
          ':path': '/exact-h2-target',
          ':scheme': 'http',
          origin: 'https://attacker.example',
        }),
      ).resolves.toBe('GET:/exact-h2-target:https://attacker.example:http:');
    } finally {
      restore();
      client.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe('nodeRequestToWebRequest client disconnect (E3)', () => {
  // SPEC §9.5: a client disconnect must propagate to request.signal so handlers/queries and
  // any downstream fetch(url, { signal: request.signal }) abort instead of running against a
  // dead socket. Previously RequestInit carried no signal and nothing bridged 'aborted'/'close'.
  it('aborts request.signal when the client destroys the connection mid-handler', async () => {
    let observedSignal: AbortSignal | undefined;
    const aborted = new Promise<boolean>((resolve) => {
      const server = createServer(
        toNodeHandler(async (request) => {
          observedSignal = request.signal;
          request.signal.addEventListener('abort', () => resolve(true), { once: true });
          // Never resolve on our own; only the client disconnect should abort us.
          await new Promise<void>(() => undefined);
          return new Response('unreachable');
        }),
      );
      void serverHandleForAbort(server, resolve);
    });

    expect(await aborted).toBe(true);
    expect(observedSignal?.aborted).toBe(true);
  });
});

describe('nodeRequestToWebRequest keep-alive listener hygiene (K1)', () => {
  // SPEC §9.5: the client-disconnect bridge (E3) must not accumulate one socket 'close'
  // listener + AbortController per request on a reused keep-alive connection. Without
  // cleanup, each request permanently retains a listener (and its closed-over Request/
  // AbortController), an unbounded attacker-controlled leak culminating in
  // MaxListenersExceededWarning (>10).
  it('does not accumulate socket close listeners across sequential keep-alive requests', async () => {
    const observedSockets: Socket[] = [];
    const server = await serveWithNode((nodeRequest, nodeResponse) => {
      if (nodeRequest.socket && !observedSockets.includes(nodeRequest.socket)) {
        observedSockets.push(nodeRequest.socket);
      }
      return toNodeHandler(async () => new Response('ok', { status: 200 }))(
        nodeRequest,
        nodeResponse,
      );
    });
    // A single keep-alive connection reused across every request.
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });

    try {
      const requestCount = 12;
      for (let i = 0; i < requestCount; i += 1) {
        const outcome = await keepAliveGet(server.origin, '/keepalive', agent);
        expect(outcome.status).toBe(200);
        expect(outcome.body).toBe('ok');
      }

      // All requests should have ridden the same reused socket (keep-alive).
      expect(observedSockets).toHaveLength(1);
      const socket = observedSockets[0]!;
      // The bridge attaches a 'close' listener per request; with cleanup the count
      // must stay bounded (well under Node's default-10 warning threshold), not ~12.
      expect(socket.listenerCount('close')).toBeLessThan(requestCount);
      expect(socket.listenerCount('close')).toBeLessThanOrEqual(2);
    } finally {
      agent.destroy();
      await server.close();
    }
  });
});

describe('writeWebResponseToNode early hints HTTP version gating (L16-2)', () => {
  // RFC 8297: 103 Early Hints is an HTTP/1.1+ feature. Sending a 1xx informational
  // response to an HTTP/1.0 client that cannot parse interim responses desynchronizes
  // the connection. Gate writeEarlyHints on httpVersion !== '1.0'.
  it('suppresses 103 Early Hints for HTTP/1.0 requests', () => {
    const earlyHintCalls: { link: string | string[] }[] = [];
    const headWrites: number[] = [];
    const nodeResponse = {
      headersSent: false,
      writeEarlyHints(hints: { link: string | string[] }) {
        earlyHintCalls.push(hints);
      },
      writeHead(status: number) {
        headWrites.push(status);
        return this;
      },
      end() {
        return this;
      },
    } as unknown as ServerResponse;

    const response = new Response(null, {
      headers: { Link: '</app.css>; rel=preload; as=style' },
      status: 200,
    });

    void writeWebResponseToNode(response, nodeResponse, 'GET', { httpVersion: '1.0' });

    expect(earlyHintCalls).toHaveLength(0);
    expect(headWrites).toEqual([200]);
  });

  it('still sends 103 Early Hints for HTTP/1.1 requests', () => {
    const earlyHintCalls: { link: string | string[] }[] = [];
    const nodeResponse = {
      headersSent: false,
      writeEarlyHints(hints: { link: string | string[] }) {
        earlyHintCalls.push(hints);
      },
      writeHead() {
        return this;
      },
      end() {
        return this;
      },
    } as unknown as ServerResponse;

    const response = new Response(null, {
      headers: { Link: '</app.css>; rel=preload; as=style' },
      status: 200,
    });

    void writeWebResponseToNode(response, nodeResponse, 'GET', { httpVersion: '1.1' });

    expect(earlyHintCalls).toEqual([{ link: '</app.css>; rel=preload; as=style' }]);
  });

  it('passes multiple Link hints to Node as separate early-hint values', () => {
    const earlyHintCalls: { link: string | string[] }[] = [];
    const nodeResponse = {
      headersSent: false,
      writeEarlyHints(hints: { link: string | string[] }) {
        earlyHintCalls.push(hints);
      },
      writeHead() {
        return this;
      },
      end() {
        return this;
      },
    } as unknown as ServerResponse;

    const response = new Response(null, {
      headers: {
        Link: '</app.css>; rel=preload; as=style, </routes/questions.css>; rel=preload; as=style',
      },
      status: 200,
    });

    void writeWebResponseToNode(response, nodeResponse, 'GET', { httpVersion: '1.1' });

    expect(earlyHintCalls).toEqual([
      {
        link: [
          '</app.css>; rel=preload; as=style',
          '</routes/questions.css>; rel=preload; as=style',
        ],
      },
    ]);
  });
});

function keepAliveGet(
  origin: string,
  pathname: string,
  agent: Agent,
): Promise<{ body: string; status: number }> {
  return keepAliveRequest(origin, pathname, agent);
}

function keepAliveRequest(
  origin: string,
  pathname: string,
  agent: Agent,
  options: NodeTestRequestOptions = {},
): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      `${origin}${pathname}`,
      {
        agent,
        headers: options.headers,
        method: options.method ?? 'GET',
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

async function rawHttpExchange(origin: string, wireRequest: string): Promise<string> {
  const url = new URL(origin);
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = netConnect({ host: url.hostname, port: Number(url.port) });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for the incomplete HTTP request socket to close.'));
    }, 2_000);

    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('connect', () => socket.write(wireRequest));
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

function mutationWireRequest(target: string, credential: string): string {
  return [
    `POST ${target} HTTP/1.1`,
    'Host: 127.0.0.1',
    'Connection: close',
    `Authorization: Bearer ${credential}`,
    `Cookie: sid=${credential}`,
    'Content-Type: application/x-www-form-urlencoded',
    'Content-Length: 0',
    '',
    '',
  ].join('\r\n');
}

async function serverHandleForAbort(
  server: ReturnType<typeof createServer>,
  resolveOnAbort: (value: boolean) => void,
): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const req = httpRequest({
    host: '127.0.0.1',
    method: 'GET',
    path: '/abort',
    port: address.port,
  });
  req.on('error', () => undefined);
  req.end();
  // Give the server a tick to enter the handler, then tear down the client socket.
  setTimeout(() => req.destroy(), 50);
  // Safety net: if abort never fires, fail the wait after a bounded delay.
  setTimeout(() => {
    server.close();
    resolveOnAbort(false);
  }, 3_000);
}

interface NodeTestResponse {
  body: string;
  earlyHints: IncomingHttpHeaders[];
  encodedBody: Buffer;
  headers: IncomingHttpHeaders;
  status: number;
}

type NodeFetchOutcome =
  | { body: string; complete: boolean; kind: 'response'; status: number }
  | { kind: 'error' };

async function serveWithNode(handler: RequestListener): Promise<{
  close(): Promise<void>;
  fetch(pathname: string, options?: NodeTestRequestOptions): Promise<NodeTestResponse>;
  fetchRaw(pathname: string, options?: NodeTestRequestOptions): Promise<NodeFetchOutcome>;
  origin: string;
}> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    fetch(pathname, options = {}) {
      return nodeFetch(`${origin}${pathname}`, options);
    },
    fetchRaw(pathname, options = {}) {
      return nodeFetchRaw(`${origin}${pathname}`, options);
    },
    origin,
  };
}

// Like nodeFetch but reports whether the body read completed cleanly. A mid-stream server
// error that tears the socket surfaces either as a request/response 'error' (kind:'error')
// or as a response whose `complete` flag is false (aborted/truncated read).
async function nodeFetchRaw(
  url: string,
  options: NodeTestRequestOptions = {},
): Promise<NodeFetchOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: NodeFetchOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const request = httpRequest(
      url,
      { headers: options.headers, method: options.method ?? 'GET' },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', () => finish({ kind: 'error' }));
        response.on('aborted', () =>
          finish({
            body: Buffer.concat(chunks).toString('utf8'),
            complete: false,
            kind: 'response',
            status: response.statusCode ?? 0,
          }),
        );
        response.on('end', () =>
          finish({
            body: Buffer.concat(chunks).toString('utf8'),
            // `complete` is false when the connection terminated before the full body.
            complete: response.complete,
            kind: 'response',
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.on('error', () => finish({ kind: 'error' }));
    request.end(options.body);
  });
}

interface NodeTestRequestOptions {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
}

function formBody(fields: Record<string, string>): string {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    body.set(name, value);
  }
  return body.toString();
}

async function nodeFetch(
  url: string,
  options: NodeTestRequestOptions = {},
): Promise<NodeTestResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        headers: options.headers,
        method: options.method ?? 'GET',
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const encodedBody = Buffer.concat(chunks);
          resolve({
            body: encodedBody.toString('utf8'),
            earlyHints,
            encodedBody,
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    const earlyHints: IncomingHttpHeaders[] = [];
    request.on('information', (response: IncomingMessage) => {
      if (response.statusCode === 103) earlyHints.push(response.headers);
    });
    request.on('error', reject);
    request.end(options.body);
  });
}
