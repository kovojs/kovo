import { describe, expect, it } from 'vitest';

import { endpoint, type EndpointResponsePosture } from './endpoint.js';
import { normalizePathname } from './match.js';
import { route } from './route.js';
import { matchShellDispatch, shellDispatchTable } from './shell.js';

const rawTextResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

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
      mountJustification: 'reserved namespace dispatch ordering fixture',
      reason: 'reserved namespace dispatch ordering fixture',
      response: rawTextResponse,
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

  it('uses pinned static dispatch traversal and path controls after prototype poisoning', () => {
    const originalIterator = Array.prototype[Symbol.iterator];
    Array.prototype[Symbol.iterator] = function () {
      if (
        this.length === 6 &&
        (this[0] as { phase?: string } | undefined)?.phase === 'mutation' &&
        (this[5] as { phase?: string } | undefined)?.phase === 'route'
      ) {
        return originalIterator.call([]);
      }
      return originalIterator.call(this);
    } as (typeof Array.prototype)[Symbol.iterator];
    let iteratorResult;
    try {
      iteratorResult = matchShellDispatch({ method: 'POST', pathname: '/_m/cart/add' });
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }
    expect(iteratorResult).toMatchObject({ key: 'cart/add', kind: 'mutation' });

    const originalStartsWith = String.prototype.startsWith;
    const originalSlice = String.prototype.slice;
    String.prototype.startsWith = function (search, position) {
      if (originalSlice.call(this, 0) === '/_m/cart/add' && search === '/_m/') return false;
      return originalStartsWith.call(this, search, position);
    };
    String.prototype.slice = function (start, end) {
      if (originalSlice.call(this, 0) === '/_m/cart/add' && start === 4 && end === undefined) {
        return 'wrong-registry-key';
      }
      return originalSlice.call(this, start, end);
    };
    let pathResult;
    try {
      pathResult = matchShellDispatch({ method: 'POST', pathname: '/_m/cart/add' });
    } finally {
      String.prototype.startsWith = originalStartsWith;
      String.prototype.slice = originalSlice;
    }
    expect(pathResult).toMatchObject({ key: 'cart/add', kind: 'mutation' });
  });

  it('dispatches endpoint exact mounts before endpoint prefix mounts', () => {
    const exactEndpoint = endpoint('/auth/callback', {
      handler: () => new Response('exact'),
      method: 'GET',
      reason: 'exact callback endpoint ordering fixture',
      response: rawTextResponse,
    });
    const prefixEndpoint = endpoint('/auth', {
      csrf: false,
      csrfJustification: 'auth adapter owns callback subpaths',
      handler: () => new Response('prefix'),
      method: 'GET',
      mount: 'prefix',
      mountJustification: 'auth adapter owns callback subpaths',
      reason: 'auth adapter callback prefix',
      response: rawTextResponse,
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

  it('dispatches method-allowed endpoints before routes and lets endpoint method mismatches fall through to routes', () => {
    const routeEndpoint = endpoint('/products/p1', {
      handler: () => new Response('endpoint'),
      method: 'POST',
      reason: 'endpoint before route method fixture',
      response: rawTextResponse,
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
      allowedMethods: ['GET', 'HEAD'],
      kind: 'route',
      methodAllowed: true,
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

  it('records endpoint method mismatch on an existing endpoint path for 405 handling', () => {
    const status = endpoint('/status', {
      handler: () => new Response('ok'),
      method: 'GET',
      reason: 'endpoint method mismatch fixture',
      response: rawTextResponse,
    });

    expect(
      matchShellDispatch({
        endpoints: [status],
        method: 'POST',
        pathname: '/status',
      }),
    ).toMatchObject({
      allowedMethods: ['GET', 'HEAD'],
      endpoint: status,
      kind: 'endpoint',
      methodAllowed: false,
    });

    expect(
      matchShellDispatch({
        endpoints: [status],
        method: 'HEAD',
        pathname: '/status',
      }),
    ).toMatchObject({
      allowedMethods: ['GET', 'HEAD'],
      endpoint: status,
      kind: 'endpoint',
      methodAllowed: true,
    });
  });

  it('cannot cross-bind endpoint posture or authorize a method through Array.find/some poisoning', () => {
    const publicMachineEndpoint = endpoint('/machine', {
      csrf: false,
      csrfJustification: 'machine endpoint sibling for dispatch poisoning regression',
      handler: () => new Response('public-machine-handler'),
      method: 'POST',
      reason: 'machine endpoint sibling for dispatch poisoning regression',
      response: rawTextResponse,
    });
    const protectedEndpoint = endpoint('/account', {
      handler: () => new Response('protected-account-handler'),
      method: 'POST',
      reason: 'protected endpoint for dispatch poisoning regression',
      response: rawTextResponse,
    });
    const endpoints = [publicMachineEndpoint, protectedEndpoint];
    const originalFind = Array.prototype.find;
    const originalSome = Array.prototype.some;
    Array.prototype.find = function (predicate, thisArg) {
      if (this === endpoints) return publicMachineEndpoint;
      return originalFind.call(this, predicate, thisArg);
    } as typeof Array.prototype.find;
    Array.prototype.some = () => true;
    try {
      expect(matchShellDispatch({ endpoints, method: 'POST', pathname: '/account' })).toMatchObject(
        {
          endpoint: protectedEndpoint,
          kind: 'endpoint',
          methodAllowed: true,
        },
      );
      expect(matchShellDispatch({ endpoints, method: 'GET', pathname: '/account' })).toMatchObject({
        endpoint: protectedEndpoint,
        kind: 'endpoint',
        methodAllowed: false,
      });
    } finally {
      Array.prototype.find = originalFind;
      Array.prototype.some = originalSome;
    }
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
