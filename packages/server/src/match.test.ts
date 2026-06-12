import { describe, expect, it } from 'vitest';

import { route } from './route.js';
import { findRouteAmbiguities, matchRoute } from './match.js';

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

  it('reports FW228 ambiguities when two route patterns can match one pathname', () => {
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
        code: 'FW228',
        message:
          'Ambiguous route table entry. SPEC 6.4 routes must be statically provable navigation targets; planned 9.5 shell dispatch rejects route pairs that can match the same pathname.',
        paths: ['/products/:id', '/products/new'],
        witnessPath: '/products/new',
      },
      {
        code: 'FW228',
        message:
          'Ambiguous route table entry. SPEC 6.4 routes must be statically provable navigation targets; planned 9.5 shell dispatch rejects route pairs that can match the same pathname.',
        paths: ['/products/:sku/reviews', '/products/:id/reviews'],
        witnessPath: '/products/:sku/reviews',
      },
    ]);
  });
});
