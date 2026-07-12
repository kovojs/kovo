import { describe, expect, it } from 'vitest';
import { secret } from '../secret.js';

import { parseWireJsonValue, stringifyWireValue, wireJsonRoundTripCorpus } from './wire-json.js';

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

      expect(stringifyWireValue({ count: 1, rows: ['safe'] })).toBe(
        '{"count":1,"rows":["safe"]}',
      );
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
