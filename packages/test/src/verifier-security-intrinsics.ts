/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked via pinned Reflect.apply. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { types as NodeUtilTypes } from 'node:util';

/**
 * Package-private, descriptor-witnessed controls for the SPEC §11 verifier.
 *
 * Test applications execute in the verifier's realm and may replace ambient constructors or
 * prototype methods.  Every operation that decides what the harness observed is therefore
 * captured before application code runs and dispatched through Reflect.apply.  The controls below
 * intentionally are not part of the @kovojs/test public surface.
 */

const NativeArray = globalThis.Array;
const NativeAsyncLocalStorage = AsyncLocalStorage;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeProxy = globalThis.Proxy;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeRequest = globalThis.Request;
const NativeResponse = globalThis.Response;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const NativeURL = globalThis.URL;
const NativeWeakMap = globalThis.WeakMap;

const nativeReflectApply = NativeReflect.apply;
const nativeReflectGet = NativeReflect.get;
const nativeReflectOwnKeys = NativeReflect.ownKeys;
const nativeArrayIsArray = NativeArray.isArray;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeArraySlice = NativeArray.prototype.slice;
const nativeArraySort = NativeArray.prototype.sort;
const nativeJsonStringify = NativeJSON.stringify;
const nativeMapForEach = NativeMap.prototype.forEach;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapHas = NativeMap.prototype.has;
const nativeMapSet = NativeMap.prototype.set;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIsExtensible = NativeObject.isExtensible;
const nativeObjectIsFrozen = NativeObject.isFrozen;
const nativeObjectKeys = NativeObject.keys;
const nativeAsyncFunctionPrototype = apply<object>(nativeObjectGetPrototypeOf, NativeObject, [
  async function verifierAsyncFunctionControl(): Promise<void> {},
]);
const nativePromiseResolve = NativePromise.resolve;
const nativePromiseThen = NativePromise.prototype.then;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetClear = NativeSet.prototype.clear;
const nativeSetDelete = NativeSet.prototype.delete;
const nativeSetForEach = NativeSet.prototype.forEach;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringReplaceAll = NativeString.prototype.replaceAll;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringTrim = NativeString.prototype.trim;
const nativeUtilIsPromise = NodeUtilTypes.isPromise;
const nativeUtilIsProxy = NodeUtilTypes.isProxy;
const nativeWeakMapGet = NativeWeakMap.prototype.get;
const nativeWeakMapHas = NativeWeakMap.prototype.has;
const nativeWeakMapSet = NativeWeakMap.prototype.set;
const nativeMapSize = stableOwnGetter(NativeMap.prototype, 'size');
const nativeSetSize = stableOwnGetter(NativeSet.prototype, 'size');
const nativeRequestUrl = stableOwnGetter(NativeRequest.prototype, 'url');
const nativeUrlHref = stableOwnGetter(NativeURL.prototype, 'href');
const nativeUrlOrigin = stableOwnGetter(NativeURL.prototype, 'origin');
const nativeUrlPassword = stableOwnGetter(NativeURL.prototype, 'password');
const nativeUrlPathname = stableOwnGetter(NativeURL.prototype, 'pathname');
const nativeUrlUsername = stableOwnGetter(NativeURL.prototype, 'username');
const nativeAsyncStorageGetStore = stableOwnFunction(NativeAsyncLocalStorage.prototype, 'getStore');
const nativeAsyncStorageRun = stableOwnFunction(NativeAsyncLocalStorage.prototype, 'run');

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function stableOwnFunction(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [owner, property],
    );
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new NativeTypeError(`Kovo verifier control ${String(property)} is unavailable.`);
      }
      return descriptor.value;
    }
    owner = apply<object | null>(nativeObjectGetPrototypeOf, NativeObject, [owner]);
  }
  throw new NativeTypeError(`Kovo verifier control ${String(property)} is unavailable.`);
}

function stableOwnGetter(value: object, property: PropertyKey): Function {
  const descriptor = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [value, property],
  );
  if (typeof descriptor?.get !== 'function') {
    throw new NativeTypeError(`Kovo verifier getter ${String(property)} is unavailable.`);
  }
  return descriptor.get;
}

function capturedControlsAreSound(): boolean {
  try {
    const target = { safe: 7 };
    const proxy = new NativeProxy(target, {
      get(inner, property, receiver) {
        return apply(nativeReflectGet, NativeReflect, [inner, property, receiver]);
      },
    });
    const weakKey = {};
    const weakValue = {};
    const weak = new NativeWeakMap<object, object>();
    apply(nativeWeakMapSet, weak, [weakKey, weakValue]);
    const map = new NativeMap<unknown, unknown>();
    apply(nativeMapSet, map, ['safe', 11]);
    const set = new NativeSet<unknown>();
    apply(nativeSetAdd, set, ['safe']);
    const array = ['b', 'a'];
    apply(nativeArraySort, array, [(left: string, right: string) => (left < right ? -1 : 1)]);
    const scope = { safe: true };
    const storage = new NativeAsyncLocalStorage<object>();
    let observedScope: object | undefined;
    apply(nativeAsyncStorageRun, storage, [
      scope,
      () => {
        observedScope = apply(nativeAsyncStorageGetStore, storage, []);
      },
    ]);
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [target, 'safe'],
    );
    const response = new NativeResponse('safe', { status: 201 });
    const request = new NativeRequest('https://example.test/safe?value=1');
    const url = new NativeURL('https://example.test/safe?value=1');
    const promise = apply<Promise<void>>(nativePromiseResolve, NativePromise, [undefined]);
    return (
      proxy.safe === 7 &&
      apply(nativeUtilIsProxy, NodeUtilTypes, [proxy]) === true &&
      apply(nativeUtilIsProxy, NodeUtilTypes, [target]) === false &&
      apply(nativeUtilIsPromise, NodeUtilTypes, [promise]) === true &&
      apply(nativeUtilIsPromise, NodeUtilTypes, [{}]) === false &&
      apply(nativeWeakMapHas, weak, [weakKey]) === true &&
      apply(nativeWeakMapGet, weak, [weakKey]) === weakValue &&
      apply(nativeMapHas, map, ['safe']) === true &&
      apply(nativeMapGet, map, ['safe']) === 11 &&
      apply(nativeSetHas, set, ['safe']) === true &&
      apply(nativeArrayJoin, array, [',']) === 'a,b' &&
      apply(nativeJsonStringify, NativeJSON, [{ safe: 7 }]) === '{"safe":7}' &&
      apply(nativeRequestUrl, request, []) === 'https://example.test/safe?value=1' &&
      apply(nativeUrlPathname, url, []) === '/safe' &&
      response.status === 201 &&
      observedScope === scope &&
      descriptor !== undefined &&
      'value' in descriptor &&
      descriptor.value === 7 &&
      apply(nativeObjectGetPrototypeOf, NativeObject, [async function asyncControl() {}]) ===
        nativeAsyncFunctionPrototype &&
      apply(nativeStringTrim, ' safe ', []) === 'safe' &&
      apply<RegExpExecArray | null>(nativeRegExpExec, /^safe$/u, ['safe'])?.[0] === 'safe'
    );
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertVerifierSecurityIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new NativeTypeError(
      'Kovo DB verification controls are unavailable because realm intrinsics were modified before framework initialization.',
    );
  }
}

export function verifierApply<Return>(
  fn: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertVerifierSecurityIntrinsics();
  return apply<Return>(fn, receiver, args);
}

export function verifierProxy<T extends object>(target: T, handler: ProxyHandler<T>): T {
  assertVerifierSecurityIntrinsics();
  return new NativeProxy(target, handler);
}

export function verifierResponse(body?: BodyInit | null, init?: ResponseInit): Response {
  assertVerifierSecurityIntrinsics();
  return new NativeResponse(body, init);
}

export function verifierTypeError(message: string): TypeError {
  assertVerifierSecurityIntrinsics();
  return new NativeTypeError(message);
}

export function verifierWeakMap<K extends object, V>(): WeakMap<K, V> {
  assertVerifierSecurityIntrinsics();
  return new NativeWeakMap<K, V>();
}

export function verifierWeakMapGet<K extends object, V>(map: WeakMap<K, V>, key: K): V | undefined {
  assertVerifierSecurityIntrinsics();
  return apply(nativeWeakMapGet, map, [key]);
}

export function verifierWeakMapSet<K extends object, V>(
  map: WeakMap<K, V>,
  key: K,
  value: V,
): void {
  assertVerifierSecurityIntrinsics();
  apply(nativeWeakMapSet, map, [key, value]);
  if (
    apply(nativeWeakMapHas, map, [key]) !== true ||
    apply(nativeWeakMapGet, map, [key]) !== value
  ) {
    throw new NativeTypeError('Kovo verifier WeakMap integrity check failed.');
  }
}

export function verifierMap<K, V>(): Map<K, V> {
  assertVerifierSecurityIntrinsics();
  return new NativeMap<K, V>();
}

export function verifierMapGet<K, V>(map: ReadonlyMap<K, V>, key: K): V | undefined {
  assertVerifierSecurityIntrinsics();
  return apply(nativeMapGet, map, [key]);
}

export function verifierMapHas<K>(map: ReadonlyMap<K, unknown>, key: K): boolean {
  assertVerifierSecurityIntrinsics();
  return apply(nativeMapHas, map, [key]) === true;
}

export function verifierMapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  assertVerifierSecurityIntrinsics();
  apply(nativeMapSet, map, [key, value]);
  if (apply(nativeMapHas, map, [key]) !== true || apply(nativeMapGet, map, [key]) !== value) {
    throw new NativeTypeError('Kovo verifier Map integrity check failed.');
  }
}

export function verifierMapSize(map: ReadonlyMap<unknown, unknown>): number {
  assertVerifierSecurityIntrinsics();
  return apply(nativeMapSize, map, []);
}

export function verifierMapForEach<K, V>(
  map: ReadonlyMap<K, V>,
  callback: (value: V, key: K) => void,
): void {
  assertVerifierSecurityIntrinsics();
  apply(nativeMapForEach, map, [callback]);
}

export function verifierSet<T>(): Set<T> {
  assertVerifierSecurityIntrinsics();
  return new NativeSet<T>();
}

export function verifierSetAdd<T>(set: Set<T>, value: T): void {
  assertVerifierSecurityIntrinsics();
  apply(nativeSetAdd, set, [value]);
  if (apply(nativeSetHas, set, [value]) !== true) {
    throw new NativeTypeError('Kovo verifier Set integrity check failed.');
  }
}

export function verifierSetHas<T>(set: ReadonlySet<T>, value: T): boolean {
  assertVerifierSecurityIntrinsics();
  return apply(nativeSetHas, set, [value]) === true;
}

export function verifierSetDelete<T>(set: Set<T>, value: T): boolean {
  assertVerifierSecurityIntrinsics();
  return apply(nativeSetDelete, set, [value]) === true;
}

export function verifierSetClear(set: Set<unknown>): void {
  assertVerifierSecurityIntrinsics();
  apply(nativeSetClear, set, []);
  if (apply(nativeSetSize, set, []) !== 0) {
    throw new NativeTypeError('Kovo verifier Set.clear integrity check failed.');
  }
}

export function verifierSetForEach<T>(set: ReadonlySet<T>, callback: (value: T) => void): void {
  assertVerifierSecurityIntrinsics();
  apply(nativeSetForEach, set, [callback]);
}

export function verifierSetSize(set: ReadonlySet<unknown>): number {
  assertVerifierSecurityIntrinsics();
  return apply(nativeSetSize, set, []);
}

export function verifierSetValues<T>(set: ReadonlySet<T>): T[] {
  assertVerifierSecurityIntrinsics();
  const values: T[] = [];
  apply(nativeSetForEach, set, [(value: T) => verifierArrayPush(values, value)]);
  return values;
}

export function verifierReflectGet(
  target: object,
  property: PropertyKey,
  receiver: unknown,
): unknown {
  assertVerifierSecurityIntrinsics();
  return apply(nativeReflectGet, NativeReflect, [target, property, receiver]);
}

export function verifierOwnKeys(value: object): (string | symbol)[] {
  assertVerifierSecurityIntrinsics();
  return apply(nativeReflectOwnKeys, NativeReflect, [value]);
}

export function verifierObjectKeys(value: object): string[] {
  assertVerifierSecurityIntrinsics();
  return apply(nativeObjectKeys, NativeObject, [value]);
}

export function verifierGetOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  assertVerifierSecurityIntrinsics();
  return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
}

export function verifierGetPrototypeOf(value: object): object | null {
  assertVerifierSecurityIntrinsics();
  return apply(nativeObjectGetPrototypeOf, NativeObject, [value]);
}

export function verifierIsExtensible(value: object): boolean {
  assertVerifierSecurityIntrinsics();
  return apply(nativeObjectIsExtensible, NativeObject, [value]) === true;
}

export function verifierIsAsyncFunction(value: unknown): value is Function {
  assertVerifierSecurityIntrinsics();
  return (
    typeof value === 'function' &&
    apply(nativeObjectGetPrototypeOf, NativeObject, [value]) === nativeAsyncFunctionPrototype
  );
}

export function verifierStableMethod(value: object, property: PropertyKey): Function {
  assertVerifierSecurityIntrinsics();
  return stableOwnFunction(value, property);
}

export function verifierNullRecord<Value = unknown>(): Record<string, Value> {
  assertVerifierSecurityIntrinsics();
  return apply(nativeObjectCreate, NativeObject, [null]);
}

export function verifierDefineProperty<T extends object>(
  value: T,
  property: PropertyKey,
  descriptor: PropertyDescriptor,
): T {
  assertVerifierSecurityIntrinsics();
  return apply(nativeObjectDefineProperty, NativeObject, [value, property, descriptor]);
}

export function verifierFreeze<T extends object>(value: T): Readonly<T> {
  assertVerifierSecurityIntrinsics();
  const frozen = apply<T>(nativeObjectFreeze, NativeObject, [value]);
  if (frozen !== value || apply(nativeObjectIsFrozen, NativeObject, [value]) !== true) {
    throw new NativeTypeError('Kovo verifier Object.freeze integrity check failed.');
  }
  return frozen;
}

export function verifierIsArray(value: unknown): value is unknown[] {
  assertVerifierSecurityIntrinsics();
  return apply(nativeArrayIsArray, NativeArray, [value]) === true;
}

export function verifierIsProxy(value: unknown): boolean {
  assertVerifierSecurityIntrinsics();
  return apply(nativeUtilIsProxy, NodeUtilTypes, [value]) === true;
}

export function verifierIsPromise(value: unknown): value is Promise<unknown> {
  assertVerifierSecurityIntrinsics();
  return apply(nativeUtilIsPromise, NodeUtilTypes, [value]) === true;
}

export function verifierArrayPush<T>(values: T[], value: T): number {
  assertVerifierSecurityIntrinsics();
  const lengthDescriptor = verifierGetOwnPropertyDescriptor(values, 'length');
  const length =
    lengthDescriptor !== undefined && 'value' in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
  if (
    typeof length !== 'number' ||
    !apply(nativeNumberIsSafeInteger, NativeNumber, [length]) ||
    length < 0 ||
    length >= 1_000_000
  ) {
    throw new NativeTypeError('Kovo verifier array append requires a bounded stable length.');
  }
  apply(nativeObjectDefineProperty, NativeObject, [
    values,
    length,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
  const committed = verifierGetOwnPropertyDescriptor(values, String(length));
  if (committed === undefined || !('value' in committed) || committed.value !== value) {
    throw new NativeTypeError('Kovo verifier array append failed its own-data commit.');
  }
  return length + 1;
}

export function verifierArraySlice<T>(values: readonly T[], start = 0, end?: number): T[] {
  assertVerifierSecurityIntrinsics();
  return end === undefined
    ? apply(nativeArraySlice, values, [start])
    : apply(nativeArraySlice, values, [start, end]);
}

export function verifierArrayJoin(values: readonly unknown[], separator: string): string {
  assertVerifierSecurityIntrinsics();
  return apply(nativeArrayJoin, values, [separator]);
}

export function verifierArraySort<T>(values: T[], compare: (left: T, right: T) => number): T[] {
  assertVerifierSecurityIntrinsics();
  return apply(nativeArraySort, values, [compare]);
}

export function verifierJsonStringify(value: unknown): string | undefined {
  assertVerifierSecurityIntrinsics();
  return apply(nativeJsonStringify, NativeJSON, [value]);
}

export function verifierDenseArraySnapshot<T>(
  value: unknown,
  label: string,
  snapshot: (entry: unknown, index: number) => T,
): readonly T[] {
  if (!verifierIsArray(value)) throw new NativeTypeError(`${label} must be an array.`);
  const lengthDescriptor = verifierGetOwnPropertyDescriptor(value, 'length');
  const length =
    lengthDescriptor !== undefined && 'value' in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
  if (
    typeof length !== 'number' ||
    !apply(nativeNumberIsSafeInteger, NativeNumber, [length]) ||
    length < 0
  ) {
    throw new NativeTypeError(`${label} must have a stable array length.`);
  }
  const copy: T[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = verifierGetOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new NativeTypeError(`${label} requires dense stable own-data entries.`);
    }
    verifierArrayPush(copy, snapshot(descriptor.value, index));
  }
  return verifierFreeze(copy);
}

export function verifierString(value: unknown): string {
  assertVerifierSecurityIntrinsics();
  return apply(NativeString, undefined, [value]);
}

export function verifierNumber(value: unknown): number {
  assertVerifierSecurityIntrinsics();
  return apply(NativeNumber, undefined, [value]);
}

export function verifierStringEndsWith(value: string, search: string): boolean {
  assertVerifierSecurityIntrinsics();
  return apply(nativeStringEndsWith, value, [search]) === true;
}

export function verifierStringIndexOf(value: string, search: string, position = 0): number {
  assertVerifierSecurityIntrinsics();
  return apply(nativeStringIndexOf, value, [search, position]);
}

export function verifierStringIncludes(value: string, search: string, position = 0): boolean {
  assertVerifierSecurityIntrinsics();
  return apply(nativeStringIncludes, value, [search, position]) === true;
}

export function verifierStringReplaceAll(
  value: string,
  search: string,
  replacement: string,
): string {
  assertVerifierSecurityIntrinsics();
  return apply(nativeStringReplaceAll, value, [search, replacement]);
}

export function verifierStringSlice(value: string, start: number, end?: number): string {
  assertVerifierSecurityIntrinsics();
  return end === undefined
    ? apply(nativeStringSlice, value, [start])
    : apply(nativeStringSlice, value, [start, end]);
}

export function verifierStringSplit(value: string, separator: string | RegExp): string[] {
  assertVerifierSecurityIntrinsics();
  return apply(nativeStringSplit, value, [separator]);
}

export function verifierStringStartsWith(value: string, search: string, position = 0): boolean {
  assertVerifierSecurityIntrinsics();
  return apply(nativeStringStartsWith, value, [search, position]) === true;
}

export function verifierStringToLowerCase(value: string): string {
  assertVerifierSecurityIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function verifierStringTrim(value: string): string {
  assertVerifierSecurityIntrinsics();
  return apply(nativeStringTrim, value, []);
}

export function verifierRegExpExec(pattern: RegExp, value: string): RegExpExecArray | null {
  assertVerifierSecurityIntrinsics();
  return apply(nativeRegExpExec, pattern, [value]);
}

export function verifierRequestUrl(request: Request): string {
  assertVerifierSecurityIntrinsics();
  return apply(nativeRequestUrl, request, []);
}

export function verifierUrlPathname(input: string, base?: string): string {
  assertVerifierSecurityIntrinsics();
  const url = base === undefined ? new NativeURL(input) : new NativeURL(input, base);
  return apply(nativeUrlPathname, url, []);
}

export function verifierUrlSnapshot(
  input: string,
  base?: string,
): Readonly<{ href: string; origin: string; password: string; username: string }> {
  assertVerifierSecurityIntrinsics();
  const url = base === undefined ? new NativeURL(input) : new NativeURL(input, base);
  return verifierFreeze({
    href: apply<string>(nativeUrlHref, url, []),
    origin: apply<string>(nativeUrlOrigin, url, []),
    password: apply<string>(nativeUrlPassword, url, []),
    username: apply<string>(nativeUrlUsername, url, []),
  });
}

export function verifierPromiseResolve<T>(value: T | PromiseLike<T>): Promise<T> {
  assertVerifierSecurityIntrinsics();
  return apply(nativePromiseResolve, NativePromise, [value]);
}

export function verifierPromise<T>(
  executor: (
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  assertVerifierSecurityIntrinsics();
  return new NativePromise<T>(executor);
}

export function verifierPromiseThen<T, Result>(
  value: Promise<T>,
  onFulfilled: (value: T) => Result | PromiseLike<Result>,
): Promise<Result> {
  assertVerifierSecurityIntrinsics();
  return apply(nativePromiseThen, value, [onFulfilled]);
}

/** Await the three concurrent operations used by the integration login boundary. */
export function verifierPromiseAll3(
  first: PromiseLike<unknown>,
  second: PromiseLike<unknown>,
  third: PromiseLike<unknown>,
): Promise<void> {
  assertVerifierSecurityIntrinsics();
  return new NativePromise<void>((resolve, reject) => {
    let remaining = 3;
    const fulfilled = (): void => {
      remaining -= 1;
      if (remaining === 0) resolve();
    };
    const observe = (value: PromiseLike<unknown>): void => {
      const promise = apply<Promise<unknown>>(nativePromiseResolve, NativePromise, [value]);
      apply(nativePromiseThen, promise, [fulfilled, reject]);
    };
    observe(first);
    observe(second);
    observe(third);
  });
}

export function verifierAsyncStorage<Store>(): AsyncLocalStorage<Store> {
  assertVerifierSecurityIntrinsics();
  return new NativeAsyncLocalStorage<Store>();
}

export function verifierAsyncStorageRun<Store, Result>(
  storage: AsyncLocalStorage<Store>,
  store: Store,
  callback: () => Result,
): Result {
  assertVerifierSecurityIntrinsics();
  return apply(nativeAsyncStorageRun, storage, [store, callback]);
}

export function verifierAsyncStorageGetStore<Store>(
  storage: AsyncLocalStorage<Store>,
): Store | undefined {
  assertVerifierSecurityIntrinsics();
  return apply(nativeAsyncStorageGetStore, storage, []);
}
