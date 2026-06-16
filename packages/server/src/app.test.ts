import { describe, expect, it, vi } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import {
  createMemoryVersionedClientModuleRegistry,
  versionedClientModuleHref,
} from './client-modules.js';
import { domain } from './domain.js';
import { endpoint } from './endpoint.js';
import { guards } from './guards.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { route } from './route.js';
import { s } from './schema.js';

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
    expect(app.diagnostics).toEqual([]);
    expect(app.sessionProvider).toBe(sessionProvider);
    expect('use' in app).toBe(false);
  });

  it('rejects malformed compatibility shells before request dispatch', () => {
    const app = createApp({ routes: [route('/products/:id', {})] });
    const rawHandler = async () => new Response('<main>compat</main>');

    expect(() =>
      createRequestHandler(rawHandler as unknown as Parameters<typeof createRequestHandler>[0]),
    ).toThrow(
      'createRequestHandler() requires a Kovo app aggregate. SPEC §9.5 request dispatch must start from createApp(), not a raw request handler or compatibility shell.',
    );
    expect(() =>
      createRequestHandler({
        ...app,
        renderRoute: '<main>compat</main>',
      } as unknown as Parameters<typeof createRequestHandler>[0]),
    ).toThrow('createRequestHandler() requires a Kovo app aggregate.');
  });

  it('rejects malformed declaration entries before request dispatch', () => {
    const app = createApp({
      endpoints: [endpoint('/status', { handler: () => new Response('ok') })],
      mutations: [
        mutation('cart/add', {
          handler: () => ({ ok: true }),
          input: s.object({ productId: s.string() }),
        }),
      ],
      queries: [query('cart', { reads: [domain('cart')] })],
      routes: [route('/cart', { page: () => '<main>Cart</main>' })],
    });

    for (const malformedApp of [
      { ...app, endpoints: [{ path: '/status' }] },
      { ...app, mutations: [{ key: 'cart/add', handler: () => ({ ok: true }) }] },
      { ...app, queries: [{ key: 'cart', reads: [{ name: 'cart' }] }] },
      { ...app, routes: [{ page: () => '<main>Cart</main>' }] },
    ]) {
      expect(() =>
        createRequestHandler(malformedApp as unknown as Parameters<typeof createRequestHandler>[0]),
      ).toThrow('createRequestHandler() requires a Kovo app aggregate.');
    }
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

  it('blocks ambiguous route tables with KV228 before declaration-order dispatch', async () => {
    const app = createApp({
      routes: [
        route('/products/:id', { page: () => '<main>Param</main>' }),
        route('/products/new', { page: () => '<main>New</main>' }),
      ],
    });

    expect(app.diagnostics).toEqual([
      {
        code: 'KV228',
        fileName: '/products/:id <-> /products/new',
        help: expect.stringContaining('SPEC §9.5'),
        message:
          "Ambiguous route table: '/products/:id' and '/products/new' can both match canonical request path '/products/new'.",
      },
    ]);

    const response = await createRequestHandler(app)(
      new Request('https://example.test/products/new'),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('<p class="kovo-diagnostic-code">KV228</p>');
    expect(body).toContain('/products/:id &lt;-&gt; /products/new');
    expect(body).not.toContain('<main>New</main>');
  });

  it('renders configured error shells through the app request boundary', async () => {
    const handler = createRequestHandler(
      createApp({
        errorShells: {
          notFound({ request, status }) {
            const url = new URL(request.url);
            return {
              body: `<main>${status}:${url.pathname}</main>`,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
              status,
            };
          },
        },
      }),
    );

    const response = await handler(new Request('https://example.test/missing'));

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('<main>404:/missing</main>');
  });

  it('reports failing error shells and falls back to stable no-internals documents', async () => {
    const shellError = new Error('private shell detail');
    const onError = vi.fn();
    const handler = createRequestHandler(
      createApp({
        errorShells: {
          notFound() {
            throw shellError;
          },
        },
        onError,
      }),
    );
    const request = new Request('https://example.test/missing?from=test');

    const response = await handler(request);

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain('<h1>Not Found</h1>');
    expect(body).not.toContain('private shell detail');
    expect(onError).toHaveBeenCalledWith(shellError, {
      operation: 'error-shell',
      request,
      status: 404,
      url: '/missing?from=test',
    });
  });

  it('keeps app request failures private when the configured 500 shell also fails', async () => {
    const endpointError = new Error('private endpoint detail');
    const shellError = new Error('private 500 shell detail');
    const onError = vi.fn();
    const statusEndpoint = endpoint('/status', {
      handler() {
        throw endpointError;
      },
      method: 'GET',
    });
    const handler = createRequestHandler(
      createApp({
        endpoints: [statusEndpoint],
        errorShells: {
          serverError() {
            throw shellError;
          },
        },
        onError,
      }),
    );
    const request = new Request('https://example.test/status');

    const response = await handler(request);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('<h1>Server Error</h1>');
    expect(body).not.toContain('private endpoint detail');
    expect(body).not.toContain('private 500 shell detail');
    expect(onError).toHaveBeenCalledWith(endpointError, {
      operation: 'app-request',
      request,
      url: '/status',
    });
    expect(onError).toHaveBeenCalledWith(shellError, {
      operation: 'error-shell',
      request,
      status: 500,
      url: '/status',
    });
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
      '<kovo-query name="cart">{"id":"c1","total":42}</kovo-query>',
    );

    const moduleResponse = await handler(new Request(`https://example.test${href}`));
    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expect(moduleResponse.text()).resolves.toBe('export const ok = true;');
  });

  it('dispatches mutation POSTs through the reserved app shell path', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string(), quantity: s.number().int().min(1).default(1) }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });
    const handler = createRequestHandler(
      createApp({
        mutationResponse() {
          return {
            fragmentRenderers: [{ render: () => '<cart-badge>1</cart-badge>', target: 'cart' }],
            redirectTo: '/cart',
          };
        },
        mutations: [addToCart],
      }),
    );
    const enhancedForm = new FormData();
    enhancedForm.set('productId', 'p1');
    enhancedForm.set('quantity', '1');

    const enhanced = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: enhancedForm,
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Targets': 'cart',
        },
        method: 'POST',
      }),
    );
    expect(enhanced.status).toBe(200);
    expect(enhanced.headers.get('content-type')).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    await expect(enhanced.text()).resolves.toBe(
      [
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        '<kovo-fragment target="cart"><cart-badge>1</cart-badge></kovo-fragment>',
      ].join('\n'),
    );

    const noJsForm = new FormData();
    noJsForm.set('productId', 'p1');
    const noJs = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: noJsForm,
        method: 'POST',
      }),
    );
    expect(noJs.status).toBe(303);
    expect(noJs.headers.get('location')).toBe('/cart');
    await expect(noJs.text()).resolves.toBe('');
  });
});
