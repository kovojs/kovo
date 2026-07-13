import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@kovojs/core/internal/storage';
import { setRuntimeSinkSecurityEventHandler } from '@kovojs/core/internal/sink-policy';

import { renderRouteDocumentResponse } from './document-core.js';
import {
  appendResponseHeader,
  blessRedirectResponse,
  drainUnsafeInlineFacts,
  isHeaderSource,
  mergeResponseHeaders,
  readHeader,
  redirectLocationHeader,
  respond,
  routeOutcomeResponse,
  routeResponseToDocumentResponse,
  routeResponseToWebResponse,
  serverResponseToWebResponse,
  unsafeInline,
  retryAfterHeaders,
  type RoutePageResponse,
} from './response.js';

describe('server response adapters', () => {
  it('commits Set-Cookie without inherited credential setter dispatch', () => {
    const headers: Record<string, string | string[]> = {};
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'Set-Cookie');
    let setterCalls = 0;
    try {
      Object.defineProperty(Object.prototype, 'Set-Cookie', {
        configurable: true,
        set() {
          setterCalls += 1;
        },
      });
      appendResponseHeader(headers, 'Set-Cookie', 'sid=reviewed; Path=/; HttpOnly');
    } finally {
      if (previous === undefined) {
        delete (Object.prototype as { 'Set-Cookie'?: unknown })['Set-Cookie'];
      } else {
        Object.defineProperty(Object.prototype, 'Set-Cookie', previous);
      }
    }

    expect(setterCalls).toBe(0);
    expect(Object.getOwnPropertyDescriptor(headers, 'Set-Cookie')?.value).toEqual([
      'sid=reviewed; Path=/; HttpOnly',
    ]);
  });

  it('suppresses route response bodies for HEAD requests', async () => {
    const response = routeResponseToWebResponse(
      {
        body: '<main>ok</main>',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      },
      { method: 'HEAD' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toBe('');
  });

  it('adapts typed-array route bodies without leaking unused buffer bytes', async () => {
    const bytes = new TextEncoder().encode('xxpayloadyy');
    const body = bytes.subarray(2, 9);

    const response = routeResponseToWebResponse(
      {
        body,
        headers: { 'Content-Type': 'application/octet-stream' },
        status: 200,
      },
      { method: 'GET' },
    );

    await expect(response.text()).resolves.toBe('payload');
  });

  it('preserves repeated server response headers when adapting to web Responses', async () => {
    const response = serverResponseToWebResponse(
      {
        body: 'created',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Set-Cookie': ['session=s1; Path=/', 'csrf=c1; Path=/'],
        },
        status: 200,
      },
      { method: 'GET' },
    );

    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect((response.headers as Headers & { getSetCookie(): string[] }).getSetCookie()).toEqual([
      'session=s1; Path=/',
      'csrf=c1; Path=/',
    ]);
    await expect(response.text()).resolves.toBe('created');
  });

  it('merges response header bags without collapsing repeated Set-Cookie values', () => {
    const headers = mergeResponseHeaders(
      {
        'Cache-Control': 'private, no-store',
        'Set-Cookie': 'session=s1; Path=/',
      },
      retryAfterHeaders({ retryAfter: 7 }),
      {
        'Content-Type': 'text/plain; charset=utf-8',
        'set-cookie': ['csrf=c1; Path=/', 'pref=p1; Path=/'],
      },
    );

    expect(headers).toEqual({
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'Retry-After': '7',
      'Set-Cookie': ['session=s1; Path=/', 'csrf=c1; Path=/', 'pref=p1; Path=/'],
    });
  });

  it('emits safe custom response headers at the web response boundary', () => {
    const response = serverResponseToWebResponse(
      {
        body: 'ok',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Kovo-Header-Proof': 'safe-header-value',
        },
        status: 200,
      },
      { method: 'GET' },
    );

    expect(response.headers.get('x-kovo-header-proof')).toBe('safe-header-value');
  });

  it('fails closed with KV415 before unsafe response header values reach the platform adapter', () => {
    expect(() =>
      serverResponseToWebResponse(
        {
          body: 'unsafe',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Kovo-Header-Proof': 'unsafe\r\nSet-Cookie: c2=owned',
          },
          status: 200,
        },
        { method: 'GET' },
      ),
    ).toThrow(/KV415/);
  });

  it('fails closed with KV415 before unsafe response header names reach the platform adapter', () => {
    expect(() =>
      serverResponseToWebResponse(
        {
          body: 'unsafe',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X Kovo Header Proof': 'unsafe',
          },
          status: 200,
        },
        { method: 'GET' },
      ),
    ).toThrow(/KV415/);
  });

  it('suppresses shared server response bodies for HEAD requests', async () => {
    const response = serverResponseToWebResponse(
      {
        body: 'created',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status: 200,
      },
      { method: 'HEAD' },
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
  });

  it('suppresses shared server response bodies for 304 responses', async () => {
    const response = serverResponseToWebResponse(
      {
        body: '',
        headers: { ETag: '"orders-v1"' },
        status: 304,
      },
      { method: 'GET' },
    );

    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('"orders-v1"');
    await expect(response.text()).resolves.toBe('');
  });

  it('preserves cache and security headers on file ETag 304 responses', async () => {
    const routeResponse = routeOutcomeResponse(
      respond.file('orders', {
        contentType: 'text/plain; charset=utf-8',
        etag: '"orders-v1"',
        filename: 'orders.txt',
        headers: {
          'Cache-Control': 'public, max-age=60',
          'Content-Security-Policy': "default-src 'none'",
          'X-Download-Options': 'noopen',
        },
      }),
      { headers: { 'If-None-Match': '"orders-v1"' }, method: 'GET' },
    );
    const response = routeResponseToWebResponse(routeResponse, { method: 'GET' });

    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('"orders-v1"');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-download-options')).toBe('noopen');
    await expect(response.text()).resolves.toBe('');
  });

  it('allows blessed same-origin redirect Location headers at the web response boundary', () => {
    const response = serverResponseToWebResponse(
      blessRedirectResponse({
        body: '',
        headers: { Location: redirectLocationHeader('/account?tab=orders#paid') },
        status: 303,
      }),
      { method: 'GET' },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account?tab=orders#paid');
  });

  it('does not accept structurally copied redirect responses as blessed witnesses', () => {
    const events: unknown[] = [];
    const blessed = blessRedirectResponse({
      body: '',
      headers: { Location: redirectLocationHeader('/account') },
      status: 303,
    });
    const copied = { ...blessed, headers: { ...blessed.headers } };
    const restore = setRuntimeSinkSecurityEventHandler((event) => events.push(event));

    try {
      const response = serverResponseToWebResponse(copied, { method: 'GET' });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'neutralize',
        code: 'KV236',
        family: 'header',
        reason: '3xx Location headers must be minted by the framework redirect-location sink',
        sink: 'Location',
      });
    } finally {
      restore();
    }
  });

  it('neutralizes unsafe blessed redirect Location targets before the web boundary', () => {
    for (const target of [
      'https://evil.example/phish',
      '//evil.example/phish',
      '/\\evil.example/phish',
      '/account\nSet-Cookie:owned=true',
    ]) {
      const response = serverResponseToWebResponse(
        blessRedirectResponse({
          body: '',
          headers: { Location: redirectLocationHeader(target) },
          status: 303,
        }),
        { method: 'GET' },
      );

      expect(response.headers.get('location')).toBe('/');
    }
  });

  it('allows explicitly allowlisted cross-origin redirect Location targets', () => {
    expect(
      redirectLocationHeader('https://accounts.example.test/oauth/callback?state=s1', {
        allowlist: [
          {
            origin: 'https://accounts.example.test',
            reason: 'OAuth provider callback redirects after delegated sign-in',
          },
        ],
      }),
    ).toBe('https://accounts.example.test/oauth/callback?state=s1');

    expect(
      redirectLocationHeader('https://evil.example/phish', {
        allowlist: [
          {
            origin: 'https://accounts.example.test',
            reason: 'OAuth provider callback redirects after delegated sign-in',
          },
        ],
      }),
    ).toBe('/');
  });

  it('rejects redirect Location allowlist entries without an audit rationale', () => {
    expect(() =>
      redirectLocationHeader('https://accounts.example.test/oauth/callback', {
        allowlist: [{ origin: 'https://accounts.example.test', reason: ' ' }],
      }),
    ).toThrow(/non-empty audit reason/);
  });

  it('revalidates mutable blessed redirect Location headers at the final sink', () => {
    const response = blessRedirectResponse({
      body: '',
      headers: { Location: redirectLocationHeader('/account') },
      status: 303,
    });
    response.headers.Location = 'https://evil.example/phish\r\nSet-Cookie: c2=owned';

    const finalized = serverResponseToWebResponse(response, { method: 'GET' });

    expect(finalized.headers.get('location')).toBe('/');
    expect((finalized.headers as Headers & { getSetCookie(): string[] }).getSetCookie()).toEqual(
      [],
    );
  });

  it('fails closed for unblessed redirect Location headers at the web response boundary', () => {
    const events: unknown[] = [];
    const restore = setRuntimeSinkSecurityEventHandler((event) => events.push(event));
    try {
      const response = serverResponseToWebResponse(
        {
          body: '',
          headers: { Location: '/admin' },
          status: 303,
        },
        { method: 'GET' },
      );

      expect(response.headers.get('location')).toBe('/');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'neutralize',
        code: 'KV236',
        family: 'header',
        sink: 'Location',
      });
    } finally {
      restore();
    }
  });

  it('normalizes ArrayBuffer bodies before document wrapping', () => {
    const source = new TextEncoder().encode('page').buffer;
    const response: RoutePageResponse = {
      body: source,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    };

    const documentResponse = routeResponseToDocumentResponse(response);

    expect(documentResponse.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(documentResponse.body as Uint8Array)).toBe('page');
  });

  it('normalizes ArrayBuffer bodies through pinned carrier constructors', () => {
    const NativeArrayBuffer = globalThis.ArrayBuffer;
    const NativeUint8Array = globalThis.Uint8Array;
    const source = new TextEncoder().encode('page').buffer;
    const response: RoutePageResponse = {
      body: source,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    };

    class PoisonArrayBuffer {
      static [Symbol.hasInstance](): boolean {
        throw new Error('ambient ArrayBuffer classifier reached');
      }
    }
    class PoisonUint8Array {
      constructor() {
        throw new Error('ambient Uint8Array constructor reached');
      }
    }

    let documentResponse: ReturnType<typeof routeResponseToDocumentResponse> | undefined;
    globalThis.ArrayBuffer = PoisonArrayBuffer as unknown as ArrayBufferConstructor;
    globalThis.Uint8Array = PoisonUint8Array as unknown as Uint8ArrayConstructor;
    try {
      documentResponse = routeResponseToDocumentResponse(response);
    } finally {
      globalThis.ArrayBuffer = NativeArrayBuffer;
      globalThis.Uint8Array = NativeUint8Array;
    }

    expect(documentResponse?.body).toBeInstanceOf(NativeUint8Array);
    expect(new TextDecoder().decode(documentResponse?.body as Uint8Array)).toBe('page');
  });

  it('preserves blessed redirect Location headers through document wrapping', () => {
    const documentResponse = routeResponseToDocumentResponse(
      blessRedirectResponse({
        body: '',
        headers: { Location: redirectLocationHeader('/login?next=%2F') },
        status: 303,
      }),
    );
    const response = serverResponseToWebResponse(documentResponse, { method: 'GET' });

    expect(response.headers.get('location')).toBe('/login?next=%2F');
  });

  // Security finding M1: file/stream responses must default to nosniff so the
  // browser does not sniff a sniffable/scriptable body type.
  it('defaults file responses to X-Content-Type-Options: nosniff', () => {
    const response = routeOutcomeResponse(
      respond.file('%PDF-1.7', { contentType: 'application/pdf' }),
      { method: 'GET' },
    );

    expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('defaults stream responses to X-Content-Type-Options: nosniff', () => {
    const response = routeOutcomeResponse(
      respond.stream('any attachment body', { contentType: 'text/plain' }),
      { method: 'GET' },
    );

    expect(response.headers['Content-Disposition']).toBe('attachment');
    expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('does not document-wrap text/html file or stream route outcomes', () => {
    for (const outcome of [
      respond.file('<h1>Report</h1>', {
        contentType: 'text/html; charset=utf-8',
        filename: 'report.html',
      }),
      respond.stream('<h1>Report</h1>', {
        contentType: 'text/html; charset=utf-8',
      }),
    ]) {
      const response = renderRouteDocumentResponse(
        routeResponseToDocumentResponse(routeOutcomeResponse(outcome, { method: 'GET' })),
        { buildToken: 'build-test' },
      );

      expect(response.body).toBe('<h1>Report</h1>');
      expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(response.headers['Content-Disposition']).toMatch(/^attachment/u);
      expect(response.headers['Content-Security-Policy']).toBeUndefined();
      expect(String(response.body)).not.toContain('<!doctype html>');
      expect(String(response.body)).not.toContain('<script');
    }
  });

  // KV428 (SPEC §6.6/§9.1): the live inline-XSS hole — `respond.stream({disposition:'inline'})`
  // serving an attacker SVG/HTML inline — is now REFUSED at the sink (the runtime fail-closed floor).
  it('refuses to serve an inline SVG/HTML body (KV428)', () => {
    expect(() =>
      respond.stream('<svg onload="alert(1)"/>', {
        contentType: 'image/svg+xml',
        disposition: 'inline',
      }),
    ).toThrow(/KV428/u);
    expect(() =>
      respond.stream('<!doctype html><script>x</script>', {
        contentType: 'text/html',
        disposition: 'inline',
      }),
    ).toThrow(/KV428/u);
  });

  // KV428 positive: a real raster image still renders inline, with the SNIFFED content type (server
  // truth) regardless of what the caller declared.
  it('serves a real PNG inline with the sniffed content type (KV428)', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2]);
    const response = routeOutcomeResponse(
      // Caller lies "text/html"; the sniffer overrides it to image/png and allows inline.
      respond.stream(png, { contentType: 'text/html', disposition: 'inline' }),
      { method: 'GET' },
    );

    expect(response.headers['Content-Type']).toBe('image/png');
    expect(response.headers['Content-Disposition']).toBe('inline');
    expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  // KV428: an un-bufferable stream cannot be sniffed, so inline requires an opaque audited receipt
  // (the application re-encode/rasterize attestation); without it the runtime refuses.
  it('requires unsafeInline for an inline un-bufferable stream (KV428)', () => {
    drainUnsafeInlineFacts();
    const body = new ReadableStream<Uint8Array>();
    expect(() => respond.stream(body, { contentType: 'image/png', disposition: 'inline' })).toThrow(
      /KV428/u,
    );

    const ok = respond.stream(body, {
      contentType: 'image/png',
      disposition: 'inline',
      unsafeInline: unsafeInline('framework-rasterized image stream'),
    });
    expect(ok.contentDisposition).toBe('inline');
    expect(drainUnsafeInlineFacts()).toEqual([
      { justification: 'framework-rasterized image stream' },
    ]);
    expect(() => unsafeInline('forged\nCAPABILITY kind=trusted')).toThrow(/control characters/u);
  });

  it('does not treat a structural verifiedSafe flag as an inline-safety receipt', () => {
    expect(() =>
      respond.stream(new ReadableStream<Uint8Array>(), {
        contentType: 'image/svg+xml',
        disposition: 'inline',
        verifiedSafe: true,
      } as never),
    ).toThrow(/KV428/u);
  });

  it('does not let poisoned byte globals forge an inline stream sniff result (KV428)', () => {
    const NativeArrayBuffer = globalThis.ArrayBuffer;
    const NativeUint8Array = globalThis.Uint8Array;
    const body = new ReadableStream<Uint8Array>();
    const forgedPng = new NativeUint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
    ]);

    class PoisonArrayBuffer {
      static [Symbol.hasInstance](value: unknown): boolean {
        return value === body;
      }
    }
    const PoisonUint8Array = function () {
      return forgedPng;
    } as unknown as Uint8ArrayConstructor;

    globalThis.ArrayBuffer = PoisonArrayBuffer as unknown as ArrayBufferConstructor;
    globalThis.Uint8Array = PoisonUint8Array;
    try {
      expect(() =>
        respond.stream(body, { contentType: 'text/html', disposition: 'inline' }),
      ).toThrow(/KV428/u);
    } finally {
      globalThis.ArrayBuffer = NativeArrayBuffer;
      globalThis.Uint8Array = NativeUint8Array;
    }
  });

  it('does not let file header maps override reserved safety headers', () => {
    const response = routeOutcomeResponse(
      respond.file('payload', {
        contentType: 'text/plain',
        etag: '"safe"',
        filename: 'safe.txt',
        headers: {
          'Content-Disposition': 'inline',
          'Content-Type': 'image/svg+xml',
          ETag: '"evil"',
          'Set-Cookie': 'session=evil',
          'X-Audit': 'kept',
          'x-content-type-options': 'custom',
        },
      }),
      { method: 'GET' },
    );

    expect(response.headers['Content-Disposition']).toBe('attachment; filename="safe.txt"');
    expect(response.headers['Content-Type']).toBe('text/plain');
    expect(response.headers.ETag).toBe('"safe"');
    expect(response.headers['Set-Cookie']).toBeUndefined();
    expect(response.headers['X-Audit']).toBe('kept');
    expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(response.headers['x-content-type-options']).toBeUndefined();
  });

  // KV428: respond.storedFile takes a bare string key (no compile-visible verification), so it is
  // the runtime sidecar-marker path — defaults to attachment + nosniff + sniffed type, and refuses
  // inline for non-passive bytes.
  it('serves a stored file as attachment with a sniffed content type (KV428)', async () => {
    const storage = createMemoryStorage();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]);
    await storage.put('avatars/k', png, { contentType: 'text/html' }); // stored type is a lie.

    const outcome = await respond.storedFile(storage, 'avatars/k', { filename: 'a.png' });
    expect(outcome?.contentType).toBe('image/png'); // server truth, not the stored "text/html".
    expect(outcome?.contentDisposition).toBe('attachment; filename="a.png"');

    expect(await respond.storedFile(storage, 'missing')).toBeUndefined();
  });

  it('uses stored filename metadata by default for stored file downloads', async () => {
    const storage = createMemoryStorage();
    await storage.put('uploads/note', 'note', {
      contentType: 'text/plain',
      metadata: { filename: 'note.txt' },
    });

    const outcome = await respond.storedFile(storage, 'uploads/note');
    expect(outcome?.contentDisposition).toBe('attachment; filename="note.txt"');

    const overridden = await respond.storedFile(storage, 'uploads/note', {
      filename: 'download.txt',
    });
    expect(overridden?.contentDisposition).toBe('attachment; filename="download.txt"');
  });

  it('normalizes control characters before serializing Content-Disposition filenames', async () => {
    const storage = createMemoryStorage();
    await storage.put('uploads/note', 'note', {
      contentType: 'text/plain',
      metadata: { filename: 'note.txt\r\nX-Kovo-Dogfood: injected' },
    });

    const outcome = await respond.storedFile(storage, 'uploads/note');
    expect(outcome?.contentDisposition).toBe(
      'attachment; filename="note.txt__X-Kovo-Dogfood: injected"',
    );

    const explicit = respond.file('payload', {
      contentType: 'text/plain',
      filename: 'a\r\nb.txt',
    });
    expect(explicit.contentDisposition).toBe('attachment; filename="a__b.txt"');
  });

  it('refuses to serve a stored SVG/HTML object inline (KV428)', async () => {
    const storage = createMemoryStorage();
    await storage.put('uploads/evil', new TextEncoder().encode('<svg onload="x"/>'), {
      contentType: 'image/svg+xml',
    });

    await expect(
      respond.storedFile(storage, 'uploads/evil', { disposition: 'inline' }),
    ).rejects.toThrow(/KV428/u);
  });

  it('rejects accessor-backed storage results before the inline sniffer can observe different bytes', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const svg = new TextEncoder().encode('<svg onload="x"/>');
    let bodyReads = 0;
    const storage = {
      async get() {
        const result = { key: 'uploads/swap' } as { body?: Uint8Array; key: string };
        Object.defineProperty(result, 'body', {
          get() {
            bodyReads += 1;
            return bodyReads === 1 ? png : svg;
          },
        });
        return result as { body: Uint8Array; key: string };
      },
      async stat() {
        return undefined;
      },
      async stream() {
        return undefined;
      },
    };

    await expect(
      respond.storedFile(storage, 'uploads/swap', { disposition: 'inline' }),
    ).rejects.toThrow(/body must be an own data property/u);
    expect(bodyReads).toBe(0);
  });

  it('accepts concrete header sources without treating arbitrary objects as headers', () => {
    expect(isHeaderSource(new Headers({ 'Content-Type': 'text/html' }))).toBe(true);
    expect(isHeaderSource(new Map([['Content-Type', 'text/html']]))).toBe(true);
    expect(isHeaderSource({ 'Content-Type': 'text/html', Vary: ['Accept'] })).toBe(true);

    expect(isHeaderSource({ status: 200 })).toBe(false);
    expect(isHeaderSource(['Content-Type', 'text/html'])).toBe(false);

    const headers = { 'CONTENT-TYPE': 'text/html', Vary: ['Accept', 'Cookie'] };
    expect(isHeaderSource(headers)).toBe(true);
    expect(readHeader(headers, 'content-type')).toBe('text/html');
    expect(readHeader(headers, 'vary')).toBe('Accept, Cookie');
  });
});
