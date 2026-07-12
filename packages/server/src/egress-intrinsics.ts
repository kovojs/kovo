import { isIP as nodeIsIP } from 'node:net';

/**
 * Package-private intrinsic membrane for the SSRF decision path.
 *
 * App modules execute in the server realm and can replace ordinary prototype methods after the
 * framework has loaded. Egress classification must keep consuming the exact string/array/URL
 * semantics captured at framework initialization; otherwise a selective `some`, `replace`, or
 * collection override can turn a private address into an allowed public decision (SPEC §6.6).
 */

const NativeArray = globalThis.Array;
const NativeDate = globalThis.Date;
const NativeMap = globalThis.Map;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeRequest = globalThis.Request;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const NativeURL = globalThis.URL;
const NativeReflect = globalThis.Reflect;
const nativeDecodeURIComponent = globalThis.decodeURIComponent;
const nativeReflectApply = NativeReflect.apply;
const nativeArrayEvery = NativeArray.prototype.every;
const nativeArrayFilter = NativeArray.prototype.filter;
const nativeArrayIsArray = NativeArray.isArray;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeArrayMap = NativeArray.prototype.map;
const nativeArraySlice = NativeArray.prototype.slice;
const nativeArraySome = NativeArray.prototype.some;
const nativeArraySplice = NativeArray.prototype.splice;
const nativeDateNow = NativeDate.now;
const nativeMapClear = NativeMap.prototype.clear;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapSet = NativeMap.prototype.set;
const nativeNumber = NativeNumber;
const nativeNumberIsInteger = NativeNumber.isInteger;
const nativeNumberToString = NativeNumber.prototype.toString;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeParseInt = globalThis.parseInt;
const nativeRegExpExec = globalThis.RegExp.prototype.exec;
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetDelete = NativeSet.prototype.delete;
const nativeSetHas = NativeSet.prototype.has;
const nativeString = NativeString;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringLastIndexOf = NativeString.prototype.lastIndexOf;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringTrim = NativeString.prototype.trim;
const urlPrototype = NativeURL.prototype;
const requestPrototype = NativeRequest.prototype;
const urlHashGetter = nativeObjectGetOwnPropertyDescriptor(urlPrototype, 'hash')?.get;
const urlHostnameGetter = nativeObjectGetOwnPropertyDescriptor(urlPrototype, 'hostname')?.get;
const urlPasswordGetter = nativeObjectGetOwnPropertyDescriptor(urlPrototype, 'password')?.get;
const urlPathnameGetter = nativeObjectGetOwnPropertyDescriptor(urlPrototype, 'pathname')?.get;
const urlPortGetter = nativeObjectGetOwnPropertyDescriptor(urlPrototype, 'port')?.get;
const urlProtocolGetter = nativeObjectGetOwnPropertyDescriptor(urlPrototype, 'protocol')?.get;
const urlSearchGetter = nativeObjectGetOwnPropertyDescriptor(urlPrototype, 'search')?.get;
const urlToString = urlPrototype.toString;
const urlUsernameGetter = nativeObjectGetOwnPropertyDescriptor(urlPrototype, 'username')?.get;
const requestUrlGetter = nativeObjectGetOwnPropertyDescriptor(requestPrototype, 'url')?.get;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

// SPEC §6.6: even a boot-captured Array.push appends through prototype-visible [[Set]]. The egress
// parser and connection floor therefore define every new slot as own data through pinned controls.
function ownEgressArrayLength(values: readonly unknown[], label: string): number {
  if (apply(nativeArrayIsArray, NativeArray, [values]) !== true) {
    throw new NativeTypeError(`${label} target must be an array.`);
  }
  const lengthDescriptor = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [values, 'length'],
  );
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number'
  ) {
    throw new NativeTypeError(`${label} target must expose an own data length.`);
  }
  return lengthDescriptor.value;
}

function defineEgressArrayIndex<Value>(
  values: Value[],
  index: number,
  value: Value,
  label: string,
): void {
  const length = ownEgressArrayLength(values, label);
  if (index < 0 || index > length || index >= 4_294_967_295 || index % 1 !== 0) {
    throw new NativeTypeError(`${label} index must preserve dense array bounds.`);
  }
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
}

function commitEgressArrayItems<Value>(
  values: Value[],
  items: readonly Value[],
  label: string,
): number {
  const itemCount = ownEgressArrayLength(items, `${label} values`);
  for (let index = 0; index < itemCount; index += 1) {
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [items, index],
    );
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new NativeTypeError(`${label} values must be dense own-data entries.`);
    }
    defineEgressArrayIndex(values, ownEgressArrayLength(values, label), descriptor.value, label);
  }
  return ownEgressArrayLength(values, label);
}

function capturedControlsAreSound(): boolean {
  try {
    if (
      typeof urlHashGetter !== 'function' ||
      typeof urlHostnameGetter !== 'function' ||
      typeof urlPasswordGetter !== 'function' ||
      typeof urlPathnameGetter !== 'function' ||
      typeof urlPortGetter !== 'function' ||
      typeof urlProtocolGetter !== 'function' ||
      typeof urlSearchGetter !== 'function' ||
      typeof urlUsernameGetter !== 'function' ||
      typeof requestUrlGetter !== 'function'
    ) {
      return false;
    }

    const values = ['public', 'private'];
    if (apply(nativeArraySome, values, [(value: string) => value === 'private']) !== true) {
      return false;
    }
    if (apply(nativeArraySome, values, [(value: string) => value === 'metadata']) !== false) {
      return false;
    }
    if (apply(nativeArrayEvery, values, [(value: string) => value.length > 0]) !== true) {
      return false;
    }
    if (
      apply<string[]>(nativeArrayMap, values, [(value: string) => `${value}!`])[1] !== 'private!'
    ) {
      return false;
    }
    if (
      apply<string[]>(nativeArrayFilter, values, [(value: string) => value === 'public']).length !==
      1
    ) {
      return false;
    }
    if (apply<string[]>(nativeArraySlice, values, [1])[0] !== 'private') return false;
    if (apply(nativeArrayJoin, values, [':']) !== 'public:private') return false;

    const privateWords: number[] = [];
    commitEgressArrayItems(privateWords, [0xfd00, 0x0ec2], 'egress control probe');
    if (privateWords[0] !== 0xfd00 || privateWords[1] !== 0x0ec2) return false;

    const mutable = ['a'];
    commitEgressArrayItems(mutable, ['b'], 'egress control probe');
    apply(nativeArraySplice, mutable, [0, 1, 'c']);
    if (mutable.length !== 2 || mutable[0] !== 'c' || mutable[1] !== 'b') return false;

    if (
      apply(nativeStringTrim, '  Host.Example.  ', []) !== 'Host.Example.' ||
      apply(nativeStringToLowerCase, 'Host.Example.', []) !== 'host.example.' ||
      apply(nativeStringStartsWith, '[::1]', ['[']) !== true ||
      apply(nativeStringEndsWith, 'a.localhost', ['.localhost']) !== true ||
      apply(nativeStringIncludes, '10.0.0.1/8', ['/']) !== true ||
      apply(nativeStringIndexOf, 'a:b', [':']) !== 1 ||
      apply(nativeStringLastIndexOf, 'a:b:c', [':']) !== 3 ||
      apply(nativeStringSlice, 'a:b', [2]) !== 'b' ||
      apply<string[]>(nativeStringSplit, 'a:b', [':'])[1] !== 'b' ||
      apply<RegExpExecArray | null>(nativeRegExpExec, /^127\./u, ['127.0.0.1']) === null ||
      apply<RegExpExecArray | null>(nativeRegExpExec, /^(\d+)$/u, ['42'])?.[1] !== '42'
    ) {
      return false;
    }

    const set = new NativeSet<string>();
    apply(nativeSetAdd, set, ['x']);
    if (apply(nativeSetHas, set, ['x']) !== true || apply(nativeSetHas, set, ['y']) !== false) {
      return false;
    }
    if (apply(nativeSetDelete, set, ['x']) !== true || apply(nativeSetHas, set, ['x']) !== false) {
      return false;
    }

    const map = new NativeMap<string, string>();
    apply(nativeMapSet, map, ['x', 'value']);
    if (
      apply(nativeMapGet, map, ['x']) !== 'value' ||
      apply(nativeMapGet, map, ['y']) !== undefined
    ) {
      return false;
    }
    apply(nativeMapClear, map, []);
    if (apply(nativeMapGet, map, ['x']) !== undefined) return false;

    const url = new NativeURL('https://user:pass@Example.test:8443/a?q=1#h');
    if (
      apply(urlProtocolGetter, url, []) !== 'https:' ||
      apply(urlHostnameGetter, url, []) !== 'example.test' ||
      apply(urlPortGetter, url, []) !== '8443' ||
      apply(urlUsernameGetter, url, []) !== 'user' ||
      apply(urlPasswordGetter, url, []) !== 'pass' ||
      apply(urlPathnameGetter, url, []) !== '/a' ||
      apply(urlSearchGetter, url, []) !== '?q=1' ||
      apply(urlHashGetter, url, []) !== '#h'
    ) {
      return false;
    }
    const requestUrl = new NativeURL('https://example.test/a');
    const request = new NativeRequest(requestUrl);
    if (apply(requestUrlGetter, request, []) !== apply(urlToString, requestUrl, [])) return false;

    if (
      apply(nativeDecodeURIComponent, undefined, ['%31%32%37.0.0.1']) !== '127.0.0.1' ||
      apply(nativeNumber, undefined, ['443']) !== 443 ||
      apply(nativeNumberIsInteger, NativeNumber, [443]) !== true ||
      apply(nativeParseInt, undefined, ['ff', 16]) !== 255 ||
      apply(nativeNumberToString, 255, [16]) !== 'ff' ||
      apply(nativeArrayIsArray, NativeArray, [values]) !== true ||
      apply(nodeIsIP, undefined, ['127.0.0.1']) !== 4 ||
      typeof apply(nativeDateNow, NativeDate, []) !== 'number'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertEgressIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new TypeError(
      'Kovo egress controls are unavailable because server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function egressApply<Return>(
  fn: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertEgressIntrinsics();
  return apply(fn, receiver, args);
}

export function egressArrayEvery<T>(
  value: readonly T[],
  predicate: (item: T, index: number) => boolean,
): boolean {
  assertEgressIntrinsics();
  return apply(nativeArrayEvery, value, [predicate]);
}

export function egressArrayFilter<T>(
  value: readonly T[],
  predicate: (item: T, index: number) => boolean,
): T[] {
  assertEgressIntrinsics();
  return apply(nativeArrayFilter, value, [predicate]);
}

export function egressArrayIsArray(value: unknown): value is unknown[] {
  assertEgressIntrinsics();
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function egressArrayJoin(value: readonly unknown[], separator: string): string {
  assertEgressIntrinsics();
  return apply(nativeArrayJoin, value, [separator]);
}

export function egressArrayMap<T, Result>(
  value: readonly T[],
  callback: (item: T, index: number) => Result,
): Result[] {
  assertEgressIntrinsics();
  return apply(nativeArrayMap, value, [callback]);
}

export function egressArrayPush<T>(value: T[], ...items: T[]): number {
  assertEgressIntrinsics();
  return commitEgressArrayItems(value, items, 'egress array append');
}

export function egressArraySlice<T>(value: readonly T[], start?: number, end?: number): T[] {
  assertEgressIntrinsics();
  return apply(nativeArraySlice, value, end === undefined ? [start] : [start, end]);
}

export function egressArraySome<T>(
  value: readonly T[],
  predicate: (item: T, index: number) => boolean,
): boolean {
  assertEgressIntrinsics();
  return apply(nativeArraySome, value, [predicate]);
}

export function egressArraySplice<T>(
  value: T[],
  start: number,
  deleteCount: number,
  ...items: T[]
): T[] {
  assertEgressIntrinsics();
  const args: unknown[] = [start, deleteCount];
  commitEgressArrayItems(args, items, 'egress splice arguments');
  return apply(nativeArraySplice, value, args);
}

export function egressDateNow(): number {
  assertEgressIntrinsics();
  return apply(nativeDateNow, NativeDate, []);
}

export function egressDecodeURIComponent(value: string): string {
  assertEgressIntrinsics();
  return apply(nativeDecodeURIComponent, undefined, [value]);
}

export function egressMapClear<Key, Value>(map: Map<Key, Value>): void {
  assertEgressIntrinsics();
  apply(nativeMapClear, map, []);
}

export function egressMapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  assertEgressIntrinsics();
  return apply(nativeMapGet, map, [key]);
}

export function egressMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertEgressIntrinsics();
  apply(nativeMapSet, map, [key, value]);
}

export function egressNetIsIp(value: string): number {
  assertEgressIntrinsics();
  return apply(nodeIsIP, undefined, [value]);
}

export function egressNumber(value: unknown): number {
  assertEgressIntrinsics();
  return apply(nativeNumber, undefined, [value]);
}

export function egressNumberIsInteger(value: unknown): value is number {
  assertEgressIntrinsics();
  return apply(nativeNumberIsInteger, NativeNumber, [value]);
}

export function egressNumberToString(value: number, radix?: number): string {
  assertEgressIntrinsics();
  return apply(nativeNumberToString, value, radix === undefined ? [] : [radix]);
}

export function egressObjectDefineProperty<T extends object>(
  value: T,
  property: PropertyKey,
  descriptor: PropertyDescriptor,
): T {
  assertEgressIntrinsics();
  return apply(nativeObjectDefineProperty, NativeObject, [value, property, descriptor]);
}

export function egressParseInt(value: string, radix: number): number {
  assertEgressIntrinsics();
  return apply(nativeParseInt, undefined, [value, radix]);
}

export function egressRegExpExec(expression: RegExp, value: string): RegExpExecArray | null {
  assertEgressIntrinsics();
  return apply(nativeRegExpExec, expression, [value]);
}

export function egressRegExpTest(expression: RegExp, value: string): boolean {
  assertEgressIntrinsics();
  return apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value]) !== null;
}

export function egressRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  assertEgressIntrinsics();
  return new NativeRequest(input, init);
}

export function egressRequestUrl(value: Request): string {
  assertEgressIntrinsics();
  return apply(requestUrlGetter!, value, []);
}

export function egressSetAdd<T>(set: Set<T>, value: T): void {
  assertEgressIntrinsics();
  apply(nativeSetAdd, set, [value]);
}

export function egressSetDelete<T>(set: Set<T>, value: T): boolean {
  assertEgressIntrinsics();
  return apply(nativeSetDelete, set, [value]);
}

export function egressSetHas<T>(set: ReadonlySet<T>, value: T): boolean {
  assertEgressIntrinsics();
  return apply(nativeSetHas, set, [value]);
}

export function egressString(value: unknown): string {
  assertEgressIntrinsics();
  return apply(nativeString, undefined, [value]);
}

export function egressStringEndsWith(value: string, search: string): boolean {
  assertEgressIntrinsics();
  return apply(nativeStringEndsWith, value, [search]);
}

export function egressStringIncludes(value: string, search: string): boolean {
  assertEgressIntrinsics();
  return apply(nativeStringIncludes, value, [search]);
}

export function egressStringIndexOf(value: string, search: string, fromIndex?: number): number {
  assertEgressIntrinsics();
  return apply(
    nativeStringIndexOf,
    value,
    fromIndex === undefined ? [search] : [search, fromIndex],
  );
}

export function egressStringLastIndexOf(value: string, search: string): number {
  assertEgressIntrinsics();
  return apply(nativeStringLastIndexOf, value, [search]);
}

export function egressStringSlice(value: string, start?: number, end?: number): string {
  assertEgressIntrinsics();
  return apply(nativeStringSlice, value, end === undefined ? [start] : [start, end]);
}

export function egressStringSplit(value: string, separator: string): string[] {
  assertEgressIntrinsics();
  return apply(nativeStringSplit, value, [separator]);
}

export function egressStringStartsWith(value: string, search: string): boolean {
  assertEgressIntrinsics();
  return apply(nativeStringStartsWith, value, [search]);
}

export function egressStringToLowerCase(value: string): string {
  assertEgressIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function egressStringTrim(value: string): string {
  assertEgressIntrinsics();
  return apply(nativeStringTrim, value, []);
}

export function egressUrl(value: string | URL): URL {
  assertEgressIntrinsics();
  return new NativeURL(value);
}

export function egressUrlHash(value: URL): string {
  assertEgressIntrinsics();
  return apply(urlHashGetter!, value, []);
}

export function egressUrlHostname(value: URL): string {
  assertEgressIntrinsics();
  return apply(urlHostnameGetter!, value, []);
}

export function egressUrlPassword(value: URL): string {
  assertEgressIntrinsics();
  return apply(urlPasswordGetter!, value, []);
}

export function egressUrlPathname(value: URL): string {
  assertEgressIntrinsics();
  return apply(urlPathnameGetter!, value, []);
}

export function egressUrlPort(value: URL): string {
  assertEgressIntrinsics();
  return apply(urlPortGetter!, value, []);
}

export function egressUrlProtocol(value: URL): string {
  assertEgressIntrinsics();
  return apply(urlProtocolGetter!, value, []);
}

export function egressUrlSearch(value: URL): string {
  assertEgressIntrinsics();
  return apply(urlSearchGetter!, value, []);
}

export function egressUrlToString(value: URL): string {
  assertEgressIntrinsics();
  return apply(urlToString, value, []);
}

export function egressUrlUsername(value: URL): string {
  assertEgressIntrinsics();
  return apply(urlUsernameGetter!, value, []);
}
