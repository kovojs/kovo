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

  it('rejects over-deep JSON before native recursion exhausts the stack', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let depth = 0; depth <= 64; depth += 1) {
      const next: Record<string, unknown> = {};
      deep.value = next;
      deep = next;
    }

    expect(() => assertJsonValue(root)).toThrow('exceeds the 64-level depth bound');
  });

  it('validates and clones in one boundary operation', () => {
    const input = { nested: { b: 2, a: 1 } };
    const clone = assertAndCloneJsonValue(input);

    expect(clone).toEqual(input);
    expect(clone).not.toBe(input);
    expect((clone as { nested: unknown }).nested).not.toBe(input.nested);
  });

  it('snapshots proxy-owned JSON descriptors exactly once without invoking get traps', () => {
    const makeCarrier = () => {
      let descriptorReads = 0;
      let propertyGets = 0;
      const value = new Proxy(
        {},
        {
          get() {
            propertyGets += 1;
            return 'attacker';
          },
          getOwnPropertyDescriptor(_target, property) {
            if (property !== 'principalId') return undefined;
            descriptorReads += 1;
            return {
              configurable: true,
              enumerable: true,
              value: descriptorReads === 1 ? 'victim' : 'attacker',
              writable: true,
            };
          },
          ownKeys() {
            return ['principalId'];
          },
        },
      );
      return {
        counts: () => ({ descriptorReads, propertyGets }),
        value,
      };
    };

    const cloneCarrier = makeCarrier();
    expect(assertAndCloneJsonValue(cloneCarrier.value)).toEqual({ principalId: 'victim' });
    expect(cloneCarrier.counts()).toEqual({ descriptorReads: 1, propertyGets: 0 });

    const assertedCarrier = makeCarrier();
    expect(assertJsonValue(assertedCarrier.value)).toEqual({ principalId: 'victim' });
    expect(assertedCarrier.counts()).toEqual({ descriptorReads: 1, propertyGets: 0 });

    const canonicalCarrier = makeCarrier();
    expect(canonicalJsonStringify(canonicalCarrier.value)).toBe('{"principalId":"victim"}');
    expect(canonicalCarrier.counts()).toEqual({ descriptorReads: 1, propertyGets: 0 });
  });

  it('does not let a proxy substitute attacker truth after validation', () => {
    const makeCarrier = () => {
      let propertyGets = 0;
      const value = new Proxy(
        { principalId: 'victim' },
        {
          get(_target, property) {
            if (property !== 'principalId') return undefined;
            propertyGets += 1;
            return propertyGets === 1 ? 'victim' : 'attacker';
          },
        },
      );
      return { getCount: () => propertyGets, value };
    };

    const cloneCarrier = makeCarrier();
    expect(assertAndCloneJsonValue(cloneCarrier.value)).toEqual({ principalId: 'victim' });
    expect(cloneCarrier.getCount()).toBe(0);

    const canonicalCarrier = makeCarrier();
    expect(canonicalJsonStringify(canonicalCarrier.value)).toBe('{"principalId":"victim"}');
    expect(canonicalCarrier.getCount()).toBe(0);
  });

  it('never invokes accessor-backed JSON properties while rejecting them', () => {
    for (const operation of [
      (value: unknown) => assertJsonValue(value),
      (value: unknown) => assertAndCloneJsonValue(value),
      (value: unknown) => canonicalJsonStringify(value),
      (value: unknown) => cloneJsonValue(value as JsonValue),
    ]) {
      let accessorReads = 0;
      const value = {};
      Object.defineProperty(value, 'principalId', {
        enumerable: true,
        get() {
          accessorReads += 1;
          return 'attacker';
        },
      });

      expect(() => operation(value)).toThrow('must be a data property');
      expect(accessorReads).toBe(0);
    }
  });

  it('rejects hidden custom and symbol JSON carriers instead of serializing around them', () => {
    const array = ['visible'];
    Object.defineProperty(array, 'hidden', {
      enumerable: false,
      value: 'dropped',
    });
    expect(() => assertAndCloneJsonValue(array)).toThrow(
      'JSON value at $.hidden must not be a custom array property',
    );

    const symbol = Symbol('hidden-json-authority');
    const object = { visible: true } as Record<PropertyKey, unknown>;
    Object.defineProperty(object, symbol, {
      enumerable: false,
      value: 'dropped',
    });
    expect(() => canonicalJsonStringify(object)).toThrow('must not contain symbol key');
  });

  it('shadows inherited toJSON hooks before canonical serialization', () => {
    const nativeDefineProperty = Object.defineProperty;
    const objectDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    const arrayDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
    let json: string | undefined;
    try {
      nativeDefineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value: () => ({ principalId: 'attacker' }),
        writable: true,
      });
      nativeDefineProperty(Array.prototype, 'toJSON', {
        configurable: true,
        value: () => ['attacker'],
        writable: true,
      });
      json = canonicalJsonStringify({ items: ['victim'], principalId: 'victim' });
    } finally {
      if (objectDescriptor === undefined) {
        delete (Object.prototype as { toJSON?: unknown }).toJSON;
      } else {
        nativeDefineProperty(Object.prototype, 'toJSON', objectDescriptor);
      }
      if (arrayDescriptor === undefined) {
        delete (Array.prototype as unknown as { toJSON?: unknown }).toJSON;
      } else {
        nativeDefineProperty(Array.prototype, 'toJSON', arrayDescriptor);
      }
    }

    expect(json).toBe('{"items":["victim"],"principalId":"victim"}');
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
