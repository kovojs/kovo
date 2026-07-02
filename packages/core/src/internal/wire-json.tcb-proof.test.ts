import { describe, expect, it } from 'vitest';

import { secret, untrusted } from '../secret.js';
import { jsonSafeWireValue, parseWireJsonValue, stringifyWireValue } from './wire-json.js';

interface ModelCase {
  readonly name: string;
  readonly value: unknown;
}

const plainLeaves: readonly ModelCase[] = [
  { name: 'null', value: null },
  { name: 'true', value: true },
  { name: 'false', value: false },
  { name: 'zero', value: 0 },
  { name: 'negative number', value: -7 },
  { name: 'fraction', value: 3.25 },
  { name: 'empty string', value: '' },
  { name: 'string', value: 'wire-value' },
  { name: 'bigint', value: 9007199254740995n },
  { name: 'valid Date', value: new Date('2026-07-02T01:02:03.004Z') },
  { name: 'invalid Date', value: new Date(Number.NaN) },
];

const serializableModel: readonly ModelCase[] = [
  ...plainLeaves,
  ...plainLeaves.map((entry) => ({ name: `array/${entry.name}`, value: [entry.value] })),
  ...plainLeaves.map((entry) => ({ name: `record/${entry.name}`, value: { field: entry.value } })),
  ...plainLeaves.map((entry) => ({
    name: `nested/${entry.name}`,
    value: { outer: [{ inner: entry.value, stable: 'sibling' }] },
  })),
  {
    name: 'mixed nested record',
    value: {
      bigint: 1n,
      date: new Date('2020-01-01T00:00:00.000Z'),
      list: [null, true, 'x', { count: 2 }],
    },
  },
];

const secretNeedle = 'sk_tcb_wire_secret';
const untrustedNeedle = '<img src=x onerror=alert(1)>';

const poisonedModel: readonly ModelCase[] = [
  { name: 'secret/top-level', value: secret(secretNeedle) },
  { name: 'secret/array', value: [secret(secretNeedle)] },
  { name: 'secret/record', value: { token: secret(secretNeedle) } },
  { name: 'secret/nested', value: { outer: [{ token: secret(secretNeedle), ok: true }] } },
  { name: 'untrusted/top-level', value: untrusted(untrustedNeedle) },
  { name: 'untrusted/array', value: [untrusted(untrustedNeedle)] },
  { name: 'untrusted/record', value: { value: untrusted(untrustedNeedle) } },
  { name: 'untrusted/nested', value: { outer: [{ value: untrusted(untrustedNeedle), ok: true }] } },
];

const nonJsonModel: readonly ModelCase[] = [
  { name: 'function/top-level', value: () => 'not-json' },
  { name: 'function/array', value: [() => 'not-json'] },
  { name: 'function/record', value: { field: () => 'not-json' } },
  {
    name: 'function/toJSON hook',
    value: {
      toJSON() {
        return 'attacker-controlled-wire-shape';
      },
    },
  },
  { name: 'symbol/top-level', value: Symbol('not-json') },
  { name: 'symbol/array', value: [Symbol('not-json')] },
  { name: 'symbol/record', value: { field: Symbol('not-json') } },
];

describe('TCB proof: Kovo wire JSON finite value-shape model (DEC-K/A10)', () => {
  it('normalizes and parses every modeled serializable shape deterministically', () => {
    expect(serializableModel.map((entry) => entry.name)).toMatchInlineSnapshot(`
      [
        "null",
        "true",
        "false",
        "zero",
        "negative number",
        "fraction",
        "empty string",
        "string",
        "bigint",
        "valid Date",
        "invalid Date",
        "array/null",
        "array/true",
        "array/false",
        "array/zero",
        "array/negative number",
        "array/fraction",
        "array/empty string",
        "array/string",
        "array/bigint",
        "array/valid Date",
        "array/invalid Date",
        "record/null",
        "record/true",
        "record/false",
        "record/zero",
        "record/negative number",
        "record/fraction",
        "record/empty string",
        "record/string",
        "record/bigint",
        "record/valid Date",
        "record/invalid Date",
        "nested/null",
        "nested/true",
        "nested/false",
        "nested/zero",
        "nested/negative number",
        "nested/fraction",
        "nested/empty string",
        "nested/string",
        "nested/bigint",
        "nested/valid Date",
        "nested/invalid Date",
        "mixed nested record",
      ]
    `);

    for (const entry of serializableModel) {
      const normalized = jsonSafeWireValue(entry.value);
      const raw = stringifyWireValue(entry.value);
      expect(raw, entry.name).toBe(JSON.stringify(normalized));
      const parsed = parseWireJsonValue(raw);
      expect(parsed.ok, entry.name).toBe(true);
    }
  });

  it('refuses Secret and Untrusted boxes at every modeled depth before JSON.stringify can erase them', () => {
    for (const entry of poisonedModel) {
      expect(() => stringifyWireValue(entry.value), entry.name).toThrow(/KV4(26|35)/);
      try {
        stringifyWireValue(entry.value);
      } catch (error) {
        expect(String(error), entry.name).not.toContain(secretNeedle);
        expect(String(error), entry.name).not.toContain(untrustedNeedle);
      }
    }
  });

  it('fails closed on non-JSON values and user toJSON hooks', () => {
    for (const entry of nonJsonModel) {
      expect(() => stringifyWireValue(entry.value), entry.name).toThrow(
        /function or symbol values/,
      );
    }
  });
});
