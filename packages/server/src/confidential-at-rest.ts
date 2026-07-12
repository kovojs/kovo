import { createCipheriv, randomBytes } from 'node:crypto';
import {
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessReflectApply,
} from './security-witness-intrinsics.js';

const NativeBuffer = Buffer;
const nativeArrayJoin = Array.prototype.join;
const nativeBufferAlloc = NativeBuffer.alloc;
const nativeBufferConcat = NativeBuffer.concat;
const nativeBufferFrom = NativeBuffer.from;
const nativeBufferToString = NativeBuffer.prototype.toString;
const nativeRegExpTest = RegExp.prototype.test;
const nativeStringTrim = String.prototype.trim;
const cipherControl = createCipheriv(
  'aes-256-gcm',
  witnessReflectApply(nativeBufferAlloc, NativeBuffer, [32]),
  witnessReflectApply(nativeBufferAlloc, NativeBuffer, [12]),
);
const nativeCipherSetAad = capturedCipherMethod(cipherControl, 'setAAD');
const nativeCipherUpdate = capturedCipherMethod(cipherControl, 'update');
const nativeCipherFinal = capturedCipherMethod(cipherControl, 'final');
const nativeCipherGetAuthTag = capturedCipherMethod(cipherControl, 'getAuthTag');
const controlAad = witnessReflectApply<Buffer>(nativeBufferFrom, NativeBuffer, ['aad']);
const controlPlaintext = witnessReflectApply<Buffer>(nativeBufferFrom, NativeBuffer, ['plaintext']);
witnessReflectApply(nativeCipherSetAad, cipherControl, [controlAad]);
const controlCiphertext = witnessReflectApply<Buffer>(nativeCipherUpdate, cipherControl, [
  controlPlaintext,
]);
const controlFinal = witnessReflectApply<Buffer>(nativeCipherFinal, cipherControl, []);
const controlCombined = witnessReflectApply<Buffer>(nativeBufferConcat, NativeBuffer, [
  [controlCiphertext, controlFinal],
]);
const controlTag = witnessReflectApply<Buffer>(nativeCipherGetAuthTag, cipherControl, []);
if (
  witnessReflectApply<string>(nativeBufferToString, controlCombined, ['hex']) !==
    'becb215423140e1673' ||
  witnessReflectApply<string>(nativeBufferToString, controlTag, ['hex']) !==
    'adcb624a73760b8c0871e693e5ade3f7'
) {
  throw new TypeError('Kovo confidential-at-rest cipher controls failed their semantic check.');
}

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
  witnessReflectApply(nativeCipherSetAad, cipher, [aad]);
  const plaintextBytes =
    typeof plaintext === 'string'
      ? witnessReflectApply<Buffer>(nativeBufferFrom, NativeBuffer, [plaintext, 'utf8'])
      : witnessReflectApply<Buffer>(nativeBufferFrom, NativeBuffer, [plaintext]);
  const ciphertext = witnessReflectApply<Buffer>(nativeBufferConcat, NativeBuffer, [
    [
      witnessReflectApply(nativeCipherUpdate, cipher, [plaintextBytes]),
      witnessReflectApply(nativeCipherFinal, cipher, []),
    ],
  ]);
  const tag = witnessReflectApply<Buffer>(nativeCipherGetAuthTag, cipher, []);
  const trimmedKeyId =
    options.keyId === undefined
      ? undefined
      : witnessReflectApply<string>(nativeStringTrim, options.keyId, []);
  const keyId = trimmedKeyId === undefined || trimmedKeyId === '' ? undefined : trimmedKeyId;
  return witnessReflectApply<string>(
    nativeArrayJoin,
    [
      'kovo-aes256gcm-v1',
      keyId ?? '',
      witnessReflectApply(nativeBufferToString, iv, ['base64url']),
      witnessReflectApply(nativeBufferToString, tag, ['base64url']),
      witnessReflectApply(nativeBufferToString, ciphertext, ['base64url']),
    ],
    ['.'],
  ) as EncryptedAtRest;
}

function normalizeKey(key: string | Uint8Array): Buffer {
  const bytes =
    typeof key === 'string'
      ? witnessReflectApply<Buffer>(nativeBufferFrom, NativeBuffer, [
          key,
          witnessReflectApply<boolean>(nativeRegExpTest, /^[A-Za-z0-9_-]{43,44}$/u, [key])
            ? 'base64url'
            : 'utf8',
        ])
      : witnessReflectApply<Buffer>(nativeBufferFrom, NativeBuffer, [key]);
  if (bytes.length !== 32) {
    throw new Error('encryptAtRest requires a 32-byte AES-256-GCM key (OPP-04).');
  }
  return bytes;
}

function normalizeAad(aad: string | Uint8Array): Buffer {
  const bytes =
    typeof aad === 'string'
      ? witnessReflectApply<Buffer>(nativeBufferFrom, NativeBuffer, [
          witnessReflectApply(nativeStringTrim, aad, []),
          'utf8',
        ])
      : witnessReflectApply<Buffer>(nativeBufferFrom, NativeBuffer, [aad]);
  if (bytes.length === 0) {
    throw new Error('encryptAtRest requires non-empty authenticated context (OPP-04).');
  }
  return bytes;
}

function capturedCipherMethod(cipher: object, property: PropertyKey): Function {
  let prototype = witnessGetPrototypeOf(cipher);
  for (let depth = 0; prototype !== null && depth < 8; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(prototype, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`Kovo cipher ${String(property)} control must be a data method.`);
      }
      return descriptor.value;
    }
    prototype = witnessGetPrototypeOf(prototype);
  }
  throw new TypeError(`Kovo confidential-at-rest cipher lacks ${String(property)}.`);
}
