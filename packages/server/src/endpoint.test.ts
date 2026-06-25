import { createHmac } from 'node:crypto';
import { customVerifier, hmacSignature } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import {
  endpoint,
  endpointMatches,
  runEndpoint,
  runEndpointAuth,
  type EndpointResponsePosture,
  type EndpointRequest,
} from './endpoint.js';

const rawJsonResponse = {
  appOwnedSafety: true,
  body: 'json',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

const rawTextResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

function signEndpointBody(body: string): string {
  return createHmac('sha256', 'endpoint_secret').update(body).digest('hex');
}

describe('server endpoints', () => {
  it('declares raw endpoints with named CSRF exemptions and auth metadata', () => {
    const callback = endpoint('/auth/callback', {
      auth: { justification: 'oauth provider callback', kind: 'none' },
      csrf: false,
      csrfJustification: 'oauth provider callback',
      handler: () => new Response('ok'),
      method: 'POST',
      mount: 'exact',
      reason: 'oauth provider callback',
      response: rawTextResponse,
    });

    expect(callback.path).toBe('/auth/callback');
    expect(callback.method).toBe('POST');
    expect(callback.mount).toBe('exact');
    expect(callback.reason).toBe('oauth provider callback');
    expect(callback.response).toEqual(rawTextResponse);
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
        method: 'POST',
        reason: 'bad csrf exemption',
        response: rawTextResponse,
      });
    };
    const assertMissingAuditMetadataRejected = () => {
      // @ts-expect-error SPEC §9.1 requires explicit method/reason/response posture on raw endpoints.
      endpoint('/bad/metadata', {
        handler: () => new Response('bad'),
      });
    };
    const assertPrefixMountNeedsJustification = () => {
      // @ts-expect-error SPEC §9.1 prefix endpoint mounts require a named mount justification.
      endpoint('/bad/prefix', {
        handler: () => new Response('bad'),
        method: 'GET',
        mount: 'prefix',
        reason: 'bad prefix mount',
        response: rawTextResponse,
      });
    };
    const assertNoAmbientSession = (request: EndpointRequest) => {
      // @ts-expect-error SPEC §9.1 endpoints receive raw Request, not req.session.
      const session: { id: string } = request.session;
      return session;
    };

    expect(assertCsrfNeedsJustification).toBeTypeOf('function');
    expect(assertMissingAuditMetadataRejected).toBeTypeOf('function');
    expect(assertPrefixMountNeedsJustification).toBeTypeOf('function');
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
      reason: 'signed inventory webhook',
      response: rawJsonResponse,
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

  it('enforces executable HMAC endpoint auth before dispatch without consuming the body', async () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      name: 'inventory',
      payload: (request) => request.payload,
      scheme: 'inventory:v1:hmac-sha256',
      secret: 'endpoint_secret',
    });
    let handlerCalls = 0;
    const inventoryWebhook = endpoint('/webhooks/inventory', {
      auth: { kind: 'verifier', name: verifier.resolved.scheme, verify: verifier },
      csrf: false,
      csrfJustification: 'signed inventory webhook',
      async handler(request) {
        handlerCalls += 1;
        return new Response(await request.text(), { status: 202 });
      },
      method: 'POST',
      reason: 'signed inventory webhook',
      response: rawJsonResponse,
    });

    const badRequest = new Request('https://example.test/webhooks/inventory', {
      body: '{"sku":"p1"}',
      headers: { 'x-signature': signEndpointBody('{}') },
      method: 'POST',
    });
    const badAuth = await runEndpointAuth(inventoryWebhook, badRequest);

    expect(badAuth?.status).toBe(401);
    expect(badAuth === undefined ? '' : await badAuth.text()).toBe('Unauthorized');
    expect(handlerCalls).toBe(0);

    const body = '{"sku":"p2"}';
    const goodRequest = new Request('https://example.test/webhooks/inventory', {
      body,
      headers: { 'x-signature': signEndpointBody(body) },
      method: 'POST',
    });

    await expect(runEndpointAuth(inventoryWebhook, goodRequest)).resolves.toBeUndefined();
    const response = await runEndpoint(inventoryWebhook, goodRequest);

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe(body);
    expect(handlerCalls).toBe(1);
  });

  it('enforces custom endpoint verifiers and fails closed on verifier exceptions', async () => {
    const customEndpoint = endpoint('/machine/custom', {
      auth: {
        kind: 'custom',
        name: 'static-token',
        verify: customVerifier(
          'static-token',
          (request) =>
            request.headers instanceof Headers && request.headers.get('x-token') === 'accepted',
        ),
      },
      csrf: false,
      csrfJustification: 'custom machine verifier',
      handler: () => new Response('ok'),
      method: 'POST',
      purpose: 'custom machine verifier endpoint',
      response: rawTextResponse,
    });

    await expect(
      runEndpointAuth(
        customEndpoint,
        new Request('https://example.test/machine/custom', {
          body: 'payload',
          headers: { 'x-token': 'accepted' },
          method: 'POST',
        }),
      ),
    ).resolves.toBeUndefined();

    const rejected = await runEndpointAuth(
      customEndpoint,
      new Request('https://example.test/machine/custom', {
        body: 'payload',
        headers: { 'x-token': 'bad' },
        method: 'POST',
      }),
    );
    expect(rejected?.status).toBe(401);

    const throwingEndpoint = endpoint('/machine/throwing', {
      auth: {
        kind: 'custom',
        name: 'throwing',
        verify: customVerifier('throwing', () => {
          throw new Error('malformed signature');
        }),
      },
      csrf: false,
      csrfJustification: 'custom machine verifier',
      handler: () => new Response('unreachable'),
      method: 'POST',
      reason: 'throwing verifier fail-closed test',
      response: rawTextResponse,
    });
    const thrown = await runEndpointAuth(
      throwingEndpoint,
      new Request('https://example.test/machine/throwing', {
        body: 'payload',
        method: 'POST',
      }),
    );

    expect(thrown?.status).toBe(401);
    expect(thrown === undefined ? '' : await thrown.text()).toBe('Unauthorized');
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
      reason: 'external machine caller',
      response: rawTextResponse,
    });

    await expect((await runEndpoint(machineEndpoint, request)).text()).resolves.toBe(
      'sessionless:payload',
    );
  });

  it('verifies raw endpoint response posture when runtime verification is enabled', async () => {
    const previous = process.env.KOVO_VERIFY_ENDPOINT_POSTURE;
    process.env.KOVO_VERIFY_ENDPOINT_POSTURE = '1';
    try {
      const mismatched = endpoint('/machine/posture-bad', {
        csrf: false,
        csrfJustification: 'runtime posture verification test',
        handler: () => new Response('{"ok":true}', { headers: { 'Content-Type': 'text/plain' } }),
        method: 'POST',
        reason: 'runtime posture verification test',
        response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
      });
      await expect(
        runEndpoint(
          mismatched,
          new Request('https://example.test/machine/posture-bad', { method: 'POST' }),
        ),
      ).rejects.toThrow(/response posture mismatch/u);

      const matched = endpoint('/machine/posture-ok', {
        csrf: false,
        csrfJustification: 'runtime posture verification test',
        handler: () =>
          Response.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } }),
        method: 'POST',
        reason: 'runtime posture verification test',
        response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
      });
      await expect(
        runEndpoint(
          matched,
          new Request('https://example.test/machine/posture-ok', { method: 'POST' }),
        ),
      ).resolves.toMatchObject({ status: 200 });
    } finally {
      if (previous === undefined) delete process.env.KOVO_VERIFY_ENDPOINT_POSTURE;
      else process.env.KOVO_VERIFY_ENDPOINT_POSTURE = previous;
    }
  });

  it('fails endpoint posture verification for cache, body, and content-type drift', async () => {
    const previous = process.env.KOVO_VERIFY_ENDPOINT_POSTURE;
    process.env.KOVO_VERIFY_ENDPOINT_POSTURE = '1';
    try {
      const cases = [
        {
          handler: () => new Response('ok', { headers: { 'Content-Type': 'text/plain' } }),
          path: '/machine/posture-cache',
          response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
          text: /Cache-Control: no-store/u,
        },
        {
          handler: () =>
            new Response('not a redirect', {
              headers: { 'Cache-Control': 'no-store', Location: '/login' },
            }),
          path: '/machine/posture-body',
          response: {
            appOwnedSafety: true,
            body: 'redirect',
            cache: 'no-store',
            reservedHeaders: ['Location'],
          },
          text: /body=redirect/u,
        },
        {
          handler: () =>
            new Response('{"ok":true}', {
              headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' },
            }),
          path: '/machine/posture-content-type',
          response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
          text: /content type is not JSON/u,
        },
      ] as const;

      for (const fixture of cases) {
        const mismatched = endpoint(fixture.path, {
          csrf: false,
          csrfJustification: 'runtime posture verification test',
          handler: fixture.handler,
          method: 'POST',
          reason: 'runtime posture verification test',
          response: fixture.response,
        });

        await expect(
          runEndpoint(
            mismatched,
            new Request(`https://example.test${fixture.path}`, { method: 'POST' }),
          ),
        ).rejects.toThrow(fixture.text);
      }
    } finally {
      if (previous === undefined) delete process.env.KOVO_VERIFY_ENDPOINT_POSTURE;
      else process.env.KOVO_VERIFY_ENDPOINT_POSTURE = previous;
    }
  });

  it('flags reserved raw endpoint response headers unless explicitly declared', async () => {
    const previous = process.env.KOVO_VERIFY_ENDPOINT_POSTURE;
    process.env.KOVO_VERIFY_ENDPOINT_POSTURE = '1';
    try {
      for (const [header, value, expected] of [
        ['Kovo-Reauth', '/login', 'Kovo-*'],
        ['Kovo-Build', 'build-a', 'Kovo-*'],
        ['Kovo-Changes', '[]', 'Kovo-*'],
        ['Set-Cookie', 'sid=1; Path=/', 'Set-Cookie'],
        ['Location', '/login', 'Location'],
        ['Content-Security-Policy', "default-src 'self'", 'content-security-policy'],
      ] as const) {
        const accidental = endpoint(`/machine/reserved/${header.toLowerCase()}`, {
          csrf: false,
          csrfJustification: 'runtime reserved header verification test',
          handler: () =>
            new Response('ok', { headers: { 'Cache-Control': 'no-store', [header]: value } }),
          method: 'POST',
          reason: 'runtime reserved header verification test',
          response: rawTextResponse,
        });

        await expect(
          runEndpoint(
            accidental,
            new Request(`https://example.test/machine/reserved/${header.toLowerCase()}`, {
              method: 'POST',
            }),
          ),
        ).rejects.toThrow(new RegExp(expected, 'iu'));
      }

      const declared = endpoint('/machine/reserved/declared', {
        csrf: false,
        csrfJustification: 'runtime reserved header declaration test',
        handler: () =>
          new Response('ok', {
            headers: {
              'Cache-Control': 'no-store',
              'Content-Security-Policy': "default-src 'self'",
              'Kovo-Reauth': '/login',
              Location: '/login',
              'Set-Cookie': 'sid=1; Path=/',
            },
          }),
        method: 'POST',
        reason: 'runtime reserved header declaration test',
        response: {
          ...rawTextResponse,
          reservedHeaders: ['Content-Security-Policy', 'Kovo-*', 'Location', 'Set-Cookie'],
        },
      });

      await expect(
        runEndpoint(
          declared,
          new Request('https://example.test/machine/reserved/declared', { method: 'POST' }),
        ),
      ).resolves.toMatchObject({ status: 200 });
    } finally {
      if (previous === undefined) delete process.env.KOVO_VERIFY_ENDPOINT_POSTURE;
      else process.env.KOVO_VERIFY_ENDPOINT_POSTURE = previous;
    }
  });

  it('matches exact and prefix endpoint mounts without routing side effects', () => {
    const exact = endpoint('/downloads/orders.bin', {
      handler: () => new Response('orders'),
      method: 'GET',
      reason: 'orders binary download',
      response: { appOwnedSafety: true, body: 'bytes', cache: 'private' },
    });
    const mounted = endpoint('/auth', {
      csrf: false,
      csrfJustification: 'auth adapter owns callback subpaths',
      handler: () => new Response('auth'),
      method: 'GET',
      mount: 'prefix',
      mountJustification: 'auth adapter owns callback subpaths',
      reason: 'auth adapter callback mount',
      response: rawTextResponse,
    });

    expect(endpointMatches(exact, { method: 'GET', pathname: '/downloads/orders.bin' })).toBe(true);
    expect(endpointMatches(exact, { method: 'GET', pathname: '/downloads/orders.bin/extra' })).toBe(
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
