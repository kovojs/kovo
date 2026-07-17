/**
 * Boot-pinned cryptographic and clock sources for SPEC §10.3 mutation idempotency tokens.
 *
 * Server-stamped enhanced forms preserve their token's issued-at value and replace only the
 * 128-bit nonce. Direct seedless APIs use the captured client clock because no server timestamp
 * exists to preserve.
 *
 * @internal
 */
export function createMutationIdemSecurityControls(scope: typeof globalThis = globalThis) {
  const NativeDate = scope.Date ?? Date;
  const NativeNumber = Number;
  const NativeObject = Object;
  const NativeReflect = Reflect;
  const NativeString = String;
  const NativeUint8Array = Uint8Array;
  const nativeReflectApply = NativeReflect.apply;
  const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
  const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
  const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
  const nativeStringFromCharCode = NativeString.fromCharCode;
  const nativeStringSlice = NativeString.prototype.slice;
  const cryptoObject = scope.crypto;

  function apply<Return>(method: Function, receiver: unknown, args: readonly unknown[]): Return {
    return nativeReflectApply(method, receiver, args) as Return;
  }

  function descriptor(value: object, property: PropertyKey): PropertyDescriptor | undefined {
    return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
  }

  function stableMethod(value: object, property: PropertyKey): Function | undefined {
    let owner: object | null = value;
    for (let depth = 0; owner !== null && depth < 16; depth += 1) {
      const found = descriptor(owner, property);
      if (found !== undefined) {
        return 'value' in found && typeof found.value === 'function' ? found.value : undefined;
      }
      owner = apply(nativeObjectGetPrototypeOf, NativeObject, [owner]);
    }
    return undefined;
  }

  function stableGetter(value: object, property: PropertyKey): Function | undefined {
    let owner: object | null = value;
    for (let depth = 0; owner !== null && depth < 16; depth += 1) {
      const found = descriptor(owner, property);
      if (found !== undefined) {
        return typeof found.get === 'function' ? found.get : undefined;
      }
      owner = apply(nativeObjectGetPrototypeOf, NativeObject, [owner]);
    }
    return undefined;
  }

  const getRandomValues = cryptoObject ? stableMethod(cryptoObject, 'getRandomValues') : undefined;
  const dateNow = stableMethod(NativeDate, 'now');
  const uint8ArrayByteLength = stableGetter(NativeUint8Array.prototype, 'byteLength');

  function baseControlsAreSound(): boolean {
    try {
      const control = { safe: true };
      const found = descriptor(control, 'safe');
      return (
        apply<number>((left: number, right: number) => left + right, undefined, [2, 3]) === 5 &&
        found !== undefined &&
        'value' in found &&
        found.value === true &&
        apply<boolean>(nativeNumberIsSafeInteger, NativeNumber, [42]) === true &&
        apply<boolean>(nativeNumberIsSafeInteger, NativeNumber, [4.2]) === false &&
        apply<number>(nativeStringCharCodeAt, 'a', [0]) === 0x61 &&
        apply<string>(nativeStringSlice, 'kovo', [1, 3]) === 'ov'
      );
    } catch {
      return false;
    }
  }

  const baseControlsSound = baseControlsAreSound();

  function hexDigit(value: number): string {
    return value < 10
      ? apply<string>(NativeString, undefined, [value])
      : apply<string>(nativeStringFromCharCode, NativeString, [0x61 + value - 10]);
  }

  function randomValuesControlIsSound(): boolean {
    if (!baseControlsSound || !getRandomValues || !cryptoObject || !uint8ArrayByteLength) {
      return false;
    }
    try {
      const first = new NativeUint8Array(16);
      const second = new NativeUint8Array(16);
      if (
        apply<unknown>(getRandomValues, cryptoObject, [first]) !== first ||
        apply<unknown>(getRandomValues, cryptoObject, [second]) !== second
      ) {
        return false;
      }
      if (
        apply<unknown>(uint8ArrayByteLength, first, []) !== 16 ||
        apply<unknown>(uint8ArrayByteLength, second, []) !== 16
      ) {
        return false;
      }
      let rejectedForeignByteLengthReceiver = false;
      try {
        apply(uint8ArrayByteLength, {}, []);
      } catch {
        rejectedForeignByteLengthReceiver = true;
      }
      if (!rejectedForeignByteLengthReceiver) return false;
      let differs = false;
      let nonzero = false;
      for (let index = 0; index < 16; index += 1) {
        const left = first[index];
        const right = second[index];
        if (typeof left !== 'number' || typeof right !== 'number') return false;
        if (left !== right) differs = true;
        if (left !== 0 || right !== 0) nonzero = true;
      }
      return differs && nonzero;
    } catch {
      return false;
    }
  }

  const randomValuesSound = randomValuesControlIsSound();

  function timestampFromToken(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length !== 49) return undefined;
    if (
      apply<number>(nativeStringCharCodeAt, value, [0]) !== 0x76 ||
      apply<number>(nativeStringCharCodeAt, value, [1]) !== 0x31 ||
      apply<number>(nativeStringCharCodeAt, value, [2]) !== 0x5f ||
      apply<number>(nativeStringCharCodeAt, value, [16]) !== 0x5f
    ) {
      return undefined;
    }
    for (let index = 3; index < 16; index += 1) {
      const code = apply<number>(nativeStringCharCodeAt, value, [index]);
      if (code < 0x30 || code > 0x39) return undefined;
    }
    for (let index = 17; index < 49; index += 1) {
      const code = apply<number>(nativeStringCharCodeAt, value, [index]);
      if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) {
        return undefined;
      }
    }
    return apply(nativeStringSlice, value, [3, 16]);
  }

  function currentTimestamp(): string {
    if (!baseControlsSound || !dateNow) {
      throw new Error('Kovo mutation idempotency requires a verified client clock.');
    }
    const now = apply<unknown>(dateNow, NativeDate, []);
    if (
      typeof now !== 'number' ||
      !apply<boolean>(nativeNumberIsSafeInteger, NativeNumber, [now]) ||
      now < 1_000_000_000_000 ||
      now > 9_999_999_999_999
    ) {
      throw new TypeError('Kovo mutation idempotency clock is outside the 13-digit epoch range.');
    }
    return apply(NativeString, undefined, [now]);
  }

  function mintWithTimestamp(timestamp: string): string {
    if (!randomValuesSound || !getRandomValues || !cryptoObject || !uint8ArrayByteLength) {
      throw new Error(
        'Kovo mutation idempotency requires a verified 128-bit cryptographic source (crypto.getRandomValues).',
      );
    }
    const bytes = new NativeUint8Array(16);
    if (apply<unknown>(getRandomValues, cryptoObject, [bytes]) !== bytes) {
      throw new TypeError('Kovo mutation getRandomValues control returned an invalid result.');
    }
    const byteLength = apply<unknown>(uint8ArrayByteLength, bytes, []);
    if (byteLength !== 16) {
      throw new TypeError('Kovo mutation getRandomValues control returned an invalid byte length.');
    }
    let nonce = '';
    for (let index = 0; index < byteLength; index += 1) {
      const byte = bytes[index];
      if (typeof byte !== 'number') {
        throw new TypeError('Kovo mutation getRandomValues control returned invalid bytes.');
      }
      nonce += hexDigit((byte >>> 4) & 0x0f) + hexDigit(byte & 0x0f);
    }
    return 'v1_' + timestamp + '_' + nonce;
  }

  function createMutationIdem(): string {
    return mintWithTimestamp(currentTimestamp());
  }

  function refreshMutationIdem(seed: unknown): string {
    const timestamp = timestampFromToken(seed);
    if (timestamp === undefined) {
      throw new TypeError('Kovo enhanced mutation requires a canonical server-stamped token.');
    }
    return mintWithTimestamp(timestamp);
  }

  return { createMutationIdem, refreshMutationIdem };
}
