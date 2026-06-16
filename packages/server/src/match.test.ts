import { describe, expect, it } from 'vitest';

import { route } from './route.js';
import { findRouteAmbiguities, matchRoute, normalizePathname } from './match.js';

describe('server route matching', () => {
  it('normalizes trailing slashes before route matching with 308 metadata', () => {
    const product = route('/products/:id', {});

    const match = matchRoute([product], '/products/p1/');

    expect(match).toMatchObject({
      normalization: {
        inputPathname: '/products/p1/',
        pathname: '/products/p1',
        redirect: { pathname: '/products/p1', status: 308 },
        trailingSlash: 'removed',
      },
      params: { id: 'p1' },
      pathname: '/products/p1',
      route: product,
    });
  });

  it('prefers static segments over params at each depth', () => {
    const product = route('/products/:id', {});
    const productNew = route('/products/new', {});

    expect(matchRoute([product, productNew], '/products/new')?.route).toBe(productNew);
    expect(matchRoute([productNew, product], '/products/p1')?.route).toBe(product);
  });

  it('extracts raw param segments for parseRouteRequest coercion', () => {
    const product = route('/products/:id/files/:file', {});

    expect(matchRoute([product], '/products/sku%2F1/files/readme.md')?.params).toEqual({
      file: 'readme.md',
      id: 'sku%2F1',
    });
  });

  it('invalidates cached route tables when a route path changes', () => {
    const mutableRoute = { path: '/products/:id' };
    const routes = [mutableRoute];

    expect(matchRoute(routes, '/products/p1')?.params).toEqual({ id: 'p1' });

    mutableRoute.path = '/collections/:id';

    expect(matchRoute(routes, '/products/p1')).toBeUndefined();
    expect(matchRoute(routes, '/collections/c1')?.params).toEqual({ id: 'c1' });
  });

  // Security finding H5: a leading `//` or `/\` must never survive normalization,
  // or it becomes a protocol-relative `Location` (unauthenticated open redirect).
  it.each([
    ['//evil.com/', '/evil.com'],
    ['/\\evil.com/', '/evil.com'],
    ['//evil.com//', '/evil.com'],
    ['/\\/evil.com', '/evil.com'],
  ])('collapses leading authority-forming slashes for %s', (input, expected) => {
    const normalization = normalizePathname(input);

    expect(normalization.pathname).toBe(expected);
    expect(normalization.pathname.startsWith('//')).toBe(false);
    expect(normalization.pathname.startsWith('/\\')).toBe(false);
    expect(normalization.redirect).toEqual({ pathname: expected, status: 308 });
    expect(normalization.redirect?.pathname.startsWith('//')).toBe(false);
    expect(normalization.redirect?.pathname.startsWith('/\\')).toBe(false);
  });

  it('preserves canonical single-slash paths without an authority-collapse redirect', () => {
    expect(normalizePathname('/products/p1')).toEqual({
      inputPathname: '/products/p1',
      pathname: '/products/p1',
      trailingSlash: 'canonical',
    });
  });

  it('reports KV228 ambiguities when two route patterns can match one pathname', () => {
    expect(
      findRouteAmbiguities([
        route('/products/:id', {}),
        route('/products/new', {}),
        route('/products/:sku/reviews', {}),
        route('/products/:id/reviews', {}),
        route('/cart', {}),
      ]),
    ).toEqual([
      {
        code: 'KV228',
        message:
          "Ambiguous route table: '/products/:id' and '/products/new' can both match canonical request path '/products/new'.",
        paths: ['/products/:id', '/products/new'],
        witnessPath: '/products/new',
      },
      {
        code: 'KV228',
        message:
          "Ambiguous route table: '/products/:sku/reviews' and '/products/:id/reviews' can both match canonical request path '/products/:sku/reviews'.",
        paths: ['/products/:sku/reviews', '/products/:id/reviews'],
        witnessPath: '/products/:sku/reviews',
      },
    ]);
  });
});
