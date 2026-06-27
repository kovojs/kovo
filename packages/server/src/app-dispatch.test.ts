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

  it('owns SPEC §9.5 raw endpoint dispatch without app session leakage', async () => {
    const status = endpoint('/status', {
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
      headers: { Origin: 'https://shop.example.test' },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('updated');
    expect(handlerCalls).toBe(1);
  });

  it('L15: accepts a JSON endpoint POST whose valid kovo-csrf token rides in the JSON body (SPEC §9.1)', async () => {
    // bugz-3 L15: default endpoint CSRF read the token only via formData(), which throws on
    // an application/json body, so a legitimate JSON endpoint POST (SPEC.md §9.1 routes
    // ad-hoc JSON APIs through endpoint()) always 422'd even with a valid token + Origin.
    let handlerCalls = 0;
    let seenBody = '';
    const updateEmail = endpoint('/account/email', {
      async handler(request) {
        handlerCalls += 1;
        seenBody = await request.text();
        return new Response('updated');
      },
      method: 'POST',
      reason: 'account email update endpoint',
      response: rawTextResponse,
    });
    const csrf = { secret: 'endpoint-secret', sessionId: () => 's1' };
    const app = createApp({ csrf, endpoints: [updateEmail] });
    const body = JSON.stringify({
      email: 'ada@example.com',
      'kovo-csrf': csrfToken({} as Request, csrf),
    });
    const request = new Request('https://shop.example.test/account/email', {
      body,
      headers: { 'Content-Type': 'application/json', Origin: 'https://shop.example.test' },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('updated');
    expect(handlerCalls).toBe(1);
    // The raw handler still receives the original, unconsumed JSON body.
    expect(seenBody).toBe(body);
  });

  it('L15: still fails closed (422) for a JSON endpoint POST missing the kovo-csrf token', async () => {
    let handlerCalls = 0;
    const updateEmail = endpoint('/account/email', {
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
      body: JSON.stringify({ email: 'ada@example.com' }),
      headers: { 'Content-Type': 'application/json', Origin: 'https://shop.example.test' },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(422);
    await expect(response.text()).resolves.toBe('CSRF');
    expect(handlerCalls).toBe(0);
  });

  it('L16: neutralizes the inbound Cookie header for a csrf:false endpoint handler (SPEC §9.1)', async () => {
    // bugz-3 L16: a csrf:false endpoint skips the synchronizer token AND the Origin floor;
    // the exemption is sound only because "cookies are not interpreted" (SPEC.md §9.1).
    let seenCookie: string | null = 'unset';
    const signedWebhook = endpoint('/webhooks/signed', {
      csrf: false,
      csrfJustification: 'signed webhook validates raw body',
      handler(request) {
        seenCookie = request.headers.get('cookie');
        return new Response('ok', { status: 202 });
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
      headers: { Cookie: 'sid=victim-session-secret' },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(202);
    // The exempt handler can no longer ride the victim's ambient browser cookie.
    expect(seenCookie).toBeNull();
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
    const product = route('/products/:id', {});
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
    await expect(response.text()).resolves.toBe('<h1>Missing</h1>');
  });

  // H2 (medium) — SPEC §9.4: /_q/ is a credentialed GET endpoint; non-GET/HEAD methods
  // must be rejected 405 with Allow: GET, HEAD so they cannot be used as a no-CSRF read channel.

  it('H2: rejects POST to /_q/<key> with 405 Allow:GET,HEAD without running the query', async () => {
    let loadCalls = 0;
    const cart = query('cart', {
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
