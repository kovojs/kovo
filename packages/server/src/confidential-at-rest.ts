import {
  createConfidentialCryptoHandle,
  type ConfidentialCryptoHandle,
} from './crypto-authority.js';
import { isSigningKeyRing, type SigningKeyRing } from './keyring.js';
import {
  securityArrayJoin,
  securityBufferFrom,
  securityBufferToString,
  securityIsUint8Array,
  securityRegExpTest,
  securityStringSplit,
  securityStringTrim,
  securityUint8ArrayLength,
} from './response-security-intrinsics.js';
import {
  createWitnessWeakMap,
  witnessCreateNullRecord,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessObjectIs,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

/** Fixed authenticated destination for a confidential-at-rest cipher. */
export interface ConfidentialAtRestCipherOptions {
  /** Destination identity, such as `users.ssn`; folded into HKDF and AES-GCM AAD. */
  readonly audience: string;
}

/** Caller context additionally authenticated by the confidential-at-rest sink. */
export interface EncryptAtRestOptions {
  /** Optional record/tenant context. The destination audience is always authenticated. */
  readonly aad?: string | Uint8Array;
}

/** Caller context required to open a confidential-at-rest envelope. */
export type DecryptAtRestOptions = EncryptAtRestOptions;

declare const confidentialAtRestCipherBrand: unique symbol;

/** Opaque framework-minted confidential-at-rest authority carrier. */
export interface ConfidentialAtRestCipher {
  readonly [confidentialAtRestCipherBrand]: 'kovo-confidential-at-rest-cipher';
}

/** A compact versioned AES-256-GCM envelope produced by {@link encryptAtRest}. */
export type EncryptedAtRest = string & { readonly __kovoEncryptedAtRest: unique symbol };

const confidentialCiphers = createWitnessWeakMap<object, ConfidentialCryptoHandle>();
const ENVELOPE_VERSION = 'kovo-aes256gcm-v2';

/**
 * Bind an exact root-key ring to one confidential destination.
 *
 * The returned carrier has no methods or key metadata. Only the fixed encrypt/decrypt/rewrap sinks
 * can recover its purpose-scoped AES authority (SPEC §6.6 / OPP-04).
 */
export function createConfidentialAtRestCipher(
  ring: SigningKeyRing,
  options: ConfidentialAtRestCipherOptions,
): ConfidentialAtRestCipher {
  if (!isSigningKeyRing(ring)) {
    throw new TypeError(
      'Confidential-at-rest cipher requires an exact framework signing key ring.',
    );
  }
  const audience = stableRequiredText(options, 'audience', 'confidential-at-rest options');
  if (audience.length > 4_096) {
    throw new TypeError('Confidential-at-rest audience must be bounded text.');
  }
  const token = witnessFreeze(witnessCreateNullRecord());
  witnessWeakMapSet(confidentialCiphers, token, createConfidentialCryptoHandle(ring, audience));
  return token as unknown as ConfidentialAtRestCipher;
}

/** Seal plaintext with the ring's sole active key into the normative v2 envelope. */
export function encryptAtRest(
  plaintext: string | Uint8Array,
  cipher: ConfidentialAtRestCipher,
  options: EncryptAtRestOptions = {},
): EncryptedAtRest {
  const authority = requireCipher(cipher);
  const sealed = authority.seal(normalizePlaintext(plaintext), normalizeAad(options));
  return securityArrayJoin(
    [
      ENVELOPE_VERSION,
      sealed.keyId,
      securityBufferToString(sealed.iv, 'base64url'),
      securityBufferToString(sealed.tag, 'base64url'),
      securityBufferToString(sealed.ciphertext, 'base64url'),
    ],
    '.',
  ) as EncryptedAtRest;
}

/**
 * Open a v2 envelope with its named active or unexpired previous key.
 *
 * Unknown, revoked, expired, malformed, and unauthenticated envelopes intentionally share one
 * externally visible failure (SPEC §6.6).
 */
export function decryptAtRest(
  envelope: EncryptedAtRest | string,
  cipher: ConfidentialAtRestCipher,
  options: DecryptAtRestOptions = {},
): Uint8Array {
  const authority = requireCipher(cipher);
  try {
    const parsed = parseEnvelope(envelope);
    if (parsed === undefined) throw new Error('malformed');
    const plaintext = authority.open(
      parsed.keyId,
      parsed.iv,
      parsed.tag,
      parsed.ciphertext,
      normalizeAad(options),
    );
    if (plaintext === undefined) throw new Error('unauthenticated');
    return plaintext;
  } catch {
    throw new Error('Confidential-at-rest envelope cannot be opened.');
  }
}

/** Open with an eligible old key and immediately reseal under the active key. */
export function rewrapAtRest(
  envelope: EncryptedAtRest | string,
  cipher: ConfidentialAtRestCipher,
  options: DecryptAtRestOptions = {},
): EncryptedAtRest {
  return encryptAtRest(decryptAtRest(envelope, cipher, options), cipher, options);
}

function requireCipher(value: ConfidentialAtRestCipher): ConfidentialCryptoHandle {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('encryptAtRest requires a framework-minted confidential-at-rest cipher.');
  }
  const authority = witnessWeakMapGet(confidentialCiphers, value);
  if (authority === undefined) {
    throw new TypeError('encryptAtRest requires a framework-minted confidential-at-rest cipher.');
  }
  return authority;
}

function normalizePlaintext(value: unknown): Buffer {
  if (typeof value === 'string') return securityBufferFrom(value, 'utf8');
  if (securityIsUint8Array(value)) return securityBufferFrom(value);
  throw new TypeError('encryptAtRest plaintext must be a string or Uint8Array (OPP-04).');
}

function normalizeAad(options: EncryptAtRestOptions): Buffer {
  const value = stableOptionalValue(options, 'aad', 'confidential-at-rest options');
  if (value === undefined) return securityBufferFrom('');
  if (typeof value === 'string') return securityBufferFrom(securityStringTrim(value), 'utf8');
  if (securityIsUint8Array(value)) return securityBufferFrom(value);
  throw new TypeError('encryptAtRest aad must be a string or Uint8Array (OPP-04).');
}

function parseEnvelope(value: unknown):
  | {
      readonly ciphertext: Buffer;
      readonly iv: Buffer;
      readonly keyId: string;
      readonly tag: Buffer;
    }
  | undefined {
  if (typeof value !== 'string' || value.length > 16 * 1024 * 1024) return undefined;
  const fields = securityStringSplit(value, '.');
  if (fields.length !== 5 || fields[0] !== ENVELOPE_VERSION) return undefined;
  const keyId = fields[1]!;
  const encodedIv = fields[2]!;
  const encodedTag = fields[3]!;
  const encodedCiphertext = fields[4]!;
  if (
    !securityRegExpTest(/^[A-Za-z0-9_-]+$/u, keyId) ||
    !securityRegExpTest(/^[A-Za-z0-9_-]{16}$/u, encodedIv) ||
    !securityRegExpTest(/^[A-Za-z0-9_-]{22}$/u, encodedTag) ||
    !securityRegExpTest(/^[A-Za-z0-9_-]*$/u, encodedCiphertext)
  ) {
    return undefined;
  }
  const iv = securityBufferFrom(encodedIv, 'base64url');
  const tag = securityBufferFrom(encodedTag, 'base64url');
  const ciphertext = securityBufferFrom(encodedCiphertext, 'base64url');
  if (
    securityUint8ArrayLength(iv) !== 12 ||
    securityUint8ArrayLength(tag) !== 16 ||
    securityBufferToString(iv, 'base64url') !== encodedIv ||
    securityBufferToString(tag, 'base64url') !== encodedTag ||
    securityBufferToString(ciphertext, 'base64url') !== encodedCiphertext
  ) {
    return undefined;
  }
  return { ciphertext, iv, keyId, tag };
}

function stableRequiredText(source: object, property: PropertyKey, label: string): string {
  const value = stableOptionalValue(source, property, label);
  if (typeof value !== 'string' || value.length === 0 || securityStringTrim(value) !== value) {
    throw new TypeError(`${label}.${String(property)} must be non-empty trimmed text.`);
  }
  return value;
}

function stableOptionalValue(source: object, property: PropertyKey, label: string): unknown {
  if (typeof source !== 'object' || source === null) {
    throw new TypeError(`${label} must be an object with stable own data properties.`);
  }
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (!sameDataDescriptor(before, after)) {
    throw new TypeError(`${label}.${String(property)} changed while it was inspected.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new TypeError(`${label}.${String(property)} must be an own data property.`);
  }
  return before.value;
}

function sameDataDescriptor(
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
