import { describe, expect, it } from 'vitest';

import {
  endpoint,
  findRouteAmbiguities,
  matchRoute,
  matchShellDispatch,
  normalizePathname,
  route,
  shellDispatchTable,
} from './index.js';

describe('server app shell route matching', () => {
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

describe('server app shell dispatch table', () => {
  it('keeps the planned reserved dispatch order printable', () => {
    expect(shellDispatchTable.map((entry) => entry.phase)).toEqual([
      'mutation',
      'query',
      'client-module',
      'endpoint-exact',
      'endpoint-prefix',
      'route',
      'not-found',
    ]);
  });

  it('dispatches reserved namespaces before endpoints and routes', () => {
    const catchAllEndpoint = endpoint('/_m', {
      handler: () => new Response('endpoint'),
      method: 'POST',
      mount: 'prefix',
    });
    const reservedRoute = route('/_m/:key', {});

    expect(
      matchShellDispatch({
        endpoints: [catchAllEndpoint],
        method: 'POST',
        pathname: '/_m/cart/add',
        routes: [reservedRoute],
      }),
    ).toMatchObject({
      key: 'cart/add',
      kind: 'mutation',
      pathname: '/_m/cart/add',
    });
  });

  it('dispatches endpoint exact mounts before endpoint prefix mounts', () => {
    const exactEndpoint = endpoint('/auth/callback', {
      handler: () => new Response('exact'),
      method: 'GET',
    });
    const prefixEndpoint = endpoint('/auth', {
      csrf: false,
      csrfJustification: 'auth adapter owns callback subpaths',
      handler: () => new Response('prefix'),
      method: 'GET',
      mount: 'prefix',
    });

    expect(
      matchShellDispatch({
        endpoints: [prefixEndpoint, exactEndpoint],
        method: 'GET',
        pathname: '/auth/callback',
      }),
    ).toMatchObject({
      endpoint: exactEndpoint,
      kind: 'endpoint',
    });
  });

  it('dispatches routes after endpoints and records page method allowance', () => {
    const routeEndpoint = endpoint('/products/p1', {
      handler: () => new Response('endpoint'),
      method: 'POST',
    });
    const product = route('/products/:id', {});

    expect(
      matchShellDispatch({
        endpoints: [routeEndpoint],
        method: 'GET',
        pathname: '/products/p1',
        routes: [product],
      }),
    ).toMatchObject({
      kind: 'route',
      methodAllowed: true,
      params: { id: 'p1' },
      route: product,
    });

    expect(
      matchShellDispatch({
        endpoints: [routeEndpoint],
        method: 'POST',
        pathname: '/products/p1',
        routes: [product],
      }),
    ).toMatchObject({
      endpoint: routeEndpoint,
      kind: 'endpoint',
    });

    expect(
      matchShellDispatch({
        method: 'POST',
        pathname: '/products/p1',
        routes: [product],
      }),
    ).toMatchObject({
      allowedMethods: ['GET', 'HEAD'],
      kind: 'route',
      methodAllowed: false,
    });
  });

  it('falls through to the 404 dispatch phase with canonical pathname metadata', () => {
    expect(matchShellDispatch({ pathname: '/missing/' })).toMatchObject({
      kind: 'not-found',
      normalization: {
        inputPathname: '/missing/',
        pathname: '/missing',
        redirect: { pathname: '/missing', status: 308 },
        trailingSlash: 'removed',
      },
      pathname: '/missing',
    });
  });

  it('normalizes pathnames without touching canonical roots', () => {
    expect(normalizePathname('/')).toEqual({
      inputPathname: '/',
      pathname: '/',
      trailingSlash: 'canonical',
    });
  });
});
