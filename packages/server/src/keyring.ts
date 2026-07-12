import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  createWitnessSet,
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessObjectIs,
  witnessReflectApply,
  witnessSetAdd,
  witnessSetHas,
  witnessString,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

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

/** Accepted signing material for framework token helpers. */
export type SigningSecret = string | Uint8Array | SigningKeyRing | SigningKeyRingOptions;

/** Declarative configuration for constructing a {@link SigningKeyRing}. */
export interface SigningKeyRingOptions {
  /** Complete rotation set; exactly one key must be `active`. */
  keys: readonly SigningKey[];
}

const encoder = new TextEncoder();
const nativeArrayIsArray = Array.isArray;
const NativeUint8Array = Uint8Array;
const NativeBuffer = Buffer;
const nativeBufferFrom = NativeBuffer.from;
const nativeRegExpTest = RegExp.prototype.test;
const nativeTextEncoderEncode = TextEncoder.prototype.encode;
const hmacControl = createHmac('sha256', 'kovo-intrinsic-control');
const hashControl = createHash('sha256');
const nativeHmacUpdate = stableSigningRingProperty(hmacControl, 'update') as Function;
const nativeHmacDigest = stableSigningRingProperty(hmacControl, 'digest') as Function;
const nativeHashUpdate = stableSigningRingProperty(hashControl, 'update') as Function;
const nativeHashDigest = stableSigningRingProperty(hashControl, 'digest') as Function;
const pinnedSigningKeyRings = createWitnessWeakSet<object>();

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

export function signingKeyRingFromSecret(secret: SigningSecret): SigningKeyRing {
  if (isSigningKeyRing(secret)) return pinOpaqueSigningKeyRing(secret);
  if (isSigningKeyRingOptions(secret)) return createSigningKeyRing(secret);
  return createSigningKeyRing({
    keys: [{ id: 'current', secret, state: 'active' }],
  });
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
    return nativeArrayIsArray(stableOwnSigningKeyValue(value, 'keys'));
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

function stableSigningRingProperty(source: object, property: PropertyKey): unknown {
  let owner: object | null = source;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const before = witnessGetOwnPropertyDescriptor(owner, property);
    const prototype = witnessGetPrototypeOf(owner);
    const after = witnessGetOwnPropertyDescriptor(owner, property);
    if (!sameSigningDataDescriptor(before, after)) {
      throw new TypeError(`SigningKeyRing.${String(property)} changed while it was pinned.`);
    }
    if (before !== undefined) {
      if (!('value' in before)) {
        throw new TypeError(`SigningKeyRing.${String(property)} must be a data property.`);
      }
      return before.value;
    }
    if (witnessGetPrototypeOf(owner) !== prototype) {
      throw new TypeError(
        `SigningKeyRing.${String(property)} prototype changed while it was pinned.`,
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
    throw new TypeError(`Signing key ${String(property)} must be a stable own data property.`);
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
  if (!nativeArrayIsArray(value)) throw new TypeError('SigningKeyRing keys must be a dense array.');
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
  if (typeof sourceSecret !== 'string' && !(sourceSecret instanceof NativeUint8Array)) {
    throw new Error(`SigningKeyRing key "${id}" has invalid signing material at index ${index}`);
  }
  const secret = normalizeSecret(sourceSecret);
  if (secret.byteLength < SIGNING_SECRET_MIN_BYTES) {
    throw new Error(
      `SigningKeyRing key "${id}" signing material is ${secret.byteLength} bytes; ` +
        `minimum is ${SIGNING_SECRET_MIN_BYTES} bytes (SPEC §6.6).`,
    );
  }
  return witnessFreeze({ id, secret, state });
}

function normalizeSecret(secret: string | Uint8Array): Buffer {
  return witnessReflectApply(nativeBufferFrom, NativeBuffer, [secret]);
}

function isSafeKeyId(id: string): boolean {
  return witnessReflectApply(nativeRegExpTest, /^[A-Za-z0-9_-]+$/, [id]);
}

function signWithKey(key: NormalizedSigningKey, input: SigningInput): string {
  const hmac = createHmac('sha256', derivePurposeKey(key.secret, input.purpose, input.audience));
  witnessReflectApply(nativeHmacUpdate, hmac, [toBytes(input.payload)]);
  return witnessReflectApply(nativeHmacDigest, hmac, ['base64url']);
}

function derivePurposeKey(root: Buffer, purpose: string, audience: string): Buffer {
  const hmac = createHmac('sha256', root);
  witnessReflectApply(nativeHmacUpdate, hmac, ['kovo signing context v1']);
  witnessReflectApply(nativeHmacUpdate, hmac, ['\0']);
  witnessReflectApply(nativeHmacUpdate, hmac, [purpose]);
  witnessReflectApply(nativeHmacUpdate, hmac, ['\0']);
  witnessReflectApply(nativeHmacUpdate, hmac, [audience]);
  return witnessReflectApply(nativeHmacDigest, hmac, []);
}

function toBytes(value: string | Uint8Array): Buffer {
  return typeof value === 'string'
    ? witnessReflectApply(nativeBufferFrom, NativeBuffer, [
        witnessReflectApply(nativeTextEncoderEncode, encoder, [value]),
      ])
    : witnessReflectApply(nativeBufferFrom, NativeBuffer, [value]);
}

function secureEqual(left: string, right: string): boolean {
  return timingSafeEqual(digestComparableSignature(left), digestComparableSignature(right));
}

function digestComparableSignature(value: string): Buffer {
  const bytes = witnessReflectApply<Buffer>(nativeBufferFrom, NativeBuffer, [value]);
  const hash = createHash('sha256');
  witnessReflectApply(nativeHashUpdate, hash, ['kovo-signature-v1']);
  witnessReflectApply(nativeHashUpdate, hash, ['\0']);
  witnessReflectApply(nativeHashUpdate, hash, [witnessString(bytes.byteLength)]);
  witnessReflectApply(nativeHashUpdate, hash, ['\0']);
  witnessReflectApply(nativeHashUpdate, hash, [bytes]);
  return witnessReflectApply(nativeHashDigest, hash, []);
}
