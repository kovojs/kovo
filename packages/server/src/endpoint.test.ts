import { createHmac } from 'node:crypto';
import { customVerifier, hmacSignature, type HmacSignatureVerifier } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { mintCsrfToken } from './csrf.js';
import {
  endpoint,
  endpointMatches,
  frameworkEndpoint,
  pinEndpointBrowserCredentialDelegation,
  runEndpoint,
  runEndpointAuth,
  type EndpointResponsePosture,
  type EndpointRequest,
} from './endpoint.js';
import {
  assertEndpointResponsePosture,
  assertEndpointResponsePostureAndSnapshot,
  endpointRequestWithoutSession,
} from './response-posture.js';

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

const ENDPOINT_HMAC_SECRET = '000102030405060708090a0b0c0d0e0f';
const OFFICIAL_HMAC_SECRET = '101112131415161718191a1b1c1d1e1f';

function signEndpointBody(body: string): string {
  return createHmac('sha256', ENDPOINT_HMAC_SECRET).update(body).digest('hex');
}

describe('server endpoints', () => {
  const directCsrf = {
    secret: 'direct-endpoint-lifecycle-secret-0123456789abcdef',
    sessionId: () => undefined,
  };

  it('seals the retained handler request when direct runEndpoint execution resolves', async () => {
    let retainedRequest: Request | undefined;
    const direct = endpoint('/direct/retained-request', {
      auth: { kind: 'none', justification: 'direct execution lifecycle fixture' },
      handler(request) {
        retainedRequest = request;
        return new Response('ok');
      },
      method: 'GET',
      reason: 'direct endpoint response lifecycle fixture',
      response: { appOwnedSafety: true, body: 'text', cache: 'custom' },
    });

    await expect(
      runEndpoint(direct, new Request('https://example.test/direct/retained-request')),
    ).resolves.toMatchObject({ status: 200 });
    expect(retainedRequest).toBeDefined();
    expect(() =>
      mintCsrfToken(retainedRequest!, directCsrf, { audience: 'direct-retained-submit' }),
    ).toThrow(/after response headers were committed/u);
  });

  it('rejects a direct first-anonymous mint because runEndpoint has no cookie sink', async () => {
    const direct = endpoint('/direct/eager-token', {
      auth: { kind: 'none', justification: 'direct execution lifecycle fixture' },
      handler(request) {
        return new Response(
          mintCsrfToken(request, directCsrf, { audience: 'direct-eager-submit' }).token,
        );
      },
      method: 'GET',
      reason: 'direct endpoint cookie delivery fixture',
      response: { appOwnedSafety: true, body: 'text', cache: 'custom' },
    });

    await expect(
      runEndpoint(direct, new Request('https://example.test/direct/eager-token')),
    ).rejects.toThrow(/cannot deliver a first-anonymous CSRF binding cookie/u);
  });

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
    expect(() =>
      endpoint('/bad/lowercase-method', {
        handler: () => new Response('bad'),
        method: 'get',
        reason: 'non-canonical endpoint method proof',
        response: rawTextResponse,
      }),
    ).toThrow('canonical uppercase');
  });

  it('ignores inherited endpoint posture and refuses accessors without invoking them', () => {
    const inherited = Object.create({
      csrf: false,
      csrfJustification: 'prototype-provided exemption',
      db: true,
      mount: 'prefix',
      mountJustification: 'prototype-provided prefix mount',
    });
    Object.defineProperties(inherited, {
      handler: { enumerable: true, value: () => new Response('ok') },
      method: { enumerable: true, value: 'POST' },
      reason: { enumerable: true, value: 'exact endpoint declaration' },
      response: { enumerable: true, value: rawTextResponse },
    });
    const declaration = endpoint('/exact-own-posture', inherited);
    expect(declaration.csrf).toBeUndefined();
    expect(declaration.db).toBeUndefined();
    expect(declaration.mount).toBe('exact');

    let getterCalls = 0;
    const accessor = {
      handler: () => new Response('ok'),
      method: 'POST',
      reason: 'accessor endpoint declaration',
      response: rawTextResponse,
    } as Parameters<typeof endpoint>[1];
    Object.defineProperty(accessor, 'csrf', {
      configurable: true,
      get() {
        getterCalls += 1;
        return false;
      },
    });
    expect(() => endpoint('/accessor-posture', accessor)).toThrow('own data');
    expect(getterCalls).toBe(0);
  });

  it('pins reserved-header posture before an asynchronous endpoint handler runs', async () => {
    const reservedHeaders: string[] = [];
    const responsePosture: EndpointResponsePosture = {
      appOwnedSafety: true,
      body: 'text',
      cache: 'no-store',
      reservedHeaders,
    };
    const declaration = endpoint('/late-reserved-header', {
      async handler() {
        await Promise.resolve();
        reservedHeaders.push('Set-Cookie');
        return new Response('ok', {
          headers: { 'Cache-Control': 'no-store', 'Set-Cookie': 'sid=attacker; Path=/' },
        });
      },
      method: 'POST',
      reason: 'late reserved header posture regression',
      response: responsePosture,
    });
    await expect(
      runEndpoint(
        declaration,
        new Request('https://example.test/late-reserved-header', { method: 'POST' }),
      ),
    ).rejects.toThrow(/Set-Cookie/u);
  });

  it('retains one immutable nested endpoint declaration snapshot', () => {
    const body: ['json', 'text'] = ['json', 'text'];
    const reservedHeaders = ['Location'];
    const allowEntry = {
      origin: 'https://accounts.example.test',
      reason: 'delegated identity provider',
    };
    const redirectAllowlist = [allowEntry];
    const response: EndpointResponsePosture = {
      appOwnedSafety: true,
      body,
      cache: 'no-store',
      redirectAllowlist,
      reservedHeaders,
    };
    const auth = { justification: 'public machine callback', kind: 'none' as const };
    const definition = {
      auth,
      csrf: false as const,
      csrfJustification: 'public machine callback',
      handler: () => new Response('ok'),
      method: 'POST' as const,
      reason: 'immutable endpoint declaration regression',
      response,
    };
    const declaration = endpoint('/immutable-endpoint', definition);

    body[0] = 'bytes';
    reservedHeaders[0] = 'Set-Cookie';
    allowEntry.origin = 'https://attacker.example';
    response.appOwnedSafety = false;
    response.cache = 'public';
    auth.justification = 'changed after declaration';
    definition.handler = () => new Response('attacker');

    expect(declaration.response).toEqual({
      appOwnedSafety: true,
      body: ['json', 'text'],
      cache: 'no-store',
      redirectAllowlist: [
        {
          origin: 'https://accounts.example.test',
          reason: 'delegated identity provider',
        },
      ],
      reservedHeaders: ['Location'],
    });
    expect(declaration.auth).toEqual({
      justification: 'public machine callback',
      kind: 'none',
    });
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(Object.isFrozen(declaration.response)).toBe(true);
    expect(Object.isFrozen(declaration.response.redirectAllowlist?.[0])).toBe(true);
    expect(Object.isFrozen(declaration.response.reservedHeaders)).toBe(true);
    expect(Reflect.set(declaration, 'response', rawTextResponse)).toBe(false);
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
          headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
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
      secret: ENDPOINT_HMAC_SECRET,
    });
    let handlerCalls = 0;
    const inventoryWebhook = endpoint('/webhooks/inventory', {
      auth: { kind: 'verifier', name: verifier.resolved.scheme, verify: verifier },
      csrf: false,
      csrfJustification: 'signed inventory webhook',
      async handler(request) {
        handlerCalls += 1;
        return new Response(await request.text(), {
          headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
          status: 202,
        });
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
            request.headers instanceof Headers &&
            request.headers.get('x-machine-token') === 'accepted',
        ),
      },
      csrf: false,
      csrfJustification: 'custom machine verifier',
      handler: () => new Response('ok'),
      method: 'POST',
      reason: 'custom machine verifier endpoint',
      response: rawTextResponse,
    });

    await expect(
      runEndpointAuth(
        customEndpoint,
        new Request('https://example.test/machine/custom', {
          body: 'payload',
          headers: { 'x-machine-token': 'accepted' },
          method: 'POST',
        }),
      ),
    ).resolves.toBeUndefined();

    const rejected = await runEndpointAuth(
      customEndpoint,
      new Request('https://example.test/machine/custom', {
        body: 'payload',
        headers: { 'x-machine-token': 'bad' },
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

  it('fails closed when a custom endpoint verifier returns a truthy non-boolean result', async () => {
    let handlerCalls = 0;
    const customEndpoint = endpoint('/machine/truthy-verifier', {
      auth: {
        kind: 'custom',
        name: 'truthy-verifier',
        verify: customVerifier('truthy-verifier', async () => ({ ok: false }) as never),
      },
      csrf: false,
      csrfJustification: 'custom machine verifier',
      handler: () => {
        handlerCalls += 1;
        return new Response('leaked');
      },
      method: 'POST',
      reason: 'truthy custom verifier fail-closed regression',
      response: rawTextResponse,
    });

    const request = new Request('https://example.test/machine/truthy-verifier', {
      body: 'payload',
      method: 'POST',
    });
    const authFailure = await runEndpointAuth(customEndpoint, request);
    const rejected = authFailure ?? (await runEndpoint(customEndpoint, request));

    expect(rejected.status).toBe(401);
    expect(await rejected.text()).toBe('Unauthorized');
    expect(handlerCalls).toBe(0);
  });

  it('rejects forged HMAC provenance and dishonest executable auth metadata', async () => {
    const official = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      payload: ({ payload }) => payload,
      secret: OFFICIAL_HMAC_SECRET,
    });
    const forged = { ...official, verify: async () => true } as HmacSignatureVerifier;
    const dishonest = [
      endpoint('/machine/forged-hmac', {
        auth: { kind: 'verifier', name: official.resolved.scheme, verify: forged },
        csrf: false,
        csrfJustification: 'forged verifier regression',
        handler: () => new Response('leaked'),
        method: 'POST',
        reason: 'forged verifier regression',
        response: rawTextResponse,
      }),
      endpoint('/machine/wrong-custom-name', {
        auth: {
          kind: 'custom',
          name: 'audit-name',
          verify: customVerifier('runtime-name', () => true),
        },
        csrf: false,
        csrfJustification: 'dishonest custom metadata regression',
        handler: () => new Response('leaked'),
        method: 'POST',
        reason: 'dishonest custom metadata regression',
        response: rawTextResponse,
      }),
      endpoint('/machine/custom-as-hmac', {
        auth: {
          kind: 'verifier',
          name: 'hmac-sha256:hex',
          verify: customVerifier('allow', () => true),
        },
        csrf: false,
        csrfJustification: 'dishonest verifier-kind regression',
        handler: () => new Response('leaked'),
        method: 'POST',
        reason: 'dishonest verifier-kind regression',
        response: rawTextResponse,
      }),
    ];

    for (const declaration of dishonest) {
      const response = await runEndpointAuth(
        declaration,
        new Request(`https://example.test${declaration.path}`, { body: '{}', method: 'POST' }),
      );
      expect(response?.status).toBe(401);
    }
  });

  it('captures a structural custom verifier method exactly once through Proxy traps', async () => {
    const deny = async () => false;
    const allow = async () => true;
    let verifyReads = 0;
    const verifier = new Proxy(
      {
        kind: 'custom' as const,
        name: 'proxy-custom',
        scheme: 'custom:proxy-custom',
        verify: deny,
      },
      {
        get(target, property, receiver) {
          if (property === 'verify') {
            verifyReads += 1;
            return verifyReads === 1 ? deny : allow;
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const declaration = endpoint('/machine/proxy-custom', {
      auth: { kind: 'custom', name: 'proxy-custom', verify: verifier },
      csrf: false,
      csrfJustification: 'custom verifier snapshot regression',
      handler: () => new Response('leaked'),
      method: 'POST',
      reason: 'custom verifier snapshot regression',
      response: rawTextResponse,
    });

    const response = await runEndpointAuth(
      declaration,
      new Request('https://example.test/machine/proxy-custom', { body: '{}', method: 'POST' }),
    );
    expect(response?.status).toBe(401);
    expect(verifyReads).toBe(1);
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
        return new Response(`sessionless:${await rawRequest.text()}`, {
          headers: { 'Cache-Control': 'no-store' },
        });
      },
      method: 'POST',
      reason: 'external machine caller',
      response: rawTextResponse,
    });

    await expect((await runEndpoint(machineEndpoint, request)).text()).resolves.toBe(
      'sessionless:payload',
    );
  });

  it('neutralizes ambient browser authority so a csrf-exempt handler cannot read the inbound Cookie header (SPEC §9.1, bugz-3 L16)', async () => {
    // bugz-3 L16: a csrf:false endpoint (and every webhook()) skips both the synchronizer
    // token and the Origin floor, so the exemption is sound ONLY if the handler cannot ride
    // ambient browser authority (SPEC.md §9.1: "cookies are not interpreted ... A CSRF
    // exemption is sound only because endpoint/webhook auth does not ride ambient browser
    // authority"). Stripping only req.session left the raw Cookie header readable — the same
    // unsoundness mutations reject at compile time via KV418.
    let seenCookie: string | null = 'unset';
    let seenCookieViaClone: string | null = 'unset';
    let seenAuthorization: string | null = 'unset';
    let seenProxyAuthorization: string | null = 'unset';
    let seenSignature = '';
    const signedWebhook = endpoint('/webhooks/signed', {
      csrf: false,
      csrfJustification: 'signed webhook validates raw body',
      async handler(request) {
        seenCookie = request.headers.get('cookie');
        seenAuthorization = request.headers.get('authorization');
        seenProxyAuthorization = request.headers.get('proxy-authorization');
        // A handler must not be able to recover the cookie via request.clone() either.
        seenCookieViaClone = request.clone().headers.get('cookie');
        seenSignature = request.headers.get('x-signature') ?? '';
        return new Response(await request.text(), {
          headers: { 'Cache-Control': 'no-store' },
          status: 202,
        });
      },
      method: 'POST',
      reason: 'signed webhook raw body dispatch',
      response: rawTextResponse,
    });
    const request = new Request('https://example.test/webhooks/signed', {
      body: '{"event":"ok"}',
      headers: {
        Authorization: 'Basic victim-browser-credential',
        Cookie: 'sid=victim-session-secret',
        'Proxy-Authorization': 'Basic victim-proxy-credential',
        'x-signature': 'sig_abc',
      },
      method: 'POST',
    });

    const response = await runEndpoint(signedWebhook, request);

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe('{"event":"ok"}');
    // The ambient browser Cookie header is gone — directly and across clone() — while the
    // endpoint's explicit machine credential (x-signature) survives untouched.
    expect(seenCookie).toBeNull();
    expect(seenCookieViaClone).toBeNull();
    expect(seenAuthorization).toBeNull();
    expect(seenProxyAuthorization).toBeNull();
    expect(seenSignature).toBe('sig_abc');
  });

  it('preserves browser credentials only for a pinned self-verifying protocol adapter', async () => {
    let seenAuthorization: string | null = null;
    let seenCookie: string | null = null;
    let sawSession = true;
    const protocol = frameworkEndpoint(
      '/auth',
      {
        auth: { kind: 'custom', name: 'framework-auth-adapter' },
        csrf: false,
        csrfJustification: 'adapter verifies OAuth state and session credentials internally',
        handler(request) {
          seenAuthorization = request.headers.get('authorization');
          seenCookie = request.headers.get('cookie');
          sawSession = 'session' in request;
          return new Response('ok', {
            headers: {
              'Cache-Control': 'no-store',
              'Set-Cookie': 'sid=rotated; Path=/; Secure; HttpOnly; SameSite=Lax',
            },
          });
        },
        method: 'GET',
        mount: 'prefix',
        mountJustification: 'adapter owns its callback protocol subtree',
        reason: 'framework self-verifying protocol adapter',
        response: {
          ...rawTextResponse,
          reservedHeaders: ['Set-Cookie'],
        },
      },
      (declaration) => {
        pinEndpointBrowserCredentialDelegation(declaration);
      },
    );
    const request = new Request('https://example.test/auth/callback', {
      headers: {
        Authorization: 'Bearer delegated-token',
        Cookie: 'oauth_state=secret; sid=old',
      },
    });
    Object.defineProperty(request, 'session', {
      configurable: true,
      value: { id: 'ambient-kovo-session' },
    });

    await expect(runEndpointAuth(protocol, request)).resolves.toBeUndefined();
    const response = await runEndpoint(protocol, request);

    expect(seenAuthorization).toBe('Bearer delegated-token');
    expect(seenCookie).toBe('oauth_state=secret; sid=old');
    expect(sawSession).toBe(false);
    expect(response.headers.get('set-cookie')).toContain('sid=rotated');

    const forgedDeclaration = { ...protocol } as typeof protocol;
    const forgedView = endpointRequestWithoutSession(
      new Request('https://example.test/auth/callback', {
        headers: {
          Authorization: 'Bearer forged-token',
          Cookie: 'sid=forged',
        },
      }),
      { declaration: forgedDeclaration, stripAuthorization: true },
    );
    expect(forgedView.headers.get('authorization')).toBeNull();
    expect(forgedView.headers.get('cookie')).toBeNull();

    const preservedView = endpointRequestWithoutSession(request, {
      declaration: protocol,
      stripAuthorization: true,
    });
    const reNeutralizedView = endpointRequestWithoutSession(preservedView, {
      stripAuthorization: true,
    });
    expect(reNeutralizedView.headers.get('authorization')).toBeNull();
    expect(reNeutralizedView.headers.get('cookie')).toBeNull();
  });

  it('requires an executed verifier receipt before a csrf-exempt endpoint emits browser state', async () => {
    const verified = endpoint('/machine/browser-state', {
      auth: {
        kind: 'custom',
        name: 'machine-browser-state',
        verify: customVerifier(
          'machine-browser-state',
          (request) => request.headers.get('x-machine-signature') === 'accepted',
        ),
      },
      csrf: false,
      csrfJustification: 'signed machine request establishes browser state',
      handler: () =>
        new Response('ok', {
          headers: {
            'Cache-Control': 'no-store',
            'Clear-Site-Data': '"cookies"',
            'Set-Cookie': 'sid=machine; Path=/',
          },
        }),
      method: 'POST',
      reason: 'executed endpoint verifier receipt test',
      response: {
        ...rawTextResponse,
        reservedHeaders: ['Clear-Site-Data', 'Set-Cookie'],
      },
    });
    const unverifiedRequest = new Request('https://example.test/machine/browser-state', {
      headers: { 'X-Machine-Signature': 'accepted' },
      method: 'POST',
    });

    await expect(runEndpoint(verified, unverifiedRequest)).rejects.toThrow(
      /Set-Cookie and Clear-Site-Data requires an executable non-ambient verifier/u,
    );

    const verifiedRequest = new Request('https://example.test/machine/browser-state', {
      headers: { 'X-Machine-Signature': 'accepted' },
      method: 'POST',
    });
    await expect(runEndpointAuth(verified, verifiedRequest)).resolves.toBeUndefined();
    await expect(runEndpoint(verified, verifiedRequest)).resolves.toMatchObject({ status: 200 });
  });

  it('blocks browser-state output from a safe method without an executed verifier', async () => {
    const unsafe = endpoint('/read/browser-state', {
      handler: () =>
        new Response('ok', {
          headers: {
            'Clear-Site-Data': '"cookies"',
            'Set-Cookie': 'sid=attacker; Path=/',
          },
        }),
      method: 'GET',
      reason: 'safe-method browser-state negative proof',
      response: {
        ...rawTextResponse,
        reservedHeaders: ['Clear-Site-Data', 'Set-Cookie'],
      },
    });

    await expect(
      runEndpoint(unsafe, new Request('https://example.test/read/browser-state')),
    ).rejects.toThrow(/safe-method endpoint/u);
  });

  it('still blocks csrf-exempt browser-state output after app code hides Headers membership', () => {
    const browserStateResponse = new Response('ok', {
      headers: {
        'Clear-Site-Data': '"cookies"',
        'Set-Cookie': 'sid=attacker; Path=/',
      },
    });
    const unsafe = endpoint('/machine/poisoned-browser-state', {
      csrf: false,
      csrfJustification: 'machine callback must authenticate before browser state',
      handler: () => browserStateResponse,
      method: 'POST',
      reason: 'browser-state intrinsic poisoning regression',
      response: {
        ...rawTextResponse,
        reservedHeaders: ['Clear-Site-Data', 'Set-Cookie'],
      },
    });
    const originalFilter = Array.prototype.filter;
    const originalHeadersHas = Headers.prototype.has;
    let error: unknown;
    try {
      Array.prototype.filter = () => [];
      Headers.prototype.has = () => false;
      assertEndpointResponsePosture(unsafe, browserStateResponse);
    } catch (caught) {
      error = caught;
    } finally {
      Array.prototype.filter = originalFilter;
      Headers.prototype.has = originalHeadersHas;
    }
    expect(String(error)).toMatch(
      /Set-Cookie and Clear-Site-Data requires an executable non-ambient verifier/u,
    );
  });

  it.each([
    { auth: undefined, name: 'missing auth' },
    { auth: { kind: 'custom' as const, name: 'claimed-only' }, name: 'name-only auth' },
  ])('rejects csrf-exempt browser-state output with $name', async ({ auth }) => {
    const unsafe = endpoint('/machine/unsafe-browser-state', {
      ...(auth === undefined ? {} : { auth }),
      csrf: false,
      csrfJustification: 'negative browser-state posture fixture',
      handler: () =>
        new Response('ok', {
          headers: {
            'Clear-Site-Data': '"cookies", "storage"',
            'Set-Cookie': 'sid=attacker; Path=/',
          },
        }),
      method: 'POST',
      reason: 'negative browser-state posture fixture',
      response: {
        ...rawTextResponse,
        reservedHeaders: ['Clear-Site-Data', 'Set-Cookie'],
      },
    });

    if (auth !== undefined) {
      const authFailure = await runEndpointAuth(
        unsafe,
        new Request('https://example.test/machine/unsafe-browser-state', { method: 'POST' }),
      );
      expect(authFailure?.status).toBe(401);
    }

    await expect(
      runEndpoint(
        unsafe,
        new Request('https://example.test/machine/unsafe-browser-state', { method: 'POST' }),
      ),
    ).rejects.toThrow(/executable non-ambient verifier/u);
  });

  it('verifies raw endpoint response posture on every dispatch', async () => {
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
  });

  it('keeps endpoint response posture fail-closed after an app handler poisons Array.push', async () => {
    const nativePush = Array.prototype.push;
    let poisonHits = 0;
    const mismatched = endpoint('/machine/posture-push-poison', {
      csrf: false,
      csrfJustification: 'runtime posture poisoning regression',
      handler: () => {
        Array.prototype.push = function poisonedPosturePush(...values: unknown[]) {
          if (values[0] === 'declared cache=no-store but response lacks Cache-Control: no-store') {
            poisonHits += 1;
            return this.length;
          }
          return Reflect.apply(nativePush, this, values);
        };
        return new Response('{"ok":true}', { headers: { 'Content-Type': 'text/plain' } });
      },
      method: 'POST',
      reason: 'runtime posture poisoning regression',
      response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
    });

    let error: unknown;
    try {
      await runEndpoint(
        mismatched,
        new Request('https://example.test/machine/posture-push-poison', { method: 'POST' }),
      );
    } catch (caught) {
      error = caught;
    } finally {
      Array.prototype.push = nativePush;
    }

    expect(poisonHits).toBe(0);
    expect(String(error)).toMatch(/response posture mismatch/u);
  });

  it('allows honest multi-body response posture declarations', async () => {
    const negotiated = endpoint('/machine/negotiated', {
      csrf: false,
      csrfJustification: 'runtime posture verification test',
      handler: (request) =>
        request.headers.get('accept')?.includes('application/json')
          ? Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
          : new Response('ok', {
              headers: {
                'Cache-Control': 'no-store',
                'Content-Type': 'text/plain; charset=utf-8',
              },
            }),
      method: 'GET',
      reason: 'runtime negotiated response posture test',
      response: { appOwnedSafety: true, body: ['json', 'text'], cache: 'no-store' },
    });

    await expect(
      runEndpoint(
        negotiated,
        new Request('https://example.test/machine/negotiated', {
          headers: { Accept: 'application/json' },
        }),
      ),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      runEndpoint(negotiated, new Request('https://example.test/machine/negotiated')),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('fails endpoint posture verification for cache, body, and content-type drift', async () => {
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
  });

  it('flags reserved raw endpoint response headers unless explicitly declared', async () => {
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
      handler: () =>
        new Response('ok', {
          headers: {
            'Cache-Control': 'no-store',
            'Clear-Site-Data': '"cookies"',
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
        reservedHeaders: [
          'Clear-Site-Data',
          'Content-Security-Policy',
          'Kovo-*',
          'Location',
          'Set-Cookie',
        ],
      },
    });

    await expect(
      runEndpoint(
        declared,
        new Request('https://example.test/machine/reserved/declared', { method: 'POST' }),
      ),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('requires raw endpoint external redirects to be allowlisted with a reason', async () => {
    const undeclared = endpoint('/machine/external-redirect', {
      csrf: false,
      csrfJustification: 'runtime redirect allowlist verification test',
      handler: () =>
        new Response(null, {
          headers: {
            'Cache-Control': 'no-store',
            Location: 'https://accounts.example.test/oauth/start',
          },
          status: 303,
        }),
      method: 'POST',
      reason: 'runtime redirect allowlist verification test',
      response: {
        appOwnedSafety: true,
        body: 'redirect',
        cache: 'no-store',
        reservedHeaders: ['Location'],
      },
    });

    await expect(
      runEndpoint(
        undeclared,
        new Request('https://example.test/machine/external-redirect', { method: 'POST' }),
      ),
    ).rejects.toThrow(/redirect Location must be same-origin/u);

    const declared = endpoint('/machine/external-redirect-declared', {
      csrf: false,
      csrfJustification: 'runtime redirect allowlist verification test',
      handler: () =>
        new Response(null, {
          headers: {
            'Cache-Control': 'no-store',
            Location: 'https://accounts.example.test/oauth/start',
          },
          status: 303,
        }),
      method: 'POST',
      reason: 'runtime redirect allowlist verification test',
      response: {
        appOwnedSafety: true,
        body: 'redirect',
        cache: 'no-store',
        redirectAllowlist: [
          {
            origin: 'https://accounts.example.test',
            reason: 'Delegated OAuth flow redirects through the identity provider',
          },
        ],
        reservedHeaders: ['Location'],
      },
    });

    await expect(
      runEndpoint(
        declared,
        new Request('https://example.test/machine/external-redirect-declared', {
          method: 'POST',
        }),
      ),
    ).resolves.toMatchObject({ status: 303 });
  });

  it.each([undefined, 'development', 'test', 'staging', 'production'] as const)(
    'enforces declared response posture with NODE_ENV=%s for direct and custom runners',
    async (nodeEnvironment) => {
      const previousNodeEnv = process.env.NODE_ENV;
      if (nodeEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvironment;

      const mismatched = endpoint(`/machine/${nodeEnvironment ?? 'unset'}-posture-bad`, {
        csrf: false,
        csrfJustification: 'environment-independent runtime posture verification test',
        handler: () =>
          new Response('{"ok":true}', {
            headers: { 'Cache-Control': 'public', 'Content-Type': 'text/plain' },
          }),
        method: 'POST',
        reason: 'environment-independent runtime posture verification test',
        response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
      });
      const request = new Request(`https://example.test${mismatched.path}`, { method: 'POST' });

      try {
        await expect(runEndpoint(mismatched, request)).rejects.toThrow(
          /response posture mismatch/u,
        );
        expect(() =>
          assertEndpointResponsePostureAndSnapshot(
            mismatched,
            new Response('{"ok":true}', {
              headers: { 'Cache-Control': 'public', 'Content-Type': 'text/plain' },
            }),
            { request },
          ),
        ).toThrow(/response posture mismatch/u);
      } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
      }
    },
  );

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
