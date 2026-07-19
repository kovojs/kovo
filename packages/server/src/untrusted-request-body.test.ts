import { inspect, types as utilTypes } from 'node:util';
import { describe, expect, it } from 'vitest';
import { isUntrusted, revealUntrusted } from '@kovojs/core';

import { query, renderQueryEndpointResponse } from './query.js';
import { parseRouteRequest, route } from './route.js';
import { assertShapeWithinBudget, s } from './schema.js';
import {
  parseUntrustedJsonBodyBytes,
  readUntrustedCookieValue,
  readUntrustedRequestBody,
  readUntrustedRequestHeader,
  revealUntrustedRequestValue,
  tagUntrustedRequestValue,
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

  it('does not erase signed raw JSON after a late typed-array length poison', () => {
    const body = new TextEncoder().encode('{"id":"evt_signed"}');
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const descriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength');
    expect(descriptor?.get).toBeTypeOf('function');
    Object.defineProperty(typedArrayPrototype, 'byteLength', {
      configurable: true,
      get(this: Uint8Array) {
        return this === body ? 0 : Reflect.apply(descriptor!.get!, this, []);
      },
    });
    try {
      const parsed = parseUntrustedJsonBodyBytes(body);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(
        revealUntrusted((parsed.value as { id: unknown }).id, 'test validates poisoned webhook id'),
      ).toBe('evt_signed');
    } finally {
      Object.defineProperty(typedArrayPrototype, 'byteLength', descriptor!);
    }
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

  it('reports KV430 shape-budget failure for valid deeply nested JSON without a RangeError', async () => {
    const depth = 10_000;
    const body = `${'['.repeat(depth)}0${']'.repeat(depth)}`;
    expect(() => JSON.parse(body)).not.toThrow();

    await expect(
      readUntrustedRequestBody(
        new Request('https://kovo.test/_m/deep', {
          body,
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: 'shape-budget' });
    expect(parseUntrustedJsonBodyBytes(new TextEncoder().encode(body))).toEqual({
      ok: false,
      reason: 'shape-budget',
    });
  });

  it('rejects JSON breadth before allocating provenance boxes for every scalar', async () => {
    const entries = 10_001;
    const body = `[${'0,'.repeat(entries - 1)}0]`;

    await expect(
      readUntrustedRequestBody(
        new Request('https://kovo.test/_m/wide', {
          body,
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: 'shape-budget' });
  });

  it('uses lazy provenance containers for a near-node-limit scalar tree', () => {
    const input = Array.from({ length: 20 }, (_, container) =>
      Array.from({ length: container === 19 ? 9_979 : 10_000 }, (_, index) => index),
    );
    expect(() => assertShapeWithinBudget(input)).not.toThrow();

    const tagged = tagUntrustedRequestValue(input) as unknown[][];
    expect(utilTypes.isProxy(tagged)).toBe(true);
    const firstContainer = tagged[0]!;
    expect(utilTypes.isProxy(firstContainer)).toBe(true);

    const firstRead = firstContainer[0];
    const secondRead = firstContainer[0];
    expect(isUntrusted(firstRead)).toBe(true);
    expect(isUntrusted(secondRead)).toBe(true);
    expect(firstRead).not.toBe(secondRead);
    expect(revealUntrusted(firstRead, 'test validates lazy request leaf')).toBe(0);
    expect(revealUntrusted(secondRead, 'test validates lazy request leaf')).toBe(0);
  });

  it('tags and reveals a deeply nested provenance tree iteratively', () => {
    let deep: unknown = 'leaf';
    const depth = 10_000;
    for (let index = 0; index < depth; index += 1) deep = { child: deep };

    const tagged = tagUntrustedRequestValue(deep);
    const revealed = revealUntrustedRequestValue(tagged, 'test validates iterative provenance');
    let cursor = revealed;
    for (let index = 0; index < depth; index += 1) {
      cursor = (cursor as { child: unknown }).child;
    }
    expect(cursor).toBe('leaf');
  });

  it('does not invoke hostile accessors while tagging or revealing request records', () => {
    let getterCalls = 0;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, 'value', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'owned';
      },
    });

    expect(() => tagUntrustedRequestValue(hostile)).toThrow(/stable own data properties/u);
    expect(() => revealUntrustedRequestValue(hostile, 'hostile descriptor test')).toThrow(
      /stable own data properties/u,
    );
    expect(getterCalls).toBe(0);
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
    expect(Object.keys(value)).toEqual(['name', 'nested']);
    expect(isUntrusted(Reflect.get(value, 'name'))).toBe(true);
    expect(isUntrusted(Object.getOwnPropertyDescriptor(value, 'name')?.value)).toBe(true);
    expect(isUntrusted(Object.assign({}, value).name)).toBe(true);
    expect(() => String(value.name)).toThrow(/KV426/);
    expect(() => JSON.stringify(result.value)).toThrow(/KV426/);
    expect(inspect(value.name)).toBe('[untrusted]');
    expect(revealUntrusted(value.name, 'test validates request body name')).toBe('Ada');
  });

  it('keeps every app-visible FormData scalar read behind the provenance membrane', async () => {
    const form = new FormData();
    form.append('title', 'Hello');
    form.append('title', 'Again');
    const result = await readUntrustedRequestBody(
      new Request('https://kovo.test/m', { body: form, method: 'POST' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeInstanceOf(FormData);
    const tagged = result.value as FormData;
    const assertTaggedScalar = (value: unknown): void => {
      expect(isUntrusted(value)).toBe(true);
      expect(() => String(value)).toThrow(/KV426/u);
    };

    assertTaggedScalar(tagged.get('title'));
    assertTaggedScalar(Reflect.get(tagged, 'get').call(tagged, 'title'));
    for (const value of tagged.getAll('title')) assertTaggedScalar(value);
    for (const [, value] of tagged.entries()) assertTaggedScalar(value);
    for (const [, value] of tagged) assertTaggedScalar(value);
    for (const value of tagged.values()) assertTaggedScalar(value);

    const callbackReceiver = {};
    const callbackValues: unknown[] = [];
    tagged.forEach(function (value, key, parent) {
      expect(this).toBe(callbackReceiver);
      expect(key).toBe('title');
      expect(parent).toBe(tagged);
      assertTaggedScalar(value);
      callbackValues.push(value);
    }, callbackReceiver);
    expect(callbackValues).toHaveLength(2);

    // FormData entries are platform-internal rather than enumerable object properties. These
    // generic reflection/serialization paths must therefore expose no submitted scalar at all.
    expect(Object.getOwnPropertyDescriptor(tagged, 'title')).toBeUndefined();
    expect(Object.assign({}, tagged)).toEqual({});
    expect(JSON.stringify(tagged)).toBe('{}');
    expect(s.object({ title: s.string() }).parse(tagged)).toEqual({ title: 'Hello' });
  });

  it('distinguishes budgeted array structure metadata from attacker scalar leaves', () => {
    const tagged = tagUntrustedRequestValue(['attacker-input']) as unknown[];

    expect(tagged.length).toBe(1);
    expect(isUntrusted(tagged.length)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(tagged, 'length')).toEqual(
      expect.objectContaining({ enumerable: false, value: 1 }),
    );
    assertShapeWithinBudget(tagged);

    expect(isUntrusted(Reflect.get(tagged, 0))).toBe(true);
    expect(isUntrusted(Object.getOwnPropertyDescriptor(tagged, '0')?.value)).toBe(true);
    expect(isUntrusted(Object.assign([], tagged)[0])).toBe(true);
    expect(() => JSON.stringify(tagged)).toThrow(/KV426/u);
  });

  it('pins the FormData provenance membrane against late global Proxy replacement', () => {
    const form = new FormData();
    form.set('title', 'attacker-input');
    const NativeProxy = globalThis.Proxy;
    let proxyHits = 0;
    let tagged!: FormData;
    try {
      globalThis.Proxy = class BypassProxy {
        constructor(target: object) {
          if (target === form) proxyHits += 1;
          return target;
        }
      } as unknown as ProxyConstructor;
      tagged = tagUntrustedRequestValue(form) as FormData;
    } finally {
      globalThis.Proxy = NativeProxy;
    }

    expect(proxyHits).toBe(0);
    expect(isUntrusted(tagged.get('title'))).toBe(true);
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
