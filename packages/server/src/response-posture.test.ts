import { describe, expect, it } from 'vitest';

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
  });
});
