/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */
import { isProxy } from 'node:util/types';

import type { KovoSemanticCommandRequest } from './semantic-command-request.generated.js';

const nativeArray = Array;
const nativeArrayIsArray = Array.isArray;
const nativeArrayPrototype = Array.prototype;
const nativeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const nativeGetPrototypeOf = Object.getPrototypeOf;
const nativeNumberIsSafeInteger = Number.isSafeInteger;
const nativeObjectCreate = Object.create;
const nativeObjectDefineProperty = Object.defineProperty;
const nativeObjectFreeze = Object.freeze;
const nativeObjectPrototype = Object.prototype;
const nativeReflectApply = Reflect.apply;
const nativeOwnKeys = Reflect.ownKeys;
const nativeRegExpTest = RegExp.prototype.test;
const NativeTypeError = TypeError;
const nativeWeakSet = WeakSet;
const nativeWeakSetAdd = WeakSet.prototype.add;
const nativeWeakSetHas = WeakSet.prototype.has;
const semanticRequestKeys = nativeObjectFreeze(['arguments', 'command', 'form', 'options']);
const requiredSemanticRequestKeys = nativeObjectFreeze(['arguments', 'command', 'form']);
const arrayIndexPattern = /^(?:0|[1-9]\d*)$/u;
const MAX_SEMANTIC_REQUEST_DEPTH = 8;
const MAX_SEMANTIC_REQUEST_VALUES = 4_096;

interface SnapshotState {
  readonly seen: WeakSet<object>;
  values: number;
}

/**
 * @internal Copy a caller-owned semantic request without invoking any caller
 * accessor or proxy trap.
 *
 * This is the public programmatic runner's bootstrap boundary: the inert copy
 * is the only request value read before a command-specific compiler-realm lock
 * (SPEC.md §6.6 rule 6).
 */
export function snapshotKovoSemanticCommandRequest(request: unknown): KovoSemanticCommandRequest {
  const state: SnapshotState = {
    seen: new nativeWeakSet<object>(),
    values: 0,
  };
  const snapshot = snapshotSemanticValue(request, 'Kovo semantic command request', state, 0);
  if (!isSemanticRecord(snapshot)) {
    throw new NativeTypeError('Kovo semantic command request must be an exact plain data object.');
  }

  const keys = nativeOwnKeys(snapshot);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string' || !isSemanticRequestKey(key)) {
      throw new NativeTypeError(
        'Kovo semantic command request has an unsupported top-level field.',
      );
    }
  }
  for (let index = 0; index < requiredSemanticRequestKeys.length; index += 1) {
    const key = requiredSemanticRequestKeys[index]!;
    if (nativeGetOwnPropertyDescriptor(snapshot, key) === undefined) {
      throw new NativeTypeError(`Kovo semantic command request requires ${key}.`);
    }
  }

  const command = nativeGetOwnPropertyDescriptor(snapshot, 'command')?.value;
  const form = nativeGetOwnPropertyDescriptor(snapshot, 'form')?.value;
  const arguments_ = nativeGetOwnPropertyDescriptor(snapshot, 'arguments')?.value;
  const options = nativeGetOwnPropertyDescriptor(snapshot, 'options')?.value;
  if (typeof command !== 'string' || typeof form !== 'string') {
    throw new NativeTypeError('Kovo semantic command request command and form must be strings.');
  }
  if (!isSemanticRecord(arguments_)) {
    throw new NativeTypeError(
      'Kovo semantic command request arguments must be a plain data object.',
    );
  }
  if (options !== undefined && !isSemanticRecord(options)) {
    throw new NativeTypeError('Kovo semantic command request options must be a plain data object.');
  }
  return snapshot as unknown as KovoSemanticCommandRequest;
}

function snapshotSemanticValue(
  value: unknown,
  label: string,
  state: SnapshotState,
  depth: number,
): unknown {
  state.values += 1;
  if (state.values > MAX_SEMANTIC_REQUEST_VALUES || depth > MAX_SEMANTIC_REQUEST_DEPTH) {
    throw new NativeTypeError('Kovo semantic command request exceeds its structural limit.');
  }
  if (
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (value === null || typeof value !== 'object') {
    throw new NativeTypeError(`${label} contains an unsupported value.`);
  }
  if (isProxy(value)) {
    throw new NativeTypeError(`${label} must not contain a Proxy.`);
  }
  if (weakSetHas(state.seen, value)) {
    throw new NativeTypeError(`${label} must be acyclic.`);
  }
  weakSetAdd(state.seen, value);

  if (nativeArrayIsArray(value)) {
    return snapshotSemanticArray(value, label, state, depth);
  }
  const prototype = nativeGetPrototypeOf(value);
  if (prototype !== null && prototype !== nativeObjectPrototype) {
    throw new NativeTypeError(`${label} must contain only plain data objects.`);
  }
  const copy = nativeObjectCreate(null) as Record<PropertyKey, unknown>;
  const keys = nativeOwnKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string') {
      throw new NativeTypeError(`${label} must not contain symbol fields.`);
    }
    const fieldValue = requireDataValue(value, key, label);
    nativeObjectDefineProperty(copy, key, {
      configurable: false,
      enumerable: true,
      value: snapshotSemanticValue(fieldValue, `${label}.${key}`, state, depth + 1),
      writable: false,
    });
  }
  return nativeObjectFreeze(copy);
}

function snapshotSemanticArray(
  value: readonly unknown[],
  label: string,
  state: SnapshotState,
  depth: number,
): readonly unknown[] {
  if (nativeGetPrototypeOf(value) !== nativeArrayPrototype) {
    throw new NativeTypeError(`${label} must contain only ordinary arrays.`);
  }
  const length = requireDataValue(value, 'length', label);
  if (
    typeof length !== 'number' ||
    !nativeNumberIsSafeInteger(length) ||
    length < 0 ||
    length > MAX_SEMANTIC_REQUEST_VALUES
  ) {
    throw new NativeTypeError(`${label} contains an invalid array length.`);
  }
  const keys = nativeOwnKeys(value);
  if (keys.length !== length + 1) {
    throw new NativeTypeError(`${label} arrays must be dense and contain no extra fields.`);
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key !== 'length' && !isArrayIndexForLength(key, length)) {
      throw new NativeTypeError(`${label} arrays must be dense and contain no extra fields.`);
    }
  }

  const copy = new nativeArray<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    const item = requireDataValue(value, `${index}`, label);
    nativeObjectDefineProperty(copy, index, {
      configurable: false,
      enumerable: true,
      value: snapshotSemanticValue(item, `${label}[${index}]`, state, depth + 1),
      writable: false,
    });
  }
  return nativeObjectFreeze(copy);
}

function requireDataValue(value: object, key: PropertyKey, label: string): unknown {
  const descriptor = nativeGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new NativeTypeError(`${label} must contain only own data fields.`);
  }
  return descriptor.value;
}

function isSemanticRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || nativeArrayIsArray(value) || isProxy(value)) {
    return false;
  }
  const prototype = nativeGetPrototypeOf(value);
  return prototype === null || prototype === nativeObjectPrototype;
}

function isArrayIndexForLength(key: PropertyKey, length: number): boolean {
  if (
    typeof key !== 'string' ||
    !(nativeReflectApply(nativeRegExpTest, arrayIndexPattern, [key]) as boolean)
  ) {
    return false;
  }
  const index = +key;
  return nativeNumberIsSafeInteger(index) && index >= 0 && index < length && `${index}` === key;
}

function isSemanticRequestKey(value: string): boolean {
  for (let index = 0; index < semanticRequestKeys.length; index += 1) {
    if (semanticRequestKeys[index] === value) return true;
  }
  return false;
}

function weakSetHas(set: WeakSet<object>, value: object): boolean {
  return nativeReflectApply(nativeWeakSetHas, set, [value]) as boolean;
}

function weakSetAdd(set: WeakSet<object>, value: object): void {
  nativeReflectApply(nativeWeakSetAdd, set, [value]);
}
