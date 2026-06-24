import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  isSecret,
  revealSecret,
  secret,
  trustedReveal,
  type JsonValue,
  type Secret,
  type SecretValue,
} from './index.js';

const MARKER = '[secret]';

describe('runtime Secret poison wrapper (SPEC §6.6 defense-in-depth)', () => {
  it('poisons every accidental coercion path', () => {
    const s = secret('hunter2');

    expect(String(s)).toBe(MARKER);
    expect(`${s}`).toBe(MARKER);
    expect('' + s).toBe(MARKER);
    expect(s.toString()).toBe(MARKER);
    expect(`${[s].join(',')}`).toBe(MARKER);
    expect(Object.prototype.toString.call(s)).toBe('[object Secret]');
  });

  it('does not leak through JSON.stringify, directly or nested', () => {
    const s = secret('hunter2');

    expect(JSON.stringify(s)).toBe('"[secret]"');
    expect(JSON.stringify({ password: s })).toBe('{"password":"[secret]"}');
    expect(JSON.stringify({ creds: { token: s } })).toBe('{"creds":{"token":"[secret]"}}');
    expect(JSON.stringify([s, s])).toBe('["[secret]","[secret]"]');
    expect(JSON.stringify(s)).not.toContain('hunter2');
  });

  it('does not leak through console.log / util.inspect', () => {
    const s = secret('hunter2');
    expect(inspect(s)).toBe(MARKER);
    expect(inspect({ password: s })).not.toContain('hunter2');
  });

  it('does not leak through arithmetic/valueOf coercion', () => {
    const s = secret(42);
    expect(Number(s)).toBeNaN();
    // valueOf is overridden — `+s` cannot recover the number.
    expect(s.valueOf()).toBe(MARKER);
  });

  it('keeps the value out of property enumeration and structuredClone', () => {
    const s = secret('hunter2');
    expect(Object.keys(s)).toEqual([]);
    expect(JSON.stringify(Object.assign({}, s))).toBe('{}');
    // A private #value field cannot survive a structured clone to a worker.
    expect(JSON.stringify(structuredClone({ ...s }))).not.toContain('hunter2');
  });

  it('reveals the value only on explicit reveal()/revealSecret()', () => {
    const s = secret('hunter2');
    expect(s.reveal()).toBe('hunter2');
    expect(revealSecret(s)).toBe('hunter2');
  });

  it('derives via map() without un-poisoning', () => {
    const key = secret('sk_live_abcdef');
    const prefix = key.map((k) => k.slice(0, 7));
    expect(isSecret(prefix)).toBe(true);
    expect(String(prefix)).toBe(MARKER);
    expect(prefix.reveal()).toBe('sk_live');
  });

  it('compares in constant time via equals(), accepting raw or wrapped operands', () => {
    const token = secret('a'.repeat(32));
    expect(token.equals('a'.repeat(32))).toBe(true);
    expect(token.equals('b'.repeat(32))).toBe(false);
    expect(token.equals('a'.repeat(31))).toBe(false); // length mismatch
    expect(token.equals(secret('a'.repeat(32)))).toBe(true);
    expect(secret(7).equals(7)).toBe(true);
    expect(secret(7).equals(8)).toBe(false);
  });

  it('is idempotent: secret(secret(x)) does not double-wrap', () => {
    const inner = secret('x');
    expect(secret(inner)).toBe(inner);
    expect(secret(inner).reveal()).toBe('x');
  });

  it('isSecret recognizes a box and cannot be forged via Symbol.for', () => {
    expect(isSecret(secret('x'))).toBe(true);
    expect(isSecret('x')).toBe(false);
    expect(isSecret(null)).toBe(false);
    expect(isSecret({})).toBe(false);
    // The brand is a module-private Symbol(), not Symbol.for, so it is unforgeable.
    const forged = { [Symbol.for('kovo.secret')]: true };
    expect(isSecret(forged)).toBe(false);
  });

  it('revealSecret passes a non-box Secret-typed value through unchanged', () => {
    // A Drizzle column is typed Secret<T> but is a raw value at runtime.
    const rawColumn = 'plain-hash' as unknown as Secret<string>;
    expect(revealSecret(rawColumn)).toBe('plain-hash');
  });

  it('trustedReveal unwraps a runtime box', () => {
    const s = secret('hunter2');
    expect(trustedReveal(s, { justification: 'test' })).toBe('hunter2');
  });
});

describe('Secret type bound (type-only, defeated by any — SPEC §6.6)', () => {
  it('SecretValue<T> is not assignable to JsonValue at the type level', () => {
    const s: SecretValue<string> = secret('hunter2');
    // @ts-expect-error a secret is intentionally not a JsonValue (Doors 1/2/3).
    const leak: JsonValue = s;
    void leak;
    // Runtime poison is the backstop when `any`/casts defeat the type bound.
    expect(JSON.stringify(s)).toBe('"[secret]"');
  });
});
