import { AsyncLocalStorage } from 'node:async_hooks';

import { capabilityBase64Url, capabilityRandomBytes } from './capability-intrinsics.js';
import {
  assertSecurityWitnessIntrinsics,
  createWitnessMap,
  witnessMapDelete,
  witnessMapGet,
  witnessMapSet,
} from './security-witness-intrinsics.js';

/**
 * Boot-pinned controls for request-local mutation form-helper rendering (SPEC §6.3/§9.2).
 *
 * Dispatch follows plans/good-perf.md D8 (threat model:
 * security/boot-captured-direct-call.md): receiver-insensitive captured statics are called
 * directly and per-receiver methods go through direct callers minted at module init from the
 * boot-captured `Function.prototype.call`/`bind`. No post-boot property lookup and no iterator
 * protocol occur on any dispatch; only the caller-shaped `formHelperApply` keeps the
 * boot-captured `Reflect.apply` (residual R3).
 */

const NativeArray = globalThis.Array;
const NativeAsyncLocalStorage = AsyncLocalStorage;
const NativeFunction = globalThis.Function;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeReflect = globalThis.Reflect;
const NativeString = globalThis.String;

const nativeReflectApply = NativeReflect.apply;
const nativeFunctionCall = NativeFunction.prototype.call;
const nativeFunctionBind = NativeFunction.prototype.bind;
const nativeArrayIsArray = NativeArray.isArray;
const nativeAsyncLocalStorageGetStore = NativeAsyncLocalStorage.prototype.getStore;
const nativeAsyncLocalStorageRun = NativeAsyncLocalStorage.prototype.run;
const nativeFunctionHasInstance = NativeFunction.prototype[Symbol.hasInstance];
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIsFrozen = NativeObject.isFrozen;
const nativeObjectKeys = NativeObject.keys;
const nativePromiseResolve = NativePromise.resolve;
const nativePromiseThen = NativePromise.prototype.then;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringLastIndexOf = NativeString.prototype.lastIndexOf;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;

// Boot-derived direct-caller mint (D8; SPEC §6.6 rule 6). Fixed-arity call sites only — see
// security/boot-captured-direct-call.md R4.
const uncurryThis = nativeReflectApply(nativeFunctionBind, nativeFunctionBind, [
  nativeFunctionCall,
]) as (fn: Function) => (receiver: unknown, ...args: unknown[]) => unknown;

const callAsyncLocalGetStore = uncurryThis(nativeAsyncLocalStorageGetStore) as <Value>(
  storage: AsyncLocalStorage<Value>,
) => Value | undefined;
const callAsyncLocalRun = uncurryThis(nativeAsyncLocalStorageRun) as <Value, Result>(
  storage: AsyncLocalStorage<Value>,
  value: Value,
  render: () => Result,
) => Result;
const callHasInstance = uncurryThis(nativeFunctionHasInstance) as (
  constructor: Function,
  value: unknown,
) => boolean;
const callPromiseThen = uncurryThis(nativePromiseThen) as <Value, Result>(
  promise: Promise<Value>,
  onFulfilled: (value: Value) => Result | PromiseLike<Result>,
  onRejected?: (reason: unknown) => Result | PromiseLike<Result>,
) => Promise<Result>;
const callStringCharCodeAt = uncurryThis(nativeStringCharCodeAt) as (
  value: string,
  index: number,
) => number;
const callStringEndsWith = uncurryThis(nativeStringEndsWith) as (
  value: string,
  search: string,
) => boolean;
const callStringIndexOf = uncurryThis(nativeStringIndexOf) as (
  value: string,
  search: string,
  fromIndex?: number,
) => number;
const callStringLastIndexOf = uncurryThis(nativeStringLastIndexOf) as (
  value: string,
  search: string,
) => number;
const callStringSlice = uncurryThis(nativeStringSlice) as (
  value: string,
  start: number,
  end?: number,
) => string;
const callStringStartsWith = uncurryThis(nativeStringStartsWith) as (
  value: string,
  search: string,
) => boolean;
const callStringToLowerCase = uncurryThis(nativeStringToLowerCase) as (value: string) => string;
// `Promise.resolve` reads `this` as the species constructor, so its receiver is bound at boot
// (security/boot-captured-direct-call.md R2).
const boundPromiseResolve = nativeReflectApply(nativeFunctionBind, nativePromiseResolve, [
  NativePromise,
]) as <Value>(value: Value | PromiseLike<Value>) => Promise<Awaited<Value>>;

function capturedControlsAreSound(): boolean {
  try {
    assertSecurityWitnessIntrinsics();
    if (nativeArrayIsArray([]) !== true) return false;
    if (nativeArrayIsArray({}) !== false) return false;
    if (nativeNumberIsSafeInteger(7) !== true) return false;
    if (nativeNumberIsSafeInteger(7.5) !== false) return false;
    if (callStringIndexOf('safe:12', ':') !== 4) return false;
    if (callStringLastIndexOf('safe:12', ':') !== 4) return false;
    if (callStringSlice('safe:12', 5) !== '12') return false;
    if (callStringCharCodeAt('9', 0) !== 0x39) return false;
    if (callStringEndsWith('target:key', ':key') !== true) return false;
    if (callStringEndsWith('target:other', ':key') !== false) return false;
    if (callStringStartsWith('aria-label', 'aria-') !== true) return false;
    if (callStringStartsWith('data-label', 'aria-') !== false) return false;
    if (callStringToLowerCase('ScRiPt') !== 'script') return false;
    if (!rawSafeElementName('cart-item') || !rawSafeElementName('linearGradient')) return false;
    if (rawSafeElementName('img src=x') || rawSafeElementName('x><script')) return false;

    const proof = { safe: true };
    const descriptor = nativeObjectGetOwnPropertyDescriptor(proof, 'safe');
    if (descriptor === undefined || !('value' in descriptor) || descriptor.value !== true) {
      return false;
    }
    const keys = nativeObjectKeys(proof);
    if (keys.length !== 1 || keys[0] !== 'safe') return false;
    const nullRecord = nativeObjectCreate(null) as Record<PropertyKey, unknown>;
    if (nativeObjectGetPrototypeOf(nullRecord) !== null) return false;
    nativeObjectDefineProperty(nullRecord, 'safe', { value: proof });
    if (ownDataValue(nullRecord, 'safe') !== proof) return false;
    if (nativeObjectFreeze(proof) !== proof || nativeObjectIsFrozen(proof) !== true) {
      return false;
    }

    const promise = boundPromiseResolve('safe');
    if (callHasInstance(NativePromise, promise) !== true) return false;
    const chained = callPromiseThen(promise, (value: string) => value);
    if (callHasInstance(NativePromise, chained) !== true) return false;

    // Prove the genuinely dynamic dispatch shape (`formHelperApply`'s residual R3 path) with
    // positive and negative semantics (security/boot-captured-direct-call.md).
    if (nativeReflectApply(nativeStringToLowerCase, 'ScRiPt', []) !== 'script') return false;
    if (nativeReflectApply(nativeFunctionHasInstance, NativePromise, [{}]) !== false) return false;

    const storage = new NativeAsyncLocalStorage<object>();
    const marker = {};
    let observed: object | undefined;
    callAsyncLocalRun(storage, marker, () => {
      observed = callAsyncLocalGetStore(storage);
    });
    if (observed !== marker || callAsyncLocalGetStore(storage) !== undefined) {
      return false;
    }

    const firstToken = rawToken();
    const secondToken = rawToken();
    return (
      firstToken !== secondToken && isBase64UrlToken(firstToken) && isBase64UrlToken(secondToken)
    );
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertJsxFormHelperIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new TypeError(
      'Kovo JSX form-helper controls are unavailable because server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function formHelperCreateAsyncLocalStorage<Value>(): AsyncLocalStorage<Value> {
  assertJsxFormHelperIntrinsics();
  return new NativeAsyncLocalStorage<Value>();
}

export function formHelperAsyncLocalGetStore<Value>(
  storage: AsyncLocalStorage<Value>,
): Value | undefined {
  assertJsxFormHelperIntrinsics();
  return callAsyncLocalGetStore(storage);
}

export function formHelperAsyncLocalRun<Value, Result>(
  storage: AsyncLocalStorage<Value>,
  value: Value,
  render: () => Result,
): Result {
  assertJsxFormHelperIntrinsics();
  return callAsyncLocalRun(storage, value, render);
}

export function formHelperCreateMap<Key, Value>(): Map<Key, Value> {
  assertJsxFormHelperIntrinsics();
  return createWitnessMap<Key, Value>();
}

export function formHelperMapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  assertJsxFormHelperIntrinsics();
  return witnessMapGet(map, key);
}

export function formHelperMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertJsxFormHelperIntrinsics();
  witnessMapSet(map, key, value);
}

export function formHelperMapDelete<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertJsxFormHelperIntrinsics();
  return witnessMapDelete(map, key);
}

export function formHelperToken(): string {
  assertJsxFormHelperIntrinsics();
  return rawToken();
}

function rawToken(): string {
  return capabilityBase64Url(capabilityRandomBytes(16));
}

function isBase64UrlToken(value: string): boolean {
  if (value.length !== 22) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = callStringCharCodeAt(value, index);
    if (
      !(
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        code === 0x2d ||
        code === 0x5f
      )
    ) {
      return false;
    }
  }
  return true;
}

export function formHelperOwnDataValue(value: object, property: PropertyKey): unknown {
  assertJsxFormHelperIntrinsics();
  return ownDataValue(value, property);
}

function ownDataValue(value: object, property: PropertyKey): unknown {
  const descriptor = nativeObjectGetOwnPropertyDescriptor(value, property);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

export function formHelperSnapshotRecord(
  value: Record<string, unknown>,
  label: string,
): Readonly<Record<string, unknown>> {
  assertJsxFormHelperIntrinsics();
  const snapshot = nativeObjectCreate(null) as Record<string, unknown>;
  const keys = nativeObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const name = keys[index];
    if (name === undefined) continue;
    const descriptor = nativeObjectGetOwnPropertyDescriptor(value, name);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} property ${name} must be an own data value.`);
    }
    nativeObjectDefineProperty(snapshot, name, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return nativeObjectFreeze(snapshot);
}

export function formHelperCreateRecord(): Record<string, unknown> {
  assertJsxFormHelperIntrinsics();
  return nativeObjectCreate(null) as Record<string, unknown>;
}

export function formHelperDefineDataProperty(
  value: Record<string, unknown>,
  property: string,
  propertyValue: unknown,
): void {
  assertJsxFormHelperIntrinsics();
  nativeObjectDefineProperty(value, property, {
    configurable: true,
    enumerable: true,
    value: propertyValue,
    writable: true,
  });
}

export function formHelperDefineArrayValue<Value>(
  values: Value[],
  index: number,
  value: Value,
): void {
  assertJsxFormHelperIntrinsics();
  nativeObjectDefineProperty(values, index, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

export function formHelperObjectKeys(value: object): string[] {
  assertJsxFormHelperIntrinsics();
  return nativeObjectKeys(value);
}

export function formHelperFreeze<Value>(value: Value): Readonly<Value> {
  assertJsxFormHelperIntrinsics();
  return nativeObjectFreeze(value);
}

export function formHelperIsArray(value: unknown): value is unknown[] {
  assertJsxFormHelperIntrinsics();
  return nativeArrayIsArray(value);
}

export function formHelperString(value: unknown): string {
  assertJsxFormHelperIntrinsics();
  return NativeString(value);
}

export function formHelperIsSafeElementName(value: string): boolean {
  assertJsxFormHelperIntrinsics();
  return rawSafeElementName(value);
}

function rawSafeElementName(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = callStringCharCodeAt(value, index);
    const letter = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
    if (index === 0) {
      if (!letter) return false;
      continue;
    }
    if (
      !(
        letter ||
        (code >= 0x30 && code <= 0x39) ||
        code === 0x2d ||
        code === 0x2e ||
        code === 0x3a ||
        code === 0x5f
      )
    ) {
      return false;
    }
  }
  return true;
}

export function formHelperStringIndexOf(value: string, search: string, fromIndex = 0): number {
  assertJsxFormHelperIntrinsics();
  return callStringIndexOf(value, search, fromIndex);
}

export function formHelperStringLastIndexOf(value: string, search: string): number {
  assertJsxFormHelperIntrinsics();
  return callStringLastIndexOf(value, search);
}

export function formHelperStringEndsWith(value: string, search: string): boolean {
  assertJsxFormHelperIntrinsics();
  return callStringEndsWith(value, search);
}

export function formHelperStringStartsWith(value: string, search: string): boolean {
  assertJsxFormHelperIntrinsics();
  return callStringStartsWith(value, search);
}

export function formHelperStringToLowerCase(value: string): string {
  assertJsxFormHelperIntrinsics();
  return callStringToLowerCase(value);
}

export function formHelperAsciiCaseInsensitiveEqual(left: string, right: string): boolean {
  assertJsxFormHelperIntrinsics();
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftCode = callStringCharCodeAt(left, index);
    const rightCode = callStringCharCodeAt(right, index);
    const foldedLeft = leftCode >= 0x41 && leftCode <= 0x5a ? leftCode + 0x20 : leftCode;
    const foldedRight = rightCode >= 0x41 && rightCode <= 0x5a ? rightCode + 0x20 : rightCode;
    if (foldedLeft !== foldedRight) return false;
  }
  return true;
}

export function formHelperStringSlice(value: string, start: number, end?: number): string {
  assertJsxFormHelperIntrinsics();
  return callStringSlice(value, start, end);
}

export function formHelperParseId(value: string): number | undefined {
  assertJsxFormHelperIntrinsics();
  if (value.length === 0) return undefined;
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = callStringCharCodeAt(value, index);
    if (code < 0x30 || code > 0x39) return undefined;
    result = result * 10 + code - 0x30;
    if (!nativeNumberIsSafeInteger(result)) return undefined;
  }
  return result > 0 ? result : undefined;
}

export function formHelperNextId(current: number): number {
  assertJsxFormHelperIntrinsics();
  const next = current + 1;
  if (!nativeNumberIsSafeInteger(next) || next <= 0) {
    throw new TypeError('Kovo JSX form-helper placeholder id space is exhausted.');
  }
  return next;
}

/**
 * Residual dynamic dispatch (security/boot-captured-direct-call.md R3): caller-shaped target and
 * arity stay on the boot-captured `Reflect.apply`.
 */
export function formHelperApply<Return>(
  fn: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertJsxFormHelperIntrinsics();
  return nativeReflectApply(fn, receiver, args) as Return;
}

export function formHelperIsPromise(value: unknown): value is Promise<unknown> {
  assertJsxFormHelperIntrinsics();
  return callHasInstance(NativePromise, value);
}

export function formHelperPromiseThen<Value, Result>(
  promise: Promise<Value>,
  onFulfilled: (value: Value) => Result | PromiseLike<Result>,
  onRejected?: (reason: unknown) => Result | PromiseLike<Result>,
): Promise<Result> {
  assertJsxFormHelperIntrinsics();
  return callPromiseThen(promise, onFulfilled, onRejected);
}

export function formHelperPromiseAll<Value>(
  values: readonly (Value | PromiseLike<Value>)[],
): Promise<Awaited<Value>[]> {
  assertJsxFormHelperIntrinsics();
  return new NativePromise<Awaited<Value>[]>((resolve, reject) => {
    if (values.length === 0) {
      resolve([]);
      return;
    }
    const results = new NativeArray<Awaited<Value>>(values.length);
    let remaining = values.length;
    for (let index = 0; index < values.length; index += 1) {
      const descriptor = nativeObjectGetOwnPropertyDescriptor(values, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        reject(new TypeError('Kovo JSX Promise input must be a dense array of own data values.'));
        return;
      }
      const promise = boundPromiseResolve(descriptor.value as Value | PromiseLike<Value>);
      callPromiseThen(
        promise,
        (result: Awaited<Value>) => {
          formHelperDefineArrayValue(results, index, result);
          remaining -= 1;
          if (remaining === 0) resolve(results);
        },
        reject,
      );
    }
  });
}
