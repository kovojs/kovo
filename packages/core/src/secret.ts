import { createBoundedRuntimeAuditCollector } from './internal/security-markers.js';
import { snapshotAuditText } from './internal/audit-text.js';
import { emitCoreSecurityDecision } from './internal/security-decision.js';
import {
  freezeSecurityValue,
  securityApply,
  securityArrayIncludesExact,
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
  securityOwnArrayEntry,
  securitySetForEach,
  securityStringCharCodeAt,
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
const MAX_STRUCTURED_CLONE_GUARD_DEPTH = 64;
const MAX_STRUCTURED_CLONE_GUARD_NODES = 100_000;

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
   * Returns the wrapped value through an exact validated declassification policy. The returned
   * value is an ordinary primitive/object with no further runtime tag.
   */
  reveal(policy: DeclassifyPolicy<'secret.reveal'>): T;
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

/** Closed declassification doors. A policy is valid for exactly one door (SPEC §6.6). */
export type DeclassifyDoorId =
  | 'revealSecret'
  | 'revealUntrusted'
  | 'secret.reveal'
  | 'trustedReveal'
  | 'untrusted.reveal';

/** Closed semantic purposes for intentionally releasing a protected value (SPEC §6.6). */
export type DeclassifyPurpose =
  | 'credential-use'
  | 'public-projection'
  | 'request-validation'
  | 'server-computation';

/** Closed owner scopes for a declassification decision (SPEC §6.6). */
export type DeclassifyOwnerScope =
  | 'application'
  | 'current-principal'
  | 'current-tenant'
  | 'framework';

/** Purpose vocabulary admitted by one exact declassification door. */
export type DeclassifyPurposeFor<Door extends DeclassifyDoorId> = Door extends
  | 'revealUntrusted'
  | 'untrusted.reveal'
  ? 'request-validation'
  : Door extends 'trustedReveal'
    ? 'public-projection'
    : 'credential-use' | 'server-computation';

/** Closed input vocabulary used by framework-owned declassification constructors. */
export interface DeclassifyPolicyOptions<Door extends DeclassifyDoorId> {
  /** Exact API door this policy may open. */
  door: Door;
  /** Closed semantic purpose compatible with {@link DeclassifyPolicyOptions.door}. */
  purpose: DeclassifyPurposeFor<Door>;
  /** Closed authority scope that owns the release decision. */
  ownerScope: DeclassifyOwnerScope;
}

const declassifyPolicyConstructorToken = freezeSecurityValue({
  kind: 'kovo-declassify-policy-constructor',
});
const declassifyPolicies = securityWeakSet<object>();

/**
 * Nominal, runtime-validated declassification policy. Use the exact static constructor for the
 * reveal door being called; object literals, casts, subclasses, copied fields, and policies
 * constructed for a different door are rejected.
 *
 * The type is author-time ergonomics. The private runtime registry and exact-door check own the
 * fail-closed floor (SPEC §2 and §6.6).
 */
export class DeclassifyPolicy<
  Door extends
    | 'revealSecret'
    | 'revealUntrusted'
    | 'secret.reveal'
    | 'trustedReveal'
    | 'untrusted.reveal' =
    | 'revealSecret'
    | 'revealUntrusted'
    | 'secret.reveal'
    | 'trustedReveal'
    | 'untrusted.reveal',
> {
  readonly #kovoDeclassifyPolicy: true;
  /** Exact reveal API this policy may open. */
  readonly door: Door;
  /** Closed authority scope that owns this release. */
  readonly ownerScope: DeclassifyOwnerScope;
  /** Closed semantic purpose for the release. */
  readonly purpose: DeclassifyPurposeFor<Door>;

  private constructor(
    token: typeof declassifyPolicyConstructorToken,
    door: Door,
    purpose: DeclassifyPurposeFor<Door>,
    ownerScope: DeclassifyOwnerScope,
  ) {
    if (token !== declassifyPolicyConstructorToken) {
      throw new TypeError(
        'DeclassifyPolicy must be created by its exact door-specific constructor.',
      );
    }
    this.#kovoDeclassifyPolicy = true;
    if (this.#kovoDeclassifyPolicy !== true) {
      throw new TypeError('DeclassifyPolicy nominal initialization failed.');
    }
    this.door = door;
    this.purpose = purpose;
    this.ownerScope = ownerScope;
    securityWeakSetAdd(declassifyPolicies, this);
    freezeSecurityValue(this);
  }

  /** Construct a policy accepted only by the standalone {@link revealSecret} door. */
  static forRevealSecret(options: {
    ownerScope: DeclassifyOwnerScope;
    purpose: 'credential-use' | 'server-computation';
  }): DeclassifyPolicy<'revealSecret'> {
    return DeclassifyPolicy.createDoorPolicy('revealSecret', options);
  }

  /** Construct a policy accepted only by {@link SecretValue.reveal}. */
  static forSecretValue(options: {
    ownerScope: DeclassifyOwnerScope;
    purpose: 'credential-use' | 'server-computation';
  }): DeclassifyPolicy<'secret.reveal'> {
    return DeclassifyPolicy.createDoorPolicy('secret.reveal', options);
  }

  /** Construct a policy accepted only by the audited {@link trustedReveal} projection door. */
  static forTrustedReveal(options: {
    ownerScope: DeclassifyOwnerScope;
  }): DeclassifyPolicy<'trustedReveal'> {
    return DeclassifyPolicy.createFixedPurposeDoorPolicy(
      'trustedReveal',
      options,
      'public-projection',
    );
  }

  /** Construct a policy accepted only by the standalone {@link revealUntrusted} door. */
  static forRevealUntrusted(options: {
    ownerScope: DeclassifyOwnerScope;
  }): DeclassifyPolicy<'revealUntrusted'> {
    return DeclassifyPolicy.createFixedPurposeDoorPolicy(
      'revealUntrusted',
      options,
      'request-validation',
    );
  }

  /** Construct a policy accepted only by {@link UntrustedValue.reveal}. */
  static forUntrustedValue(options: {
    ownerScope: DeclassifyOwnerScope;
  }): DeclassifyPolicy<'untrusted.reveal'> {
    return DeclassifyPolicy.createFixedPurposeDoorPolicy(
      'untrusted.reveal',
      options,
      'request-validation',
    );
  }

  private static createDoorPolicy<Door extends DeclassifyDoorId>(
    door: Door,
    options: Omit<DeclassifyPolicyOptions<Door>, 'door'>,
  ): DeclassifyPolicy<Door> {
    const keys = securityObjectKeys(options);
    if (
      keys.length !== 2 ||
      !securityArrayIncludesExact(keys, 'ownerScope') ||
      !securityArrayIncludesExact(keys, 'purpose')
    ) {
      throw new TypeError('DeclassifyPolicy options must contain exactly purpose and ownerScope.');
    }
    const purpose = ownSecretOption(options, 'purpose', 'DeclassifyPolicy purpose');
    const ownerScope = ownSecretOption(options, 'ownerScope', 'DeclassifyPolicy ownerScope');
    if (!isDeclassifyOwnerScope(ownerScope)) {
      throw new TypeError('Unknown declassification owner scope.');
    }
    if (!declassifyPurposeMatchesDoor(door, purpose)) {
      throw new TypeError(`Declassification purpose is not valid for ${door}.`);
    }
    return new DeclassifyPolicy(
      declassifyPolicyConstructorToken,
      door,
      purpose as DeclassifyPurposeFor<Door>,
      ownerScope,
    );
  }

  private static createFixedPurposeDoorPolicy<
    Door extends 'revealUntrusted' | 'trustedReveal' | 'untrusted.reveal',
  >(
    door: Door,
    options: { ownerScope: DeclassifyOwnerScope },
    purpose: DeclassifyPurposeFor<Door>,
  ): DeclassifyPolicy<Door> {
    const keys = securityObjectKeys(options);
    if (keys.length !== 1 || !securityArrayIncludesExact(keys, 'ownerScope')) {
      throw new TypeError('DeclassifyPolicy options must contain exactly ownerScope.');
    }
    const ownerScope = ownSecretOption(options, 'ownerScope', 'DeclassifyPolicy ownerScope');
    if (!isDeclassifyOwnerScope(ownerScope)) {
      throw new TypeError('Unknown declassification owner scope.');
    }
    return new DeclassifyPolicy(declassifyPolicyConstructorToken, door, purpose, ownerScope);
  }
}

/**
 * Audit record emitted whenever a runtime {@link SecretValue} is explicitly revealed.
 *
 * Audit-only: this records that an author intentionally unboxed a secret; it is not a
 * confidentiality proof and does not authorize a later sink.
 */
export interface SecretRevealAuditFact {
  kind: 'secret-reveal';
  door: Extract<DeclassifyDoorId, 'revealSecret' | 'secret.reveal' | 'trustedReveal'>;
  ownerScope: DeclassifyOwnerScope;
  purpose: Extract<
    DeclassifyPurpose,
    'credential-use' | 'public-projection' | 'server-computation'
  >;
  /** Canonical compatibility label derived from the closed policy; never caller prose. */
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
  /** Returns the wrapped value through an exact request-validation policy. */
  reveal(policy: DeclassifyPolicy<'untrusted.reveal'>): T;
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

  reveal(policy?: DeclassifyPolicy): T {
    if (this.#kind === 'secret') {
      return this.revealThrough(policy, 'secret.reveal');
    }
    if (this.#kind === 'untrusted') {
      return this.revealThrough(policy, 'untrusted.reveal');
    }
    return this.#value;
  }

  revealThrough(policy: DeclassifyPolicy | undefined, door: DeclassifyDoorId): T {
    const validated = validateDeclassifyPolicy(policy, door);
    if (this.#kind === 'secret') recordSecretReveal(validated);
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
  state: { nodes: number; readonly seen: WeakSet<object> } = {
    nodes: 0,
    seen: securityWeakSet(),
  },
  depth = 0,
): void {
  // SPEC §6.6/§9.5: the confidentiality guard itself is reachable with caller-owned
  // graphs. Bound its work before recursive inspection so sparse/deep shapes fail
  // with a deterministic framework error rather than stack or event-loop exhaustion.
  if (depth > MAX_STRUCTURED_CLONE_GUARD_DEPTH) {
    throw new TypeError(
      `structuredClone input exceeds the ${MAX_STRUCTURED_CLONE_GUARD_DEPTH}-level confidentiality guard depth bound.`,
    );
  }
  state.nodes += 1;
  if (state.nodes > MAX_STRUCTURED_CLONE_GUARD_NODES) {
    throw new TypeError(
      `structuredClone input exceeds the ${MAX_STRUCTURED_CLONE_GUARD_NODES}-node confidentiality guard bound.`,
    );
  }
  if (isSecret(value)) throw nonCoercibleError('secret', 'structuredClone');
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (securityWeakSetHas(state.seen, value)) return;
  securityWeakSetAdd(state.seen, value);
  if (
    securityHasInstance(IntrinsicArrayBuffer, value) ||
    (capturedComparableByteControlsSound &&
      securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [value]) === true)
  ) {
    return;
  }
  if (securityIsArray(value)) {
    const lengthDescriptor = securityGetOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value % 1 !== 0 ||
      lengthDescriptor.value > MAX_STRUCTURED_CLONE_GUARD_NODES
    ) {
      throw new TypeError('structuredClone input requires a stable array length.');
    }
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = securityGetOwnPropertyDescriptor(value, index);
      if (descriptor === undefined) continue;
      if (!('value' in descriptor)) {
        throw new TypeError('structuredClone input must not hide secrets behind array accessors.');
      }
      assertNoSecretStructuredCloneValue(descriptor.value, state, depth + 1);
    }
    // Structured clone also copies enumerable custom string properties on an
    // Array. Inspect those separately so `array.metadata = secret(...)` cannot
    // launder the box merely because indexed entries were clean.
    const keys = securityObjectKeys(value);
    if (keys.length > MAX_STRUCTURED_CLONE_GUARD_NODES) {
      throw new TypeError(
        `structuredClone input exceeds the ${MAX_STRUCTURED_CLONE_GUARD_NODES}-key confidentiality guard bound.`,
      );
    }
    for (let index = 0; index < keys.length; index += 1) {
      const keyEntry = securityOwnArrayEntry(keys, index);
      if (!keyEntry.ok) {
        throw new TypeError('structuredClone input requires stable own array keys.');
      }
      if (isStructuredCloneArrayIndex(keyEntry.value, lengthDescriptor.value)) continue;
      const descriptor = securityGetOwnPropertyDescriptor(value, keyEntry.value);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError(
          'structuredClone input must not hide secrets behind custom array accessors.',
        );
      }
      assertNoSecretStructuredCloneValue(descriptor.value, state, depth + 1);
    }
    return;
  }
  if (securityIsMap(value)) {
    securityMapForEach(value, (item, key) => {
      assertNoSecretStructuredCloneValue(key, state, depth + 1);
      assertNoSecretStructuredCloneValue(item, state, depth + 1);
    });
    return;
  }
  if (securityIsSet(value)) {
    securitySetForEach(value, (item) => assertNoSecretStructuredCloneValue(item, state, depth + 1));
    return;
  }
  const keys = securityObjectKeys(value);
  if (keys.length > MAX_STRUCTURED_CLONE_GUARD_NODES) {
    throw new TypeError(
      `structuredClone input exceeds the ${MAX_STRUCTURED_CLONE_GUARD_NODES}-key confidentiality guard bound.`,
    );
  }
  for (let index = 0; index < keys.length; index += 1) {
    const keyEntry = securityOwnArrayEntry(keys, index);
    if (!keyEntry.ok) {
      throw new TypeError('structuredClone input requires stable own object keys.');
    }
    const key = keyEntry.value;
    const descriptor = securityGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('structuredClone input must not hide secrets behind object accessors.');
    }
    assertNoSecretStructuredCloneValue(descriptor.value, state, depth + 1);
  }
  if (securityIsError(value)) {
    const cause = securityGetOwnPropertyDescriptor(value, 'cause');
    if (cause !== undefined) {
      if (!('value' in cause)) {
        throw new TypeError('structuredClone input must not hide secrets behind Error accessors.');
      }
      assertNoSecretStructuredCloneValue(cause.value, state, depth + 1);
    }
  }
}

function isStructuredCloneArrayIndex(value: string, length: number): boolean {
  if (value === '0') return length > 0;
  if (value.length === 0 || securityStringCharCodeAt(value, 0) === 0x30) return false;
  let parsed = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code < 0x30 || code > 0x39) return false;
    parsed = parsed * 10 + code - 0x30;
    if (parsed >= length) return false;
  }
  return parsed < length;
}

/**
 * Explicitly unboxes a {@link secret} box and returns its value. A value that is
 * typed `Secret<T>` but is not a runtime box is returned unchanged.
 */
export function revealSecret<T>(value: Secret<T>, policy: DeclassifyPolicy<'revealSecret'>): T {
  const validated = validateDeclassifyPolicy(policy, 'revealSecret');
  return isSecret(value)
    ? (value as unknown as KovoPoisonBox<T>).revealThrough(validated, 'revealSecret')
    : (value as unknown as T);
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
export function revealUntrusted<T>(
  value: Untrusted<T>,
  policy: DeclassifyPolicy<'revealUntrusted'>,
): T {
  const validated = validateDeclassifyPolicy(policy, 'revealUntrusted');
  return isUntrusted(value)
    ? (value as unknown as KovoPoisonBox<T>).revealThrough(validated, 'revealUntrusted')
    : (value as unknown as T);
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

function validateDeclassifyPolicy(
  policy: DeclassifyPolicy | undefined,
  door: DeclassifyDoorId,
): DeclassifyPolicy {
  const admitted =
    policy !== undefined &&
    typeof policy === 'object' &&
    securityWeakSetHas(declassifyPolicies, policy) &&
    policy.door === door;
  // @kovo-security-decision declassification policy-admission
  emitCoreSecurityDecision({
    decisionSite: 'framework:declassification:policy-admission',
    door: 'declassification',
    outcome: admitted ? 'allow' : 'deny',
    principal: {
      epoch: null,
      id: null,
      kind: 'unresolved',
      reason: 'outside-request-context',
      tenant: null,
    },
    resourceScope: { identity: 'global', kind: 'secret' },
    type: 'security-decision',
  });
  if (!admitted) {
    throw new TypeError(`${door} requires a validated DeclassifyPolicy for that exact door.`);
  }
  return policy;
}

function recordSecretReveal(policy: DeclassifyPolicy): void {
  const door = policy.door;
  const purpose = policy.purpose;
  if (door !== 'revealSecret' && door !== 'secret.reveal' && door !== 'trustedReveal') {
    throw new TypeError('A non-secret declassification policy cannot record a secret release.');
  }
  if (
    purpose !== 'credential-use' &&
    purpose !== 'public-projection' &&
    purpose !== 'server-computation'
  ) {
    throw new TypeError('A secret declassification policy has an invalid purpose.');
  }
  secretRevealAuditFacts.record({
    door,
    kind: 'secret-reveal',
    ownerScope: policy.ownerScope,
    purpose,
    reason: declassifyPolicyLabel(policy),
    revealedAt: securityApply<string>(intrinsicDateToISOString, new IntrinsicDate(), []),
  });
}

function declassifyPolicyLabel(policy: DeclassifyPolicy): string {
  return `${policy.purpose}:${policy.door}:${policy.ownerScope}`;
}

function isDeclassifyOwnerScope(value: unknown): value is DeclassifyOwnerScope {
  return (
    value === 'application' ||
    value === 'current-principal' ||
    value === 'current-tenant' ||
    value === 'framework'
  );
}

function declassifyPurposeMatchesDoor(
  door: DeclassifyDoorId,
  purpose: unknown,
): purpose is DeclassifyPurposeFor<typeof door> {
  if (door === 'revealUntrusted' || door === 'untrusted.reveal') {
    return purpose === 'request-validation';
  }
  if (door === 'trustedReveal') return purpose === 'public-projection';
  return purpose === 'credential-use' || purpose === 'server-computation';
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
 * A client event handler that captures a cross-module import in **value position** would otherwise
 * evaluate that module in the browser, so the compiler refuses it even when wrapped. The only
 * accepted client-handler shape is a unique, pristine same-file `const` initialized directly from
 * the finite primitive grammar; the compiler snapshots that literal and records the site + reason
 * for `kovo explain --capabilities`.
 *
 * This is the analogue of {@link trustedReveal} for the closure-capture channel: an assertion the
 * reviewer can see. Reach for it only for inert same-file constants the handler needs in the
 * browser (a public label or build protocol version); never to ship a real secret or runtime config.
 *
 * Runtime behavior is identity for the exact `string | number | boolean | null` data union. Every
 * other value is rejected without reflection, excluding proxies, accessors, nested callables,
 * coercion hooks, iterators, thenables, symbols, bigint, and undefined without executing them during
 * validation. The matching input type is defense-in-depth; the compiler's same-file literal gate is
 * the no-import-execution proof.
 */
export function publishToClient<T extends string | number | boolean | null>(
  value: T,
  options: PublishToClientOptions,
): T {
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    throw new TypeError('publishToClient accepts only string, number, boolean, or null.');
  }
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
  // SPEC §6.6: `equals()` is intended for token/signature decisions. Exact byte
  // lengths must come from the boot-witnessed typed-array intrinsic so late realm
  // poisoning cannot turn every comparison into a zero-byte match.
  const leftLength = comparableByteLength(left.bytes);
  const rightLength = comparableByteLength(right.bytes);
  const length = leftLength > rightLength ? leftLength : rightLength;
  let mismatch = leftLength ^ rightLength;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.bytes[index] ?? 0) ^ (right.bytes[index] ?? 0);
  }
  return mismatch === 0;
}

function comparableByteLength(value: Uint8Array): number {
  if (!capturedComparableByteControlsSound || intrinsicTypedArrayByteLength === undefined) {
    throw new TypeError('Kovo secret equality byte controls are unavailable.');
  }
  return securityApply<number>(intrinsicTypedArrayByteLength, value, []);
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
    const controlBuffer = new IntrinsicArrayBuffer(4);
    const bytes = new IntrinsicUint8Array(controlBuffer);
    const dataView = new IntrinsicDataView(controlBuffer, 1, 2);
    return (
      securityApply<number>(intrinsicTypedArrayByteLength, encoded, []) === 4 &&
      encoded[0] === 0x4b &&
      encoded[1] === 0x6f &&
      encoded[2] === 0x76 &&
      encoded[3] === 0x6f &&
      securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [bytes]) === true &&
      securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [dataView]) ===
        true &&
      securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [{}]) === false &&
      securityApply<ArrayBufferLike>(intrinsicTypedArrayBuffer, bytes, []) === controlBuffer &&
      securityApply<number>(intrinsicTypedArrayByteOffset, bytes, []) === 0 &&
      securityApply<number>(intrinsicTypedArrayByteLength, bytes, []) === 4 &&
      securityApply<ArrayBufferLike>(intrinsicDataViewBuffer, dataView, []) === controlBuffer &&
      securityApply<number>(intrinsicDataViewByteOffset, dataView, []) === 1 &&
      securityApply<number>(intrinsicDataViewByteLength, dataView, []) === 2
    );
  } catch {
    return false;
  }
}

/** The JSON-visible value type exposed after an explicit confidentiality reveal. */
export type TrustedRevealValue<T> = T extends Secret<infer Value> ? Value : T;

/**
 * Audited confidentiality escape hatch for query projections that intentionally
 * expose a redacted or otherwise safe representation of a secret-classified value.
 *
 * The static Drizzle projection analyzer recognizes this function only with an inline,
 * compiler-visible `DeclassifyPolicy.forTrustedReveal({ ownerScope: ... })` call and records the
 * reveal for `kovo explain --revealed`. A policy cannot be selected by request data, reused at a
 * different door, or replaced by caller prose. The runtime constructor/registry is a fail-closed
 * floor; compiler provenance and capability closure own the by-construction checks (SPEC §6.6).
 */
export function trustedReveal<T>(
  value: T,
  policy: DeclassifyPolicy<'trustedReveal'>,
): TrustedRevealValue<T> {
  const validated = validateDeclassifyPolicy(policy, 'trustedReveal');
  // Unwrap a runtime secret box so the reveal yields the value, not the poisoned
  // wrapper; a non-box value (e.g. a Drizzle column typed Secret) passes through.
  return (
    isSecret(value)
      ? (value as unknown as KovoPoisonBox<TrustedRevealValue<T>>).revealThrough(
          validated,
          'trustedReveal',
        )
      : value
  ) as TrustedRevealValue<T>;
}

function ownSecretOption(value: object, key: PropertyKey, label: string): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) throw new TypeError(`${label} must be an own data property.`);
  return descriptor.value;
}
