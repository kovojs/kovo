/* oxlint-disable typescript/unbound-method -- Boot-captured controls use pinned Reflect.apply. */

import { types as nodeUtilTypes } from 'node:util';

/** Boot-pinned controls for Better Auth redirect, schema, and session-evidence classification. */

const NativeArray = globalThis.Array;
const NativeDate = globalThis.Date;
const NativeHeaders = globalThis.Headers;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeRegExp = globalThis.RegExp;
const NativeReflect = globalThis.Reflect;
const NativeResponse = globalThis.Response;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const NativeURL = globalThis.URL;
const nativeArrayIsArray = NativeArray.isArray;
const nativeDateGetTime = NativeDate.prototype.getTime;
const nativeDateNow = NativeDate.now;
const nativeDateParse = NativeDate.parse;
const nativeJsonParse = NativeJSON.parse;
const nativeJsonStringify = NativeJSON.stringify;
const nativeMapForEach = NativeMap.prototype.forEach;
const nativeMapDelete = NativeMap.prototype.delete;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapHas = NativeMap.prototype.has;
const nativeMapSet = NativeMap.prototype.set;
const nativeNumberIsNaN = NativeNumber.isNaN;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectIsFrozen = NativeObject.isFrozen;
const nativeObjectKeys = NativeObject.keys;
const nativeReflectApply = NativeReflect.apply;
const nativeHeadersAppend = getMethod(NativeHeaders.prototype, 'append');
const nativeHeadersGet = getMethod(NativeHeaders.prototype, 'get');
const nativeHeadersSet = getMethod(NativeHeaders.prototype, 'set');
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeRegExpGlobalGetter = getGetter(NativeRegExp.prototype, 'global');
const nativeResponseClone = getMethod(NativeResponse.prototype, 'clone');
const nativeResponseHeadersGetter = getGetter(NativeResponse.prototype, 'headers');
const nativeResponseJson = getMethod(NativeResponse.prototype, 'json');
const nativeResponseStatusGetter = getGetter(NativeResponse.prototype, 'status');
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetForEach = NativeSet.prototype.forEach;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringToUpperCase = NativeString.prototype.toUpperCase;
const nativeStringTrim = NativeString.prototype.trim;
const nativeUrlHashGetter = getGetter(NativeURL.prototype, 'hash');
const nativeUrlHostnameGetter = getGetter(NativeURL.prototype, 'hostname');
const nativeUrlOriginGetter = getGetter(NativeURL.prototype, 'origin');
const nativeUrlPasswordGetter = getGetter(NativeURL.prototype, 'password');
const nativeUrlPathnameGetter = getGetter(NativeURL.prototype, 'pathname');
const nativeUrlProtocolGetter = getGetter(NativeURL.prototype, 'protocol');
const nativeUrlSearchGetter = getGetter(NativeURL.prototype, 'search');
const nativeUrlUsernameGetter = getGetter(NativeURL.prototype, 'username');
const nativeUtilIsProxy = nodeUtilTypes.isProxy;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function getGetter(prototype: object, property: PropertyKey): Function | undefined {
  return apply<PropertyDescriptor | undefined>(nativeObjectGetOwnPropertyDescriptor, NativeObject, [
    prototype,
    property,
  ])?.get;
}

function getMethod(prototype: object, property: PropertyKey): Function | undefined {
  const descriptor = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [prototype, property],
  );
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'function'
    ? descriptor.value
    : undefined;
}

function readNativeUrlProtocol(value: object): string | undefined {
  return nativeUrlProtocolGetter === undefined
    ? undefined
    : apply<string>(nativeUrlProtocolGetter, value, []);
}

function readNativeUrlPart(getter: Function | undefined, value: object): string | undefined {
  return getter === undefined ? undefined : apply<string>(getter, value, []);
}

function capturedControlsAreSound(): boolean {
  try {
    const match = apply<RegExpExecArray | null>(nativeRegExpExec, /^safe$/u, ['safe']);
    const miss = apply<RegExpExecArray | null>(nativeRegExpExec, /^safe$/u, ['unsafe']);
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [{ safe: 42 }, 'safe'],
    );
    const response = new NativeResponse('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
      status: 201,
    });
    const headers = new NativeHeaders();
    if (nativeHeadersSet !== undefined) apply(nativeHeadersSet, headers, ['location', '/safe']);
    const map = new NativeMap<string, string>();
    apply(nativeMapSet, map, ['safe', 'value']);
    const set = new NativeSet<string>();
    apply(nativeSetAdd, set, ['safe']);
    const keys = apply<string[]>(nativeObjectKeys, NativeObject, [{ safe: true }]);
    const parsed = apply<Record<string, unknown>>(nativeJsonParse, NativeJSON, ['{"safe":true}']);
    const frozenProbe = { safe: true };
    const nullRecord = apply<Record<string, unknown>>(nativeObjectCreate, NativeObject, [null]);
    apply(nativeObjectDefineProperty, NativeObject, [
      nullRecord,
      'safe',
      { configurable: true, enumerable: true, value: 42, writable: true },
    ]);
    const nullRecordDescriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [nullRecord, 'safe'],
    );
    apply(nativeObjectFreeze, NativeObject, [frozenProbe]);
    return (
      apply(nativeArrayIsArray, NativeArray, [[]]) === true &&
      apply(nativeArrayIsArray, NativeArray, [{}]) === false &&
      typeof nativeRegExpGlobalGetter === 'function' &&
      match?.[0] === 'safe' &&
      miss === null &&
      descriptor !== undefined &&
      'value' in descriptor &&
      descriptor.value === 42 &&
      nullRecordDescriptor !== undefined &&
      'value' in nullRecordDescriptor &&
      nullRecordDescriptor.value === 42 &&
      keys.length === 1 &&
      keys[0] === 'safe' &&
      parsed.safe === true &&
      apply<string>(nativeJsonStringify, NativeJSON, [{ safe: true }]) === '{"safe":true}' &&
      apply(nativeObjectIsFrozen, NativeObject, [frozenProbe]) === true &&
      apply(nativeMapGet, map, ['safe']) === 'value' &&
      apply(nativeMapDelete, map, ['safe']) === true &&
      apply(nativeMapHas, map, ['safe']) === false &&
      apply(nativeMapSet, map, ['safe', 'value']) === map &&
      apply(nativeMapHas, map, ['safe']) === true &&
      apply(nativeMapHas, map, ['missing']) === false &&
      apply(nativeSetHas, set, ['safe']) === true &&
      apply(nativeSetHas, set, ['missing']) === false &&
      apply(nativeStringCharCodeAt, '\n', [0]) === 10 &&
      apply(nativeStringEndsWith, 'schema.ts', ['.ts']) === true &&
      apply(nativeStringIncludes, 'pgTable', ['Table']) === true &&
      apply(nativeStringIndexOf, 'sid=value', ['=']) === 3 &&
      apply(nativeStringSlice, 'sid=value', [4]) === 'value' &&
      apply(nativeStringStartsWith, 'schema.ts', ['schema']) === true &&
      apply<string[]>(nativeStringSplit, 'sid=value; Path=/', [';']).length === 2 &&
      apply(nativeStringToLowerCase, 'EXPIRES', []) === 'expires' &&
      apply(nativeStringToUpperCase, 'kovo', []) === 'KOVO' &&
      apply(nativeStringTrim, ' safe ', []) === 'safe' &&
      apply(nativeDateGetTime, new NativeDate(0), []) === 0 &&
      apply(nativeDateParse, NativeDate, ['Thu, 01 Jan 1970 00:00:00 GMT']) === 0 &&
      apply(nativeDateParse, NativeDate, ['Tue, 19 Jan 2038 03:14:07 GMT']) === 2_147_483_647_000 &&
      apply<number>(nativeDateNow, NativeDate, []) > 1_000_000_000_000 &&
      apply(nativeNumberIsNaN, NativeNumber, [0 / 0]) === true &&
      apply(nativeNumberIsNaN, NativeNumber, [0]) === false &&
      apply(nativeNumberIsSafeInteger, NativeNumber, [1]) === true &&
      apply(nativeNumberIsSafeInteger, NativeNumber, [1.5]) === false &&
      readNativeUrlProtocol(new NativeURL('https://kovo.example/path')) === 'https:' &&
      readNativeUrlPart(nativeUrlHostnameGetter, new NativeURL('https://kovo.example/path')) ===
        'kovo.example' &&
      readNativeUrlPart(nativeUrlOriginGetter, new NativeURL('https://kovo.example/path')) ===
        'https://kovo.example' &&
      readNativeUrlPart(nativeUrlPathnameGetter, new NativeURL('https://kovo.example/path')) ===
        '/path' &&
      nativeUtilIsProxy({}) === false &&
      nativeUtilIsProxy(new Proxy({}, {})) === true &&
      readNativeResponseStatus(response) === 201 &&
      readNativeResponseHeaders(response) !== undefined &&
      nativeHeadersAppend !== undefined &&
      nativeHeadersGet !== undefined &&
      nativeHeadersSet !== undefined &&
      apply(nativeHeadersGet, headers, ['location']) === '/safe' &&
      nativeResponseClone !== undefined &&
      nativeResponseJson !== undefined
    );
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertBetterAuthIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new NativeTypeError(
      'Kovo Better Auth controls are unavailable because server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function betterAuthArrayIsArray(value: unknown): value is unknown[] {
  assertBetterAuthIntrinsics();
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function betterAuthApply<Return>(
  fn: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertBetterAuthIntrinsics();
  return apply(fn, receiver, args);
}

export function betterAuthCharacterCodeAt(value: string, index: number): number {
  assertBetterAuthIntrinsics();
  return apply(nativeStringCharCodeAt, value, [index]);
}

export function betterAuthDateNow(): number {
  assertBetterAuthIntrinsics();
  return apply(nativeDateNow, NativeDate, []);
}

/** @internal Clone a genuine Date without consulting its mutable prototype. */
export function betterAuthCloneDate(value: object): Date | undefined {
  assertBetterAuthIntrinsics();
  try {
    const timestamp = apply<number>(nativeDateGetTime, value, []);
    return new NativeDate(timestamp);
  } catch {
    return undefined;
  }
}

export function betterAuthDateParse(value: string): number {
  assertBetterAuthIntrinsics();
  return apply(nativeDateParse, NativeDate, [value]);
}

export function betterAuthJsonStringify(value: unknown): string {
  assertBetterAuthIntrinsics();
  return apply(nativeJsonStringify, NativeJSON, [value]);
}

/** @internal Parse a URL and read its scheme without consulting a mutable late prototype getter. */
export function betterAuthUrlProtocol(value: string): string {
  assertBetterAuthIntrinsics();
  const protocol = readNativeUrlProtocol(new NativeURL(value));
  if (protocol === undefined) {
    throw new NativeTypeError('Kovo Better Auth URL protocol control is unavailable.');
  }
  return protocol;
}

/** @internal Parse an absolute URL into boot-captured security-relevant components. */
export function betterAuthUrlSnapshot(
  value: string,
  base?: string,
): {
  hash: string;
  hostname: string;
  origin: string;
  password: string;
  pathname: string;
  protocol: string;
  search: string;
  username: string;
} {
  assertBetterAuthIntrinsics();
  const url = base === undefined ? new NativeURL(value) : new NativeURL(value, base);
  const hash = readNativeUrlPart(nativeUrlHashGetter, url);
  const hostname = readNativeUrlPart(nativeUrlHostnameGetter, url);
  const origin = readNativeUrlPart(nativeUrlOriginGetter, url);
  const password = readNativeUrlPart(nativeUrlPasswordGetter, url);
  const pathname = readNativeUrlPart(nativeUrlPathnameGetter, url);
  const protocol = readNativeUrlProtocol(url);
  const search = readNativeUrlPart(nativeUrlSearchGetter, url);
  const username = readNativeUrlPart(nativeUrlUsernameGetter, url);
  if (
    hash === undefined ||
    hostname === undefined ||
    origin === undefined ||
    password === undefined ||
    pathname === undefined ||
    protocol === undefined ||
    search === undefined ||
    username === undefined
  ) {
    throw new NativeTypeError('Kovo Better Auth URL controls are unavailable.');
  }
  return { hash, hostname, origin, password, pathname, protocol, search, username };
}

export function betterAuthGetOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  assertBetterAuthIntrinsics();
  return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
}

/** @internal Enumerate own enumerable names through the boot-pinned Object control. */
export function betterAuthObjectKeys(value: object, label: string): string[] {
  assertBetterAuthIntrinsics();
  return betterAuthSnapshotDenseArray(
    apply<string[]>(nativeObjectKeys, NativeObject, [value]),
    label,
  );
}

/** @internal Read a stable own-data property without invoking a caller accessor. */
export function betterAuthOwnDataValue(
  source: object,
  property: PropertyKey,
  label: string,
): unknown {
  if (nativeUtilIsProxy(source)) {
    throw new NativeTypeError(`${label} must not be a Proxy.`);
  }
  const before = betterAuthGetOwnPropertyDescriptor(source, property);
  const after = betterAuthGetOwnPropertyDescriptor(source, property);
  if (!sameDataDescriptor(before, after)) {
    throw new NativeTypeError(`${label}.${String(property)} changed while it was inspected.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new NativeTypeError(`${label}.${String(property)} must be an own-data property.`);
  }
  return before.value;
}

/** @internal Read constructor authority without invoking accessors or inheriting polluted values. */
export function betterAuthOwnDataOption<Value>(
  options: object,
  property: PropertyKey,
  label: string,
): Value | undefined {
  if (nativeUtilIsProxy(options)) {
    throw new NativeTypeError(`${label} owner must not be a Proxy.`);
  }
  const before = betterAuthGetOwnPropertyDescriptor(options, property);
  const after = betterAuthGetOwnPropertyDescriptor(options, property);
  if (!sameDataDescriptor(before, after)) {
    throw new TypeError(`${label} changed while it was inspected.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new TypeError(`${label} must be an own-data property.`);
  }
  return before.value as Value | undefined;
}

export function betterAuthCaptureOwnApiMethod(
  auth: object,
  methodName: PropertyKey,
  label: string,
): { method: Function; receiver: object } {
  const apiDescriptor = betterAuthGetOwnPropertyDescriptor(auth, 'api');
  if (
    apiDescriptor === undefined ||
    !('value' in apiDescriptor) ||
    !isObject(apiDescriptor.value)
  ) {
    throw new TypeError(`${label}.api must be a stable own-data object.`);
  }
  const receiver = apiDescriptor.value;
  return betterAuthCaptureOwnMethod(receiver, methodName, `${label}.api`);
}

export function betterAuthCaptureOwnMethod(
  receiver: object,
  methodName: PropertyKey,
  label: string,
): { method: Function; receiver: object } {
  const methodDescriptor = betterAuthGetOwnPropertyDescriptor(receiver, methodName);
  if (
    methodDescriptor === undefined ||
    !('value' in methodDescriptor) ||
    typeof methodDescriptor.value !== 'function'
  ) {
    throw new TypeError(`${label}.${String(methodName)} must be a stable own-data method.`);
  }
  return { method: methodDescriptor.value, receiver };
}

export function betterAuthDefineOwnData<Value>(
  target: object,
  property: PropertyKey,
  value: Value,
  label: string,
): void {
  assertBetterAuthIntrinsics();
  apply(nativeObjectDefineProperty, NativeObject, [
    target,
    property,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
  const committed = betterAuthGetOwnPropertyDescriptor(target, property);
  if (committed === undefined || !('value' in committed) || committed.value !== value) {
    throw new TypeError(`${label} own-data commit failed.`);
  }
}

/** @internal Commit immutable own-data authority onto a caller carrier after validation. */
export function betterAuthPinOwnData<Value>(
  target: object,
  property: PropertyKey,
  value: Value,
  label: string,
): void {
  assertBetterAuthIntrinsics();
  const before = betterAuthGetOwnPropertyDescriptor(target, property);
  if (before === undefined || !('value' in before) || before.value !== value) {
    throw new NativeTypeError(`${label} must be stable own data before it is pinned.`);
  }
  apply(nativeObjectDefineProperty, NativeObject, [
    target,
    property,
    {
      configurable: false,
      enumerable: before.enumerable === true,
      value,
      writable: false,
    },
  ]);
  const committed = betterAuthGetOwnPropertyDescriptor(target, property);
  if (
    committed === undefined ||
    !('value' in committed) ||
    committed.value !== value ||
    committed.configurable !== false ||
    committed.writable !== false
  ) {
    throw new NativeTypeError(`${label} immutable own-data commit failed.`);
  }
}

/** @internal Deep-freeze a framework-owned plain authority graph through boot-pinned controls. */
export function betterAuthDeepFreeze<Value>(value: Value, label: string): Value {
  assertBetterAuthIntrinsics();
  const seen = new NativeSet<object>();

  function freezeOwnDataGraph(candidate: unknown): void {
    if (!isObject(candidate) || apply(nativeSetHas, seen, [candidate])) return;
    apply(nativeSetAdd, seen, [candidate]);

    const keys = betterAuthSnapshotDenseArray(
      apply<string[]>(nativeObjectKeys, NativeObject, [candidate]),
      `${label} own keys`,
    );
    for (let index = 0; index < keys.length; index += 1) {
      const property = keys[index]!;
      const descriptor = betterAuthGetOwnPropertyDescriptor(candidate, property);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new NativeTypeError(`${label}.${property} must be an own-data property.`);
      }
      freezeOwnDataGraph(descriptor.value);
    }

    apply(nativeObjectFreeze, NativeObject, [candidate]);
    if (!apply<boolean>(nativeObjectIsFrozen, NativeObject, [candidate])) {
      throw new NativeTypeError(`${label} could not be frozen.`);
    }
  }

  freezeOwnDataGraph(value);
  return value;
}

/** @internal Shallow-freeze a framework-owned carrier through the boot-pinned Object control. */
export function betterAuthFreezeOwn<Value extends object>(value: Value, label: string): Value {
  assertBetterAuthIntrinsics();
  apply(nativeObjectFreeze, NativeObject, [value]);
  if (!apply<boolean>(nativeObjectIsFrozen, NativeObject, [value])) {
    throw new NativeTypeError(`${label} could not be frozen.`);
  }
  return value;
}

export function betterAuthArrayAppend<Value>(target: Value[], value: Value, label: string): void {
  assertBetterAuthIntrinsics();
  const length = betterAuthGetOwnPropertyDescriptor(target, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    !apply(nativeNumberIsSafeInteger, NativeNumber, [length.value]) ||
    length.value < 0 ||
    length.value >= 100_000
  ) {
    throw new TypeError(`${label} must have a bounded own array length.`);
  }
  betterAuthDefineOwnData(target, length.value, value, label);
}

export function betterAuthCreateMap<Key, Value>(): Map<Key, Value> {
  assertBetterAuthIntrinsics();
  return new NativeMap<Key, Value>();
}

/** @internal Create a prototype-free carrier through the boot-pinned Object control. */
export function betterAuthCreateNullRecord<Value>(): Record<string, Value> {
  assertBetterAuthIntrinsics();
  return apply<Record<string, Value>>(nativeObjectCreate, NativeObject, [null]);
}

export function betterAuthCreateSet<Value>(): Set<Value> {
  assertBetterAuthIntrinsics();
  return new NativeSet<Value>();
}

export function betterAuthMapGet<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  key: Key,
): Value | undefined {
  assertBetterAuthIntrinsics();
  return apply(nativeMapGet, map, [key]);
}

export function betterAuthMapDelete<Key, Value>(map: Map<Key, Value>, key: Key): boolean {
  assertBetterAuthIntrinsics();
  return apply(nativeMapDelete, map, [key]);
}

export function betterAuthMapHas<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): boolean {
  assertBetterAuthIntrinsics();
  return apply(nativeMapHas, map, [key]);
}

export function betterAuthMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertBetterAuthIntrinsics();
  apply(nativeMapSet, map, [key, value]);
}

export function betterAuthMapValues<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  label: string,
): Value[] {
  assertBetterAuthIntrinsics();
  const values: Value[] = [];
  apply(nativeMapForEach, map, [
    (value: Value) => {
      betterAuthArrayAppend(values, value, label);
    },
  ]);
  return values;
}

export function betterAuthMapEntries<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  label: string,
): Array<readonly [Key, Value]> {
  assertBetterAuthIntrinsics();
  const entries: Array<readonly [Key, Value]> = [];
  apply(nativeMapForEach, map, [
    (value: Value, key: Key) => {
      betterAuthArrayAppend(entries, [key, value], label);
    },
  ]);
  return entries;
}

export function betterAuthSetAdd<Value>(set: Set<Value>, value: Value): void {
  assertBetterAuthIntrinsics();
  apply(nativeSetAdd, set, [value]);
}

export function betterAuthSetHas<Value>(set: ReadonlySet<Value>, value: Value): boolean {
  assertBetterAuthIntrinsics();
  return apply(nativeSetHas, set, [value]);
}

export function betterAuthSetValues<Value>(set: ReadonlySet<Value>, label: string): Value[] {
  assertBetterAuthIntrinsics();
  const values: Value[] = [];
  apply(nativeSetForEach, set, [
    (value: Value) => {
      betterAuthArrayAppend(values, value, label);
    },
  ]);
  return values;
}

export function betterAuthSnapshotDenseArray<Value>(
  source: readonly Value[],
  label: string,
): Value[] {
  assertBetterAuthIntrinsics();
  const length = betterAuthGetOwnPropertyDescriptor(source, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    !apply(nativeNumberIsSafeInteger, NativeNumber, [length.value]) ||
    length.value < 0 ||
    length.value >= 100_000
  ) {
    throw new TypeError(`${label} must have a bounded own array length.`);
  }

  const snapshot: Value[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const entry = betterAuthGetOwnPropertyDescriptor(source, index);
    if (entry === undefined || !('value' in entry)) {
      throw new TypeError(`${label} must contain dense own data entries.`);
    }
    betterAuthArrayAppend(snapshot, entry.value as Value, label);
  }
  return snapshot;
}

export function betterAuthIndexOf(value: string, search: string, position = 0): number {
  assertBetterAuthIntrinsics();
  return apply(nativeStringIndexOf, value, [search, position]);
}

export function betterAuthIsNaN(value: number): boolean {
  assertBetterAuthIntrinsics();
  return apply(nativeNumberIsNaN, NativeNumber, [value]);
}

export function betterAuthIsSafeInteger(value: number): boolean {
  assertBetterAuthIntrinsics();
  return apply(nativeNumberIsSafeInteger, NativeNumber, [value]);
}

/** @internal Refuse hostile Proxy carriers before own-data security classification. */
export function betterAuthIsProxy(value: unknown): boolean {
  assertBetterAuthIntrinsics();
  return nativeUtilIsProxy(value);
}

export function betterAuthRegExpExec(pattern: RegExp, value: string): RegExpExecArray | null {
  assertBetterAuthIntrinsics();
  pattern.lastIndex = 0;
  return apply(nativeRegExpExec, pattern, [value]);
}

export function betterAuthRegExpMatches(
  pattern: RegExp,
  value: string,
  label: string,
): RegExpExecArray[] {
  assertBetterAuthIntrinsics();
  if (nativeRegExpGlobalGetter === undefined) {
    throw new NativeTypeError('Better Auth RegExp global control is unavailable.');
  }
  const global = apply<boolean>(nativeRegExpGlobalGetter, pattern, []);
  pattern.lastIndex = 0;
  const matches: RegExpExecArray[] = [];
  while (true) {
    const match = apply<RegExpExecArray | null>(nativeRegExpExec, pattern, [value]);
    if (match === null) break;
    const matched = betterAuthOwnDataValue(match, 0, label);
    const index = betterAuthOwnDataValue(match, 'index', label);
    if (
      typeof matched !== 'string' ||
      matched.length === 0 ||
      typeof index !== 'number' ||
      !apply(nativeNumberIsSafeInteger, NativeNumber, [index]) ||
      index < 0
    ) {
      throw new NativeTypeError(`${label} returned an invalid RegExp match.`);
    }
    betterAuthArrayAppend(matches, match, label);
    if (!global) break;
  }
  return matches;
}

export function betterAuthJsonParse(value: string): unknown {
  assertBetterAuthIntrinsics();
  return apply(nativeJsonParse, NativeJSON, [value]);
}

/** @internal Read a genuine native header through the boot-captured brand-checked method. */
export function betterAuthHeadersGet(headers: Headers, name: string): string | null {
  assertBetterAuthIntrinsics();
  if (nativeHeadersGet === undefined) {
    throw new NativeTypeError('Kovo Better Auth header controls are unavailable.');
  }
  const value = apply<unknown>(nativeHeadersGet, headers, [name]);
  return typeof value === 'string' ? value : null;
}

/** @internal Emit an empty redirect with only reviewed headers from the fixed mount boundary. */
export function betterAuthCreateRedirectResponse(
  status: 301 | 302 | 303 | 307 | 308,
  location: string,
  setCookies: readonly string[],
): Response {
  assertBetterAuthIntrinsics();
  if (nativeHeadersAppend === undefined || nativeHeadersSet === undefined) {
    throw new NativeTypeError('Kovo Better Auth header controls are unavailable.');
  }
  const headers = new NativeHeaders();
  apply(nativeHeadersSet, headers, ['cache-control', 'no-store']);
  apply(nativeHeadersSet, headers, ['location', location]);
  for (let index = 0; index < setCookies.length; index += 1) {
    const cookie = setCookies[index];
    if (typeof cookie !== 'string') {
      throw new NativeTypeError('Kovo Better Auth redirect cookies must be strings.');
    }
    apply(nativeHeadersAppend, headers, ['set-cookie', cookie]);
  }
  return new NativeResponse(null, { headers, status });
}

export function betterAuthResponseHeaders(value: object): Headers | undefined {
  assertBetterAuthIntrinsics();
  const native = readNativeResponseHeaders(value);
  if (native !== undefined) return native;
  const descriptor = betterAuthGetOwnPropertyDescriptor(value, 'headers');
  return descriptor !== undefined && 'value' in descriptor && isObject(descriptor.value)
    ? (descriptor.value as Headers)
    : undefined;
}

export function betterAuthResponseStatus(value: object): number | undefined {
  assertBetterAuthIntrinsics();
  const native = readNativeResponseStatus(value);
  if (native !== undefined) return validBetterAuthHttpStatus(native) ? native : undefined;
  const descriptor = betterAuthGetOwnPropertyDescriptor(value, 'status');
  return descriptor !== undefined &&
    'value' in descriptor &&
    typeof descriptor.value === 'number' &&
    validBetterAuthHttpStatus(descriptor.value)
    ? descriptor.value
    : undefined;
}

export function betterAuthResponseJson(value: object): unknown {
  assertBetterAuthIntrinsics();
  if (nativeResponseClone !== undefined && nativeResponseJson !== undefined) {
    try {
      readNativeResponseStatus(value);
      const cloned = apply<object>(nativeResponseClone, value, []);
      return apply(nativeResponseJson, cloned, []);
    } catch {}
  }

  const clone = betterAuthGetOwnPropertyDescriptor(value, 'clone');
  if (clone !== undefined && 'value' in clone && typeof clone.value === 'function') {
    try {
      const cloned = betterAuthApply<unknown>(clone.value, value, []);
      if (isObject(cloned)) {
        const json = betterAuthGetOwnPropertyDescriptor(cloned, 'json');
        if (json !== undefined && 'value' in json && typeof json.value === 'function') {
          return betterAuthApply(json.value, cloned, []);
        }
      }
    } catch {}
  }
  const json = betterAuthGetOwnPropertyDescriptor(value, 'json');
  if (json !== undefined && 'value' in json && typeof json.value === 'function') {
    try {
      return betterAuthApply(json.value, value, []);
    } catch {}
  }
  return undefined;
}

export function betterAuthSlice(value: string, start: number, end?: number): string {
  assertBetterAuthIntrinsics();
  return end === undefined
    ? apply(nativeStringSlice, value, [start])
    : apply(nativeStringSlice, value, [start, end]);
}

export function betterAuthEndsWith(value: string, search: string): boolean {
  assertBetterAuthIntrinsics();
  return apply(nativeStringEndsWith, value, [search]);
}

export function betterAuthIncludes(value: string, search: string): boolean {
  assertBetterAuthIntrinsics();
  return apply(nativeStringIncludes, value, [search]);
}

export function betterAuthStartsWith(value: string, search: string): boolean {
  assertBetterAuthIntrinsics();
  return apply(nativeStringStartsWith, value, [search]);
}

/** Literal replace-all that never consults String.prototype or @@replace after bootstrap. */
export function betterAuthReplaceAll(value: string, search: string, replacement: string): string {
  assertBetterAuthIntrinsics();
  if (search.length === 0) throw new NativeTypeError('Better Auth replacement search is empty.');
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

export function betterAuthSplit(value: string, separator: string, limit?: number): string[] {
  assertBetterAuthIntrinsics();
  return limit === undefined
    ? apply(nativeStringSplit, value, [separator])
    : apply(nativeStringSplit, value, [separator, limit]);
}

export function betterAuthToLowerCase(value: string): string {
  assertBetterAuthIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function betterAuthToUpperCase(value: string): string {
  assertBetterAuthIntrinsics();
  return apply(nativeStringToUpperCase, value, []);
}

export function betterAuthTrim(value: string): string {
  assertBetterAuthIntrinsics();
  return apply(nativeStringTrim, value, []);
}

function readNativeResponseHeaders(value: object): Headers | undefined {
  if (nativeResponseHeadersGetter === undefined) return undefined;
  try {
    return apply(nativeResponseHeadersGetter, value, []);
  } catch {
    return undefined;
  }
}

function readNativeResponseStatus(value: object): number | undefined {
  if (nativeResponseStatusGetter === undefined) return undefined;
  try {
    return apply(nativeResponseStatusGetter, value, []);
  } catch {
    return undefined;
  }
}

function validBetterAuthHttpStatus(value: number): boolean {
  return (
    apply<boolean>(nativeNumberIsSafeInteger, NativeNumber, [value]) && value >= 100 && value <= 599
  );
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function sameDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if ('value' in left !== 'value' in right) return false;
  if ('value' in left && 'value' in right && left.value !== right.value) return false;
  return (
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}
