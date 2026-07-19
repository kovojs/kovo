import {
  freezeSecurityValue,
  securityApply,
  securityArrayAppend,
  securityDefineProperty,
  securityGetOwnPropertyDescriptor,
  securityGetPrototypeOf,
  securityHasInstance,
  securityStringCharCodeAt,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
} from '#security-witness-intrinsics';

const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicUint8Array = Uint8Array;
const intrinsicUint8ArraySet = IntrinsicUint8Array.prototype.set;
const typedArrayPrototype = securityGetPrototypeOf(IntrinsicUint8Array.prototype);
const intrinsicTypedArrayBuffer =
  typedArrayPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
const intrinsicTypedArrayByteOffset =
  typedArrayPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')?.get;
const intrinsicTypedArrayByteLength =
  typedArrayPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const capturedSubtleCrypto = globalThis.crypto?.subtle;
const capturedSubtleImportKey = capturedSubtleCrypto?.importKey;
const capturedSubtleVerify = capturedSubtleCrypto?.verify;
const capturedCryptoByteControlsSound = verifyCapturedCryptoByteControls();
const capturedWebhookHmacCryptoControl = verifyCapturedWebhookHmacCryptoControls();

/** Package-private, purpose-minimal provider-webhook HMAC verification authority. */
export interface ProviderWebhookHmacVerifyHandle {
  verify(payload: Uint8Array, signatures: readonly Uint8Array[]): Promise<boolean>;
}

interface ProviderWebhookHmacVerifyState {
  readonly secrets: readonly Uint8Array[];
}

const providerWebhookHmacVerifyStates = securityWeakMap<
  ProviderWebhookHmacVerifyHandle,
  ProviderWebhookHmacVerifyState
>();

/**
 * Capture provider-owned signing material behind a verify-only core-realm authority.
 *
 * This module is deliberately private: SPEC §6.6 permits raw provider protocol keys only through
 * a purpose-minimal verifier handle. The handle exposes no key, generic signer, or WebCrypto
 * primitive, and its runtime authority is witnessed by the module-private WeakMap.
 */
export function createProviderWebhookHmacVerifyHandle(
  secrets: readonly Uint8Array[],
): ProviderWebhookHmacVerifyHandle {
  const ownedSecrets: Uint8Array[] = [];
  const length = exactArrayLength(secrets, 'Provider webhook HMAC secret array', 32);
  if (length === 0) {
    throw new TypeError('Provider webhook HMAC verification requires at least one secret.');
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(secrets, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      !securityHasInstance(IntrinsicUint8Array, descriptor.value)
    ) {
      throw new TypeError('Provider webhook HMAC secrets must be stable Uint8Array entries.');
    }
    securityArrayAppend(ownedSecrets, copyCryptoBytes(descriptor.value));
  }
  freezeSecurityValue(ownedSecrets);

  let handle!: ProviderWebhookHmacVerifyHandle;
  handle = freezeSecurityValue({
    async verify(payload: Uint8Array, signatures: readonly Uint8Array[]) {
      return verifyProviderWebhookHmac(handle, payload, signatures);
    },
  });
  securityWeakMapSet(
    providerWebhookHmacVerifyStates,
    handle,
    freezeSecurityValue({ secrets: ownedSecrets }),
  );
  return handle;
}

async function verifyProviderWebhookHmac(
  handle: ProviderWebhookHmacVerifyHandle,
  payload: Uint8Array,
  signatures: readonly Uint8Array[],
): Promise<boolean> {
  const state = securityWeakMapGet(providerWebhookHmacVerifyStates, handle);
  if (state === undefined) {
    throw new TypeError('Provider webhook HMAC verification authority is unavailable.');
  }
  if (!(await capturedWebhookHmacCryptoControl)) {
    throw new TypeError(
      'Kovo HMAC verifier crypto controls were modified before framework initialization.',
    );
  }
  if (
    capturedSubtleCrypto === undefined ||
    capturedSubtleImportKey === undefined ||
    capturedSubtleVerify === undefined
  ) {
    throw new TypeError('Kovo HMAC verifier requires Web Crypto SubtleCrypto support.');
  }

  const signatureLength = exactArrayLength(signatures, 'Provider webhook HMAC signature array', 64);
  const payloadBytes = pinCryptoByteView(copyCryptoBytes(payload));
  const secretLength = exactArrayLength(state.secrets, 'Provider webhook HMAC authority keys', 32);
  for (let secretIndex = 0; secretIndex < secretLength; secretIndex += 1) {
    const secretDescriptor = securityGetOwnPropertyDescriptor(state.secrets, secretIndex);
    if (
      secretDescriptor === undefined ||
      !('value' in secretDescriptor) ||
      !securityHasInstance(IntrinsicUint8Array, secretDescriptor.value)
    ) {
      throw new TypeError('Provider webhook HMAC verification authority is unavailable.');
    }
    const secretBytes = pinCryptoByteView(copyCryptoBytes(secretDescriptor.value));
    const key = await securityApply<Promise<CryptoKey>>(
      capturedSubtleImportKey,
      capturedSubtleCrypto,
      ['raw', secretBytes, { hash: 'SHA-256', name: 'HMAC' }, false, ['verify']],
    );

    for (let signatureIndex = 0; signatureIndex < signatureLength; signatureIndex += 1) {
      const signatureDescriptor = securityGetOwnPropertyDescriptor(signatures, signatureIndex);
      if (
        signatureDescriptor === undefined ||
        !('value' in signatureDescriptor) ||
        !securityHasInstance(IntrinsicUint8Array, signatureDescriptor.value) ||
        byteLengthOf(signatureDescriptor.value) !== 32
      ) {
        continue;
      }
      const signatureBytes = pinCryptoByteView(copyCryptoBytes(signatureDescriptor.value));
      const verified = await securityApply<Promise<boolean>>(
        capturedSubtleVerify,
        capturedSubtleCrypto,
        ['HMAC', key, signatureBytes, payloadBytes],
      );
      if (verified === true) return true;
    }
  }
  return false;
}

async function verifyCapturedWebhookHmacCryptoControls(): Promise<boolean> {
  if (
    !capturedCryptoByteControlsSound ||
    capturedSubtleCrypto === undefined ||
    capturedSubtleImportKey === undefined ||
    capturedSubtleVerify === undefined
  ) {
    return false;
  }
  try {
    const keyBytes = pinCryptoByteView(utf8ControlBytes('kovo-hmac-control-key'));
    const payloadBytes = pinCryptoByteView(utf8ControlBytes('kovo-hmac-control-payload'));
    const signatureBytes = pinCryptoByteView(
      hexControlBytes('0822211b3d7ed77d25825fa1873c00ea4809fde1dc06e95f71d5a891ca453a0b'),
    );
    const invalidSignatureBytes = pinCryptoByteView(copyCryptoBytes(signatureBytes));
    invalidSignatureBytes[0] = (invalidSignatureBytes[0] ?? 0) ^ 1;
    const key = await securityApply<Promise<CryptoKey>>(
      capturedSubtleImportKey,
      capturedSubtleCrypto,
      ['raw', keyBytes, { hash: 'SHA-256', name: 'HMAC' }, false, ['verify']],
    );
    const valid = await securityApply<Promise<boolean>>(
      capturedSubtleVerify,
      capturedSubtleCrypto,
      ['HMAC', key, signatureBytes, payloadBytes],
    );
    const invalid = await securityApply<Promise<boolean>>(
      capturedSubtleVerify,
      capturedSubtleCrypto,
      ['HMAC', key, invalidSignatureBytes, payloadBytes],
    );
    return valid === true && invalid === false;
  } catch {
    return false;
  }
}

function verifyCapturedCryptoByteControls(): boolean {
  try {
    if (
      intrinsicTypedArrayBuffer === undefined ||
      intrinsicTypedArrayByteOffset === undefined ||
      intrinsicTypedArrayByteLength === undefined
    ) {
      return false;
    }
    const buffer = new IntrinsicArrayBuffer(4);
    const bytes = new IntrinsicUint8Array(buffer);
    bytes[0] = 0x4b;
    bytes[1] = 0x6f;
    bytes[2] = 0x76;
    bytes[3] = 0x6f;
    const copy = new IntrinsicUint8Array(4);
    securityApply<void>(intrinsicUint8ArraySet, copy, [bytes, 0]);
    return (
      securityApply<ArrayBufferLike>(intrinsicTypedArrayBuffer, bytes, []) === buffer &&
      securityApply<number>(intrinsicTypedArrayByteOffset, bytes, []) === 0 &&
      securityApply<number>(intrinsicTypedArrayByteLength, bytes, []) === 4 &&
      copy[0] === 0x4b &&
      copy[1] === 0x6f &&
      copy[2] === 0x76 &&
      copy[3] === 0x6f
    );
  } catch {
    return false;
  }
}

function copyCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!capturedCryptoByteControlsSound) {
    throw new TypeError('Kovo HMAC verifier byte controls are unavailable.');
  }
  const copy = new IntrinsicUint8Array(byteLengthOf(bytes));
  securityApply<void>(intrinsicUint8ArraySet, copy, [bytes, 0]);
  return copy;
}

function byteLengthOf(value: Uint8Array): number {
  if (!capturedCryptoByteControlsSound || intrinsicTypedArrayByteLength === undefined) {
    throw new TypeError('Kovo HMAC verifier byte-length controls are unavailable.');
  }
  return securityApply<number>(intrinsicTypedArrayByteLength, value, []);
}

function pinCryptoByteView(value: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (
    !capturedCryptoByteControlsSound ||
    intrinsicTypedArrayBuffer === undefined ||
    intrinsicTypedArrayByteOffset === undefined ||
    intrinsicTypedArrayByteLength === undefined
  ) {
    throw new TypeError('Kovo HMAC verifier byte-view controls are unavailable.');
  }
  const buffer = securityApply<ArrayBufferLike>(intrinsicTypedArrayBuffer, value, []);
  const byteOffset = securityApply<number>(intrinsicTypedArrayByteOffset, value, []);
  const byteLength = securityApply<number>(intrinsicTypedArrayByteLength, value, []);
  securityDefineProperty(value, 'buffer', {
    configurable: false,
    enumerable: false,
    value: buffer,
    writable: false,
  });
  securityDefineProperty(value, 'byteOffset', {
    configurable: false,
    enumerable: false,
    value: byteOffset,
    writable: false,
  });
  securityDefineProperty(value, 'byteLength', {
    configurable: false,
    enumerable: false,
    value: byteLength,
    writable: false,
  });
  return value;
}

function exactArrayLength(value: readonly unknown[], label: string, maximum: number): number {
  const descriptor = securityGetOwnPropertyDescriptor(value, 'length');
  const length = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  if (typeof length !== 'number' || length % 1 !== 0 || length < 0 || length > maximum) {
    throw new TypeError(`${label} must contain at most ${maximum} entries.`);
  }
  return length;
}

function utf8ControlBytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new IntrinsicUint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = securityStringCharCodeAt(value, index);
  }
  return bytes;
}

function hexControlBytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new IntrinsicUint8Array(value.length / 2);
  for (let index = 0; index < value.length / 2; index += 1) {
    const high = hexNibble(securityStringCharCodeAt(value, index * 2));
    const low = hexNibble(securityStringCharCodeAt(value, index * 2 + 1));
    if (high < 0 || low < 0) {
      throw new TypeError('Kovo HMAC verifier known-answer signature is invalid.');
    }
    bytes[index] = (high << 4) + low;
  }
  return bytes;
}

function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}
