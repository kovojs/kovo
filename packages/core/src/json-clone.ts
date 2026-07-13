import type { JsonValue } from './json.js';
import {
  securityArrayAppend,
  securityApply,
  securityDefineProperty,
  securityGetOwnPropertyDescriptor,
  securityGetPrototypeOf,
  securityHasOwn,
  securityIsArray,
  securityJsonStringify,
  securityNullRecord,
  securityOwnArrayEntry,
  securityRegExpTest,
  securityString,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetDelete,
  securityWeakSetHas,
} from '#security-witness-intrinsics';

const IntrinsicArrayPrototype = globalThis.Array.prototype;
const IntrinsicNumber = globalThis.Number;
const IntrinsicObjectPrototype = globalThis.Object.prototype;
const IntrinsicReflect = globalThis.Reflect;
const IntrinsicTextEncoder = globalThis.TextEncoder;
const IntrinsicTypeError = globalThis.TypeError;
const IntrinsicUint8Array = globalThis.Uint8Array;
const intrinsicNumberIsFinite = IntrinsicNumber.isFinite;
const intrinsicNumberIsInteger = IntrinsicNumber.isInteger;
const intrinsicReflectOwnKeys = IntrinsicReflect.ownKeys;
const intrinsicTextEncoderEncode = IntrinsicTextEncoder.prototype.encode;
const textEncoder = new IntrinsicTextEncoder();
const typedArrayPrototype = securityGetPrototypeOf(IntrinsicUint8Array.prototype);
const intrinsicTypedArrayByteLength =
  typedArrayPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const ownKeysControlSymbol = Symbol('kovo.json-own-keys-control');
const ownKeysControl = { visible: true, [ownKeysControlSymbol]: true };
securityDefineProperty(ownKeysControl, 'hidden', {
  configurable: true,
  enumerable: false,
  value: true,
  writable: true,
});
const jsonScalarControlsSound = verifyJsonScalarControls();
const MAX_JSON_ARRAY_LENGTH = 1_000_000;

/** @internal Options for runtime JSON value validation. */
export interface AssertJsonValueOptions {
  /** Root label used in pathful validation messages. */
  readonly root?: string;
}

type JsonPathSegment = number | string;
type JsonOwnKey = string | symbol;

/**
 * @internal
 * Clone JSON-shaped data through exact own-data snapshots instead of `structuredClone`.
 * Optimistic drafts are proxy-backed, and the browser structured clone algorithm
 * rejects proxies with DataCloneError even when the value behind them is JSON. The
 * descriptor snapshot also keeps a proxy/accessor from substituting a later value.
 */
export function cloneJsonValue<Value extends JsonValue>(value: Value): Value {
  return snapshotJsonValue(value, '$', false) as Value;
}

/**
 * @internal
 * Assert that an unknown runtime value is plain JSON data without the lossy
 * coercions performed by `JSON.stringify` for Date, bigint, undefined, holes,
 * functions, symbols, non-finite numbers, accessors, or cyclic objects.
 */
export function assertJsonValue(value: unknown, options: AssertJsonValueOptions = {}): JsonValue {
  snapshotJsonValue(value, jsonRoot(options), false);
  return value as JsonValue;
}

/** @internal Validate and clone JSON data in one proxy-safe pass boundary. */
export function assertAndCloneJsonValue(
  value: unknown,
  options: AssertJsonValueOptions = {},
): JsonValue {
  return snapshotJsonValue(value, jsonRoot(options), false);
}

/** @internal Deterministically validate and stringify JSON data with sorted object keys. */
export function canonicalJsonStringify(
  value: unknown,
  options: AssertJsonValueOptions = {},
): string {
  const result = securityJsonStringify(snapshotJsonValue(value, jsonRoot(options), true));
  if (result === undefined) {
    throw new IntrinsicTypeError('Canonical JSON value is not serializable.');
  }
  return result;
}

/** @internal UTF-8 encoded byte length of the canonical JSON representation. */
export function jsonEncodedByteLength(
  value: unknown,
  options: AssertJsonValueOptions = {},
): number {
  assertJsonScalarControls();
  const bytes = securityApply<Uint8Array>(intrinsicTextEncoderEncode, textEncoder, [
    canonicalJsonStringify(value, options),
  ]);
  return securityApply<number>(intrinsicTypedArrayByteLength!, bytes, []);
}

function snapshotJsonValue(value: unknown, root: string, canonical: boolean): JsonValue {
  // SPEC §6.6/§9.1.1: authority-bearing runtime JSON must cross one exact-value boundary.
  // Validate the same own-data descriptors committed to the framework snapshot so a Proxy cannot
  // present safe truth to validation and different truth to cloning or canonical serialization.
  const seen = securityWeakSet<object>();
  return snapshotJsonValueAt(value, [], root, seen, canonical);
}

function snapshotJsonValueAt(
  value: unknown,
  path: readonly JsonPathSegment[],
  root: string,
  seen: WeakSet<object>,
  canonical: boolean,
): JsonValue {
  if (value === null) return null;

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value;
    case 'number':
      if (jsonNumberIsFinite(value)) return value;
      throw jsonValueError(root, path, 'must be a finite JSON number');
    case 'undefined':
      throw jsonValueError(root, path, 'must not be undefined');
    case 'bigint':
      throw jsonValueError(root, path, 'must not be a bigint');
    case 'function':
      throw jsonValueError(root, path, 'must not be a function');
    case 'symbol':
      throw jsonValueError(root, path, 'must not be a symbol');
    case 'object':
      break;
  }

  const object = value as object;
  if (securityWeakSetHas(seen, object)) {
    throw jsonValueError(root, path, 'must not contain a cycle');
  }

  if (securityIsArray(value)) {
    if (securityGetPrototypeOf(value) !== IntrinsicArrayPrototype) {
      throw jsonValueError(root, path, 'must be a plain JSON array');
    }
    securityWeakSetAdd(seen, object);
    const snapshot = snapshotJsonArray(value, path, root, seen, canonical);
    securityWeakSetDelete(seen, object);
    return snapshot;
  }

  const prototype = securityGetPrototypeOf(value);
  if (prototype !== IntrinsicObjectPrototype && prototype !== null) {
    throw jsonValueError(root, path, 'must be a plain JSON object');
  }

  securityWeakSetAdd(seen, object);
  const snapshot = snapshotJsonObject(value, path, root, seen, canonical);
  securityWeakSetDelete(seen, object);
  return snapshot;
}

function snapshotJsonArray(
  value: unknown[],
  path: readonly JsonPathSegment[],
  root: string,
  seen: WeakSet<object>,
  canonical: boolean,
): JsonValue[] {
  const lengthDescriptor = securityGetOwnPropertyDescriptor(value, 'length');
  if (lengthDescriptor === undefined || !securityHasOwn(lengthDescriptor, 'value')) {
    throw jsonValueError(root, path, 'must have a stable own-data array length');
  }
  const length = lengthDescriptor.value;
  if (
    typeof length !== 'number' ||
    !jsonNumberIsInteger(length) ||
    length < 0 ||
    length > MAX_JSON_ARRAY_LENGTH
  ) {
    throw jsonValueError(
      root,
      path,
      `must have an array length between 0 and ${MAX_JSON_ARRAY_LENGTH}`,
    );
  }

  const keys = snapshotOwnKeys(value, path, root);
  let ownIndexCount = 0;
  let sawLength = false;
  for (let index = 0; index < keys.length; index += 1) {
    const keyEntry = securityOwnArrayEntry(keys, index);
    if (!keyEntry.ok) {
      throw jsonValueError(root, path, 'must have stable own array keys');
    }
    const key = keyEntry.value;
    if (typeof key === 'symbol') {
      throw jsonValueError(root, path, `must not contain symbol key ${securityString(key)}`);
    }
    if (key === 'length') {
      if (sawLength) throw jsonValueError(root, path, 'must have stable own array keys');
      sawLength = true;
      continue;
    }
    if (!isArrayIndexKey(key, length)) {
      throw jsonValueError(root, appendJsonPath(path, key), 'must not be a custom array property');
    }
    ownIndexCount += 1;
  }

  if (!sawLength) throw jsonValueError(root, path, 'must have a stable own-data array length');

  const next: JsonValue[] = [];
  if (canonical) shadowInheritedToJson(next);
  for (let index = 0; index < length; index += 1) {
    const entryPath = appendJsonPath(path, index);
    const descriptor = securityGetOwnPropertyDescriptor(value, securityString(index));
    if (descriptor === undefined) {
      throw jsonValueError(root, entryPath, 'must not be an array hole');
    }
    if (!securityHasOwn(descriptor, 'value')) {
      throw jsonValueError(root, entryPath, 'must be a data property');
    }
    securityArrayAppend(
      next,
      snapshotJsonValueAt(descriptor.value, entryPath, root, seen, canonical),
    );
  }

  if (ownIndexCount !== length) {
    throw jsonValueError(root, path, 'must have stable dense own array keys');
  }
  return next;
}

function snapshotJsonObject(
  value: object,
  path: readonly JsonPathSegment[],
  root: string,
  seen: WeakSet<object>,
  canonical: boolean,
): JsonValue {
  const ownKeys = snapshotOwnKeys(value, path, root);
  const keys: string[] = [];
  for (let index = 0; index < ownKeys.length; index += 1) {
    const keyEntry = securityOwnArrayEntry(ownKeys, index);
    if (!keyEntry.ok) throw jsonValueError(root, path, 'must have stable own object keys');
    const key = keyEntry.value;
    if (typeof key === 'symbol') {
      throw jsonValueError(root, path, `must not contain symbol key ${securityString(key)}`);
    }
    securityArrayAppend(keys, key);
  }

  if (canonical) sortStrings(keys);
  const next: Record<string, JsonValue> = canonical ? securityNullRecord<JsonValue>() : {};
  for (let index = 0; index < keys.length; index += 1) {
    const keyEntry = securityOwnArrayEntry(keys, index);
    if (!keyEntry.ok) throw jsonValueError(root, path, 'must have stable own object keys');
    const key = keyEntry.value;
    const propertyPath = appendJsonPath(path, key);
    const descriptor = securityGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
      throw jsonValueError(root, propertyPath, 'must be a stable own data property');
    }
    if (!securityHasOwn(descriptor, 'value')) {
      throw jsonValueError(root, propertyPath, 'must be a data property');
    }
    if (descriptor.enumerable !== true) {
      throw jsonValueError(root, propertyPath, 'must not be a non-enumerable property');
    }
    securityDefineProperty(next, key, {
      configurable: true,
      enumerable: true,
      value: snapshotJsonValueAt(descriptor.value, propertyPath, root, seen, canonical),
      writable: true,
    });
  }
  return next;
}

function snapshotOwnKeys(
  value: object,
  path: readonly JsonPathSegment[],
  root: string,
): JsonOwnKey[] {
  assertJsonScalarControls();
  const keys = securityApply<unknown>(intrinsicReflectOwnKeys, IntrinsicReflect, [value]);
  if (!securityIsArray(keys)) {
    throw jsonValueError(root, path, 'must have stable own keys');
  }
  const lengthDescriptor = securityGetOwnPropertyDescriptor(keys, 'length');
  if (lengthDescriptor === undefined || !securityHasOwn(lengthDescriptor, 'value')) {
    throw jsonValueError(root, path, 'must have stable own keys');
  }
  const length = lengthDescriptor.value;
  if (
    typeof length !== 'number' ||
    !jsonNumberIsInteger(length) ||
    length < 0 ||
    length > MAX_JSON_ARRAY_LENGTH
  ) {
    throw jsonValueError(root, path, 'must have a bounded stable own-key list');
  }
  for (let index = 0; index < length; index += 1) {
    const entry = securityOwnArrayEntry(keys, index);
    if (!entry.ok || (typeof entry.value !== 'string' && typeof entry.value !== 'symbol')) {
      throw jsonValueError(root, path, 'must have stable own keys');
    }
  }
  return keys as JsonOwnKey[];
}

function shadowInheritedToJson(value: JsonValue[]): void {
  securityDefineProperty(value, 'toJSON', {
    configurable: true,
    enumerable: false,
    value: undefined,
    writable: false,
  });
}

function jsonRoot(options: AssertJsonValueOptions): string {
  if (options === null || typeof options !== 'object') {
    throw new IntrinsicTypeError('JSON validation options must be an object.');
  }
  const descriptor = securityGetOwnPropertyDescriptor(options, 'root');
  if (descriptor === undefined) return '$';
  if (!securityHasOwn(descriptor, 'value')) {
    throw new IntrinsicTypeError('JSON validation root must be an own data property.');
  }
  const root = descriptor.value;
  if (root === undefined || root === null) return '$';
  if (typeof root !== 'string') {
    throw new IntrinsicTypeError('JSON validation root must be a string.');
  }
  return root;
}

function appendJsonPath(
  path: readonly JsonPathSegment[],
  segment: JsonPathSegment,
): JsonPathSegment[] {
  const next: JsonPathSegment[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const entry = securityOwnArrayEntry(path, index);
    if (!entry.ok) throw new IntrinsicTypeError('JSON validation path is unstable.');
    securityArrayAppend(next, entry.value);
  }
  securityArrayAppend(next, segment);
  return next;
}

function sortStrings(values: string[]): string[] {
  for (let index = 1; index < values.length; index += 1) {
    const valueEntry = securityOwnArrayEntry(values, index);
    if (!valueEntry.ok) throw new IntrinsicTypeError('Canonical JSON key list is unstable.');
    const value = valueEntry.value;
    let insertion = index;
    while (insertion > 0) {
      const previousEntry = securityOwnArrayEntry(values, insertion - 1);
      if (!previousEntry.ok) {
        throw new IntrinsicTypeError('Canonical JSON key list is unstable.');
      }
      const previous = previousEntry.value;
      if (previous <= value) break;
      securityDefineProperty(values, insertion, {
        configurable: true,
        enumerable: true,
        value: previous,
        writable: true,
      });
      insertion -= 1;
    }
    securityDefineProperty(values, insertion, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return values;
}

function isArrayIndexKey(key: string, length: number): boolean {
  if (key === '') return false;
  assertJsonScalarControls();
  const index = securityApply<number>(IntrinsicNumber, undefined, [key]);
  return (
    jsonNumberIsInteger(index) && index >= 0 && index < length && securityString(index) === key
  );
}

function jsonValueError(
  root: string,
  path: readonly JsonPathSegment[],
  message: string,
): TypeError {
  return new IntrinsicTypeError(`JSON value at ${formatJsonPath(root, path)} ${message}`);
}

function formatJsonPath(root: string, path: readonly JsonPathSegment[]): string {
  let out = root;
  for (let index = 0; index < path.length; index += 1) {
    const entry = securityOwnArrayEntry(path, index);
    if (!entry.ok) throw new IntrinsicTypeError('JSON validation path is unstable.');
    const segment = entry.value;
    if (typeof segment === 'number') {
      out += `[${segment}]`;
      continue;
    }
    if (securityRegExpTest(/^[A-Za-z_$][\w$]*$/, segment)) {
      out += `.${segment}`;
      continue;
    }
    out += `[${securityJsonStringify(segment) ?? '""'}]`;
  }
  return out;
}

function jsonNumberIsFinite(value: number): boolean {
  assertJsonScalarControls();
  return securityApply<boolean>(intrinsicNumberIsFinite, IntrinsicNumber, [value]) === true;
}

function jsonNumberIsInteger(value: number): boolean {
  assertJsonScalarControls();
  return securityApply<boolean>(intrinsicNumberIsInteger, IntrinsicNumber, [value]) === true;
}

function assertJsonScalarControls(): void {
  if (!jsonScalarControlsSound) {
    throw new IntrinsicTypeError(
      'Kovo canonical JSON controls are unavailable because realm intrinsics were modified before framework initialization.',
    );
  }
}

function verifyJsonScalarControls(): boolean {
  if (typeof intrinsicTypedArrayByteLength !== 'function') return false;
  try {
    const bytes = securityApply<Uint8Array>(intrinsicTextEncoderEncode, textEncoder, ['Kovo']);
    const ownKeys = securityApply<unknown>(intrinsicReflectOwnKeys, IntrinsicReflect, [
      ownKeysControl,
    ]);
    if (!securityIsArray(ownKeys)) return false;
    const ownKeysLength = securityGetOwnPropertyDescriptor(ownKeys, 'length');
    const visible = securityOwnArrayEntry(ownKeys, 0);
    const hidden = securityOwnArrayEntry(ownKeys, 1);
    const symbol = securityOwnArrayEntry(ownKeys, 2);
    return (
      bytes[0] === 75 &&
      bytes[1] === 111 &&
      bytes[2] === 118 &&
      bytes[3] === 111 &&
      securityApply<number>(intrinsicTypedArrayByteLength, bytes, []) === 4 &&
      securityApply<boolean>(intrinsicNumberIsFinite, IntrinsicNumber, [1]) === true &&
      securityApply<boolean>(intrinsicNumberIsFinite, IntrinsicNumber, [IntrinsicNumber.NaN]) ===
        false &&
      securityApply<boolean>(intrinsicNumberIsInteger, IntrinsicNumber, [1]) === true &&
      securityApply<boolean>(intrinsicNumberIsInteger, IntrinsicNumber, [1.5]) === false &&
      securityApply<number>(IntrinsicNumber, undefined, ['42']) === 42 &&
      ownKeysLength !== undefined &&
      securityHasOwn(ownKeysLength, 'value') &&
      ownKeysLength.value === 3 &&
      visible.ok &&
      visible.value === 'visible' &&
      hidden.ok &&
      hidden.value === 'hidden' &&
      symbol.ok &&
      symbol.value === ownKeysControlSymbol
    );
  } catch {
    return false;
  }
}
