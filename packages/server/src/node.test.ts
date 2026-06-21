import { Agent, request as httpRequest, createServer } from 'node:http';
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from 'node:http';
import { connect as http2Connect, createServer as createHttp2Server } from 'node:http2';
import type { AddressInfo, Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { domain } from './domain.js';
import { mutation } from './mutation.js';
import { toNodeHandler, writeWebResponseToNode } from './node.js';
import { query } from './query.js';
import { route } from './route.js';
import { s } from './schema.js';

describe('server node adapter', () => {
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

  it('serves a SPEC §9.5 app shell surface through node:http', async () => {
    const cart = domain('cart');
    const db = { count: 0 };
    const cartQuery = query('cart', {
      load: () => ({ count: db.count }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
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
    const app = createApp({
      mutations: [addToCart],
      queries: [cartQuery],
      routes: [
        route('/cart', {
          modulepreloads: [],
          page: () => `<main>Cart ${db.count}</main>`,
        }),
      ],
    });
    const clientHref = app.clientModules.put({
      path: '/c/cart.client.js',
      source: 'export const cartClient = true;',
      version: 'cart-v1',
    });
    app.routes[0]!.modulepreloads = [clientHref];
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

describe('responseHeadersToNodeHeaders (B1)', () => {
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
});

function keepAliveGet(
  origin: string,
  pathname: string,
  agent: Agent,
): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}${pathname}`, { agent, method: 'GET' }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () =>
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          status: response.statusCode ?? 0,
        }),
      );
    });
    request.on('error', reject);
    request.end();
  });
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
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            earlyHints,
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
