import {
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
} from './security-witness-intrinsics.js';

/**
 * Resolve a framework registry entry without invoking mutable Array prototypes or declaration
 * accessors. Registry keys select security posture as well as behavior, so a lookup must not be
 * able to return a different declaration after evaluated application code poisons Array.find.
 *
 * @internal
 */
export function denseOwnRegistryEntryByExactKey<Entry extends object>(
  entries: readonly Entry[],
  key: string,
  registryName: string,
): Entry | undefined {
  return denseOwnArrayFind(
    entries,
    (entry) => {
      if ((typeof entry !== 'object' && typeof entry !== 'function') || entry === null) {
        throw new TypeError(`${registryName} entries must be objects with stable own keys.`);
      }
      const keyDescriptor = witnessGetOwnPropertyDescriptor(entry, 'key');
      if (
        keyDescriptor === undefined ||
        !('value' in keyDescriptor) ||
        typeof keyDescriptor.value !== 'string'
      ) {
        throw new TypeError(`${registryName} entries must expose stable own string keys.`);
      }
      return keyDescriptor.value === key;
    },
    registryName,
  );
}

/** @internal Traverse a framework-owned dense carrier without mutable Array callbacks. */
export function denseOwnArrayFind<Value>(
  entries: readonly Value[],
  predicate: (entry: Value) => boolean,
  registryName: string,
): Value | undefined {
  if (!witnessIsArray(entries)) {
    throw new TypeError(`${registryName} must be a dense array.`);
  }

  const lengthDescriptor = witnessGetOwnPropertyDescriptor(entries, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number'
  ) {
    throw new TypeError(`${registryName} must expose a stable own length.`);
  }

  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const entryDescriptor = witnessGetOwnPropertyDescriptor(entries, index);
    if (entryDescriptor === undefined || !('value' in entryDescriptor)) {
      throw new TypeError(`${registryName} must contain only dense own data entries.`);
    }
    const entry = entryDescriptor.value as Value;
    if (predicate(entry)) return entry;
  }

  return undefined;
}

/** @internal Visit every dense own value without mutable iterator or Array callback dispatch. */
export function denseOwnArrayForEach<Value>(
  entries: readonly Value[],
  callback: (entry: Value) => void,
  registryName: string,
): void {
  denseOwnArrayFind(
    entries,
    (entry) => {
      callback(entry);
      return false;
    },
    registryName,
  );
}

/** @internal Append to a private dense result without an inherited numeric setter or Array.push. */
export function appendDenseOwnArrayValue<Value>(entries: Value[], value: Value): void {
  const lengthDescriptor = witnessGetOwnPropertyDescriptor(entries, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number'
  ) {
    throw new TypeError('Kovo internal result array must expose a stable own length.');
  }
  witnessDefineProperty(entries, lengthDescriptor.value, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
