import { createCipheriv, randomBytes } from 'node:crypto';

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
  const aad = normalizeAad(options.aad);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
  cipher.setAAD(aad);
  const plaintextBytes =
    typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : Buffer.from(plaintext);
  const ciphertext = Buffer.concat([cipher.update(plaintextBytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  const keyId = options.keyId && options.keyId.trim() ? options.keyId.trim() : undefined;
  return [
    'kovo-aes256gcm-v1',
    keyId ?? '',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.') as EncryptedAtRest;
}

function normalizeKey(key: string | Uint8Array): Buffer {
  const bytes =
    typeof key === 'string'
      ? Buffer.from(key, /^[A-Za-z0-9_-]{43,44}$/u.test(key) ? 'base64url' : 'utf8')
      : Buffer.from(key);
  if (bytes.length !== 32) {
    throw new Error('encryptAtRest requires a 32-byte AES-256-GCM key (OPP-04).');
  }
  return bytes;
}

function normalizeAad(aad: string | Uint8Array): Buffer {
  const bytes = typeof aad === 'string' ? Buffer.from(aad.trim(), 'utf8') : Buffer.from(aad);
  if (bytes.length === 0) {
    throw new Error('encryptAtRest requires non-empty authenticated context (OPP-04).');
  }
  return bytes;
}
