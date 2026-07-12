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
  resolveKovoLifecycleRequest,
} from './response-posture.js';

describe('central response posture finalization', () => {
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

  it('suppresses raw endpoint HEAD bodies without copying streaming success bodies', async () => {
    const raw = new Response('payload', {
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      status: 200,
    });

    expect(finalizeRawWebResponse(raw, { method: 'GET' })).toBe(raw);

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

  it('strips browser Authorization only for stricter csrf-exempt mutation views', () => {
    const request = new Request('https://example.test/_m/machine/run', {
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
