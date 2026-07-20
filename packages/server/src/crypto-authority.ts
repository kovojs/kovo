import {
  createCipheriv as builtinCreateCipheriv,
  createDecipheriv as builtinCreateDecipheriv,
  createHash as builtinCreateHash,
  createHmac as builtinCreateHmac,
  hkdfSync as builtinHkdfSync,
  randomBytes as builtinRandomBytes,
  timingSafeEqual as builtinTimingSafeEqual,
} from 'node:crypto';

import {
  authoritySigningKeyRing,
  type AuthoritySigningKey,
  type AuthoritySigningKeyRing,
  type SigningSecret,
} from './keyring.js';
import {
  securityBufferConcat,
  securityBufferFrom,
  securityBufferToString,
  securityIsUint8Array,
  securityNumberIsInteger,
  securityRegExpTest,
  securityStringSlice,
  securityStringStartsWith,
  securityTextEncode,
  securityUint8ArrayFill,
  securityUint8ArrayLength,
} from './response-security-intrinsics.js';
import {
  createWitnessSet,
  witnessArrayAppend,
  witnessDefineProperty,
  witnessFreeze,
  witnessReflectApply,
  witnessSetAdd,
  witnessSetDelete,
  witnessSetHas,
} from './security-witness-intrinsics.js';

type CryptoPurpose =
  | 'anonymous-csrf'
  | 'better-auth-rate-limit'
  | 'capability-url'
  | 'confidential-at-rest'
  | 'csrf'
  | 'live-target-attestation'
  | 'rendered-html-coercion'
  | 'session-fingerprint';

type CryptoAlgorithm = 'aes-256-gcm' | 'hmac-sha256';

/** Closed, reviewable derivation registry (SPEC §6.6 C13). */
export const cryptoPurposeRegistry = witnessFreeze([
  witnessFreeze({
    algorithm: 'hmac-sha256',
    audience: 'bounded-csrf-audience',
    operations: witnessFreeze(['sign', 'verify'] as const),
    purpose: 'anonymous-csrf',
    rootSource: 'framework-key-ring',
  }),
  witnessFreeze({
    algorithm: 'hmac-sha256',
    audience: 'literal:credential-attempt-bucket',
    operations: witnessFreeze(['bucket'] as const),
    purpose: 'better-auth-rate-limit',
    rootSource: 'framework-key-ring',
  }),
  witnessFreeze({
    algorithm: 'hmac-sha256',
    audience: 'bounded-capability-audience',
    operations: witnessFreeze(['sign', 'verify'] as const),
    purpose: 'capability-url',
    rootSource: 'framework-key-ring',
  }),
  witnessFreeze({
    algorithm: 'aes-256-gcm',
    audience: 'bounded-declared-destination',
    operations: witnessFreeze(['seal', 'open'] as const),
    purpose: 'confidential-at-rest',
    rootSource: 'framework-key-ring',
  }),
  witnessFreeze({
    algorithm: 'hmac-sha256',
    audience: 'bounded-csrf-audience',
    operations: witnessFreeze(['sign', 'verify'] as const),
    purpose: 'csrf',
    rootSource: 'framework-key-ring',
  }),
  witnessFreeze({
    algorithm: 'hmac-sha256',
    audience: 'literal:mutation-live-target',
    operations: witnessFreeze(['sign', 'verify'] as const),
    purpose: 'live-target-attestation',
    rootSource: 'framework-key-ring',
  }),
  witnessFreeze({
    algorithm: 'hmac-sha256',
    audience: 'literal:server-rendered-html',
    operations: witnessFreeze(['sign', 'verify'] as const),
    purpose: 'rendered-html-coercion',
    rootSource: 'framework-generated-root',
  }),
  witnessFreeze({
    algorithm: 'hmac-sha256',
    audience: 'literal:broadcast-channel-session-fingerprint',
    operations: witnessFreeze(['sign'] as const),
    purpose: 'session-fingerprint',
    rootSource: 'framework-key-ring',
  }),
] as const);

export type CryptoVerifyResult =
  | { readonly keyId: string; readonly ok: true }
  | { readonly ok: false; readonly reason: 'bad-signature' | 'revoked-key' | 'unknown-key' };

/** A fixed-purpose HMAC handle. No primitive selection or key material crosses this boundary. */
export interface PurposeCryptoHandle {
  readonly currentKeyId: string;
  readonly sign: (payload: string | Uint8Array) => {
    readonly keyId: string;
    readonly signature: string;
  };
  readonly verify: (
    payload: string | Uint8Array,
    signature: string,
    keyId?: string,
  ) => CryptoVerifyResult;
}

/** A fixed-purpose mint-only handle. */
export interface PurposeSignHandle {
  readonly currentKeyId: string;
  readonly sign: PurposeCryptoHandle['sign'];
}

/** @internal Fixed-purpose AEAD handle consumed by the public confidential-at-rest sinks. */
export interface ConfidentialCryptoHandle {
  readonly currentKeyId: string;
  readonly open: (
    keyId: string,
    iv: Uint8Array,
    tag: Uint8Array,
    ciphertext: Uint8Array,
    callerAad: Uint8Array,
  ) => Buffer | undefined;
  readonly seal: (
    plaintext: Uint8Array,
    callerAad: Uint8Array,
  ) => {
    readonly ciphertext: Buffer;
    readonly iv: Buffer;
    readonly keyId: string;
    readonly tag: Buffer;
  };
}

/** @internal Purpose-minimal Better Auth bucket derivation handle. */
export interface BetterAuthRateLimitCryptoHandle {
  readonly bucket: (frame: string, bucketCount: number) => string;
}

const nativeCreateCipheriv = builtinCreateCipheriv;
const nativeCreateDecipheriv = builtinCreateDecipheriv;
const nativeCreateHash = builtinCreateHash;
const nativeCreateHmac = builtinCreateHmac;
const nativeHkdfSync = builtinHkdfSync;
const nativeRandomBytes = builtinRandomBytes;
const nativeTimingSafeEqual = builtinTimingSafeEqual;
const nativeDateNow = Date.now;
const nativeNumberToString = Number.prototype.toString;
const HKDF_SALT = securityBufferFrom('kovo-crypto-authority-v1');
const AUTHORITY_VERSION = 'kovo-crypto-authority-v1';
const IV_REPLAY_WINDOW = 4_096;
const recentIvs = createWitnessSet<string>();
const recentIvOrder: string[] = [];
let recentIvCursor = 0;

const hmacControl = nativeCreateHmac('sha256', 'kovo-crypto-authority-control');
const nativeHmacUpdate = capturedMethod(hmacControl, 'update');
const nativeHmacDigest = capturedMethod(hmacControl, 'digest');
const hashControl = nativeCreateHash('sha256');
const nativeHashUpdate = capturedMethod(hashControl, 'update');
const nativeHashDigest = capturedMethod(hashControl, 'digest');
const cipherControl = nativeCreateCipheriv(
  'aes-256-gcm',
  securityBufferFrom(new Uint8Array(32)),
  securityBufferFrom(new Uint8Array(12)),
);
const nativeCipherSetAad = capturedMethod(cipherControl, 'setAAD');
const nativeCipherUpdate = capturedMethod(cipherControl, 'update');
const nativeCipherFinal = capturedMethod(cipherControl, 'final');
const nativeCipherGetAuthTag = capturedMethod(cipherControl, 'getAuthTag');
const decipherControl = nativeCreateDecipheriv(
  'aes-256-gcm',
  securityBufferFrom(new Uint8Array(32)),
  securityBufferFrom(new Uint8Array(12)),
);
const nativeDecipherSetAad = capturedMethod(decipherControl, 'setAAD');
const nativeDecipherSetAuthTag = capturedMethod(decipherControl, 'setAuthTag');
const nativeDecipherUpdate = capturedMethod(decipherControl, 'update');
const nativeDecipherFinal = capturedMethod(decipherControl, 'final');

const cryptoAuthorityControlsSound = cryptoAuthorityControlsAreSound();
if (!cryptoAuthorityControlsSound) {
  throw new TypeError(
    'Kovo crypto authority is unavailable because crypto or realm intrinsics were modified before framework initialization.',
  );
}

/** @internal Bootstrap health assertion for the pinned server crypto authority. */
export function assertCryptoAuthority(): void {
  if (!cryptoAuthorityControlsSound) {
    throw new TypeError(
      'Kovo crypto authority is unavailable because crypto or realm intrinsics were modified before framework initialization.',
    );
  }
}

export function createCapabilityCryptoHandle(
  secret: SigningSecret,
  audience: string,
): PurposeCryptoHandle {
  return createPurposeHandle(secret, 'capability-url', audience);
}

export function createCsrfCryptoHandle(
  secret: SigningSecret,
  purpose: 'anonymous-csrf' | 'csrf',
  audience: string,
): PurposeCryptoHandle {
  return createPurposeHandle(secret, purpose, audience);
}

export function createLiveTargetCryptoHandle(secret: SigningSecret): PurposeCryptoHandle {
  return createPurposeHandle(secret, 'live-target-attestation', 'mutation-live-target');
}

export function createSessionFingerprintCryptoHandle(secret: SigningSecret): PurposeSignHandle {
  const handle = createPurposeHandle(
    secret,
    'session-fingerprint',
    'broadcast-channel-session-fingerprint',
  );
  return witnessFreeze({ currentKeyId: handle.currentKeyId, sign: handle.sign });
}

export function createRenderedHtmlCryptoHandle(secret: SigningSecret): PurposeCryptoHandle {
  return createPurposeHandle(secret, 'rendered-html-coercion', 'server-rendered-html');
}

export function createConfidentialCryptoHandle(
  secret: SigningSecret,
  audience: string,
): ConfidentialCryptoHandle {
  assertAudience(audience);
  const ring = authoritySigningKeyRing(secret, 'confidential-at-rest', audience);
  return witnessFreeze({
    currentKeyId: ring.active.id,
    open(
      keyId: string,
      iv: Uint8Array,
      tag: Uint8Array,
      ciphertext: Uint8Array,
      callerAad: Uint8Array,
    ): Buffer | undefined {
      const key = eligibleKeyById(ring, keyId);
      if (key === undefined || key.secret === undefined) return undefined;
      const derived = derivePurposeKey(key.secret, 'confidential-at-rest', audience, 'aes-256-gcm');
      try {
        const decipher = nativeCreateDecipheriv('aes-256-gcm', derived, iv);
        witnessReflectApply(nativeDecipherSetAad, decipher, [
          confidentialAad(key.id, audience, callerAad),
        ]);
        witnessReflectApply(nativeDecipherSetAuthTag, decipher, [tag]);
        return securityBufferConcat([
          witnessReflectApply<Buffer>(nativeDecipherUpdate, decipher, [ciphertext]),
          witnessReflectApply<Buffer>(nativeDecipherFinal, decipher, []),
        ]);
      } catch {
        return undefined;
      } finally {
        bestEffortWipe(derived);
      }
    },
    seal(plaintext: Uint8Array, callerAad: Uint8Array) {
      const active = ring.active;
      if (active.state !== 'active' || active.secret === undefined) {
        throw new TypeError('Kovo crypto authority active root is unavailable.');
      }
      const derived = derivePurposeKey(
        active.secret,
        'confidential-at-rest',
        audience,
        'aes-256-gcm',
      );
      try {
        const iv = nativeRandomBytes(12);
        if (securityUint8ArrayLength(iv) !== 12) {
          throw new TypeError('Kovo crypto authority returned an invalid AES-GCM nonce.');
        }
        rememberIv(iv);
        const cipher = nativeCreateCipheriv('aes-256-gcm', derived, iv);
        witnessReflectApply(nativeCipherSetAad, cipher, [
          confidentialAad(active.id, audience, callerAad),
        ]);
        const ciphertext = securityBufferConcat([
          witnessReflectApply<Buffer>(nativeCipherUpdate, cipher, [plaintext]),
          witnessReflectApply<Buffer>(nativeCipherFinal, cipher, []),
        ]);
        const tag = witnessReflectApply<Buffer>(nativeCipherGetAuthTag, cipher, []);
        return witnessFreeze({ ciphertext, iv, keyId: active.id, tag });
      } finally {
        bestEffortWipe(derived);
      }
    },
  });
}

/** @internal Mint the fixed Better Auth rate-limit bucket authority. */
export function createBetterAuthRateLimitCryptoHandle(
  secret: SigningSecret,
): BetterAuthRateLimitCryptoHandle {
  const handle = createPurposeHandle(secret, 'better-auth-rate-limit', 'credential-attempt-bucket');
  return witnessFreeze({
    bucket(frame: string, bucketCount: number): string {
      if (
        typeof frame !== 'string' ||
        frame.length > 1_200 ||
        !securityStringStartsWith(
          frame,
          '18:kovo-scoped-key-v16:system22:better-auth-rate-limit',
        ) ||
        typeof bucketCount !== 'number' ||
        !securityNumberIsInteger(bucketCount) ||
        bucketCount < 1 ||
        bucketCount > 65_536
      ) {
        throw new TypeError('Better Auth crypto authority requires a bounded bucket frame.');
      }
      const signature = handle.sign(frame).signature;
      const digest = securityBufferFrom(signature, 'base64url');
      const bucket = (((digest[0] ?? 0) << 8) | (digest[1] ?? 0)) % bucketCount;
      const hex = witnessReflectApply<string>(nativeNumberToString, bucket, [16]);
      return `${securityStringSlice('0000', hex.length)}${hex}`;
    },
  });
}

function createPurposeHandle(
  secret: SigningSecret,
  purpose: Exclude<CryptoPurpose, 'confidential-at-rest'>,
  audience: string,
): PurposeCryptoHandle {
  assertAudience(audience);
  const ring = authoritySigningKeyRing(secret, purpose, audience);
  return witnessFreeze({
    currentKeyId: ring.active.id,
    sign(payload: string | Uint8Array) {
      const active = ring.active;
      if (active.state !== 'active' || active.secret === undefined) {
        throw new TypeError('Kovo crypto authority active root is unavailable.');
      }
      return witnessFreeze({
        keyId: active.id,
        signature: signWithKey(active, purpose, audience, payload),
      });
    },
    verify(payload: string | Uint8Array, signature: string, keyId?: string): CryptoVerifyResult {
      if (keyId !== undefined) {
        const matching = keyById(ring, keyId);
        if (matching === undefined) {
          return witnessFreeze<CryptoVerifyResult>({ ok: false, reason: 'unknown-key' });
        }
        if (!keyIsEligible(matching)) {
          return witnessFreeze<CryptoVerifyResult>({ ok: false, reason: 'revoked-key' });
        }
        return signatureMatches(matching, purpose, audience, payload, signature)
          ? witnessFreeze<CryptoVerifyResult>({ keyId: matching.id, ok: true })
          : witnessFreeze<CryptoVerifyResult>({ ok: false, reason: 'bad-signature' });
      }
      for (let index = 0; index < ring.keys.length; index += 1) {
        const candidate = ring.keys[index]!;
        if (!keyIsEligible(candidate)) continue;
        if (signatureMatches(candidate, purpose, audience, payload, signature)) {
          return witnessFreeze<CryptoVerifyResult>({ keyId: candidate.id, ok: true });
        }
      }
      return witnessFreeze<CryptoVerifyResult>({ ok: false, reason: 'bad-signature' });
    },
  });
}

function signWithKey(
  key: AuthoritySigningKey,
  purpose: Exclude<CryptoPurpose, 'confidential-at-rest'>,
  audience: string,
  payload: string | Uint8Array,
): string {
  if (key.secret === undefined) throw new TypeError('Kovo crypto authority root is unavailable.');
  const derived = derivePurposeKey(key.secret, purpose, audience, 'hmac-sha256');
  try {
    const hmac = nativeCreateHmac('sha256', derived);
    witnessReflectApply(nativeHmacUpdate, hmac, [payloadBytes(payload)]);
    return witnessReflectApply<string>(nativeHmacDigest, hmac, ['base64url']);
  } finally {
    bestEffortWipe(derived);
  }
}

function signatureMatches(
  key: AuthoritySigningKey,
  purpose: Exclude<CryptoPurpose, 'confidential-at-rest'>,
  audience: string,
  payload: string | Uint8Array,
  signature: string,
): boolean {
  if (typeof signature !== 'string' || !securityRegExpTest(/^[A-Za-z0-9_-]{43}$/u, signature)) {
    return false;
  }
  const actual = securityBufferFrom(signature, 'base64url');
  const expected = securityBufferFrom(signWithKey(key, purpose, audience, payload), 'base64url');
  return (
    securityUint8ArrayLength(actual) === 32 &&
    securityUint8ArrayLength(expected) === 32 &&
    nativeTimingSafeEqual(expected, actual)
  );
}

function derivePurposeKey(
  root: Buffer,
  purpose: CryptoPurpose,
  audience: string,
  algorithm: CryptoAlgorithm,
): Buffer {
  assertRegisteredPurpose(purpose, algorithm);
  const tuple = lengthFrame([
    securityBufferFrom(AUTHORITY_VERSION),
    securityBufferFrom(purpose),
    securityBufferFrom(audience),
    securityBufferFrom(algorithm),
  ]);
  const hash = nativeCreateHash('sha256');
  witnessReflectApply(nativeHashUpdate, hash, [tuple]);
  const info = witnessReflectApply<Buffer>(nativeHashDigest, hash, []);
  return securityBufferFrom(nativeHkdfSync('sha256', root, HKDF_SALT, info, 32));
}

function assertRegisteredPurpose(purpose: CryptoPurpose, algorithm: CryptoAlgorithm): void {
  for (let index = 0; index < cryptoPurposeRegistry.length; index += 1) {
    const row = cryptoPurposeRegistry[index]!;
    if (row.purpose === purpose && row.algorithm === algorithm) return;
  }
  throw new TypeError('Kovo crypto authority refused an unregistered purpose/algorithm pair.');
}

function confidentialAad(keyId: string, audience: string, callerAad: Uint8Array): Buffer {
  return lengthFrame([
    securityBufferFrom('kovo-aes256gcm-v2'),
    securityBufferFrom(keyId),
    securityBufferFrom('confidential-at-rest'),
    securityBufferFrom(audience),
    securityBufferFrom(callerAad),
  ]);
}

function lengthFrame(fields: readonly Buffer[]): Buffer {
  const pieces: Buffer[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    witnessArrayAppend(
      pieces,
      securityBufferFrom(`${securityUint8ArrayLength(field)}:`),
      'crypto authority length frame',
    );
    witnessArrayAppend(pieces, field, 'crypto authority length frame');
  }
  return securityBufferConcat(pieces);
}

function payloadBytes(payload: string | Uint8Array): Buffer {
  if (typeof payload === 'string') return securityBufferFrom(securityTextEncode(payload));
  if (securityIsUint8Array(payload)) return securityBufferFrom(payload);
  throw new TypeError('Crypto authority payload must be a string or Uint8Array.');
}

function assertAudience(audience: string): void {
  if (typeof audience !== 'string' || audience.length === 0 || audience.length > 4_096) {
    throw new TypeError('Crypto authority audience must be non-empty bounded text.');
  }
}

function keyById(ring: AuthoritySigningKeyRing, keyId: string): AuthoritySigningKey | undefined {
  if (typeof keyId !== 'string') return undefined;
  for (let index = 0; index < ring.keys.length; index += 1) {
    const key = ring.keys[index]!;
    if (key.id === keyId) return key;
  }
  return undefined;
}

function eligibleKeyById(
  ring: AuthoritySigningKeyRing,
  keyId: string,
): AuthoritySigningKey | undefined {
  const key = keyById(ring, keyId);
  return key !== undefined && keyIsEligible(key) ? key : undefined;
}

function keyIsEligible(key: AuthoritySigningKey): boolean {
  if (key.state === 'active') return key.secret !== undefined;
  if (key.state === 'revoked' || key.secret === undefined) return false;
  if (
    key.acceptUntil !== undefined &&
    witnessReflectApply<number>(nativeDateNow, Date, []) < key.acceptUntil
  ) {
    return true;
  }
  bestEffortWipe(key.secret);
  key.secret = undefined;
  key.state = 'revoked';
  return false;
}

function bestEffortWipe(bytes: Uint8Array): void {
  try {
    securityUint8ArrayFill(bytes, 0);
  } catch {
    // JavaScript cannot promise physical erasure. This is an explicitly best-effort reduction in
    // retention after the authority is finished with its private copy (SPEC §6.6).
  }
}

function rememberIv(iv: Buffer): void {
  const identity = securityBufferToString(iv, 'base64url');
  if (witnessSetHas(recentIvs, identity)) {
    throw new TypeError(
      'Kovo crypto authority repeated a recent AES-GCM nonce; refusing nonce reuse.',
    );
  }
  if (recentIvOrder.length < IV_REPLAY_WINDOW) {
    witnessDefineProperty(recentIvOrder, recentIvOrder.length, {
      configurable: true,
      enumerable: true,
      value: identity,
      writable: true,
    });
  } else {
    const expired = recentIvOrder[recentIvCursor]!;
    witnessSetDelete(recentIvs, expired);
    witnessDefineProperty(recentIvOrder, recentIvCursor, {
      configurable: true,
      enumerable: true,
      value: identity,
      writable: true,
    });
    recentIvCursor = (recentIvCursor + 1) % IV_REPLAY_WINDOW;
  }
  witnessSetAdd(recentIvs, identity);
}

function capturedMethod(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`Kovo crypto authority method ${String(property)} is unavailable.`);
      }
      return descriptor.value;
    }
    owner = Object.getPrototypeOf(owner);
  }
  throw new TypeError(`Kovo crypto authority method ${String(property)} is unavailable.`);
}

function cryptoAuthorityControlsAreSound(): boolean {
  try {
    const root = securityBufferFrom('kovo-crypto-authority-control-root-32-bytes!!');
    const derived = securityBufferFrom(
      nativeHkdfSync('sha256', root, HKDF_SALT, securityBufferFrom('control-info-v1'), 32),
    );
    if (
      securityBufferToString(derived, 'hex') !==
      '67e0baba28ea57d9a3464cf7d6e5e3d0775115a1c7d62aaeaa8683a2ea7a923d'
    ) {
      return false;
    }
    const hmac = nativeCreateHmac('sha256', derived);
    witnessReflectApply(nativeHmacUpdate, hmac, ['kovo-control-payload']);
    if (
      witnessReflectApply<string>(nativeHmacDigest, hmac, ['hex']) !==
      '3c0a37f8dc622e5608372641554c083bdebc6d6f5e6cdcbb416ccaa5a5e24632'
    ) {
      return false;
    }
    const hash = nativeCreateHash('sha256');
    witnessReflectApply(nativeHashUpdate, hash, ['abc']);
    if (
      witnessReflectApply<string>(nativeHashDigest, hash, ['hex']) !==
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    ) {
      return false;
    }
    const zeroIv = securityBufferFrom(new Uint8Array(12));
    const cipher = nativeCreateCipheriv('aes-256-gcm', derived, zeroIv);
    witnessReflectApply(nativeCipherSetAad, cipher, [securityBufferFrom('control-aad')]);
    const ciphertext = securityBufferConcat([
      witnessReflectApply<Buffer>(nativeCipherUpdate, cipher, [securityBufferFrom('plaintext')]),
      witnessReflectApply<Buffer>(nativeCipherFinal, cipher, []),
    ]);
    const tag = witnessReflectApply<Buffer>(nativeCipherGetAuthTag, cipher, []);
    if (
      securityBufferToString(ciphertext, 'hex') !== 'a2fd727b3caf2349a3' ||
      securityBufferToString(tag, 'hex') !== 'c1ddfbbba6633120c62d43fa72be0439'
    ) {
      return false;
    }
    const decipher = nativeCreateDecipheriv('aes-256-gcm', derived, zeroIv);
    witnessReflectApply(nativeDecipherSetAad, decipher, [securityBufferFrom('control-aad')]);
    witnessReflectApply(nativeDecipherSetAuthTag, decipher, [tag]);
    const plaintext = securityBufferConcat([
      witnessReflectApply<Buffer>(nativeDecipherUpdate, decipher, [ciphertext]),
      witnessReflectApply<Buffer>(nativeDecipherFinal, decipher, []),
    ]);
    if (securityBufferToString(plaintext) !== 'plaintext') return false;
    const randomLeft = nativeRandomBytes(32);
    const randomRight = nativeRandomBytes(32);
    return (
      securityUint8ArrayLength(randomLeft) === 32 &&
      securityUint8ArrayLength(randomRight) === 32 &&
      !nativeTimingSafeEqual(randomLeft, randomRight) &&
      nativeTimingSafeEqual(randomLeft, randomLeft)
    );
  } catch {
    return false;
  }
}
