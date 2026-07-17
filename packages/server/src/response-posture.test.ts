import { describe, expect, it } from 'vitest';
import { secret } from '@kovojs/core';

import {
  blessRedirectResponse,
  redirectLocationHeader,
  type ServerResponseBase,
  type WebResponseBody,
} from './response.js';
import {
  endpointRequestWithoutSession,
  finalizeRawWebResponse,
  finalizeServerResponse,
  ResponseHeaderChannelError,
  requestMetadataWithoutAmbientAuthority,
  resolveKovoLifecycleRequest,
} from './response-posture.js';

describe('central response posture finalization', () => {
  // @kovo-security-classifier-corpus response-transport-headers
  it('rejects the transport-owned response-header corpus for structured and raw endpoints', () => {
    const transportOwnedNames = [
      'cOnTeNt-LeNgTh',
      'Connection',
      'Keep-Alive',
      'Proxy-Connection',
      'TE',
      'Trailer',
      'Transfer-Encoding',
      'Upgrade',
      'Proxy-Authenticate',
      'Proxy-Authorization',
      'HTTP2-Settings',
    ] as const;

    for (const name of transportOwnedNames) {
      expect(() =>
        finalizeServerResponse(
          {
            body: 'blocked',
            headers: { [name]: 'attacker-controlled' },
            status: 200,
          },
          { method: 'GET' },
        ),
      ).toThrow(/KV415.*owned by the HTTP adapter/u);

      expect(() =>
        finalizeRawWebResponse(
          new Response('blocked', {
            headers: { [name]: 'attacker-controlled' },
            status: 200,
          }),
          { method: 'GET' },
        ),
      ).toThrow(/KV415.*owned by the HTTP adapter/u);
    }
  });

  it('rejects array-valued Connection metadata before nominated fields can reach an adapter', () => {
    expect(() =>
      finalizeServerResponse(
        {
          body: 'blocked',
          headers: {
            Connection: ['X-Hop', 'keep-alive'],
            'X-Hop': 'attacker-controlled',
          },
          status: 200,
        },
        { method: 'GET' },
      ),
    ).toThrow(/KV415.*field and every header it nominates are rejected/u);
  });

  it('preserves legitimate end-to-end metadata on structured and raw responses', () => {
    const safeHeaders = {
      'Cache-Control': 'public, max-age=60',
      'Content-Disposition': 'attachment; filename="report.txt"',
      ETag: '"report-v1"',
      'Last-Modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
      Vary: 'Accept-Encoding',
    };
    const structured = finalizeServerResponse(
      { body: 'safe', headers: safeHeaders, status: 200 },
      { method: 'GET' },
    );
    const raw = finalizeRawWebResponse(
      new Response('safe', { headers: safeHeaders, status: 200 }),
      { method: 'GET' },
    );

    for (const response of [structured, raw]) {
      expect(response.headers.get('cache-control')).toBe('public, max-age=60');
      expect(response.headers.get('etag')).toBe('"report-v1"');
      expect(response.headers.get('vary')).toBe('Accept-Encoding');
    }
  });

  it('rejects response-header controls through the pinned KV415 classifier', () => {
    const originalCharCodeAt = String.prototype.charCodeAt;
    let observed: unknown;
    try {
      String.prototype.charCodeAt = () => 0x41;
      try {
        finalizeServerResponse(
          {
            body: 'blocked',
            headers: { 'X-Unsafe': 'safe\r\nX-Injected: yes' },
            status: 200,
          },
          { method: 'GET' },
        );
      } catch (error) {
        observed = error;
      }
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
    }

    expect(observed).toBeInstanceOf(ResponseHeaderChannelError);
    expect(String((observed as Error).message)).toMatch(/KV415.*control character/u);
  });

  it('copies byte response bodies through pinned carrier controls', async () => {
    const bytes = new Uint8Array([0x73, 0x61, 0x66, 0x65]);
    const originalSlice = Uint8Array.prototype.slice;
    const originalHasInstance = Object.getOwnPropertyDescriptor(Uint8Array, Symbol.hasInstance);
    let response: Response | undefined;
    try {
      Uint8Array.prototype.slice = () => new Uint8Array([0x65, 0x76, 0x69, 0x6c]);
      Object.defineProperty(Uint8Array, Symbol.hasInstance, {
        configurable: true,
        value: () => false,
      });
      response = finalizeServerResponse(
        { body: bytes, headers: { 'Content-Type': 'text/plain' }, status: 200 },
        { method: 'GET' },
      );
      bytes.fill(0x78);
    } finally {
      Uint8Array.prototype.slice = originalSlice;
      if (originalHasInstance === undefined) delete Uint8Array[Symbol.hasInstance];
      else Object.defineProperty(Uint8Array, Symbol.hasInstance, originalHasInstance);
    }

    await expect(response?.text()).resolves.toBe('safe');
  });
  it('suppresses framework response bodies for HEAD and 304 without dropping headers', async () => {
    const head = finalizeServerResponse(
      {
        body: 'payload',
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/plain; charset=utf-8',
          Vary: 'Cookie',
        },
        status: 200,
      },
      { method: 'HEAD' },
    );

    expect(head.status).toBe(200);
    expect(head.headers.get('cache-control')).toBe('private, no-store');
    expect(head.headers.get('vary')).toBe('Cookie');
    await expect(head.text()).resolves.toBe('');

    const notModified = finalizeServerResponse(
      {
        body: 'must-not-ship',
        headers: { ETag: '"orders-v1"' },
        status: 304,
      },
      { method: 'GET' },
    );

    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('etag')).toBe('"orders-v1"');
    await expect(notModified.text()).resolves.toBe('');
  });

  it('pins raw endpoint response headers before they cross the wire boundary', async () => {
    const raw = new Response('payload', {
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      status: 200,
    });

    const finalized = finalizeRawWebResponse(raw, { method: 'GET' });

    expect(finalized).not.toBe(raw);
    raw.headers.set('Clear-Site-Data', '"cookies"');
    raw.headers.set('Set-Cookie', 'sid=attacker; Path=/');
    expect(finalized.headers.get('clear-site-data')).toBeNull();
    expect(finalized.headers.get('set-cookie')).toBeNull();
    await expect(finalized.text()).resolves.toBe('payload');
  });

  it('suppresses raw endpoint HEAD bodies while preserving finalized headers', async () => {
    const raw = new Response('payload', {
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      status: 200,
    });

    const head = finalizeRawWebResponse(raw, { method: 'HEAD' });

    expect(head).not.toBe(raw);
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    await expect(head.text()).resolves.toBe('');

    const notModified = finalizeRawWebResponse(
      new Response(null, { headers: { ETag: '"raw-v1"' }, status: 304 }),
      { method: 'GET' },
    );

    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('etag')).toBe('"raw-v1"');
    await expect(notModified.text()).resolves.toBe('');
  });

  it('normalizes raw endpoint Set-Cookie headers through the credential cookie floor', async () => {
    const headers = new Headers({ 'Content-Type': 'text/plain; charset=utf-8' });
    headers.append('Set-Cookie', 'sid=abc; Path=/');
    const raw = new Response('payload', { headers, status: 200 });

    const finalized = finalizeRawWebResponse(raw, { method: 'GET' });

    expect(finalized).not.toBe(raw);
    await expect(finalized.text()).resolves.toBe('payload');
    const cookies = finalized.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain('sid=abc');
    expect(cookies[0]).toContain('Path=/');
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');
  });

  it('fails closed before malformed raw endpoint Set-Cookie headers reach the adapter', () => {
    expect(() =>
      finalizeRawWebResponse(
        new Response('payload', {
          headers: { 'Set-Cookie': 'not-a-cookie' },
          status: 200,
        }),
        { method: 'GET' },
      ),
    ).toThrow('forwardSetCookie requires a name=value Set-Cookie');
  });

  it('refuses Secret runtime values in framework response headers with KV435', () => {
    expect(() =>
      finalizeServerResponse(
        {
          body: 'payload',
          headers: { 'X-Token': secret('sk_live_q5_header') as unknown as string },
          status: 200,
        },
        { method: 'GET' },
      ),
    ).toThrow(/KV435 Secret query value reaches the client wire/);
  });

  it('sanitizes raw endpoint redirect Location headers without dropping safe bodies', async () => {
    const openRedirect = finalizeRawWebResponse(
      new Response(null, {
        headers: { Location: 'https://evil.example/phish' },
        status: 303,
      }),
      { method: 'GET' },
    );

    expect(openRedirect.status).toBe(303);
    expect(openRedirect.headers.get('location')).toBe('/');

    const sameOriginRedirect = finalizeRawWebResponse(
      new Response('redirect body', {
        headers: { Location: '/account?tab=orders#paid' },
        status: 307,
      }),
      { method: 'GET' },
    );

    expect(sameOriginRedirect.headers.get('location')).toBe('/account?tab=orders#paid');
    await expect(sameOriginRedirect.text()).resolves.toBe('redirect body');
  });

  it('allows raw endpoint redirect Location headers only for declared external origins', async () => {
    const allowed = finalizeRawWebResponse(
      new Response(null, {
        headers: { Location: 'https://accounts.example.test/oauth/start' },
        status: 303,
      }),
      { method: 'GET' },
      {
        redirectAllowlist: [
          {
            origin: 'https://accounts.example.test',
            reason: 'Delegated OAuth flow redirects through the identity provider',
          },
        ],
      },
    );

    expect(allowed.headers.get('location')).toBe('https://accounts.example.test/oauth/start');

    const denied = finalizeRawWebResponse(
      new Response(null, {
        headers: { Location: 'https://evil.example/phish' },
        status: 303,
      }),
      { method: 'GET' },
      {
        redirectAllowlist: [
          {
            origin: 'https://accounts.example.test',
            reason: 'Delegated OAuth flow redirects through the identity provider',
          },
        ],
      },
    );

    expect(denied.headers.get('location')).toBe('/');
  });

  it('keeps redirect location sanitization in the shared framework finalizer', () => {
    const blessed = blessRedirectResponse({
      body: null,
      headers: { Location: redirectLocationHeader('/login?next=%2Faccount') },
      status: 303,
    } satisfies ServerResponseBase<WebResponseBody, Record<string, string>>);

    expect(finalizeServerResponse(blessed, { method: 'GET' }).headers.get('location')).toBe(
      '/login?next=%2Faccount',
    );
    expect(
      finalizeServerResponse(
        {
          body: null,
          headers: { Location: 'https://evil.example/' },
          status: 303,
        },
        { method: 'GET' },
      ).headers.get('location'),
    ).toBe('/');
  });

  it('refuses Secret runtime values in redirect Location headers with KV435', () => {
    expect(() =>
      finalizeServerResponse(
        {
          body: null,
          headers: { Location: secret('/account') as unknown as string },
          status: 303,
        },
        { method: 'GET' },
      ),
    ).toThrow(/KV435 Secret query value reaches the client wire/);
  });

  it('strips ambient browser authority from endpoint request views and clones', () => {
    const request = new Request('https://example.test/webhook', {
      headers: {
        Authorization: 'Bearer machine-token',
        Cookie: 'sid=victim',
        'X-Signature': 'sig_123',
      },
      method: 'POST',
    });
    Object.defineProperty(request, 'session', {
      configurable: true,
      value: { user: { id: 'u1' } },
    });

    const endpointRequest = endpointRequestWithoutSession(request);

    expect('session' in endpointRequest).toBe(false);
    expect((endpointRequest as unknown as { session?: unknown }).session).toBeUndefined();
    expect(endpointRequest.headers.get('cookie')).toBeNull();
    expect(endpointRequest.headers.get('authorization')).toBe('Bearer machine-token');
    expect(endpointRequest.headers.get('x-signature')).toBe('sig_123');
    expect(endpointRequest.clone().headers.get('cookie')).toBeNull();
    expect(endpointRequest).not.toBe(request);
    expect('session' in endpointRequest).toBe(false);
  });

  it('strips browser Authorization and Proxy-Authorization from strict csrf-exempt views', () => {
    const request = new Request('https://example.test/machine/run', {
      headers: {
        Authorization: 'Basic victim-browser-credential',
        'Cf-Connecting-Ip': '203.0.113.10',
        Forwarded: 'for=203.0.113.10',
        'Proxy-Authorization': 'Basic victim-proxy-credential',
        'Remote-User': 'victim',
        'X-Auth-Request-User': 'victim',
        'X-Forwarded-For': '203.0.113.10',
        'X-Machine-Signature': 'kept',
      },
    });

    const mutationRequest = endpointRequestWithoutSession(request, {
      stripAuthorization: true,
    });

    expect(mutationRequest.headers.get('authorization')).toBeNull();
    expect(mutationRequest.headers.get('cf-connecting-ip')).toBeNull();
    expect(mutationRequest.headers.get('forwarded')).toBeNull();
    expect(mutationRequest.headers.get('proxy-authorization')).toBeNull();
    expect(mutationRequest.headers.get('remote-user')).toBeNull();
    expect(mutationRequest.headers.get('x-auth-request-user')).toBeNull();
    expect(mutationRequest.headers.get('x-forwarded-for')).toBeNull();
    expect(mutationRequest.headers.get('x-machine-signature')).toBe('kept');
    expect(mutationRequest.clone().headers.get('authorization')).toBeNull();
    expect(mutationRequest.clone().headers.get('proxy-authorization')).toBeNull();
  });

  it('exposes only value-free URL and client-IP metadata to predispatch callbacks', () => {
    const metadata = requestMetadataWithoutAmbientAuthority(
      new Request('https://example.test/_m/run?token=QUERY_SECRET&key=duplicate', {
        body: 'BODY_SECRET',
        headers: {
          'Cf-Connecting-Ip': '203.0.113.8',
          'Content-Type': 'text/plain',
          Cookie: 'sid=COOKIE_SECRET',
          'Kovo-Csrf': 'CSRF_SECRET',
          'Kovo-Form-Key': 'FORM_KEY_SECRET',
          'Kovo-Idem': 'IDEM_SECRET',
          'Kovo-Session': 'SESSION_SECRET',
          'Webhook-Secret': 'WEBHOOK_SECRET',
          'X-Kovo-Api-Key': 'API_KEY_SECRET',
          'X-Machine-Signature': 'SIGNATURE_SECRET',
          'X-Machine-Token': 'MACHINE_TOKEN_SECRET',
        },
        method: 'POST',
      }),
    );

    expect(metadata.url).toBe('https://example.test/_m/run?token&key');
    expect(metadata.body).toBeNull();
    expect(metadata.headers.get('cf-connecting-ip')).toBe('203.0.113.8');
    expect(metadata.headers.get('content-type')).toBe('text/plain');
    for (const name of [
      'cookie',
      'kovo-csrf',
      'kovo-form-key',
      'kovo-idem',
      'kovo-session',
      'webhook-secret',
      'x-kovo-api-key',
      'x-machine-signature',
      'x-machine-token',
    ]) {
      expect(metadata.headers.get(name), name).toBeNull();
    }
    expect(JSON.stringify([...metadata.headers])).not.toContain('SECRET');
  });

  it('preserves framework peer identity under late String.trim poison', () => {
    const request = new Request('https://example.test/_m/run');
    Object.defineProperty(request, '__kovoPeerAddress', {
      configurable: true,
      enumerable: false,
      value: ' 203.0.113.42 ',
      writable: false,
    });
    const originalTrim = String.prototype.trim;
    let metadata: Request | undefined;
    try {
      String.prototype.trim = () => '';
      metadata = requestMetadataWithoutAmbientAuthority(request);
    } finally {
      String.prototype.trim = originalTrim;
    }

    expect(Object.getOwnPropertyDescriptor(metadata, '__kovoPeerAddress')).toMatchObject({
      enumerable: false,
      value: '203.0.113.42',
    });
  });

  it('mirrors abort timing without exposing caller-controlled abort reasons', () => {
    const immediate = new AbortController();
    const immediateSecret = { headers: new Headers({ Cookie: 'sid=victim' }) };
    immediate.abort(immediateSecret);
    const alreadyAborted = endpointRequestWithoutSession(
      new Request('https://example.test/webhook', { signal: immediate.signal }),
    );

    expect(alreadyAborted.signal.aborted).toBe(true);
    expect(alreadyAborted.signal.reason).not.toBe(immediateSecret);
    expect(String(alreadyAborted.signal.reason)).not.toContain('sid=victim');

    const later = new AbortController();
    const neutral = endpointRequestWithoutSession(
      new Request('https://example.test/webhook', { signal: later.signal }),
    );
    const neutralClone = neutral.clone();
    const laterSecret = { token: 'LATE_ABORT_SECRET' };
    expect(neutral.signal.aborted).toBe(false);

    later.abort(laterSecret);

    expect(neutral.signal.aborted).toBe(true);
    expect(neutralClone.signal.aborted).toBe(true);
    expect(neutral.signal.reason).not.toBe(laterSecret);
    expect(String(neutral.signal.reason)).not.toContain('LATE_ABORT_SECRET');
  });

  it('drops raw Request accessors and keeps later accessors and methods bound to the neutral copy', () => {
    const request = new Request('https://example.test/webhook', {
      headers: { Cookie: 'sid=victim', 'X-Signature': 'sig_123' },
    });
    Object.defineProperties(request, {
      capture: {
        configurable: true,
        get(this: Request) {
          return this.headers.get('cookie');
        },
      },
      captureMethod: {
        configurable: true,
        value(this: Request) {
          return this.headers.get('cookie');
        },
      },
    });

    const endpointRequest = endpointRequestWithoutSession(request) as Request & {
      capture?: string | null;
      captureMethod?: () => string | null;
    };
    expect('capture' in endpointRequest).toBe(false);
    expect('captureMethod' in endpointRequest).toBe(false);

    Object.defineProperties(endpointRequest, {
      capture: {
        configurable: true,
        get(this: Request) {
          return this.headers.get('cookie');
        },
      },
      captureMethod: {
        configurable: true,
        value(this: Request) {
          return this.headers.get('cookie');
        },
      },
    });
    expect(Reflect.get(endpointRequest, 'capture')).toBeNull();
    expect(endpointRequest.captureMethod?.()).toBeNull();

    const prototype = Object.create(Request.prototype, {
      prototypeCapture: {
        configurable: true,
        get(this: Request) {
          return this.headers.get('cookie');
        },
      },
    }) as Request & { prototypeCapture?: string | null };
    Object.setPrototypeOf(endpointRequest, prototype);
    expect(Reflect.get(endpointRequest, 'prototypeCapture')).toBeNull();
    expect(request.headers.get('cookie')).toBe('sid=victim');
  });

  it('tees request bodies while producing the authority-neutral copy', async () => {
    const request = new Request('https://example.test/webhook', {
      body: 'signed payload',
      headers: { Cookie: 'sid=victim', 'Content-Type': 'text/plain' },
      method: 'POST',
    });

    const endpointRequest = endpointRequestWithoutSession(request);

    await expect(endpointRequest.text()).resolves.toBe('signed payload');
    await expect(request.text()).resolves.toBe('signed payload');
  });

  it('enforces per-surface lifecycle capabilities instead of treating surface as pass-through', async () => {
    const db = {
      insert: () => 'wrote',
      select: () => 'read',
    };

    const documentRequest = await resolveKovoLifecycleRequest(
      new Request('https://example.test/account'),
      {
        db: () => db,
        sessionProvider: () => ({ user: { id: 'u1' } }),
        surface: 'document',
      },
    );

    expect(documentRequest.session).toEqual({ user: { id: 'u1' } });
    expect(documentRequest.db.select()).toBe('read');
    expect(() => documentRequest.db.insert()).toThrow(
      /framework read-only DB capability proxy blocked db\.insert|cannot insert/,
    );

    const mutationRequest = await resolveKovoLifecycleRequest(
      new Request('https://example.test/_m/cart/add', { method: 'POST' }),
      {
        csrf: { mode: 'protected' },
        db: () => db,
        idempotency: { mode: 'replay-store' },
        sessionProvider: () => ({ user: { id: 'u1' } }),
        surface: 'mutation',
      },
    );

    expect(mutationRequest.session).toEqual({ user: { id: 'u1' } });
    expect(mutationRequest.db.insert()).toBe('wrote');
  });

  it('strips endpoint and system lifecycle requests of app authority', async () => {
    const request = new Request('https://example.test/status', {
      headers: { Cookie: 'sid=victim' },
    });
    Object.defineProperty(request, 'session', {
      configurable: true,
      value: { user: { id: 'u1' } },
    });

    const endpointRequest = await resolveKovoLifecycleRequest(request, {
      clientIp: () => '192.0.2.10',
      surface: 'endpoint',
    });
    expect('session' in endpointRequest).toBe(false);
    expect(endpointRequest.headers.get('cookie')).toBeNull();
    expect((endpointRequest as unknown as { clientIp?: string }).clientIp).toBe('192.0.2.10');

    const systemRequest = await resolveKovoLifecycleRequest(request, { surface: 'system' });
    expect('session' in systemRequest).toBe(false);
    expect(systemRequest.headers.get('cookie')).toBeNull();
    expect('db' in systemRequest).toBe(false);
  });

  it('fails closed when a lifecycle surface carries an unused pass-through option', async () => {
    await expect(
      resolveKovoLifecycleRequest(new Request('https://example.test/_q/cart'), {
        currentUrl: '/cart',
        surface: 'query',
      } as never),
    ).rejects.toThrow('Lifecycle surface "query" does not accept option "currentUrl"');

    await expect(
      resolveKovoLifecycleRequest(new Request('https://example.test/internal'), {
        surface: 'future',
      } as never),
    ).rejects.toThrow('Unknown lifecycle surface "future"');
  });
});
