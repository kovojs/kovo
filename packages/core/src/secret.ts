declare const secretBrand: unique symbol;

/**
 * Type-level marker for values classified as confidential. `Secret<T>` is
 * intentionally not assignable to `JsonValue`, so client-bound sinks reject it
 * before a secret reaches query JSON, island state, or typed failure payloads
 * (SPEC §6.2/§9.2/§10.2).
 */
export interface Secret<T> {
  readonly __kovoSecretBrand: typeof secretBrand;
  readonly __kovoSecretValue?: T;
}

/**
 * Runtime confidential value produced by {@link secret}. A `SecretValue<T>` is a
 * {@link Secret} (so the type system rejects it at every `JsonValue`-bounded
 * client boundary), and is additionally a real runtime box whose accidental-egress
 * paths are poisoned: `toString`, `JSON.stringify`/`toJSON`, template-literal and
 * arithmetic coercion, `valueOf`, and `console.log`/`util.inspect` all yield
 * `"[secret]"` rather than the wrapped value.
 *
 * This is **defense-in-depth, not a proof** (SPEC §6.6): the poison stops a value
 * leaking _accidentally_ into a log line, error payload, or serialized response;
 * it does not track values _derived_ via {@link SecretValue.reveal} (a revealed
 * string is an ordinary primitive again). The by-construction confidentiality
 * guarantee remains the static KV435 query-wire analysis.
 */
export interface SecretValue<T> extends Secret<T> {
  /**
   * Returns the wrapped value. This is the explicit, intentional un-poisoning step
   * — the analogue of `expose_secret()`. Reach for it only at the real sink (an SDK
   * call, an HMAC). The returned value is a plain primitive with no further
   * protection, so do not stash it in a long-lived variable or log it.
   */
  reveal(): T;
  /**
   * Derives a new secret from this one _without_ un-poisoning. `apiKey.map(k =>
   * k.slice(0, 4))` yields a `SecretValue<string>` for the prefix, so the derived
   * value keeps its poison instead of decaying to a bare string.
   */
  map<U>(fn: (value: T) => U): SecretValue<U>;
  /**
   * Constant-time equality against another value or secret. Use this for token /
   * signature checks instead of `reveal() === other`, which both leaks via timing
   * and un-poisons the value. Non-string operands fall back to `Object.is`.
   */
  equals(other: T | Secret<T>): boolean;
}

/** The redaction marker every poisoned coercion path yields. */
const REDACTED = '[secret]';

/**
 * Module-private runtime brand. Intentionally `Symbol()` and **not**
 * `Symbol.for(...)`: a global-registry symbol can be reconstructed by any module
 * or transitive dependency and used to forge or detect the brand. This symbol
 * never leaves the module, so {@link isSecret} cannot be spoofed and the box
 * cannot be impersonated.
 */
const secretBoxBrand: unique symbol = Symbol('kovo.secret');

const inspectCustom = Symbol.for('nodejs.util.inspect.custom');

class KovoSecret<T> {
  /** True private field: invisible to enumeration, JSON, `util.inspect`, and structuredClone. */
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
    // Non-enumerable brand so the marker never appears in spreads/Object.keys,
    // while remaining detectable by isSecret within this module.
    Object.defineProperty(this, secretBoxBrand, { value: true, enumerable: false });
  }

  reveal(): T {
    return this.#value;
  }

  map<U>(fn: (value: T) => U): SecretValue<U> {
    return secret(fn(this.#value));
  }

  equals(other: T | Secret<T>): boolean {
    const right = isSecret(other) ? revealSecret(other) : other;
    const left = this.#value;
    if (typeof left === 'string' && typeof right === 'string') {
      return timingSafeStringEqual(left, right);
    }
    return Object.is(left, right);
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  valueOf(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }

  [inspectCustom](): string {
    return REDACTED;
  }

  get [Symbol.toStringTag](): string {
    return 'Secret';
  }
}

/**
 * Wraps a confidential server-side value (an API key, access token, password, or
 * any value that must never reach a log, error payload, or the client wire) in a
 * runtime {@link SecretValue}. Idempotent: `secret(secret(x))` returns the existing
 * box. The wrapper poisons every accidental-egress coercion (see {@link SecretValue});
 * read the value back only at its sink via `.reveal()`.
 *
 * Defense-in-depth, not a by-construction proof (SPEC §6.6) — pair it with the
 * static KV435 query-wire boundary, which is the real confidentiality guarantee.
 */
export function secret<T>(value: T): SecretValue<T> {
  if (isSecret(value)) return value as unknown as SecretValue<T>;
  return Object.freeze(new KovoSecret(value)) as unknown as SecretValue<T>;
}

/**
 * Runtime guard recognizing a {@link secret} box. Framework sinks (and app code)
 * use it to detect-and-refuse a confidential value before serialization. Cannot be
 * forged: the brand is a module-private symbol.
 */
export function isSecret(value: unknown): value is SecretValue<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    (value as Record<symbol, unknown>)[secretBoxBrand] === true
  );
}

/**
 * Explicitly un-poisons a {@link secret} box and returns its value. Equivalent to
 * `s.reveal()` as a free function. A value that is typed `Secret<T>` but is not a
 * runtime box (for example a Drizzle column the static analyzer classified secret)
 * is returned unchanged.
 */
export function revealSecret<T>(value: Secret<T>): T {
  return isSecret(value) ? (value as SecretValue<T>).reveal() : (value as unknown as T);
}

/** Constant-time string compare (no early-exit on mismatch; mixes in any length difference). */
function timingSafeStringEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

/** Public method labels for audited confidentiality reveals (SPEC §6.2/§10.2). */
export type TrustedRevealMethod = 'arbitrary-fn' | 'server-projection';

/**
 * Options for {@link trustedReveal}. In statically analyzed Drizzle projections,
 * pass this as an inline object literal so `kovo explain --revealed` can make
 * the confidentiality escape hatch reviewable.
 */
export interface TrustedRevealOptions {
  /**
   * Why this confidential value is safe to expose at this projection site. Keep
   * the text reviewable and non-sensitive; it is emitted into explain output.
   */
  justification: string;
  /**
   * `server-projection` is proof-grade only when the selected expression is not
   * itself secret-classified. `arbitrary-fn` is always audit-grade.
   */
  method?: TrustedRevealMethod;
  /** Optional stable source label for explain output, such as `users.passwordHash`. */
  source?: string;
}

/** The JSON-visible value type exposed after an explicit confidentiality reveal. */
export type TrustedRevealValue<T> = T extends Secret<infer Value> ? Value : T;

/**
 * Audited confidentiality escape hatch for query projections that intentionally
 * expose a redacted or otherwise safe representation of a secret-classified value.
 *
 * The helper is an author assertion, not runtime taint tracking. The static
 * Drizzle projection analyzer recognizes direct imports of this function and
 * records the reveal for `kovo explain --revealed`; other runtime call sites are
 * type-level escapes only. Arbitrary-function reveals are audit-grade; prefer
 * server-side projections that never select the secret.
 */
export function trustedReveal<T>(value: T, options: TrustedRevealOptions): TrustedRevealValue<T> {
  if (!options.justification.trim()) {
    throw new Error('trustedReveal requires a non-empty justification.');
  }
  // Unwrap a runtime secret box so the reveal yields the value, not the poisoned
  // wrapper; a non-box value (e.g. a Drizzle column typed Secret) passes through.
  return (isSecret(value) ? revealSecret(value) : value) as TrustedRevealValue<T>;
}
