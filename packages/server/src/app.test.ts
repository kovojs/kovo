import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { enhancedNavigationDocumentAcceptHeader } from '@kovojs/core/internal/document-protocol';

import { createApp, createRequestHandler } from './app.js';
import { versionedClientModuleHref } from './client-modules.js';
import { domain } from './domain.js';
import { endpoint } from './endpoint.js';
import { registerGeneratedMutationTouchRegistry } from './generated-mutation-registry.js';
import { registerGeneratedQueryReadRegistry } from './generated-query-registry.js';
import { guards } from './guards.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { registerGeneratedLiveTargetRenderer } from './live-target-registry.js';
import { layout, route } from './route.js';
import { s } from './schema.js';
import { stylesheet } from './hints.js';
import { renderedHtml } from './html.js';

describe('server createApp request shell', () => {
  it('stores the closed app registries and options without adding middleware', () => {
    const productRoute = route('/products/:id', {});
    const statusEndpoint = endpoint('/status', { handler: () => new Response('ok') });
    const productQuery = query('product', {
      load: () => ({ id: 'p1' }),
      reads: [],
    });
    const sessionProvider = () => ({ user: { id: 'u1' } });
    const appStylesheet = stylesheet('./styles.css');

    const app = createApp({
      endpoints: [statusEndpoint],
      queries: [productQuery],
      routes: [productRoute],
      sessionProvider,
      stylesheets: [appStylesheet],
    });

    expect(app.routes).toEqual([productRoute]);
    expect(app.endpoints).toEqual([statusEndpoint]);
    expect(app.queries).toEqual([productQuery]);
    expect(app.mutations).toEqual([]);
    expect(app.stylesheets).toEqual([appStylesheet]);
    expect(app.diagnostics).toEqual([]);
    expect(app.sessionProvider).toBe(sessionProvider);
    expect(app.requestLimits.maxBodyBytes).toBeGreaterThan(0);
    expect(app.requestLimits.perIp).toMatchObject({ max: expect.any(Number), windowMs: 60_000 });
    expect(app.requestLimits.mutations.perIp).toMatchObject({
      max: expect.any(Number),
      windowMs: 60_000,
    });
    expect('use' in app).toBe(false);
  });

  it('uses compiler-registered live target renderers when createApp does not receive explicit wiring', () => {
    const renderer = {
      component: 'test/create-app-registered-live-target',
      queries: ['cart'],
      render: () => '<cart-badge>1</cart-badge>',
    };
    registerGeneratedLiveTargetRenderer(renderer);

    expect(
      createApp().liveTargetRenderers.filter(
        (candidate) => candidate.component === renderer.component,
      ),
    ).toEqual([renderer]);
    expect(createApp({ liveTargetRenderers: [] }).liveTargetRenderers).toEqual([]);
  });

  it('derives the app query registry from generated live target renderers and layouts', () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const explicitCartQuery = query('cart', {
      load: () => ({ count: 2 }),
      reads: [cart],
    });
    const productQuery = query('product', {
      load: () => ({ id: 'p1' }),
      reads: [],
    });
    const profileQuery = query('profile', {
      load: () => ({ name: 'Ada' }),
      reads: [],
    });
    const accountLayout = layout({
      queries: { profile: profileQuery },
      render: ({ profile }, _state, { children }) =>
        trustedHtml(`<main data-profile="${profile.name}">${String(children)}</main>`),
    });

    const app = createApp({
      liveTargetRenderers: [
        {
          component: 'components/cart/badge',
          queries: ['cart', 'product'],
          queryDefinitions: [cartQuery, productQuery],
          render: () => '<cart-badge>1</cart-badge>',
        },
      ],
      queries: [explicitCartQuery],
      routes: [
        route('/account', {
          layout: accountLayout,
          page: () => trustedHtml('<section>Account</section>'),
        }),
      ],
    });

    expect(app.queries).toEqual([explicitCartQuery, productQuery, profileQuery]);
  });

  it('injects compiler-registered mutation touch sites into app mutations', () => {
    const cart = domain('generated-cart-fallback');
    const addToCart = mutation('generated/cart/add-app', {
      input: s.object({ productId: s.string() }),
      registry: { touches: [cart] },
      handler: (input) => input,
    });

    registerGeneratedMutationTouchRegistry({
      'generated/cart/add-app': [{ domain: 'generated-product', keys: 'arg:productId' }],
    });

    const app = createApp({ mutations: [addToCart] });

    expect(app.mutations[0]?.registry).toMatchObject({
      inferredTouches: [{ domain: 'generated-product', keys: 'arg:productId' }],
      touches: [cart],
    });
  });

  // H1 (SPEC §6.1 key-addressed mutation registry / §9.5 single keyed dispatch): two same-key
  // mutations make the second handler unreachable (app-mutation-request resolves with .find,
  // first-match-wins) while the compile-time invalidation registry last-write-wins the other
  // declaration. createApp must fail closed rather than silently shadow the second handler.
  it('rejects duplicate mutation keys at createApp build time (KV421 runtime sibling)', () => {
    const firstAdd = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler: (input) => input,
    });
    const secondAdd = mutation('cart/add', {
      input: s.object({ orderId: s.string() }),
      handler: (input) => input,
    });

    expect(() => createApp({ mutations: [firstAdd, secondAdd] })).toThrow(
      /two mutations with the same key "cart\/add"/,
    );
  });

  it('accepts distinct mutation keys at createApp build time', () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler: (input) => input,
    });
    const removeFromCart = mutation('cart/remove', {
      input: s.object({ productId: s.string() }),
      handler: (input) => input,
    });

    const app = createApp({ mutations: [addToCart, removeFromCart] });
    expect(app.mutations.map((candidate) => candidate.key)).toEqual(['cart/add', 'cart/remove']);
  });

  it('injects compiler-registered query reads into app queries', () => {
    const catalogQuery = query('generatedCatalog', {
      load: () => ({ items: [] as string[] }),
    });

    registerGeneratedQueryReadRegistry([
      { domains: ['generated-catalog'], query: 'generatedCatalog' },
    ]);

    const app = createApp({ queries: [catalogQuery] });

    expect(app.queries[0]?.reads).toEqual([{ key: 'generated-catalog' }]);
  });

  it('rejects malformed compiler-registered query reads', () => {
    expect(() =>
      registerGeneratedQueryReadRegistry([
        { domains: ['cart', 1], query: 'generatedBadQuery' },
      ] as unknown as [{ domains: string[]; query: string }]),
    ).toThrow('Generated query read registry received an invalid registry.');
  });

  it('rejects malformed compiler-registered mutation touch sites', () => {
    expect(() =>
      registerGeneratedMutationTouchRegistry({
        'generated/cart/bad': [{ domain: 'cart', keys: 1 }] as unknown as [
          { domain: string; keys: string },
        ],
      }),
    ).toThrow('Generated mutation touch registry received an invalid registry.');
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
      routes: [route('/cart', { page: () => trustedHtml('<main>Cart</main>') })],
    });

    for (const malformedApp of [
      { ...app, endpoints: [{ path: '/status' }] },
      { ...app, mutations: [{ key: 'cart/add', handler: () => ({ ok: true }) }] },
      { ...app, queries: [{ key: 'cart', reads: [{ name: 'cart' }] }] },
      { ...app, routes: [{ page: () => trustedHtml('<main>Cart</main>') }] },
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
        return renderedHtml(`<main>${params.id}:${search.tab}</main>`);
      },
      search: s.object({ tab: s.string() }),
    });
    const handler = createRequestHandler(createApp({ routes: [productRoute] }));

    const response = await handler(new Request('https://example.test/products/p1?tab=details'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toContain('<main>p1:details</main>');
  });

  it('serves enhanced navigation documents without resending the inline loader', async () => {
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/products/:id', {
            meta: { title: 'Product' },
            params: s.object({ id: s.string() }),
            page({ params }) {
              return renderedHtml(
                `<main kovo-nav-segment="page:/products/:id">${params.id}</main>`,
              );
            },
          }),
        ],
      }),
    );

    const full = await handler(new Request('https://example.test/products/p1'));
    const enhanced = await handler(
      new Request('https://example.test/products/p1', {
        headers: { Accept: enhancedNavigationDocumentAcceptHeader },
      }),
    );

    expect(full.status).toBe(200);
    expect(enhanced.status).toBe(200);
    expect(enhanced.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(enhanced.headers.get('vary')).toBe('Accept');

    const fullBody = await full.text();
    const enhancedBody = await enhanced.text();
    expect(fullBody).toContain('installInlineKovoBootstrap');
    expect(fullBody).toContain('/c/__v/');
    expect(fullBody).toContain('/kovo-runtime.client.js');
    expect(fullBody).toMatch(
      /\)\("\/c\/__v\/[^"]+\/kovo-runtime\.client\.js",\(url\)=>import\(url\)\);/,
    );
    expect(enhancedBody).not.toContain('installInlineKovoBootstrap');
    expect(enhancedBody).not.toContain('installInlineKovoLoader');
    expect(enhancedBody).toContain('<title>Product</title>');
    expect(enhancedBody).toContain('<meta name="kovo-build"');
    expect(enhancedBody).toContain('<main kovo-nav-segment="page:/products/:id">p1</main>');
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
        route('/products/:id', { page: () => trustedHtml('<main>Param</main>') }),
        route('/products/new', { page: () => trustedHtml('<main>New</main>') }),
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

  // SPEC §9.5: the request shell owns the pre-dispatch body-size gate because
  // there is no user middleware chain. It must reject before endpoint raw-body
  // handlers can read or parse the request.
  it('rejects oversized requests with 413 before endpoint dispatch', async () => {
    const endpointHandler = vi.fn(() => new Response('ok'));
    const handler = createRequestHandler(
      createApp({
        endpoints: [
          endpoint('/upload', {
            csrf: false,
            csrfJustification: 'test machine endpoint',
            handler: endpointHandler,
            method: 'POST',
          }),
        ],
        requestLimits: {
          global: false,
          maxBodyBytes: 4,
          perIp: false,
          queries: { global: false, perIp: false },
          mutations: { global: false, perIp: false },
        },
      }),
    );

    const response = await handler(
      new Request('https://example.test/upload', {
        body: '12345',
        headers: { 'Content-Length': '5' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.text()).resolves.toBe('Payload Too Large');
    expect(endpointHandler).not.toHaveBeenCalled();
  });

  // SPEC §9.5 / §10.3: coarse per-IP mutation limiting runs before replay, parse,
  // and guards, so the second request cannot execute the mutation handler.
  it('rate-limits mutation requests before parsing or running the handler', async () => {
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const addToCart = mutation('cart/add-rate-limited', {
      csrf: false,
      input: s.object({ quantity: s.number().default(1) }),
      handler: mutationHandler,
    });
    const handler = createRequestHandler(
      createApp({
        mutations: [addToCart],
        requestLimits: {
          global: false,
          maxBodyBytes: false,
          perIp: false,
          queries: { global: false, perIp: false },
          mutations: { global: false, perIp: { max: 1, windowMs: 60_000 } },
        },
      }),
    );
    const request = () =>
      new Request('https://example.test/_m/cart/add-rate-limited', {
        body: new URLSearchParams({ quantity: '2' }),
        headers: { 'X-Forwarded-For': '203.0.113.9' },
        method: 'POST',
      });

    expect((await handler(request())).status).toBe(303);

    const limited = await handler(request());

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    await expect(limited.text()).resolves.toBe('Too Many Requests');
    expect(mutationHandler).toHaveBeenCalledTimes(1);
  });

  // SPEC §9.5 / §9.4: typed reads also pass through the shell's anonymous-flood
  // limiter before args parsing or query loading.
  it('rate-limits query requests before loading the query', async () => {
    const queryLoad = vi.fn(() => ({ count: 1 }));
    const cartQuery = query('cart-rate-limited', {
      load: queryLoad,
      reads: [],
    });
    const handler = createRequestHandler(
      createApp({
        queries: [cartQuery],
        requestLimits: {
          global: false,
          maxBodyBytes: false,
          perIp: false,
          mutations: { global: false, perIp: false },
          queries: { global: { max: 1, windowMs: 60_000 }, perIp: false },
        },
      }),
    );

    expect((await handler(new Request('https://example.test/_q/cart-rate-limited'))).status).toBe(
      200,
    );

    const limited = await handler(new Request('https://example.test/_q/cart-rate-limited'));

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(queryLoad).toHaveBeenCalledTimes(1);
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
        routes: [route('/status', { page: () => trustedHtml('route') })],
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
        return renderedHtml(`admin:${request.session.user.id}`);
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

  it('provisions db and session through createApp for routes, queries, and enhanced refresh', async () => {
    interface AppDb {
      count: number;
      reads: string[];
      writes: string[];
    }

    type AppRequest = Request & {
      db: AppDb;
      session: { user: { id: string } } | null;
    };

    const db: AppDb = { count: 1, reads: [], writes: [] };
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load(_input, context?: { request: AppRequest }) {
        context?.request.db.reads.push(context.request.session?.user.id ?? 'anonymous');
        return { count: context?.request.db.count ?? 0 };
      },
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ quantity: s.number().int().min(1).default(1) }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input, request: AppRequest) {
        request.db.count += input.quantity;
        request.db.writes.push(request.session?.user.id ?? 'anonymous');
        return { count: request.db.count };
      },
    });
    const handler = createRequestHandler(
      createApp({
        db: () => db,
        endpoints: [
          endpoint('/webhook', {
            csrf: false,
            csrfJustification: 'signed provider test endpoint',
            handler(request) {
              const endpointRequest = request as Request & { db: AppDb; session?: never };
              expect('session' in endpointRequest).toBe(false);
              endpointRequest.db.writes.push('endpoint');
              return new Response(`endpoint:${endpointRequest.db.count}`);
            },
            method: 'POST',
          }),
        ],
        liveTargetRenderers: [
          {
            component: 'components/cart/badge',
            queries: ['cart'],
            render({ request }: { request: AppRequest }) {
              return `<cart-badge>${request.db.count}:${request.session?.user.id}</cart-badge>`;
            },
          },
        ],
        mutations: [addToCart],
        queries: [cartQuery],
        routes: [
          route('/cart', {
            page(_context, request: AppRequest) {
              return renderedHtml(`<main>${request.db.count}:${request.session?.user.id}</main>`);
            },
          }),
        ],
        sessionProvider: () => ({ user: { id: 'u1' } }),
      }),
    );

    const routeResponse = await handler(new Request('https://example.test/cart'));
    expect(routeResponse.status).toBe(200);
    await expect(routeResponse.text()).resolves.toContain('<main>1:u1</main>');

    const queryResponse = await handler(new Request('https://example.test/_q/cart'));
    expect(queryResponse.status).toBe(200);
    await expect(queryResponse.text()).resolves.toContain(
      '<kovo-query name="cart">{"count":1}</kovo-query>',
    );

    const form = new FormData();
    form.set('quantity', '2');
    const mutationResponse = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: form,
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': 'cart#components/cart/badge:{}',
          'Kovo-Targets': 'cart=cart',
        },
        method: 'POST',
      }),
    );

    expect(mutationResponse.status).toBe(200);
    await expect(mutationResponse.text()).resolves.toBe(
      [
        '<kovo-query name="cart">{"count":3}</kovo-query>',
        '<kovo-fragment target="cart"><cart-badge>3:u1</cart-badge></kovo-fragment>',
      ].join('\n'),
    );
    expect(db.reads).toEqual(['u1', 'u1']);
    expect(db.writes).toEqual(['u1']);

    const endpointResponse = await handler(
      new Request('https://example.test/webhook', { method: 'POST' }),
    );
    expect(endpointResponse.status).toBe(200);
    await expect(endpointResponse.text()).resolves.toBe('endpoint:3');
    expect(db.writes).toEqual(['u1', 'endpoint']);
  });

  it('reruns layout query chunks from generated layout live-target stamps', async () => {
    const cart = domain('cart');
    const db = { count: 1 };
    const cartQuery = query('cart', {
      load: () => ({ count: db.count }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({}),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler() {
        db.count += 1;
        return { count: db.count };
      },
    });
    const CartLayout = layout({
      queries: { cart: cartQuery },
      render: ({ cart }, _state, { children }) =>
        trustedHtml(
          `<main><output data-bind="cart.count">${cart.count}</output>${String(children)}</main>`,
        ),
    });
    const handler = createRequestHandler(
      createApp({
        mutations: [addToCart],
        queries: [cartQuery],
        routes: [
          route('/cart', {
            layout: CartLayout,
            page: () => trustedHtml('<section>Cart</section>'),
          }),
        ],
      }),
    );

    const routeResponse = await handler(new Request('https://example.test/cart'));
    const routeHtml = await routeResponse.text();
    const layoutTarget = /<main[^>]*kovo-fragment-target="([^"]+)"/.exec(routeHtml)?.[1];
    expect(layoutTarget).toMatch(/^kovo-layout-/);
    expect(routeHtml).toContain('kovo-deps="cart"');

    const mutationResponse = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: new FormData(),
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Targets': `${layoutTarget}=cart`,
        },
        method: 'POST',
      }),
    );

    expect(mutationResponse.status).toBe(200);
    await expect(mutationResponse.text()).resolves.toBe(
      '<kovo-query name="cart">{"count":2}</kovo-query>',
    );
  });

  it('dispatches stored query and client-module registries through web Responses', async () => {
    const app = createApp({
      queries: [
        query('cart', {
          args: s.object({ id: s.string() }),
          load: (input: { id: string }) => ({ id: input.id, total: 42 }),
          reads: [],
        }),
      ],
    });
    const href = app.clientModules.put({
      path: '/c/cart.client.js',
      source: 'export const ok = true;',
      version: 'v1',
    });
    expect(href).toBe(versionedClientModuleHref('/c/cart.client.js', 'v1'));

    const handler = createRequestHandler(app);

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
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });
    const handler = createRequestHandler(
      createApp({
        liveTargetRenderers: [
          {
            component: 'components/cart/badge',
            queries: ['cart'],
            queryDefinitions: [cartQuery],
            render: () => '<cart-badge>1</cart-badge>',
          },
        ],
        mutationResponses: {
          'cart/add': { redirectTo: '/cart' },
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
          'Kovo-Live-Targets': 'cart#components/cart/badge:{}',
          'Kovo-Targets': 'cart=cart',
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

  it('dispatches enhanced mutation fragments through app live target renderers', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      registry: {
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });
    const renderCartPanel = vi.fn(({ props }: { props: Record<string, unknown> }) => {
      return `<cart-panel>${String(props.cartId)}</cart-panel>`;
    });
    const handler = createRequestHandler(
      createApp({
        liveTargetRenderers: [
          {
            component: 'components/cart/panel',
            queries: ['cart'],
            queryDefinitions: [cartQuery],
            render: renderCartPanel,
          },
        ],
        mutations: [addToCart],
        queries: [cartQuery],
      }),
    );
    const form = new FormData();
    form.set('productId', 'p1');

    const response = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: form,
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': 'cart-panel#components/cart/panel:{"cartId":"c1"}',
          'Kovo-Targets': 'cart-panel=cart',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(
      [
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        '<kovo-fragment target="cart-panel"><cart-panel>c1</cart-panel></kovo-fragment>',
      ].join('\n'),
    );
    expect(renderCartPanel).toHaveBeenCalledOnce();
  });
});
