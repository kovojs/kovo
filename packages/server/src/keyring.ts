import { createHmac, timingSafeEqual } from 'node:crypto';

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

/** Create a rotation-aware HMAC key ring with exactly one active signing key. */
export function createSigningKeyRing(options: SigningKeyRingOptions): SigningKeyRing {
  const keys = options.keys.map(normalizeSigningKey);
  const active = keys.filter((key) => key.state === 'active');
  if (active.length !== 1) throw new Error('SigningKeyRing requires exactly one active key');
  const ids = new Set<string>();
  for (const key of keys) {
    if (ids.has(key.id)) throw new Error(`SigningKeyRing key id "${key.id}" is duplicated`);
    ids.add(key.id);
  }

  return new HmacSigningKeyRing(active[0]!, keys);
}

export function signingKeyRingFromSecret(secret: SigningSecret): SigningKeyRing {
  if (isSigningKeyRing(secret)) return secret;
  if (isSigningKeyRingOptions(secret)) return createSigningKeyRing(secret);
  return createSigningKeyRing({
    keys: [{ id: 'current', secret, state: 'active' }],
  });
}

export function isSigningKeyRing(value: unknown): value is SigningKeyRing {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { currentKeyId?: unknown }).currentKeyId === 'string' &&
    typeof (value as { sign?: unknown }).sign === 'function' &&
    typeof (value as { verify?: unknown }).verify === 'function'
  );
}

export function isSigningKeyRingOptions(value: unknown): value is SigningKeyRingOptions {
  return (
    typeof value === 'object' && value !== null && Array.isArray((value as { keys?: unknown }).keys)
  );
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
      const key = this.keys.find((candidate) => candidate.id === input.keyId);
      if (key === undefined) return { ok: false, reason: 'unknown-key' };
      if (key.state === 'revoked') return { ok: false, reason: 'revoked-key' };
      return secureEqual(signWithKey(key, input), input.signature)
        ? { ok: true, keyId: key.id }
        : { ok: false, reason: 'bad-signature' };
    }

    let revokedMatched = false;
    for (const key of this.keys) {
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

function normalizeSigningKey(key: SigningKey): NormalizedSigningKey {
  if (!isSafeKeyId(key.id))
    throw new Error('SigningKeyRing key id must be non-empty base64url-safe text');
  if (key.state !== 'active' && key.state !== 'previous' && key.state !== 'revoked') {
    throw new Error(`SigningKeyRing key "${key.id}" has invalid state`);
  }
  const secret = normalizeSecret(key.secret);
  if (secret.byteLength < SIGNING_SECRET_MIN_BYTES) {
    throw new Error(
      `SigningKeyRing key "${key.id}" signing material is ${secret.byteLength} bytes; ` +
        `minimum is ${SIGNING_SECRET_MIN_BYTES} bytes (SPEC §6.6).`,
    );
  }
  return { id: key.id, secret, state: key.state };
}

function normalizeSecret(secret: string | Uint8Array): Buffer {
  if (typeof secret === 'string') return Buffer.from(secret);
  return Buffer.from(secret);
}

function isSafeKeyId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function signWithKey(key: NormalizedSigningKey, input: SigningInput): string {
  return createHmac('sha256', derivePurposeKey(key.secret, input.purpose, input.audience))
    .update(toBytes(input.payload))
    .digest('base64url');
}

function derivePurposeKey(root: Buffer, purpose: string, audience: string): Buffer {
  return createHmac('sha256', root)
    .update('kovo signing context v1')
    .update('\0')
    .update(purpose)
    .update('\0')
    .update(audience)
    .digest();
}

function toBytes(value: string | Uint8Array): Buffer {
  return typeof value === 'string' ? Buffer.from(encoder.encode(value)) : Buffer.from(value);
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
