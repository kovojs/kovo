/* oxlint-disable typescript/unbound-method -- Controls are pinned during bootstrap. */
import { Buffer as NativeBuffer } from 'node:buffer';
import {
  createHmac as builtinCreateHmac,
  randomBytes as builtinRandomBytes,
  timingSafeEqual as builtinTimingSafeEqual,
} from 'node:crypto';

const NativeObject = Object;
const NativeReflect = Reflect;
const NativeRegExp = RegExp;
const NativeTypeError = TypeError;
const NativeUint8Array = Uint8Array;
const nativeBufferFill = NativeBuffer.prototype.fill;
const nativeBufferFrom = NativeBuffer.from;
const nativeBufferToString = NativeBuffer.prototype.toString;
const nativeCreateHmac = builtinCreateHmac;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeRandomBytes = builtinRandomBytes;
const nativeReflectApply = NativeReflect.apply;
const nativeRegExpTest = NativeRegExp.prototype.test;
const nativeTimingSafeEqual = builtinTimingSafeEqual;
const nativeTypedArrayPrototype = nativeObjectGetPrototypeOf(NativeUint8Array.prototype);
const nativeTypedArrayByteLength = nativeObjectGetOwnPropertyDescriptor(
  nativeTypedArrayPrototype,
  'byteLength',
)?.get;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

const hmacControl = nativeCreateHmac(
  'sha256',
  apply<Buffer>(nativeBufferFrom, NativeBuffer, [new NativeUint8Array(32)]),
);
const nativeHmacUpdate = capturedMethod(hmacControl, 'update');
const nativeHmacDigest = capturedMethod(hmacControl, 'digest');

/** @internal Opaque, session-confined authentication authority for reusable check facts. */
export interface KovoSourceCheckFactAuthenticationAuthority {
  readonly authenticate: (key: string, payload: string) => Buffer;
  readonly destroy: () => void;
  readonly verifyFact: (key: string, payload: string, authentication: Uint8Array) => boolean;
}

/**
 * Mint one process-local authority for the exact framework-owned foreground cache.
 *
 * The consumer receives only the fixed HMAC-SHA256 fact operation. The wrapper's root buffer is
 * best-effort overwritten on close; JavaScript cannot prove erasure of provider-internal copies
 * (SPEC §6.6).
 */
export function createKovoSourceCheckFactAuthenticationAuthority(): KovoSourceCheckFactAuthenticationAuthority {
  assertBuildCryptoAuthority();
  const authenticationKey = nativeRandomBytes(32);
  let destroyed = false;
  const assertOpen = (): void => {
    assertBuildCryptoAuthority();
    if (destroyed) throw new NativeTypeError('Kovo source-check fact authority is closed.');
  };
  try {
    return apply<KovoSourceCheckFactAuthenticationAuthority>(nativeObjectFreeze, NativeObject, [
      {
        authenticate(key: string, payload: string): Buffer {
          assertOpen();
          return sourceCheckFactAuthentication(authenticationKey, key, payload);
        },
        destroy(): void {
          if (destroyed) return;
          destroyed = true;
          try {
            nativeReflectApply(nativeBufferFill, authenticationKey, [0]);
          } catch {
            // Best effort only; closed state is authoritative even if a hostile runtime blocks
            // overwriting this JavaScript-visible buffer.
          }
        },
        verifyFact(key: string, payload: string, authentication: Uint8Array): boolean {
          assertOpen();
          let authenticationBytes: number;
          try {
            authenticationBytes = byteLength(authentication);
          } catch {
            return false;
          }
          const expected = sourceCheckFactAuthentication(authenticationKey, key, payload);
          try {
            return (
              authenticationBytes === byteLength(expected) &&
              nativeTimingSafeEqual(authentication, expected)
            );
          } catch {
            return false;
          } finally {
            try {
              nativeReflectApply(nativeBufferFill, expected, [0]);
            } catch {
              // The computed comparison buffer is ephemeral; provider internals are outside the
              // JavaScript erasure guarantee.
            }
          }
        },
      },
    ]);
  } catch (error) {
    try {
      nativeReflectApply(nativeBufferFill, authenticationKey, [0]);
    } catch {
      // Construction failed and no authority escaped; overwriting remains best effort.
    }
    throw error;
  }
}

/** @internal Fresh fixed-width authority for one isolated static-trust worker exchange. */
export function mintStaticTrustWorkerAuthority(): Readonly<{
  authenticationKey: string;
  challenge: string;
}> {
  assertBuildCryptoAuthority();
  const authenticationKey = bufferToHex(nativeRandomBytes(32));
  const challenge = bufferToHex(nativeRandomBytes(32));
  if (authenticationKey === challenge) {
    throw new NativeTypeError('Kovo static-trust worker entropy repeated within one exchange.');
  }
  return apply<Readonly<{ authenticationKey: string; challenge: string }>>(
    nativeObjectFreeze,
    NativeObject,
    [{ authenticationKey, challenge }],
  );
}

/** @internal Authenticate one exact static-trust worker response envelope. */
export function authenticateStaticTrustWorkerPayload(
  authenticationKey: string,
  requestDigest: string,
  payload: string,
): string {
  assertBuildCryptoAuthority();
  if (
    typeof authenticationKey !== 'string' ||
    !apply<boolean>(nativeRegExpTest, /^[0-9a-f]{64}$/u, [authenticationKey]) ||
    typeof requestDigest !== 'string' ||
    typeof payload !== 'string'
  ) {
    throw new NativeTypeError('Kovo static-trust worker authentication frame is invalid.');
  }
  const key = apply<Buffer>(nativeBufferFrom, NativeBuffer, [authenticationKey, 'hex']);
  return `hmac-sha256:${hmacHex(key, [requestDigest, '\0', payload])}`;
}

/** @internal Verify one exact static-trust worker response envelope. */
export function verifyStaticTrustWorkerPayload(
  authenticationKey: string,
  requestDigest: string,
  payload: string,
  actualAuthentication: string,
): boolean {
  assertBuildCryptoAuthority();
  if (typeof actualAuthentication !== 'string') return false;
  const expected = authenticateStaticTrustWorkerPayload(authenticationKey, requestDigest, payload);
  const actualBytes = apply<Buffer>(nativeBufferFrom, NativeBuffer, [actualAuthentication, 'utf8']);
  const expectedBytes = apply<Buffer>(nativeBufferFrom, NativeBuffer, [expected, 'utf8']);
  return (
    byteLength(actualBytes) === byteLength(expectedBytes) &&
    nativeTimingSafeEqual(actualBytes, expectedBytes)
  );
}

function sourceCheckFactAuthentication(
  authenticationKey: Buffer,
  key: string,
  payload: string,
): Buffer {
  if (typeof key !== 'string' || typeof payload !== 'string') {
    throw new NativeTypeError('Kovo source-check fact authentication requires text frames.');
  }
  return hmacBytes(authenticationKey, [key, '\0', payload]);
}

function hmacBytes(key: Buffer, frames: readonly string[]): Buffer {
  const hmac = nativeCreateHmac('sha256', key);
  for (let index = 0; index < frames.length; index += 1) {
    nativeReflectApply(nativeHmacUpdate, hmac, [frames[index]!, 'utf8']);
  }
  return apply<Buffer>(nativeHmacDigest, hmac, []);
}

function hmacHex(key: Buffer, frames: readonly string[]): string {
  const hmac = nativeCreateHmac('sha256', key);
  for (let index = 0; index < frames.length; index += 1) {
    nativeReflectApply(nativeHmacUpdate, hmac, [frames[index]!, 'utf8']);
  }
  return apply<string>(nativeHmacDigest, hmac, ['hex']);
}

function byteLength(value: Uint8Array): number {
  if (typeof nativeTypedArrayByteLength !== 'function') {
    throw new NativeTypeError('Kovo build crypto byte-length control is unavailable.');
  }
  return apply<number>(nativeTypedArrayByteLength, value, []);
}

function bufferToHex(value: Buffer): string {
  return apply<string>(nativeBufferToString, value, ['hex']);
}

function assertBuildCryptoAuthority(): void {
  if (!buildCryptoAuthorityHealthy) {
    throw new NativeTypeError(
      'Kovo build/check crypto authority failed its bootstrap self-check. Use the supported CLI runner.',
    );
  }
}

function buildCryptoAuthoritySelfCheck(): boolean {
  try {
    if (typeof nativeTypedArrayByteLength !== 'function') return false;
    const zeroKey = apply<Buffer>(nativeBufferFrom, NativeBuffer, [new NativeUint8Array(32)]);
    if (
      hmacHex(zeroKey, ['key', '\0', 'payload']) !==
      'c03bb4e076410614db0accd7c720defc5aa3100f877c2f9c21b8ed35b8a1fbb5'
    ) {
      return false;
    }
    const left = apply<Buffer>(nativeBufferFrom, NativeBuffer, ['001122', 'hex']);
    const same = apply<Buffer>(nativeBufferFrom, NativeBuffer, ['001122', 'hex']);
    const different = apply<Buffer>(nativeBufferFrom, NativeBuffer, ['001123', 'hex']);
    if (!nativeTimingSafeEqual(left, same) || nativeTimingSafeEqual(left, different)) return false;
    const wipe = apply<Buffer>(nativeBufferFrom, NativeBuffer, ['ffff', 'hex']);
    nativeReflectApply(nativeBufferFill, wipe, [0]);
    return bufferToHex(wipe) === '0000';
  } catch {
    return false;
  }
}

function capturedMethod(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [owner, property],
    );
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new NativeTypeError(`Kovo build crypto method ${String(property)} is unavailable.`);
      }
      return descriptor.value;
    }
    owner = apply<object | null>(nativeObjectGetPrototypeOf, NativeObject, [owner]);
  }
  throw new NativeTypeError(`Kovo build crypto method ${String(property)} is unavailable.`);
}

const buildCryptoAuthorityHealthy = buildCryptoAuthoritySelfCheck();
