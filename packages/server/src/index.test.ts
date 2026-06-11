import { describe, expect, it, vi } from 'vitest';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { validateHeaderValue } from 'node:http';

import {
  domain,
  endpoint,
  endpointMatches,
  errorBoundary,
  guards,
  redirect,
  i18n,
  invalidate,
  meta,
  metaFromQuery,
  mutation as defineMutation,
  notFound,
  parseRouteRequest,
  mutationWireRequestFromHeaders,
  query,
  route,
  createMemoryMutationReplayStore,
  createMemoryVersionedClientModuleRegistry,
  csrfField,
  csrfToken,
  readMutationWireHeaders,
  renderDeferredStream,
  renderPageHints,
  renderMutationEndpointResponse,
  renderMutationResponse,
  renderNoJsMutationResponse,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
  renderQueryScript,
  renderRoutePageResponse,
  renderVersionedClientModuleResponse,
  runEndpoint,
  runMutation,
  runQuery,
  runRoutePage,
  s,
  session,
  stylesheetsForTargets,
  t,
  tag,
  versionedClientModuleHref,
  type ChangeRecord,
  type EndpointRequest,
  type MutationReplayStore,
} from './index.js';

const mutation = ((key: string, definition: Parameters<typeof defineMutation>[1]) =>
  defineMutation(key, { csrf: false, ...definition })) as typeof defineMutation;

function deferred<Value = void>(): {
  promise: Promise<Value>;
  reject(reason?: unknown): void;
  resolve(value: Value | PromiseLike<Value>): void;
} {
  let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

describe('server mutation primitives', () => {
  it('declares raw endpoints with named CSRF exemptions and auth metadata', () => {
    const callback = endpoint('/auth/callback', {
      auth: { justification: 'oauth provider callback', kind: 'none' },
      csrf: false,
      csrfJustification: 'oauth provider callback',
      handler: () => new Response('ok'),
      method: 'POST',
      mount: 'exact',
    });

    expect(callback.path).toBe('/auth/callback');
    expect(callback.method).toBe('POST');
    expect(callback.mount).toBe('exact');
    expect(callback.auth).toEqual({ justification: 'oauth provider callback', kind: 'none' });
    expect(callback.csrf).toEqual({
      exempt: true,
      justification: 'oauth provider callback',
    });

    const assertCsrfNeedsJustification = () => {
      // @ts-expect-error SPEC §9.1 requires a named justification for endpoint CSRF exemption.
      endpoint('/bad/csrf', {
        csrf: false,
        handler: () => new Response('bad'),
      });
    };
    const assertNoAmbientSession = (request: EndpointRequest) => {
      // @ts-expect-error SPEC §9.1 endpoints receive raw Request, not req.session.
      const session: { id: string } = request.session;
      return session;
    };

    expect(assertCsrfNeedsJustification).toBeTypeOf('function');
    expect(assertNoAmbientSession).toBeTypeOf('function');
  });

  it('runs endpoint handlers as raw Request to Response without consuming the body first', async () => {
    const seen: string[] = [];
    const inventoryWebhook = endpoint('/webhooks/inventory', {
      auth: { kind: 'verifier', name: 'inventory-hmac' },
      csrf: false,
      csrfJustification: 'signed inventory webhook',
      async handler(request) {
        seen.push(request.headers.get('x-signature') ?? '');
        return new Response(await request.text(), {
          headers: { 'content-type': 'application/json' },
          status: 202,
        });
      },
      method: 'POST',
    });
    const response = await runEndpoint(
      inventoryWebhook,
      new Request('https://example.test/webhooks/inventory', {
        body: '{"sku":"p1"}',
        headers: { 'x-signature': 'sig_123' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.text()).resolves.toBe('{"sku":"p1"}');
    expect(seen).toEqual(['sig_123']);
  });

  it('does not pass ambient session properties to endpoint handlers', async () => {
    const request = new Request('https://example.test/machine', {
      body: 'payload',
      method: 'POST',
    });
    Object.defineProperty(request, 'session', {
      configurable: true,
      value: { id: 's1' },
    });
    const machineEndpoint = endpoint('/machine', {
      csrf: false,
      csrfJustification: 'external machine caller',
      async handler(rawRequest) {
        expect('session' in rawRequest).toBe(false);
        expect((rawRequest as unknown as { session?: unknown }).session).toBeUndefined();
        return new Response(`sessionless:${await rawRequest.text()}`);
      },
      method: 'POST',
    });

    await expect((await runEndpoint(machineEndpoint, request)).text()).resolves.toBe(
      'sessionless:payload',
    );
  });

  it('matches exact and prefix endpoint mounts without routing side effects', () => {
    const exact = endpoint('/exports/orders.csv', {
      handler: () => new Response('orders'),
      method: 'GET',
    });
    const mounted = endpoint('/auth', {
      csrf: false,
      csrfJustification: 'auth adapter owns callback subpaths',
      handler: () => new Response('auth'),
      method: 'GET',
      mount: 'prefix',
    });

    expect(endpointMatches(exact, { method: 'GET', pathname: '/exports/orders.csv' })).toBe(true);
    expect(endpointMatches(exact, { method: 'GET', pathname: '/exports/orders.csv/extra' })).toBe(
      false,
    );
    expect(endpointMatches(mounted, { method: 'GET', pathname: '/auth/callback/github' })).toBe(
      true,
    );
    expect(endpointMatches(mounted, { method: 'POST', pathname: '/auth/callback/github' })).toBe(
      false,
    );
  });

  it('declares route schemas, route-owned hints, and typed PRG redirects', async () => {
    const productRoute = route('/products/:id', {
      meta: meta({ title: 'Product detail' }),
      page(context) {
        const id: string = context.params.id;
        const max: number = context.search.max;
        return `${id}:${max}`;
      },
      params: s.object({ id: s.string() }),
      prefetch: 'conservative',
      prerenderUrls: ['/products/p1'],
      search: s.object({ max: s.number().int().default(25), sort: s.string() }),
    });

    const request = parseRouteRequest(productRoute, {
      params: { id: 'p1' },
      search: { sort: 'price' },
    });

    expect(request).toEqual({
      params: { id: 'p1' },
      path: '/products/:id',
      search: { max: 25, sort: 'price' },
    });
    expect(await productRoute.page?.(request, {})).toBe('p1:25');
    expect(renderPageHints(productRoute)).toEqual({
      earlyHints: {},
      html: [
        '<title>Product detail</title>',
        '<script type="speculationrules">{"prerender":[{"eagerness":"conservative","urls":["/products/p1"]}]}</script>',
      ].join(''),
    });
    expect(
      redirect('/products/:id', { params: { id: 'p1' }, search: { max: 10, sort: 'price' } }),
    ).toEqual({
      location: '/products/p1?max=10&sort=price',
      status: 303,
    });

    const assertBadRedirect = () => {
      // @ts-expect-error sku is not part of the generated route search schema.
      redirect('/products/:id', { params: { id: 'p1' }, search: { sku: 'sku-1' } });
    };
    expect(assertBadRedirect).toBeTypeOf('function');
  });

  it('runs query endpoints through args schemas, guards, and request context', async () => {
    type ProductQueryInput = { id: string; max: number };
    type ProductQueryRequest = { session?: { userId?: string } | null };

    const productQuery = query('productDetail', {
      args: s.object({ id: s.string(), max: s.number().int().default(10) }),
      guard: (request: ProductQueryRequest) => request.session?.userId === 'u1',
      instanceKey: (input) => `product:${(input as { id: string }).id}`,
      load(input: ProductQueryInput, { request }: { request: ProductQueryRequest }) {
        return { id: input.id, max: input.max, userId: request.session?.userId };
      },
      reads: [domain('product')],
      version: (input: ProductQueryInput) => input.max,
    });

    await expect(
      runQuery(productQuery, { id: 'p1' }, { session: { userId: 'u1' } }),
    ).resolves.toEqual({
      input: { id: 'p1', max: 10 },
      ok: true,
      value: { id: 'p1', max: 10, userId: 'u1' },
    });
    await expect(runQuery(productQuery, {}, { session: { userId: 'u1' } })).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected string', path: ['id'] }] },
      },
      ok: false,
      status: 422,
    });
    await expect(runQuery(productQuery, { id: 'p1' }, { session: null })).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });

    await expect(
      renderQueryEndpointResponse(productQuery, {
        request: { session: { userId: 'u1' } },
        search: new URLSearchParams([
          ['id', 'p1'],
          ['max', '3'],
        ]),
      }),
    ).resolves.toEqual({
      body: '<fw-query name="product:p1" version="3">{"id":"p1","max":3,"userId":"u1"}</fw-query>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
  });

  it('keeps chained schema constraints immutable', () => {
    const baseNumber = s.number();
    const positiveInteger = baseNumber.int().min(1);

    expect(baseNumber.parse(0.5)).toBe(0.5);
    expect(() => positiveInteger.parse(0.5)).toThrow('Expected integer');
    expect(() => positiveInteger.parse(0)).toThrow('Expected number >= 1');

    const file = {
      arrayBuffer: async () => new ArrayBuffer(0),
      name: 'cart.txt',
      size: 12,
      type: 'text/plain',
    };
    const baseFile = s.file();
    const imageFile = baseFile.mime(['image/png']).maxBytes(10);

    expect(baseFile.parse(file)).toBe(file);
    expect(() => imageFile.parse(file)).toThrow('Expected file <= 10 bytes');
  });

  it('matches the typed read wire fixture response byte-for-byte', async () => {
    const productQuery = query('product', {
      args: s.object({ id: s.string() }),
      instanceKey: (input) => `product:${(input as { id: string }).id}`,
      load(input: { id: string }) {
        expect(input).toEqual({ id: 'p1' });
        return { name: 'Mug', stock: 4 };
      },
      reads: [domain('product')],
    });
    const response = await renderQueryEndpointResponse(productQuery, {
      request: {},
      search: new URLSearchParams([['id', 'p1']]),
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/typed-read.http', import.meta.url),
      'utf8',
    );

    expect(normalizeWireResponse(response, 'OK')).toEqual(readFixtureResponses(fixture).at(-1));
  });

  it('renders query endpoint loader exceptions as stable 500 JSON', async () => {
    const productQuery = query('product', {
      load() {
        throw new Error('database password leaked in stack');
      },
      reads: [domain('product')],
    });

    await expect(renderQueryEndpointResponse(productQuery, { request: {} })).resolves.toEqual({
      body: '{"code":"SERVER_ERROR","payload":{}}',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 500,
    });
  });

  it('dispatches typed read endpoints through a query registry', async () => {
    const productQuery = query('product', {
      args: s.object({ id: s.string() }),
      instanceKey: (input) => `product:${(input as { id: string }).id}`,
      load(input: { id: string }) {
        return { id: input.id, name: 'Mug' };
      },
      reads: [domain('product')],
    });

    await expect(
      renderQueryRegistryEndpointResponse({ queries: [productQuery] }, 'product', {
        request: {},
        search: new URLSearchParams([['id', 'p1']]),
      }),
    ).resolves.toEqual({
      body: '<fw-query name="product:p1">{"id":"p1","name":"Mug"}</fw-query>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });

    await expect(
      renderQueryRegistryEndpointResponse({ queries: [productQuery] }, 'missing', {
        request: {},
      }),
    ).resolves.toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
  });

  it('runs route pages through guards and notFound page outcomes', async () => {
    const productRoute = route('/products/:id', {
      guard: (request: { session?: { userId?: string } | null }) =>
        request.session?.userId === 'u1',
      page(context, request: { session: { userId: string } }) {
        if (context.params.id === 'missing') return notFound();
        return `${request.session.userId}:${context.params.id}:${context.search.tab}`;
      },
      params: s.object({ id: s.string() }),
      search: s.object({ tab: s.string() }),
    });

    await expect(
      runRoutePage(
        productRoute,
        { params: { id: 'p1' }, search: { tab: 'details' } },
        { session: { userId: 'u1' } },
      ),
    ).resolves.toEqual({
      ok: true,
      value: 'u1:p1:details',
    });
    await expect(
      runRoutePage(
        productRoute,
        { params: { id: 'p1' }, search: { tab: 'details' } },
        { session: null },
      ),
    ).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
    await expect(
      renderRoutePageResponse(
        productRoute,
        { params: { id: 'missing' }, search: { tab: 'details' } },
        { session: { userId: 'u1' } },
      ),
    ).resolves.toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 404,
    });
    await expect(
      renderRoutePageResponse(
        productRoute,
        { params: { id: 'p1' }, search: { tab: 'reviews' } },
        { session: { userId: 'u1' } },
        (value) => `<main>${value}</main>`,
      ),
    ).resolves.toEqual({
      body: '<main>u1:p1:reviews</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
  });

  it('renders route page and renderer exceptions as stable 500 HTML', async () => {
    const throwingPage = route('/products/:id', {
      page() {
        throw new Error('private route load detail');
      },
    });
    const throwingRenderer = route('/cart', {
      page() {
        return 'cart';
      },
    });
    const serverErrorResponse = {
      body: 'Internal Server Error',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 500,
    };

    await expect(
      renderRoutePageResponse(throwingPage, { params: { id: 'p1' } }, {}),
    ).resolves.toEqual(serverErrorResponse);
    await expect(
      renderRoutePageResponse(throwingRenderer, {}, {}, () => {
        throw new Error('private render detail');
      }),
    ).resolves.toEqual(serverErrorResponse);
  });

  it('renders modulepreloads, opt-in speculation rules, and Early Hints headers', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart.client.js', '/c/cart.client.js', '/c/recs.client.js'],
        prefetch: 'conservative',
        prerenderUrls: ['/cart', '/checkout'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</c/cart.client.js>; rel=modulepreload, </c/recs.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/cart.client.js">',
        '<link rel="modulepreload" href="/c/recs.client.js">',
        '<script type="speculationrules">{"prerender":[{"eagerness":"conservative","urls":["/cart","/checkout"]}]}</script>',
      ].join(''),
    });
  });

  it('renders and preloads the generated app bootstrap script', () => {
    expect(
      renderPageHints({
        bootstrapScript: '/c/generated/app.client.js',
        modulepreloads: ['/c/cart.client.js', '/c/generated/app.client.js'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</c/cart.client.js>; rel=modulepreload, </c/generated/app.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/cart.client.js">',
        '<link rel="modulepreload" href="/c/generated/app.client.js">',
        '<script type="module" src="/c/generated/app.client.js"></script>',
      ].join(''),
    });
  });

  it('renders versioned client module hrefs in page hints', () => {
    const bootstrapScript = versionedClientModuleHref('/c/generated/app.client.js', 'build-1');
    const cartModule = versionedClientModuleHref('/c/cart.client.js', 'cart-1');

    expect(
      renderPageHints({
        bootstrapScript,
        modulepreloads: [cartModule, bootstrapScript],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</c/cart.client.js?v=cart-1>; rel=modulepreload, </c/generated/app.client.js?v=build-1>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/cart.client.js?v=cart-1">',
        '<link rel="modulepreload" href="/c/generated/app.client.js?v=build-1">',
        '<script type="module" src="/c/generated/app.client.js?v=build-1"></script>',
      ].join(''),
    });
    expect(versionedClientModuleHref('/c/cart.client.js#Cart$add', 'cart-1')).toBe(
      '/c/cart.client.js?v=cart-1#Cart$add',
    );
  });

  it('retains old versioned client module responses after newer deploys register', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const oldHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const version = "old";',
      version: 'old',
    });
    const newHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const version = "new";',
      version: 'new',
    });

    expect(oldHref).toBe('/c/cart.client.js?v=old');
    expect(newHref).toBe('/c/cart.client.js?v=new');
    expect(registry.resolve(oldHref)).toEqual({
      body: 'export const version = "old";',
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': 'text/javascript; charset=utf-8',
      },
      status: 200,
    });
    expect(registry.resolve(newHref)).toMatchObject({
      body: 'export const version = "new";',
      status: 200,
    });
  });

  it('can bound retained client module versions per path', () => {
    const registry = createMemoryVersionedClientModuleRegistry({ maxVersionsPerPath: 1 });
    const oldHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const version = "old";',
      version: 'old',
    });
    const newHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const version = "new";',
      version: 'new',
    });

    expect(registry.resolve(oldHref)).toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
    expect(registry.resolve('/c/cart.client.js')).toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
    expect(registry.resolve(newHref)).toMatchObject({ body: 'export const version = "new";' });
  });

  it('serves versioned client module requests through the immutable registry', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const href = registry.put({
      contentType: 'text/javascript; charset=utf-8',
      path: '/c/cart.client.js',
      source: 'export const version = "build-1";',
      version: 'build-1',
    });

    expect(renderVersionedClientModuleResponse(registry, { url: href })).toEqual({
      body: 'export const version = "build-1";',
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': 'text/javascript; charset=utf-8',
      },
      status: 200,
    });
    expect(renderVersionedClientModuleResponse(registry, { url: '/c/cart.client.js' })).toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
    expect(
      renderVersionedClientModuleResponse(registry, { url: '/assets/cart.client.js' }),
    ).toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
  });

  it('reads enhanced mutation wire headers case-insensitively', () => {
    expect(
      readMutationWireHeaders({
        'fw-fragment': 'true',
        'FW-Idem': ' idem_01HX ',
        'FW-Targets': 'cart-badge=cart; recommendations=product:p1, cart-badge=cart',
      }),
    ).toEqual({
      fragment: true,
      idem: 'idem_01HX',
      targets: ['cart-badge', 'recommendations'],
    });
  });

  it('builds mutation wire requests from iterable HTTP headers', () => {
    const replayStore = createMemoryMutationReplayStore();

    expect(
      mutationWireRequestFromHeaders({
        headers: new Map([
          ['FW-Fragment', 'true'],
          ['FW-Idem', 'idem_01HY'],
          ['FW-Targets', 'product-form:p1'],
        ]),
        rawInput: { productId: 'p1', quantity: 99 },
        replayStore,
        request: { sessionId: 's1' },
      }),
    ).toEqual({
      fragment: true,
      idem: 'idem_01HY',
      rawInput: { productId: 'p1', quantity: 99 },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['product-form:p1'],
    });
  });

  it('bounds memory mutation replay records by ttl and entry count', () => {
    vi.useFakeTimers();
    try {
      const replayStore = createMemoryMutationReplayStore({ maxEntries: 1, ttlMs: 100 });
      const first = {
        body: 'first',
        headers: { 'FW-Idem': 'idem_01' },
        status: 200,
      } as const;
      const second = {
        body: 'second',
        headers: { 'FW-Idem': 'idem_02' },
        status: 200,
      } as const;

      replayStore.set('session-a', 'idem_01', first);
      replayStore.set('session-a', 'idem_02', second);

      expect(replayStore.get('session-a', 'idem_01')).toBeUndefined();
      expect(replayStore.get('session-a', 'idem_02')).toEqual(second);

      vi.advanceTimersByTime(100);

      expect(replayStore.get('session-a', 'idem_02')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes mutation endpoints without FW-Fragment through the no-JS POST redirect', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {},
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/cart',
      },
      status: 303,
    });
  });

  it('routes mutation endpoints with FW-Fragment through enhanced fragment wire responses', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        fragmentRenderers: [{ render: () => '<cart-badge>1</cart-badge>', target: 'cart-badge' }],
        headers: {
          'FW-Fragment': 'true',
          'FW-Targets': 'cart-badge',
        },
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: [
        '<fw-query name="cart">{"count":1}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
      ].join('\n'),
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 200,
    });
  });

  it('rerenders only matching keyed query instances in enhanced mutation responses', async () => {
    const product = domain('product');
    const productP1 = query('productDetail', {
      instanceKey: 'product:p1',
      load: () => ({ id: 'p1', stock: 0 }),
      reads: [product],
    });
    const productP2 = query('productDetail', {
      instanceKey: 'product:p2',
      load: () => ({ id: 'p2', stock: 10 }),
      reads: [product],
    });
    const reserveProduct = mutation('product/reserve', {
      input: s.object({ productId: s.string() }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [productP1, productP2],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(reserveProduct, {
        fragmentRenderers: [],
        headers: {
          'FW-Fragment': 'true',
        },
        rawInput: { productId: 'p1' },
        redirectTo: '/products/p1',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '<fw-query name="productDetail" key="product:p1">{"id":"p1","stock":0}</fw-query>',
      status: 200,
    });
  });

  it('routes mutation endpoint validation failures by request mode', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        failureTarget: 'cart-form',
        headers: { 'FW-Fragment': 'true' },
        rawInput: { productId: 'p1', quantity: 0 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="cart-form"><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 422,
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {},
        rawInput: { productId: 'p1', quantity: 0 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });

  it('renders stylesheet assets for Tailwind-first CSS delivery', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart.client.js'],
        stylesheets: [
          '/assets/tailwind.css',
          '/assets/tailwind.css',
          { href: '/assets/print.css', preload: false },
        ],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/tailwind.css>; rel=preload; as=style, </c/cart.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="stylesheet" href="/assets/tailwind.css">',
        '<link rel="stylesheet" href="/assets/print.css">',
        '<link rel="modulepreload" href="/c/cart.client.js">',
      ].join(''),
    });
  });

  it('inlines critical component CSS without losing stylesheet identity', () => {
    expect(
      renderPageHints({
        stylesheets: [
          '/assets/components/cart/cart-badge.css',
          {
            criticalCss: 'cart-badge { color: teal; }</style> cart-badge { display: block; }',
            href: '/assets/components/cart/cart-badge.css',
          },
        ],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/components/cart/cart-badge.css>; rel=preload; as=style',
      },
      html: [
        '<style data-jiso-critical-href="/assets/components/cart/cart-badge.css">cart-badge { color: teal; }<\\/style> cart-badge { display: block; }</style>',
        '<link rel="stylesheet" href="/assets/components/cart/cart-badge.css">',
      ].join(''),
    });
  });

  it('selects manifest stylesheets for pages and late fragments', () => {
    const manifest = [
      {
        criticalCss: 'cart-badge { color: teal; }',
        fragmentTargets: ['cart-badge'],
        href: '/assets/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
      {
        fragmentTargets: ['cart-drawer'],
        href: '/assets/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
      {
        fragmentTargets: ['cart-drawer'],
        href: '/assets/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ];

    expect(renderPageHints({ stylesheets: stylesheetsForTargets(manifest) })).toEqual({
      earlyHints: {
        Link: '</assets/components/cart/cart-badge.css>; rel=preload; as=style, </assets/components/cart/cart-drawer.css>; rel=preload; as=style',
      },
      html: [
        '<style data-jiso-critical-href="/assets/components/cart/cart-badge.css">cart-badge { color: teal; }</style>',
        '<link rel="stylesheet" href="/assets/components/cart/cart-badge.css">',
        '<link rel="stylesheet" href="/assets/components/cart/cart-drawer.css">',
      ].join(''),
    });
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [
              {
                html: '<cart-drawer>Ready</cart-drawer>',
                stylesheets: stylesheetsForTargets(manifest, ['cart-drawer']),
                target: 'cart-drawer',
              },
            ],
          },
        ],
        shell: '<!doctype html><html><body><fw-defer target="cart-drawer"></fw-defer>',
      }).body,
    ).toContain(
      '<fw-fragment target="cart-drawer"><link rel="stylesheet" href="/assets/components/cart/cart-drawer.css"><cart-drawer>Ready</cart-drawer></fw-fragment>',
    );
  });

  it('encodes Early Hints link targets without changing rendered hrefs', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart client.js?target=<badge>'],
        stylesheets: ['/assets/tailwind,print.css'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/tailwind%2Cprint.css>; rel=preload; as=style, </c/cart%20client.js?target=%3Cbadge%3E>; rel=modulepreload',
      },
      html: [
        '<link rel="stylesheet" href="/assets/tailwind,print.css">',
        '<link rel="modulepreload" href="/c/cart client.js?target=&lt;badge&gt;">',
      ].join(''),
    });
  });

  it('renders typed route meta with page hints', () => {
    const productMeta = meta({
      description: 'Fast cart <checkout>',
      image: '/products/p1.png',
      title: 'Cart & Checkout',
    });

    expect(
      renderPageHints({
        meta: productMeta,
        modulepreloads: ['/c/cart.client.js'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</c/cart.client.js>; rel=modulepreload',
      },
      html: [
        '<title>Cart &amp; Checkout</title>',
        '<meta name="description" content="Fast cart &lt;checkout&gt;">',
        '<meta property="og:description" content="Fast cart &lt;checkout&gt;">',
        '<meta property="og:image" content="/products/p1.png">',
        '<link rel="modulepreload" href="/c/cart.client.js">',
      ].join(''),
    });
  });

  it('derives typed route meta from query results', () => {
    const productQuery = query('product', {
      load: (_input: { id: string }) => ({
        id: 'p1',
        name: 'Coffee',
        stock: 5,
      }),
      reads: [domain('product')],
    });
    const eagerProductMeta = metaFromQuery(
      productQuery,
      productQuery.load({ id: 'p1' }),
      (product) => ({
        description: `${product.stock} available`,
        title: product.name,
      }),
    );
    const productMeta = metaFromQuery(productQuery, (product) => ({
      description: `${product.stock} available`,
      title: product.name,
    }));

    metaFromQuery(productQuery, productQuery.load({ id: 'p1' }), (product) => ({
      // @ts-expect-error query-derived meta can only use fields present in the query result.
      title: product.missingName,
    }));

    expect(renderPageHints({ meta: eagerProductMeta })).toEqual({
      earlyHints: {},
      html: [
        '<title>Coffee</title>',
        '<meta name="description" content="5 available">',
        '<meta property="og:description" content="5 available">',
      ].join(''),
    });
    expect(
      renderPageHints(
        { meta: productMeta },
        { queries: { product: { id: 'p2', name: 'Tea', stock: 3 } } },
      ),
    ).toEqual({
      earlyHints: {},
      html: [
        '<title>Tea</title>',
        '<meta name="description" content="3 available">',
        '<meta property="og:description" content="3 available">',
      ].join(''),
    });
    expect(() => renderPageHints({ meta: productMeta })).toThrow(
      'Missing query data for route meta: product',
    );
  });

  it('renders server-side i18n catalogs with page hints', () => {
    const en = i18n('en-US', {
      cartCount: 'Cart has {count} items',
      unsafe: 'Use <strong>server text</strong>',
    });

    expect(t(en, 'cartCount', { count: 3 })).toBe('Cart has 3 items');
    expect(t(en, 'cartCount')).toBe('Cart has {count} items');
    expect(renderPageHints({ i18n: en })).toEqual({
      earlyHints: {},
      html: '<script type="application/json" fw-i18n locale="en-US">{"cartCount":"Cart has {count} items","unsafe":"Use \\u003cstrong>server text\\u003c/strong>"}</script>',
    });
  });

  it('renders initial query scripts for document-load hydration', () => {
    expect(
      renderQueryScript({
        key: 'cart:c1',
        name: 'cart',
        value: {
          html: '</script><script>alert(1)</script>',
          items: [{ productId: 'p1', qty: 1 }],
        },
      }),
    ).toBe(
      '<script type="application/json" fw-query="cart" key="cart:c1">{"html":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>","items":[{"productId":"p1","qty":1}]}</script>',
    );
  });

  it('keeps speculation rules default-off for ordinary page hints', () => {
    expect(renderPageHints({ modulepreloads: ['/c/cart.client.js'] })).toEqual({
      earlyHints: { Link: '</c/cart.client.js>; rel=modulepreload' },
      html: '<link rel="modulepreload" href="/c/cart.client.js">',
    });
    expect(renderPageHints({ prefetch: false, prerenderUrls: ['/cart'] })).toEqual({
      earlyHints: {},
      html: '',
    });
    expect(renderPageHints({ prefetch: 'moderate', prerenderUrls: ['', ''] })).toEqual({
      earlyHints: {},
      html: '',
    });
  });

  it('renders moderate speculation rules with deduped escaped prerender urls only when opted in', () => {
    expect(
      renderPageHints({
        prefetch: 'moderate',
        prerenderUrls: ['/cart', '', '/cart', '/search?q=</script><x>'],
      }),
    ).toEqual({
      earlyHints: {},
      html: '<script type="speculationrules">{"prerender":[{"eagerness":"moderate","urls":["/cart","/search?q=\\u003c/script>\\u003cx>"]}]}</script>',
    });
  });

  it('renders deferred streams with shell first and query JSON before fragments', () => {
    expect(
      renderDeferredStream({
        closeHtml: '</body></html>',
        chunks: [
          {
            fragments: [
              {
                html: '<section fw-c="reviews" fw-deps="product:p1"><article fw-key="r1">5</article></section>',
                target: 'reviews:p1',
              },
            ],
            queries: [
              { key: 'product:p1', name: 'reviews', value: { items: [{ id: 'r1', rating: 5 }] } },
            ],
          },
        ],
        shell:
          '<!doctype html>\n<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer></product-page></main>',
      }),
    ).toEqual({
      body: [
        '<!doctype html>\n<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer></product-page></main>',
        '--jiso-boundary',
        '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><section fw-c="reviews" fw-deps="product:p1"><article fw-key="r1">5</article></section></fw-fragment>',
        '--jiso-boundary--',
        '</body></html>',
      ].join('\n'),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
      status: 200,
    });
  });

  it('matches the deferred stream wire fixture response byte-for-byte', async () => {
    const response = renderDeferredStream({
      closeHtml: '</body></html>',
      chunks: [
        {
          fragments: [
            {
              html: '<section fw-c="reviews" fw-deps="product:p1"><article fw-key="r1">5</article></section>',
              priority: 5,
              stylesheets: ['/assets/reviews.css'],
              target: 'reviews:p1',
            },
            {
              html: '<section fw-c="recommendations" fw-deps="product:p1"><article fw-key="rec-1">Beans</article></section>',
              target: 'recommendations:p1',
            },
          ],
          queries: [
            { key: 'product:p1', name: 'reviews', value: { items: [{ id: 'r1', rating: 5 }] } },
            { key: 'product:p1', name: 'recommendations', value: { items: [{ id: 'rec-1' }] } },
          ],
        },
      ],
      shell:
        '<!doctype html>\n<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer><fw-defer target="recommendations:p1" state="pending"></fw-defer></product-page></main>\n',
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/defer-stream.http', import.meta.url),
      'utf8',
    );

    expect(normalizeWireResponse(response, 'OK')).toEqual(readFixtureResponses(fixture).at(-1));
  });

  it('orders deferred stream chunks and fragments by priority while keeping query JSON first', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [{ html: '<section>low</section>', target: 'low' }],
            priority: 'low',
            queries: [{ name: 'lowQuery', value: { ready: true } }],
          },
          {
            fragments: [
              { html: '<section>normal</section>', target: 'normal' },
              { html: '<section>critical</section>', priority: 5, target: 'critical&details' },
            ],
            priority: 'high',
            queries: [{ name: 'criticalQuery', value: { ready: true } }],
          },
        ],
        shell: '<!doctype html><html><body><fw-defer target="critical&details"></fw-defer>',
      }),
    ).toEqual({
      body: [
        '<!doctype html><html><body><fw-defer target="critical&details"></fw-defer>',
        '--jiso-boundary',
        '<fw-query name="criticalQuery">{"ready":true}</fw-query>',
        '<fw-fragment target="critical&amp;details" priority="5"><section>critical</section></fw-fragment>',
        '<fw-fragment target="normal"><section>normal</section></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="lowQuery">{"ready":true}</fw-query>',
        '<fw-fragment target="low"><section>low</section></fw-fragment>',
        '--jiso-boundary--',
        '',
      ].join('\n'),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
      status: 200,
    });
  });

  it('renders explicit numeric deferred fragment priority hints including zero', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [{ html: '<section>normal</section>', priority: 0, target: 'normal' }],
            queries: [{ name: 'cart', value: { count: 1 } }],
          },
        ],
        closeHtml: '',
        shell: '<!doctype html><html><body><fw-defer target="normal"></fw-defer>',
      }).body,
    ).toBe(
      [
        '<!doctype html><html><body><fw-defer target="normal"></fw-defer>',
        '--jiso-boundary',
        '<fw-query name="cart">{"count":1}</fw-query>',
        '<fw-fragment target="normal" priority="0"><section>normal</section></fw-fragment>',
        '--jiso-boundary--',
        '',
      ].join('\n'),
    );
  });

  it('renders deferred append fragment mode for streamed pagination fragments', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [
              {
                html: '<article fw-key="p3">Third</article>',
                mode: 'append',
                target: 'product-grid',
              },
            ],
          },
        ],
        closeHtml: '',
        shell: '<!doctype html><html><body><fw-defer target="product-grid"></fw-defer>',
      }).body,
    ).toBe(
      [
        '<!doctype html><html><body><fw-defer target="product-grid"></fw-defer>',
        '--jiso-boundary',
        '<fw-fragment target="product-grid" mode="append"><article fw-key="p3">Third</article></fw-fragment>',
        '--jiso-boundary--',
        '',
      ].join('\n'),
    );
  });

  it('delivers late stylesheets with deferred fragments', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [
              {
                html: '<section class="reviews-card">Ready</section>',
                stylesheets: ['/assets/reviews.css', '/assets/reviews.css'],
                target: 'reviews:p1',
              },
            ],
          },
        ],
        shell: '<!doctype html><html><body><fw-defer target="reviews:p1"></fw-defer>',
      }).body,
    ).toContain(
      '<fw-fragment target="reviews:p1"><link rel="stylesheet" href="/assets/reviews.css"><section class="reviews-card">Ready</section></fw-fragment>',
    );
  });

  it('coerces FormData once through the declared schema', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.set('productId', 'p1');
    form.set('quantity', '2');

    await expect(runMutation(addToCart, form, {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: { productId: 'p1', quantity: 2 },
    });
  });

  it('coerces checkbox booleans and repeated FormData fields through declared schemas', async () => {
    const updatePreferences = mutation('preferences/update', {
      input: s.object({
        emailOptIn: s.boolean(),
        tags: s.array(s.string()),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.set('emailOptIn', 'on');
    form.append('tags', 'cart');
    form.append('tags', 'deals');

    await expect(runMutation(updatePreferences, form, {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: {
        emailOptIn: true,
        tags: ['cart', 'deals'],
      },
    });

    await expect(runMutation(updatePreferences, new FormData(), {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: {
        emailOptIn: false,
        tags: [],
      },
    });
  });

  it('treats single submitted values as one-item arrays', async () => {
    const filterProducts = mutation('products/filter', {
      input: s.object({
        categories: s.array(s.string()),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.set('categories', 'books');

    await expect(runMutation(filterProducts, form, {})).resolves.toMatchObject({
      ok: true,
      value: {
        categories: ['books'],
      },
    });
  });

  it('returns indexed validation paths for array schema errors', async () => {
    const bulkAdd = mutation('cart/bulk-add', {
      input: s.object({
        quantities: s.array(s.number().int().min(1)),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.append('quantities', '1');
    form.append('quantities', '0');

    await expect(runMutation(bulkAdd, form, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected number >= 1', path: ['quantities', '1'] }] },
      },
      ok: false,
      status: 422,
    });
  });

  it('coerces multipart file fields through s.file()', async () => {
    const uploadAvatar = mutation('profile/avatar', {
      input: s.object({
        avatar: s.file({ maxBytes: 16, mime: ['image/png'] }),
      }),
      handler(input) {
        return {
          name: input.avatar.name,
          size: input.avatar.size,
          type: input.avatar.type,
        };
      },
    });
    const form = new FormData();
    form.set('avatar', formDataFile(['avatar'], 'avatar.png', 'image/png'));

    await expect(runMutation(uploadAvatar, form, {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: {
        name: 'avatar.png',
        size: 6,
        type: 'image/png',
      },
    });
  });

  it('returns validation failures with field paths for schema errors', async () => {
    const uploadAvatar = mutation('profile/avatar', {
      input: s.object({
        avatar: s.file().maxBytes(4).mime(['image/png']),
      }),
      handler(input) {
        return input.avatar.name;
      },
    });
    const oversized = new FormData();
    oversized.set('avatar', formDataFile(['large'], 'avatar.png', 'image/png'));
    const wrongType = new FormData();
    wrongType.set('avatar', formDataFile(['ok'], 'avatar.txt', 'text/plain'));

    await expect(runMutation(uploadAvatar, new FormData(), {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected file', path: ['avatar'] }] },
      },
      ok: false,
      status: 422,
    });
    await expect(runMutation(uploadAvatar, oversized, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected file <= 4 bytes', path: ['avatar'] }] },
      },
      ok: false,
      status: 422,
    });
    await expect(runMutation(uploadAvatar, wrongType, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected file type image/png', path: ['avatar'] }] },
      },
      ok: false,
      status: 422,
    });
  });

  it('returns typed validation failures from ctx.fail', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1', quantity: 9 }, {})).resolves.toEqual({
      error: {
        code: 'OUT_OF_STOCK',
        payload: { availableQuantity: 0 },
      },
      ok: false,
      status: 422,
    });
  });

  it('composes guards with all()', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.all<{ authed: boolean }>((request) => request.authed),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, { productId: 'p1' }, { authed: false })).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
  });

  it('parses mutation input before running guards', async () => {
    let guardCalls = 0;
    const guarded = mutation('cart/add', {
      guard() {
        guardCalls += 1;
        return false;
      },
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, {}, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected string', path: ['productId'] }] },
      },
      ok: false,
      status: 422,
    });
    expect(guardCalls).toBe(0);
  });

  it('validates mutation CSRF tokens before running guards', async () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId(candidate: typeof request) {
        return candidate.session.id;
      },
    };
    let guardCalls = 0;
    const addToCart = mutation('cart/add', {
      csrf,
      guard() {
        guardCalls += 1;
        return true;
      },
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input.productId;
      },
    });
    const token = csrfToken(request, csrf);

    expect(csrfField(request, csrf)).toBe(`<input type="hidden" name="csrf" value="${token}">`);
    await expect(
      runMutation(addToCart, { csrf: token, productId: 'p1' }, request),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
    expect(guardCalls).toBe(1);

    await expect(runMutation(addToCart, { productId: 'p1' }, request)).resolves.toEqual({
      error: { code: 'CSRF', payload: {} },
      ok: false,
      status: 422,
    });
    expect(guardCalls).toBe(1);
  });

  it('uses default mutation CSRF options before schema parsing when csrf is omitted', async () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId(candidate: typeof request) {
        return candidate.session.id;
      },
    };
    const addToCart = defineMutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input, _request: typeof request) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, {}, request, { csrf })).resolves.toEqual({
      error: { code: 'CSRF', payload: {} },
      ok: false,
      status: 422,
    });

    await expect(
      runMutation(addToCart, { csrf: csrfToken(request, csrf) }, request, { csrf }),
    ).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected string', path: ['productId'] }] },
      },
      ok: false,
      status: 422,
    });
  });

  it('fails closed before handlers when csrf is omitted and no default options are provided', async () => {
    let writes = 0;
    const addToCart = defineMutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        writes += 1;
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      error: { code: 'CSRF', payload: {} },
      ok: false,
      status: 422,
    });
    expect(writes).toBe(0);
  });

  it('preserves legacy mutation execution when csrf is explicitly false', async () => {
    const addToCart = defineMutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
  });

  it('does not consult replay records before default CSRF validation', async () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId(candidate: typeof request) {
        return candidate.session.id;
      },
    };
    let getCalls = 0;
    let writes = 0;
    const replayStore: MutationReplayStore = {
      get() {
        getCalls += 1;
        return {
          body: '<fw-query name="cart">{"count":999}</fw-query>',
          headers: {},
          status: 200,
        };
      },
      reserve() {
        throw new Error('replay reserve should not run before CSRF validation');
      },
      set() {},
    };
    const addToCart = defineMutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input, _request: typeof request) {
        writes += 1;
        return input.productId;
      },
    });

    const response = await renderMutationResponse(addToCart, {
      csrf,
      idem: 'idem_01',
      rawInput: { productId: 'p1' },
      replayStore,
      request,
    });

    expect(getCalls).toBe(0);
    expect(writes).toBe(0);
    expect(response).toMatchObject({ status: 422 });
    expect(response.body).toContain('data-error-code="CSRF"');
  });

  it('runs guarded mutation handlers inside the configured transaction', async () => {
    const events: string[] = [];
    const transactional = mutation('cart/add', {
      guard() {
        events.push('guard');
        return true;
      },
      input: s.object({ productId: s.string() }),
      async transaction(request: { tx?: boolean }, run) {
        events.push('begin');
        const value = await run({ ...request, tx: true });
        events.push('commit');
        return value;
      },
      handler(input, request: { tx?: boolean }) {
        events.push(`handler:${request.tx === true ? 'tx' : 'plain'}`);
        return input.productId;
      },
    });

    await expect(runMutation(transactional, { productId: 'p1' }, {})).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
    expect(events).toEqual(['guard', 'begin', 'handler:tx', 'commit']);
  });

  it('types transaction callbacks with the mutation request shape', async () => {
    interface TxRequest {
      db: {
        txOnly(): void;
        write(table: string): void;
      };
    }

    const events: string[] = [];
    const typeOnly = undefined as unknown as boolean;
    const transactional = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      transaction(request: TxRequest, run) {
        request.db.txOnly();
        if (typeOnly) {
          // @ts-expect-error transaction callbacks must receive the typed request shape.
          void run({ db: { write() {} } });
        }
        return run(request);
      },
      handler(input, request: TxRequest) {
        request.db.txOnly();
        request.db.write('cart_items');
        return input.productId;
      },
    });

    await expect(
      runMutation(
        transactional,
        { productId: 'p1' },
        {
          db: {
            txOnly() {
              events.push('tx');
            },
            write(table) {
              events.push(`write:${table}`);
            },
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
    expect(events).toEqual(['tx', 'tx', 'write:cart_items']);
  });

  it('rolls back configured transactions for typed mutation failures', async () => {
    const events: string[] = [];
    const transactional = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      async transaction(request: {}, run) {
        events.push('begin');
        try {
          return await run(request);
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
      handler(_input, _request, context) {
        events.push('handler');
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(runMutation(transactional, { productId: 'p1' }, {})).resolves.toEqual({
      error: {
        code: 'OUT_OF_STOCK',
        payload: { availableQuantity: 0 },
      },
      ok: false,
      status: 422,
    });
    expect(events).toEqual(['begin', 'handler', 'rollback']);
  });

  it('guards mutations by authenticated session user', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, { productId: 'p1' }, { session: null })).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { user: { id: 'u1' } } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
  });

  it('refines typed session users inside authed mutation handlers', async () => {
    interface OptionalSessionRequest {
      session?: {
        user?: { id: string; roles?: readonly string[] } | null;
      } | null;
    }

    const guarded = mutation('cart/audit', {
      guard: guards.authed<OptionalSessionRequest>(),
      input: s.object({ productId: s.string() }),
      handler(input, request) {
        const userId: string = request.session.user.id;
        const roles: readonly string[] | undefined = request.session.user.roles;
        const assertUnrefinedRequest = (candidate: OptionalSessionRequest) => {
          // @ts-expect-error optional sessions are not safe until the authed guard refines them.
          return candidate.session.user.id;
        };

        expect(assertUnrefinedRequest).toBeTypeOf('function');
        return `${userId}:${input.productId}:${roles?.join(',') ?? 'none'}`;
      },
    });

    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { user: { id: 'u1' } } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'u1:p1:none',
    });
  });

  it('parses typed sessions through the declared schema', () => {
    const appSession = session(
      s.object({
        cartId: s.string(),
        userId: s.string(),
      }),
    );

    expect(appSession.parse({ session: { cartId: 'cart-1', userId: 'u1' } })).toEqual({
      cartId: 'cart-1',
      userId: 'u1',
    });
    expect(() => appSession.parse({})).toThrow('Expected object input');
  });

  it('guards mutations by session user role', async () => {
    const guarded = mutation('admin/refund', {
      guard: guards.role('admin'),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { user: { roles: ['staff'] } } }),
    ).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { user: { roles: ['admin'] } } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
  });

  it('rate-limits mutations by session by default', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.rateLimit({ max: 1, per: 'session' }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
    ).resolves.toEqual({
      error: { code: 'RATE_LIMITED', payload: {} },
      ok: false,
      retryAfter: 60,
      status: 429,
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { id: 's2' } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
  });

  it('resets rate-limit buckets after the configured window', async () => {
    const now = vi.spyOn(Date, 'now');
    let currentTime = 1_000;
    now.mockImplementation(() => currentTime);
    const guarded = mutation('cart/add', {
      guard: guards.rateLimit({ max: 1, per: 'session', windowMs: 50 }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    try {
      await expect(
        runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
      ).resolves.toMatchObject({
        ok: true,
        value: 'ok',
      });
      await expect(
        runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
      ).resolves.toMatchObject({
        error: { code: 'RATE_LIMITED', payload: {} },
        ok: false,
        retryAfter: 1,
        status: 429,
      });

      currentTime = 1_051;

      await expect(
        runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
      ).resolves.toMatchObject({
        ok: true,
        value: 'ok',
      });
    } finally {
      now.mockRestore();
    }
  });

  it('shares global rate limits across sessions and isolates custom keys', async () => {
    interface TenantRequest {
      session?: { id?: string };
      tenant: string;
    }

    const globalGuarded = mutation('cart/global-add', {
      guard: guards.rateLimit({ max: 1, per: 'global' }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });
    const keyedGuarded = mutation('cart/keyed-add', {
      guard: guards.rateLimit<TenantRequest>({
        key: (request) => request.tenant,
        max: 1,
      }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      runMutation(globalGuarded, { productId: 'p1' }, { session: { id: 's1' } }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      runMutation(globalGuarded, { productId: 'p1' }, { session: { id: 's2' } }),
    ).resolves.toMatchObject({ error: { code: 'RATE_LIMITED' }, ok: false, status: 429 });

    await expect(
      runMutation(keyedGuarded, { productId: 'p1' }, { tenant: 'a' }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      runMutation(keyedGuarded, { productId: 'p1' }, { tenant: 'b' }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      runMutation(keyedGuarded, { productId: 'p1' }, { tenant: 'a' }),
    ).resolves.toMatchObject({ error: { code: 'RATE_LIMITED' }, ok: false, status: 429 });
  });

  it('evicts oldest rate-limit keys when the key cap is reached', async () => {
    interface TenantRequest {
      session?: { id?: string };
      tenant: string;
    }

    const guarded = mutation('cart/keyed-add', {
      guard: guards.rateLimit<TenantRequest>({
        key: (request) => request.tenant,
        max: 1,
        maxKeys: 2,
      }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, { productId: 'p1' }, { tenant: 'a' })).resolves.toMatchObject(
      { ok: true },
    );
    await expect(runMutation(guarded, { productId: 'p1' }, { tenant: 'b' })).resolves.toMatchObject(
      { ok: true },
    );
    await expect(runMutation(guarded, { productId: 'p1' }, { tenant: 'c' })).resolves.toMatchObject(
      { ok: true },
    );
    await expect(runMutation(guarded, { productId: 'p1' }, { tenant: 'a' })).resolves.toMatchObject(
      { ok: true },
    );
    await expect(runMutation(guarded, { productId: 'p1' }, { tenant: 'c' })).resolves.toMatchObject(
      { error: { code: 'RATE_LIMITED' }, ok: false, status: 429 },
    );
  });

  it('preserves rate-limit status and retry-after headers in mutation wire responses', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.rateLimit({ max: 1, per: 'session', windowMs: 60_000 }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });
    const request = { session: { id: 's1' } };

    await expect(
      renderMutationResponse(guarded, {
        fragment: true,
        rawInput: { productId: 'p1' },
        request,
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      renderMutationResponse(guarded, {
        fragment: true,
        rawInput: { productId: 'p1' },
        request,
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="error"><output role="alert" data-error-code="RATE_LIMITED">{}</output></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'Retry-After': '60',
      },
      status: 429,
    });
  });

  it('preserves rate-limit status and retry-after headers in no-JS mutation responses', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.rateLimit({ max: 1, per: 'session', windowMs: 60_000 }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });
    const request = { session: { id: 's1' } };

    await expect(
      renderNoJsMutationResponse(guarded, {
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request,
      }),
    ).resolves.toMatchObject({ status: 303 });
    await expect(
      renderNoJsMutationResponse(guarded, {
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request,
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-code="RATE_LIMITED">{}</output></body></html>',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Retry-After': '60',
      },
      status: 429,
    });
  });

  it('derives post-commit rerun queries from declared touches', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        queries: [cartQuery, productQuery],
        touches: [cart],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'cart',
          input: { productId: 'p1' },
        },
      ],
      ok: true,
      rerunQueries: ['cart'],
      value: 'p1',
    });
  });

  it('renders mutation query chunks after the configured transaction commits', async () => {
    const state = { committed: 0, pending: 0 };
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: state.committed }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ quantity: s.number().int().min(1) }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      async transaction(request: {}, run) {
        const result = await run(request);
        state.committed = state.pending;
        return result;
      },
      handler(input) {
        state.pending += input.quantity;
        return input.quantity;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragment: true,
        rawInput: { quantity: 2 },
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '<fw-query name="cart">{"count":2}</fw-query>',
      status: 200,
    });
  });

  it('reruns post-commit queries with the same request context', async () => {
    interface RequestContext {
      session: {
        cartId: string;
      };
    }

    const cart = domain('cart');
    const cartQuery = query('cart', {
      instanceKey: (_input) => 'cart:c1',
      load(_input, context: { request: RequestContext }) {
        const cartId: string = context.request.session.cartId;
        return { cartId };
      },
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input, request: RequestContext) {
        return `${request.session.cartId}:${input.productId}`;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragment: true,
        rawInput: { productId: 'p1' },
        request: { session: { cartId: 'c1' } },
      }),
    ).resolves.toMatchObject({
      body: '<fw-query name="cart" key="cart:c1">{"cartId":"c1"}</fw-query>',
      status: 200,
    });
  });

  it('derives post-commit rerun queries from inferred touch sites when touches are absent or empty', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });

    const addToCartWithEmptyTouches = mutation('cart/add-empty', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
        touches: [],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCartWithEmptyTouches, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });
  });

  it('narrows post-commit rerun query instances by row keys', async () => {
    const product = domain('product');
    const productP1 = query('productDetail', { instanceKey: 'product:p1', reads: [product] });
    const productP2 = query('productDetail', { instanceKey: 'product:p2', reads: [product] });
    const reserveProduct = mutation('product/reserve', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [productP1, productP2],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(reserveProduct, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
      ],
      ok: true,
      rerunQueries: ['productDetail'],
      rerunQueryInstances: [{ instanceKey: 'product:p1', key: 'productDetail' }],
      value: 'p1',
    });
  });

  it('preserves manual invalidations when inferred touch sites are active', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
      },
      handler(input, _request, context) {
        context.invalidate(cart, {
          keys: [input.productId],
          reason: 'cart side effect',
        });
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
        {
          domain: 'cart',
          keys: ['p1'],
          manual: true,
          reason: 'cart side effect',
        },
      ],
      ok: true,
      rerunQueries: ['cart', 'product'],
      value: 'p1',
    });
  });

  it('keeps declared touches authoritative over inferred touch sites', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: null }],
        queries: [cartQuery, productQuery],
        touches: [cart],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'cart',
          input: { productId: 'p1' },
        },
      ],
      ok: true,
      rerunQueries: ['cart'],
      value: 'p1',
    });
  });

  it('uses flat tags as the low-ceremony domain on-ramp', async () => {
    const pricing = tag('pricing');
    const pricingQuery = query('pricing', { reads: [pricing] });
    const recalculate = mutation('pricing/recalculate', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [pricingQuery],
        touches: [pricing],
      },
      handler(input, _request, context) {
        context.invalidate(pricing, {
          keys: [input.productId],
          reason: 'external catalog feed',
        });
        return input.productId;
      },
    });

    await expect(runMutation(recalculate, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'pricing',
          input: { productId: 'p1' },
        },
        {
          domain: 'pricing',
          keys: ['p1'],
          manual: true,
          reason: 'external catalog feed',
        },
      ],
      ok: true,
      rerunQueries: ['pricing'],
      value: 'p1',
    });
    expect(invalidate(pricing, { reason: 'manual price import' })).toEqual({
      domain: 'pricing',
      manual: true,
      reason: 'manual price import',
    });
  });

  it('emits manual invalidate escape-hatch records from mutation context', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const syncInventory = mutation('inventory/sync', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery, productQuery],
      },
      handler(input, _request, context) {
        context.invalidate(product, {
          input,
          keys: [input.productId],
          reason: 'external inventory webhook',
        });
        return input.productId;
      },
    });

    await expect(runMutation(syncInventory, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
          manual: true,
          reason: 'external inventory webhook',
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });
  });

  it('creates standalone manual invalidate records for external systems', () => {
    const product = domain('product');

    expect(invalidate(product, { keys: ['p1'], reason: 'stripe webhook' })).toEqual({
      domain: 'product',
      keys: ['p1'],
      manual: true,
      reason: 'stripe webhook',
    });
  });

  it('types change records by domain key and invalidation input', () => {
    const cart = domain('cart');
    const record = invalidate(cart, {
      input: { cartId: 'c1', quantity: 2 },
      keys: ['c1'],
    });
    const typed = record satisfies ChangeRecord<'cart', { cartId: string; quantity: number }>;
    const assertWrongDomainRejected = () => {
      // @ts-expect-error cart invalidation records cannot satisfy the product domain.
      const wrongDomain: ChangeRecord<'product', { cartId: string; quantity: number }> = record;
      return wrongDomain;
    };
    const assertWrongInputRejected = () => {
      // @ts-expect-error sku is not part of the invalidation input payload.
      const wrongInput: ChangeRecord<'cart', { sku: string }> = record;
      return wrongInput;
    };

    expect(typed).toEqual({
      domain: 'cart',
      input: { cartId: 'c1', quantity: 2 },
      keys: ['c1'],
      manual: true,
    });
    expect(assertWrongDomainRejected).toBeTypeOf('function');
    expect(assertWrongInputRejected).toBeTypeOf('function');
  });

  it('renders enhanced mutation responses as query and fragment chunks', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      instanceKey: (input) => `cart:${(input as { cartId?: string }).cartId ?? 'c1'}`,
      load: () => ({ count: 1, items: [{ productId: 'p1', qty: 1, unitPrice: 1499 }] }),
      reads: [cart],
      version: 7,
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          {
            render: () =>
              '<cart-badge fw-deps="cart"><button commandfor="cart-drawer" command="show-modal"><span data-bind="cart.count">1</span></button></cart-badge>',
            target: 'cart-badge',
          },
          {
            render: () => '<section fw-c="recommendations" fw-deps="product:p1"></section>',
            target: 'recommendations',
          },
        ],
        rawInput: { cartId: 'c1', productId: 'p1' },
        request: {},
        targets: ['cart-badge', 'recommendations'],
      }),
    ).resolves.toEqual({
      body: [
        '<fw-query name="cart" key="cart:c1" version="7">{"count":1,"items":[{"productId":"p1","qty":1,"unitPrice":1499}]}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge fw-deps="cart"><button commandfor="cart-drawer" command="show-modal"><span data-bind="cart.count">1</span></button></cart-badge></fw-fragment>',
        '<fw-fragment target="recommendations"><section fw-c="recommendations" fw-deps="product:p1"></section></fw-fragment>',
      ].join('\n'),
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"cart"}]',
      },
      status: 200,
    });
  });

  it('renders a defined error when a post-commit rerun query fails', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      guard: () => false,
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        rawInput: { productId: 'p1' },
        request: {},
        targets: ['cart-badge'],
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="cart-badge"><output role="alert" data-error-code="RENDER_ERROR">Rerun query failed: cart</output></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"cart"}]',
      },
      status: 500,
    });
  });

  it('omits mutation input and manual reasons from FW-Changes headers', async () => {
    const cart = domain('cart');
    const addToCart = mutation('cart/add', {
      input: s.object({ cartId: s.string(), note: s.string(), productId: s.string() }),
      handler(input, _request, context) {
        context.invalidate(cart, {
          input,
          keys: [input.cartId],
          reason: 'manual refresh includes private note',
        });
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        rawInput: { cartId: 'c1', note: 'secret café token', productId: 'p1' },
        request: {},
      }),
    ).resolves.toMatchObject({
      headers: {
        'FW-Changes': '[{"domain":"cart","keys":["c1"]}]',
      },
      status: 200,
    });
  });

  it('keeps FW-Changes headers ASCII-safe when input and keys contain Unicode', async () => {
    const cart = domain('cart');
    const addToCart = mutation('cart/add', {
      input: s.object({ cartId: s.string(), note: s.string(), productId: s.string() }),
      handler(input, _request, context) {
        context.invalidate(cart, {
          input,
          keys: [input.cartId],
          reason: 'private reason',
        });
        return input;
      },
    });

    const response = await renderMutationResponse(addToCart, {
      rawInput: { cartId: '東京-🔐', note: 'secret café token'.repeat(256), productId: 'p1' },
      request: {},
    });
    const header = response.headers['FW-Changes'];

    expect(header).toBe('[{"domain":"cart","keys":["\\u6771\\u4eac-\\ud83d\\udd10"]}]');
    expect(header).toBeDefined();
    if (header === undefined) throw new Error('expected FW-Changes header');
    expect(header).not.toContain('secret');
    expect(header).not.toContain('café');
    expect(() => validateHeaderValue('FW-Changes', header)).not.toThrow();
    expect(JSON.parse(header)).toEqual([{ domain: 'cart', keys: ['東京-🔐'] }]);
  });

  it('renders append fragment mode for pagination fragments', async () => {
    const product = domain('product');
    const productQuery = query('productGrid', {
      load: () => ({ items: [{ id: 'p3' }], nextCursor: null }),
      reads: [product],
    });
    const loadMore = mutation('product/loadMore', {
      input: s.object({ after: s.string() }),
      registry: {
        queries: [productQuery],
        touches: [product],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(loadMore, {
        fragmentRenderers: [
          {
            mode: 'append',
            render: () => '<article fw-key="p3"></article>',
            target: 'product-grid',
          },
        ],
        rawInput: { after: 'p2' },
        request: {},
        targets: ['product-grid'],
      }),
    ).resolves.toMatchObject({
      body: expect.stringContaining(
        '<fw-fragment target="product-grid" mode="append"><article fw-key="p3"></article></fw-fragment>',
      ),
      status: 200,
    });
  });

  it('renders enhanced mutation responses from schema-coerced mutation input', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: (input) => ({ count: (input as { quantity: number }).quantity }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input.quantity;
      },
    });
    const form = new FormData();
    form.set('productId', 'p1');
    form.set('quantity', '2');

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          {
            render: (input) =>
              `<cart-badge>${typeof (input as { quantity: unknown }).quantity}:${(input as { quantity: number }).quantity}</cart-badge>`,
            target: 'cart-badge',
          },
        ],
        rawInput: form,
        request: {},
        targets: ['cart-badge'],
      }),
    ).resolves.toMatchObject({
      body: [
        '<fw-query name="cart">{"count":2}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>number:2</cart-badge></fw-fragment>',
      ].join('\n'),
      headers: {
        'FW-Changes': '[{"domain":"cart"}]',
      },
      status: 200,
    });
  });

  it('matches the enhanced mutation wire fixture response byte-for-byte', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      instanceKey: 'cart:c1',
      load: () => ({ count: 1, items: [{ productId: 'p1', qty: 1, unitPrice: 1499 }] }),
      reads: [cart],
      version: 7,
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });

    const response = await renderMutationResponse(addToCart, {
      fragmentRenderers: [
        {
          render: () =>
            '<cart-badge fw-deps="cart"><button commandfor="cart-drawer" command="show-modal"><span data-bind="cart.count">1</span></button></cart-badge>',
          target: 'cart-badge',
        },
        {
          render: () => '<section fw-c="recommendations" fw-deps="product:p1"></section>',
          target: 'recommendations',
        },
      ],
      idem: 'idem_01HX',
      rawInput: { productId: 'p1', quantity: 1 },
      request: {},
      targets: ['cart-badge', 'recommendations'],
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/enhanced-mutation.http', import.meta.url),
      'utf8',
    );

    expect(normalizeWireResponse(response, 'OK')).toEqual(readFixtureResponses(fixture).at(-1));
  });

  it('matches the P0 wire fixtures through a live HTTP server byte-for-byte', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      instanceKey: 'cart:c1',
      load: () => ({ count: 1, items: [{ productId: 'p1', qty: 1, unitPrice: 1499 }] }),
      reads: [cart],
      version: 7,
    });
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input, _request, context) {
        if (input.quantity > 5) return context.fail('OUT_OF_STOCK', { availableQuantity: 5 });
        return input;
      },
    });
    const productQuery = query('product', {
      args: s.object({ id: s.string() }),
      instanceKey: (input) => `product:${(input as { id: string }).id}`,
      load: () => ({ name: 'Mug', stock: 4 }),
      reads: [domain('product')],
    });
    const server = createServer(async (request, response) => {
      try {
        await routeWireFixtureRequest(request, response, {
          enhancedAddToCart: async (headers, rawInput) =>
            renderMutationEndpointResponse(addToCart, {
              failureTarget: 'product-form:p1',
              fragmentRenderers: [
                {
                  render: () =>
                    '<cart-badge fw-deps="cart"><button commandfor="cart-drawer" command="show-modal"><span data-bind="cart.count">1</span></button></cart-badge>',
                  target: 'cart-badge',
                },
                {
                  render: () => '<section fw-c="recommendations" fw-deps="product:p1"></section>',
                  target: 'recommendations',
                },
              ],
              headers,
              rawInput,
              renderFailureFragment: (failure, failedRawInput) => {
                const input = Object.fromEntries((failedRawInput as FormData).entries()) as Record<
                  string,
                  string
                >;
                const data = failure.error.payload as { availableQuantity: number };

                return [
                  '<form fw-c="product-form" aria-invalid="true">',
                  `<output role="alert" data-error-code="${failure.error.code}">Only ${data.availableQuantity} left.</output>`,
                  `<input name="productId" value="${input.productId}">`,
                  `<input name="quantity" value="${input.quantity}">`,
                  '</form>',
                ].join('');
              },
              request: {},
              redirectTo: '/cart',
            }),
          noJsAddToCart: async (headers, rawInput) =>
            renderMutationEndpointResponse(addToCart, {
              headers,
              rawInput,
              redirectTo: '/cart',
              request: {},
            }),
          product: async (search) =>
            renderQueryEndpointResponse(productQuery, {
              request: {},
              search,
            }),
        });
      } catch {
        response
          .writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end('Internal Server Error');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('expected TCP server');
      const origin = `http://127.0.0.1:${address.port}`;

      await expect(fetchWireFixture(origin, 'typed-read.http')).resolves.toEqual(
        readFixtureResponses(
          await readFile(
            new URL('../../../fixtures/wire/typed-read.http', import.meta.url),
            'utf8',
          ),
        ),
      );
      await expect(fetchWireFixture(origin, 'enhanced-mutation.http')).resolves.toEqual(
        readFixtureResponses(
          await readFile(
            new URL('../../../fixtures/wire/enhanced-mutation.http', import.meta.url),
            'utf8',
          ),
        ),
      );
      await expect(fetchWireFixture(origin, 'validation-422-fragment.http')).resolves.toEqual(
        readFixtureResponses(
          await readFile(
            new URL('../../../fixtures/wire/validation-422-fragment.http', import.meta.url),
            'utf8',
          ),
        ),
      );
      await expect(fetchWireFixture(origin, 'defer-stream.http')).resolves.toEqual(
        readFixtureResponses(
          await readFile(
            new URL('../../../fixtures/wire/defer-stream.http', import.meta.url),
            'utf8',
          ),
        ),
      );
      await expect(fetchWireFixture(origin, 'no-js-post-redirect-get.http')).resolves.toEqual(
        readFixtureResponses(
          await readFile(
            new URL('../../../fixtures/wire/no-js-post-redirect-get.http', import.meta.url),
            'utf8',
          ),
        ),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('replays enhanced mutation responses by FW-Idem without re-running the handler', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const cartQuery = query('cart', {
      load: () => ({ count: writes }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const request = {
      idem: 'idem_01',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['cart-badge'],
    };

    const first = await renderMutationResponse(addToCart, request);
    first.headers['X-Mutated-By-Test'] = 'yes';
    const second = await renderMutationResponse(addToCart, request);

    expect(writes).toBe(1);
    expect(second).toEqual({
      body: '<fw-query name="cart">{"count":1}</fw-query>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"cart"}]',
        'FW-Idem': 'idem_01',
      },
      status: 200,
    });
  });

  it('replays duplicate requests while post-commit query rendering is pending', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    const queryStarted = deferred();
    const queryRelease = deferred();
    let writes = 0;
    let loads = 0;
    const cartQuery = query('cart', {
      async load() {
        loads += 1;
        queryStarted.resolve();
        await queryRelease.promise;
        return { count: writes };
      },
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const request = {
      idem: 'idem_pending_query',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['cart-badge'],
    };

    const first = renderMutationResponse(addToCart, request);
    await queryStarted.promise;
    const second = renderMutationResponse(addToCart, request);
    await Promise.resolve();

    expect(writes).toBe(1);
    expect(loads).toBe(1);

    queryRelease.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        body: '<fw-query name="cart">{"count":1}</fw-query>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Changes': '[{"domain":"cart"}]',
          'FW-Idem': 'idem_pending_query',
        },
        status: 200,
      },
      {
        body: '<fw-query name="cart">{"count":1}</fw-query>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Changes': '[{"domain":"cart"}]',
          'FW-Idem': 'idem_pending_query',
        },
        status: 200,
      },
    ]);
    expect(writes).toBe(1);
    expect(loads).toBe(1);
  });

  it('replays duplicate requests while post-commit fragment rendering is pending', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    const fragmentStarted = deferred();
    const fragmentRelease = deferred();
    let writes = 0;
    let renders = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const request = {
      fragmentRenderers: [
        {
          async render() {
            renders += 1;
            fragmentStarted.resolve();
            await fragmentRelease.promise;
            return '<cart-badge>1</cart-badge>';
          },
          target: 'cart-badge',
        },
      ],
      idem: 'idem_pending_fragment',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['cart-badge'],
    };

    const first = renderMutationResponse(addToCart, request);
    await fragmentStarted.promise;
    const second = renderMutationResponse(addToCart, request);
    await Promise.resolve();

    expect(writes).toBe(1);
    expect(renders).toBe(1);

    fragmentRelease.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        body: '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Changes': '[{"domain":"cart"}]',
          'FW-Idem': 'idem_pending_fragment',
        },
        status: 200,
      },
      {
        body: '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Changes': '[{"domain":"cart"}]',
          'FW-Idem': 'idem_pending_fragment',
        },
        status: 200,
      },
    ]);
    expect(writes).toBe(1);
    expect(renders).toBe(1);
  });

  it('replays enhanced mutation validation failures by FW-Idem', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let attempts = 0;
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        attempts += 1;
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });
    const request = {
      idem: 'idem_422',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
    };

    await expect(renderMutationResponse(addToCart, request)).resolves.toMatchObject({
      status: 422,
    });
    await expect(renderMutationResponse(addToCart, request)).resolves.toEqual({
      body: '<fw-fragment target="error"><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Idem': 'idem_422',
      },
      status: 422,
    });
    expect(attempts).toBe(1);
  });

  it('does not replay pure schema validation failures by FW-Idem', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const baseRequest = {
      idem: 'idem_validation',
      replayStore,
      request: { sessionId: 's1' },
    };

    await expect(
      renderMutationResponse(addToCart, {
        ...baseRequest,
        rawInput: { quantity: 1 },
      }),
    ).resolves.toMatchObject({ status: 422 });
    await expect(
      renderMutationResponse(addToCart, {
        ...baseRequest,
        rawInput: { productId: 'p1' },
      }),
    ).resolves.toMatchObject({ status: 200 });

    expect(writes).toBe(1);
  });

  it('does not replay enhanced mutation responses before validating CSRF', async () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId(candidate: typeof request) {
        return candidate.session.id;
      },
    };
    let getCalls = 0;
    let writes = 0;
    const replayStore: MutationReplayStore = {
      get() {
        getCalls += 1;
        return {
          body: '<fw-query name="cart">{"count":999}</fw-query>',
          headers: {},
          status: 200,
        };
      },
      reserve() {
        throw new Error('replay reserve should not run before CSRF validation');
      },
      set() {},
    };
    const addToCart = mutation('cart/add', {
      csrf,
      input: s.object({ productId: s.string() }),
      handler(input) {
        writes += 1;
        return input;
      },
    });

    const response = await renderMutationResponse(addToCart, {
      idem: 'idem_01',
      rawInput: { productId: 'p1' },
      replayStore,
      request,
    });

    expect(getCalls).toBe(0);
    expect(writes).toBe(0);
    expect(response).toMatchObject({ status: 422 });
    expect(response.body).toContain('data-error-code="CSRF"');
  });

  it('scopes enhanced mutation replay records by CSRF session id', async () => {
    const replayStore = createMemoryMutationReplayStore();
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId(candidate: { session: { id: string } }) {
        return candidate.session.id;
      },
    };
    let writes = 0;
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: (_input, context: { request: { session: { id: string } } }) => ({
        count: writes,
        session: context.request.session.id,
      }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf,
      input: s.object({ csrf: s.string(), productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const requestA = { session: { id: 's1' } };
    const requestB = { session: { id: 's2' } };

    const first = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { csrf: csrfToken(requestA, csrf), productId: 'p1' },
      replayStore,
      request: requestA,
    });
    const second = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { csrf: csrfToken(requestB, csrf), productId: 'p1' },
      replayStore,
      request: requestB,
    });
    const replayedFirst = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { csrf: csrfToken(requestA, csrf), productId: 'p1' },
      replayStore,
      request: requestA,
    });

    expect(writes).toBe(2);
    expect(first.body).toContain('"session":"s1"');
    expect(second.body).toContain('"session":"s2"');
    expect(replayedFirst.body).toBe(first.body);
  });

  it('scopes enhanced mutation replay records by request session id', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: (_input, context: { request: { session: { id: string } } }) => ({
        count: writes,
        session: context.request.session.id,
      }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const requestA = { session: { id: 's1' } };
    const requestB = { session: { id: 's2' } };

    const first = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { productId: 'p1' },
      replayStore,
      request: requestA,
    });
    const second = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { productId: 'p1' },
      replayStore,
      request: requestB,
    });
    const replayedFirst = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { productId: 'p1' },
      replayStore,
      request: requestA,
    });

    expect(writes).toBe(2);
    expect(first.body).toContain('"session":"s1"');
    expect(second.body).toContain('"session":"s2"');
    expect(replayedFirst.body).toBe(first.body);
  });

  it('delivers late stylesheets with enhanced mutation fragments', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          {
            render: () => '<cart-drawer class="drawer-open">Added</cart-drawer>',
            stylesheets: [
              '/assets/cart-drawer.css',
              '/assets/cart-drawer.css',
              { href: '/assets/theme.css', preload: false },
            ],
            target: 'cart-drawer',
          },
        ],
        rawInput: { productId: 'p1' },
        request: {},
        targets: ['cart-drawer'],
      }),
    ).resolves.toMatchObject({
      body: '<fw-fragment target="cart-drawer"><link rel="stylesheet" href="/assets/cart-drawer.css"><link rel="stylesheet" href="/assets/theme.css"><cart-drawer class="drawer-open">Added</cart-drawer></fw-fragment>',
      status: 200,
    });
  });

  it('renders per-island error boundary fragments when a fragment renderer fails', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          errorBoundary(
            {
              render() {
                throw new Error('recommendations failed');
              },
              stylesheets: ['/assets/recommendations.css'],
              target: 'recommendations',
            },
            {
              render(error) {
                return `<section role="alert">${(error as Error).message}</section>`;
              },
            },
          ),
        ],
        rawInput: { productId: 'p1' },
        request: {},
        targets: ['recommendations'],
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="recommendations" error-boundary="recommendations"><link rel="stylesheet" href="/assets/recommendations.css"><section role="alert">recommendations failed</section></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[]',
      },
      status: 200,
    });
  });

  it('renders a defined error fragment when an island errors without a boundary', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          {
            render() {
              throw new Error('unhandled island error');
            },
            target: 'recommendations',
          },
        ],
        rawInput: { productId: 'p1' },
        request: {},
        targets: ['recommendations'],
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="recommendations"><output role="alert" data-error-code="RENDER_ERROR">unhandled island error</output></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[]',
      },
      status: 500,
    });
  });

  it('replays post-commit render failures without re-running the handler', async () => {
    const replayStore = createMemoryMutationReplayStore();
    const cart = domain('cart');
    let writes = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const request = {
      fragmentRenderers: [
        {
          render() {
            throw new Error('post-commit render failed');
          },
          target: 'cart-badge',
        },
      ],
      idem: 'idem_render_failure',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['cart-badge'],
    };

    const first = await renderMutationResponse(addToCart, request);
    const second = await renderMutationResponse(addToCart, request);

    expect(writes).toBe(1);
    expect(first).toEqual({
      body: '<fw-fragment target="cart-badge"><output role="alert" data-error-code="RENDER_ERROR">post-commit render failed</output></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"cart"}]',
        'FW-Idem': 'idem_render_failure',
      },
      status: 500,
    });
    expect(second).toEqual(first);
  });

  it('renders enhanced mutation handler exceptions as 500 fragments', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler() {
        throw new Error('handler unavailable');
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        rawInput: { productId: 'p1' },
        request: {},
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="error"><output role="alert" data-error-code="SERVER_ERROR">Internal Server Error</output></fw-fragment>',
      headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
      status: 500,
    });
  });

  it('renders typed failures as 422 validation fragments', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        rawInput: { productId: 'p1' },
        request: {},
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="error"><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></fw-fragment>',
      headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('renders schema validation failures into the submitted form target', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        failureTarget: 'product-form:p1',
        rawInput: { productId: 'p1', quantity: 0 },
        request: {},
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="product-form:p1"><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></fw-fragment>',
      headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('delivers late stylesheets with enhanced mutation failure fragments', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        failureStylesheets: [
          '/assets/product-form.css',
          '/assets/product-form.css',
          { href: '/assets/theme.css', preload: false },
        ],
        failureTarget: 'product-form:p1',
        rawInput: { productId: 'p1' },
        renderFailureFragment: () => '<form>Out of stock</form>',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="product-form:p1"><link rel="stylesheet" href="/assets/product-form.css"><link rel="stylesheet" href="/assets/theme.css"><form>Out of stock</form></fw-fragment>',
      headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('lets enhanced forms override validation failure fragments', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        failureTarget: 'product-form:p1',
        rawInput: { productId: 'p1', quantity: 0 },
        renderFailureFragment: (failure, rawInput) =>
          `<form fw-c="product-form" aria-invalid="true"><output role="alert" data-error-code="${failure.error.code}">${(rawInput as { quantity: number }).quantity}</output></form>`,
        request: {},
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="product-form:p1"><form fw-c="product-form" aria-invalid="true"><output role="alert" data-error-code="VALIDATION">0</output></form></fw-fragment>',
      headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('matches the validation failure wire fixture response byte-for-byte', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 5 });
      },
    });

    const response = await renderMutationResponse(addToCart, {
      failureTarget: 'product-form:p1',
      idem: 'idem_01HY',
      rawInput: { productId: 'p1', quantity: 99 },
      renderFailureFragment: (failure, rawInput) => {
        const input = rawInput as { productId: string; quantity: number };
        const data = failure.error.payload as { availableQuantity: number };

        return [
          '<form fw-c="product-form" aria-invalid="true">',
          `<output role="alert" data-error-code="${failure.error.code}">Only ${data.availableQuantity} left.</output>`,
          `<input name="productId" value="${input.productId}">`,
          `<input name="quantity" value="${input.quantity}">`,
          '</form>',
        ].join('');
      },
      request: {},
      targets: ['product-form:p1'],
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/validation-422-fragment.http', import.meta.url),
      'utf8',
    );

    expect(normalizeWireResponse(response, 'Unprocessable Content')).toEqual(
      readFixtureResponses(fixture).at(-1),
    );
  });

  it('renders no-JS mutation success as POST-redirect-GET', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1', quantity: 1 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/cart',
      },
      status: 303,
    });
  });

  it('matches the no-JS POST redirect wire fixture response byte-for-byte', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(input) {
        return input;
      },
    });

    const response = await renderNoJsMutationResponse(addToCart, {
      rawInput: { productId: 'p1', quantity: 1 },
      redirectTo: '/cart',
      request: {},
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/no-js-post-redirect-get.http', import.meta.url),
      'utf8',
    );
    const [postResponse] = readFixtureResponses(fixture);

    expect(postResponse).toEqual({
      body: `${response.body}`,
      headers: {
        'cache-control': response.headers['Cache-Control'],
        location: response.headers.Location,
      },
      statusLine: 'HTTP/1.1 303 See Other',
    });
  });

  it('renders no-JS mutation failures as a full HTML 422 page', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });

  it('renders no-JS mutation handler exceptions as an HTML 500 response', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler() {
        throw new Error('handler unavailable');
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: 'Internal Server Error',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 500,
    });
  });

  it('renders no-JS schema validation failures with field paths by default', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1', quantity: 0 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });
});

function formDataFile(bits: string[], name: string, type: string): Blob {
  return new File(bits, name, { type }) as unknown as Blob;
}

type WireFixtureHandlers = {
  enhancedAddToCart(
    headers: Record<string, string>,
    rawInput: FormData,
  ): Promise<{ body: string; headers: Record<string, string>; status: number }>;
  noJsAddToCart(
    headers: Record<string, string>,
    rawInput: FormData,
  ): Promise<{ body: string; headers: Record<string, string>; status: number }>;
  product(
    search: URLSearchParams,
  ): Promise<{ body: string; headers: Record<string, string>; status: number }>;
};

async function routeWireFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handlers: WireFixtureHandlers,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://fixture.test');

  if (request.method === 'GET' && url.pathname === '/_q/product') {
    return writeLiveFixtureResponse(response, await handlers.product(url.searchParams), 'OK');
  }

  if (request.method === 'GET' && url.pathname === '/products/p1') {
    return writeLiveFixtureResponse(
      response,
      renderDeferredStream({
        closeHtml: '</body></html>',
        chunks: [
          {
            fragments: [
              {
                html: '<section fw-c="reviews" fw-deps="product:p1"><article fw-key="r1">5</article></section>',
                priority: 5,
                stylesheets: ['/assets/reviews.css'],
                target: 'reviews:p1',
              },
              {
                html: '<section fw-c="recommendations" fw-deps="product:p1"><article fw-key="rec-1">Beans</article></section>',
                target: 'recommendations:p1',
              },
            ],
            queries: [
              { key: 'product:p1', name: 'reviews', value: { items: [{ id: 'r1', rating: 5 }] } },
              {
                key: 'product:p1',
                name: 'recommendations',
                value: { items: [{ id: 'rec-1' }] },
              },
            ],
          },
        ],
        shell:
          '<!doctype html>\n<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer><fw-defer target="recommendations:p1" state="pending"></fw-defer></product-page></main>\n',
      }),
      'OK',
    );
  }

  if (request.method === 'POST' && url.pathname === '/_m/cart/add') {
    const wireResponse = await handlers.enhancedAddToCart(
      liveFixtureHeaders(request),
      await readUrlEncodedForm(request),
    );

    return writeLiveFixtureResponse(
      response,
      wireResponse,
      wireResponse.status === 422 ? 'Unprocessable Content' : 'OK',
    );
  }

  if (request.method === 'POST' && url.pathname === '/cart/add') {
    return writeLiveFixtureResponse(
      response,
      await handlers.noJsAddToCart(liveFixtureHeaders(request), await readUrlEncodedForm(request)),
      'See Other',
    );
  }

  if (request.method === 'GET' && url.pathname === '/cart') {
    return writeLiveFixtureResponse(
      response,
      {
        body: '<!doctype html>\n<html><body><script type="application/json" fw-query="cart">{"count":1,"items":[{"productId":"p1","qty":1,"unitPrice":1499}]}</script><cart-badge fw-deps="cart"><span data-bind="cart.count">1</span></cart-badge></body></html>',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      },
      'OK',
    );
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
}

function liveFixtureHeaders(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, value]) => [name, value]),
  );
}

function writeLiveFixtureResponse(
  response: ServerResponse,
  wireResponse: { body: string; headers: Record<string, string>; status: number },
  reason: string,
): void {
  response.statusCode = wireResponse.status;
  response.statusMessage = reason;

  for (const [name, value] of Object.entries(wireResponse.headers)) {
    response.setHeader(name, value);
  }

  response.end(wireResponse.body);
}

async function readUrlEncodedForm(request: IncomingMessage): Promise<FormData> {
  const form = new FormData();
  const body = await readRequestBody(request);

  for (const [name, value] of new URLSearchParams(body)) {
    form.append(name, value);
  }

  return form;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function fetchWireFixture(
  origin: string,
  fixtureName: string,
): Promise<{ body: string; headers: Record<string, string>; statusLine: string }[]> {
  const fixture = await readFile(
    new URL(`../../../fixtures/wire/${fixtureName}`, import.meta.url),
    'utf8',
  );
  const expectedResponses = readFixtureResponses(fixture);
  const responses = [];

  for (const [index, request] of readFixtureRequests(fixture).entries()) {
    const init: RequestInit = {
      headers: request.headers,
      method: request.method,
      redirect: 'manual',
    };
    if (request.body !== '') init.body = request.body;

    const response = await fetch(`${origin}${request.path}`, init);
    const expected = expectedResponses[index];
    if (expected === undefined) throw new Error(`missing fixture response ${index + 1}`);

    const body = await response.text();

    responses.push({
      body: body.endsWith('\n') || !expected.body.endsWith('\n') ? body : `${body}\n`,
      headers: Object.fromEntries(
        Object.keys(expected.headers).map((name) => [name, response.headers.get(name) ?? '']),
      ),
      statusLine: `HTTP/1.1 ${response.status} ${response.statusText}`,
    });
  }

  return responses;
}

function readFixtureRequests(
  fixture: string,
): { body: string; headers: Record<string, string>; method: string; path: string }[] {
  const requests = [];
  let cursor = 0;

  while (true) {
    const requestStart = fixture.indexOf('>>> REQUEST', cursor);
    if (requestStart === -1) return requests;

    const lineStart = fixture.indexOf('\n', requestStart);
    expect(lineStart).toBeGreaterThanOrEqual(0);

    const responseStart = fixture.indexOf('\n<<< RESPONSE', lineStart + 1);
    expect(responseStart).toBeGreaterThanOrEqual(0);

    const requestBlock = fixture.slice(lineStart + 1, responseStart);
    const headerEnd = requestBlock.indexOf('\n\n');
    const headerText = headerEnd === -1 ? requestBlock.trimEnd() : requestBlock.slice(0, headerEnd);
    const body = headerEnd === -1 ? '' : requestBlock.slice(headerEnd + 2).trimEnd();
    const [requestLine = '', ...headerLines] = headerText.split('\n');
    const [method = '', path = ''] = requestLine.split(' ');
    const headers = Object.fromEntries(
      headerLines.map((line) => {
        const separator = line.indexOf(':');
        expect(separator).toBeGreaterThan(0);
        return [line.slice(0, separator), line.slice(separator + 1).trim()];
      }),
    );

    requests.push({ body, headers, method, path });
    cursor = responseStart + 1;
  }
}

function normalizeWireResponse(
  response: { body: string; headers: Record<string, string>; status: number },
  reason: string,
): { body: string; headers: Record<string, string>; statusLine: string } {
  return {
    body: `${response.body}\n`,
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]),
    ),
    statusLine: `HTTP/1.1 ${response.status} ${reason}`,
  };
}

function readFixtureResponses(
  fixture: string,
): { body: string; headers: Record<string, string>; statusLine: string }[] {
  const responses: { body: string; headers: Record<string, string>; statusLine: string }[] = [];
  let cursor = 0;

  while (true) {
    const responseStart = fixture.indexOf('<<< RESPONSE', cursor);
    if (responseStart === -1) return responses;

    const statusStart = fixture.indexOf('\n', responseStart);
    expect(statusStart).toBeGreaterThanOrEqual(0);

    const nextRequestStart = fixture.indexOf('\n>>> REQUEST', statusStart + 1);
    const responseBlock =
      nextRequestStart === -1
        ? fixture.slice(statusStart + 1)
        : fixture.slice(statusStart + 1, nextRequestStart);
    const headerEnd = responseBlock.indexOf('\n\n');
    const headerText =
      headerEnd === -1 ? responseBlock.trimEnd() : responseBlock.slice(0, headerEnd);
    const [statusLine = '', ...headerLines] = headerText.split('\n');
    const body = headerEnd === -1 ? '' : responseBlock.slice(headerEnd + 2);
    const headers = Object.fromEntries(
      headerLines.map((line) => {
        const separator = line.indexOf(':');
        expect(separator).toBeGreaterThan(0);
        return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
      }),
    );

    responses.push({ body, headers, statusLine });
    cursor = nextRequestStart === -1 ? fixture.length : nextRequestStart + 1;
  }
}
