import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';
import {
  createWitnessSet,
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessObjectIs,
  witnessReflectApply,
  witnessSetAdd,
  witnessSetHas,
  witnessString,
  witnessWeakMapGet,
  witnessWeakMapHas,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';
import {
  securityBufferFrom,
  securityIsUint8Array,
  securityRegExpTest,
  securityTextEncode,
  securityUint8ArrayLength,
} from './response-security-intrinsics.js';

/** Minimum HMAC root secret bytes accepted by framework signing helpers (SPEC §6.6). */
export const SIGNING_SECRET_MIN_BYTES = 32;

/** Lifecycle state for one framework signing key in a {@link SigningKeyRing}. */
export type SigningKeyState = 'active' | 'previous' | 'revoked';

/** One HMAC signing key plus its rotation state. */
export interface SigningKey {
  /** Stable operator-chosen key id used for diagnostics and rotation inventory. */
  id: string;
  /** Raw HMAC signing material loaded from a secret manager. */
  secret: string | Uint8Array;
  /** Whether this key signs new tokens, verifies old tokens, or is explicitly rejected. */
  state: SigningKeyState;
}

/** First-class framework signing key ring for rotation-aware HMAC token signing. */
export interface SigningKeyRing {
  /** The id of the single active key used for new signatures. */
  currentKeyId: string;
  /** Sign payload bytes for a required purpose and audience context. */
  sign(input: SigningInput): SigningResult;
  /** Verify payload bytes against every configured non-revoked key. */
  verify(input: SigningVerifyInput): SigningVerifyResult;
}

/** Payload and context supplied when minting a framework signature. */
export interface SigningInput {
  /** Verify-sink audience, such as a mutation key or storage mount. */
  audience: string;
  /** Canonical payload bytes to sign. */
  payload: string | Uint8Array;
  /** Token family, such as `csrf` or `capability-url`. */
  purpose: string;
}

/** Payload, context, and signature supplied when verifying a framework signature. */
export interface SigningVerifyInput extends SigningInput {
  /** Optional expected key id from a versioned token payload. */
  keyId?: string;
  /** Base64url HMAC signature to verify. */
  signature: string;
}

/** Result returned when minting a framework signature. */
export interface SigningResult {
  /** Active key id that produced the signature. */
  keyId: string;
  /** Base64url HMAC signature. */
  signature: string;
}

/** Result returned when verifying a framework signature. */
export type SigningVerifyResult =
  | { ok: true; keyId: string }
  | { ok: false; reason: SigningRejectReason };

/** Stable reason code for a failed framework signature verification. */
export type SigningRejectReason =
  | 'bad-signature'
  | 'invalid-keyring'
  | 'revoked-key'
  | 'unknown-key';

declare const frameworkCsrfSigningSecretBrand: unique symbol;

/**
 * Opaque framework-owned signing authority for CSRF and mutation live-target attestations.
 *
 * The public type lets a frozen {@link CsrfOptions} carry the capability without exposing a
 * generic signer or raw key material. Runtime authority is an exact private-WeakMap identity;
 * casts and structurally similar objects cannot mint a working token (SPEC §6.6 C9).
 */
export interface FrameworkCsrfSigningSecret {
  readonly [frameworkCsrfSigningSecretBrand]: 'framework-csrf-signing-secret';
}

/** Accepted signing material for framework token helpers. */
export type SigningSecret =
  | string
  | Uint8Array
  | SigningKeyRing
  | SigningKeyRingOptions
  | FrameworkCsrfSigningSecret;

/** Declarative configuration for constructing a {@link SigningKeyRing}. */
export interface SigningKeyRingOptions {
  /** Complete rotation set; exactly one key must be `active`. */
  keys: readonly SigningKey[];
}

const nativeCreateHash = createHash;
const nativeCreateHmac = createHmac;
const nativeTimingSafeEqual = timingSafeEqual;
const nativeSigningIsProxy = nodeUtilTypes.isProxy;
const hmacControl = nativeCreateHmac('sha256', 'kovo-intrinsic-control');
const hashControl = nativeCreateHash('sha256');
const nativeHmacUpdate = stableSigningRingProperty(hmacControl, 'update') as Function;
const nativeHmacDigest = stableSigningRingProperty(hmacControl, 'digest') as Function;
const nativeHashUpdate = stableSigningRingProperty(hashControl, 'update') as Function;
const nativeHashDigest = stableSigningRingProperty(hashControl, 'digest') as Function;
const pinnedSigningKeyRings = createWitnessWeakSet<object>();
const frameworkCsrfSigningSecrets = createWitnessWeakMap<object, SigningKeyRing>();
const frameworkCsrfSigningSources = createWitnessWeakMap<object, SigningKeyRing>();

if (!signingCryptoControlsAreSound()) {
  throw new TypeError(
    'Kovo signing controls are unavailable because the server realm crypto intrinsics were modified before framework initialization.',
  );
}

function signingCryptoControlsAreSound(): boolean {
  try {
    if (
      witnessReflectApply<boolean>(nativeSigningIsProxy, nodeUtilTypes, [{}]) !== false ||
      witnessReflectApply<boolean>(nativeSigningIsProxy, nodeUtilTypes, [new Proxy({}, {})]) !==
        true
    ) {
      return false;
    }
    const hmac = nativeCreateHmac('sha256', 'kovo-intrinsic-control');
    witnessReflectApply(nativeHmacUpdate, hmac, ['kovo-signing-control-v1']);
    if (
      witnessReflectApply<string>(nativeHmacDigest, hmac, ['base64url']) !==
      'kpvSpivkW8Vnc2FTbhTpVk8tvaevvMT-KPIHfv0WKdo'
    ) {
      return false;
    }
    const hash = nativeCreateHash('sha256');
    witnessReflectApply(nativeHashUpdate, hash, ['kovo-signature-v1']);
    if (
      witnessReflectApply<string>(nativeHashDigest, hash, ['hex']) !==
      '2e4dd12b80a9d4d258f4a889471b513d2174653a8877c1e860766072b4ad55f0'
    ) {
      return false;
    }
    const sameLeft = securityBufferFrom('same');
    const sameRight = securityBufferFrom('same');
    const different = securityBufferFrom('diff');
    return (
      nativeTimingSafeEqual(sameLeft, sameRight) && !nativeTimingSafeEqual(sameLeft, different)
    );
  } catch {
    return false;
  }
}

/** Create a rotation-aware HMAC key ring with exactly one active signing key. */
export function createSigningKeyRing(options: SigningKeyRingOptions): SigningKeyRing {
  const sourceKeys = stableDenseSigningKeys(stableOwnSigningKeyValue(options, 'keys'));
  const keys: NormalizedSigningKey[] = [];
  let active: NormalizedSigningKey | undefined;
  let activeCount = 0;
  for (let index = 0; index < sourceKeys.length; index += 1) {
    const key = normalizeSigningKey(sourceKeys[index]!, index);
    appendArrayValue(keys, key);
    if (key.state === 'active') {
      active = key;
      activeCount += 1;
    }
  }
  if (activeCount !== 1 || active === undefined) {
    throw new Error('SigningKeyRing requires exactly one active key');
  }
  const ids = createWitnessSet<string>();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (witnessSetHas(ids, key.id)) {
      throw new Error(`SigningKeyRing key id "${key.id}" is duplicated`);
    }
    witnessSetAdd(ids, key.id);
  }

  return exposeSigningKeyRing(new HmacSigningKeyRing(active, witnessFreeze(keys)));
}

/**
 * Mint a zero-key CSRF/live-target signing token backed by the server package's private registry.
 *
 * @internal First-party integrations use the `@kovojs/server/internal/keyring` entry so packed
 * server and integration bundles share this exact registry (SPEC §6.6 C9).
 */
export function createFrameworkCsrfSigningSecret(
  source: SigningKeyRing,
): FrameworkCsrfSigningSecret {
  const token = witnessFreeze(witnessCreateNullRecord());
  const pinnedSource = pinOpaqueSigningKeyRing(source);
  witnessWeakMapSet(frameworkCsrfSigningSources, token, pinnedSource);
  witnessWeakMapSet(
    frameworkCsrfSigningSecrets,
    token,
    createFrameworkCsrfScopedSigningKeyRing(pinnedSource),
  );
  // The private WeakMap is the runtime proof. This assertion carries only the already-minted
  // opaque identity through public CsrfOptions typing; no structural brand exists at runtime.
  return token as unknown as FrameworkCsrfSigningSecret;
}

/** @internal Return whether a value is an exact framework-minted CSRF signing token. */
export function isFrameworkCsrfSigningSecret(value: unknown): value is FrameworkCsrfSigningSecret {
  return (
    typeof value === 'object' &&
    value !== null &&
    witnessWeakMapHas(frameworkCsrfSigningSecrets, value)
  );
}

export function signingKeyRingFromSecret(secret: SigningSecret): SigningKeyRing {
  if (typeof secret === 'object' && secret !== null) {
    const scoped = witnessWeakMapGet(frameworkCsrfSigningSecrets, secret);
    if (scoped !== undefined) return scoped;
  }
  if (isSigningKeyRing(secret)) return pinOpaqueSigningKeyRing(secret);
  if (isSigningKeyRingOptions(secret)) return createSigningKeyRing(secret);
  if (typeof secret === 'object' && secret !== null && !securityIsUint8Array(secret)) {
    throw new TypeError(
      'Framework signing capability is invalid; only an exact framework-minted token is accepted (SPEC §6.6 C9).',
    );
  }
  return createSigningKeyRing({
    keys: [{ id: 'current', secret, state: 'active' }],
  });
}

/**
 * Derive the browser coordination fingerprint through one fixed framework-owned signing sink.
 *
 * A generated auth binding carries only the opaque CSRF token, so ordinary callers must not gain
 * the generic `session-fingerprint` purpose. The server document path nevertheless needs the same
 * deployment-stable root to bind an already-proven principal across tabs. This helper recovers the
 * hidden source only for the fixed purpose/audience pair and never returns the signer or key
 * material (SPEC §6.6 C9, §9.3).
 *
 * @internal Package-private server document sink; not part of the public entry point.
 */
export function signSessionFingerprintWithSecret(
  secret: SigningSecret,
  principal: string,
): string {
  const frameworkSource =
    typeof secret === 'object' && secret !== null
      ? witnessWeakMapGet(frameworkCsrfSigningSources, secret)
      : undefined;
  return (frameworkSource ?? signingKeyRingFromSecret(secret)).sign({
    audience: 'broadcast-channel-session-fingerprint',
    payload: principal,
    purpose: 'session-fingerprint',
  }).signature;
}

export function isSigningKeyRing(value: unknown): value is SigningKeyRing {
  if (typeof value !== 'object' || value === null) return false;
  try {
    return (
      typeof stableSigningRingProperty(value, 'currentKeyId') === 'string' &&
      typeof stableSigningRingProperty(value, 'sign') === 'function' &&
      typeof stableSigningRingProperty(value, 'verify') === 'function'
    );
  } catch {
    return false;
  }
}

export function isSigningKeyRingOptions(value: unknown): value is SigningKeyRingOptions {
  if (typeof value !== 'object' || value === null) return false;
  try {
    return witnessIsArray(stableOwnSigningKeyValue(value, 'keys'));
  } catch {
    return false;
  }
}

function pinOpaqueSigningKeyRing(source: SigningKeyRing): SigningKeyRing {
  if (witnessWeakSetHas(pinnedSigningKeyRings, source)) return source;
  return exposeSigningKeyRing(source);
}

function exposeSigningKeyRing(source: SigningKeyRing): SigningKeyRing {
  const currentKeyId = stableSigningRingProperty(source, 'currentKeyId');
  const sign = stableSigningRingProperty(source, 'sign');
  const verify = stableSigningRingProperty(source, 'verify');
  if (
    typeof currentKeyId !== 'string' ||
    typeof sign !== 'function' ||
    typeof verify !== 'function'
  ) {
    throw new TypeError('SigningKeyRing must expose stable currentKeyId, sign, and verify data.');
  }
  const pinned = witnessFreeze({
    currentKeyId,
    sign(input: SigningInput): SigningResult {
      return witnessReflectApply(sign, source, [input]);
    },
    verify(input: SigningVerifyInput): SigningVerifyResult {
      return witnessReflectApply(verify, source, [input]);
    },
  });
  witnessWeakSetAdd(pinnedSigningKeyRings, pinned);
  return pinned;
}

function createFrameworkCsrfScopedSigningKeyRing(source: SigningKeyRing): SigningKeyRing {
  const currentKeyId = stableSigningRingProperty(source, 'currentKeyId');
  const sign = stableSigningRingProperty(source, 'sign');
  const verify = stableSigningRingProperty(source, 'verify');
  if (
    typeof currentKeyId !== 'string' ||
    typeof sign !== 'function' ||
    typeof verify !== 'function'
  ) {
    throw new TypeError('Framework CSRF signing source must be a stable SigningKeyRing.');
  }
  const scoped = witnessFreeze({
    currentKeyId,
    sign(input: SigningInput): SigningResult {
      const snapshot = snapshotFrameworkCsrfSigningInput(input);
      return witnessReflectApply(sign, source, [snapshot]);
    },
    verify(input: SigningVerifyInput): SigningVerifyResult {
      const snapshot = snapshotFrameworkCsrfSigningVerifyInput(input);
      return witnessReflectApply(verify, source, [snapshot]);
    },
  });
  witnessWeakSetAdd(pinnedSigningKeyRings, scoped);
  return scoped;
}

function snapshotFrameworkCsrfSigningInput(input: SigningInput): SigningInput {
  return snapshotFrameworkCsrfSigningCarrier(input, false) as SigningInput;
}

function snapshotFrameworkCsrfSigningVerifyInput(input: SigningVerifyInput): SigningVerifyInput {
  return snapshotFrameworkCsrfSigningCarrier(input, true) as SigningVerifyInput;
}

function snapshotFrameworkCsrfSigningCarrier(
  input: SigningInput | SigningVerifyInput,
  verification: boolean,
): SigningInput | SigningVerifyInput {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('Framework CSRF signing input must be an object.');
  }
  if (witnessReflectApply<boolean>(nativeSigningIsProxy, nodeUtilTypes, [input])) {
    throw new TypeError('Framework CSRF signing input must not be a Proxy.');
  }
  const purpose = stableOwnSigningKeyValue(input, 'purpose');
  const audience = stableOwnSigningKeyValue(input, 'audience');
  const payload = stableOwnSigningKeyValue(input, 'payload');
  assertFrameworkCsrfSigningScope(purpose, audience);
  if (typeof audience !== 'string') {
    throw new TypeError('Framework CSRF signing audience must be a string.');
  }
  if (typeof payload !== 'string' && !securityIsUint8Array(payload)) {
    throw new TypeError('Framework CSRF signing payload must be a string or Uint8Array.');
  }

  const snapshot = witnessCreateNullRecord<unknown>();
  defineScopedSigningInputValue(snapshot, 'audience', audience);
  defineScopedSigningInputValue(
    snapshot,
    'payload',
    typeof payload === 'string' ? payload : securityBufferFrom(payload),
  );
  defineScopedSigningInputValue(snapshot, 'purpose', purpose);
  if (verification) {
    const signature = stableOwnSigningKeyValue(input, 'signature');
    const keyId = stableOptionalOwnSigningKeyValue(input, 'keyId');
    if (typeof signature !== 'string') {
      throw new TypeError('Framework CSRF signing verification signature must be a string.');
    }
    if (keyId !== undefined && typeof keyId !== 'string') {
      throw new TypeError('Framework CSRF signing verification keyId must be a string.');
    }
    if (keyId !== undefined) defineScopedSigningInputValue(snapshot, 'keyId', keyId);
    defineScopedSigningInputValue(snapshot, 'signature', signature);
  }
  return witnessFreeze(snapshot) as unknown as SigningInput | SigningVerifyInput;
}

function assertFrameworkCsrfSigningScope(purpose: unknown, audience: unknown): void {
  if (purpose === 'csrf' || purpose === 'anonymous-csrf') return;
  if (purpose === 'live-target-attestation' && audience === 'mutation-live-target') return;
  throw new TypeError(
    'Framework CSRF signing capability only permits csrf, anonymous-csrf, and the mutation-live-target live-target attestation audience (SPEC §6.6 C9).',
  );
}

function defineScopedSigningInputValue(
  target: Record<PropertyKey, unknown>,
  property: PropertyKey,
  value: unknown,
): void {
  witnessDefineProperty(target, property, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
}

function stableSigningRingProperty(source: object, property: PropertyKey): unknown {
  let owner: object | null = source;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const before = witnessGetOwnPropertyDescriptor(owner, property);
    const prototype = witnessGetPrototypeOf(owner);
    const after = witnessGetOwnPropertyDescriptor(owner, property);
    if (!sameSigningDataDescriptor(before, after)) {
      throw new TypeError(`SigningKeyRing.${witnessString(property)} changed while it was pinned.`);
    }
    if (before !== undefined) {
      if (!('value' in before)) {
        throw new TypeError(`SigningKeyRing.${witnessString(property)} must be a data property.`);
      }
      return before.value;
    }
    if (witnessGetPrototypeOf(owner) !== prototype) {
      throw new TypeError(
        `SigningKeyRing.${witnessString(property)} prototype changed while it was pinned.`,
      );
    }
    owner = prototype;
  }
  return undefined;
}

function stableOwnSigningKeyValue(source: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (!sameSigningDataDescriptor(before, after) || before === undefined || !('value' in before)) {
    throw new TypeError(
      `Signing key ${witnessString(property)} must be a stable own data property.`,
    );
  }
  return before.value;
}

function stableOptionalOwnSigningKeyValue(source: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (!sameSigningDataDescriptor(before, after)) {
    throw new TypeError(`Signing key ${witnessString(property)} changed while it was inspected.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new TypeError(
      `Signing key ${witnessString(property)} must be a stable own data property.`,
    );
  }
  return before.value;
}

function sameSigningDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    witnessObjectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

function stableDenseSigningKeys(value: unknown): readonly SigningKey[] {
  if (!witnessIsArray(value)) throw new TypeError('SigningKeyRing keys must be a dense array.');
  const length = witnessGetOwnPropertyDescriptor(value, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    length.value < 0 ||
    length.value > 10_000
  ) {
    throw new TypeError('SigningKeyRing keys must have a bounded stable length.');
  }
  const snapshot: SigningKey[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`SigningKeyRing keys[${index}] must be a stable own data property.`);
    }
    appendArrayValue(snapshot, descriptor.value as SigningKey);
  }
  return witnessFreeze(snapshot);
}

function appendArrayValue<Value>(values: Value[], value: Value): void {
  witnessDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

class HmacSigningKeyRing implements SigningKeyRing {
  currentKeyId: string;

  constructor(
    private readonly active: NormalizedSigningKey,
    private readonly keys: readonly NormalizedSigningKey[],
  ) {
    this.currentKeyId = active.id;
  }

  sign(input: SigningInput): SigningResult {
    const signature = signWithKey(this.active, input);
    return { keyId: this.active.id, signature };
  }

  verify(input: SigningVerifyInput): SigningVerifyResult {
    if (input.keyId !== undefined) {
      let key: NormalizedSigningKey | undefined;
      for (let index = 0; index < this.keys.length; index += 1) {
        const candidate = this.keys[index]!;
        if (candidate.id === input.keyId) {
          key = candidate;
          break;
        }
      }
      if (key === undefined) return { ok: false, reason: 'unknown-key' };
      if (key.state === 'revoked') return { ok: false, reason: 'revoked-key' };
      return secureEqual(signWithKey(key, input), input.signature)
        ? { ok: true, keyId: key.id }
        : { ok: false, reason: 'bad-signature' };
    }

    let revokedMatched = false;
    for (let index = 0; index < this.keys.length; index += 1) {
      const key = this.keys[index]!;
      const matched = secureEqual(signWithKey(key, input), input.signature);
      if (!matched) continue;
      if (key.state === 'revoked') {
        revokedMatched = true;
        continue;
      }
      return { ok: true, keyId: key.id };
    }

    if (revokedMatched) return { ok: false, reason: 'revoked-key' };
    return { ok: false, reason: 'bad-signature' };
  }
}

interface NormalizedSigningKey {
  id: string;
  secret: Buffer;
  state: SigningKeyState;
}

function normalizeSigningKey(key: SigningKey, index: number): NormalizedSigningKey {
  const id = stableOwnSigningKeyValue(key, 'id');
  const state = stableOwnSigningKeyValue(key, 'state');
  const sourceSecret = stableOwnSigningKeyValue(key, 'secret');
  if (typeof id !== 'string' || !isSafeKeyId(id))
    throw new Error('SigningKeyRing key id must be non-empty base64url-safe text');
  if (state !== 'active' && state !== 'previous' && state !== 'revoked') {
    throw new Error(`SigningKeyRing key "${id}" has invalid state`);
  }
  if (typeof sourceSecret !== 'string' && !securityIsUint8Array(sourceSecret)) {
    throw new Error(`SigningKeyRing key "${id}" has invalid signing material at index ${index}`);
  }
  const secret = normalizeSecret(sourceSecret);
  const secretByteLength = securityUint8ArrayLength(secret);
  if (secretByteLength < SIGNING_SECRET_MIN_BYTES) {
    throw new Error(
      `SigningKeyRing key "${id}" signing material is ${secretByteLength} bytes; ` +
        `minimum is ${SIGNING_SECRET_MIN_BYTES} bytes (SPEC §6.6).`,
    );
  }
  return witnessFreeze({ id, secret, state });
}

function normalizeSecret(secret: string | Uint8Array): Buffer {
  return securityBufferFrom(secret);
}

function isSafeKeyId(id: string): boolean {
  // Captured RegExp.prototype.test would still dispatch through a mutable `.exec`; the response
  // intrinsic membrane invokes the boot-captured `RegExp.prototype.exec` directly.
  return securityRegExpTest(/^[A-Za-z0-9_-]+$/, id);
}

function signWithKey(key: NormalizedSigningKey, input: SigningInput): string {
  const hmac = nativeCreateHmac(
    'sha256',
    derivePurposeKey(key.secret, input.purpose, input.audience),
  );
  witnessReflectApply(nativeHmacUpdate, hmac, [toBytes(input.payload)]);
  return witnessReflectApply(nativeHmacDigest, hmac, ['base64url']);
}

function derivePurposeKey(root: Buffer, purpose: string, audience: string): Buffer {
  const hmac = nativeCreateHmac('sha256', root);
  witnessReflectApply(nativeHmacUpdate, hmac, ['kovo signing context v1']);
  witnessReflectApply(nativeHmacUpdate, hmac, ['\0']);
  witnessReflectApply(nativeHmacUpdate, hmac, [purpose]);
  witnessReflectApply(nativeHmacUpdate, hmac, ['\0']);
  witnessReflectApply(nativeHmacUpdate, hmac, [audience]);
  return witnessReflectApply(nativeHmacDigest, hmac, []);
}

function toBytes(value: string | Uint8Array): Buffer {
  return typeof value === 'string'
    ? securityBufferFrom(securityTextEncode(value))
    : securityBufferFrom(value);
}

function secureEqual(left: string, right: string): boolean {
  return nativeTimingSafeEqual(digestComparableSignature(left), digestComparableSignature(right));
}

function digestComparableSignature(value: string): Buffer {
  const bytes = securityBufferFrom(value);
  const hash = nativeCreateHash('sha256');
  witnessReflectApply(nativeHashUpdate, hash, ['kovo-signature-v1']);
  witnessReflectApply(nativeHashUpdate, hash, ['\0']);
  witnessReflectApply(nativeHashUpdate, hash, [witnessString(securityUint8ArrayLength(bytes))]);
  witnessReflectApply(nativeHashUpdate, hash, ['\0']);
  witnessReflectApply(nativeHashUpdate, hash, [bytes]);
  return witnessReflectApply(nativeHashDigest, hash, []);
}
