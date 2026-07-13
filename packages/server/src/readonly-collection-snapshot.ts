import { isKovoRuntimeMetadataCollection } from '@kovojs/drizzle/internal/runtime-metadata';
import {
  witnessGetOwnPropertyDescriptor,
  witnessMapForEach,
  witnessMapSize,
  witnessReflectApply,
  witnessSetForEach,
  witnessSetSize,
} from './security-witness-intrinsics.js';

const maximumSnapshotCollectionSize = 9_007_199_254_740_991;

function isNativeReadonlyMap(value: unknown): value is ReadonlyMap<unknown, unknown> {
  try {
    witnessMapSize(value as ReadonlyMap<unknown, unknown>);
    return true;
  } catch {
    return false;
  }
}

function isNativeReadonlySet(value: unknown): value is ReadonlySet<unknown> {
  try {
    witnessSetSize(value as ReadonlySet<unknown>);
    return true;
  } catch {
    return false;
  }
}

function ownCollectionForEach(value: unknown, label: string): { method: Function; size: number } {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError(`${label} must be a collection.`);
  }
  const method = witnessGetOwnPropertyDescriptor(value, 'forEach');
  const size = witnessGetOwnPropertyDescriptor(value, 'size');
  if (method === undefined || !('value' in method) || typeof method.value !== 'function') {
    throw new TypeError(`${label} must expose an own-data forEach method.`);
  }
  if (
    size === undefined ||
    !('value' in size) ||
    typeof size.value !== 'number' ||
    size.value < 0 ||
    size.value % 1 !== 0 ||
    size.value > maximumSnapshotCollectionSize
  ) {
    throw new TypeError(`${label} must expose a bounded own-data size.`);
  }
  if (!isKovoRuntimeMetadataCollection(value)) {
    throw new TypeError(`${label} non-native collection must be framework-minted.`);
  }
  return { method: method.value, size: size.value };
}

export function forEachReadonlyMapEntry<Key, Value>(
  value: unknown,
  label: string,
  callback: (entry: Value, key: Key) => void,
): void {
  if (isNativeReadonlyMap(value)) {
    witnessMapForEach(value as ReadonlyMap<Key, Value>, callback);
    return;
  }

  const source = ownCollectionForEach(value, label);
  let count = 0;
  witnessReflectApply(source.method, value, [
    (entry: Value, key: Key) => {
      count += 1;
      if (count > source.size) throw new TypeError(`${label} emitted more entries than its size.`);
      callback(entry, key);
    },
  ]);
  if (count !== source.size) {
    throw new TypeError(`${label} did not emit exactly its declared size.`);
  }
}

export function forEachReadonlySetValue<Value>(
  value: unknown,
  label: string,
  callback: (entry: Value) => void,
): void {
  if (isNativeReadonlySet(value)) {
    witnessSetForEach(value as ReadonlySet<Value>, callback);
    return;
  }

  const source = ownCollectionForEach(value, label);
  let count = 0;
  witnessReflectApply(source.method, value, [
    (entry: Value) => {
      count += 1;
      if (count > source.size) throw new TypeError(`${label} emitted more entries than its size.`);
      callback(entry);
    },
  ]);
  if (count !== source.size) {
    throw new TypeError(`${label} did not emit exactly its declared size.`);
  }
}
