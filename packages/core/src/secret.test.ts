import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  declareOffWire,
  drainSecretRevealAuditFacts,
  isRedacted,
  isSecret,
  isUntrusted,
  redacted,
  revealRedacted,
  revealSecret,
  revealUntrusted,
  secret,
  trustedReveal,
  untrusted,
  type JsonValue,
  type Redacted,
  type RedactedValue,
  type Secret,
  type SecretValue,
  type Untrusted,
  type UntrustedValue,
} from './index.js';

const MARKER = '[secret]';

describe('runtime Secret non-coercible wrapper (SPEC §10.2/§11.2)', () => {
  it('throws on every accidental coercion path', () => {
    const s = secret('hunter2');

    expect(() => String(s)).toThrow(/KV435/);
    expect(() => `${s}`).toThrow(/KV435/);
    expect(() => '' + s).toThrow(/KV435/);
    expect(() => s.toString()).toThrow(/KV435/);
    expect(() => `${[s].join(',')}`).toThrow(/KV435/);
    expect(Object.prototype.toString.call(s)).toBe('[object Secret]');
  });

  it('refuses JSON.stringify directly or nested', () => {
    const s = secret('hunter2');

    expect(() => JSON.stringify(s)).toThrow(/KV435/);
    expect(() => JSON.stringify({ password: s })).toThrow(/KV435/);
    expect(() => JSON.stringify({ creds: { token: s } })).toThrow(/KV435/);
    expect(() => JSON.stringify([s, s])).toThrow(/KV435/);
  });

  it('does not leak through console.log / util.inspect', () => {
    const s = secret('hunter2');
    expect(inspect(s)).toBe(MARKER);
    expect(inspect({ password: s })).not.toContain('hunter2');
  });

  it('does not leak through arithmetic/valueOf coercion', () => {
    const s = secret(42);
    expect(() => Number(s)).toThrow(/KV435/);
    expect(() => s.valueOf()).toThrow(/KV435/);
  });

  it('keeps the value out of property enumeration and refuses structuredClone', () => {
    const s = secret('hunter2');
    expect(Object.keys(s)).toEqual([]);
    expect(JSON.stringify(Object.assign({}, s))).toBe('{}');
    expect(() => structuredClone(s)).toThrow();
    expect(() => structuredClone({ password: s })).toThrow();
    expect(() => structuredClone([s])).toThrow();
  });

  it('reveals the value only on explicit reveal()/revealSecret()', () => {
    drainSecretRevealAuditFacts();
    const s = secret('hunter2');
    expect(() => s.reveal('')).toThrow(
      'Secret/Untrusted reveal requires a non-empty justification.',
    );
    expect(s.reveal('needed for HMAC comparison')).toBe('hunter2');
    expect(revealSecret(s, { justification: 'needed for HMAC comparison' })).toBe('hunter2');
    expect(drainSecretRevealAuditFacts()).toMatchObject([
      { kind: 'secret-reveal', reason: 'needed for HMAC comparison' },
      { kind: 'secret-reveal', reason: 'needed for HMAC comparison' },
    ]);
  });

  it('derives via map() without un-poisoning', () => {
    const key = secret('sk_live_abcdef');
    const prefix = key.map((k) => k.slice(0, 7));
    expect(isSecret(prefix)).toBe(true);
    expect(() => String(prefix)).toThrow(/KV435/);
    expect(prefix.reveal('test assertion')).toBe('sk_live');
  });

  it('compares in constant time via equals(), accepting raw or wrapped operands', () => {
    const token = secret('a'.repeat(32));
    expect(token.equals('a'.repeat(32))).toBe(true);
    expect(token.equals('b'.repeat(32))).toBe(false);
    expect(token.equals('a'.repeat(31))).toBe(false); // length mismatch
    expect(token.equals(secret('a'.repeat(32)))).toBe(true);
    const bytes = new Uint8Array([1, 2, 3]);
    expect(secret(bytes).equals(new Uint8Array([1, 2, 3]))).toBe(true);
    expect(secret(bytes.buffer).equals(new Uint8Array([1, 2, 3]))).toBe(true);
    expect(secret(new Uint8Array([97])).equals('a' as never)).toBe(false);
    expect(secret(7).equals(7)).toBe(true);
    expect(secret(7).equals(8)).toBe(false);
  });

  it('is idempotent: secret(secret(x)) does not double-wrap', () => {
    const inner = secret('x');
    expect(secret(inner)).toBe(inner);
    expect(secret(inner).reveal('test assertion')).toBe('x');
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
    expect(revealSecret(rawColumn, 'static column projection')).toBe('plain-hash');
  });

  it('trustedReveal unwraps a runtime box', () => {
    const s = secret('hunter2');
    expect(trustedReveal(s, { justification: 'test' })).toBe('hunter2');
  });

  it('declareOffWire runs a justified server-only block without returning a value', () => {
    const calls: string[] = [];
    const result = declareOffWire(
      () => {
        calls.push(revealSecret(secret('server-only-token'), 'server-only cache partition'));
      },
      { justification: 'used only to choose an internal cache partition' },
    );

    expect(result).toBeUndefined();
    expect(calls).toEqual(['server-only-token']);
    expect(() => declareOffWire(() => {}, { justification: '   ' })).toThrow(
      'declareOffWire requires a non-empty justification.',
    );
  });
});

describe('Secret type bound (type-only, defeated by any — SPEC §6.6)', () => {
  it('SecretValue<T> is not assignable to JsonValue at the type level', () => {
    const s: SecretValue<string> = secret('hunter2');
    // @ts-expect-error a secret is intentionally not a JsonValue (Doors 1/2/3).
    const leak: JsonValue = s;
    void leak;
    const compileOnly = () => {
      // @ts-expect-error Secret<T> uses a module-private symbol brand, not a public structural key.
      const forged: Secret<string> = { __kovoSecretBrand: Symbol('kovo.secret') };
      void forged;
    };
    void compileOnly;
    // Runtime non-coercion is the backstop when `any`/casts defeat the type bound.
    expect(() => JSON.stringify(s)).toThrow(/KV435/);
  });
});

describe('runtime Untrusted provenance wrapper (SPEC §5.2 rule 11)', () => {
  it('is non-coercible but inspect-redacted like Secret', () => {
    const value = untrusted('<script>alert(1)</script>');
    expect(() => String(value)).toThrow(/KV426/);
    expect(() => `${value}`).toThrow(/KV426/);
    expect(() => JSON.stringify({ value })).toThrow(/KV426/);
    expect(inspect(value)).toBe('[untrusted]');
    expect(Object.prototype.toString.call(value)).toBe('[object Untrusted]');
  });

  it('reveals only with a non-empty validation reason and maps without losing provenance', () => {
    const value = untrusted('Ada Lovelace');
    expect(() => value.reveal('')).toThrow(
      'Secret/Untrusted reveal requires a non-empty justification.',
    );
    expect(value.reveal('validated as display name')).toBe('Ada Lovelace');
    const first = value.map((name) => name.split(' ')[0]);
    expect(isUntrusted(first)).toBe(true);
    expect(first.reveal({ justification: 'validated as display name' })).toBe('Ada');
    expect(revealUntrusted(first, 'validated as display name')).toBe('Ada');
  });

  it('is idempotent, unforgeable through Symbol.for, and not JsonValue', () => {
    const value = untrusted('search');
    expect(untrusted(value)).toBe(value);
    expect(value.equals('search')).toBe(true);
    expect(value.equals(untrusted('search'))).toBe(true);
    expect(isUntrusted(value)).toBe(true);
    expect(isUntrusted({ [Symbol.for('kovo.untrusted')]: true })).toBe(false);
    const uv: UntrustedValue<string> = value;
    // @ts-expect-error an untrusted value must validate/escape before JSON payloads.
    const leak: JsonValue = uv;
    void leak;
    const compileOnly = () => {
      // @ts-expect-error Untrusted<T> uses a module-private symbol brand, not a public structural key.
      const forged: Untrusted<string> = { __kovoUntrustedBrand: Symbol('kovo.untrusted') };
      void forged;
    };
    void compileOnly;
  });
});

describe('runtime redacted PII wrapper (SPEC §6.6 defense-in-depth)', () => {
  it('renders the mask (not the raw PII) on every accidental-egress path', () => {
    const email = redacted('alice@example.com', { mask: 'a•••@example.com' });
    expect(String(email)).toBe('a•••@example.com');
    expect(`${email}`).toBe('a•••@example.com');
    expect(JSON.stringify(email)).toBe('"a•••@example.com"');
    expect(JSON.stringify({ email })).toBe('{"email":"a•••@example.com"}');
    expect(inspect(email)).toBe('a•••@example.com');
    expect(inspect({ email })).not.toContain('alice@example.com');
    expect(Object.prototype.toString.call(email)).toBe('[object Redacted]');
    expect(email.mask).toBe('a•••@example.com');
  });

  it('defaults the mask to [redacted] and reveals the real value explicitly', () => {
    const ssn = redacted('123-45-6789');
    expect(String(ssn)).toBe('[redacted]');
    expect(JSON.stringify(ssn)).not.toContain('6789');
    expect(ssn.reveal()).toBe('123-45-6789');
    expect(revealRedacted(ssn)).toBe('123-45-6789');
    expect(ssn.mask).toBe('[redacted]');
  });

  it('derives via map() preserving the mask and the redacted brand', () => {
    const name = redacted('Alice Smith', { mask: 'A.' });
    const upper = name.map((n) => n.toUpperCase());
    expect(isRedacted(upper)).toBe(true);
    expect(String(upper)).toBe('A.');
    expect(upper.reveal()).toBe('ALICE SMITH');
    expect(upper.mask).toBe('A.');
  });

  it('distinguishes redacted from secret boxes by guard, and both fail JsonValue', () => {
    const r = redacted('pii');
    const s = secret('key');
    expect(isRedacted(r)).toBe(true);
    expect(isSecret(r)).toBe(false);
    expect(isRedacted(s)).toBe(false);
    expect(isSecret(s)).toBe(true);
    const rv: RedactedValue<string> = r;
    // @ts-expect-error a redacted PII value is intentionally not a JsonValue.
    const leak: JsonValue = rv;
    void leak;
    const compileOnly = () => {
      // @ts-expect-error Redacted<T> uses a module-private symbol brand, not a public structural key.
      const forged: Redacted<string> = { __kovoRedactedBrand: Symbol('kovo.redacted') };
      void forged;
    };
    void compileOnly;
  });

  it('is idempotent and compares in constant time', () => {
    const r = redacted('tok');
    expect(redacted(r)).toBe(r);
    expect(r.equals('tok')).toBe(true);
    expect(r.equals('nope')).toBe(false);
    expect(r.equals(redacted('tok'))).toBe(true);
    expect(redacted(new Uint8Array([4, 5])).equals(new Uint8Array([4, 5]))).toBe(true);
  });
});
