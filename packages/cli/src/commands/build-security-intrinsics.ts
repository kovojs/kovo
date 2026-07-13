/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked via pinned Reflect.apply. */
import { Buffer as NativeBuffer } from 'node:buffer';
/**
 * Boot-pinned controls for authority-bearing `kovo build --check` joins (SPEC §2/§11.4).
 * The supported CLI runner loads this module before Vite config/plugins/apps. Function#toString is
 * captured only for operational handler-source extraction, never as native provenance.
 */
const NativeArray = globalThis.Array;
const NativeDate = globalThis.Date;
const NativeFunction = globalThis.Function;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const nativeArrayIsArray = NativeArray.isArray;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeBufferFrom = NativeBuffer.from;
const nativeBufferToString = NativeBuffer.prototype.toString;
const nativeDateToISOString = NativeDate.prototype.toISOString;
const nativeFunctionToString = NativeFunction.prototype.toString;
const nativeJsonStringify = NativeJSON.stringify;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapHas = NativeMap.prototype.has;
const nativeMapSet = NativeMap.prototype.set;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectIs = NativeObject.is;
const nativeObjectKeys = NativeObject.keys;
const nativeObjectSetPrototypeOf = NativeObject.setPrototypeOf;
const nativePromiseResolve = NativePromise.resolve;
const nativePromiseThen = NativePromise.prototype.then;
const nativeReflectApply = NativeReflect.apply;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeRegExpReplace = NativeRegExp.prototype[Symbol.replace];
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringTrim = NativeString.prototype.trim;
const nativeStringTrimEnd = NativeString.prototype.trimEnd;

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

function ownDataValueUnchecked(source: object, key: PropertyKey): unknown {
  const before = descriptor(source, key);
  const after = descriptor(source, key);
  if (!sameDataDescriptor(before, after) || before === undefined || !('value' in before)) {
    return undefined;
  }
  return before.value;
}

function bootstrapSelfCheckPasses(): boolean {
  try {
    if (apply(nativeArrayIsArray, NativeArray, [[]]) !== true) return false;
    if (apply(nativeArrayIsArray, NativeArray, [{}]) !== false) return false;
    const record = { safe: true };
    if (ownDataValueUnchecked(record, 'safe') !== true) return false;
    if (apply<string | undefined>(nativeJsonStringify, NativeJSON, ['a"b']) !== '"a\\"b"') {
      return false;
    }
    const map = new NativeMap<string, string>();
    apply(nativeMapSet, map, ['safe', 'value']);
    if (apply(nativeMapGet, map, ['safe']) !== 'value') return false;
    const set = new NativeSet<string>();
    apply(nativeSetAdd, set, ['safe']);
    if (apply(nativeSetHas, set, ['safe']) !== true) return false;
    if (apply(nativeStringStartsWith, 'ERROR KV418', ['ERROR ']) !== true) return false;
    if (apply<RegExpExecArray | null>(nativeRegExpExec, /^ERROR/u, ['ERROR KV418']) === null) {
      return false;
    }
    const promise = apply<Promise<string>>(nativePromiseResolve, NativePromise, ['safe']);
    return typeof apply(nativePromiseThen, promise, [(value: string) => value]) === 'object';
  } catch {
    return false;
  }
}

const bootstrapHealthy = bootstrapSelfCheckPasses();

function assertBuildSecurityIntrinsics(): void {
  if (!bootstrapHealthy) {
    throw new NativeTypeError(
      'Kovo build/check security bootstrap failed its initialization self-check. Use the supported CLI runner so framework controls initialize before app/plugin evaluation.',
    );
  }
}

export function buildArrayIsArray(value: unknown): value is unknown[] {
  assertBuildSecurityIntrinsics();
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function buildArrayLength(value: readonly unknown[], label: string): number {
  assertBuildSecurityIntrinsics();
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

export function buildSecurityArrayAppend<Value>(
  target: Value[],
  value: Value,
  label: string,
): void {
  const length = buildArrayLength(target, label);
  if (length >= 1_000_000) {
    throw new NativeTypeError(`${label} exceeds the build collection limit.`);
  }
  apply(nativeObjectDefineProperty, NativeObject, [
    target,
    length,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
  const committed = descriptor(target, length);
  if (
    committed === undefined ||
    !('value' in committed) ||
    !apply(nativeObjectIs, NativeObject, [committed.value, value]) ||
    buildArrayLength(target, label) !== length + 1
  ) {
    throw new NativeTypeError(`${label} own-data append failed.`);
  }
}

export function buildOwnDataValue(source: unknown, key: PropertyKey, label: string): unknown {
  assertBuildSecurityIntrinsics();
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

export function buildSnapshotDenseArray<Value>(value: readonly Value[], label: string): Value[] {
  if (!buildArrayIsArray(value)) throw new NativeTypeError(`${label} must be an array.`);
  const length = buildArrayLength(value, label);
  const snapshot: Value[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = buildOwnDataValue(value, index, label);
    if (entry === undefined) {
      throw new NativeTypeError(`${label}[${index}] must be a dense own value.`);
    }
    buildSecurityArrayAppend(snapshot, entry as Value, label);
  }
  return snapshot;
}

export function buildFunctionSource(value: Function): string {
  assertBuildSecurityIntrinsics();
  return apply(nativeFunctionToString, value, []);
}

export function buildArrayJoin(values: readonly unknown[], separator: string): string {
  assertBuildSecurityIntrinsics();
  return apply(nativeArrayJoin, values, [separator]);
}

export function buildCreateMap<Key, Value>(): Map<Key, Value> {
  assertBuildSecurityIntrinsics();
  return new NativeMap<Key, Value>();
}

export function buildCreateNullRecord<Value>(): Record<PropertyKey, Value> {
  assertBuildSecurityIntrinsics();
  return apply(nativeObjectCreate, NativeObject, [null]);
}

export function buildMapGet<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value | undefined {
  assertBuildSecurityIntrinsics();
  return apply(nativeMapGet, map, [key]);
}

export function buildMapHas<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): boolean {
  assertBuildSecurityIntrinsics();
  return apply(nativeMapHas, map, [key]);
}

export function buildMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertBuildSecurityIntrinsics();
  apply(nativeMapSet, map, [key, value]);
}

export function buildCreateSet<Value>(): Set<Value> {
  assertBuildSecurityIntrinsics();
  return new NativeSet<Value>();
}

export function buildSetAdd<Value>(set: Set<Value>, value: Value): void {
  assertBuildSecurityIntrinsics();
  apply(nativeSetAdd, set, [value]);
}

export function buildSetHas<Value>(set: ReadonlySet<Value>, value: Value): boolean {
  assertBuildSecurityIntrinsics();
  return apply(nativeSetHas, set, [value]);
}

export function buildObjectKeys(value: object): string[] {
  assertBuildSecurityIntrinsics();
  return apply(nativeObjectKeys, NativeObject, [value]);
}

export function buildRegExpExec(expression: RegExp, value: string): RegExpExecArray | null {
  assertBuildSecurityIntrinsics();
  return apply(nativeRegExpExec, expression, [value]);
}

export function buildRegExpReplace(expression: RegExp, value: string, replacement: string): string {
  assertBuildSecurityIntrinsics();
  return apply(nativeRegExpReplace, expression, [value, replacement]);
}

export function buildStringIncludes(value: string, search: string): boolean {
  assertBuildSecurityIntrinsics();
  return apply(nativeStringIncludes, value, [search]);
}

export function buildStringEndsWith(value: string, search: string): boolean {
  assertBuildSecurityIntrinsics();
  return apply(nativeStringEndsWith, value, [search]);
}

export function buildCurrentIsoTimestamp(): string {
  assertBuildSecurityIntrinsics();
  return apply(nativeDateToISOString, new NativeDate(), []);
}

export function buildUtf8Text(value: Uint8Array): string {
  assertBuildSecurityIntrinsics();
  const buffer = apply<Buffer>(nativeBufferFrom, NativeBuffer, [value]);
  return apply(nativeBufferToString, buffer, ['utf8']);
}

export function buildStringSplit(value: string, separator: string): string[] {
  assertBuildSecurityIntrinsics();
  if (separator.length === 0) {
    throw new NativeTypeError('Kovo build split separator must not be empty.');
  }
  const result: string[] = [];
  let sourceIndex = 0;
  while (true) {
    const matchIndex = apply<number>(nativeStringIndexOf, value, [separator, sourceIndex]);
    if (matchIndex < 0) break;
    buildSecurityArrayAppend(
      result,
      apply(nativeStringSlice, value, [sourceIndex, matchIndex]),
      'Kovo build split result',
    );
    sourceIndex = matchIndex + separator.length;
  }
  buildSecurityArrayAppend(
    result,
    apply(nativeStringSlice, value, [sourceIndex]),
    'Kovo build split result',
  );
  return result;
}

export function buildStringStartsWith(value: string, search: string): boolean {
  assertBuildSecurityIntrinsics();
  return apply(nativeStringStartsWith, value, [search]);
}

export function buildStringTrim(value: string): string {
  assertBuildSecurityIntrinsics();
  return apply(nativeStringTrim, value, []);
}

export function buildStringTrimEnd(value: string): string {
  assertBuildSecurityIntrinsics();
  return apply(nativeStringTrimEnd, value, []);
}

export function buildJsonStringify(value: unknown, space?: number): string | undefined {
  assertBuildSecurityIntrinsics();
  const snapshot = snapshotJsonData(value, 0);
  return apply(
    nativeJsonStringify,
    NativeJSON,
    space === undefined ? [snapshot] : [snapshot, undefined, space],
  );
}

function snapshotJsonData(value: unknown, depth: number): unknown {
  if (depth > 100) throw new NativeTypeError('Kovo build JSON exceeds the depth limit.');
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (apply(nativeArrayIsArray, NativeArray, [value])) {
    const source = value as readonly unknown[];
    const length = buildArrayLength(source, 'Kovo build JSON array');
    const snapshot: unknown[] = [];
    apply(nativeObjectSetPrototypeOf, NativeObject, [snapshot, null]);
    for (let index = 0; index < length; index += 1) {
      const entry = buildOwnDataValue(source, index, 'Kovo build JSON array');
      if (entry === undefined) {
        throw new NativeTypeError(`Kovo build JSON array[${index}] must be dense.`);
      }
      snapshot[index] = snapshotJsonData(entry, depth + 1);
    }
    return snapshot;
  }
  if (value && typeof value === 'object') {
    const snapshot = apply<Record<string, unknown>>(nativeObjectCreate, NativeObject, [null]);
    const keys = apply<string[]>(nativeObjectKeys, NativeObject, [value]);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const entry = buildOwnDataValue(value, key, 'Kovo build JSON object');
      if (entry === undefined) continue;
      snapshot[key] = snapshotJsonData(entry, depth + 1);
    }
    return snapshot;
  }
  throw new NativeTypeError('Kovo build JSON must contain only own JSON data.');
}

export function buildPromiseAll<Values extends readonly unknown[] | []>(
  values: Values,
): Promise<{ -readonly [Index in keyof Values]: Awaited<Values[Index]> }> {
  assertBuildSecurityIntrinsics();
  const source = buildSnapshotDenseArray(values, 'Kovo build Promise inputs');
  return new NativePromise((resolvePromise, rejectPromise) => {
    const results: unknown[] = [];
    for (let index = 0; index < source.length; index += 1) {
      buildSecurityArrayAppend(results, undefined, 'Kovo build Promise results');
    }
    let remaining = source.length;
    if (remaining === 0) {
      resolvePromise(results as { -readonly [Index in keyof Values]: Awaited<Values[Index]> });
      return;
    }
    for (let index = 0; index < source.length; index += 1) {
      const promise = apply<Promise<unknown>>(nativePromiseResolve, NativePromise, [source[index]]);
      apply(nativePromiseThen, promise, [
        (value: unknown) => {
          results[index] = value;
          remaining -= 1;
          if (remaining === 0) {
            resolvePromise(
              results as { -readonly [Index in keyof Values]: Awaited<Values[Index]> },
            );
          }
        },
        rejectPromise,
      ]);
    }
  });
}

export function buildObservePromise<Value>(
  value: Value | PromiseLike<Value>,
  fulfilled: (resolved: Value) => unknown,
  rejected: (error: unknown) => unknown,
): void {
  assertBuildSecurityIntrinsics();
  const promise = apply<Promise<Value>>(nativePromiseResolve, NativePromise, [value]);
  apply(nativePromiseThen, promise, [fulfilled, rejected]);
}
