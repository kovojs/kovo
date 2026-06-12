import { describe, expect, it } from 'vitest';

import { endpoint, endpointMatches, runEndpoint, type EndpointRequest } from './index.js';

describe('server endpoints', () => {
  it('declares raw endpoints with named CSRF exemptions and auth metadata', () => {
    const callback = endpoint('/auth/callback', {
      auth: { justification: 'oauth provider callback', kind: 'none' },
      csrf: false,
      csrfJustification: 'oauth provider callback',
      handler: () => new Response('ok'),
      method: 'POST',
      mount: 'exact',
    });

    expect(callback.path).toBe('/auth/callback');
    expect(callback.method).toBe('POST');
    expect(callback.mount).toBe('exact');
    expect(callback.auth).toEqual({ justification: 'oauth provider callback', kind: 'none' });
    expect(callback.csrf).toEqual({
      exempt: true,
      justification: 'oauth provider callback',
    });

    const assertCsrfNeedsJustification = () => {
      // @ts-expect-error SPEC §9.1 requires a named justification for endpoint CSRF exemption.
      endpoint('/bad/csrf', {
        csrf: false,
        handler: () => new Response('bad'),
      });
    };
    const assertNoAmbientSession = (request: EndpointRequest) => {
      // @ts-expect-error SPEC §9.1 endpoints receive raw Request, not req.session.
      const session: { id: string } = request.session;
      return session;
    };

    expect(assertCsrfNeedsJustification).toBeTypeOf('function');
    expect(assertNoAmbientSession).toBeTypeOf('function');
  });

  it('runs endpoint handlers as raw Request to Response without consuming the body first', async () => {
    const seen: string[] = [];
    const inventoryWebhook = endpoint('/webhooks/inventory', {
      auth: { kind: 'verifier', name: 'inventory-hmac' },
      csrf: false,
      csrfJustification: 'signed inventory webhook',
      async handler(request) {
        seen.push(request.headers.get('x-signature') ?? '');
        return new Response(await request.text(), {
          headers: { 'content-type': 'application/json' },
          status: 202,
        });
      },
      method: 'POST',
    });
    const response = await runEndpoint(
      inventoryWebhook,
      new Request('https://example.test/webhooks/inventory', {
        body: '{"sku":"p1"}',
        headers: { 'x-signature': 'sig_123' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.text()).resolves.toBe('{"sku":"p1"}');
    expect(seen).toEqual(['sig_123']);
  });

  it('does not pass ambient session properties to endpoint handlers', async () => {
    const request = new Request('https://example.test/machine', {
      body: 'payload',
      method: 'POST',
    });
    Object.defineProperty(request, 'session', {
      configurable: true,
      value: { id: 's1' },
    });
    const machineEndpoint = endpoint('/machine', {
      csrf: false,
      csrfJustification: 'external machine caller',
      async handler(rawRequest) {
        expect('session' in rawRequest).toBe(false);
        expect((rawRequest as unknown as { session?: unknown }).session).toBeUndefined();
        return new Response(`sessionless:${await rawRequest.text()}`);
      },
      method: 'POST',
    });

    await expect((await runEndpoint(machineEndpoint, request)).text()).resolves.toBe(
      'sessionless:payload',
    );
  });

  it('matches exact and prefix endpoint mounts without routing side effects', () => {
    const exact = endpoint('/exports/orders.csv', {
      handler: () => new Response('orders'),
      method: 'GET',
    });
    const mounted = endpoint('/auth', {
      csrf: false,
      csrfJustification: 'auth adapter owns callback subpaths',
      handler: () => new Response('auth'),
      method: 'GET',
      mount: 'prefix',
    });

    expect(endpointMatches(exact, { method: 'GET', pathname: '/exports/orders.csv' })).toBe(true);
    expect(endpointMatches(exact, { method: 'GET', pathname: '/exports/orders.csv/extra' })).toBe(
      false,
    );
    expect(endpointMatches(mounted, { method: 'GET', pathname: '/auth/callback/github' })).toBe(
      true,
    );
    expect(endpointMatches(mounted, { method: 'POST', pathname: '/auth/callback/github' })).toBe(
      false,
    );
  });
});
