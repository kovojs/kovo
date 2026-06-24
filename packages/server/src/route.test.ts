import { publicAccess } from './access.js';
import { describe, expect, it, vi } from 'vitest';
import { redirect } from '@kovojs/core';

import { renderedHtml, renderHtmlValue } from './html.js';
import { renderPageHints } from './hints.js';
import { meta } from './meta.js';
import {
  layout,
  notFound,
  parseRouteRequest,
  renderRoutePageResponse,
  route,
  runRoutePage,
} from './route.js';
import { s } from './schema.js';

describe('route primitives', () => {
  it('rejects raw string route pages and layout renders', () => {
    const assertRawStringPageRejected = () => {
      route('/raw-page', {
        access: publicAccess('test fixture'),
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
      access: publicAccess('test fixture'),
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

  it('rejects prototype-pollution keys in route params before page execution', () => {
    const productRoute = route('/products/:id', {
      access: publicAccess('test fixture'),
      page(context) {
        return renderedHtml(context.params.id);
      },
      params: s.object({ id: s.string() }),
    });

    let error: unknown;
    try {
      parseRouteRequest(productRoute, {
        params: JSON.parse('{"id":"p1","prototype":"attacker"}') as unknown,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      issues: [{ message: 'Forbidden object key "prototype"', path: [] }],
    });
  });

  it('rejects route params that exceed the shared schema runtime budget before page execution', () => {
    const productRoute = route('/products/:id', {
      access: publicAccess('test fixture'),
      page(context) {
        return renderedHtml(context.params.id);
      },
      params: s.object({ id: s.string() }),
    });
    const params: Record<string, string> = { id: 'p1' };
    for (let index = 0; index <= 1_000; index += 1) {
      params[`extra-${index}`] = 'value';
    }

    let error: unknown;
    try {
      parseRouteRequest(productRoute, { params });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      issues: [{ message: 'Input exceeds maximum breadth 1000', path: [] }],
    });
  });

  it('runs route pages through guards and notFound page outcomes', async () => {
    const productRoute = route('/products/:id', {
      access: publicAccess('test fixture'),
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

  // I1 (ROUTING-NAV-1 / SPEC §6.4): page returning redirect() must produce 303 + Location,
  // not a 200 "[object Object]" (the pre-fix behaviour).
  it('returns 303 + Location when a route page returns redirect() (I1 ROUTING-NAV-1)', async () => {
    // Build the Redirect value directly (redirect() requires a registered route key,
    // so we construct the { location, status: 303 } shape to match the Redirect interface).
    const redirectValue: ReturnType<typeof redirect> = { location: '/new-home', status: 303 };
    const homeRoute = route('/home', {
      access: publicAccess('test fixture'),
      page: () => redirectValue,
    });

    await expect(renderRoutePageResponse(homeRoute, {}, {})).resolves.toEqual({
      body: '',
      headers: { Location: '/new-home' },
      status: 303,
    });
  });

  it('escapes default route string returns as text', async () => {
    const unsafeStringRoute = route('/unsafe', {
      access: publicAccess('test fixture'),
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
      access: publicAccess('test fixture'),
      page() {
        throw loadError;
      },
    });
    const throwingRenderer = route('/cart', {
      access: publicAccess('test fixture'),
      page() {
        return renderedHtml('cart');
      },
    });
    // SPEC §9.2 keeps server exceptions private while preserving onError diagnostics.
    const loadResponse = await renderRoutePageResponse(
      throwingPage,
      { params: { id: 'p1' } },
      request,
      String,
      { onError },
    );
    const renderResponse = await renderRoutePageResponse(
      throwingRenderer,
      {},
      request,
      () => {
        throw renderError;
      },
      { onError },
    );

    for (const response of [loadResponse, renderResponse]) {
      expect(response.status).toBe(500);
      expect(response.body).toMatch(/^Internal Server Error\nReference: kovo-/);
      expect(response.headers).toMatchObject({
        'Content-Type': 'text/html; charset=utf-8',
        'Kovo-Error-Id': expect.stringMatching(/^kovo-/),
      });
    }
    expect(onError).toHaveBeenCalledWith(loadError, {
      correlationId: loadResponse.headers['Kovo-Error-Id'],
      operation: 'route-page',
      request,
      routePath: '/products/:id',
    });
    expect(onError).toHaveBeenCalledWith(renderError, {
      correlationId: renderResponse.headers['Kovo-Error-Id'],
      operation: 'route-render',
      request,
      routePath: '/cart',
    });
  });
});
