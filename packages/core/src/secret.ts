declare const secretBrand: unique symbol;
declare const untrustedBrand: unique symbol;

/**
 * Type-level marker for values classified as confidential. `Secret<T>` is an
 * author-time guardrail; runtime egress chokes and non-coercible boxes own the
 * enforcement boundary (SPEC §10.2/§11.2).
 */
export interface Secret<T> {
  readonly [secretBrand]: {
    readonly kind: 'secret';
    readonly value: T;
  };
  /** Keeps `Secret<T>` outside JsonValue; not a trust proof (SPEC §6.6). */
  readonly __kovoSecretJsonBoundary?: undefined;
}

/**
 * Runtime confidential value produced by {@link secret}. A `SecretValue<T>` is a
 * non-coercible runtime box: string conversion, JSON conversion, numeric
 * conversion, template literals, and accidental concatenation throw instead of
 * laundering the tag off. `util.inspect` renders a fixed redaction marker so
 * `console.log(secret(...))` stays non-leaking.
 */
export interface SecretValue<T> extends Secret<T> {
  /**
   * Returns the wrapped value after a reviewable justification. The returned value
   * is an ordinary primitive/object with no further runtime tag.
   */
  reveal(reason: SecretRevealReason): T;
  /**
   * Derives a new secret from this one _without_ un-poisoning. `apiKey.map(k =>
   * k.slice(0, 4))` yields a `SecretValue<string>` for the prefix, so the derived
   * value keeps its poison instead of decaying to a bare string.
   */
  map<U>(fn: (value: T) => U): SecretValue<U>;
  /**
   * Constant-time equality against another value or secret. Use this for token /
   * signature checks instead of `reveal() === other`, which both leaks via timing
   * and un-poisons the value. Strings and byte-like operands compare through a
   * fixed-width digest; other operands fall back to `Object.is`.
   */
  equals(other: T | Secret<T>): boolean;
}

/** Reviewable reason text for explicitly unboxing a confidential value. */
export type SecretRevealReason = string | { readonly justification: string };

/**
 * Audit record emitted whenever a runtime {@link SecretValue} is explicitly revealed.
 *
 * Audit-only: this records that an author intentionally unboxed a secret; it is not a
 * confidentiality proof and does not authorize a later sink.
 */
export interface SecretRevealAuditFact {
  kind: 'secret-reveal';
  reason: string;
  revealedAt: string;
}

const secretRevealAuditFacts: SecretRevealAuditFact[] = [];

/**
 * Type-level marker for request-derived or otherwise untrusted values. This tag
 * is DX/provenance only; contextual render and protocol chokes remain the
 * enforcement boundary (SPEC §5.2 rule 11).
 */
export interface Untrusted<T> {
  readonly [untrustedBrand]: {
    readonly kind: 'untrusted';
    readonly value: T;
  };
  /** Keeps `Untrusted<T>` outside JsonValue until it is validated or escaped. */
  readonly __kovoUntrustedJsonBoundary?: undefined;
}

/** Runtime non-coercible value produced by {@link untrusted}. */
export interface UntrustedValue<T> extends Untrusted<T> {
  /** Returns the wrapped value after a reviewable validation/escaping reason. */
  reveal(reason: SecretRevealReason): T;
  /** Derives another untrusted value without losing provenance. */
  map<U>(fn: (value: T) => U): UntrustedValue<U>;
  /** Constant-time equality for string/byte-like values where possible. */
  equals(other: T | Untrusted<T>): boolean;
}

/** The redaction marker every poisoned coercion path yields. */
const REDACTED = '[secret]';
const UNTRUSTED_REDACTED = '[untrusted]';

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

type NodeBuiltinLoader = (
  id: string,
) => { markAsUncloneable?: (value: object) => void } | undefined;

const maybeMarkAsUncloneable = (() => {
  const loader = (
    globalThis as typeof globalThis & {
      process?: { getBuiltinModule?: NodeBuiltinLoader };
    }
  ).process?.getBuiltinModule;
  return loader?.('node:worker_threads')?.markAsUncloneable;
})();

const structuredCloneSecretGuard = Symbol.for('kovo.secret.structuredCloneGuard');

type PoisonKind = 'secret' | 'redacted' | 'untrusted';

/**
 * Shared runtime poison box backing both {@link secret} and {@link redacted}. The
 * box holds the value in a true private field and renders `#poison` (a fixed,
 * safe-to-display string) on every accidental-egress coercion. The brand symbol's
 * value carries the kind so the guards can distinguish a secret from a redacted box.
 */
class KovoPoisonBox<T> {
  /**
   * True private field: invisible to enumeration, JSON, and `util.inspect`.
   * On Node runtimes with `markAsUncloneable()`, the box also fails closed at
   * `structuredClone()` instead of laundering to `{}` (SPEC §6.6).
   */
  readonly #value: T;
  readonly #poison: string;
  readonly #kind: PoisonKind;

  constructor(value: T, poison: string, kind: PoisonKind) {
    this.#value = value;
    this.#poison = poison;
    this.#kind = kind;
    maybeMarkAsUncloneable?.(this);
    // Non-enumerable brand (value = kind) so the marker never appears in
    // spreads/Object.keys, while remaining detectable by the guards in-module.
    Object.defineProperty(this, secretBoxBrand, { value: kind, enumerable: false });
  }

  reveal(reason?: SecretRevealReason): T {
    if (this.#kind === 'secret' || this.#kind === 'untrusted') validateRevealReason(reason);
    if (this.#kind === 'secret') recordSecretReveal(reason);
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
    const right = isPoisonBox(other) ? (other as KovoPoisonBox<T>).#value : other;
    const left = this.#value;
    const leftComparable = comparableBytes(left);
    const rightComparable = comparableBytes(right);
    if (leftComparable && rightComparable) {
      if (leftComparable.kind !== rightComparable.kind) return false;
      return fixedDigestEqual(leftComparable, rightComparable);
    }
    return Object.is(left, right);
  }

  toString(): string {
    if (this.#kind !== 'redacted') throw nonCoercibleError(this.#kind, 'toString');
    return this.#poison;
  }

  toJSON(): string {
    if (this.#kind !== 'redacted') throw nonCoercibleError(this.#kind, 'JSON.stringify');
    return this.#poison;
  }

  valueOf(): string {
    if (this.#kind !== 'redacted') throw nonCoercibleError(this.#kind, 'valueOf');
    return this.#poison;
  }

  [Symbol.toPrimitive](): string {
    if (this.#kind !== 'redacted') throw nonCoercibleError(this.#kind, 'coercion');
    return this.#poison;
  }

  [inspectCustom](): string {
    return this.#poison;
  }

  get [Symbol.toStringTag](): string {
    if (this.#kind === 'secret') return 'Secret';
    if (this.#kind === 'untrusted') return 'Untrusted';
    return 'Redacted';
  }
}

/** Internal: any poison box (secret or redacted). */
function isPoisonBox(value: unknown): value is KovoPoisonBox<unknown> {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  const brand = (value as Record<symbol, unknown>)[secretBoxBrand];
  return brand === 'secret' || brand === 'redacted' || brand === 'untrusted';
}

/**
 * Wraps a confidential server-side value in a runtime {@link SecretValue}. The
 * box is non-coercible and can be unboxed only through an audited reveal.
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
    isPoisonBox(value) && (value as unknown as Record<symbol, unknown>)[secretBoxBrand] === 'secret'
  );
}

installStructuredCloneSecretGuard();

function installStructuredCloneSecretGuard(): void {
  const globalClone = globalThis as typeof globalThis & {
    [structuredCloneSecretGuard]?: true;
    structuredClone?: (value: unknown, options?: unknown) => unknown;
  };
  if (globalClone[structuredCloneSecretGuard] === true) return;
  const nativeStructuredClone = globalClone.structuredClone;
  if (typeof nativeStructuredClone !== 'function') return;
  globalClone.structuredClone = (value: unknown, options?: unknown): unknown => {
    assertNoSecretStructuredCloneValue(value);
    return nativeStructuredClone(value, options);
  };
  Object.defineProperty(globalClone, structuredCloneSecretGuard, {
    configurable: false,
    enumerable: false,
    value: true,
  });
}

function assertNoSecretStructuredCloneValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (isSecret(value)) throw nonCoercibleError('secret', 'structuredClone');
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretStructuredCloneValue(item, seen);
    return;
  }
  if (value instanceof Map) {
    for (const [key, item] of value) {
      assertNoSecretStructuredCloneValue(key, seen);
      assertNoSecretStructuredCloneValue(item, seen);
    }
    return;
  }
  if (value instanceof Set) {
    for (const item of value) assertNoSecretStructuredCloneValue(item, seen);
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    assertNoSecretStructuredCloneValue((value as Record<string, unknown>)[key], seen);
  }
  if (value instanceof Error && 'cause' in value) {
    assertNoSecretStructuredCloneValue((value as { cause?: unknown }).cause, seen);
  }
}

/**
 * Explicitly unboxes a {@link secret} box and returns its value. A value that is
 * typed `Secret<T>` but is not a runtime box is returned unchanged.
 */
export function revealSecret<T>(value: Secret<T>, reason: SecretRevealReason): T {
  return isSecret(value) ? (value as SecretValue<T>).reveal(reason) : (value as unknown as T);
}

/**
 * Drain the runtime Secret reveal audit records collected in this process.
 *
 * Framework audit/explain integrations use this to make reveal-then-write paths reviewable
 * (SPEC §10.3). Draining is destructive so tests and request-scoped collectors can snapshot
 * only the facts produced by the operation they are proving.
 */
export function drainSecretRevealAuditFacts(): SecretRevealAuditFact[] {
  return secretRevealAuditFacts.splice(0);
}

/** Wraps a request-derived value in a non-coercible DX provenance tag. */
export function untrusted<T>(value: T): UntrustedValue<T> {
  if (isUntrusted(value)) return value as unknown as UntrustedValue<T>;
  return Object.freeze(
    new KovoPoisonBox(value, UNTRUSTED_REDACTED, 'untrusted'),
  ) as unknown as UntrustedValue<T>;
}

/** Runtime guard recognizing an {@link untrusted} box. */
export function isUntrusted(value: unknown): value is UntrustedValue<unknown> {
  return (
    isPoisonBox(value) &&
    (value as unknown as Record<symbol, unknown>)[secretBoxBrand] === 'untrusted'
  );
}

/** Explicitly unboxes an {@link untrusted} value after a validation/escaping reason. */
export function revealUntrusted<T>(value: Untrusted<T>, reason: SecretRevealReason): T {
  return isUntrusted(value) ? (value as UntrustedValue<T>).reveal(reason) : (value as unknown as T);
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
  readonly [redactedBrand]: {
    readonly kind: 'redacted';
    readonly value: T;
  };
  /** Keeps `Redacted<T>` outside JsonValue; not a trust proof (SPEC §6.6). */
  readonly __kovoRedactedJsonBoundary?: undefined;
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

function validateRevealReason(reason: SecretRevealReason | undefined): void {
  const text = typeof reason === 'string' ? reason : reason?.justification;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Secret/Untrusted reveal requires a non-empty justification.');
  }
}

function recordSecretReveal(reason: SecretRevealReason | undefined): void {
  const text = typeof reason === 'string' ? reason : reason?.justification;
  secretRevealAuditFacts.push({
    kind: 'secret-reveal',
    reason: text?.trim() ?? '<missing>',
    revealedAt: new Date().toISOString(),
  });
}

function nonCoercibleError(kind: Exclude<PoisonKind, 'redacted'>, operation: string): Error {
  const code = kind === 'secret' ? 'KV435' : 'KV426';
  return new Error(
    `${code}: ${kind} value cannot be coerced via ${operation}; reveal it explicitly.`,
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
 * Options for {@link declareOffWire}. The justification is emitted into source review and must
 * explain why the wrapped server-only computation cannot affect the client wire.
 */
export interface DeclareOffWireOptions {
  /** Reviewable, non-sensitive reason this block is intentionally server-only/off-wire. */
  justification: string;
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

/**
 * Audited declaration that a server-side computation using confidential values is intentionally
 * off the client wire (SPEC §6.2/§10.2/§11.3).
 *
 * This is not a runtime taint proof and it does not return a value, deliberately: the wrapped block
 * cannot be assigned and later returned to the client. Static analyzers may recognize the call as a
 * reviewable escape for helper calls that touch secret projections but do not affect the query or
 * mutation response.
 */
export function declareOffWire(run: () => void, options: DeclareOffWireOptions): void {
  if (!options.justification.trim()) {
    throw new Error('declareOffWire requires a non-empty justification.');
  }
  run();
}

interface ComparableBytes {
  readonly bytes: Uint8Array;
  readonly kind: 'bytes' | 'string';
}

function comparableBytes(value: unknown): ComparableBytes | null {
  if (typeof value === 'string') return { bytes: new TextEncoder().encode(value), kind: 'string' };
  if (value instanceof ArrayBuffer) return { bytes: new Uint8Array(value), kind: 'bytes' };
  if (ArrayBuffer.isView(value)) {
    return {
      bytes: new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      kind: 'bytes',
    };
  }
  return null;
}

function fixedDigestEqual(left: ComparableBytes, right: ComparableBytes): boolean {
  const leftDigest = digestComparableBytes(left);
  const rightDigest = digestComparableBytes(right);
  let mismatch = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    mismatch |= (leftDigest[index] ?? 0) ^ (rightDigest[index] ?? 0);
  }
  return mismatch === 0;
}

function digestComparableBytes(value: ComparableBytes): Uint8Array {
  const state = new Uint32Array([
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5,
  ]);
  digestByte(state, value.kind === 'string' ? 0x73 : 0x62);
  digestByte(state, 0);
  for (const byte of value.bytes) digestByte(state, byte);

  const digest = new Uint8Array(32);
  const view = new DataView(digest.buffer);
  for (let index = 0; index < state.length; index += 1) {
    view.setUint32(index * 4, state[index] ?? 0, true);
  }
  return digest;
}

function digestByte(state: Uint32Array, byte: number): void {
  for (let index = 0; index < state.length; index += 1) {
    const previous = state[index] ?? 0;
    const mixed = Math.imul(previous ^ ((byte + index * 0x9e) & 0xff), 0x01000193);
    state[index] = (mixed ^ (mixed >>> 13) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
  }
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
  return (
    isSecret(value) ? revealSecret(value, { justification: options.justification }) : value
  ) as TrustedRevealValue<T>;
}
