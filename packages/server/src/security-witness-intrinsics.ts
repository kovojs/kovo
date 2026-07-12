/**
 * Package-private intrinsic membrane for framework authority witnesses.
 *
 * Evaluated application modules share the server realm and can therefore replace collection,
 * Object, or Reflect prototype methods. Security receipts must never dispatch through those
 * mutable globals after application evaluation. This module captures the controls once, proves
 * their basic positive and negative semantics with private identities, and makes every operation
 * fail closed when the captured controls do not satisfy those checks (SPEC §9.5/§10.3).
 */

const NativeWeakMap = globalThis.WeakMap;
const NativeArray = globalThis.Array;
const NativeWeakSet = globalThis.WeakSet;
const NativeMap = globalThis.Map;
const NativeSet = globalThis.Set;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const nativeReflectApply = NativeReflect.apply;
const nativeReflectGet = NativeReflect.get;
const nativeReflectOwnKeys = NativeReflect.ownKeys;
const nativeArrayIsArray = NativeArray.isArray;
const nativeWeakMapGet = NativeWeakMap.prototype.get;
const nativeWeakMapHas = NativeWeakMap.prototype.has;
const nativeWeakMapSet = NativeWeakMap.prototype.set;
const nativeWeakMapDelete = NativeWeakMap.prototype.delete;
const nativeWeakSetAdd = NativeWeakSet.prototype.add;
const nativeWeakSetHas = NativeWeakSet.prototype.has;
const nativeWeakSetDelete = NativeWeakSet.prototype.delete;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapHas = NativeMap.prototype.has;
const nativeMapSet = NativeMap.prototype.set;
const nativeMapDelete = NativeMap.prototype.delete;
const nativeMapForEach = NativeMap.prototype.forEach;
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetHas = NativeSet.prototype.has;
const nativeSetDelete = NativeSet.prototype.delete;
const nativeSetForEach = NativeSet.prototype.forEach;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetOwnPropertyDescriptors = NativeObject.getOwnPropertyDescriptors;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIs = NativeObject.is;
const nativeObjectIsFrozen = NativeObject.isFrozen;
const nativeObjectKeys = NativeObject.keys;
const nativeObjectPrototype = NativeObject.prototype;
const nativeMapSize = apply<PropertyDescriptor | undefined>(
  nativeObjectGetOwnPropertyDescriptor,
  NativeObject,
  [NativeMap.prototype, 'size'],
)?.get;
const nativeSetSize = apply<PropertyDescriptor | undefined>(
  nativeObjectGetOwnPropertyDescriptor,
  NativeObject,
  [NativeSet.prototype, 'size'],
)?.get;
const NativeString = globalThis.String;
const nativeStringReplaceAll = NativeString.prototype.replaceAll;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeRegExpTest = NativeRegExp.prototype.test;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function capturedControlsAreSound(): boolean {
  try {
    if (apply(nativeArrayIsArray, NativeArray, [[]]) !== true) return false;
    if (apply(nativeArrayIsArray, NativeArray, [{}]) !== false) return false;
    const key = {};
    const other = {};
    const value = {};

    const weakMap = new NativeWeakMap<object, object>();
    apply(nativeWeakMapSet, weakMap, [key, value]);
    if (apply(nativeWeakMapGet, weakMap, [key]) !== value) return false;
    if (apply(nativeWeakMapGet, weakMap, [other]) !== undefined) return false;
    if (apply(nativeWeakMapHas, weakMap, [key]) !== true) return false;
    if (apply(nativeWeakMapHas, weakMap, [other]) !== false) return false;
    if (apply(nativeWeakMapDelete, weakMap, [key]) !== true) return false;
    if (apply(nativeWeakMapHas, weakMap, [key]) !== false) return false;

    const weakSet = new NativeWeakSet<object>();
    apply(nativeWeakSetAdd, weakSet, [key]);
    if (apply(nativeWeakSetHas, weakSet, [key]) !== true) return false;
    if (apply(nativeWeakSetHas, weakSet, [other]) !== false) return false;
    if (apply(nativeWeakSetDelete, weakSet, [key]) !== true) return false;
    if (apply(nativeWeakSetHas, weakSet, [key]) !== false) return false;

    const map = new NativeMap<object, object>();
    apply(nativeMapSet, map, [key, value]);
    if (apply(nativeMapGet, map, [key]) !== value) return false;
    if (apply(nativeMapGet, map, [other]) !== undefined) return false;
    if (apply(nativeMapHas, map, [key]) !== true) return false;
    if (apply(nativeMapHas, map, [other]) !== false) return false;
    if (typeof nativeMapSize !== 'function' || apply(nativeMapSize, map, []) !== 1) return false;
    let visitedMapEntry = false;
    apply(nativeMapForEach, map, [
      (entryValue: object, entryKey: object): void => {
        if (entryKey === key && entryValue === value) visitedMapEntry = true;
      },
    ]);
    if (!visitedMapEntry) return false;
    if (apply(nativeMapDelete, map, [key]) !== true) return false;
    if (apply(nativeMapHas, map, [key]) !== false) return false;

    const set = new NativeSet<object>();
    apply(nativeSetAdd, set, [key]);
    if (apply(nativeSetHas, set, [key]) !== true) return false;
    if (apply(nativeSetHas, set, [other]) !== false) return false;
    if (typeof nativeSetSize !== 'function' || apply(nativeSetSize, set, []) !== 1) return false;
    let visitedSetEntry = false;
    apply(nativeSetForEach, set, [
      (entryValue: object): void => {
        if (entryValue === key) visitedSetEntry = true;
      },
    ]);
    if (!visitedSetEntry) return false;
    if (apply(nativeSetDelete, set, [key]) !== true) return false;
    if (apply(nativeSetHas, set, [key]) !== false) return false;

    const record = { visible: value } as { hidden?: object; visible: object };
    apply(nativeObjectDefineProperty, NativeObject, [record, 'hidden', { value }]);
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [record, 'hidden'],
    );
    if (descriptor?.value !== value || descriptor.enumerable !== false) return false;
    const descriptors = apply<PropertyDescriptorMap>(
      nativeObjectGetOwnPropertyDescriptors,
      NativeObject,
      [record],
    );
    if (descriptors.visible?.value !== value || descriptors.hidden?.value !== value) return false;
    const ownKeys = apply<PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [record]);
    const ownKeysLength = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [ownKeys, 'length'],
    );
    if (ownKeysLength === undefined || !('value' in ownKeysLength) || ownKeysLength.value !== 2) {
      return false;
    }
    let sawVisible = false;
    let sawHidden = false;
    for (let index = 0; index < ownKeysLength.value; index += 1) {
      const keyDescriptor = apply<PropertyDescriptor | undefined>(
        nativeObjectGetOwnPropertyDescriptor,
        NativeObject,
        [ownKeys, index],
      );
      if (keyDescriptor === undefined || !('value' in keyDescriptor)) return false;
      if (keyDescriptor.value === 'visible') sawVisible = true;
      if (keyDescriptor.value === 'hidden') sawHidden = true;
    }
    if (!sawVisible || !sawHidden) return false;
    const keys = apply<string[]>(nativeObjectKeys, NativeObject, [record]);
    const keysLength = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [keys, 'length'],
    );
    const firstKey = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [keys, 0],
    );
    if (
      keysLength === undefined ||
      !('value' in keysLength) ||
      keysLength.value !== 1 ||
      firstKey === undefined ||
      !('value' in firstKey) ||
      firstKey.value !== 'visible'
    ) {
      return false;
    }
    if (apply(nativeReflectGet, NativeReflect, [record, 'visible', record]) !== value) {
      return false;
    }
    if (apply(nativeObjectGetPrototypeOf, NativeObject, [record]) !== nativeObjectPrototype) {
      return false;
    }
    if (apply(nativeObjectIs, NativeObject, [value, value]) !== true) return false;
    if (apply(nativeObjectIs, NativeObject, [value, other]) !== false) return false;
    if (
      apply(NativeString, undefined, [42]) !== '42' ||
      apply(NativeString, undefined, [null]) !== 'null'
    ) {
      return false;
    }
    if (apply(nativeStringReplaceAll, 'a-b-a', ['a', 'x']) !== 'x-b-x') return false;
    if (apply(nativeStringStartsWith, 'kovo-control', ['kovo-']) !== true) return false;
    if (apply(nativeStringStartsWith, 'app-control', ['kovo-']) !== false) return false;
    if (apply(nativeStringToLowerCase, 'KoVo', []) !== 'kovo') return false;
    if (apply(nativeRegExpTest, /^a+$/, ['aaa']) !== true) return false;
    if (apply(nativeRegExpTest, /^a+$/, ['a!']) !== false) return false;
    const frozen = apply<object>(nativeObjectFreeze, NativeObject, [record]);
    if (frozen !== record || apply(nativeObjectIsFrozen, NativeObject, [record]) !== true) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertSecurityWitnessIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new TypeError(
      'Kovo security witness controls are unavailable because the server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function createWitnessWeakMap<Key extends object, Value>(): WeakMap<Key, Value> {
  assertSecurityWitnessIntrinsics();
  return new NativeWeakMap<Key, Value>();
}

export function createWitnessWeakSet<Value extends object>(): WeakSet<Value> {
  assertSecurityWitnessIntrinsics();
  return new NativeWeakSet<Value>();
}

export function createWitnessMap<Key, Value>(): Map<Key, Value> {
  assertSecurityWitnessIntrinsics();
  return new NativeMap<Key, Value>();
}

export function createWitnessSet<Value>(): Set<Value> {
  assertSecurityWitnessIntrinsics();
  return new NativeSet<Value>();
}

export function witnessWeakMapGet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
): Value | undefined {
  assertSecurityWitnessIntrinsics();
  return apply(nativeWeakMapGet, map, [key]);
}

export function witnessWeakMapHas<Key extends object>(
  map: WeakMap<Key, unknown>,
  key: Key,
): boolean {
  assertSecurityWitnessIntrinsics();
  return apply(nativeWeakMapHas, map, [key]);
}

export function witnessWeakMapSet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
  value: Value,
): void {
  assertSecurityWitnessIntrinsics();
  apply(nativeWeakMapSet, map, [key, value]);
}

export function witnessWeakMapDelete<Key extends object>(
  map: WeakMap<Key, unknown>,
  key: Key,
): boolean {
  assertSecurityWitnessIntrinsics();
  return apply(nativeWeakMapDelete, map, [key]);
}

export function witnessWeakSetHas<Value extends object>(
  set: WeakSet<Value>,
  value: Value,
): boolean {
  assertSecurityWitnessIntrinsics();
  return apply(nativeWeakSetHas, set, [value]);
}

export function witnessWeakSetAdd<Value extends object>(set: WeakSet<Value>, value: Value): void {
  assertSecurityWitnessIntrinsics();
  apply(nativeWeakSetAdd, set, [value]);
}

export function witnessWeakSetDelete<Value extends object>(
  set: WeakSet<Value>,
  value: Value,
): boolean {
  assertSecurityWitnessIntrinsics();
  return apply(nativeWeakSetDelete, set, [value]);
}

export function witnessMapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  assertSecurityWitnessIntrinsics();
  return apply(nativeMapGet, map, [key]);
}

export function witnessMapHas<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertSecurityWitnessIntrinsics();
  return apply(nativeMapHas, map, [key]);
}

export function witnessMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertSecurityWitnessIntrinsics();
  apply(nativeMapSet, map, [key, value]);
}

export function witnessMapDelete<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertSecurityWitnessIntrinsics();
  return apply(nativeMapDelete, map, [key]);
}

export function witnessMapForEach<Key, Value>(
  map: Map<Key, Value>,
  callback: (value: Value, key: Key) => void,
): void {
  assertSecurityWitnessIntrinsics();
  apply(nativeMapForEach, map, [callback]);
}

export function witnessMapSize(map: Map<unknown, unknown>): number {
  assertSecurityWitnessIntrinsics();
  if (typeof nativeMapSize !== 'function') {
    throw new TypeError('Kovo security witness Map size control is unavailable.');
  }
  return apply(nativeMapSize, map, []);
}

export function witnessSetHas<Value>(set: Set<Value>, value: Value): boolean {
  assertSecurityWitnessIntrinsics();
  return apply(nativeSetHas, set, [value]);
}

export function witnessSetAdd<Value>(set: Set<Value>, value: Value): void {
  assertSecurityWitnessIntrinsics();
  apply(nativeSetAdd, set, [value]);
}

export function witnessSetDelete<Value>(set: Set<Value>, value: Value): boolean {
  assertSecurityWitnessIntrinsics();
  return apply(nativeSetDelete, set, [value]);
}

export function witnessSetSize(set: Set<unknown>): number {
  assertSecurityWitnessIntrinsics();
  if (typeof nativeSetSize !== 'function') {
    throw new TypeError('Kovo security witness Set size control is unavailable.');
  }
  return apply(nativeSetSize, set, []);
}

export function witnessSetForEach<Value>(set: Set<Value>, callback: (value: Value) => void): void {
  assertSecurityWitnessIntrinsics();
  apply(nativeSetForEach, set, [callback]);
}

export function witnessGetOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  assertSecurityWitnessIntrinsics();
  return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
}

export function witnessGetOwnPropertyDescriptors(value: object): PropertyDescriptorMap {
  assertSecurityWitnessIntrinsics();
  return apply(nativeObjectGetOwnPropertyDescriptors, NativeObject, [value]);
}

export function witnessDefineProperty<Value extends object>(
  value: Value,
  property: PropertyKey,
  descriptor: PropertyDescriptor,
): Value {
  assertSecurityWitnessIntrinsics();
  return apply(nativeObjectDefineProperty, NativeObject, [value, property, descriptor]);
}

export function witnessFreeze<Value>(value: Value): Readonly<Value> {
  assertSecurityWitnessIntrinsics();
  return apply(nativeObjectFreeze, NativeObject, [value]);
}

export function witnessGetPrototypeOf(value: object): object | null {
  assertSecurityWitnessIntrinsics();
  return apply(nativeObjectGetPrototypeOf, NativeObject, [value]);
}

export function witnessObjectIs(left: unknown, right: unknown): boolean {
  assertSecurityWitnessIntrinsics();
  return apply(nativeObjectIs, NativeObject, [left, right]);
}

export function witnessObjectKeys(value: object): string[] {
  assertSecurityWitnessIntrinsics();
  return apply(nativeObjectKeys, NativeObject, [value]);
}

export function witnessOwnKeys(value: object): PropertyKey[] {
  assertSecurityWitnessIntrinsics();
  return apply(nativeReflectOwnKeys, NativeReflect, [value]);
}

export function witnessReflectGet(
  target: object,
  property: PropertyKey,
  receiver: unknown = target,
): unknown {
  assertSecurityWitnessIntrinsics();
  return apply(nativeReflectGet, NativeReflect, [target, property, receiver]);
}

export function witnessReflectApply<Return>(
  target: Function,
  thisArgument: unknown,
  argumentsList: readonly unknown[],
): Return {
  assertSecurityWitnessIntrinsics();
  return apply(target, thisArgument, argumentsList);
}

export function witnessString(value: unknown): string {
  assertSecurityWitnessIntrinsics();
  return apply(NativeString, undefined, [value]);
}

export function witnessIsArray(value: unknown): value is unknown[] {
  assertSecurityWitnessIntrinsics();
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function witnessStringReplaceAll(
  value: string,
  searchValue: string | RegExp,
  replaceValue: string | ((substring: string, ...args: unknown[]) => string),
): string {
  assertSecurityWitnessIntrinsics();
  return apply(nativeStringReplaceAll, value, [searchValue, replaceValue]);
}

export function witnessStringStartsWith(
  value: string,
  searchValue: string,
  position?: number,
): boolean {
  assertSecurityWitnessIntrinsics();
  return apply(nativeStringStartsWith, value, [searchValue, position]);
}

export function witnessStringToLowerCase(value: string): string {
  assertSecurityWitnessIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function witnessRegExpTest(expression: RegExp, value: string): boolean {
  assertSecurityWitnessIntrinsics();
  return apply(nativeRegExpTest, expression, [value]);
}
