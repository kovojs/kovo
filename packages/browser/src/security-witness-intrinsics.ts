/**
 * Captured intrinsics used by module-private security witnesses.
 *
 * SPEC §6.6: public carrier shape is never the proof. App code can mutate globals and
 * prototypes, so witness registries must not dispatch through ambient collection methods.
 * The private positive/negative controls also make a generically forged pre-import intrinsic
 * fail closed during boot and before each security decision.
 */

const IntrinsicWeakMap = WeakMap;
const IntrinsicWeakSet = WeakSet;
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const IntrinsicArray = Array;
const IntrinsicObject = Object;
const IntrinsicNumber = Number;

const intrinsicReflectApply = Reflect.apply;
const intrinsicWeakMapGet = WeakMap.prototype.get;
const intrinsicWeakMapSet = WeakMap.prototype.set;
const intrinsicWeakMapHas = WeakMap.prototype.has;
const intrinsicWeakMapDelete = WeakMap.prototype.delete;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;
const intrinsicMapGet = Map.prototype.get;
const intrinsicMapSet = Map.prototype.set;
const intrinsicMapHas = Map.prototype.has;
const intrinsicMapDelete = Map.prototype.delete;
const intrinsicMapForEach = Map.prototype.forEach;
const intrinsicSetAdd = Set.prototype.add;
const intrinsicSetHas = Set.prototype.has;
const intrinsicSetDelete = Set.prototype.delete;
const intrinsicSetForEach = Set.prototype.forEach;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectIsFrozen = Object.isFrozen;
const intrinsicObjectIsExtensible = Object.isExtensible;
const intrinsicObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectDefineProperty = Object.defineProperty;
const intrinsicObjectDefineProperties = Object.defineProperties;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectKeys = Object.keys;
const intrinsicObjectHasOwnProperty = Object.prototype.hasOwnProperty;
const intrinsicString = String;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicStringReplaceAll = String.prototype.replaceAll;
const intrinsicStringTrim = String.prototype.trim;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicStringIndexOf = String.prototype.indexOf;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicStringToLowerCase = String.prototype.toLowerCase;
const intrinsicRegExpExec = RegExp.prototype.exec;
const intrinsicJsonParse = JSON.parse;
const intrinsicJsonStringify = JSON.stringify;
const intrinsicFunctionHasInstance = Function.prototype[Symbol.hasInstance];

function invoke<T>(target: (...args: any[]) => unknown, receiver: unknown, args: unknown[]): T {
  return intrinsicReflectApply(target, receiver, args) as T;
}

const weakMapPositiveKeyA = {};
const weakMapPositiveKeyB = () => undefined;
const weakMapNegativeKey = {};
const weakMapValueA = {};
const weakMapValueB = {};
const weakMapControl = new IntrinsicWeakMap<object, object>();
invoke(intrinsicWeakMapSet, weakMapControl, [weakMapPositiveKeyA, weakMapValueA]);
invoke(intrinsicWeakMapSet, weakMapControl, [weakMapPositiveKeyB, weakMapValueB]);

const weakSetPositiveKeyA = {};
const weakSetPositiveKeyB = () => undefined;
const weakSetNegativeKey = {};
const weakSetControl = new IntrinsicWeakSet<object>();
invoke(intrinsicWeakSetAdd, weakSetControl, [weakSetPositiveKeyA]);
invoke(intrinsicWeakSetAdd, weakSetControl, [weakSetPositiveKeyB]);

const mapPositiveKeyA = Symbol('kovo.security.map-control-a');
const mapPositiveKeyB = {};
const mapNegativeKey = Symbol('kovo.security.map-control-negative');
const mapValueA = {};
const mapValueB = {};
const mapControl = new IntrinsicMap<unknown, object>();
invoke(intrinsicMapSet, mapControl, [mapPositiveKeyA, mapValueA]);
invoke(intrinsicMapSet, mapControl, [mapPositiveKeyB, mapValueB]);

const setPositiveValueA = Symbol('kovo.security.set-control-a');
const setPositiveValueB = {};
const setNegativeValue = Symbol('kovo.security.set-control-negative');
const setControl = new IntrinsicSet<unknown>();
invoke(intrinsicSetAdd, setControl, [setPositiveValueA]);
invoke(intrinsicSetAdd, setControl, [setPositiveValueB]);

class HasInstanceControl {}
const hasInstancePositive = new HasInstanceControl();
const hasInstanceNegative = {};

const freezeControl = { marker: {} };
const freezeResult = invoke<object>(intrinsicObjectFreeze, IntrinsicObject, [freezeControl]);
const definePropertiesValue = {};
const definePropertiesControl = {} as { hidden?: object; visible?: object };
const definePropertiesResult = invoke<object>(intrinsicObjectDefineProperties, IntrinsicObject, [
  definePropertiesControl,
  {
    hidden: {
      configurable: false,
      enumerable: false,
      value: definePropertiesValue,
      writable: false,
    },
    visible: {
      configurable: true,
      enumerable: true,
      value: definePropertiesValue,
      writable: true,
    },
  },
]);
const nullRecordControl = invoke<object>(intrinsicObjectCreate, IntrinsicObject, [null]);

function failIntrinsic(name: string): never {
  throw new TypeError(`Kovo security intrinsic integrity check failed: ${name}`);
}

function assertWeakMapIntegrity(): void {
  if (
    invoke(intrinsicWeakMapGet, weakMapControl, [weakMapPositiveKeyA]) !== weakMapValueA ||
    invoke(intrinsicWeakMapGet, weakMapControl, [weakMapPositiveKeyB]) !== weakMapValueB ||
    invoke(intrinsicWeakMapHas, weakMapControl, [weakMapPositiveKeyA]) !== true ||
    invoke(intrinsicWeakMapHas, weakMapControl, [weakMapPositiveKeyB]) !== true ||
    invoke(intrinsicWeakMapHas, weakMapControl, [weakMapNegativeKey]) !== false ||
    invoke(intrinsicWeakMapGet, weakMapControl, [weakMapNegativeKey]) !== undefined
  ) {
    failIntrinsic('WeakMap');
  }
  const deletionControl = new IntrinsicWeakMap<object, object>();
  invoke(intrinsicWeakMapSet, deletionControl, [weakMapPositiveKeyA, weakMapValueA]);
  if (
    invoke(intrinsicWeakMapDelete, deletionControl, [weakMapPositiveKeyA]) !== true ||
    invoke(intrinsicWeakMapDelete, deletionControl, [weakMapNegativeKey]) !== false ||
    invoke(intrinsicWeakMapHas, deletionControl, [weakMapPositiveKeyA]) !== false
  ) {
    failIntrinsic('WeakMap.delete');
  }
}

function assertWeakSetIntegrity(): void {
  if (
    invoke(intrinsicWeakSetHas, weakSetControl, [weakSetPositiveKeyA]) !== true ||
    invoke(intrinsicWeakSetHas, weakSetControl, [weakSetPositiveKeyB]) !== true ||
    invoke(intrinsicWeakSetHas, weakSetControl, [weakSetNegativeKey]) !== false
  ) {
    failIntrinsic('WeakSet');
  }
}

function assertMapIntegrity(): void {
  if (
    invoke(intrinsicMapGet, mapControl, [mapPositiveKeyA]) !== mapValueA ||
    invoke(intrinsicMapGet, mapControl, [mapPositiveKeyB]) !== mapValueB ||
    invoke(intrinsicMapHas, mapControl, [mapPositiveKeyA]) !== true ||
    invoke(intrinsicMapHas, mapControl, [mapPositiveKeyB]) !== true ||
    invoke(intrinsicMapHas, mapControl, [mapNegativeKey]) !== false ||
    invoke(intrinsicMapGet, mapControl, [mapNegativeKey]) !== undefined
  ) {
    failIntrinsic('Map');
  }
  const deletionControl = new IntrinsicMap<unknown, object>();
  invoke(intrinsicMapSet, deletionControl, [mapPositiveKeyA, mapValueA]);
  if (
    invoke(intrinsicMapDelete, deletionControl, [mapPositiveKeyA]) !== true ||
    invoke(intrinsicMapDelete, deletionControl, [mapNegativeKey]) !== false ||
    invoke(intrinsicMapHas, deletionControl, [mapPositiveKeyA]) !== false
  ) {
    failIntrinsic('Map.delete');
  }
  let visited = 0;
  invoke(intrinsicMapForEach, mapControl, [
    (value: object, key: unknown) => {
      if (key === mapPositiveKeyA && value === mapValueA) visited += 1;
      if (key === mapPositiveKeyB && value === mapValueB) visited += 1;
    },
  ]);
  if (visited !== 2) failIntrinsic('Map.forEach');
}

function assertSetIntegrity(): void {
  if (
    invoke(intrinsicSetHas, setControl, [setPositiveValueA]) !== true ||
    invoke(intrinsicSetHas, setControl, [setPositiveValueB]) !== true ||
    invoke(intrinsicSetHas, setControl, [setNegativeValue]) !== false
  ) {
    failIntrinsic('Set');
  }
  let visitedCount = 0;
  let visitedA = false;
  let visitedB = false;
  invoke(intrinsicSetForEach, setControl, [
    (value: unknown) => {
      visitedCount += 1;
      if (value === setPositiveValueA) visitedA = true;
      if (value === setPositiveValueB) visitedB = true;
    },
  ]);
  if (visitedCount !== 2 || !visitedA || !visitedB) failIntrinsic('Set.forEach');
  const deletionControl = new IntrinsicSet<unknown>();
  invoke(intrinsicSetAdd, deletionControl, [setPositiveValueA]);
  if (
    invoke(intrinsicSetDelete, deletionControl, [setPositiveValueA]) !== true ||
    invoke(intrinsicSetDelete, deletionControl, [setNegativeValue]) !== false ||
    invoke(intrinsicSetHas, deletionControl, [setPositiveValueA]) !== false
  ) {
    failIntrinsic('Set.delete');
  }
}

function assertArrayIntegrity(): void {
  if (
    invoke(intrinsicArrayIsArray, IntrinsicArray, [[]]) !== true ||
    invoke(intrinsicArrayIsArray, IntrinsicArray, [{ length: 0 }]) !== false
  ) {
    failIntrinsic('Array.isArray');
  }
}

function assertFreezeIntegrity(): void {
  const marker = invoke<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [freezeControl, 'marker'],
  );
  if (
    freezeResult !== freezeControl ||
    invoke(intrinsicObjectIsFrozen, IntrinsicObject, [freezeControl]) !== true ||
    invoke(intrinsicObjectIsExtensible, IntrinsicObject, [freezeControl]) !== false ||
    marker === undefined ||
    marker.configurable !== false ||
    marker.writable !== false ||
    invoke(intrinsicObjectGetOwnPropertyDescriptor, IntrinsicObject, [freezeControl, 'missing']) !==
      undefined
  ) {
    failIntrinsic('Object.freeze');
  }
}

function assertDefinePropertiesIntegrity(): void {
  const hidden = invoke<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [definePropertiesControl, 'hidden'],
  );
  const visible = invoke<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [definePropertiesControl, 'visible'],
  );
  const keys = invoke<string[]>(intrinsicObjectKeys, IntrinsicObject, [definePropertiesControl]);
  if (
    definePropertiesResult !== definePropertiesControl ||
    hidden?.value !== definePropertiesValue ||
    hidden.configurable !== false ||
    hidden.enumerable !== false ||
    hidden.writable !== false ||
    visible?.value !== definePropertiesValue ||
    visible.configurable !== true ||
    visible.enumerable !== true ||
    visible.writable !== true ||
    keys.length !== 1 ||
    keys[0] !== 'visible' ||
    invoke(intrinsicObjectHasOwnProperty, definePropertiesControl, ['visible']) !== true ||
    invoke(intrinsicObjectHasOwnProperty, definePropertiesControl, ['missing']) !== false ||
    invoke(intrinsicObjectGetPrototypeOf, IntrinsicObject, [nullRecordControl]) !== null
  ) {
    failIntrinsic('Object.defineProperties');
  }
}

function assertStringIntegrity(): void {
  const match = invoke<RegExpExecArray | null>(intrinsicRegExpExec, /^([a-z]+):/, ['https:']);
  if (
    invoke(intrinsicString, undefined, ['kovo-security-control']) !== 'kovo-security-control' ||
    invoke(intrinsicString, undefined, [418]) !== '418' ||
    invoke(IntrinsicNumber, undefined, ['42']) !== 42 ||
    invoke(intrinsicStringReplaceAll, '<&<', ['<', '!']) !== '!&!' ||
    invoke(intrinsicStringTrim, ' \tKovo\n', []) !== 'Kovo' ||
    invoke(intrinsicStringSlice, 'Kovo-security', [5, 13]) !== 'security' ||
    invoke(intrinsicStringIndexOf, 'Kovo-security', ['security', 0]) !== 5 ||
    invoke(intrinsicStringIndexOf, 'Kovo-security', ['missing', 0]) !== -1 ||
    invoke(intrinsicStringCharCodeAt, 'Kovo', [0]) !== 0x4b ||
    invoke(intrinsicStringCharCodeAt, 'Kovo', [99]) ===
      invoke(intrinsicStringCharCodeAt, 'Kovo', [99]) ||
    invoke(intrinsicStringStartsWith, 'kovo/security', ['kovo/', 0]) !== true ||
    invoke(intrinsicStringStartsWith, 'kovo/security', ['security', 0]) !== false ||
    invoke(intrinsicStringToLowerCase, 'JaVaScRiPt', []) !== 'javascript' ||
    match?.[0] !== 'https:' ||
    match[1] !== 'https' ||
    invoke(intrinsicRegExpExec, /^https:/, ['javascript:']) !== null ||
    invoke(intrinsicRegExpExec, /^https:/, ['https://kovo.test']) === null ||
    invoke(intrinsicRegExpExec, /^https:/, ['javascript:']) !== null ||
    invoke(intrinsicJsonStringify, JSON, [{ kovo: 418 }]) !== '{"kovo":418}' ||
    invoke<{ kovo?: unknown }>(intrinsicJsonParse, JSON, ['{"kovo":418}']).kovo !== 418
  ) {
    failIntrinsic('String');
  }
}

function assertHasInstanceIntegrity(): void {
  if (
    invoke(intrinsicFunctionHasInstance, HasInstanceControl, [hasInstancePositive]) !== true ||
    invoke(intrinsicFunctionHasInstance, HasInstanceControl, [hasInstanceNegative]) !== false
  ) {
    failIntrinsic('Function@@hasInstance');
  }
}

function assertNumberIntegrity(): void {
  if (
    invoke(intrinsicNumberIsSafeInteger, IntrinsicNumber, [1]) !== true ||
    invoke(intrinsicNumberIsSafeInteger, IntrinsicNumber, [1.5]) !== false
  ) {
    failIntrinsic('Number.isSafeInteger');
  }
}

const capturedSecurityControlsSound = (() => {
  try {
    assertWeakMapIntegrity();
    assertWeakSetIntegrity();
    assertMapIntegrity();
    assertSetIntegrity();
    assertArrayIntegrity();
    assertFreezeIntegrity();
    assertDefinePropertiesIntegrity();
    assertStringIntegrity();
    assertHasInstanceIntegrity();
    assertNumberIntegrity();
    return true;
  } catch {
    return false;
  }
})();

function assertCapturedSecurityControls(): void {
  if (!capturedSecurityControlsSound) failIntrinsic('captured controls');
}

export function securityWeakMap<K extends object, V>(): WeakMap<K, V> {
  assertCapturedSecurityControls();
  const value = new IntrinsicWeakMap<K, V>();
  if (invoke(intrinsicWeakMapHas, value, [weakMapNegativeKey]) !== false) {
    failIntrinsic('WeakMap constructor');
  }
  return value;
}

export function securityWeakMapGet<K extends object, V>(map: WeakMap<K, V>, key: K): V | undefined {
  assertCapturedSecurityControls();
  return invoke<V | undefined>(intrinsicWeakMapGet, map, [key]);
}

export function securityWeakMapHas<K extends object>(map: WeakMap<K, unknown>, key: K): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicWeakMapHas, map, [key]) === true;
}

export function securityWeakMapSet<K extends object, V>(
  map: WeakMap<K, V>,
  key: K,
  value: V,
): void {
  assertCapturedSecurityControls();
  invoke(intrinsicWeakMapSet, map, [key, value]);
  if (
    invoke(intrinsicWeakMapHas, map, [key]) !== true ||
    invoke(intrinsicWeakMapGet, map, [key]) !== value
  ) {
    failIntrinsic('WeakMap write');
  }
}

export function securityWeakMapDelete<K extends object>(map: WeakMap<K, unknown>, key: K): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicWeakMapDelete, map, [key]) === true;
}

export function securityWeakSet<T extends object>(): WeakSet<T> {
  assertCapturedSecurityControls();
  const value = new IntrinsicWeakSet<T>();
  if (invoke(intrinsicWeakSetHas, value, [weakSetNegativeKey]) !== false) {
    failIntrinsic('WeakSet constructor');
  }
  return value;
}

export function securityWeakSetAdd<T extends object>(set: WeakSet<T>, value: T): void {
  assertCapturedSecurityControls();
  invoke(intrinsicWeakSetAdd, set, [value]);
  if (invoke(intrinsicWeakSetHas, set, [value]) !== true) failIntrinsic('WeakSet write');
}

export function securityWeakSetHas<T extends object>(set: WeakSet<T>, value: T): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicWeakSetHas, set, [value]) === true;
}

export function securityMap<K, V>(): Map<K, V> {
  assertCapturedSecurityControls();
  const value = new IntrinsicMap<K, V>();
  if (invoke(intrinsicMapHas, value, [mapNegativeKey]) !== false) {
    failIntrinsic('Map constructor');
  }
  return value;
}

export function securityMapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  assertCapturedSecurityControls();
  return invoke<V | undefined>(intrinsicMapGet, map, [key]);
}

export function securityMapHas<K>(map: Map<K, unknown>, key: K): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicMapHas, map, [key]) === true;
}

export function securityMapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  assertCapturedSecurityControls();
  invoke(intrinsicMapSet, map, [key, value]);
  if (
    invoke(intrinsicMapHas, map, [key]) !== true ||
    invoke(intrinsicMapGet, map, [key]) !== value
  ) {
    failIntrinsic('Map write');
  }
}

export function securityMapDelete<K>(map: Map<K, unknown>, key: K): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicMapDelete, map, [key]) === true;
}

export function securityMapForEach<K, V>(
  map: ReadonlyMap<K, V>,
  callback: (value: V, key: K) => void,
): void {
  assertCapturedSecurityControls();
  invoke(intrinsicMapForEach, map, [callback]);
}

export function securitySet<T>(): Set<T> {
  assertCapturedSecurityControls();
  const value = new IntrinsicSet<T>();
  if (invoke(intrinsicSetHas, value, [setNegativeValue]) !== false) {
    failIntrinsic('Set constructor');
  }
  return value;
}

export function securitySetAdd<T>(set: Set<T>, value: T): void {
  assertCapturedSecurityControls();
  invoke(intrinsicSetAdd, set, [value]);
  if (invoke(intrinsicSetHas, set, [value]) !== true) failIntrinsic('Set write');
}

export function securitySetHas<T>(set: Set<T>, value: T): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicSetHas, set, [value]) === true;
}

export function securitySetDelete<T>(set: Set<T>, value: T): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicSetDelete, set, [value]) === true;
}

export function securitySetForEach<T>(set: Set<T>, callback: (value: T) => void): void {
  assertCapturedSecurityControls();
  invoke(intrinsicSetForEach, set, [callback]);
}

export function securityArrayIsArray(value: unknown): value is unknown[] {
  assertCapturedSecurityControls();
  return invoke(intrinsicArrayIsArray, IntrinsicArray, [value]) === true;
}

export function freezeSecurityValue<T extends object>(value: T): T {
  assertCapturedSecurityControls();
  const frozen = invoke<T>(intrinsicObjectFreeze, IntrinsicObject, [value]);
  if (frozen !== value || invoke(intrinsicObjectIsFrozen, IntrinsicObject, [value]) !== true) {
    failIntrinsic('Object.freeze result');
  }
  return frozen;
}

export function defineSecurityProperties<T extends object>(
  value: T,
  descriptors: PropertyDescriptorMap,
): T {
  assertCapturedSecurityControls();
  const result = invoke<T>(intrinsicObjectDefineProperties, IntrinsicObject, [value, descriptors]);
  if (result !== value) failIntrinsic('Object.defineProperties');
  return result;
}

export function securityGetOwnPropertyDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  assertCapturedSecurityControls();
  return invoke<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [value, key],
  );
}

export function securityGetPrototypeOf(value: object): object | null {
  assertCapturedSecurityControls();
  return invoke<object | null>(intrinsicObjectGetPrototypeOf, IntrinsicObject, [value]);
}

/** Own-data append for browser security and DOM decision collections (SPEC §6.6/§9.1). */
export function securityArrayAppend<Value>(target: Value[], value: Value, label: string): void {
  assertCapturedSecurityControls();
  const length = securityGetOwnPropertyDescriptor(target, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    !invoke(intrinsicNumberIsSafeInteger, IntrinsicNumber, [length.value]) ||
    length.value < 0 ||
    length.value >= 1_000_000
  ) {
    throw new TypeError(`${label} must have a bounded own array length.`);
  }
  const index = length.value;
  invoke(intrinsicObjectDefineProperty, IntrinsicObject, [
    target,
    index,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
  const committed = securityGetOwnPropertyDescriptor(target, index);
  const after = securityGetOwnPropertyDescriptor(target, 'length');
  if (
    committed === undefined ||
    !('value' in committed) ||
    committed.value !== value ||
    after === undefined ||
    !('value' in after) ||
    after.value !== index + 1
  ) {
    throw new TypeError(`${label} own-data append failed.`);
  }
}

export function securityNullRecord<Value = unknown>(): Record<string, Value> {
  assertCapturedSecurityControls();
  const record = invoke<Record<string, Value>>(intrinsicObjectCreate, IntrinsicObject, [null]);
  if (invoke(intrinsicObjectGetPrototypeOf, IntrinsicObject, [record]) !== null) {
    failIntrinsic('Object.create(null)');
  }
  return record;
}

export function securityObjectKeys(value: object): string[] {
  assertCapturedSecurityControls();
  return invoke<string[]>(intrinsicObjectKeys, IntrinsicObject, [value]);
}

export function securityHasOwn(value: object, key: PropertyKey): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicObjectHasOwnProperty, value, [key]) === true;
}

export function securityString(value: unknown): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicString, undefined, [value]);
}

export function securityNumber(value: unknown): number {
  assertCapturedSecurityControls();
  return invoke(IntrinsicNumber, undefined, [value]);
}

export function securityJsonParse<Value = unknown>(value: string): Value {
  assertCapturedSecurityControls();
  return invoke<Value>(intrinsicJsonParse, JSON, [value]);
}

export function securityJsonStringify(value: unknown): string | undefined {
  assertCapturedSecurityControls();
  return invoke<string | undefined>(intrinsicJsonStringify, JSON, [value]);
}

export function securityStringReplaceAll(
  value: string,
  search: string,
  replacement: string,
): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringReplaceAll, value, [search, replacement]);
}

export function securityStringTrim(value: string): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringTrim, value, []);
}

export function securityStringSlice(value: string, start?: number, end?: number): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringSlice, value, [start, end]);
}

export function securityStringIndexOf(value: string, search: string, fromIndex = 0): number {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringIndexOf, value, [search, fromIndex]);
}

export function securityStringCharCodeAt(value: string, index: number): number {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringCharCodeAt, value, [index]);
}

export function securityStringStartsWith(value: string, search: string, position = 0): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringStartsWith, value, [search, position]) === true;
}

export function securityStringToLowerCase(value: string): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringToLowerCase, value, []);
}

export function securityRegExpExec(pattern: RegExp, value: string): RegExpExecArray | null {
  assertCapturedSecurityControls();
  return invoke(intrinsicRegExpExec, pattern, [value]);
}

export function securityRegExpTest(pattern: RegExp, value: string): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicRegExpExec, pattern, [value]) !== null;
}

export function securityHasInstance(constructor: Function, value: unknown): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicFunctionHasInstance, constructor, [value]) === true;
}

export function securityOwnArrayEntry<T>(
  values: readonly T[],
  index: number,
): { ok: true; value: T } | { ok: false } {
  const descriptor = securityGetOwnPropertyDescriptor(values, index);
  return descriptor !== undefined && 'value' in descriptor
    ? { ok: true, value: descriptor.value as T }
    : { ok: false };
}

export function applySecurityIntrinsic<T>(
  target: (...args: any[]) => unknown,
  receiver: unknown,
  args: unknown[],
): T {
  assertCapturedSecurityControls();
  return invoke<T>(target, receiver, args);
}
