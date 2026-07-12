import {
  confidentialBufferFrom,
  confidentialBufferLength,
  confidentialEncryptEnvelope,
  confidentialIsUint8Array,
  confidentialOwnDataValue,
  confidentialRegExpTest,
  confidentialStringTrim,
} from './confidential-at-rest-intrinsics.js';

/** Options for the OPP-04 authenticated-encryption at-rest sink. */
export interface EncryptAtRestOptions {
  /** Authenticated context, such as `users.ssn` or `tenant:user-secret`. */
  aad: string | Uint8Array;
  /** Optional key id stored with the ciphertext for app-managed rotation. */
  keyId?: string;
}

/** A compact serialized AES-256-GCM ciphertext produced by {@link encryptAtRest}. */
export type EncryptedAtRest = string & { readonly __kovoEncryptedAtRest: unique symbol };

/**
 * Authenticated-encryption sink for `kovo({ confidentialAtRest })` columns.
 *
 * SPEC §6.6 / OPP-04: the static Drizzle gate makes plaintext writes to declared
 * destination columns fail closed for the analyzable subset. This runtime sink is
 * defense in depth at the cryptographic boundary; app-managed key storage and
 * rotation remain outside this helper.
 */
export function encryptAtRest(
  plaintext: string | Uint8Array,
  key: string | Uint8Array,
  options: EncryptAtRestOptions,
): EncryptedAtRest {
  const keyBytes = normalizeKey(key);
  const configuredAad = confidentialOwnDataValue(options, 'aad', 'encryptAtRest options');
  const configuredKeyId = confidentialOwnDataValue(options, 'keyId', 'encryptAtRest options');
  const aad = normalizeAad(configuredAad);
  const plaintextBytes = normalizePlaintext(plaintext);
  if (configuredKeyId !== undefined && typeof configuredKeyId !== 'string') {
    throw new TypeError('encryptAtRest keyId must be a string when provided (OPP-04).');
  }
  const trimmedKeyId =
    configuredKeyId === undefined ? undefined : confidentialStringTrim(configuredKeyId);
  const keyId = trimmedKeyId === undefined || trimmedKeyId === '' ? undefined : trimmedKeyId;
  return confidentialEncryptEnvelope(plaintextBytes, keyBytes, aad, keyId) as EncryptedAtRest;
}

function normalizeKey(key: string | Uint8Array): Buffer {
  if (typeof key !== 'string' && !confidentialIsUint8Array(key)) {
    throw new TypeError('encryptAtRest key must be a string or Uint8Array (OPP-04).');
  }
  const bytes =
    typeof key === 'string'
      ? confidentialBufferFrom(
          key,
          confidentialRegExpTest(/^[A-Za-z0-9_-]{43,44}$/u, key) ? 'base64url' : 'utf8',
        )
      : confidentialBufferFrom(key);
  if (confidentialBufferLength(bytes) !== 32) {
    throw new Error('encryptAtRest requires a 32-byte AES-256-GCM key (OPP-04).');
  }
  return bytes;
}

function normalizeAad(aad: unknown): Buffer {
  if (typeof aad !== 'string' && !confidentialIsUint8Array(aad)) {
    throw new TypeError('encryptAtRest aad must be a string or Uint8Array (OPP-04).');
  }
  const bytes =
    typeof aad === 'string'
      ? confidentialBufferFrom(confidentialStringTrim(aad), 'utf8')
      : confidentialBufferFrom(aad);
  if (confidentialBufferLength(bytes) === 0) {
    throw new Error('encryptAtRest requires non-empty authenticated context (OPP-04).');
  }
  return bytes;
}

function normalizePlaintext(plaintext: unknown): Buffer {
  if (typeof plaintext === 'string') return confidentialBufferFrom(plaintext, 'utf8');
  if (confidentialIsUint8Array(plaintext)) return confidentialBufferFrom(plaintext);
  throw new TypeError('encryptAtRest plaintext must be a string or Uint8Array (OPP-04).');
}
