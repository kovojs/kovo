import { Buffer as BuiltinBuffer } from 'node:buffer';
import {
  createCipheriv as builtinCreateCipheriv,
  randomBytes as builtinRandomBytes,
} from 'node:crypto';

/**
 * Boot-pinned authenticated-encryption controls (SPEC §6.6 / §10.3 C9).
 *
 * Node builtin ESM bindings are live: `syncBuiltinESMExports()` can otherwise replace an already
 * imported `randomBytes`/`createCipheriv`. Snapshot them here, prove their basic semantics, and
 * expose only exact-value operations to the at-rest sink.
 */

const NativeArray = globalThis.Array;
const NativeBuffer = BuiltinBuffer;
const NativeFunction = globalThis.Function;
const NativeObject = globalThis.Object;
const NativeRegExp = globalThis.RegExp;
const NativeReflect = globalThis.Reflect;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const NativeUint8Array = globalThis.Uint8Array;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeBufferAlloc = NativeBuffer.alloc;
const nativeBufferConcat = NativeBuffer.concat;
const nativeBufferFrom = NativeBuffer.from;
const nativeBufferIsBuffer = NativeBuffer.isBuffer;
const nativeBufferToString = NativeBuffer.prototype.toString;
const nativeCreateCipheriv = builtinCreateCipheriv;
const nativeFunctionHasInstance = NativeFunction.prototype[Symbol.hasInstance];
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIs = NativeObject.is;
const nativeRandomBytes = builtinRandomBytes;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeReflectApply = NativeReflect.apply;
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetDelete = NativeSet.prototype.delete;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringTrim = NativeString.prototype.trim;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function getOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
}

function getPrototypeOf(value: object): object | null {
  return apply(nativeObjectGetPrototypeOf, NativeObject, [value]);
}

function objectIs(left: unknown, right: unknown): boolean {
  return apply(nativeObjectIs, NativeObject, [left, right]);
}

const cipherControl = nativeCreateCipheriv(
  'aes-256-gcm',
  apply<Buffer>(nativeBufferAlloc, NativeBuffer, [32]),
  apply<Buffer>(nativeBufferAlloc, NativeBuffer, [12]),
);
const nativeCipherSetAad = capturedMethod(cipherControl, 'setAAD');
const nativeCipherUpdate = capturedMethod(cipherControl, 'update');
const nativeCipherFinal = capturedMethod(cipherControl, 'final');
const nativeCipherGetAuthTag = capturedMethod(cipherControl, 'getAuthTag');
const nativeByteLength = capturedAccessor(
  apply<Buffer>(nativeBufferAlloc, NativeBuffer, [0]),
  'byteLength',
);

function sameDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    objectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

function capturedMethod(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = getOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new NativeTypeError(
          `Kovo confidential cipher ${NativeString(property)} is unavailable.`,
        );
      }
      return descriptor.value;
    }
    owner = getPrototypeOf(owner);
  }
  throw new NativeTypeError(`Kovo confidential cipher ${NativeString(property)} is unavailable.`);
}

function capturedAccessor(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = getOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (typeof descriptor.get !== 'function') {
        throw new NativeTypeError(
          `Kovo confidential byte ${NativeString(property)} control is unavailable.`,
        );
      }
      return descriptor.get;
    }
    owner = getPrototypeOf(owner);
  }
  throw new NativeTypeError(`Kovo confidential byte ${NativeString(property)} is unavailable.`);
}

function byteLength(value: Uint8Array): number {
  return apply(nativeByteLength, value, []);
}

function confidentialControlsAreSound(): boolean {
  try {
    const randomLeft = nativeRandomBytes(32);
    const randomRight = nativeRandomBytes(32);
    if (
      apply(nativeBufferIsBuffer, NativeBuffer, [randomLeft]) !== true ||
      apply(nativeBufferIsBuffer, NativeBuffer, [randomRight]) !== true ||
      byteLength(randomLeft) !== 32 ||
      byteLength(randomRight) !== 32
    ) {
      return false;
    }
    let randomDiffers = false;
    for (let index = 0; index < 32; index += 1) {
      if (randomLeft[index] !== randomRight[index]) {
        randomDiffers = true;
        break;
      }
    }
    if (!randomDiffers) return false;

    const set = new NativeSet<string>();
    apply(nativeSetAdd, set, ['safe']);
    if (apply(nativeSetHas, set, ['safe']) !== true) return false;
    if (apply(nativeSetHas, set, ['attacker']) !== false) return false;
    if (apply(nativeSetDelete, set, ['safe']) !== true) return false;
    if (apply(nativeSetHas, set, ['safe']) !== false) return false;

    const controlAad = apply<Buffer>(nativeBufferFrom, NativeBuffer, ['aad']);
    const controlPlaintext = apply<Buffer>(nativeBufferFrom, NativeBuffer, ['plaintext']);
    apply(nativeCipherSetAad, cipherControl, [controlAad]);
    const controlCiphertext = apply<Buffer>(nativeCipherUpdate, cipherControl, [controlPlaintext]);
    const controlFinal = apply<Buffer>(nativeCipherFinal, cipherControl, []);
    const controlCombined = apply<Buffer>(nativeBufferConcat, NativeBuffer, [
      [controlCiphertext, controlFinal],
    ]);
    const controlTag = apply<Buffer>(nativeCipherGetAuthTag, cipherControl, []);
    if (
      apply<string>(nativeBufferToString, controlCombined, ['hex']) !== 'becb215423140e1673' ||
      apply<string>(nativeBufferToString, controlTag, ['hex']) !==
        'adcb624a73760b8c0871e693e5ade3f7'
    ) {
      return false;
    }
    if (apply<string>(nativeStringTrim, ' aad ', []) !== 'aad') return false;
    if (
      apply<RegExpExecArray | null>(nativeRegExpExec, /^[A-Za-z0-9_-]{43,44}$/u, [
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ]) === null ||
      apply<RegExpExecArray | null>(nativeRegExpExec, /^[A-Za-z0-9_-]{43,44}$/u, ['not-a-key']) !==
        null
    ) {
      return false;
    }
    return apply<string>(nativeArrayJoin, ['kovo', 'safe'], ['.']) === 'kovo.safe';
  } catch {
    return false;
  }
}

const confidentialControlsSound = confidentialControlsAreSound();
const IV_REPLAY_WINDOW = 4_096;
const recentIvs = new NativeSet<string>();
const recentIvOrder: string[] = [];
let recentIvCursor = 0;

function rememberIv(iv: Buffer): void {
  const key = apply<string>(nativeBufferToString, iv, ['base64url']);
  if (apply(nativeSetHas, recentIvs, [key])) {
    throw new NativeTypeError(
      'Kovo confidential-at-rest random source repeated a recent AES-GCM IV; refusing nonce reuse.',
    );
  }
  if (recentIvOrder.length < IV_REPLAY_WINDOW) {
    const index = recentIvOrder.length;
    apply(nativeObjectDefineProperty, NativeObject, [
      recentIvOrder,
      index,
      { configurable: true, enumerable: true, value: key, writable: true },
    ]);
    const committed = getOwnPropertyDescriptor(recentIvOrder, index);
    if (
      committed === undefined ||
      !('value' in committed) ||
      committed.value !== key ||
      recentIvOrder.length !== index + 1
    ) {
      throw new NativeTypeError('Kovo confidential IV own-data commit failed.');
    }
  } else {
    const expired = recentIvOrder[recentIvCursor]!;
    apply(nativeSetDelete, recentIvs, [expired]);
    recentIvOrder[recentIvCursor] = key;
    recentIvCursor = (recentIvCursor + 1) % IV_REPLAY_WINDOW;
  }
  apply(nativeSetAdd, recentIvs, [key]);
}

export function assertConfidentialAtRestIntrinsics(): void {
  if (!confidentialControlsSound) {
    throw new NativeTypeError(
      'Kovo confidential-at-rest controls are unavailable because crypto or realm intrinsics were modified before framework initialization.',
    );
  }
}

export function confidentialOwnDataValue(
  source: unknown,
  property: PropertyKey,
  label: string,
): unknown {
  assertConfidentialAtRestIntrinsics();
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new NativeTypeError(`${label} must be an object with stable own data properties.`);
  }
  const before = getOwnPropertyDescriptor(source, property);
  const after = getOwnPropertyDescriptor(source, property);
  if (!sameDataDescriptor(before, after)) {
    throw new NativeTypeError(`${label}.${NativeString(property)} changed while it was pinned.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new NativeTypeError(`${label}.${NativeString(property)} must be an own data property.`);
  }
  return before.value;
}

export function confidentialIsUint8Array(value: unknown): value is Uint8Array {
  assertConfidentialAtRestIntrinsics();
  return apply(nativeFunctionHasInstance, NativeUint8Array, [value]);
}

export function confidentialBufferFrom(
  value: string | ArrayBufferView,
  encoding?: BufferEncoding,
): Buffer {
  assertConfidentialAtRestIntrinsics();
  return apply(
    nativeBufferFrom,
    NativeBuffer,
    encoding === undefined ? [value] : [value, encoding],
  );
}

export function confidentialBufferLength(value: Uint8Array): number {
  assertConfidentialAtRestIntrinsics();
  return byteLength(value);
}

export function confidentialRegExpTest(expression: RegExp, value: string): boolean {
  assertConfidentialAtRestIntrinsics();
  return apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value]) !== null;
}

export function confidentialStringTrim(value: string): string {
  assertConfidentialAtRestIntrinsics();
  return apply(nativeStringTrim, value, []);
}

export function confidentialEncryptEnvelope(
  plaintext: Buffer,
  key: Buffer,
  aad: Buffer,
  keyId: string | undefined,
): string {
  assertConfidentialAtRestIntrinsics();
  const iv = nativeRandomBytes(12);
  if (apply(nativeBufferIsBuffer, NativeBuffer, [iv]) !== true || byteLength(iv) !== 12) {
    throw new NativeTypeError('Kovo confidential-at-rest random source returned an invalid IV.');
  }
  rememberIv(iv);
  const cipher = nativeCreateCipheriv('aes-256-gcm', key, iv);
  apply(nativeCipherSetAad, cipher, [aad]);
  const ciphertext = apply<Buffer>(nativeBufferConcat, NativeBuffer, [
    [
      apply<Buffer>(nativeCipherUpdate, cipher, [plaintext]),
      apply<Buffer>(nativeCipherFinal, cipher, []),
    ],
  ]);
  const tag = apply<Buffer>(nativeCipherGetAuthTag, cipher, []);
  return apply<string>(
    nativeArrayJoin,
    [
      'kovo-aes256gcm-v1',
      keyId ?? '',
      apply<string>(nativeBufferToString, iv, ['base64url']),
      apply<string>(nativeBufferToString, tag, ['base64url']),
      apply<string>(nativeBufferToString, ciphertext, ['base64url']),
    ],
    ['.'],
  );
}
