import type { JsonValue } from './json.js';
import {
  securityApply,
  securityDefineProperty,
  securityGetOwnPropertyDescriptor,
  securityGetOwnPropertySymbols,
  securityGetPrototypeOf,
  securityIsArray,
  securityJsonStringify,
  securityObjectKeys,
  securityPropertyIsEnumerable,
  securityRegExpTest,
  securityString,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetDelete,
  securityWeakSetHas,
} from '#security-witness-intrinsics';

const IntrinsicNumber = globalThis.Number;
const IntrinsicObjectPrototype = globalThis.Object.prototype;
const IntrinsicTextEncoder = globalThis.TextEncoder;
const IntrinsicUint8Array = globalThis.Uint8Array;
const intrinsicNumberIsFinite = IntrinsicNumber.isFinite;
const intrinsicNumberIsInteger = IntrinsicNumber.isInteger;
const intrinsicTextEncoderEncode = IntrinsicTextEncoder.prototype.encode;
const textEncoder = new IntrinsicTextEncoder();
const typedArrayPrototype = securityGetPrototypeOf(IntrinsicUint8Array.prototype);
const intrinsicTypedArrayByteLength =
  typedArrayPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const jsonScalarControlsSound = verifyJsonScalarControls();

/** @internal Options for runtime JSON value validation. */
export interface AssertJsonValueOptions {
  /** Root label used in pathful validation messages. */
  readonly root?: string;
}

type JsonPathSegment = number | string;

/**
 * @internal
 * Clone JSON-shaped data through property access instead of `structuredClone`.
 * Optimistic drafts are proxy-backed, and the browser structured clone algorithm
 * rejects proxies with DataCloneError even when the value behind them is JSON.
 */
export function cloneJsonValue<Value extends JsonValue>(value: Value): Value {
  if (securityIsArray(value)) {
    const next: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      next[index] = cloneJsonValue(value[index] as JsonValue);
    }
    return next as Value;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const next: Record<string, JsonValue> = {};
  const record = value as Record<string, JsonValue>;
  const keys = securityObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    securityDefineProperty(next, key, {
      configurable: true,
      enumerable: true,
      value: cloneJsonValue(record[key] as JsonValue),
      writable: true,
    });
  }

  return next as Value;
}

/**
 * @internal
 * Assert that an unknown runtime value is plain JSON data without the lossy
 * coercions performed by `JSON.stringify` for Date, bigint, undefined, holes,
 * functions, symbols, non-finite numbers, accessors, or cyclic objects.
 */
export function assertJsonValue(value: unknown, options: AssertJsonValueOptions = {}): JsonValue {
  const seen = securityWeakSet<object>();
  assertJsonValueAt(value, [], options.root ?? '$', seen);
  return value as JsonValue;
}

/** @internal Validate and clone JSON data in one proxy-safe pass boundary. */
export function assertAndCloneJsonValue(
  value: unknown,
  options: AssertJsonValueOptions = {},
): JsonValue {
  return cloneJsonValue(assertJsonValue(value, options));
}

/** @internal Deterministically validate and stringify JSON data with sorted object keys. */
export function canonicalJsonStringify(
  value: unknown,
  options: AssertJsonValueOptions = {},
): string {
  const result = securityJsonStringify(canonicalizeJsonValue(assertJsonValue(value, options)));
  if (result === undefined) throw new TypeError('Canonical JSON value is not serializable.');
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

function assertJsonValueAt(
  value: unknown,
  path: readonly JsonPathSegment[],
  root: string,
  seen: WeakSet<object>,
): void {
  if (value === null) return;

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return;
    case 'number':
      if (jsonNumberIsFinite(value)) return;
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
    securityWeakSetAdd(seen, object);
    assertNoEnumerableSymbolKeys(value, path, root);
    const keys = securityObjectKeys(value);
    for (let offset = 0; offset < keys.length; offset += 1) {
      const key = keys[offset];
      if (key === undefined) continue;
      if (!isArrayIndexKey(key, value.length)) {
        throw jsonValueError(root, [...path, key], 'must not be a custom array property');
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = securityGetOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined) {
        throw jsonValueError(root, [...path, index], 'must not be an array hole');
      }
      if (!('value' in descriptor)) {
        throw jsonValueError(root, [...path, index], 'must be a data property');
      }
      assertJsonValueAt((value as readonly unknown[])[index], [...path, index], root, seen);
    }
    securityWeakSetDelete(seen, object);
    return;
  }

  if (!isPlainJsonObject(value)) {
    throw jsonValueError(root, path, 'must be a plain JSON object');
  }

  securityWeakSetAdd(seen, object);
  assertNoEnumerableSymbolKeys(value, path, root);

  const record = value as Record<string, unknown>;
  const keys = securityObjectKeys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const descriptor = securityGetOwnPropertyDescriptor(record, key);
    if (descriptor !== undefined && !('value' in descriptor)) {
      throw jsonValueError(root, [...path, key], 'must be a data property');
    }
    assertJsonValueAt(record[key], [...path, key], root, seen);
  }
  securityWeakSetDelete(seen, object);
}

function canonicalizeJsonValue(value: JsonValue): JsonValue {
  if (securityIsArray(value)) {
    const next: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      next[index] = canonicalizeJsonValue(value[index] as JsonValue);
    }
    return next;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, JsonValue>;
  const sorted: Record<string, JsonValue> = {};
  const keys = sortStrings(securityObjectKeys(record));
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    securityDefineProperty(sorted, key, {
      configurable: true,
      enumerable: true,
      value: canonicalizeJsonValue(record[key] as JsonValue),
      writable: true,
    });
  }
  return sorted;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = securityGetPrototypeOf(value);
  return prototype === IntrinsicObjectPrototype || prototype === null;
}

function assertNoEnumerableSymbolKeys(
  value: object,
  path: readonly JsonPathSegment[],
  root: string,
): void {
  const symbols = securityGetOwnPropertySymbols(value);
  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index];
    if (symbol !== undefined && securityPropertyIsEnumerable(value, symbol)) {
      throw jsonValueError(root, path, `must not contain symbol key ${securityString(symbol)}`);
    }
  }
}

function sortStrings(values: string[]): string[] {
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    let insertion = index;
    while (insertion > 0) {
      const previous = values[insertion - 1];
      if (previous === undefined || previous <= value) break;
      values[insertion] = previous;
      insertion -= 1;
    }
    values[insertion] = value;
  }
  return values;
}

function isArrayIndexKey(key: string, length: number): boolean {
  if (key === '') return false;
  assertJsonScalarControls();
  const index = securityApply<number>(IntrinsicNumber, undefined, [key]);
  return jsonNumberIsInteger(index) && index >= 0 && index < length && securityString(index) === key;
}

function jsonValueError(
  root: string,
  path: readonly JsonPathSegment[],
  message: string,
): TypeError {
  return new TypeError(`JSON value at ${formatJsonPath(root, path)} ${message}`);
}

function formatJsonPath(root: string, path: readonly JsonPathSegment[]): string {
  let out = root;
  for (const segment of path) {
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
    throw new TypeError(
      'Kovo canonical JSON controls are unavailable because realm intrinsics were modified before framework initialization.',
    );
  }
}

function verifyJsonScalarControls(): boolean {
  if (typeof intrinsicTypedArrayByteLength !== 'function') return false;
  try {
    const bytes = securityApply<Uint8Array>(intrinsicTextEncoderEncode, textEncoder, ['Kovo']);
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
      securityApply<number>(IntrinsicNumber, undefined, ['42']) === 42
    );
  } catch {
    return false;
  }
}
