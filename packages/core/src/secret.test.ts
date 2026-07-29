import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  DeclassifyPolicy,
  declareOffWire,
  isRedacted,
  isSecret,
  isUntrusted,
  publishToClient,
  redacted,
  revealRedacted,
  revealSecret,
  revealUntrusted,
  secret,
  trustedReveal,
  untrusted,
  type Redacted,
  type RedactedValue,
  type Secret,
  type SecretValue,
  type Untrusted,
  type UntrustedValue,
} from '@kovojs/core/security';
import type { JsonValue } from './index.js';
import { drainSecretRevealAuditFacts } from './internal/security.js';

const MARKER = '[secret]';
const SECRET_REVEAL_POLICY = DeclassifyPolicy.forSecretValue({
  ownerScope: 'application',
  purpose: 'server-computation',
});
const REVEAL_SECRET_POLICY = DeclassifyPolicy.forRevealSecret({
  ownerScope: 'application',
  purpose: 'server-computation',
});
const TRUSTED_REVEAL_POLICY = DeclassifyPolicy.forTrustedReveal({
  ownerScope: 'application',
});
const UNTRUSTED_REVEAL_POLICY = DeclassifyPolicy.forUntrustedValue({
  ownerScope: 'application',
});
const REVEAL_UNTRUSTED_POLICY = DeclassifyPolicy.forRevealUntrusted({
  ownerScope: 'application',
});

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
    expect(() => structuredClone(s)).toThrow(/KV435/);
    expect(() => structuredClone({ password: s })).toThrow(/KV435/);
    expect(() => structuredClone([s])).toThrow(/KV435/);
    expect(() => structuredClone(new Map([['password', s]]))).toThrow(/KV435/);
    expect(() => structuredClone(new Set([s]))).toThrow(/KV435/);
  });

  it('cannot hide nested secrets by poisoning Array iteration after framework import', () => {
    const originalIterator = Array.prototype[Symbol.iterator];
    let arrayError: unknown;
    let objectError: unknown;
    try {
      Array.prototype[Symbol.iterator] = function () {
        return { next: () => ({ done: true, value: undefined }) } as ArrayIterator<unknown>;
      };
      try {
        structuredClone([secret('array-secret')]);
      } catch (error) {
        arrayError = error;
      }
      try {
        structuredClone({ nested: [secret('object-secret')] });
      } catch (error) {
        objectError = error;
      }
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }

    expect(String(arrayError)).toMatch(/KV435/);
    expect(String(objectError)).toMatch(/KV435/);
  });

  it('refuses structuredClone accessors without executing them', () => {
    // SPEC §6.6: recursive egress checks consume stable own-data snapshots rather
    // than invoking application accessors during a confidentiality decision.
    let reads = 0;
    const carrier = Object.defineProperty({}, 'password', {
      enumerable: true,
      get() {
        reads += 1;
        return secret('accessor-secret');
      },
    });

    expect(() => structuredClone(carrier)).toThrow(/accessor|own data/u);
    expect(reads).toBe(0);
  });

  it('bounds structuredClone confidentiality-guard work on hostile graphs', () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth <= 64; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    expect(() => structuredClone(root)).toThrow(/64-level confidentiality guard depth bound/u);

    expect(() => structuredClone(new Array(100_001))).toThrow(
      /stable array length|100000-node confidentiality guard/u,
    );
  });

  it('reveals the value only on explicit reveal()/revealSecret()', () => {
    drainSecretRevealAuditFacts();
    const s = secret('hunter2');
    expect(() => s.reveal('' as never)).toThrow(
      'secret.reveal requires a validated DeclassifyPolicy for that exact door.',
    );
    expect(s.reveal(SECRET_REVEAL_POLICY)).toBe('hunter2');
    expect(revealSecret(s, REVEAL_SECRET_POLICY)).toBe('hunter2');
    expect(drainSecretRevealAuditFacts()).toMatchObject([
      {
        door: 'secret.reveal',
        kind: 'secret-reveal',
        ownerScope: 'application',
        purpose: 'server-computation',
      },
      {
        door: 'revealSecret',
        kind: 'secret-reveal',
        ownerScope: 'application',
        purpose: 'server-computation',
      },
    ]);
  });

  it('requires a nominal exact-door policy and never executes option accessors', () => {
    const value = secret('hunter2');
    const structuralForgery = {
      door: 'secret.reveal',
      ownerScope: 'application',
      purpose: 'server-computation',
    };
    expect(() => value.reveal(structuralForgery as never)).toThrow(/validated DeclassifyPolicy/u);
    expect(() => value.reveal(REVEAL_SECRET_POLICY as never)).toThrow(/exact door/u);

    let reads = 0;
    const options = Object.defineProperty({}, 'ownerScope', {
      get() {
        reads += 1;
        return 'application';
      },
    });
    Object.defineProperty(options, 'purpose', {
      enumerable: true,
      value: 'server-computation',
    });
    expect(() => DeclassifyPolicy.forSecretValue(options as never)).toThrow(
      /exactly|own data property/u,
    );
    expect(reads).toBe(0);
  });

  it('accepts only the closed purpose and owner-scope registries for each fixed door', () => {
    const policy = DeclassifyPolicy.forRevealSecret({
      ownerScope: 'current-tenant',
      purpose: 'credential-use',
    });
    expect(policy).toMatchObject({
      door: 'revealSecret',
      ownerScope: 'current-tenant',
      purpose: 'credential-use',
    });
    expect(Object.isFrozen(policy)).toBe(true);

    for (const options of [
      { ownerScope: 'application', purpose: 'public-projection' },
      { ownerScope: 'anyone', purpose: 'credential-use' },
      {
        ownerScope: 'application',
        purpose: 'credential-use',
        reason: 'structural extension',
      },
    ]) {
      expect(() => DeclassifyPolicy.forRevealSecret(options as never)).toThrow(
        /declassif|exactly/iu,
      );
    }
    expect(() =>
      DeclassifyPolicy.forTrustedReveal({
        ownerScope: 'application',
        purpose: 'public-projection',
      } as never),
    ).toThrow(/exactly/u);
  });

  it('makes string reasons and structurally forged policies fail typechecking', () => {
    const value = secret('hunter2');
    const requestValue = untrusted('request');
    const compileOnly = (): void => {
      // @ts-expect-error SPEC §6.6: free-form reveal reasons are no longer a policy.
      value.reveal('some string');
      // @ts-expect-error SPEC §6.6: every public reveal function requires an exact-door policy.
      revealSecret(value, 'some string');
      // @ts-expect-error SPEC §6.6: trustedReveal does not accept caller-authored prose.
      trustedReveal(value, 'some string');
      // @ts-expect-error SPEC §6.6: request validation uses a closed policy, not a reason string.
      revealUntrusted(requestValue, 'some string');
      // @ts-expect-error SPEC §6.6: a structural object is not a nominal DeclassifyPolicy.
      value.reveal({
        door: 'secret.reveal',
        ownerScope: 'application',
        purpose: 'server-computation',
      });
      // @ts-expect-error fixed-purpose doors do not accept caller-authored purposes.
      DeclassifyPolicy.forTrustedReveal({
        ownerScope: 'application',
        purpose: 'public-projection',
      });
      // @ts-expect-error one door's policy cannot authorize another reveal API.
      revealSecret(
        value,
        DeclassifyPolicy.forSecretValue({
          ownerScope: 'application',
          purpose: 'server-computation',
        }),
      );
    };
    expect(compileOnly).toBeTypeOf('function');
  });

  it('pins secret reveal audit timestamps against late Date replacement', () => {
    drainSecretRevealAuditFacts();
    const NativeDate = globalThis.Date;
    const originalToISOString = NativeDate.prototype.toISOString;
    try {
      globalThis.Date = function PoisonedDate() {
        return new NativeDate(0);
      } as unknown as DateConstructor;
      NativeDate.prototype.toISOString = () => 'forged-date';
      secret('hunter2').reveal(SECRET_REVEAL_POLICY);
    } finally {
      globalThis.Date = NativeDate;
      NativeDate.prototype.toISOString = originalToISOString;
    }
    const [fact] = drainSecretRevealAuditFacts();
    expect(fact?.revealedAt).not.toBe('forged-date');
    expect(NativeDate.parse(fact?.revealedAt ?? '')).not.toBeNaN();
  });

  it('bounds request-time reveal observations to the newest 256 facts', () => {
    drainSecretRevealAuditFacts();
    const value = secret('bounded');
    for (let index = 0; index < 10_000; index += 1) {
      value.reveal(SECRET_REVEAL_POLICY);
    }

    const facts = drainSecretRevealAuditFacts();
    expect(facts).toHaveLength(256);
    expect(facts[0]).toMatchObject({ reason: 'server-computation:secret.reveal:application' });
    expect(facts.at(-1)).toMatchObject({ reason: 'server-computation:secret.reveal:application' });
    expect(drainSecretRevealAuditFacts()).toEqual([]);
  });

  it('derives via map() without un-poisoning', () => {
    const key = secret('sk_live_abcdef');
    const prefix = key.map((k) => k.slice(0, 7));
    expect(isSecret(prefix)).toBe(true);
    expect(() => String(prefix)).toThrow(/KV435/);
    expect(prefix.reveal(SECRET_REVEAL_POLICY)).toBe('sk_live');
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

  it('keeps secret equality pinned after byte encoder, view, and iterator poisoning', () => {
    const stringToken = secret('correct-token');
    const byteToken = secret(new Uint8Array([1, 2, 3, 4]));
    const originalEncode = TextEncoder.prototype.encode;
    const originalIsView = ArrayBuffer.isView;
    const originalIterator = Uint8Array.prototype[Symbol.iterator];
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const bufferDescriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer');
    let validString = false;
    let invalidString = true;
    let validBytes = false;
    let invalidBytes = true;
    try {
      TextEncoder.prototype.encode = () => new Uint8Array();
      ArrayBuffer.isView = (() => false) as typeof ArrayBuffer.isView;
      Uint8Array.prototype[Symbol.iterator] = function () {
        return { next: () => ({ done: true, value: undefined }) } as ArrayIterator<number>;
      };
      Object.defineProperty(typedArrayPrototype, 'buffer', {
        configurable: true,
        get: () => new ArrayBuffer(0),
      });

      validString = stringToken.equals('correct-token');
      invalidString = stringToken.equals('forged-token!');
      validBytes = byteToken.equals(new Uint8Array([1, 2, 3, 4]));
      invalidBytes = byteToken.equals(new Uint8Array([9, 9, 9, 9]));
    } finally {
      TextEncoder.prototype.encode = originalEncode;
      ArrayBuffer.isView = originalIsView;
      Uint8Array.prototype[Symbol.iterator] = originalIterator;
      if (bufferDescriptor) {
        Object.defineProperty(typedArrayPrototype, 'buffer', bufferDescriptor);
      }
    }

    expect(validString).toBe(true);
    expect(invalidString).toBe(false);
    expect(validBytes).toBe(true);
    expect(invalidBytes).toBe(false);
  });

  it('does not accept a forged token after late typed-array length poisoning', () => {
    const token = secret('correct-token');
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length');
    let forgedAccepted = true;
    try {
      Object.defineProperty(typedArrayPrototype, 'length', {
        configurable: true,
        get: () => 0,
      });
      forgedAccepted = token.equals('forged-token!');
    } finally {
      if (lengthDescriptor !== undefined) {
        Object.defineProperty(typedArrayPrototype, 'length', lengthDescriptor);
      }
    }

    expect(forgedAccepted).toBe(false);
  });

  it('is idempotent: secret(secret(x)) does not double-wrap', () => {
    const inner = secret('x');
    expect(secret(inner)).toBe(inner);
    expect(secret(inner).reveal(SECRET_REVEAL_POLICY)).toBe('x');
  });

  it('isSecret recognizes only module-registered boxes', () => {
    expect(isSecret(secret('x'))).toBe(true);
    expect(isSecret('x')).toBe(false);
    expect(isSecret(null)).toBe(false);
    expect(isSecret({})).toBe(false);
    const forged = { [Symbol.for('kovo.secret')]: true };
    expect(isSecret(forged)).toBe(false);
  });

  it('rejects a known-symbol forgery after import-order Symbol poisoning', async () => {
    const NativeSymbol = globalThis.Symbol;
    const attackerBrand = NativeSymbol.for('attacker-known-secret-brand');
    const poisonedSymbol = new Proxy(NativeSymbol, {
      apply(target, receiver, args) {
        if (args[0] === 'kovo.secret') return attackerBrand;
        return Reflect.apply(target, receiver, args);
      },
    });
    let isolated: typeof import('./secret.js');
    try {
      globalThis.Symbol = poisonedSymbol;
      isolated = await import('./secret.js?poisoned-secret-symbol');
    } finally {
      globalThis.Symbol = NativeSymbol;
    }

    const forged = {
      [attackerBrand]: 'secret',
      reveal: () => 'forged-secret',
    };
    expect(isolated.isSecret(forged)).toBe(false);
    expect(isolated.isSecret(isolated.secret('real-secret'))).toBe(true);
  });

  it('revealSecret passes a non-box Secret-typed value through unchanged', () => {
    // A Drizzle column is typed Secret<T> but is a raw value at runtime.
    const rawColumn = 'plain-hash' as unknown as Secret<string>;
    expect(revealSecret(rawColumn, REVEAL_SECRET_POLICY)).toBe('plain-hash');
  });

  it('trustedReveal unwraps a runtime box', () => {
    const s = secret('hunter2');
    expect(trustedReveal(s, TRUSTED_REVEAL_POLICY)).toBe('hunter2');
  });

  it('declareOffWire runs a justified server-only block without returning a value', () => {
    const calls: string[] = [];
    const result = declareOffWire(
      () => {
        calls.push(revealSecret(secret('server-only-token'), REVEAL_SECRET_POLICY));
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
    expect(() => value.reveal('' as never)).toThrow(
      'untrusted.reveal requires a validated DeclassifyPolicy for that exact door.',
    );
    expect(value.reveal(UNTRUSTED_REVEAL_POLICY)).toBe('Ada Lovelace');
    const first = value.map((name) => name.split(' ')[0]);
    expect(isUntrusted(first)).toBe(true);
    expect(first.reveal(UNTRUSTED_REVEAL_POLICY)).toBe('Ada');
    expect(revealUntrusted(first, REVEAL_UNTRUSTED_POLICY)).toBe('Ada');
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
  it('keeps publishToClient author-time construction value-only', () => {
    const callable = (value: string): string => value;
    class Constructable {}
    const callableIntersection = callable as typeof callable & { label: string };
    const unknownValue: unknown = 'public';
    const compileOnly = (): void => {
      // @ts-expect-error publishToClient is a primitive-data escape, never callable authority.
      publishToClient(callable, { reason: 'functions require reviewed executable identity' });
      // @ts-expect-error constructable values cannot cross the audited value-only escape.
      publishToClient(Constructable, { reason: 'classes require reviewed executable identity' });
      // @ts-expect-error objects can carry accessors, proxies, coercion hooks, and nested callables.
      publishToClient({ public: 'value' }, { reason: 'objects are not primitive data' });
      // @ts-expect-error arrays are objects and can carry iterators and prototype authority.
      publishToClient(['public'], { reason: 'arrays are not primitive data' });
      // @ts-expect-error callable intersections remain callable authority.
      publishToClient(callableIntersection, { reason: 'intersections do not erase authority' });
      // @ts-expect-error unknown must be narrowed to the exact primitive union first.
      publishToClient(unknownValue, { reason: 'unknown is not proven primitive data' });
      // @ts-expect-error nested values require an object carrier, which this API refuses.
      publishToClient({ nested: 'public' }, { reason: 'nested data is not a primitive' });
      // @ts-expect-error bigint is outside the compiler-snapshottable literal grammar.
      publishToClient(1n, { reason: 'bigint is outside the emitted literal grammar' });
      // @ts-expect-error undefined is not an explicit snapshottable publication value.
      publishToClient(undefined, { reason: 'undefined is outside the emitted literal grammar' });
    };
    void compileOnly;

    expect(publishToClient('public', { reason: 'ordinary public value' })).toBe('public');
    expect(publishToClient(1, { reason: 'ordinary public value' })).toBe(1);
    expect(publishToClient(true, { reason: 'ordinary public value' })).toBe(true);
    expect(publishToClient(null, { reason: 'ordinary public value' })).toBeNull();
  });

  it('rejects non-primitive authority at runtime without inspecting it', () => {
    const erasedPublish = publishToClient as (
      value: unknown,
      options: { reason: string },
    ) => unknown;
    let authorityExecuted = false;
    const callableProxy = new Proxy(() => 'public', {});
    const objectProxy = new Proxy(
      { public: 'value' },
      {
        get: () => {
          authorityExecuted = true;
          throw new Error('proxy get executed');
        },
        ownKeys: () => {
          authorityExecuted = true;
          throw new Error('proxy ownKeys executed');
        },
      },
    );
    const accessor = Object.defineProperty({}, 'public', {
      get: () => {
        authorityExecuted = true;
        throw new Error('accessor executed');
      },
    });
    class Constructable {}
    const anyObject: any = { nested: () => 'public' };

    for (const value of [
      () => 'public',
      callableProxy,
      Constructable,
      objectProxy,
      accessor,
      Object.freeze({ nested: () => 'public' }),
      ['public'],
      Symbol('public'),
      1n,
      undefined,
      anyObject,
    ]) {
      expect(() => erasedPublish(value, { reason: 'attempted callable publication' })).toThrow(
        'publishToClient accepts only string, number, boolean, or null.',
      );
    }
    expect(authorityExecuted).toBe(false);
  });

  it('does not inherit redaction masks or audited escape reasons from Object.prototype', () => {
    Object.defineProperties(Object.prototype, {
      mask: { configurable: true, value: 'inherited-mask' },
      reason: { configurable: true, value: 'inherited publish reason' },
    });
    try {
      expect(String(redacted('pii', {}))).toBe('[redacted]');
      expect(() => publishToClient('public', {} as { reason: string })).toThrow(
        'publishToClient requires a non-empty reason.',
      );
    } finally {
      delete (Object.prototype as { mask?: unknown }).mask;
      delete (Object.prototype as { reason?: unknown }).reason;
    }
  });

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
