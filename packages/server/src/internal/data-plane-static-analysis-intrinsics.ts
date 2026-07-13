/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked via pinned Reflect.apply. */
import {
  createHash as builtinCreateHash,
  createHmac as builtinCreateHmac,
  randomUUID as builtinRandomUUID,
} from 'node:crypto';
import { Stats as BuiltinStats } from 'node:fs';

/**
 * Boot-pinned controls for the build/check data-plane proof (SPEC §2/§11.4).
 * Supported runners load this module before app/plugin evaluation. Pre-run host loaders are part of
 * the host TCB; finite vectors or Function#toString likeness cannot attest them from JavaScript.
 */
const NativeArray = globalThis.Array;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeMath = globalThis.Math;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const NativeURL = globalThis.URL;
const nativeArrayIsArray = NativeArray.isArray;
const nativeCreateHash = builtinCreateHash;
const nativeCreateHmac = builtinCreateHmac;
const nativeRandomUUID = builtinRandomUUID;
const nativeJsonParse = NativeJSON.parse;
const nativeJsonStringify = NativeJSON.stringify;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapSet = NativeMap.prototype.set;
const nativeMathMax = NativeMath.max;
const nativeMathMin = NativeMath.min;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeNumberIsFinite = NativeNumber.isFinite;
const nativeNumberParseInt = NativeNumber.parseInt;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectCreate = NativeObject.create;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIs = NativeObject.is;
const nativeObjectKeys = NativeObject.keys;
const nativePromiseResolve = NativePromise.resolve;
const nativePromiseThen = NativePromise.prototype.then;
const nativeReflectApply = NativeReflect.apply;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringLastIndexOf = NativeString.prototype.lastIndexOf;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStatsIsDirectory = BuiltinStats.prototype.isDirectory;
const nativeUrlHref = nativeObjectGetOwnPropertyDescriptor(NativeURL.prototype, 'href')?.get;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function descriptor(value: object, key: PropertyKey): PropertyDescriptor | undefined {
  return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, key]);
}

function sameDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    apply<boolean>(nativeObjectIs, NativeObject, [left.value, right.value]) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

function capturedMethod(value: object, key: PropertyKey): Function | undefined {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const own = descriptor(owner, key);
    if (own !== undefined) {
      return 'value' in own && typeof own.value === 'function' ? own.value : undefined;
    }
    owner = apply(nativeObjectGetPrototypeOf, NativeObject, [owner]);
  }
  return undefined;
}

const hashControl = nativeCreateHash('sha256');
const nativeHashUpdate = capturedMethod(hashControl, 'update');
const nativeHashDigest = capturedMethod(hashControl, 'digest');
const hmacControl = nativeCreateHmac('sha256', 'kovo-bootstrap-health');
const nativeHmacUpdate = capturedMethod(hmacControl, 'update');
const nativeHmacDigest = capturedMethod(hmacControl, 'digest');

function bootstrapSelfCheckPasses(): boolean {
  try {
    if (
      typeof nativeHashUpdate !== 'function' ||
      typeof nativeHashDigest !== 'function' ||
      typeof nativeHmacUpdate !== 'function' ||
      typeof nativeHmacDigest !== 'function' ||
      typeof nativeUrlHref !== 'function'
    ) {
      return false;
    }
    // Initialization health only; supported-runner ordering owns provenance.
    const hash = nativeCreateHash('sha256');
    apply(nativeHashUpdate, hash, ['abc']);
    if (
      apply<string>(nativeHashDigest, hash, ['hex']) !==
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    ) {
      return false;
    }
    if (apply(nativeArrayIsArray, NativeArray, [[]]) !== true) return false;
    if (apply(nativeArrayIsArray, NativeArray, [{}]) !== false) return false;
    const parsed = apply<Record<string, unknown>>(nativeJsonParse, NativeJSON, ['{"safe":true}']);
    if (staticAnalysisOwnDataValueUnchecked(parsed, 'safe') !== true) return false;
    if (apply<string | undefined>(nativeJsonStringify, NativeJSON, ['a"b']) !== '"a\\"b"') {
      return false;
    }
    const map = new NativeMap<string, string>();
    apply(nativeMapSet, map, ['safe', 'value']);
    if (apply(nativeMapGet, map, ['safe']) !== 'value') return false;
    if (apply(nativeMathMin, NativeMath, [1, 2]) !== 1) return false;
    if (apply(nativeMathMax, NativeMath, [1, 2]) !== 2) return false;
    if (apply(nativeStringStartsWith, 'static-analysis', ['static']) !== true) return false;
    if (apply(nativeStringEndsWith, 'schema.ts', ['.ts']) !== true) return false;
    if (apply(nativeStringIncludes, '/src/generated/x.ts', ['/generated/']) !== true) return false;
    if (apply(nativeStringLastIndexOf, 'a/b/c', ['/']) !== 3) return false;
    if (apply(nativeStringSlice, 'schema.ts', [0, 6]) !== 'schema') return false;
    if (apply(nativeStringToLowerCase, 'Schema.TS', []) !== 'schema.ts') return false;
    const url = new NativeURL('./worker.js', 'file:///tmp/kovo/static-analysis.ts');
    if (apply(nativeUrlHref, url, []) !== 'file:///tmp/kovo/worker.js') return false;
    if (!isUuidV4(nativeRandomUUID({ disableEntropyCache: true }))) return false;
    if (apply<RegExpExecArray | null>(nativeRegExpExec, /\.tsx?$/u, ['schema.ts']) === null) {
      return false;
    }
    if (apply(nativeNumberParseInt, NativeNumber, ['12', 10]) !== 12) return false;
    if (apply(nativeNumberIsFinite, NativeNumber, [12]) !== true) return false;
    const nullRecord = apply<object>(nativeObjectCreate, NativeObject, [null]);
    if (apply(nativeObjectGetPrototypeOf, NativeObject, [nullRecord]) !== null) return false;
    const committed: string[] = [];
    if (
      apply(nativeObjectDefineProperty, NativeObject, [
        committed,
        0,
        { configurable: true, enumerable: true, value: 'safe', writable: true },
      ]) !== committed ||
      descriptor(committed, 0)?.value !== 'safe' ||
      committed.length !== 1
    ) {
      return false;
    }
    const promise = apply<Promise<string>>(nativePromiseResolve, NativePromise, ['safe']);
    return typeof apply(nativePromiseThen, promise, [(value: string) => value]) === 'object';
  } catch {
    return false;
  }
}

function staticAnalysisOwnDataValueUnchecked(source: object, key: PropertyKey): unknown {
  const before = descriptor(source, key);
  const after = descriptor(source, key);
  if (!sameDataDescriptor(before, after) || before === undefined || !('value' in before)) {
    return undefined;
  }
  return before.value;
}

const bootstrapHealthy = bootstrapSelfCheckPasses();

export function assertDataPlaneStaticAnalysisIntrinsics(): void {
  if (!bootstrapHealthy) {
    throw new NativeTypeError(
      'Kovo data-plane security bootstrap failed its initialization self-check. Use a supported Kovo runner that initializes framework controls before app/plugin evaluation.',
    );
  }
}

export function staticAnalysisArrayIsArray(value: unknown): value is unknown[] {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function staticAnalysisArrayLength(value: readonly unknown[], label: string): number {
  assertDataPlaneStaticAnalysisIntrinsics();
  const before = descriptor(value, 'length');
  const after = descriptor(value, 'length');
  if (
    !sameDataDescriptor(before, after) ||
    before === undefined ||
    !('value' in before) ||
    typeof before.value !== 'number' ||
    !apply(nativeNumberIsSafeInteger, NativeNumber, [before.value]) ||
    before.value < 0 ||
    before.value > 1_000_000
  ) {
    throw new NativeTypeError(`${label} must have a bounded stable length.`);
  }
  return before.value;
}

export function staticAnalysisArraySet<Value>(
  values: Value[],
  index: number,
  value: Value,
  label: string,
): void {
  assertDataPlaneStaticAnalysisIntrinsics();
  if (!apply(nativeNumberIsSafeInteger, NativeNumber, [index]) || index < 0 || index >= 1_000_000) {
    throw new NativeTypeError(`${label} index must be a bounded non-negative integer.`);
  }
  const beforeLength = staticAnalysisArrayLength(values, label);
  apply(nativeObjectDefineProperty, NativeObject, [
    values,
    index,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
  const committed = descriptor(values, index);
  const expectedLength = index >= beforeLength ? index + 1 : beforeLength;
  if (
    committed === undefined ||
    !('value' in committed) ||
    !apply(nativeObjectIs, NativeObject, [committed.value, value]) ||
    staticAnalysisArrayLength(values, label) !== expectedLength
  ) {
    throw new NativeTypeError(`${label} own-data commit failed.`);
  }
}

export function staticAnalysisArrayAppend<Value>(
  values: Value[],
  value: Value,
  label: string,
): void {
  staticAnalysisArraySet(values, staticAnalysisArrayLength(values, label), value, label);
}

export function staticAnalysisNullRecord<Value>(): Record<string, Value> {
  assertDataPlaneStaticAnalysisIntrinsics();
  const record = apply<Record<string, Value>>(nativeObjectCreate, NativeObject, [null]);
  if (apply(nativeObjectGetPrototypeOf, NativeObject, [record]) !== null) {
    throw new NativeTypeError('Static-analysis null record construction failed.');
  }
  return record;
}

export function staticAnalysisDefineDataProperty<Value>(
  record: Record<string, Value>,
  key: string,
  value: Value,
  label: string,
): void {
  assertDataPlaneStaticAnalysisIntrinsics();
  apply(nativeObjectDefineProperty, NativeObject, [
    record,
    key,
    { configurable: true, enumerable: true, value, writable: true },
  ]);
  const committed = descriptor(record, key);
  if (
    committed === undefined ||
    !('value' in committed) ||
    !apply(nativeObjectIs, NativeObject, [committed.value, value])
  ) {
    throw new NativeTypeError(`${label} own-data commit failed.`);
  }
}

export function staticAnalysisOwnDataValue(
  source: unknown,
  key: PropertyKey,
  label: string,
): unknown {
  assertDataPlaneStaticAnalysisIntrinsics();
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new NativeTypeError(`${label} must be an object.`);
  }
  const before = descriptor(source, key);
  const after = descriptor(source, key);
  if (!sameDataDescriptor(before, after)) {
    throw new NativeTypeError(`${label}.${String(key)} changed while it was inspected.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new NativeTypeError(`${label}.${String(key)} must be an own data property.`);
  }
  return before.value;
}

export function staticAnalysisJsonParse(source: string): unknown {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeJsonParse, NativeJSON, [source]);
}

export function staticAnalysisJsonStringify(value: unknown): string | undefined {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeJsonStringify, NativeJSON, [value]);
}

/** Serialize cache facts without consulting inherited `toJSON` or collection prototypes. */
export function staticAnalysisCanonicalJson(value: unknown): string {
  assertDataPlaneStaticAnalysisIntrinsics();
  return canonicalJsonValue(value, 0);
}

function canonicalJsonValue(value: unknown, depth: number): string {
  if (depth > 100) throw new NativeTypeError('Static-analysis cache facts exceed JSON depth.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    const encoded = apply<string | undefined>(nativeJsonStringify, NativeJSON, [value]);
    if (encoded === undefined)
      throw new NativeTypeError('Static-analysis cache scalar is invalid.');
    return encoded;
  }
  if (typeof value === 'number') {
    if (!apply(nativeNumberIsFinite, NativeNumber, [value])) {
      throw new NativeTypeError('Static-analysis cache numbers must be finite.');
    }
    const encoded = apply<string | undefined>(nativeJsonStringify, NativeJSON, [value]);
    if (encoded === undefined)
      throw new NativeTypeError('Static-analysis cache number is invalid.');
    return encoded;
  }
  if (apply(nativeArrayIsArray, NativeArray, [value])) {
    const length = staticAnalysisArrayLength(value as unknown[], 'Static-analysis cache array');
    let output = '[';
    for (let index = 0; index < length; index += 1) {
      if (index > 0) output += ',';
      const entry = staticAnalysisOwnDataValue(value, index, 'Static-analysis cache array');
      if (entry === undefined) {
        throw new NativeTypeError(`Static-analysis cache array[${index}] must be dense.`);
      }
      output += canonicalJsonValue(entry, depth + 1);
    }
    return `${output}]`;
  }
  if (value && typeof value === 'object') {
    const keys = apply<string[]>(nativeObjectKeys, NativeObject, [value]);
    for (let index = 1; index < keys.length; index += 1) {
      const key = keys[index]!;
      let insertAt = index;
      while (insertAt > 0 && key < keys[insertAt - 1]!) {
        keys[insertAt] = keys[insertAt - 1]!;
        insertAt -= 1;
      }
      keys[insertAt] = key;
    }
    let output = '{';
    let count = 0;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const entry = staticAnalysisOwnDataValue(value, key, 'Static-analysis cache object');
      if (entry === undefined) continue;
      const encodedKey = apply<string | undefined>(nativeJsonStringify, NativeJSON, [key]);
      if (encodedKey === undefined)
        throw new NativeTypeError('Static-analysis cache key is invalid.');
      if (count > 0) output += ',';
      output += `${encodedKey}:${canonicalJsonValue(entry, depth + 1)}`;
      count += 1;
    }
    return `${output}}`;
  }
  throw new NativeTypeError('Static-analysis cache facts must be JSON-compatible own data.');
}

export function staticAnalysisMapGet<Key, Value>(
  map: Map<Key, Value>,
  key: Key,
): Value | undefined {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeMapGet, map, [key]);
}

export function staticAnalysisMapSet<Key, Value>(
  map: Map<Key, Value>,
  key: Key,
  value: Value,
): void {
  assertDataPlaneStaticAnalysisIntrinsics();
  apply(nativeMapSet, map, [key, value]);
}

export function staticAnalysisMathMax(...values: number[]): number {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeMathMax, NativeMath, values);
}

export function staticAnalysisMathMin(...values: number[]): number {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeMathMin, NativeMath, values);
}

export function staticAnalysisPromiseAll<Value>(
  values: readonly Promise<Value>[],
): Promise<Value[]> {
  assertDataPlaneStaticAnalysisIntrinsics();
  const length = staticAnalysisArrayLength(values, 'Static-analysis Promise inputs');
  const source: Promise<Value>[] = [];
  for (let index = 0; index < length; index += 1) {
    const value = staticAnalysisOwnDataValue(values, index, 'Static-analysis Promise inputs');
    if (value === undefined) {
      throw new NativeTypeError(`Static-analysis Promise inputs[${index}] must be dense.`);
    }
    staticAnalysisArraySet(
      source,
      index,
      value as Promise<Value>,
      'Static-analysis Promise source',
    );
  }
  return new NativePromise<Value[]>((resolvePromise, rejectPromise) => {
    const results: Value[] = [];
    let remaining = source.length;
    if (remaining === 0) {
      resolvePromise(results);
      return;
    }
    for (let index = 0; index < source.length; index += 1) {
      const promise = apply<Promise<Value>>(nativePromiseResolve, NativePromise, [source[index]]);
      apply(nativePromiseThen, promise, [
        (value: Value) => {
          staticAnalysisArraySet(results, index, value, 'Static-analysis Promise results');
          remaining -= 1;
          if (remaining === 0) resolvePromise(results);
        },
        rejectPromise,
      ]);
    }
  });
}

export function staticAnalysisCreatePromise<Value>(
  executor: (
    resolve: (value: Value | PromiseLike<Value>) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<Value> {
  assertDataPlaneStaticAnalysisIntrinsics();
  return new NativePromise<Value>(executor);
}

export function staticAnalysisObjectKeys(value: object): string[] {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeObjectKeys, NativeObject, [value]);
}

export function staticAnalysisNumberIsFinite(value: unknown): boolean {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeNumberIsFinite, NativeNumber, [value]);
}

export function staticAnalysisNumberParseInt(value: string): number {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeNumberParseInt, NativeNumber, [value, 10]);
}

export function staticAnalysisRegExpTest(expression: RegExp, value: string): boolean {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value]) !== null;
}

export function staticAnalysisStringEndsWith(value: string, search: string): boolean {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeStringEndsWith, value, [search]);
}

export function staticAnalysisStringIncludes(value: string, search: string): boolean {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeStringIncludes, value, [search]);
}

export function staticAnalysisStringIndexOf(value: string, search: string): number {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeStringIndexOf, value, [search]);
}

export function staticAnalysisStringLastIndexOf(value: string, search: string): number {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeStringLastIndexOf, value, [search]);
}

export function staticAnalysisStringSlice(value: string, start: number, end?: number): string {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeStringSlice, value, end === undefined ? [start] : [start, end]);
}

export function staticAnalysisStringStartsWith(value: string, search: string): boolean {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeStringStartsWith, value, [search]);
}

export function staticAnalysisStringToLowerCase(value: string): string {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function staticAnalysisCreateUrl(input: string | URL, base?: string | URL): URL {
  assertDataPlaneStaticAnalysisIntrinsics();
  const value = base === undefined ? new NativeURL(input) : new NativeURL(input, base);
  const href = apply<unknown>(nativeUrlHref!, value, []);
  if (typeof href !== 'string' || href.length === 0) {
    throw new NativeTypeError('Static-analysis URL construction returned an invalid URL.');
  }
  return value;
}

export function staticAnalysisUrlHref(value: URL): string {
  assertDataPlaneStaticAnalysisIntrinsics();
  const href = apply<unknown>(nativeUrlHref!, value, []);
  if (typeof href !== 'string' || href.length === 0) {
    throw new NativeTypeError('Static-analysis URL href is unavailable.');
  }
  return href;
}

export function staticAnalysisStatsIsDirectory(value: object): boolean {
  assertDataPlaneStaticAnalysisIntrinsics();
  return apply(nativeStatsIsDirectory, value, []);
}

export function staticAnalysisSha256(source: string): string {
  assertDataPlaneStaticAnalysisIntrinsics();
  if (typeof source !== 'string')
    throw new NativeTypeError('Static-analysis hash input is invalid.');
  const hash = nativeCreateHash('sha256');
  apply(nativeHashUpdate!, hash, [source]);
  const digest = apply<string>(nativeHashDigest!, hash, ['hex']);
  if (!isLowerHexDigest(digest))
    throw new NativeTypeError('Static-analysis digest has an invalid shape.');
  return digest;
}

export function staticAnalysisHmacSha256(key: string, source: string): string {
  assertDataPlaneStaticAnalysisIntrinsics();
  if (typeof key !== 'string' || typeof source !== 'string') {
    throw new NativeTypeError('Static-analysis HMAC key/input must be strings.');
  }
  const hmac = nativeCreateHmac('sha256', key);
  apply(nativeHmacUpdate!, hmac, [source]);
  const digest = apply<string>(nativeHmacDigest!, hmac, ['hex']);
  if (!isLowerHexDigest(digest)) {
    throw new NativeTypeError('Static-analysis HMAC digest has an invalid shape.');
  }
  return digest;
}

export function staticAnalysisSecureStringEqual(left: string, right: string): boolean {
  assertDataPlaneStaticAnalysisIntrinsics();
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |=
      apply<number>(nativeStringCharCodeAt, left, [index]) ^
      apply<number>(nativeStringCharCodeAt, right, [index]);
  }
  return difference === 0;
}

export function staticAnalysisRandomUuid(): string {
  assertDataPlaneStaticAnalysisIntrinsics();
  const value = nativeRandomUUID({ disableEntropyCache: true });
  if (!isUuidV4(value)) throw new NativeTypeError('Static-analysis UUID has an invalid shape.');
  return value;
}

function isLowerHexDigest(value: string): boolean {
  if (value.length !== 64) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) return false;
  }
  return true;
}

function isUuidV4(value: string): boolean {
  if (value.length !== 36) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (code !== 0x2d) return false;
      continue;
    }
    if (index === 14) {
      if (code !== 0x34) return false;
      continue;
    }
    if (index === 19) {
      if (code !== 0x38 && code !== 0x39 && code !== 0x61 && code !== 0x62) return false;
      continue;
    }
    if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) return false;
  }
  return true;
}
