/**
 * Package-private intrinsic membrane for framework authority witnesses.
 *
 * Evaluated application modules share the server realm and can therefore replace collection,
 * Object, or Reflect prototype methods. Security receipts must never dispatch through those
 * mutable globals after application evaluation. This module captures the controls once, proves
 * their basic positive and negative semantics with private identities, and makes every operation
 * fail closed when the captured controls do not satisfy those checks (SPEC §9.5/§10.3).
 *
 * Dispatch mechanism (plans/good-perf.md D8; threat model in
 * security/boot-captured-direct-call.md): post-boot invocations call module-private direct
 * callers minted at module init from the boot-captured `Function.prototype.call`/`bind`
 * (`uncurryThis`), or call receiver-insensitive captured statics directly. Neither form performs
 * an observable property lookup or touches the iterator protocol at invocation time, so the
 * poisoned-`Function.prototype.apply`/`call` and poisoned-iterator threats the previous per-call
 * `Reflect.apply` indirection closed remain closed (SPEC §6.6 rule 6). Only genuinely dynamic
 * targets (`witnessReflectApply`) keep the `Reflect.apply` shape.
 */

const NativeWeakMap = globalThis.WeakMap;
const NativeArray = globalThis.Array;
const NativeWeakSet = globalThis.WeakSet;
const NativeMap = globalThis.Map;
const NativeSet = globalThis.Set;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeProxy = globalThis.Proxy;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeJSON = globalThis.JSON;
const NativeFunction = globalThis.Function;
const nativeEncodeURIComponent = globalThis.encodeURIComponent;
const nativeReflectApply = NativeReflect.apply;
const nativeReflectConstruct = NativeReflect.construct;
const nativeReflectGet = NativeReflect.get;
const nativeReflectOwnKeys = NativeReflect.ownKeys;
const nativeArrayIsArray = NativeArray.isArray;
const nativeArraySort = NativeArray.prototype.sort;
const nativeFunctionCall = NativeFunction.prototype.call;
const nativeFunctionBind = NativeFunction.prototype.bind;
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
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetOwnPropertyDescriptors = NativeObject.getOwnPropertyDescriptors;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIs = NativeObject.is;
const nativeObjectIsFrozen = NativeObject.isFrozen;
const nativeObjectKeys = NativeObject.keys;
const nativeObjectPrototype = NativeObject.prototype;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeMapSize = nativeObjectGetOwnPropertyDescriptor(NativeMap.prototype, 'size')?.get;
const nativeSetSize = nativeObjectGetOwnPropertyDescriptor(NativeSet.prototype, 'size')?.get;
const NativeString = globalThis.String;
const nativeStringReplaceAll = NativeString.prototype.replaceAll;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeJsonStringify = NativeJSON.stringify as (value: unknown) => string | undefined;

/**
 * Boot-derived direct-caller mint (D8): `uncurryThis(fn)` is the boot-captured
 * `Function.prototype.call` bound to `fn`, so `uncurryThis(fn)(receiver, ...args)` invokes the
 * captured `fn` through bound-function internal slots only — no post-boot property lookup, no
 * iterator protocol. Minted through the boot-captured `Reflect.apply` before any
 * caller-controlled module evaluates (SPEC §6.6 rule 6). Fixed-arity call sites only; a spread
 * of caller data would reopen the iterator-poisoning threat and is prohibited
 * (security/boot-captured-direct-call.md R4).
 */
const uncurryThis = nativeReflectApply(nativeFunctionBind, nativeFunctionBind, [
  nativeFunctionCall,
]) as (fn: Function) => (receiver: unknown, ...args: unknown[]) => unknown;

const callWeakMapGet = uncurryThis(nativeWeakMapGet) as <Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
) => Value | undefined;
const callWeakMapHas = uncurryThis(nativeWeakMapHas) as <Key extends object>(
  map: WeakMap<Key, unknown>,
  key: Key,
) => boolean;
const callWeakMapSet = uncurryThis(nativeWeakMapSet) as <Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
  value: Value,
) => WeakMap<Key, Value>;
const callWeakMapDelete = uncurryThis(nativeWeakMapDelete) as <Key extends object>(
  map: WeakMap<Key, unknown>,
  key: Key,
) => boolean;
const callWeakSetAdd = uncurryThis(nativeWeakSetAdd) as <Value extends object>(
  set: WeakSet<Value>,
  value: Value,
) => WeakSet<Value>;
const callWeakSetHas = uncurryThis(nativeWeakSetHas) as <Value extends object>(
  set: WeakSet<Value>,
  value: Value,
) => boolean;
const callWeakSetDelete = uncurryThis(nativeWeakSetDelete) as <Value extends object>(
  set: WeakSet<Value>,
  value: Value,
) => boolean;
const callMapGet = uncurryThis(nativeMapGet) as <Key, Value>(
  map: ReadonlyMap<Key, Value>,
  key: Key,
) => Value | undefined;
const callMapHas = uncurryThis(nativeMapHas) as <Key>(
  map: ReadonlyMap<Key, unknown>,
  key: Key,
) => boolean;
const callMapSet = uncurryThis(nativeMapSet) as <Key, Value>(
  map: Map<Key, Value>,
  key: Key,
  value: Value,
) => Map<Key, Value>;
const callMapDelete = uncurryThis(nativeMapDelete) as <Key>(
  map: Map<Key, unknown>,
  key: Key,
) => boolean;
const callMapForEach = uncurryThis(nativeMapForEach) as <Key, Value>(
  map: ReadonlyMap<Key, Value>,
  callback: (value: Value, key: Key) => void,
) => void;
const callSetAdd = uncurryThis(nativeSetAdd) as <Value>(set: Set<Value>, value: Value) => Set<Value>;
const callSetHas = uncurryThis(nativeSetHas) as <Value>(
  set: ReadonlySet<Value>,
  value: Value,
) => boolean;
const callSetDelete = uncurryThis(nativeSetDelete) as <Value>(
  set: Set<Value>,
  value: Value,
) => boolean;
const callSetForEach = uncurryThis(nativeSetForEach) as <Value>(
  set: ReadonlySet<Value>,
  callback: (value: Value) => void,
) => void;
const callMapSize =
  typeof nativeMapSize === 'function'
    ? (uncurryThis(nativeMapSize) as (map: ReadonlyMap<unknown, unknown>) => number)
    : undefined;
const callSetSize =
  typeof nativeSetSize === 'function'
    ? (uncurryThis(nativeSetSize) as (set: ReadonlySet<unknown>) => number)
    : undefined;
const callArraySort = uncurryThis(nativeArraySort) as <Value>(
  values: Value[],
  compare?: (left: Value, right: Value) => number,
) => Value[];
const callStringReplaceAll = uncurryThis(nativeStringReplaceAll) as (
  value: string,
  searchValue: string | RegExp,
  replaceValue: string | ((substring: string, ...args: unknown[]) => string),
) => string;
const callStringStartsWith = uncurryThis(nativeStringStartsWith) as (
  value: string,
  searchValue: string,
  position?: number,
) => boolean;
const callStringToLowerCase = uncurryThis(nativeStringToLowerCase) as (value: string) => string;
const callRegExpExec = uncurryThis(nativeRegExpExec) as (
  expression: RegExp,
  value: string,
) => RegExpExecArray | null;

function capturedControlsAreSound(): boolean {
  try {
    // The probe corpus exercises the exact boot-derived direct callers and captured statics the
    // runtime dispatches through, so a pre-boot forgery of `Function.prototype.call`/`bind`, a
    // collection prototype method, or a namespace static fails closed here (SPEC §6.6 rule 6).
    if (nativeArrayIsArray([]) !== true) return false;
    if (nativeArrayIsArray({}) !== false) return false;
    if (nativeNumberIsSafeInteger(1) !== true) return false;
    if (nativeNumberIsSafeInteger(1.5) !== false) return false;
    const sorted = ['z', 'a', 'aa'];
    callArraySort(sorted);
    if (sorted[0] !== 'a' || sorted[1] !== 'aa' || sorted[2] !== 'z') return false;
    if (nativeJsonStringify('a"b') !== '"a\\"b"') return false;
    if (nativeJsonStringify(42) !== '42') return false;
    if (nativeJsonStringify(null) !== 'null') return false;
    if (nativeJsonStringify(undefined) !== undefined) return false;
    if (nativeEncodeURIComponent('a#b:c') !== 'a%23b%3Ac') return false;
    const key = {};
    const other = {};
    const value = {};
    class WitnessConstructedValue {
      readonly witness: object;

      constructor(witness: object) {
        this.witness = witness;
      }
    }
    const constructed = nativeReflectConstruct(WitnessConstructedValue, [
      value,
    ]) as WitnessConstructedValue;
    if (
      nativeObjectGetPrototypeOf(constructed) !== WitnessConstructedValue.prototype ||
      constructed.witness !== value
    ) {
      return false;
    }

    const weakMap = new NativeWeakMap<object, object>();
    callWeakMapSet(weakMap, key, value);
    if (callWeakMapGet(weakMap, key) !== value) return false;
    if (callWeakMapGet(weakMap, other) !== undefined) return false;
    if (callWeakMapHas(weakMap, key) !== true) return false;
    if (callWeakMapHas(weakMap, other) !== false) return false;
    if (callWeakMapDelete(weakMap, key) !== true) return false;
    if (callWeakMapHas(weakMap, key) !== false) return false;

    const weakSet = new NativeWeakSet<object>();
    callWeakSetAdd(weakSet, key);
    if (callWeakSetHas(weakSet, key) !== true) return false;
    if (callWeakSetHas(weakSet, other) !== false) return false;
    if (callWeakSetDelete(weakSet, key) !== true) return false;
    if (callWeakSetHas(weakSet, key) !== false) return false;

    const map = new NativeMap<object, object>();
    callMapSet(map, key, value);
    if (callMapGet(map, key) !== value) return false;
    if (callMapGet(map, other) !== undefined) return false;
    if (callMapHas(map, key) !== true) return false;
    if (callMapHas(map, other) !== false) return false;
    if (callMapSize === undefined || callMapSize(map) !== 1) return false;
    let visitedMapEntry = false;
    callMapForEach(map, (entryValue: object, entryKey: object): void => {
      if (entryKey === key && entryValue === value) visitedMapEntry = true;
    });
    if (!visitedMapEntry) return false;
    if (callMapDelete(map, key) !== true) return false;
    if (callMapHas(map, key) !== false) return false;

    const set = new NativeSet<object>();
    callSetAdd(set, key);
    if (callSetHas(set, key) !== true) return false;
    if (callSetHas(set, other) !== false) return false;
    if (callSetSize === undefined || callSetSize(set) !== 1) return false;
    let visitedSetEntry = false;
    callSetForEach(set, (entryValue: object): void => {
      if (entryValue === key) visitedSetEntry = true;
    });
    if (!visitedSetEntry) return false;
    if (callSetDelete(set, key) !== true) return false;
    if (callSetHas(set, key) !== false) return false;

    const record = { visible: value } as { hidden?: object; visible: object };
    const nullRecord = nativeObjectCreate(null) as Record<PropertyKey, unknown>;
    if (nativeObjectGetPrototypeOf(nullRecord) !== null) return false;
    nativeObjectDefineProperty(record, 'hidden', { value });
    const descriptor = nativeObjectGetOwnPropertyDescriptor(record, 'hidden');
    if (descriptor?.value !== value || descriptor.enumerable !== false) return false;
    const descriptors = nativeObjectGetOwnPropertyDescriptors(record);
    if (descriptors.visible?.value !== value || descriptors.hidden?.value !== value) return false;
    const ownKeys = nativeReflectOwnKeys(record);
    const ownKeysLength = nativeObjectGetOwnPropertyDescriptor(ownKeys, 'length');
    if (ownKeysLength === undefined || !('value' in ownKeysLength) || ownKeysLength.value !== 2) {
      return false;
    }
    let sawVisible = false;
    let sawHidden = false;
    for (let index = 0; index < ownKeysLength.value; index += 1) {
      const keyDescriptor = nativeObjectGetOwnPropertyDescriptor(ownKeys, index);
      if (keyDescriptor === undefined || !('value' in keyDescriptor)) return false;
      if (keyDescriptor.value === 'visible') sawVisible = true;
      if (keyDescriptor.value === 'hidden') sawHidden = true;
    }
    if (!sawVisible || !sawHidden) return false;
    const keys = nativeObjectKeys(record);
    const keysLength = nativeObjectGetOwnPropertyDescriptor(keys, 'length');
    const firstKey = nativeObjectGetOwnPropertyDescriptor(keys, 0);
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
    if (nativeReflectGet(record, 'visible', record) !== value) {
      return false;
    }
    const proxy = new NativeProxy(record, {
      get(target, property, receiver) {
        return nativeReflectGet(target, property, receiver);
      },
    });
    if (proxy.visible !== value) return false;
    if (nativeObjectGetPrototypeOf(record) !== nativeObjectPrototype) {
      return false;
    }
    if (nativeObjectIs(value, value) !== true) return false;
    if (nativeObjectIs(value, other) !== false) return false;
    if (NativeString(42) !== '42' || NativeString(null) !== 'null') {
      return false;
    }
    if (callStringReplaceAll('a-b-a', 'a', 'x') !== 'x-b-x') return false;
    if (callStringStartsWith('kovo-control', 'kovo-') !== true) return false;
    if (callStringStartsWith('app-control', 'kovo-') !== false) return false;
    if (callStringToLowerCase('KoVo') !== 'kovo') return false;
    if (callRegExpExec(/^a+$/, 'aaa') === null) return false;
    if (callRegExpExec(/^a+$/, 'a!') !== null) return false;
    // Prove the genuinely dynamic dispatch shape (`witnessReflectApply`'s residual R3 path) with
    // positive and negative semantics: a pre-import Reflect.apply forgery that misroutes a
    // captured control fails closed even though fixed-shape operations no longer route through it.
    if (nativeReflectApply(nativeStringToLowerCase, 'KoVo', []) !== 'kovo') return false;
    if (nativeReflectApply(nativeArrayIsArray, NativeArray, [{}]) !== false) return false;
    if (nativeReflectApply(nativeWeakSetHas, weakSet, [key]) !== false) return false;
    const frozen = nativeObjectFreeze(record);
    if (frozen !== record || nativeObjectIsFrozen(record) !== true) {
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
  return callWeakMapGet(map, key);
}

export function witnessWeakMapHas<Key extends object>(
  map: WeakMap<Key, unknown>,
  key: Key,
): boolean {
  assertSecurityWitnessIntrinsics();
  return callWeakMapHas(map, key);
}

export function witnessWeakMapSet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
  value: Value,
): void {
  assertSecurityWitnessIntrinsics();
  callWeakMapSet(map, key, value);
}

export function witnessWeakMapDelete<Key extends object>(
  map: WeakMap<Key, unknown>,
  key: Key,
): boolean {
  assertSecurityWitnessIntrinsics();
  return callWeakMapDelete(map, key);
}

export function witnessWeakSetHas<Value extends object>(
  set: WeakSet<Value>,
  value: Value,
): boolean {
  assertSecurityWitnessIntrinsics();
  return callWeakSetHas(set, value);
}

export function witnessWeakSetAdd<Value extends object>(set: WeakSet<Value>, value: Value): void {
  assertSecurityWitnessIntrinsics();
  callWeakSetAdd(set, value);
}

export function witnessWeakSetDelete<Value extends object>(
  set: WeakSet<Value>,
  value: Value,
): boolean {
  assertSecurityWitnessIntrinsics();
  return callWeakSetDelete(set, value);
}

export function witnessMapGet<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  key: Key,
): Value | undefined {
  assertSecurityWitnessIntrinsics();
  return callMapGet(map, key);
}

export function witnessMapHas<Key>(map: ReadonlyMap<Key, unknown>, key: Key): boolean {
  assertSecurityWitnessIntrinsics();
  return callMapHas(map, key);
}

export function witnessMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertSecurityWitnessIntrinsics();
  callMapSet(map, key, value);
}

export function witnessMapDelete<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertSecurityWitnessIntrinsics();
  return callMapDelete(map, key);
}

export function witnessMapForEach<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  callback: (value: Value, key: Key) => void,
): void {
  assertSecurityWitnessIntrinsics();
  callMapForEach(map, callback);
}

export function witnessMapSize(map: ReadonlyMap<unknown, unknown>): number {
  assertSecurityWitnessIntrinsics();
  if (callMapSize === undefined) {
    throw new TypeError('Kovo security witness Map size control is unavailable.');
  }
  return callMapSize(map);
}

export function witnessSetHas<Value>(set: ReadonlySet<Value>, value: Value): boolean {
  assertSecurityWitnessIntrinsics();
  return callSetHas(set, value);
}

export function witnessSetAdd<Value>(set: Set<Value>, value: Value): void {
  assertSecurityWitnessIntrinsics();
  callSetAdd(set, value);
}

export function witnessSetDelete<Value>(set: Set<Value>, value: Value): boolean {
  assertSecurityWitnessIntrinsics();
  return callSetDelete(set, value);
}

export function witnessSetSize(set: ReadonlySet<unknown>): number {
  assertSecurityWitnessIntrinsics();
  if (callSetSize === undefined) {
    throw new TypeError('Kovo security witness Set size control is unavailable.');
  }
  return callSetSize(set);
}

export function witnessSetForEach<Value>(
  set: ReadonlySet<Value>,
  callback: (value: Value) => void,
): void {
  assertSecurityWitnessIntrinsics();
  callSetForEach(set, callback);
}

export function witnessGetOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  assertSecurityWitnessIntrinsics();
  return nativeObjectGetOwnPropertyDescriptor(value, property);
}

export function witnessCreateNullRecord<Value = unknown>(): Record<PropertyKey, Value> {
  assertSecurityWitnessIntrinsics();
  return nativeObjectCreate(null) as Record<PropertyKey, Value>;
}

export function witnessCreateWithPrototype<Value extends object>(prototype: object | null): Value {
  assertSecurityWitnessIntrinsics();
  return nativeObjectCreate(prototype) as Value;
}

export function witnessGetOwnPropertyDescriptors(value: object): PropertyDescriptorMap {
  assertSecurityWitnessIntrinsics();
  return nativeObjectGetOwnPropertyDescriptors(value);
}

export function witnessDefineProperty<Value extends object>(
  value: Value,
  property: PropertyKey,
  descriptor: PropertyDescriptor,
): Value {
  assertSecurityWitnessIntrinsics();
  return nativeObjectDefineProperty(value, property, descriptor);
}

export function witnessFreeze<Value>(value: Value): Readonly<Value> {
  assertSecurityWitnessIntrinsics();
  return nativeObjectFreeze(value);
}

export function witnessGetPrototypeOf(value: object): object | null {
  assertSecurityWitnessIntrinsics();
  return nativeObjectGetPrototypeOf(value);
}

export function witnessObjectIs(left: unknown, right: unknown): boolean {
  assertSecurityWitnessIntrinsics();
  return nativeObjectIs(left, right);
}

export function witnessNumberIsSafeInteger(value: unknown): value is number {
  assertSecurityWitnessIntrinsics();
  return nativeNumberIsSafeInteger(value);
}

export function witnessObjectKeys(value: object): string[] {
  assertSecurityWitnessIntrinsics();
  return nativeObjectKeys(value);
}

export function witnessOwnKeys(value: object): PropertyKey[] {
  assertSecurityWitnessIntrinsics();
  return nativeReflectOwnKeys(value);
}

export function witnessReflectGet(
  target: object,
  property: PropertyKey,
  receiver: unknown = target,
): unknown {
  assertSecurityWitnessIntrinsics();
  return nativeReflectGet(target, property, receiver);
}

/**
 * Residual dynamic dispatch (security/boot-captured-direct-call.md R3): the target function and
 * arity are caller-shaped, so this stays on the boot-captured `Reflect.apply`
 * (`CreateListFromArrayLike`, iterator-free). Fixed-shape membrane operations use the minted
 * direct callers instead.
 */
export function witnessReflectApply<Return>(
  target: Function,
  thisArgument: unknown,
  argumentsList: readonly unknown[],
): Return {
  assertSecurityWitnessIntrinsics();
  return nativeReflectApply(target, thisArgument, argumentsList) as Return;
}

export function witnessReflectConstruct<Return extends object>(
  target: Function,
  argumentsList: readonly unknown[],
): Return {
  assertSecurityWitnessIntrinsics();
  return nativeReflectConstruct(target, argumentsList) as Return;
}

export function witnessProxy<Target extends object>(
  target: Target,
  handler: ProxyHandler<Target>,
): Target {
  assertSecurityWitnessIntrinsics();
  return new NativeProxy(target, handler);
}

export function witnessString(value: unknown): string {
  assertSecurityWitnessIntrinsics();
  return NativeString(value);
}

export function witnessIsArray<Value>(
  value: readonly Value[] | ReadonlySet<Value>,
): value is readonly Value[];
export function witnessIsArray(value: unknown): value is unknown[];
export function witnessIsArray(value: unknown): value is unknown[] {
  assertSecurityWitnessIntrinsics();
  return nativeArrayIsArray(value);
}

export function witnessSortStrings(values: string[]): void {
  assertSecurityWitnessIntrinsics();
  callArraySort(values);
}

/** Own-data append for authority-bearing server collections (SPEC §9.5/§10.3). */
export function witnessArrayAppend<Value>(target: Value[], value: Value, label: string): void {
  assertSecurityWitnessIntrinsics();
  const before = nativeObjectGetOwnPropertyDescriptor(target, 'length');
  if (
    before === undefined ||
    !('value' in before) ||
    typeof before.value !== 'number' ||
    !nativeNumberIsSafeInteger(before.value) ||
    before.value < 0 ||
    before.value >= 1_000_000
  ) {
    throw new TypeError(`${label} must have a bounded own array length.`);
  }
  const index = before.value;
  nativeObjectDefineProperty(target, index, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  const committed = nativeObjectGetOwnPropertyDescriptor(target, index);
  const after = nativeObjectGetOwnPropertyDescriptor(target, 'length');
  if (
    committed === undefined ||
    !('value' in committed) ||
    !nativeObjectIs(committed.value, value) ||
    after === undefined ||
    !('value' in after) ||
    after.value !== index + 1
  ) {
    throw new TypeError(`${label} own-data append failed.`);
  }
}

export function witnessJsonStringifyPrimitive(
  value: string | number | boolean | null | undefined,
): string | undefined {
  assertSecurityWitnessIntrinsics();
  return nativeJsonStringify(value);
}

export function witnessEncodeURIComponent(value: string): string {
  assertSecurityWitnessIntrinsics();
  return nativeEncodeURIComponent(value);
}

export function witnessStringReplaceAll(
  value: string,
  searchValue: string | RegExp,
  replaceValue: string | ((substring: string, ...args: unknown[]) => string),
): string {
  assertSecurityWitnessIntrinsics();
  return callStringReplaceAll(value, searchValue, replaceValue);
}

export function witnessStringStartsWith(
  value: string,
  searchValue: string,
  position?: number,
): boolean {
  assertSecurityWitnessIntrinsics();
  return callStringStartsWith(value, searchValue, position);
}

export function witnessStringToLowerCase(value: string): string {
  assertSecurityWitnessIntrinsics();
  return callStringToLowerCase(value);
}

export function witnessRegExpTest(expression: RegExp, value: string): boolean {
  assertSecurityWitnessIntrinsics();
  return callRegExpExec(expression, value) !== null;
}

export function witnessRegExpExec(expression: RegExp, value: string): RegExpExecArray | null {
  assertSecurityWitnessIntrinsics();
  return callRegExpExec(expression, value);
}
