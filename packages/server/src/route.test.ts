import { describe, expect, it, vi } from 'vitest';
import { redirect } from '@kovojs/core';

import { renderedHtml, renderHtmlValue, type RenderedHtml } from './html.js';
import { mintCsrfToken } from './csrf.js';
import { accessDecisionFor, publicAccess } from './access.js';
import { renderPageHints } from './hints.js';
import { guards } from './guards.js';
import { meta } from './meta.js';
import {
  layout,
  notFound,
  parseRouteRequest,
  renderRoutePageResponse,
  route,
  runRoutePage,
  type RoutePageResult,
} from './route.js';
import { s } from './schema.js';

describe('route primitives', () => {
  const directRouteCsrf = {
    secret: 'direct-route-lifecycle-secret-0123456789abcdef',
    sessionId: () => undefined,
  };

  it('does not leave a cookie-delivery receipt after direct runRoutePage execution', async () => {
    let retainedRequest: Request | undefined;
    const direct = route('/direct-retained-route', {
      page(_context, request: Request) {
        retainedRequest = request;
        return renderedHtml('<main>direct</main>');
      },
    });

    await expect(
      runRoutePage(
        direct,
        { params: {} },
        new Request('https://example.test/direct-retained-route'),
      ),
    ).resolves.toBeDefined();
    expect(retainedRequest).toBeDefined();
    expect(() =>
      mintCsrfToken(retainedRequest!, directRouteCsrf, { audience: 'direct-retained-route' }),
    ).toThrow(/without a framework response lifecycle/u);
  });

  it('rejects a first-anonymous mint during direct runRoutePage execution', async () => {
    const direct = route('/direct-eager-route', {
      page(_context, request: Request) {
        return mintCsrfToken(request, directRouteCsrf, { audience: 'direct-eager-route' }).token;
      },
    });

    await expect(
      runRoutePage(direct, { params: {} }, new Request('https://example.test/direct-eager-route')),
    ).rejects.toThrow(/without a framework response lifecycle/u);
  });

  it('seals the retained request returned by direct renderRoutePageResponse execution', async () => {
    let retainedRequest: Request | undefined;
    const direct = route('/direct-render-retained-route', {
      page(_context, request: Request) {
        retainedRequest = request;
        return renderedHtml('<main>direct render</main>');
      },
    });

    await expect(
      renderRoutePageResponse(
        direct,
        { params: {} },
        new Request('https://example.test/direct-render-retained-route'),
      ),
    ).resolves.toMatchObject({ status: 200 });
    expect(retainedRequest).toBeDefined();
    expect(() =>
      mintCsrfToken(retainedRequest!, directRouteCsrf, {
        audience: 'direct-render-retained-route',
      }),
    ).toThrow(/after response headers were committed/u);
  });

  it('rejects pending first-anonymous authority from direct renderRoutePageResponse', async () => {
    const direct = route('/direct-render-eager-route', {
      page(_context, request: Request) {
        const token = mintCsrfToken(request, directRouteCsrf, {
          audience: 'direct-render-eager-route',
        }).token;
        return renderedHtml(`<main>${token}</main>`);
      },
    });

    await expect(
      renderRoutePageResponse(
        direct,
        { params: {} },
        new Request('https://example.test/direct-render-eager-route'),
      ),
    ).rejects.toThrow(/cannot deliver a first-anonymous CSRF binding cookie/u);
  });

  it('ignores inherited route/layout access and refuses accessors without invoking them', () => {
    const inheritedRoute = Object.create({
      access: publicAccess('prototype-provided public route'),
      page: () => renderedHtml('attacker'),
    });
    const routeDeclaration = route('/exact-route', inheritedRoute);
    expect(accessDecisionFor(routeDeclaration)).toBeUndefined();
    expect(routeDeclaration.page).toBeUndefined();

    const inheritedLayout = Object.create({
      access: publicAccess('prototype-provided public layout'),
      render: () => renderedHtml('attacker'),
    });
    const layoutDeclaration = layout(inheritedLayout);
    expect(accessDecisionFor(layoutDeclaration)).toBeUndefined();
    expect(layoutDeclaration.render).toBeUndefined();

    let getterCalls = 0;
    const accessor = {} as Parameters<typeof route>[1];
    Object.defineProperty(accessor, 'page', {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return () => renderedHtml('attacker');
      },
    });
    expect(() => route('/accessor-route', accessor)).toThrow('own data');
    expect(getterCalls).toBe(0);
  });

  it('rejects raw string route pages and layout renders', () => {
    const assertRawStringPageRejected = () => {
      route('/raw-page', {
        // @ts-expect-error SPEC §4.1/§9.1: route page markup must be TSX/JSX or an explicit trust boundary.
        page: () => '<main>Raw</main>',
      });
    };
    const assertRawStringLayoutRejected = () => {
      layout({
        // @ts-expect-error SPEC §4.1/§9.5: layout chrome markup must be TSX/JSX or an explicit trust boundary.
        render: () => '<main>Raw</main>',
      });
    };

    expect(assertRawStringPageRejected).toBeTypeOf('function');
    expect(assertRawStringLayoutRejected).toBeTypeOf('function');
  });

  it('declares route schemas, route-owned hints, and typed PRG redirects', async () => {
    const productRoute = route('/products/:id', {
      meta: meta({ title: 'Product detail' }),
      page(context) {
        const id: string = context.params.id;
        const max: number = context.search.max;
        return renderedHtml(`${id}:${max}`);
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
    expect(renderHtmlValue(await productRoute.page?.(request, {}))).toBe('p1:25');
    expect(renderPageHints(productRoute)).toEqual({
      csp: {
        scripts: ['sha256-fKxQlvzc78mE71qhW0Eccfc4+tOL6x+GN3K5zPR3noE='],
        styles: [],
      },
      earlyHints: {},
      html: [
        '<title>Product detail</title>',
        '<script type="speculationrules" data-kovo-csp-hash="sha256-fKxQlvzc78mE71qhW0Eccfc4+tOL6x+GN3K5zPR3noE=">{"prerender":[{"eagerness":"conservative","urls":["/products/p1"]}]}</script>',
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

  it('derives route currentUrl from the shared route pattern contract for auth redirects', async () => {
    const nextValues: string[] = [];
    const guardedRoute = route('/users/:user-id/files/:name.json', {
      guard: guards.authed<{ session?: { user?: { id: string } } | null }>(),
      onUnauthenticated({ next }) {
        nextValues.push(next);
        return redirect('/cart', {});
      },
      page: () => renderedHtml('private'),
    });

    await expect(
      renderRoutePageResponse(
        guardedRoute,
        {
          params: { 'name.json': 'report 1', 'user-id': 'u/1' },
          search: { from: 'dashboard' },
        },
        { session: null },
      ),
    ).resolves.toMatchObject({
      headers: {
        Location: '/cart',
      },
      status: 303,
    });
    expect(nextValues).toEqual(['/users/u%2F1/files/report%201?from=dashboard']);
  });

  it('keeps parent layout guards active after late Array.unshift poisoning', async () => {
    const guardedLayout = layout({
      guard: guards.authed<{ session?: { user?: { id: string } } | null }>(),
    });
    const child = route('/layout-guard-poison', {
      layout: guardedLayout,
      page: () => renderedHtml('<main>private</main>'),
    });
    const nativeUnshift = Array.prototype.unshift;
    let result: Awaited<ReturnType<typeof renderRoutePageResponse>> | undefined;
    try {
      Array.prototype.unshift = () => 0;
      result = await renderRoutePageResponse(child, {}, { session: null });
    } finally {
      Array.prototype.unshift = nativeUnshift;
    }

    expect(result?.status).toBe(303);
    expect(result?.body).not.toContain('private');
  });

  it('does not select an unverified descendant boundary after Array.slice poisoning', async () => {
    const rootLayout = layout({});
    const guardedLayout = layout({
      guard: () => ({ kind: 'forbidden' as const }),
      parent: rootLayout,
    });
    const unverifiedDescendant = layout({
      boundaries: {
        unauthorized: () => renderedHtml('<main>unverified descendant boundary</main>'),
      },
      parent: guardedLayout,
    });
    const child = route('/layout-boundary-slice-poison', {
      layout: unverifiedDescendant,
      page: () => renderedHtml('<main>private</main>'),
    });
    const nativeSlice = Array.prototype.slice;
    let result: Awaited<ReturnType<typeof renderRoutePageResponse>> | undefined;
    try {
      Array.prototype.slice = function poisonedLayoutPrefix(start?: number, end?: number) {
        if (this.length === 3 && this[2] === unverifiedDescendant) return this;
        return Reflect.apply(nativeSlice, this, [start, end]);
      };
      result = await renderRoutePageResponse(
        child,
        {},
        new Request('https://example.test/layout-boundary-slice-poison'),
      );
    } finally {
      Array.prototype.slice = nativeSlice;
    }

    expect(result?.status).toBe(403);
    expect(result?.body).toContain('<h1>Forbidden</h1>');
    expect(result?.body).not.toContain('unverified descendant boundary');
    expect(result?.body).not.toContain('private');
  });

  it('accepts optional route search schema fields', async () => {
    const optionalSearchRoute = route('/optional-search', {
      page({ search }) {
        const next: string | undefined = search.next;
        // @ts-expect-error SPEC §6.4: optional search fields preserve their declared value type.
        const numberNext: number = search.next;
        return renderedHtml(next ?? 'none');
      },
      search: s.object({ next: s.string().optional() }),
    });

    expect(parseRouteRequest(optionalSearchRoute, { search: {} })).toEqual({
      params: {},
      path: '/optional-search',
      search: {},
    });
    expect(
      renderHtmlValue(await optionalSearchRoute.page?.(parseRouteRequest(optionalSearchRoute), {})),
    ).toBe('none');
  });

  it('keeps layout region slots closed over the declared route region contract', () => {
    const assertUnannotatedTypoRejected = () => {
      layout({
        render: (_queries, _state, { regions }) => {
          // @ts-expect-error SPEC §4.5: uncontracted layout regions have no declared keys.
          regions.sidebarTypo;
          return renderedHtml('layout');
        },
      });
    };
    expect(assertUnannotatedTypoRejected).toBeTypeOf('function');

    type DocsRegions = Readonly<{
      page: RenderedHtml;
      sidebar: number;
    }>;

    const DocsLayout = layout<unknown, {}, RoutePageResult, DocsRegions>({
      render: (_queries, _state, { regions }) => {
        const page: RenderedHtml = regions.page;
        const sidebar: number = regions.sidebar;
        const assertTypoRejected = () => {
          // @ts-expect-error SPEC §4.5: route/layout region contracts are closed to declared keys.
          regions.sidebarTypo;
        };

        expect(assertTypoRejected).toBeTypeOf('function');
        return renderedHtml(`${page.html}:${sidebar}`);
      },
    });

    const docsRoute = route('/guides/:slug', {
      layout: DocsLayout,
      regions: {
        page: ({ params }) => renderedHtml(params.slug),
        sidebar: () => 1,
      },
    });
    expect(docsRoute.regions?.sidebar).toBeTypeOf('function');

    const assertMissingRegionRejected = () => {
      route('/missing-region', {
        // @ts-expect-error SPEC §4.5: DocsLayout reads `sidebar`, so the route must declare it.
        layout: DocsLayout,
        regions: {
          page: () => renderedHtml('page'),
        },
      });
    };
    expect(assertMissingRegionRejected).toBeTypeOf('function');
  });

  it('runs route pages through guards and notFound page outcomes', async () => {
    const productRoute = route('/products/:id', {
      guard: (request: { session?: { userId?: string } | null }) =>
        request.session?.userId === 'u1',
      page(context, request: { session: { userId: string } }) {
        if (context.params.id === 'missing') return notFound();
        return renderedHtml(`${request.session.userId}:${context.params.id}:${context.search.tab}`);
      },
      params: s.object({ id: s.string() }),
      search: s.object({ tab: s.string() }),
    });

    const guardedPageResult = await runRoutePage(
      productRoute,
      { params: { id: 'p1' }, search: { tab: 'details' } },
      { session: { userId: 'u1' } },
    );
    expect(guardedPageResult.ok).toBe(true);
    expect(
      guardedPageResult.ok && 'value' in guardedPageResult
        ? renderHtmlValue(guardedPageResult.value)
        : undefined,
    ).toBe('u1:p1:details');
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
    ).resolves.toMatchObject({
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

  // I1 (ROUTING-NAV-1 / SPEC §6.4): page returning redirect() must produce 303 + Location,
  // not a 200 "[object Object]" (the pre-fix behaviour).
  it('returns 303 + Location when a route page returns redirect() (I1 ROUTING-NAV-1)', async () => {
    const homeRoute = route('/home', {
      page: () => redirect('/new-home' as never, {} as never),
    });

    await expect(renderRoutePageResponse(homeRoute, {}, {})).resolves.toEqual({
      body: '',
      headers: { Location: '/new-home' },
      status: 303,
    });
  });

  it('treats structural redirect-shaped route page objects as non-document outcomes', async () => {
    const forgedRoute = route('/forged', {
      page: () => ({ location: '/admin', status: 303 }) as any,
    });

    await expect(renderRoutePageResponse(forgedRoute, {}, {})).resolves.toEqual({
      body: '',
      headers: { Location: '/admin' },
      status: 303,
    });
  });

  it('escapes default route string returns as text', async () => {
    const unsafeStringRoute = route('/unsafe', {
      page: (() => '<img src=x onerror=alert(1)>') as any,
    });

    await expect(renderRoutePageResponse(unsafeStringRoute, {}, {})).resolves.toMatchObject({
      body: '&lt;img src=x onerror=alert(1)&gt;',
      status: 200,
    });
  });

  it('renders route page and renderer exceptions as stable 500 HTML', async () => {
    const loadError = new Error('private route load detail');
    const renderError = new Error('private render detail');
    const onError = vi.fn();
    const request = {};
    const throwingPage = route('/products/:id', {
      page() {
        throw loadError;
      },
    });
    const throwingRenderer = route('/cart', {
      page() {
        return renderedHtml('cart');
      },
    });
    // SPEC §9.2 keeps server exceptions private while preserving onError diagnostics.
    const serverErrorResponse = {
      body: 'Internal Server Error',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 500,
    };

    await expect(
      renderRoutePageResponse(throwingPage, { params: { id: 'p1' } }, request, String, {
        onError,
      }),
    ).resolves.toEqual(serverErrorResponse);
    await expect(
      renderRoutePageResponse(
        throwingRenderer,
        {},
        request,
        () => {
          throw renderError;
        },
        { onError },
      ),
    ).resolves.toEqual(serverErrorResponse);
    expect(onError).toHaveBeenCalledWith(loadError, {
      operation: 'route-page',
      request,
      routePath: '/products/:id',
    });
    expect(onError).toHaveBeenCalledWith(renderError, {
      operation: 'route-render',
      request,
      routePath: '/cart',
    });
  });

  it('D1: logs default-config route page exceptions to stderr', async () => {
    const thrown = new Error('private route load detail');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = {};
    const throwingPage = route('/products/:id', {
      page() {
        throw thrown;
      },
    });

    try {
      await expect(
        renderRoutePageResponse(throwingPage, { params: { id: 'p1' } }, request),
      ).resolves.toMatchObject({
        body: 'Internal Server Error',
        status: 500,
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[kovo] route-page failed route=/products/:id'),
        'Error: private route load detail',
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
