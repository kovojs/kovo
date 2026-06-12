import { describe, expect, it } from 'vitest';

import { endpoint } from './endpoint.js';
import { normalizePathname } from './match.js';
import { route } from './route.js';
import { matchShellDispatch, shellDispatchTable } from './shell.js';

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
