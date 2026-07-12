import { describe, expect, it } from 'vitest';

import {
  buildRoutePatternHref,
  findRouteAmbiguities,
  matchRoute,
  normalizePathname,
  parseRoutePattern,
} from './route-pattern.js';

describe('core internal route pattern contract', () => {
  it('keeps canonical matching and href encoding pinned after scalar and iterator poisoning', () => {
    const routes = [{ path: '/public' }, { path: '/admin' }];
    expect(matchRoute(routes, '/public')?.route.path).toBe('/public');
    const originalSplit = String.prototype.split;
    const originalReplace = String.prototype.replace;
    const originalStartsWith = String.prototype.startsWith;
    const originalSlice = String.prototype.slice;
    const originalJoin = Array.prototype.join;
    const originalPop = Array.prototype.pop;
    const originalIterator = Array.prototype[Symbol.iterator];
    const originalMax = Math.max;
    const originalEncode = globalThis.encodeURIComponent;
    const originalDecode = globalThis.decodeURIComponent;
    const originalStringify = JSON.stringify;
    const originalKeys = Object.keys;
    let normalization: ReturnType<typeof normalizePathname> | undefined;
    let match: ReturnType<typeof matchRoute> = undefined;
    let authorityMatch: ReturnType<typeof matchRoute> = undefined;
    let href = '';
    try {
      String.prototype.split = () => ['forged'];
      String.prototype.replace = function (search, replacement) {
        return this === '/public'
          ? '/admin'
          : Reflect.apply(originalReplace, this, [search, replacement]);
      };
      String.prototype.startsWith = () => false;
      String.prototype.slice = () => 'forged';
      Array.prototype.join = () => '/admin';
      Array.prototype.pop = () => 'forged';
      Array.prototype[Symbol.iterator] = function () {
        return { next: () => ({ done: true, value: undefined }) } as ArrayIterator<unknown>;
      };
      Math.max = () => 0;
      globalThis.encodeURIComponent = () => 'javascript:forged';
      globalThis.decodeURIComponent = () => '..';
      JSON.stringify = () => 'forged';
      Object.keys = () => [];

      normalization = normalizePathname('/tenant//a/../safe/?ignored=1');
      authorityMatch = matchRoute(routes, '/public');
      match = matchRoute([{ path: '/tenant/:__proto__' }], '/tenant/value%2Fpart');
      href = buildRoutePatternHref('/tenant/:id', {
        params: { id: 'value/part' },
        search: { q: 'a b' },
      });
    } finally {
      String.prototype.split = originalSplit;
      String.prototype.replace = originalReplace;
      String.prototype.startsWith = originalStartsWith;
      String.prototype.slice = originalSlice;
      Array.prototype.join = originalJoin;
      Array.prototype.pop = originalPop;
      Array.prototype[Symbol.iterator] = originalIterator;
      Math.max = originalMax;
      globalThis.encodeURIComponent = originalEncode;
      globalThis.decodeURIComponent = originalDecode;
      JSON.stringify = originalStringify;
      Object.keys = originalKeys;
    }

    expect(normalization?.pathname).toBe('/tenant/safe');
    expect(authorityMatch?.route.path).toBe('/public');
    expect(match?.params['__proto__']).toBe('value/part');
    expect(Object.getPrototypeOf(match?.params)).toBeNull();
    expect(href).toBe('/tenant/value%2Fpart?q=a+b');
  });

  it('parses and normalizes route patterns once for hrefs, matching, export, and ambiguity checks', () => {
    expect(parseRoutePattern('/docs//:slug/./:file.name/')).toEqual({
      hasParams: true,
      paramNames: ['slug', 'file.name'],
      path: '/docs/:slug/:file.name',
      segments: [
        { kind: 'static', value: 'docs' },
        { kind: 'param', name: 'slug', value: ':slug' },
        { kind: 'param', name: 'file.name', value: ':file.name' },
      ],
    });

    expect(parseRoutePattern('/users/:user-id').paramNames).toEqual(['user-id']);
    expect(parseRoutePattern('/files/:name.json').paramNames).toEqual(['name.json']);
    expect(parseRoutePattern('/cart').hasParams).toBe(false);
  });

  it('builds hrefs with the same param grammar the server matcher decodes', () => {
    const href = buildRoutePatternHref('/docs/:tenant-id/files/:file.name', {
      params: { 'file.name': 'read me.md', 'tenant-id': 'acme/ops' },
      search: { filter: 'a:b', omitted: undefined, page: 2 },
    });

    expect(href).toBe('/docs/acme%2Fops/files/read%20me.md?filter=a%3Ab&page=2');
    expect(matchRoute([{ path: '/docs/:tenant-id/files/:file.name' }], href)?.params).toEqual({
      'file.name': 'read me.md',
      'tenant-id': 'acme/ops',
    });
  });

  it('uses one canonical pathname normalizer for slash runs and dot segments', () => {
    expect(normalizePathname('/a//b/./c/../d/')).toEqual({
      inputPathname: '/a//b/./c/../d/',
      pathname: '/a/b/d',
      redirect: { pathname: '/a/b/d', status: 308 },
      trailingSlash: 'removed',
    });
    expect(matchRoute([{ path: '/files/:name' }], '/files/%2e%2e')).toBeUndefined();
    expect(matchRoute([{ path: '/files/:name' }], '/files/report.txt')?.params).toEqual({
      name: 'report.txt',
    });
  });

  it('reports static-vs-dynamic and dynamic-vs-dynamic ambiguity from normalized patterns', () => {
    expect(
      findRouteAmbiguities([
        { path: '/products/:id' },
        { path: '/products/new/' },
        { path: '/docs/:slug' },
        { path: '/docs/:title' },
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
          "Ambiguous route table: '/docs/:slug' and '/docs/:title' can both match canonical request path '/docs/:slug'.",
        paths: ['/docs/:slug', '/docs/:title'],
        witnessPath: '/docs/:slug',
      },
    ]);
  });
});
