/**
 * Boot-pinned cryptographic source for SPEC §10.3 mutation idempotency tokens.
 *
 * The inline loader and modular client both share a realm with application code. They therefore
 * retain and semantically check the cryptographic functions instead of consulting live `crypto`
 * properties at submit time or falling back to a predictable clock/counter.
 *
 * @internal
 */
export function createMutationIdemSecurityControls(scope: typeof globalThis = globalThis) {
  const NativeObject = Object;
  const NativeReflect = Reflect;
  const NativeString = String;
  const NativeUint8Array = Uint8Array;
  const nativeReflectApply = NativeReflect.apply;
  const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
  const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
  const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
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

  const randomUuid = cryptoObject ? stableMethod(cryptoObject, 'randomUUID') : undefined;
  const getRandomValues = cryptoObject ? stableMethod(cryptoObject, 'getRandomValues') : undefined;

  function baseControlsAreSound(): boolean {
    try {
      const control = { safe: true };
      const found = descriptor(control, 'safe');
      return (
        apply<number>((left: number, right: number) => left + right, undefined, [2, 3]) === 5 &&
        found !== undefined &&
        'value' in found &&
        found.value === true &&
        apply<number>(nativeStringCharCodeAt, 'a', [0]) === 0x61 &&
        apply<string>(nativeStringToLowerCase, 'AB', []) === 'ab'
      );
    } catch {
      return false;
    }
  }

  const baseControlsSound = baseControlsAreSound();

  function isHex(code: number): boolean {
    return (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x46) ||
      (code >= 0x61 && code <= 0x66)
    );
  }

  function validUuid(value: unknown): value is string {
    if (typeof value !== 'string' || value.length !== 36) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (index === 8 || index === 13 || index === 18 || index === 23) {
        if (value[index] !== '-') return false;
        continue;
      }
      const code = apply<number>(nativeStringCharCodeAt, value, [index]);
      if (!isHex(code)) return false;
    }
    const version = value[14];
    const variant = apply<string>(nativeStringToLowerCase, value[19] || '', []);
    return version === '4' && (variant === '8' || variant === '9' || variant === 'a' || variant === 'b');
  }

  function uuidControlIsSound(): boolean {
    if (!baseControlsSound || !randomUuid || !cryptoObject) return false;
    try {
      const first = apply<unknown>(randomUuid, cryptoObject, []);
      const second = apply<unknown>(randomUuid, cryptoObject, []);
      return validUuid(first) && validUuid(second) && first !== second;
    } catch {
      return false;
    }
  }

  function randomValuesControlIsSound(): boolean {
    if (!baseControlsSound || !getRandomValues || !cryptoObject) return false;
    try {
      const first = new NativeUint8Array(16);
      const second = new NativeUint8Array(16);
      if (
        apply<unknown>(getRandomValues, cryptoObject, [first]) !== first ||
        apply<unknown>(getRandomValues, cryptoObject, [second]) !== second
      ) {
        return false;
      }
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

  const uuidSound = uuidControlIsSound();
  const randomValuesSound = randomValuesControlIsSound();

  function createMutationIdem(): string {
    if (uuidSound && randomUuid && cryptoObject) {
      const value = apply<unknown>(randomUuid, cryptoObject, []);
      if (validUuid(value)) return value;
      throw new TypeError('Kovo mutation randomUUID control returned an invalid token.');
    }
    if (randomValuesSound && getRandomValues && cryptoObject) {
      const bytes = new NativeUint8Array(16);
      if (apply<unknown>(getRandomValues, cryptoObject, [bytes]) !== bytes) {
        throw new TypeError('Kovo mutation getRandomValues control returned an invalid result.');
      }
      const alphabet = '0123456789abcdef';
      let hex = '';
      for (let index = 0; index < bytes.length; index += 1) {
        const byte = bytes[index];
        if (typeof byte !== 'number') {
          throw new TypeError('Kovo mutation getRandomValues control returned invalid bytes.');
        }
        hex += alphabet[(byte >>> 4) & 0x0f] + alphabet[byte & 0x0f];
      }
      return 'idem_' + hex;
    }
    throw new Error(
      'Kovo mutation idempotency requires a verified cryptographic source (crypto.randomUUID or crypto.getRandomValues); SPEC §10.3 forbids a predictable token.',
    );
  }

  return { createMutationIdem };
}
