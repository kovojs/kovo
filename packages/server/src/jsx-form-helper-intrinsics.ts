import { AsyncLocalStorage } from 'node:async_hooks';

import { capabilityBase64Url, capabilityRandomBytes } from './capability-intrinsics.js';
import {
  assertSecurityWitnessIntrinsics,
  createWitnessMap,
  witnessMapDelete,
  witnessMapGet,
  witnessMapSet,
  witnessReflectApply,
} from './security-witness-intrinsics.js';

/** Boot-pinned controls for request-local mutation form-helper rendering (SPEC §6.3/§9.2). */

const NativeArray = globalThis.Array;
const NativeAsyncLocalStorage = AsyncLocalStorage;
const NativeFunction = globalThis.Function;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeString = globalThis.String;

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

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return witnessReflectApply<Return>(fn, receiver, args);
}

function capturedControlsAreSound(): boolean {
  try {
    assertSecurityWitnessIntrinsics();
    if (apply(nativeArrayIsArray, NativeArray, [[]]) !== true) return false;
    if (apply(nativeArrayIsArray, NativeArray, [{}]) !== false) return false;
    if (apply(nativeNumberIsSafeInteger, NativeNumber, [7]) !== true) return false;
    if (apply(nativeNumberIsSafeInteger, NativeNumber, [7.5]) !== false) return false;
    if (apply(nativeStringIndexOf, 'safe:12', [':']) !== 4) return false;
    if (apply(nativeStringLastIndexOf, 'safe:12', [':']) !== 4) return false;
    if (apply(nativeStringSlice, 'safe:12', [5]) !== '12') return false;
    if (apply(nativeStringCharCodeAt, '9', [0]) !== 0x39) return false;
    if (apply(nativeStringEndsWith, 'target:key', [':key']) !== true) return false;
    if (apply(nativeStringEndsWith, 'target:other', [':key']) !== false) return false;
    if (apply(nativeStringStartsWith, 'aria-label', ['aria-']) !== true) return false;
    if (apply(nativeStringStartsWith, 'data-label', ['aria-']) !== false) return false;
    if (apply(nativeStringToLowerCase, 'ScRiPt', []) !== 'script') return false;
    if (!rawSafeElementName('cart-item') || !rawSafeElementName('linearGradient')) return false;
    if (rawSafeElementName('img src=x') || rawSafeElementName('x><script')) return false;

    const proof = { safe: true };
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [proof, 'safe'],
    );
    if (descriptor === undefined || !('value' in descriptor) || descriptor.value !== true) {
      return false;
    }
    const keys = apply<string[]>(nativeObjectKeys, NativeObject, [proof]);
    if (keys.length !== 1 || keys[0] !== 'safe') return false;
    const nullRecord = apply<Record<PropertyKey, unknown>>(nativeObjectCreate, NativeObject, [
      null,
    ]);
    if (apply(nativeObjectGetPrototypeOf, NativeObject, [nullRecord]) !== null) return false;
    apply(nativeObjectDefineProperty, NativeObject, [nullRecord, 'safe', { value: proof }]);
    if (ownDataValue(nullRecord, 'safe') !== proof) return false;
    if (
      apply(nativeObjectFreeze, NativeObject, [proof]) !== proof ||
      apply(nativeObjectIsFrozen, NativeObject, [proof]) !== true
    ) {
      return false;
    }

    const promise = apply<Promise<string>>(nativePromiseResolve, NativePromise, ['safe']);
    if (apply(nativeFunctionHasInstance, NativePromise, [promise]) !== true) return false;
    const chained = apply<Promise<string>>(nativePromiseThen, promise, [(value: string) => value]);
    if (apply(nativeFunctionHasInstance, NativePromise, [chained]) !== true) return false;

    const storage = new NativeAsyncLocalStorage<object>();
    const marker = {};
    let observed: object | undefined;
    apply(nativeAsyncLocalStorageRun, storage, [
      marker,
      () => {
        observed = apply(nativeAsyncLocalStorageGetStore, storage, []);
      },
    ]);
    if (observed !== marker || apply(nativeAsyncLocalStorageGetStore, storage, []) !== undefined) {
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
  return apply(nativeAsyncLocalStorageGetStore, storage, []);
}

export function formHelperAsyncLocalRun<Value, Result>(
  storage: AsyncLocalStorage<Value>,
  value: Value,
  render: () => Result,
): Result {
  assertJsxFormHelperIntrinsics();
  return apply(nativeAsyncLocalStorageRun, storage, [value, render]);
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
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
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
  const descriptor = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [value, property],
  );
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

export function formHelperSnapshotRecord(
  value: Record<string, unknown>,
  label: string,
): Readonly<Record<string, unknown>> {
  assertJsxFormHelperIntrinsics();
  const snapshot = apply<Record<string, unknown>>(nativeObjectCreate, NativeObject, [null]);
  const keys = apply<string[]>(nativeObjectKeys, NativeObject, [value]);
  for (let index = 0; index < keys.length; index += 1) {
    const name = keys[index];
    if (name === undefined) continue;
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [value, name],
    );
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} property ${name} must be an own data value.`);
    }
    apply(nativeObjectDefineProperty, NativeObject, [
      snapshot,
      name,
      {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false,
      },
    ]);
  }
  return apply(nativeObjectFreeze, NativeObject, [snapshot]);
}

export function formHelperCreateRecord(): Record<string, unknown> {
  assertJsxFormHelperIntrinsics();
  return apply(nativeObjectCreate, NativeObject, [null]);
}

export function formHelperDefineDataProperty(
  value: Record<string, unknown>,
  property: string,
  propertyValue: unknown,
): void {
  assertJsxFormHelperIntrinsics();
  apply(nativeObjectDefineProperty, NativeObject, [
    value,
    property,
    {
      configurable: true,
      enumerable: true,
      value: propertyValue,
      writable: true,
    },
  ]);
}

export function formHelperDefineArrayValue<Value>(
  values: Value[],
  index: number,
  value: Value,
): void {
  assertJsxFormHelperIntrinsics();
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

export function formHelperObjectKeys(value: object): string[] {
  assertJsxFormHelperIntrinsics();
  return apply(nativeObjectKeys, NativeObject, [value]);
}

export function formHelperFreeze<Value>(value: Value): Readonly<Value> {
  assertJsxFormHelperIntrinsics();
  return apply(nativeObjectFreeze, NativeObject, [value]);
}

export function formHelperIsArray(value: unknown): value is unknown[] {
  assertJsxFormHelperIntrinsics();
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function formHelperString(value: unknown): string {
  assertJsxFormHelperIntrinsics();
  return apply(NativeString, undefined, [value]);
}

export function formHelperIsSafeElementName(value: string): boolean {
  assertJsxFormHelperIntrinsics();
  return rawSafeElementName(value);
}

function rawSafeElementName(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
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
  return apply(nativeStringIndexOf, value, [search, fromIndex]);
}

export function formHelperStringLastIndexOf(value: string, search: string): number {
  assertJsxFormHelperIntrinsics();
  return apply(nativeStringLastIndexOf, value, [search]);
}

export function formHelperStringEndsWith(value: string, search: string): boolean {
  assertJsxFormHelperIntrinsics();
  return apply(nativeStringEndsWith, value, [search]);
}

export function formHelperStringStartsWith(value: string, search: string): boolean {
  assertJsxFormHelperIntrinsics();
  return apply(nativeStringStartsWith, value, [search]);
}

export function formHelperStringToLowerCase(value: string): string {
  assertJsxFormHelperIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function formHelperAsciiCaseInsensitiveEqual(left: string, right: string): boolean {
  assertJsxFormHelperIntrinsics();
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftCode = apply<number>(nativeStringCharCodeAt, left, [index]);
    const rightCode = apply<number>(nativeStringCharCodeAt, right, [index]);
    const foldedLeft = leftCode >= 0x41 && leftCode <= 0x5a ? leftCode + 0x20 : leftCode;
    const foldedRight = rightCode >= 0x41 && rightCode <= 0x5a ? rightCode + 0x20 : rightCode;
    if (foldedLeft !== foldedRight) return false;
  }
  return true;
}

export function formHelperStringSlice(value: string, start: number, end?: number): string {
  assertJsxFormHelperIntrinsics();
  return end === undefined
    ? apply(nativeStringSlice, value, [start])
    : apply(nativeStringSlice, value, [start, end]);
}

export function formHelperParseId(value: string): number | undefined {
  assertJsxFormHelperIntrinsics();
  if (value.length === 0) return undefined;
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    if (code < 0x30 || code > 0x39) return undefined;
    result = result * 10 + code - 0x30;
    if (!apply(nativeNumberIsSafeInteger, NativeNumber, [result])) return undefined;
  }
  return result > 0 ? result : undefined;
}

export function formHelperNextId(current: number): number {
  assertJsxFormHelperIntrinsics();
  const next = current + 1;
  if (!apply(nativeNumberIsSafeInteger, NativeNumber, [next]) || next <= 0) {
    throw new TypeError('Kovo JSX form-helper placeholder id space is exhausted.');
  }
  return next;
}

export function formHelperApply<Return>(
  fn: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertJsxFormHelperIntrinsics();
  return apply(fn, receiver, args);
}

export function formHelperIsPromise(value: unknown): value is Promise<unknown> {
  assertJsxFormHelperIntrinsics();
  return apply(nativeFunctionHasInstance, NativePromise, [value]);
}

export function formHelperPromiseThen<Value, Result>(
  promise: Promise<Value>,
  onFulfilled: (value: Value) => Result | PromiseLike<Result>,
  onRejected?: (reason: unknown) => Result | PromiseLike<Result>,
): Promise<Result> {
  assertJsxFormHelperIntrinsics();
  return apply(nativePromiseThen, promise, [onFulfilled, onRejected]);
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
      const descriptor = apply<PropertyDescriptor | undefined>(
        nativeObjectGetOwnPropertyDescriptor,
        NativeObject,
        [values, index],
      );
      if (descriptor === undefined || !('value' in descriptor)) {
        reject(new TypeError('Kovo JSX Promise input must be a dense array of own data values.'));
        return;
      }
      const promise = apply<Promise<Awaited<Value>>>(nativePromiseResolve, NativePromise, [
        descriptor.value,
      ]);
      apply(nativePromiseThen, promise, [
        (result: Awaited<Value>) => {
          formHelperDefineArrayValue(results, index, result);
          remaining -= 1;
          if (remaining === 0) resolve(results);
        },
        reject,
      ]);
    }
  });
}
