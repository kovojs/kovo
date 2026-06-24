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

/** Default poison output for {@link redacted} when no mask is supplied. */
const REDACTED_MASK = '[redacted]';

type PoisonKind = 'secret' | 'redacted';

/**
 * Shared runtime poison box backing both {@link secret} and {@link redacted}. The
 * box holds the value in a true private field and renders `#poison` (a fixed,
 * safe-to-display string) on every accidental-egress coercion. The brand symbol's
 * value carries the kind so the guards can distinguish a secret from a redacted box.
 */
class KovoPoisonBox<T> {
  /** True private field: invisible to enumeration, JSON, `util.inspect`, and structuredClone. */
  readonly #value: T;
  readonly #poison: string;
  readonly #kind: PoisonKind;

  constructor(value: T, poison: string, kind: PoisonKind) {
    this.#value = value;
    this.#poison = poison;
    this.#kind = kind;
    // Non-enumerable brand (value = kind) so the marker never appears in
    // spreads/Object.keys, while remaining detectable by the guards in-module.
    Object.defineProperty(this, secretBoxBrand, { value: kind, enumerable: false });
  }

  reveal(): T {
    return this.#value;
  }

  /** The masked/poison display form; exposed publicly only on {@link RedactedValue}. */
  get mask(): string {
    return this.#poison;
  }

  map<U>(fn: (value: T) => U): KovoPoisonBox<U> {
    return Object.freeze(
      new KovoPoisonBox(fn(this.#value), this.#poison, this.#kind),
    ) as unknown as KovoPoisonBox<U>;
  }

  equals(other: unknown): boolean {
    const right = isPoisonBox(other) ? (other as KovoPoisonBox<T>).reveal() : other;
    const left = this.#value;
    if (typeof left === 'string' && typeof right === 'string') {
      return timingSafeStringEqual(left, right);
    }
    return Object.is(left, right);
  }

  toString(): string {
    return this.#poison;
  }

  toJSON(): string {
    return this.#poison;
  }

  valueOf(): string {
    return this.#poison;
  }

  [Symbol.toPrimitive](): string {
    return this.#poison;
  }

  [inspectCustom](): string {
    return this.#poison;
  }

  get [Symbol.toStringTag](): string {
    return this.#kind === 'secret' ? 'Secret' : 'Redacted';
  }
}

/** Internal: any poison box (secret or redacted). */
function isPoisonBox(value: unknown): value is KovoPoisonBox<unknown> {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  const brand = (value as Record<symbol, unknown>)[secretBoxBrand];
  return brand === 'secret' || brand === 'redacted';
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
  return Object.freeze(new KovoPoisonBox(value, REDACTED, 'secret')) as unknown as SecretValue<T>;
}

/**
 * Runtime guard recognizing a {@link secret} box. Framework sinks (and app code)
 * use it to detect-and-refuse a confidential value before serialization. Cannot be
 * forged: the brand is a module-private symbol. Returns `false` for a {@link redacted}
 * box — use {@link isRedacted} for that.
 */
export function isSecret(value: unknown): value is SecretValue<unknown> {
  return (
    isPoisonBox(value) &&
    (value as unknown as Record<symbol, unknown>)[secretBoxBrand] === 'secret'
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

declare const redactedBrand: unique symbol;

/**
 * Type-level marker for personally-identifiable or otherwise sensitive values that
 * **may legitimately travel** to the database, client, or UI, but must never appear
 * verbatim in a log line or error payload. Like {@link Secret}, a `Redacted<T>` is
 * intentionally not assignable to `JsonValue`, so reaching a client-bound sink with
 * the raw box is a type error — send `.reveal()` (the real value) or `.mask` (the
 * safe display form) explicitly.
 */
export interface Redacted<T> {
  readonly __kovoRedactedBrand: typeof redactedBrand;
  readonly __kovoRedactedValue?: T;
}

/**
 * Runtime PII wrapper produced by {@link redacted}. Distinct from {@link SecretValue}
 * in policy, not mechanism: a redacted value renders its `mask` (a safe-to-display
 * partial such as `j•••@example.com`, default `"[redacted]"`) on every accidental-egress
 * path (`toString`/`JSON.stringify`/coercion/`util.inspect`), so logs and error payloads
 * show the mask, never the raw PII — while `.reveal()` returns the real value for the
 * DB/render path that legitimately needs it. Defense-in-depth, not a proof (SPEC §6.6).
 */
export interface RedactedValue<T> extends Redacted<T> {
  /** Returns the real (unmasked) value — the explicit reveal at a DB/render sink. */
  reveal(): T;
  /** The safe-to-display masked representation (what every poisoned coercion yields). */
  readonly mask: string;
  /** Derives a new redacted value, preserving the mask, without un-poisoning. */
  map<U>(fn: (value: T) => U): RedactedValue<U>;
  /** Constant-time equality against another value or redacted/secret box. */
  equals(other: T | Redacted<T> | Secret<T>): boolean;
}

/** Options for {@link redacted}. */
export interface RedactedOptions {
  /**
   * The safe-to-display mask rendered on every accidental-egress path. Defaults to
   * `"[redacted]"`. Provide a partial reveal (e.g. last 4 digits, a masked email) that
   * is genuinely safe to log and show.
   */
  mask?: string;
}

/**
 * Wraps a PII / sensitive value that legitimately travels to the database, client, or
 * UI but must never be logged or surfaced in an error verbatim. The box renders its
 * {@link RedactedOptions.mask} (default `"[redacted]"`) on every accidental coercion;
 * call `.reveal()` at the DB/render sink that needs the real value. Idempotent.
 *
 * Sibling of {@link secret}: `secret` is for values that must never leave the server
 * (API keys, tokens); `redacted` is for values that DO travel but must not leak into
 * logs (emails, names, card suffixes). Both are defense-in-depth (SPEC §6.6), not the
 * by-construction confidentiality proof (KV435).
 */
export function redacted<T>(value: T, options: RedactedOptions = {}): RedactedValue<T> {
  if (isRedacted(value)) return value as unknown as RedactedValue<T>;
  const box = new KovoPoisonBox(value, options.mask ?? REDACTED_MASK, 'redacted');
  return Object.freeze(box) as unknown as RedactedValue<T>;
}

/**
 * Runtime guard recognizing a {@link redacted} box. Returns `false` for a {@link secret}
 * box. Cannot be forged: the brand is a module-private symbol.
 */
export function isRedacted(value: unknown): value is RedactedValue<unknown> {
  return (
    isPoisonBox(value) &&
    (value as unknown as Record<symbol, unknown>)[secretBoxBrand] === 'redacted'
  );
}

/** Explicitly un-masks a {@link redacted} box and returns its real value. */
export function revealRedacted<T>(value: Redacted<T>): T {
  return isRedacted(value) ? (value as RedactedValue<T>).reveal() : (value as unknown as T);
}

/** Options for {@link publishToClient}. */
export interface PublishToClientOptions {
  /**
   * Why this captured cross-module value is safe to ship into the client bundle. Keep the text
   * reviewable and non-sensitive; the compiler records it (with the capture site) for
   * `kovo explain --capabilities`.
   */
  reason: string;
}

/**
 * Audited escape for the client-handler secret-emit gate (SPEC §6.6/§6.2; secure-framework Phase 4 /
 * Tier 0 item 3, KV437).
 *
 * A client event handler that captures a cross-module import in **value position**
 * (`() => sendPayment(STRIPE_SECRET_KEY)`) would otherwise leak the binding's evaluated value into
 * the browser bundle, so the compiler refuses to emit it (fail-closed, whole-channel). Wrapping the
 * value in `publishToClient(value, { reason })` is an explicit author assertion — **audit-grade,
 * NOT statically verified** — that this specific value is safe to ship. The compiler then allows the
 * capture to emit and records the site + reason for `kovo explain --capabilities`.
 *
 * This is the analogue of {@link trustedReveal} for the closure-capture channel: an assertion the
 * reviewer can see, not a proof. Reach for it only for genuinely public values the handler needs in
 * the browser (a publishable Stripe key, a public base URL); never to ship a real secret.
 *
 * Runtime behavior is identity: it returns `value` unchanged. The wrapper exists for the compiler's
 * static recognition and for the audit ledger, not to transform the value.
 */
export function publishToClient<T>(value: T, options: PublishToClientOptions): T {
  if (!options.reason.trim()) {
    throw new Error('publishToClient requires a non-empty reason.');
  }
  return value;
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
