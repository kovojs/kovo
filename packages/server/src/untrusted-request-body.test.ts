import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { isUntrusted, revealUntrusted } from '@kovojs/core';

import { query, renderQueryEndpointResponse } from './query.js';
import { parseRouteRequest, route } from './route.js';
import { s } from './schema.js';
import {
  parseUntrustedJsonBodyBytes,
  readUntrustedCookieValue,
  readUntrustedRequestBody,
  readUntrustedRequestHeader,
  revealUntrustedRequestValue,
} from './untrusted-request-body.js';

describe('untrusted request body parser', () => {
  it('tags Kovo-owned request header and cookie accessors for validation provenance', () => {
    const request = new Request('https://kovo.test/m', {
      headers: {
        Cookie: 'session=abc%20123; theme=dark',
        Origin: 'https://shop.example',
      },
      method: 'POST',
    });

    const origin = readUntrustedRequestHeader(request, 'origin');
    const session = readUntrustedCookieValue(request, 'session');
    const nativeOrigin = request.headers.get('origin');

    expect(isUntrusted(origin)).toBe(true);
    expect(isUntrusted(session)).toBe(true);
    expect(isUntrusted(nativeOrigin)).toBe(false);
    expect(nativeOrigin).toBe('https://shop.example');
    expect(() => String(origin)).toThrow(/KV426/);
    expect(revealUntrustedRequestValue(origin, 'test validates Origin header')).toBe(
      'https://shop.example',
    );
    expect(revealUntrustedRequestValue(session, 'test validates cookie binding')).toBe('abc 123');
    expect(readUntrustedCookieValue(request, 'missing')).toBeUndefined();
  });

  it('decodes webhook raw JSON bytes only through the parser choke', () => {
    const body = new TextEncoder().encode('{"id":"evt_1","nested":{"ok":true}}');
    const parsed = parseUntrustedJsonBodyBytes(body);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const value = parsed.value as { id: unknown; nested: { ok: unknown } };
    expect(isUntrusted(value.id)).toBe(true);
    expect(revealUntrusted(value.id, 'test validates webhook id')).toBe('evt_1');
    expect(isUntrusted(value.nested.ok)).toBe(true);
    expect(revealUntrusted(value.nested.ok, 'test validates nested flag')).toBe(true);
  });

  it('treats empty raw JSON bodies as an empty schema input object', () => {
    expect(parseUntrustedJsonBodyBytes(new Uint8Array())).toEqual({
      ok: true,
      value: {},
    });
  });

  it('returns typed failure for malformed raw JSON bytes', () => {
    const body = new TextEncoder().encode('{ not json');

    expect(parseUntrustedJsonBodyBytes(body)).toEqual({
      ok: false,
      reason: 'invalid-json',
    });
  });

  it('tags decoded JSON body leaves as non-coercible untrusted request values', async () => {
    const result = await readUntrustedRequestBody(
      new Request('https://kovo.test/m', {
        body: '{"name":"Ada","nested":{"bio":"<script>"}}',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as { name: unknown; nested: { bio: unknown } };
    expect(isUntrusted(value.name)).toBe(true);
    expect(() => String(value.name)).toThrow(/KV426/);
    expect(() => JSON.stringify(result.value)).toThrow(/KV426/);
    expect(inspect(value.name)).toBe('[untrusted]');
    expect(revealUntrusted(value.name, 'test validates request body name')).toBe('Ada');
  });

  it('preserves FormData while tagging submitted scalar fields', async () => {
    const form = new FormData();
    form.set('title', 'Hello');
    const result = await readUntrustedRequestBody(
      new Request('https://kovo.test/m', { body: form, method: 'POST' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeInstanceOf(FormData);
    const taggedTitle = (result.value as FormData).get('title');
    expect(isUntrusted(taggedTitle)).toBe(true);
    expect(s.object({ title: s.string() }).parse(result.value)).toEqual({ title: 'Hello' });
  });

  it('validates route params and search by revealing request tags inside schemas', () => {
    const productRoute = route('/products/:id', {
      params: s.object({ id: s.string() }),
      search: s.object({ page: s.number().int().default(1), q: s.string().optional() }),
    });

    expect(
      parseRouteRequest(productRoute, {
        params: { id: 'p1' },
        search: { page: '2', q: 'hat' },
      }),
    ).toMatchObject({
      params: { id: 'p1' },
      search: { page: 2, q: 'hat' },
    });
  });

  it('reveals unschematized route params after route matching fallback validation', () => {
    const productRoute = route('/products/:id');
    const parsed = parseRouteRequest(productRoute, { params: { id: 'p1' } });

    expect(isUntrusted(parsed.params.id)).toBe(false);
    expect(parsed.params.id).toBe('p1');
  });

  it('tags query search input and lets declared args schemas reveal it', async () => {
    const seen: unknown[] = [];
    const withArgs = query('products/search', {
      args: s.object({ q: s.string(), page: s.number().int().default(1) }),
      load(input) {
        seen.push(input);
        return { ok: true };
      },
      reads: [],
    });
    const withoutArgs = query('products/raw-search', {
      load(input: { q?: unknown }) {
        seen.push(input.q);
        return { ok: true };
      },
      reads: [],
    });

    await expect(
      renderQueryEndpointResponse(withArgs, {
        request: {},
        search: new URLSearchParams('q=hat&page=2'),
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      renderQueryEndpointResponse(withoutArgs, {
        request: {},
        search: new URLSearchParams('q=raw'),
      }),
    ).resolves.toMatchObject({ status: 200 });

    expect(seen[0]).toEqual({ page: 2, q: 'hat' });
    expect(isUntrusted(seen[1])).toBe(true);
  });
});
