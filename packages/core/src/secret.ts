import { createBoundedRuntimeAuditCollector } from './internal/security-markers.js';
import { snapshotAuditText } from './internal/audit-text.js';
import {
  freezeSecurityValue,
  securityApply,
  securityIsArray,
  securityIsError,
  securityIsMap,
  securityIsSet,
  securityHasInstance,
  securityGetOwnPropertyDescriptor,
  securityGetPrototypeOf,
  securityMapForEach,
  securityObjectIs,
  securityObjectKeys,
  securitySetForEach,
  securityStringTrim,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetHas,
} from '#security-witness-intrinsics';

const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicDate = Date;
const IntrinsicDataView = DataView;
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicUint8Array = Uint8Array;
const intrinsicArrayBufferIsView = IntrinsicArrayBuffer.isView;
const intrinsicDateToISOString = IntrinsicDate.prototype.toISOString;
const comparableTextEncoder = new IntrinsicTextEncoder();
const intrinsicTextEncoderEncode = IntrinsicTextEncoder.prototype.encode;
const typedArrayPrototype = securityGetPrototypeOf(IntrinsicUint8Array.prototype);
const intrinsicTypedArrayBuffer =
  typedArrayPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
const intrinsicTypedArrayByteOffset =
  typedArrayPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')?.get;
const intrinsicTypedArrayByteLength =
  typedArrayPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const intrinsicDataViewBuffer = securityGetOwnPropertyDescriptor(
  IntrinsicDataView.prototype,
  'buffer',
)?.get;
const intrinsicDataViewByteOffset = securityGetOwnPropertyDescriptor(
  IntrinsicDataView.prototype,
  'byteOffset',
)?.get;
const intrinsicDataViewByteLength = securityGetOwnPropertyDescriptor(
  IntrinsicDataView.prototype,
  'byteLength',
)?.get;
const capturedComparableByteControlsSound = verifyComparableByteControls();

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

const secretRevealAuditFacts = createBoundedRuntimeAuditCollector<SecretRevealAuditFact>();

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

type PoisonKind = 'secret' | 'redacted' | 'untrusted';
const poisonBoxKinds = securityWeakMap<object, PoisonKind>();

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
    securityWeakMapSet(poisonBoxKinds, this, kind);
  }

  reveal(reason?: SecretRevealReason): T {
    const revealReason =
      this.#kind === 'secret' || this.#kind === 'untrusted'
        ? validateRevealReason(reason)
        : undefined;
    if (this.#kind === 'secret') recordSecretReveal(revealReason!);
    return this.#value;
  }

  /** The masked/poison display form; exposed publicly only on {@link RedactedValue}. */
  get mask(): string {
    return this.#poison;
  }

  map<U>(fn: (value: T) => U): KovoPoisonBox<U> {
    return freezeSecurityValue(
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
    return securityObjectIs(left, right);
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
  return securityWeakMapGet(poisonBoxKinds, value) !== undefined;
}

function poisonBoxKind(value: unknown): PoisonKind | undefined {
  return isPoisonBox(value) ? securityWeakMapGet(poisonBoxKinds, value) : undefined;
}

/**
 * Wraps a confidential server-side value in a runtime {@link SecretValue}. The
 * box is non-coercible and can be unboxed only through an audited reveal.
 */
export function secret<T>(value: T): SecretValue<T> {
  if (isSecret(value)) return value as unknown as SecretValue<T>;
  return freezeSecurityValue(
    new KovoPoisonBox(value, REDACTED, 'secret'),
  ) as unknown as SecretValue<T>;
}

/**
 * Runtime guard recognizing a {@link secret} box. Framework sinks (and app code)
 * use it to detect-and-refuse a confidential value before serialization. Cannot be
 * forged: the brand is a module-private symbol. Returns `false` for a {@link redacted}
 * box — use {@link isRedacted} for that.
 */
export function isSecret(value: unknown): value is SecretValue<unknown> {
  return poisonBoxKind(value) === 'secret';
}

installStructuredCloneSecretGuard();

function installStructuredCloneSecretGuard(): void {
  const globalClone = globalThis as typeof globalThis & {
    structuredClone?: (value: unknown, options?: unknown) => unknown;
  };
  const nativeStructuredClone = globalClone.structuredClone;
  if (typeof nativeStructuredClone !== 'function') return;
  // SPEC §6.6: a Symbol.for/global marker is app-forgeable and therefore cannot
  // prove that this confidentiality choke was installed. Every loaded Kovo copy
  // contributes its own guard; composed wrappers safely recognize their own boxes.
  globalClone.structuredClone = (value: unknown, options?: unknown): unknown => {
    assertNoSecretStructuredCloneValue(value);
    return nativeStructuredClone(value, options);
  };
}

function assertNoSecretStructuredCloneValue(
  value: unknown,
  seen: WeakSet<object> = securityWeakSet(),
): void {
  if (isSecret(value)) throw nonCoercibleError('secret', 'structuredClone');
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (securityWeakSetHas(seen, value)) return;
  securityWeakSetAdd(seen, value);
  if (securityIsArray(value)) {
    const lengthDescriptor = securityGetOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number'
    ) {
      throw new TypeError('structuredClone input requires a stable array length.');
    }
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = securityGetOwnPropertyDescriptor(value, index);
      if (descriptor === undefined) continue;
      if (!('value' in descriptor)) {
        throw new TypeError('structuredClone input must not hide secrets behind array accessors.');
      }
      assertNoSecretStructuredCloneValue(descriptor.value, seen);
    }
    return;
  }
  if (securityIsMap(value)) {
    securityMapForEach(value, (item, key) => {
      assertNoSecretStructuredCloneValue(key, seen);
      assertNoSecretStructuredCloneValue(item, seen);
    });
    return;
  }
  if (securityIsSet(value)) {
    securitySetForEach(value, (item) => assertNoSecretStructuredCloneValue(item, seen));
    return;
  }
  const keys = securityObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const descriptor = securityGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('structuredClone input must not hide secrets behind object accessors.');
    }
    assertNoSecretStructuredCloneValue(descriptor.value, seen);
  }
  if (securityIsError(value)) {
    const cause = securityGetOwnPropertyDescriptor(value, 'cause');
    if (cause !== undefined) {
      if (!('value' in cause)) {
        throw new TypeError('structuredClone input must not hide secrets behind Error accessors.');
      }
      assertNoSecretStructuredCloneValue(cause.value, seen);
    }
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
 * (SPEC §10.3). The runtime defense-in-depth collector retains only the newest 256 observations,
 * so it is not a complete process-lifetime inventory. Draining is destructive so tests and
 * request-scoped collectors can snapshot only the retained facts produced by the operation they
 * are proving.
 */
export function drainSecretRevealAuditFacts(): SecretRevealAuditFact[] {
  return secretRevealAuditFacts.drain();
}

/** Wraps a request-derived value in a non-coercible DX provenance tag. */
export function untrusted<T>(value: T): UntrustedValue<T> {
  if (isUntrusted(value)) return value as unknown as UntrustedValue<T>;
  return freezeSecurityValue(
    new KovoPoisonBox(value, UNTRUSTED_REDACTED, 'untrusted'),
  ) as unknown as UntrustedValue<T>;
}

/** Runtime guard recognizing an {@link untrusted} box. */
export function isUntrusted(value: unknown): value is UntrustedValue<unknown> {
  return poisonBoxKind(value) === 'untrusted';
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
  const mask = ownSecretOption(options, 'mask', 'Redacted mask');
  if (mask !== undefined && typeof mask !== 'string') {
    throw new TypeError('Redacted mask must be an own string data property when provided.');
  }
  const closedMask =
    mask === undefined ? REDACTED_MASK : snapshotAuditText(mask, 'Redacted mask', true);
  const box = new KovoPoisonBox(value, closedMask, 'redacted');
  return freezeSecurityValue(box) as unknown as RedactedValue<T>;
}

/**
 * Runtime guard recognizing a {@link redacted} box. Returns `false` for a {@link secret}
 * box. Cannot be forged: the brand is a module-private symbol.
 */
export function isRedacted(value: unknown): value is RedactedValue<unknown> {
  return poisonBoxKind(value) === 'redacted';
}

function validateRevealReason(reason: SecretRevealReason | undefined): string {
  let text: unknown = reason;
  if (reason !== undefined && reason !== null && typeof reason === 'object')
    text = ownSecretOption(reason, 'justification', 'Secret reveal justification');
  if (typeof text !== 'string' || securityStringTrim(text) === '') {
    throw new Error('Secret/Untrusted reveal requires a non-empty justification.');
  }
  return securityStringTrim(snapshotAuditText(text, 'Secret/Untrusted reveal justification'));
}

function recordSecretReveal(reason: string): void {
  secretRevealAuditFacts.record({
    kind: 'secret-reveal',
    reason,
    revealedAt: securityApply<string>(intrinsicDateToISOString, new IntrinsicDate(), []),
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
  const reason = ownSecretOption(options, 'reason', 'publishToClient reason');
  if (typeof reason !== 'string' || !securityStringTrim(reason)) {
    throw new Error('publishToClient requires a non-empty reason.');
  }
  snapshotAuditText(reason, 'publishToClient reason');
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
  const justification = ownSecretOption(options, 'justification', 'declareOffWire justification');
  if (typeof justification !== 'string' || !securityStringTrim(justification)) {
    throw new Error('declareOffWire requires a non-empty justification.');
  }
  snapshotAuditText(justification, 'declareOffWire justification');
  run();
}

interface ComparableBytes {
  readonly bytes: Uint8Array;
  readonly kind: 'bytes' | 'string';
}

function comparableBytes(value: unknown): ComparableBytes | null {
  if (!capturedComparableByteControlsSound) return null;
  if (typeof value === 'string') {
    return {
      bytes: securityApply<Uint8Array>(intrinsicTextEncoderEncode, comparableTextEncoder, [value]),
      kind: 'string',
    };
  }
  if (securityHasInstance(IntrinsicArrayBuffer, value)) {
    return { bytes: new IntrinsicUint8Array(value as ArrayBuffer), kind: 'bytes' };
  }
  if (securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [value]) === true) {
    const view = value as ArrayBufferView;
    const dataView = securityHasInstance(IntrinsicDataView, view);
    const bufferGetter = dataView ? intrinsicDataViewBuffer : intrinsicTypedArrayBuffer;
    const byteOffsetGetter = dataView ? intrinsicDataViewByteOffset : intrinsicTypedArrayByteOffset;
    const byteLengthGetter = dataView ? intrinsicDataViewByteLength : intrinsicTypedArrayByteLength;
    if (
      bufferGetter === undefined ||
      byteOffsetGetter === undefined ||
      byteLengthGetter === undefined
    ) {
      return null;
    }
    const buffer = securityApply<ArrayBufferLike>(bufferGetter, view, []);
    const byteOffset = securityApply<number>(byteOffsetGetter, view, []);
    const byteLength = securityApply<number>(byteLengthGetter, view, []);
    return {
      bytes: new IntrinsicUint8Array(buffer, byteOffset, byteLength),
      kind: 'bytes',
    };
  }
  return null;
}

function fixedDigestEqual(left: ComparableBytes, right: ComparableBytes): boolean {
  const length = left.bytes.length > right.bytes.length ? left.bytes.length : right.bytes.length;
  let mismatch = left.bytes.length ^ right.bytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.bytes[index] ?? 0) ^ (right.bytes[index] ?? 0);
  }
  return mismatch === 0;
}

function verifyComparableByteControls(): boolean {
  try {
    if (
      intrinsicTypedArrayBuffer === undefined ||
      intrinsicTypedArrayByteOffset === undefined ||
      intrinsicTypedArrayByteLength === undefined ||
      intrinsicDataViewBuffer === undefined ||
      intrinsicDataViewByteOffset === undefined ||
      intrinsicDataViewByteLength === undefined
    ) {
      return false;
    }
    const encoded = securityApply<Uint8Array>(intrinsicTextEncoderEncode, comparableTextEncoder, [
      'Kovo',
    ]);
    const bytes = new IntrinsicUint8Array(4);
    const dataView = new IntrinsicDataView(bytes.buffer, 1, 2);
    return (
      encoded.length === 4 &&
      encoded[0] === 0x4b &&
      encoded[1] === 0x6f &&
      encoded[2] === 0x76 &&
      encoded[3] === 0x6f &&
      securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [bytes]) === true &&
      securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [dataView]) ===
        true &&
      securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [{}]) === false &&
      securityApply<ArrayBufferLike>(intrinsicTypedArrayBuffer, bytes, []) === bytes.buffer &&
      securityApply<number>(intrinsicTypedArrayByteOffset, bytes, []) === 0 &&
      securityApply<number>(intrinsicTypedArrayByteLength, bytes, []) === 4 &&
      securityApply<ArrayBufferLike>(intrinsicDataViewBuffer, dataView, []) === bytes.buffer &&
      securityApply<number>(intrinsicDataViewByteOffset, dataView, []) === 1 &&
      securityApply<number>(intrinsicDataViewByteLength, dataView, []) === 2
    );
  } catch {
    return false;
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
  const justification = ownSecretOption(options, 'justification', 'trustedReveal justification');
  if (typeof justification !== 'string' || !securityStringTrim(justification)) {
    throw new Error('trustedReveal requires a non-empty justification.');
  }
  snapshotAuditText(justification, 'trustedReveal justification');
  // Unwrap a runtime secret box so the reveal yields the value, not the poisoned
  // wrapper; a non-box value (e.g. a Drizzle column typed Secret) passes through.
  return (
    isSecret(value) ? revealSecret(value, { justification }) : value
  ) as TrustedRevealValue<T>;
}

function ownSecretOption(value: object, key: PropertyKey, label: string): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) throw new TypeError(`${label} must be an own data property.`);
  return descriptor.value;
}
