import { describe, expect, it } from 'vitest';
import { secret } from '../secret.js';

import {
  malformedWireJsonError,
  parseWireJsonValue,
  stringifyWireValue,
  wireJsonRoundTripCorpus,
} from './wire-json.js';

describe('wire-json core contract', () => {
  it('round-trips the shared wire JSON corpus', () => {
    for (const entry of wireJsonRoundTripCorpus) {
      expect(stringifyWireValue(entry.value), entry.name).toBe(entry.json);

      const parsed = parseWireJsonValue(entry.json);
      expect(parsed.ok, entry.name).toBe(true);
      expectWireValue((parsed as { ok: true; value: unknown }).value, entry.value, entry.name);
    }
  });

  it('leaves ordinary app records carrying $kovo untouched', () => {
    const parsed = parseWireJsonValue(
      '{"$kovo":"date","value":"2020-01-01T00:00:00.000Z","extra":1}',
    );

    expect(parsed).toEqual({
      ok: true,
      value: { $kovo: 'date', extra: 1, value: '2020-01-01T00:00:00.000Z' },
    });
  });

  it('leaves malformed tagged values as plain records', () => {
    expect(parseWireJsonValue('{"$kovo":"bigint","value":"nope"}')).toEqual({
      ok: true,
      value: { $kovo: 'bigint', value: 'nope' },
    });
    expect(parseWireJsonValue('{"$kovo":"thing","value":"x"}')).toEqual({
      ok: true,
      value: { $kovo: 'thing', value: 'x' },
    });
    expect(parseWireJsonValue('{"$kovo":"bigint","value":"0x10"}')).toEqual({
      ok: true,
      value: { $kovo: 'bigint', value: '0x10' },
    });
    expect(parseWireJsonValue('{"$kovo":"date","value":"2020-01-01"}')).toEqual({
      ok: true,
      value: { $kovo: 'date', value: '2020-01-01' },
    });
  });

  it('refuses runtime secret boxes before JSON serialization reaches the wire', () => {
    expect(() => stringifyWireValue({ token: secret('sk_live_wire_json') })).toThrow(
      /KV435 Secret runtime value cannot cross/,
    );

    try {
      stringifyWireValue({ token: secret('sk_live_wire_json') });
    } catch (error) {
      expect(String(error)).not.toContain('sk_live_wire_json');
    }
  });

  it('cannot erase normalized wire entries through inherited numeric setters', () => {
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let setterCalls = 0;
    let output: string | undefined;
    try {
      Object.defineProperty(Array.prototype, '0', {
        configurable: true,
        set() {
          setterCalls += 1;
        },
      });
      output = stringifyWireValue(['reviewed-wire-value']);
    } finally {
      if (previous === undefined) delete (Array.prototype as { 0?: unknown })[0];
      else Object.defineProperty(Array.prototype, '0', previous);
    }

    expect(setterCalls).toBe(0);
    expect(output).toBe('["reviewed-wire-value"]');
  });

  it('pins normalization, serialization, and parsing after late intrinsic replacement', () => {
    const originalStringify = JSON.stringify;
    const originalParse = JSON.parse;
    const originalMap = Array.prototype.map;
    const originalEntries = Object.entries;
    const originalGetTime = Date.prototype.getTime;
    const originalToISOString = Date.prototype.toISOString;
    const originalBigIntToString = BigInt.prototype.toString;
    try {
      JSON.stringify = () => '{"admin":true,"token":"forged"}';
      JSON.parse = () => ({ forged: true });
      Array.prototype.map = () => ['forged'];
      Object.entries = () => [['admin', true]];
      Date.prototype.getTime = () => 0;
      Date.prototype.toISOString = () => 'forged';
      BigInt.prototype.toString = () => '999';

      expect(stringifyWireValue({ count: 1, rows: ['safe'] })).toBe('{"count":1,"rows":["safe"]}');
      expect(stringifyWireValue({ at: new Date('2020-01-02T03:04:05.678Z'), id: 42n })).toBe(
        '{"at":{"$kovo":"date","value":"2020-01-02T03:04:05.678Z"},"id":{"$kovo":"bigint","value":"42"}}',
      );
      expect(parseWireJsonValue('{"count":1}')).toEqual({ ok: true, value: { count: 1 } });
    } finally {
      JSON.stringify = originalStringify;
      JSON.parse = originalParse;
      Array.prototype.map = originalMap;
      Object.entries = originalEntries;
      Date.prototype.getTime = originalGetTime;
      Date.prototype.toISOString = originalToISOString;
      BigInt.prototype.toString = originalBigIntToString;
    }
  });

  it('reconstructs special keys and rejects mutable accessors', () => {
    const value = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(value, '__proto__', {
      enumerable: true,
      value: { safe: true },
    });
    expect(stringifyWireValue(value)).toBe('{"__proto__":{"safe":true}}');

    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'role', {
      enumerable: true,
      get: () => 'admin',
    });
    expect(() => stringifyWireValue(accessor)).toThrow('stable own data properties');
  });

  it('refuses lossy non-JSON values at the wire integrity boundary', () => {
    for (const value of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      { value: undefined },
      [undefined],
      new Array(1),
      new Map([['role', 'admin']]),
    ]) {
      expect(() => stringifyWireValue(value)).toThrow(/Kovo wire JSON/u);
    }

    class RoleCarrier {
      role = 'admin';
    }
    expect(() => stringifyWireValue(new RoleCarrier())).toThrow(/plain JSON records/u);

    const symbolRecord = { visible: true, [Symbol('hidden-authority')]: true };
    expect(() => stringifyWireValue(symbolRecord)).toThrow(/symbol properties/u);

    const customArray = ['member'] as string[] & { role?: string };
    customArray.role = 'admin';
    expect(() => stringifyWireValue(customArray)).toThrow(/without custom properties/u);

    const hidden = { visible: true };
    Object.defineProperty(hidden, 'authority', { value: 'admin' });
    expect(() => stringifyWireValue(hidden)).toThrow(/non-enumerable properties/u);

    const decoratedDate = new Date('2020-01-01T00:00:00.000Z') as Date & { role?: string };
    decoratedDate.role = 'admin';
    expect(() => stringifyWireValue(decoratedDate)).toThrow(/Date instances without custom/u);
  });

  it('does not coerce hostile parser and malformed-error carriers', () => {
    let rawCoercions = 0;
    const parsed = parseWireJsonValue({
      toString() {
        rawCoercions += 1;
        return '{"admin":true}';
      },
    } as unknown as string);
    expect(parsed.ok).toBe(false);
    expect(rawCoercions).toBe(0);

    let messageReads = 0;
    const cause = new Error('safe');
    Object.defineProperty(cause, 'message', {
      get() {
        messageReads += 1;
        return 'forged';
      },
    });
    expect(malformedWireJsonError('query response', cause).message).toBe(
      'Malformed JSON in query response: unknown parse error',
    );
    expect(messageReads).toBe(0);
  });

  it('rejects cyclic and over-deep wire values with bounded framework diagnostics', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stringifyWireValue(cyclic)).toThrow(
      'Kovo wire JSON must not contain cyclic values',
    );

    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let depth = 0; depth <= 64; depth += 1) {
      const next: Record<string, unknown> = {};
      deep.value = next;
      deep = next;
    }
    expect(() => stringifyWireValue(root)).toThrow(
      'Kovo wire JSON exceeds the 64-level depth bound',
    );

    const dense = new Array<null>(100_000);
    dense.fill(null);
    expect(() => stringifyWireValue(dense)).toThrow('Kovo wire JSON exceeds the 100000-node bound');

    const overDeepJson = `${'['.repeat(65)}0${']'.repeat(65)}`;
    expect(parseWireJsonValue(overDeepJson).ok).toBe(false);
    expect(() => stringifyWireValue('x'.repeat(4_000_001))).toThrow(
      /4000000-character aggregate bound/u,
    );
    expect(() => stringifyWireValue('\0'.repeat(700_000))).toThrow(
      /serialized output exceeds the 4000000-character bound/u,
    );
    expect(() => stringifyWireValue('<'.repeat(700_000))).toThrow(
      /HTML-safe serialized output exceeds the 4000000-character bound/u,
    );
  });

  it('allows acyclic shared values while encoding each occurrence independently', () => {
    const shared = { id: 42n };
    expect(stringifyWireValue({ first: shared, second: shared })).toBe(
      '{"first":{"id":{"$kovo":"bigint","value":"42"}},"second":{"id":{"$kovo":"bigint","value":"42"}}}',
    );
  });

  it('does not read a proxy array length through an attacker-controlled get trap', () => {
    let lengthReads = 0;
    const value = new Proxy(['safe'], {
      get(target, property, receiver) {
        if (property === 'length') {
          lengthReads += 1;
          return 0;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(stringifyWireValue(value)).toBe('["safe"]');
    expect(lengthReads).toBe(0);
  });

  it('shadows inherited toJSON hooks before serializing normalized wire values', () => {
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
      json = stringifyWireValue({ ids: [42n], principalId: 'victim' });
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

    expect(json).toBe('{"ids":[{"$kovo":"bigint","value":"42"}],"principalId":"victim"}');
  });

  it('reports malformed JSON without throwing', () => {
    const parsed = parseWireJsonValue('{not json');
    expect(parsed.ok).toBe(false);
  });
});

function expectWireValue(actual: unknown, expected: unknown, label: string): void {
  if (expected instanceof Date) {
    expect(actual, label).toBeInstanceOf(Date);
    if (Number.isNaN(expected.getTime())) {
      expect(Number.isNaN((actual as Date).getTime()), label).toBe(true);
    } else {
      expect((actual as Date).toISOString(), label).toBe(expected.toISOString());
    }
    return;
  }

  if (typeof expected !== 'object' || expected === null) {
    expect(actual, label).toBe(expected);
    return;
  }

  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), label).toBe(true);
    expect((actual as unknown[]).length, label).toBe(expected.length);
    expected.forEach((item, index) => {
      expectWireValue((actual as unknown[])[index], item, `${label}[${index}]`);
    });
    return;
  }

  expect(typeof actual, label).toBe('object');
  expect(actual, label).not.toBeNull();
  expect(Object.keys(actual as Record<string, unknown>).sort(), label).toEqual(
    Object.keys(expected as Record<string, unknown>).sort(),
  );
  for (const [key, item] of Object.entries(expected as Record<string, unknown>)) {
    expectWireValue((actual as Record<string, unknown>)[key], item, `${label}.${key}`);
  }
}
