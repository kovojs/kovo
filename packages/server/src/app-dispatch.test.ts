import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { KovoApp } from './app-types.js';
import { dispatchMatchedAppRequest } from './app-dispatch.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { endpoint } from './endpoint.js';
import { matchShellDispatch, type ShellDispatchMatch } from './shell.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { route } from './route.js';
import { s } from './schema.js';

describe('server app matched dispatch boundary', () => {
  it('owns SPEC §9.5 client-module dispatch through the app registry', async () => {
    const clientModules = createMemoryVersionedClientModuleRegistry();
    const href = clientModules.put({
      path: '/c/cart.client.js',
      source: 'export const cart = "ok";',
      version: 'v1',
    });
    const app = createApp({ clientModules });
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
