/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked via pinned Reflect.apply. */
import {
  createHash as builtinCreateHash,
  createHmac as builtinCreateHmac,
  randomUUID as builtinRandomUUID,
} from 'node:crypto';
import { Stats as BuiltinStats } from 'node:fs';

/**
 * Boot-captured controls for compiler identities and caches (SPEC §5.2/§5.2.1).
 *
 * Build hooks and app modules execute in the compiler's process. Node builtin ESM exports are live,
 * and ordinary realm prototypes remain writable, so a cache key or handler fingerprint must never
 * dispatch through those controls after app evaluation. Supported Kovo runners eagerly evaluate
 * this module before loading Vite config, plugins, or app modules, then target work consumes only
 * these captured bindings. JavaScript cannot attest arbitrary host code that ran before that
 * bootstrap; NODE_OPTIONS/loaders and equivalent pre-run code are part of the host TCB.
 */
const NativeArray = globalThis.Array;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeMath = globalThis.Math;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeRegExp = globalThis.RegExp;
const NativeReflect = globalThis.Reflect;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const nativeArrayIsArray = NativeArray.isArray;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeCreateHash = builtinCreateHash;
const nativeCreateHmac = builtinCreateHmac;
const nativeRandomUUID = builtinRandomUUID;
const nativeJsonParse = NativeJSON.parse;
const nativeJsonStringify = NativeJSON.stringify;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapDelete = NativeMap.prototype.delete;
const nativeMapForEach = NativeMap.prototype.forEach;
const nativeMapSet = NativeMap.prototype.set;
const nativeMathTrunc = NativeMath.trunc;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectKeys = NativeObject.keys;
const nativeObjectCreate = NativeObject.create;
const nativePromiseResolve = NativePromise.resolve;
const nativePromiseThen = NativePromise.prototype.then;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeObjectIs = NativeObject.is;
const nativeReflectApply = NativeReflect.apply;
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetDelete = NativeSet.prototype.delete;
const nativeSetForEach = NativeSet.prototype.forEach;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringLocaleCompare = NativeString.prototype.localeCompare;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringTrim = NativeString.prototype.trim;
const nativeStatsIsDirectory = BuiltinStats.prototype.isDirectory;
const nativeStatsIsFile = BuiltinStats.prototype.isFile;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function getOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
}

const nativeRegExpGlobalGetter = getOwnPropertyDescriptor(NativeRegExp.prototype, 'global')?.get;

function capturedMethod(value: object, property: PropertyKey): Function | undefined {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = getOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      return 'value' in descriptor && typeof descriptor.value === 'function'
        ? descriptor.value
        : undefined;
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

function compilerBootstrapSelfCheckPasses(): boolean {
  try {
    if (
      typeof nativeHashUpdate !== 'function' ||
      typeof nativeHashDigest !== 'function' ||
      typeof nativeHmacUpdate !== 'function' ||
      typeof nativeHmacDigest !== 'function' ||
      typeof nativeRegExpGlobalGetter !== 'function'
    ) {
      return false;
    }
    if (apply(nativeArrayIsArray, NativeArray, [[]]) !== true) return false;
    if (apply(nativeArrayIsArray, NativeArray, [{}]) !== false) return false;
    // Health checks catch accidental unsupported initialization. They are not provenance: the
    // security invariant is runner ordering above, not source-text likeness or a finite vector set.
    if (!isUuidV4(nativeRandomUUID({ disableEntropyCache: true }))) {
      return false;
    }
    const hash = nativeCreateHash('sha256');
    apply(nativeHashUpdate, hash, ['abc']);
    if (
      apply<string>(nativeHashDigest, hash, ['hex']) !==
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    ) {
      return false;
    }
    const parsed = apply<Record<string, unknown>>(nativeJsonParse, NativeJSON, ['{"safe":true}']);
    if (compilerOwnDataValueUnchecked(parsed, 'safe') !== true) return false;
    if (apply<string | undefined>(nativeJsonStringify, NativeJSON, ['a"b']) !== '"a\\"b"') {
      return false;
    }
    const map = new NativeMap<string, string>();
    apply(nativeMapSet, map, ['safe', 'value']);
    if (apply(nativeMapGet, map, ['safe']) !== 'value') return false;
    if (apply(nativeMapGet, map, ['missing']) !== undefined) return false;
    if (apply(nativeMapDelete, map, ['safe']) !== true) return false;
    if (apply(nativeMapGet, map, ['safe']) !== undefined) return false;
    const set = new NativeSet<string>();
    apply(nativeSetAdd, set, ['safe']);
    if (apply(nativeSetHas, set, ['safe']) !== true) return false;
    if (apply(nativeSetHas, set, ['missing']) !== false) return false;
    if (apply(nativeMathTrunc, NativeMath, [1.9]) !== 1) return false;
    const keys = apply<string[]>(nativeObjectKeys, NativeObject, [{ b: 1, a: 2 }]);
    if (!(keys.length === 2 && keys[0] === 'b' && keys[1] === 'a')) return false;
    const promise = apply<Promise<string>>(nativePromiseResolve, NativePromise, ['safe']);
    return typeof apply(nativePromiseThen, promise, [(value: string) => value]) === 'object';
  } catch {
    return false;
  }
}

function compilerOwnDataValueUnchecked(source: object, property: PropertyKey): unknown {
  const before = getOwnPropertyDescriptor(source, property);
  const after = getOwnPropertyDescriptor(source, property);
  if (!sameDataDescriptor(before, after) || before === undefined || !('value' in before)) {
    return undefined;
  }
  return before.value;
}

const compilerBootstrapHealthy = compilerBootstrapSelfCheckPasses();

/** @internal Supported runners call this before evaluating app/plugin modules. */
export function assertCompilerSecurityIntrinsics(): void {
  if (!compilerBootstrapHealthy) {
    throw new NativeTypeError(
      'Kovo compiler security bootstrap failed its initialization self-check. Use a supported Kovo runner that initializes framework controls before app/plugin evaluation.',
    );
  }
}

export function compilerArrayIsArray(value: unknown): value is unknown[] {
  assertCompilerSecurityIntrinsics();
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function compilerArrayLength(value: readonly unknown[], label: string): number {
  assertCompilerSecurityIntrinsics();
  const before = getOwnPropertyDescriptor(value, 'length');
  const after = getOwnPropertyDescriptor(value, 'length');
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

export function compilerArrayJoin(values: readonly unknown[], separator: string): string {
  assertCompilerSecurityIntrinsics();
  return apply(nativeArrayJoin, values, [separator]);
}

export function compilerSnapshotDenseArray<Value>(value: readonly Value[], label: string): Value[] {
  if (!compilerArrayIsArray(value)) throw new NativeTypeError(`${label} must be an array.`);
  const length = compilerArrayLength(value, label);
  const snapshot: Value[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(value, index, label);
    if (entry === undefined) throw new NativeTypeError(`${label}[${index}] must be dense.`);
    snapshot[snapshot.length] = entry as Value;
  }
  return snapshot;
}

export function compilerOwnDataValue(
  source: unknown,
  property: PropertyKey,
  label: string,
): unknown {
  assertCompilerSecurityIntrinsics();
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new NativeTypeError(`${label} must be an object.`);
  }
  const before = getOwnPropertyDescriptor(source, property);
  const after = getOwnPropertyDescriptor(source, property);
  if (!sameDataDescriptor(before, after)) {
    throw new NativeTypeError(`${label}.${String(property)} changed while it was inspected.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new NativeTypeError(`${label}.${String(property)} must be an own data property.`);
  }
  return before.value;
}

export function compilerObjectKeys(value: object): string[] {
  assertCompilerSecurityIntrinsics();
  return apply(nativeObjectKeys, NativeObject, [value]);
}

export function compilerNumberIsSafeInteger(value: unknown): value is number {
  assertCompilerSecurityIntrinsics();
  return apply(nativeNumberIsSafeInteger, NativeNumber, [value]);
}

export function compilerMathTrunc(value: number): number {
  assertCompilerSecurityIntrinsics();
  return apply(nativeMathTrunc, NativeMath, [value]);
}

export function compilerJsonParse(value: string): unknown {
  assertCompilerSecurityIntrinsics();
  return apply(nativeJsonParse, NativeJSON, [value]);
}

export function compilerJsonStringify(value: unknown): string | undefined {
  assertCompilerSecurityIntrinsics();
  return apply(nativeJsonStringify, NativeJSON, [value]);
}

export function compilerMapGet<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  key: Key,
): Value | undefined {
  assertCompilerSecurityIntrinsics();
  return apply(nativeMapGet, map, [key]);
}

export function compilerMapForEach<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  callback: (value: Value, key: Key) => void,
): void {
  assertCompilerSecurityIntrinsics();
  apply(nativeMapForEach, map, [callback]);
}

export function compilerCreateMap<Key, Value>(): Map<Key, Value> {
  assertCompilerSecurityIntrinsics();
  return new NativeMap<Key, Value>();
}

export function compilerCreateNullRecord<Value>(): Record<string, Value> {
  assertCompilerSecurityIntrinsics();
  return apply(nativeObjectCreate, NativeObject, [null]);
}

export function compilerCreateSet<Value>(): Set<Value> {
  assertCompilerSecurityIntrinsics();
  return new NativeSet<Value>();
}

export function compilerMapDelete<Key, Value>(map: Map<Key, Value>, key: Key): boolean {
  assertCompilerSecurityIntrinsics();
  return apply(nativeMapDelete, map, [key]);
}

export function compilerMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertCompilerSecurityIntrinsics();
  apply(nativeMapSet, map, [key, value]);
}

export function compilerSetAdd<Value>(set: Set<Value>, value: Value): void {
  assertCompilerSecurityIntrinsics();
  apply(nativeSetAdd, set, [value]);
}

export function compilerSetDelete<Value>(set: Set<Value>, value: Value): boolean {
  assertCompilerSecurityIntrinsics();
  return apply(nativeSetDelete, set, [value]);
}

export function compilerSetHas<Value>(set: ReadonlySet<Value>, value: Value): boolean {
  assertCompilerSecurityIntrinsics();
  return apply(nativeSetHas, set, [value]);
}

export function compilerSetForEach<Value>(
  set: ReadonlySet<Value>,
  callback: (value: Value) => void,
): void {
  assertCompilerSecurityIntrinsics();
  apply(nativeSetForEach, set, [callback]);
}

export function compilerObservePromise<Value>(
  value: Value | PromiseLike<Value>,
  fulfilled: (resolved: Value) => unknown,
  rejected: (error: unknown) => unknown,
): void {
  assertCompilerSecurityIntrinsics();
  const promise = apply<Promise<Value>>(nativePromiseResolve, NativePromise, [value]);
  apply(nativePromiseThen, promise, [fulfilled, rejected]);
}

export function compilerPromiseThen<Value, Result>(
  value: Value | PromiseLike<Value>,
  fulfilled: (resolved: Value) => Result | PromiseLike<Result>,
  rejected?: (error: unknown) => Result | PromiseLike<Result>,
): Promise<Result> {
  assertCompilerSecurityIntrinsics();
  const promise = apply<Promise<Value>>(nativePromiseResolve, NativePromise, [value]);
  return apply(
    nativePromiseThen,
    promise,
    rejected === undefined ? [fulfilled] : [fulfilled, rejected],
  );
}

export function compilerSha256Hex(value: string): string {
  assertCompilerSecurityIntrinsics();
  if (typeof value !== 'string') throw new NativeTypeError('Compiler hash input must be a string.');
  const hash = nativeCreateHash('sha256');
  apply(nativeHashUpdate!, hash, [value]);
  const digest = apply<string>(nativeHashDigest!, hash, ['hex']);
  if (!isLowerHexDigest(digest)) {
    throw new NativeTypeError('Kovo compiler SHA-256 digest has an invalid shape.');
  }
  return digest;
}

export function compilerSha256Base64(value: string): string {
  assertCompilerSecurityIntrinsics();
  if (typeof value !== 'string') throw new NativeTypeError('Compiler hash input must be a string.');
  const hash = nativeCreateHash('sha256');
  apply(nativeHashUpdate!, hash, [value]);
  const digest = apply<string>(nativeHashDigest!, hash, ['base64']);
  if (!isSha256Base64Digest(digest)) {
    throw new NativeTypeError('Kovo compiler SHA-256 digest has an invalid shape.');
  }
  return digest;
}

export function compilerHmacSha256Hex(key: string, value: string): string {
  assertCompilerSecurityIntrinsics();
  if (typeof key !== 'string' || typeof value !== 'string') {
    throw new NativeTypeError('Compiler HMAC key/input must be strings.');
  }
  const hmac = nativeCreateHmac('sha256', key);
  apply(nativeHmacUpdate!, hmac, [value]);
  const digest = apply<string>(nativeHmacDigest!, hmac, ['hex']);
  if (!isLowerHexDigest(digest)) {
    throw new NativeTypeError('Kovo compiler HMAC digest has an invalid shape.');
  }
  return digest;
}

export function compilerSecureStringEqual(left: string, right: string): boolean {
  assertCompilerSecurityIntrinsics();
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |=
      apply<number>(nativeStringCharCodeAt, left, [index]) ^
      apply<number>(nativeStringCharCodeAt, right, [index]);
  }
  return difference === 0;
}

export function compilerRegExpTest(value: RegExp, input: string): boolean {
  assertCompilerSecurityIntrinsics();
  return apply<RegExpExecArray | null>(nativeRegExpExec, value, [input]) !== null;
}

export function compilerRegExpExec(value: RegExp, input: string): RegExpExecArray | null {
  assertCompilerSecurityIntrinsics();
  return apply(nativeRegExpExec, value, [input]);
}

export function compilerRegExpReplace(
  expression: RegExp,
  input: string,
  replacement: string | ((...values: string[]) => string),
): string {
  assertCompilerSecurityIntrinsics();
  if (typeof nativeRegExpGlobalGetter !== 'function') {
    throw new NativeTypeError('Compiler RegExp global control is unavailable.');
  }
  if (typeof replacement === 'string' && compilerStringIncludes(replacement, '$')) {
    throw new NativeTypeError('Compiler RegExp replacements must not contain substitutions.');
  }
  const global = apply<boolean>(nativeRegExpGlobalGetter, expression, []);
  expression.lastIndex = 0;
  let output = '';
  let sourceIndex = 0;
  while (true) {
    const match = apply<RegExpExecArray | null>(nativeRegExpExec, expression, [input]);
    if (match === null) break;
    const index = compilerOwnDataValue(match, 'index', 'Compiler RegExp match');
    const matched = compilerOwnDataValue(match, 0, 'Compiler RegExp match');
    if (
      typeof index !== 'number' ||
      !compilerNumberIsSafeInteger(index) ||
      index < sourceIndex ||
      typeof matched !== 'string'
    ) {
      throw new NativeTypeError('Compiler RegExp match has an invalid shape.');
    }
    output += compilerStringSlice(input, sourceIndex, index);
    if (typeof replacement === 'string') {
      output += replacement;
    } else {
      const captureLength = compilerArrayLength(match, 'Compiler RegExp match');
      const captures: string[] = [];
      for (let captureIndex = 0; captureIndex < captureLength; captureIndex += 1) {
        const capture = compilerOwnDataValue(match, captureIndex, 'Compiler RegExp match');
        if (capture !== undefined && typeof capture !== 'string') {
          throw new NativeTypeError('Compiler RegExp captures must be strings or undefined.');
        }
        captures[captures.length] = capture ?? '';
      }
      output += apply<string>(replacement, undefined, captures);
    }
    sourceIndex = index + matched.length;
    if (!global) break;
    if (matched.length === 0) {
      throw new NativeTypeError('Compiler RegExp replacements cannot use empty global matches.');
    }
  }
  return output + compilerStringSlice(input, sourceIndex);
}

export function compilerStringCharCodeAt(value: string, index: number): number {
  assertCompilerSecurityIntrinsics();
  return apply(nativeStringCharCodeAt, value, [index]);
}

export function compilerStringEndsWith(value: string, search: string): boolean {
  assertCompilerSecurityIntrinsics();
  return apply(nativeStringEndsWith, value, [search]);
}

export function compilerStringIncludes(value: string, search: string): boolean {
  assertCompilerSecurityIntrinsics();
  return apply(nativeStringIncludes, value, [search]);
}

export function compilerStringIndexOf(value: string, search: string, position?: number): number {
  assertCompilerSecurityIntrinsics();
  return apply(nativeStringIndexOf, value, position === undefined ? [search] : [search, position]);
}

export function compilerStringLocaleCompare(left: string, right: string): number {
  assertCompilerSecurityIntrinsics();
  return apply(nativeStringLocaleCompare, left, [right]);
}

export function compilerStringReplaceAll(
  value: string,
  search: string,
  replacement: string,
): string {
  assertCompilerSecurityIntrinsics();
  if (search.length === 0) {
    throw new NativeTypeError('Compiler literal replacement search must not be empty.');
  }
  let output = '';
  let sourceIndex = 0;
  while (true) {
    const matchIndex = apply<number>(nativeStringIndexOf, value, [search, sourceIndex]);
    if (matchIndex < 0) break;
    output += apply<string>(nativeStringSlice, value, [sourceIndex, matchIndex]);
    output += replacement;
    sourceIndex = matchIndex + search.length;
  }
  return output + apply<string>(nativeStringSlice, value, [sourceIndex]);
}

export function compilerStringSlice(value: string, start: number, end?: number): string {
  assertCompilerSecurityIntrinsics();
  return apply(nativeStringSlice, value, end === undefined ? [start] : [start, end]);
}

export function compilerStringSplit(value: string, separator: string): string[] {
  assertCompilerSecurityIntrinsics();
  if (separator.length === 0) {
    throw new NativeTypeError('Compiler literal split separator must not be empty.');
  }
  const result: string[] = [];
  let sourceIndex = 0;
  while (true) {
    const matchIndex = apply<number>(nativeStringIndexOf, value, [separator, sourceIndex]);
    if (matchIndex < 0) break;
    result[result.length] = apply(nativeStringSlice, value, [sourceIndex, matchIndex]);
    sourceIndex = matchIndex + separator.length;
  }
  result[result.length] = apply(nativeStringSlice, value, [sourceIndex]);
  return result;
}

export function compilerStringStartsWith(value: string, search: string): boolean {
  assertCompilerSecurityIntrinsics();
  return apply(nativeStringStartsWith, value, [search]);
}

export function compilerStringToLowerCase(value: string): string {
  assertCompilerSecurityIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function compilerStringTrim(value: string): string {
  assertCompilerSecurityIntrinsics();
  return apply(nativeStringTrim, value, []);
}

export function compilerStatsIsDirectory(value: object): boolean {
  assertCompilerSecurityIntrinsics();
  return apply(nativeStatsIsDirectory, value, []);
}

export function compilerStatsIsFile(value: object): boolean {
  assertCompilerSecurityIntrinsics();
  return apply(nativeStatsIsFile, value, []);
}

export function compilerRandomUuid(): string {
  assertCompilerSecurityIntrinsics();
  const value = nativeRandomUUID({ disableEntropyCache: true });
  if (!isUuidV4(value)) throw new NativeTypeError('Compiler random UUID has an invalid shape.');
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

function isSha256Base64Digest(value: string): boolean {
  if (value.length !== 44 || apply<number>(nativeStringCharCodeAt, value, [43]) !== 0x3d) {
    return false;
  }
  for (let index = 0; index < 43; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    if (
      !(
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        code === 0x2b ||
        code === 0x2f
      )
    ) {
      return false;
    }
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
