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

  it('URL-decodes param segments so typed links round-trip (I2 ROUTING-NAV-2)', () => {
    const product = route('/products/:id/files/:file', {});

    // %2F decodes to '/' — a valid decoded segment value.
    expect(matchRoute([product], '/products/sku%2F1/files/readme.md')?.params).toEqual({
      file: 'readme.md',
      id: 'sku/1',
    });
    // Space encoded as %20 must round-trip to the human value.
    const users = route('/users/:id', {});
    expect(matchRoute([users], '/users/john%20doe')?.params).toEqual({ id: 'john doe' });
    // Malformed percent-sequence → no match (404).
    expect(matchRoute([users], '/users/bad%ZZid')).toBeUndefined();
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

  // F1 (bugs-part3 L2-route-matcher-1): an internal `//` run must not survive
  // normalization, or an empty interior segment silently matches a param and changes
  // the matched route arity (`/files//etc` → `/files/:a/:b` with `a=''`).
  it('collapses internal slash runs so an empty segment cannot match a param (F1)', () => {
    expect(normalizePathname('/a//b').pathname).toBe('/a/b');
    expect(normalizePathname('/files//etc')).toEqual({
      inputPathname: '/files//etc',
      pathname: '/files/etc',
      redirect: { pathname: '/files/etc', status: 308 },
      trailingSlash: 'canonical',
    });
    expect(normalizePathname('/orders//items').pathname).toBe('/orders/items');
    // Backslash runs collapse too (no smuggle via `/orders/\items`).
    expect(normalizePathname('/a/\\/b').pathname).toBe('/a/b');

    const files = route('/files/:a/:b', {});
    // The empty middle segment must NOT produce a match with `a=''`; the canonical
    // form `/files/etc` has only one interior segment so the two-param route no
    // longer matches it.
    expect(matchRoute([files], '/files//etc')).toBeUndefined();

    // A two-non-empty-segment request still matches and round-trips.
    expect(matchRoute([files], '/files/x/y')?.params).toEqual({ a: 'x', b: 'y' });
  });

  // L2-route-matcher-2 (bugs-part3): decoded `.`/`..` must never be delivered as a
  // literal param value (a traversal primitive). Aligns with the static-export check
  // (static-export-route-plan.ts) which already rejects decoded `.`/`..` segments.
  it('removes dot-segments and rejects decoded `.`/`..` param values (L2-route-matcher-2)', () => {
    const file = route('/files/:name', {});

    // Literal dot-segments are removed during normalization (RFC-3986 §5.2.4).
    expect(normalizePathname('/files/../etc').pathname).toBe('/etc');
    expect(normalizePathname('/files/./etc').pathname).toBe('/files/etc');
    // A trailing `..` cannot escape above root.
    expect(normalizePathname('/a/b/..').pathname).toBe('/a');
    expect(normalizePathname('/..').pathname).toBe('/');

    // A bare `/files/..` no longer matches `/files/:name` as `{name:'..'}`.
    expect(matchRoute([file], '/files/..')).toBeUndefined();
    expect(matchRoute([file], '/files/.')).toBeUndefined();

    // Percent-encoded `%2e%2e` decodes to `..` only at the param layer; it must also
    // be a no-match rather than a literal `..` param value.
    expect(matchRoute([file], '/files/%2e%2e')).toBeUndefined();
    expect(matchRoute([file], '/files/%2e')).toBeUndefined();

    // A normal filename still round-trips.
    expect(matchRoute([file], '/files/readme.md')?.params).toEqual({ name: 'readme.md' });
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
