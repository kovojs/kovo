import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import type { JsonValue } from './json.js';
import {
  assertAndCloneJsonValue,
  assertJsonValue,
  canonicalJsonStringify,
  cloneJsonValue,
  jsonEncodedByteLength,
} from './json-clone.js';

const moduleUrl = new URL('./json-clone.ts', import.meta.url).href;

describe('JSON value utilities', () => {
  it('cannot erase cloned array entries through inherited numeric setters', () => {
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let poisonHits = 0;
    let clone: JsonValue | undefined;
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (value === 'reviewed-json') {
            poisonHits += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      clone = cloneJsonValue(['reviewed-json']);
    } finally {
      if (originalDescriptor === undefined) {
        delete (Array.prototype as unknown as Record<string, unknown>)['0'];
      } else {
        nativeDefineProperty(Array.prototype, '0', originalDescriptor);
      }
    }
    expect(clone).toEqual(['reviewed-json']);
    expect(poisonHits).toBe(0);
  });

  it('clones proxy-backed JSON values without structuredClone', () => {
    const source = new Proxy(
      {
        items: [{ id: 'p1', qty: 2 }],
        ok: true,
      },
      {},
    ) as unknown as JsonValue;

    expect(() => structuredClone(source)).toThrow();

    const clone = cloneJsonValue(source);

    expect(clone).toEqual({ items: [{ id: 'p1', qty: 2 }], ok: true });
    expect(clone).not.toBe(source);
    expect((clone as { items: JsonValue[] }).items).not.toBe(
      (source as { items: JsonValue[] }).items,
    );
  });

  it('rejects lossy or non-JSON values with pathful diagnostics', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const hole = [1, , 3] as unknown[];
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'secret', {
      enumerable: true,
      get() {
        return 'hidden';
      },
    });

    const cases: readonly [unknown, string][] = [
      [{ id: undefined }, 'JSON value at args.id must not be undefined'],
      [{ id: 1n }, 'JSON value at args.id must not be a bigint'],
      [
        { at: new Date('2026-06-30T00:00:00.000Z') },
        'JSON value at args.at must be a plain JSON object',
      ],
      [{ value: Number.NaN }, 'JSON value at args.value must be a finite JSON number'],
      [hole, 'JSON value at args[1] must not be an array hole'],
      [accessor, 'JSON value at args.secret must be a data property'],
      [cyclic, 'JSON value at args.self must not contain a cycle'],
    ];

    for (const [value, message] of cases) {
      expect(() => assertJsonValue(value, { root: 'args' })).toThrow(message);
    }
  });

  it('validates and clones in one boundary operation', () => {
    const input = { nested: { b: 2, a: 1 } };
    const clone = assertAndCloneJsonValue(input);

    expect(clone).toEqual(input);
    expect(clone).not.toBe(input);
    expect((clone as { nested: unknown }).nested).not.toBe(input.nested);
  });

  it('canonicalizes object keys and measures UTF-8 encoded bytes', () => {
    const value: JsonValue = { z: 1, a: { emoji: '😀', b: true } };
    const json = canonicalJsonStringify(value);

    expect(json).toBe('{"a":{"b":true,"emoji":"😀"},"z":1}');
    expect(jsonEncodedByteLength(value)).toBe(new TextEncoder().encode(json).byteLength);
    expect(jsonEncodedByteLength('😀')).toBeGreaterThan(canonicalJsonStringify('😀').length);
  });

  it('pins canonical JSON bytes and scalar checks after late intrinsic replacement', () => {
    const originalStringify = JSON.stringify;
    const originalEncode = TextEncoder.prototype.encode;
    const originalIsFinite = Number.isFinite;
    const originalIsInteger = Number.isInteger;
    try {
      JSON.stringify = () => '{"principalId":"attacker"}';
      TextEncoder.prototype.encode = () => new Uint8Array();
      Number.isFinite = () => true;
      Number.isInteger = () => true;

      expect(canonicalJsonStringify({ principalId: 'victim' })).toBe('{"principalId":"victim"}');
      expect(jsonEncodedByteLength('Kovo')).toBe(6);
      expect(() => assertJsonValue(Number.NaN, { root: 'args' })).toThrow(
        'must be a finite JSON number',
      );
      expect(() => assertJsonValue(Object.assign(['safe'], { admin: true }))).toThrow(
        'must not be a custom array property',
      );
    } finally {
      JSON.stringify = originalStringify;
      TextEncoder.prototype.encode = originalEncode;
      Number.isFinite = originalIsFinite;
      Number.isInteger = originalIsInteger;
    }
  });

  it('fails closed when the UTF-8 encoder was poisoned before import', () => {
    const script = `
      TextEncoder.prototype.encode = () => new Uint8Array();
      const json = await import(${JSON.stringify(`${moduleUrl}?poisoned-json-codec`)});
      try {
        json.jsonEncodedByteLength({ principalId: 'victim' });
      } catch (error) {
        if (String(error).includes('canonical JSON controls are unavailable')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('rejects array properties that JSON.stringify would drop', () => {
    const value = ['visible'] as unknown[];
    Object.assign(value, { extra: 'dropped' });

    expect(() => assertJsonValue(value, { root: 'args' })).toThrow(
      'JSON value at args.extra must not be a custom array property',
    );
  });
});
