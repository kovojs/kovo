import { describe, expect, it, vi } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import {
  createMemoryVersionedClientModuleRegistry,
  endpoint,
  guards,
  query,
  route,
  s,
  versionedClientModuleHref,
} from './index.js';

describe('server createApp request shell', () => {
  it('stores the closed app registries and options without adding middleware', () => {
    const productRoute = route('/products/:id', {});
    const statusEndpoint = endpoint('/status', { handler: () => new Response('ok') });
    const productQuery = query('product', {
      load: () => ({ id: 'p1' }),
      reads: [],
    });
    const sessionProvider = () => ({ user: { id: 'u1' } });

    const app = createApp({
      endpoints: [statusEndpoint],
      queries: [productQuery],
      routes: [productRoute],
      sessionProvider,
    });

    expect(app.routes).toEqual([productRoute]);
    expect(app.endpoints).toEqual([statusEndpoint]);
    expect(app.queries).toEqual([productQuery]);
    expect(app.mutations).toEqual([]);
    expect(app.sessionProvider).toBe(sessionProvider);
    expect('use' in app).toBe(false);
  });

  it('dispatches a matched route through Request to document Response', async () => {
    const productRoute = route('/products/:id', {
      meta: { title: 'Product' },
      page({ params, search }) {
        return `<main>${params.id}:${search.tab}</main>`;
      },
      search: s.object({ tab: s.string() }),
    });
    const handler = createRequestHandler(createApp({ routes: [productRoute] }));

    const response = await handler(new Request('https://example.test/products/p1?tab=details'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toContain('<main>p1:details</main>');
  });

  it('normalizes trailing slashes before dispatching routes', async () => {
    const handler = createRequestHandler(createApp({ routes: [route('/products/:id', {})] }));

    const response = await handler(new Request('https://example.test/products/p1/?tab=details'));

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('/products/p1?tab=details');
    await expect(response.text()).resolves.toBe('');
  });

  it('returns stable 404 and page-method responses', async () => {
    const handler = createRequestHandler(createApp({ routes: [route('/products/:id', {})] }));

    const missing = await handler(new Request('https://example.test/missing'));
    expect(missing.status).toBe(404);
    await expect(missing.text()).resolves.toContain('<h1>Not Found</h1>');

    const method = await handler(
      new Request('https://example.test/products/p1', { method: 'POST' }),
    );
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET, HEAD');
    await expect(method.text()).resolves.toBe('Method Not Allowed');
  });

  it('dispatches endpoints before routes and strips ambient session from endpoint requests', async () => {
    const statusEndpoint = endpoint('/status', {
      handler(request) {
        expect('session' in request).toBe(false);
        return new Response('endpoint');
      },
      method: 'GET',
    });
    const handler = createRequestHandler(
      createApp({
        endpoints: [statusEndpoint],
        routes: [route('/status', { page: () => 'route' })],
        sessionProvider: () => ({ user: { id: 'u1' } }),
      }),
    );

    const response = await handler(new Request('https://example.test/status'));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('endpoint');
  });

  it('reports app catch-all exceptions without leaking endpoint internals', async () => {
    const thrown = new Error('private endpoint detail');
    const onError = vi.fn();
    const statusEndpoint = endpoint('/status', {
      handler() {
        throw thrown;
      },
      method: 'GET',
    });
    const handler = createRequestHandler(createApp({ endpoints: [statusEndpoint], onError }));
    const request = new Request('https://example.test/status?check=true');

    const response = await handler(request);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('<h1>Server Error</h1>');
    expect(body).not.toContain('private endpoint detail');
    expect(onError).toHaveBeenCalledWith(thrown, {
      operation: 'app-request',
      request,
      url: '/status?check=true',
    });
  });

  it('resolves session once for a guarded route request', async () => {
    let sessionReads = 0;
    const adminRoute = route('/admin', {
      guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
      page(_context, request) {
        return `admin:${request.session.user.id}`;
      },
    });
    const handler = createRequestHandler(
      createApp({
        routes: [adminRoute],
        sessionProvider() {
          sessionReads += 1;
          return { user: { id: 'u1' } };
        },
      }),
    );

    const response = await handler(new Request('https://example.test/admin'));

    expect(sessionReads).toBe(1);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('admin:u1');
  });

  it('dispatches stored query and client-module registries through web Responses', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const href = registry.put({
      path: '/c/cart.client.js',
      source: 'export const ok = true;',
      version: 'v1',
    });
    expect(href).toBe(versionedClientModuleHref('/c/cart.client.js', 'v1'));

    const handler = createRequestHandler(
      createApp({
        clientModules: registry,
        queries: [
          query('cart', {
            args: s.object({ id: s.string() }),
            load: (input: { id: string }) => ({ id: input.id, total: 42 }),
            reads: [],
          }),
        ],
      }),
    );

    const queryResponse = await handler(new Request('https://example.test/_q/cart?id=c1'));
    expect(queryResponse.status).toBe(200);
    await expect(queryResponse.text()).resolves.toContain(
      '<fw-query name="cart">{"id":"c1","total":42}</fw-query>',
    );

    const moduleResponse = await handler(new Request(`https://example.test${href}`));
    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expect(moduleResponse.text()).resolves.toBe('export const ok = true;');
  });
});
