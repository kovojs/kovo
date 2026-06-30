import type { JsonValue } from './json.js';

const textEncoder = new TextEncoder();

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
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as Value;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const next: Record<string, JsonValue> = {};
  const record = value as Record<string, JsonValue>;
  for (const key of Object.keys(value)) {
    Object.defineProperty(next, key, {
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
  const seen = new WeakSet<object>();
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
  return JSON.stringify(canonicalizeJsonValue(assertJsonValue(value, options)));
}

/** @internal UTF-8 encoded byte length of the canonical JSON representation. */
export function jsonEncodedByteLength(
  value: unknown,
  options: AssertJsonValueOptions = {},
): number {
  return textEncoder.encode(canonicalJsonStringify(value, options)).byteLength;
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
      if (Number.isFinite(value)) return;
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
  if (seen.has(object)) {
    throw jsonValueError(root, path, 'must not contain a cycle');
  }

  if (Array.isArray(value)) {
    seen.add(object);
    assertNoEnumerableSymbolKeys(value, path, root);
    for (const key of Object.keys(value)) {
      if (!isArrayIndexKey(key, value.length)) {
        throw jsonValueError(root, [...path, key], 'must not be a custom array property');
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined) {
        throw jsonValueError(root, [...path, index], 'must not be an array hole');
      }
      if (!('value' in descriptor)) {
        throw jsonValueError(root, [...path, index], 'must be a data property');
      }
      assertJsonValueAt((value as readonly unknown[])[index], [...path, index], root, seen);
    }
    seen.delete(object);
    return;
  }

  if (!isPlainJsonObject(value)) {
    throw jsonValueError(root, path, 'must be a plain JSON object');
  }

  seen.add(object);
  assertNoEnumerableSymbolKeys(value, path, root);

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor !== undefined && !('value' in descriptor)) {
      throw jsonValueError(root, [...path, key], 'must be a data property');
    }
    assertJsonValueAt(record[key], [...path, key], root, seen);
  }
  seen.delete(object);
}

function canonicalizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, JsonValue>;
  const sorted: Record<string, JsonValue> = {};
  for (const key of Object.keys(record).sort()) {
    Object.defineProperty(sorted, key, {
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
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoEnumerableSymbolKeys(
  value: object,
  path: readonly JsonPathSegment[],
  root: string,
): void {
  const symbols = Object.getOwnPropertySymbols(value);
  for (const symbol of symbols) {
    if (Object.prototype.propertyIsEnumerable.call(value, symbol)) {
      throw jsonValueError(root, path, `must not contain symbol key ${String(symbol)}`);
    }
  }
}

function isArrayIndexKey(key: string, length: number): boolean {
  if (key === '') return false;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
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
    if (/^[A-Za-z_$][\w$]*$/.test(segment)) {
      out += `.${segment}`;
      continue;
    }
    out += `[${JSON.stringify(segment)}]`;
  }
  return out;
}
