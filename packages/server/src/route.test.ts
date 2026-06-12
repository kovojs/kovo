import { describe, expect, it, vi } from 'vitest';
import { redirect } from '@jiso/core';

import { renderPageHints } from './hints.js';
import { meta } from './meta.js';
import {
  notFound,
  parseRouteRequest,
  renderRoutePageResponse,
  route,
  runRoutePage,
} from './route.js';
import { s } from './schema.js';

describe('route primitives', () => {
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
        return 'cart';
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
});
