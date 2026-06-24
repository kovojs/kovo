import { publicAccess } from './access.js';
import { createHmac } from 'node:crypto';
import { hmacSignature } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { KovoApp } from './app-types.js';
import { dispatchMatchedAppRequest } from './app-dispatch.js';
import { csrfToken } from './csrf.js';
import { endpoint, type EndpointResponsePosture } from './endpoint.js';
import { matchShellDispatch, type ShellDispatchMatch } from './shell.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { route } from './route.js';
import { s } from './schema.js';

const rawTextResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

describe('server app matched dispatch boundary', () => {
  it('owns SPEC §9.5 client-module dispatch through the app registry', async () => {
    const app = createApp();
    const href = app.clientModules.put({
      path: '/c/cart.client.js',
      source: 'export const cart = "ok";',
      version: 'v1',
    });
    const request = new Request(`https://shop.example.test${href}`);

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expect(response.text()).resolves.toBe('export const cart = "ok";');
  });

  it('owns SPEC §9.5 query endpoint dispatch with request/session wiring', async () => {
    let sessionReads = 0;
    const cart = query('cart', {
      access: publicAccess('test fixture'),
      args: s.object({ id: s.string() }),
      load(
        input: { id: string },
        context?: { request: Request & { session?: { user: { id: string } } } },
      ) {
        return { count: 2, id: input.id, user: context?.request.session?.user.id };
      },
      reads: [],
      version: 'q1',
    });
    const app = createApp({
      queries: [cart],
      sessionProvider() {
        sessionReads += 1;
        return { user: { id: 'u1' } };
      },
    });
    const request = new Request('https://shop.example.test/_q/cart?id=c1');

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toContain('"user":"u1"');
    expect(sessionReads).toBe(1);
  });

  it('does not expose request.signUrl inside typed-read query loaders', async () => {
    const signedUrlQuery = query('signed-url-query', {
      access: publicAccess('test fixture'),
      load(_input, context?: { request: Request & { signUrl?: unknown } }) {
        return {
          hasSignUrl: 'signUrl' in (context?.request ?? {}),
          signUrlType: typeof context?.request.signUrl,
        };
      },
      reads: [],
    });
    const app = createApp({
      capabilityUrls: { secret: 'query-capability-secret' },
      queries: [signedUrlQuery],
    });
    const request = new Request('https://shop.example.test/_q/signed-url-query');

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"hasSignUrl":false');
    expect(body).toContain('"signUrlType":"undefined"');
  });

  it('owns SPEC §9.5 raw endpoint dispatch without app session leakage', async () => {
    const status = endpoint('/status', {
      access: publicAccess('test fixture'),
      handler(request) {
        return new Response(`session:${'session' in request}`);
      },
      method: 'GET',
      reason: 'status endpoint session isolation test',
      response: rawTextResponse,
    });
    const app = createApp({
      endpoints: [status],
      sessionProvider() {
        return { user: { id: 'u1' } };
      },
    });
    const request = new Request('https://shop.example.test/status');

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('session:false');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'enforces default endpoint CSRF before %s handler dispatch',
    async (method) => {
      let handlerCalls = 0;
      const updateEmail = endpoint('/account/email', {
        access: publicAccess('test fixture'),
        handler() {
          handlerCalls += 1;
          return new Response('updated');
        },
        method,
        reason: 'account email update endpoint',
        response: rawTextResponse,
      });
      const app = createApp({
        csrf: { secret: 'endpoint-secret', sessionId: () => 's1' },
        endpoints: [updateEmail],
      });
      const requestInit: RequestInit = { method };
      if (method !== 'GET' && method !== 'HEAD') {
        requestInit.body = new URLSearchParams({ email: 'ada@example.com' });
      }
      const request = new Request('https://shop.example.test/account/email', requestInit);

      const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

      expect(response.status).toBe(422);
      await expect(response.text()).resolves.toBe('CSRF');
      expect(handlerCalls).toBe(0);
    },
  );

  it('allows default endpoint CSRF requests with a valid token', async () => {
    let handlerCalls = 0;
    const updateEmail = endpoint('/account/email', {
      access: publicAccess('test fixture'),
      handler() {
        handlerCalls += 1;
        return new Response('updated');
      },
      method: 'POST',
      reason: 'account email update endpoint',
      response: rawTextResponse,
    });
    const csrf = { secret: 'endpoint-secret', sessionId: () => 's1' };
    const app = createApp({ csrf, endpoints: [updateEmail] });
    const request = new Request('https://shop.example.test/account/email', {
      body: new URLSearchParams({
        email: 'ada@example.com',
        'kovo-csrf': csrfToken({} as Request, csrf),
      }),
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('updated');
    expect(handlerCalls).toBe(1);
  });

  it('enforces executable endpoint auth before CSRF or handler dispatch', async () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      payload: (request) => request.payload,
      secret: 'endpoint-secret',
    });
    let handlerCalls = 0;
    const signedEndpoint = endpoint('/machine/signed', {
      access: publicAccess('test fixture'),
      auth: { kind: 'verifier', name: verifier.resolved.scheme, verify: verifier },
      handler() {
        handlerCalls += 1;
        return new Response('signed');
      },
      method: 'POST',
      reason: 'signed machine endpoint',
      response: rawTextResponse,
    });
    const app = createApp({
      csrf: { secret: 'csrf-secret', sessionId: () => 's1' },
      endpoints: [signedEndpoint],
    });
    const body = 'payload';
    const badSignature = createHmac('sha256', 'endpoint-secret').update('other').digest('hex');
    const badRequest = new Request('https://shop.example.test/machine/signed', {
      body,
      headers: { 'x-signature': badSignature },
      method: 'POST',
    });

    const badResponse = await dispatchMatchedAppRequest(matchedAppRequest(app, badRequest));

    expect(badResponse.status).toBe(401);
    await expect(badResponse.text()).resolves.toBe('Unauthorized');
    expect(handlerCalls).toBe(0);

    const goodSignature = createHmac('sha256', 'endpoint-secret').update(body).digest('hex');
    const goodRequest = new Request('https://shop.example.test/machine/signed', {
      body,
      headers: { 'x-signature': goodSignature },
      method: 'POST',
    });

    const goodResponse = await dispatchMatchedAppRequest(matchedAppRequest(app, goodRequest));

    expect(goodResponse.status).toBe(422);
    await expect(goodResponse.text()).resolves.toBe('CSRF');
    expect(handlerCalls).toBe(0);
  });

  it('preserves raw body dispatch for explicitly CSRF-exempt endpoints', async () => {
    let handlerCalls = 0;
    const signedWebhook = endpoint('/webhooks/signed', {
      access: publicAccess('test fixture'),
      csrf: false,
      csrfJustification: 'signed webhook validates raw body',
      async handler(request) {
        handlerCalls += 1;
        return new Response(await request.text(), { status: 202 });
      },
      method: 'POST',
      reason: 'signed webhook raw body dispatch',
      response: rawTextResponse,
    });
    const app = createApp({
      csrf: { secret: 'endpoint-secret', sessionId: () => 's1' },
      endpoints: [signedWebhook],
    });
    const request = new Request('https://shop.example.test/webhooks/signed', {
      body: '{"event":"ok"}',
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe('{"event":"ok"}');
    expect(handlerCalls).toBe(1);
  });

  it('owns SPEC §9.5 page method rejection after route matching', async () => {
    const product = route('/products/:id', { access: publicAccess('test fixture') });
    const app = createApp({ routes: [product] });
    const request = new Request('https://shop.example.test/products/p1', { method: 'POST' });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    await expect(response.text()).resolves.toBe('Method Not Allowed');
  });

  it('shares mutation method rejection without replaying the mutation lifecycle', async () => {
    let handlerCalls = 0;
    const addToCart = mutation('cart/add', {
      access: publicAccess('test fixture'),
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });
    const app = createApp({ mutations: [addToCart] });
    const request = new Request('https://shop.example.test/_m/cart/add', { method: 'HEAD' });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    await expect(response.text()).resolves.toBe('');
    expect(handlerCalls).toBe(0);
  });

  it('owns SPEC §9.5 not-found dispatch through configured error shells', async () => {
    const app = createApp({
      errorShells: {
        notFound() {
          return {
            body: '<h1>Missing</h1>',
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status: 404,
          };
        },
      },
    });
    const request = new Request('https://shop.example.test/missing');

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(404);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("base-uri 'self'");
    expect(response.headers.get('content-security-policy')).toContain("object-src 'none'");
    expect(response.headers.get('content-security-policy')).toContain("form-action 'self'");
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.text()).resolves.toBe('<h1>Missing</h1>');
  });

  // H2 (medium) — SPEC §9.4: /_q/ is a credentialed GET endpoint; non-GET/HEAD methods
  // must be rejected 405 with Allow: GET, HEAD so they cannot be used as a no-CSRF read channel.

  it('H2: rejects POST to /_q/<key> with 405 Allow:GET,HEAD without running the query', async () => {
    let loadCalls = 0;
    const cart = query('cart', {
      access: publicAccess('test fixture'),
      load() {
        loadCalls += 1;
        return { count: 1 };
      },
      reads: [],
    });
    const app = createApp({ queries: [cart] });
    const request = new Request('https://shop.example.test/_q/cart', { method: 'POST' });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(loadCalls).toBe(0);
  });

  it('H2: rejects DELETE to /_q/<key> with 405 Allow:GET,HEAD without running the query', async () => {
    let loadCalls = 0;
    const cart = query('cart', {
      access: publicAccess('test fixture'),
      load() {
        loadCalls += 1;
        return { count: 1 };
      },
      reads: [],
    });
    const app = createApp({ queries: [cart] });
    const request = new Request('https://shop.example.test/_q/cart', { method: 'DELETE' });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(loadCalls).toBe(0);
  });
});

function matchedAppRequest(
  app: KovoApp,
  request: Request,
): {
  app: KovoApp;
  match: ShellDispatchMatch<KovoApp['routes'][number], KovoApp['endpoints'][number]>;
  request: Request;
  url: URL;
} {
  const url = new URL(request.url);
  return {
    app,
    match: matchShellDispatch({
      endpoints: app.endpoints,
      method: request.method,
      pathname: url.pathname,
      routes: app.routes,
    }),
    request,
    url,
  };
}
