/**
 * Captured intrinsics for module-private proof registries (SPEC §6.6).
 *
 * Security decisions never dispatch through mutable ambient collection prototypes. Private
 * positive and negative controls make generic pre-import poisoning fail closed at boot and before
 * each witness operation.
 */

const IntrinsicWeakMap = WeakMap;
const IntrinsicWeakSet = WeakSet;
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const IntrinsicObject = Object;
const IntrinsicArray = Array;
const IntrinsicError = Error;

const intrinsicReflectApply = Reflect.apply;
const intrinsicWeakMapGet = WeakMap.prototype.get;
const intrinsicWeakMapSet = WeakMap.prototype.set;
const intrinsicWeakMapHas = WeakMap.prototype.has;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;
const intrinsicWeakSetDelete = WeakSet.prototype.delete;
const intrinsicMapGet = Map.prototype.get;
const intrinsicMapSet = Map.prototype.set;
const intrinsicMapHas = Map.prototype.has;
const intrinsicMapDelete = Map.prototype.delete;
const intrinsicMapForEach = Map.prototype.forEach;
const intrinsicSetAdd = Set.prototype.add;
const intrinsicSetHas = Set.prototype.has;
const intrinsicSetDelete = Set.prototype.delete;
const intrinsicSetForEach = Set.prototype.forEach;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectIsFrozen = Object.isFrozen;
const intrinsicObjectIsExtensible = Object.isExtensible;
const intrinsicObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectDefineProperty = Object.defineProperty;
const intrinsicObjectHasOwnProperty = Object.prototype.hasOwnProperty;
const intrinsicObjectPropertyIsEnumerable = Object.prototype.propertyIsEnumerable;
const intrinsicObjectKeys = Object.keys;
const intrinsicObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const intrinsicObjectIs = Object.is;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicString = String;
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

const freezeControl = { marker: {} };
const freezeResult = invoke<object>(intrinsicObjectFreeze, IntrinsicObject, [freezeControl]);
const objectControlValue = {};
const objectControlSymbol = Symbol('kovo.security.object-control');
const objectControl = {
  visible: objectControlValue,
  [objectControlSymbol]: objectControlValue,
} as {
  hidden?: object;
  visible: object;
  [objectControlSymbol]: object;
};
const definePropertyResult = invoke<object>(intrinsicObjectDefineProperty, IntrinsicObject, [
  objectControl,
  'hidden',
  { configurable: false, enumerable: false, value: objectControlValue, writable: false },
]);
const nullPrototypeControl = { __proto__: null } as object;
class HasInstanceControl {}
const hasInstancePositive = new HasInstanceControl();
const hasInstanceNegative = {};

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
}

function assertWeakSetIntegrity(): void {
  if (
    invoke(intrinsicWeakSetHas, weakSetControl, [weakSetPositiveKeyA]) !== true ||
    invoke(intrinsicWeakSetHas, weakSetControl, [weakSetPositiveKeyB]) !== true ||
    invoke(intrinsicWeakSetHas, weakSetControl, [weakSetNegativeKey]) !== false
  ) {
    failIntrinsic('WeakSet');
  }
  const deletionControl = new IntrinsicWeakSet<object>();
  invoke(intrinsicWeakSetAdd, deletionControl, [weakSetPositiveKeyA]);
  if (
    invoke(intrinsicWeakSetDelete, deletionControl, [weakSetPositiveKeyA]) !== true ||
    invoke(intrinsicWeakSetDelete, deletionControl, [weakSetNegativeKey]) !== false ||
    invoke(intrinsicWeakSetHas, deletionControl, [weakSetPositiveKeyA]) !== false
  ) {
    failIntrinsic('WeakSet.delete');
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
  let visitedCount = 0;
  let visitedA = false;
  let visitedB = false;
  invoke(intrinsicMapForEach, mapControl, [
    (value: object, key: unknown) => {
      visitedCount += 1;
      if (key === mapPositiveKeyA && value === mapValueA) visitedA = true;
      if (key === mapPositiveKeyB && value === mapValueB) visitedB = true;
    },
  ]);
  if (visitedCount !== 2 || !visitedA || !visitedB) {
    failIntrinsic('Map.forEach');
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
  if (visitedCount !== 2 || !visitedA || !visitedB) {
    failIntrinsic('Set.forEach');
  }
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
    marker.writable !== false
  ) {
    failIntrinsic('Object.freeze');
  }
}

function assertObjectIntegrity(): void {
  const visible = invoke<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [objectControl, 'visible'],
  );
  const hidden = invoke<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [objectControl, 'hidden'],
  );
  const missing = invoke<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [objectControl, 'missing'],
  );
  const keys = invoke<string[]>(intrinsicObjectKeys, IntrinsicObject, [objectControl]);
  const symbols = invoke<symbol[]>(intrinsicObjectGetOwnPropertySymbols, IntrinsicObject, [
    objectControl,
  ]);
  if (
    definePropertyResult !== objectControl ||
    visible?.value !== objectControlValue ||
    hidden?.value !== objectControlValue ||
    hidden.enumerable !== false ||
    missing !== undefined ||
    invoke(intrinsicObjectGetPrototypeOf, IntrinsicObject, [objectControl]) !==
      IntrinsicObject.prototype ||
    invoke(intrinsicObjectGetPrototypeOf, IntrinsicObject, [nullPrototypeControl]) !== null ||
    invoke(intrinsicObjectHasOwnProperty, objectControl, ['visible']) !== true ||
    invoke(intrinsicObjectHasOwnProperty, objectControl, ['missing']) !== false ||
    invoke(intrinsicObjectPropertyIsEnumerable, objectControl, ['visible']) !== true ||
    invoke(intrinsicObjectPropertyIsEnumerable, objectControl, ['hidden']) !== false ||
    invoke(intrinsicObjectIs, IntrinsicObject, [objectControlValue, objectControlValue]) !== true ||
    invoke(intrinsicObjectIs, IntrinsicObject, [objectControlValue, objectControl]) !== false ||
    keys.length !== 1 ||
    keys[0] !== 'visible' ||
    symbols.length !== 1 ||
    symbols[0] !== objectControlSymbol ||
    invoke(intrinsicArrayIsArray, IntrinsicArray, [[]]) !== true ||
    invoke(intrinsicArrayIsArray, IntrinsicArray, [objectControl]) !== false
  ) {
    failIntrinsic('Object/Array');
  }
}

function assertHasInstanceIntegrity(): void {
  if (
    invoke(intrinsicFunctionHasInstance, HasInstanceControl, [hasInstancePositive]) !== true ||
    invoke(intrinsicFunctionHasInstance, HasInstanceControl, [hasInstanceNegative]) !== false ||
    invoke(intrinsicFunctionHasInstance, IntrinsicMap, [mapControl]) !== true ||
    invoke(intrinsicFunctionHasInstance, IntrinsicMap, [setControl]) !== false ||
    invoke(intrinsicFunctionHasInstance, IntrinsicSet, [setControl]) !== true ||
    invoke(intrinsicFunctionHasInstance, IntrinsicSet, [mapControl]) !== false ||
    invoke(intrinsicFunctionHasInstance, IntrinsicError, [new IntrinsicError('control')]) !==
      true ||
    invoke(intrinsicFunctionHasInstance, IntrinsicError, [objectControl]) !== false
  ) {
    failIntrinsic('Function@@hasInstance');
  }
}

function assertStringIntegrity(): void {
  if (
    invoke(intrinsicString, undefined, ['kovo-security-control']) !== 'kovo-security-control' ||
    invoke(intrinsicString, undefined, [422]) !== '422'
  ) {
    failIntrinsic('String');
  }
}

assertWeakMapIntegrity();
assertWeakSetIntegrity();
assertMapIntegrity();
assertSetIntegrity();
assertFreezeIntegrity();
assertObjectIntegrity();
assertStringIntegrity();
assertHasInstanceIntegrity();

export function securityWeakMap<K extends object, V>(): WeakMap<K, V> {
  assertWeakMapIntegrity();
  const value = new IntrinsicWeakMap<K, V>();
  if (invoke(intrinsicWeakMapHas, value, [weakMapNegativeKey]) !== false) {
    failIntrinsic('WeakMap constructor');
  }
  return value;
}

export function securityWeakMapGet<K extends object, V>(map: WeakMap<K, V>, key: K): V | undefined {
  assertWeakMapIntegrity();
  return invoke<V | undefined>(intrinsicWeakMapGet, map, [key]);
}

export function securityWeakMapHas<K extends object>(map: WeakMap<K, unknown>, key: K): boolean {
  assertWeakMapIntegrity();
  return invoke(intrinsicWeakMapHas, map, [key]) === true;
}

export function securityWeakMapSet<K extends object, V>(
  map: WeakMap<K, V>,
  key: K,
  value: V,
): void {
  assertWeakMapIntegrity();
  invoke(intrinsicWeakMapSet, map, [key, value]);
  if (
    invoke(intrinsicWeakMapHas, map, [key]) !== true ||
    invoke(intrinsicWeakMapGet, map, [key]) !== value
  ) {
    failIntrinsic('WeakMap write');
  }
}

export function securityWeakSet<T extends object>(): WeakSet<T> {
  assertWeakSetIntegrity();
  const value = new IntrinsicWeakSet<T>();
  if (invoke(intrinsicWeakSetHas, value, [weakSetNegativeKey]) !== false) {
    failIntrinsic('WeakSet constructor');
  }
  return value;
}

export function securityWeakSetAdd<T extends object>(set: WeakSet<T>, value: T): void {
  assertWeakSetIntegrity();
  invoke(intrinsicWeakSetAdd, set, [value]);
  if (invoke(intrinsicWeakSetHas, set, [value]) !== true) failIntrinsic('WeakSet write');
}

export function securityWeakSetHas<T extends object>(set: WeakSet<T>, value: T): boolean {
  assertWeakSetIntegrity();
  return invoke(intrinsicWeakSetHas, set, [value]) === true;
}

export function securityWeakSetDelete<T extends object>(set: WeakSet<T>, value: T): boolean {
  assertWeakSetIntegrity();
  return invoke(intrinsicWeakSetDelete, set, [value]) === true;
}

export function securityMap<K, V>(): Map<K, V> {
  assertMapIntegrity();
  return new IntrinsicMap<K, V>();
}

export function securityMapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  assertMapIntegrity();
  return invoke<V | undefined>(intrinsicMapGet, map, [key]);
}

export function securityMapHas<K>(map: Map<K, unknown>, key: K): boolean {
  assertMapIntegrity();
  return invoke(intrinsicMapHas, map, [key]) === true;
}

export function securityMapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  assertMapIntegrity();
  invoke(intrinsicMapSet, map, [key, value]);
  if (
    invoke(intrinsicMapHas, map, [key]) !== true ||
    invoke(intrinsicMapGet, map, [key]) !== value
  ) {
    failIntrinsic('Map write');
  }
}

export function securityMapDelete<K>(map: Map<K, unknown>, key: K): boolean {
  assertMapIntegrity();
  return invoke(intrinsicMapDelete, map, [key]) === true;
}

export function securityMapForEach<K, V>(
  map: Map<K, V>,
  callback: (value: V, key: K) => void,
): void {
  assertMapIntegrity();
  invoke(intrinsicMapForEach, map, [callback]);
}

export function securitySet<T>(): Set<T> {
  assertSetIntegrity();
  return new IntrinsicSet<T>();
}

export function securitySetAdd<T>(set: Set<T>, value: T): void {
  assertSetIntegrity();
  invoke(intrinsicSetAdd, set, [value]);
  if (invoke(intrinsicSetHas, set, [value]) !== true) failIntrinsic('Set write');
}

export function securitySetHas<T>(set: Set<T>, value: T): boolean {
  assertSetIntegrity();
  return invoke(intrinsicSetHas, set, [value]) === true;
}

export function securitySetDelete<T>(set: Set<T>, value: T): boolean {
  assertSetIntegrity();
  return invoke(intrinsicSetDelete, set, [value]) === true;
}

export function securitySetForEach<T>(set: Set<T>, callback: (value: T) => void): void {
  assertSetIntegrity();
  invoke(intrinsicSetForEach, set, [callback]);
}

export function securitySetValues<T>(set: Set<T>): T[] {
  const values: T[] = [];
  securitySetForEach(set, (value) => {
    values[values.length] = value;
  });
  return values;
}

export function freezeSecurityValue<T extends object>(value: T): T {
  assertFreezeIntegrity();
  const frozen = invoke<T>(intrinsicObjectFreeze, IntrinsicObject, [value]);
  if (frozen !== value || invoke(intrinsicObjectIsFrozen, IntrinsicObject, [value]) !== true) {
    failIntrinsic('Object.freeze result');
  }
  return frozen;
}

export function securityString(value: unknown): string {
  assertStringIntegrity();
  return invoke(intrinsicString, undefined, [value]);
}

export function securityGetOwnPropertyDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  assertObjectIntegrity();
  return invoke<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [value, key],
  );
}

export function securityGetPrototypeOf(value: object): object | null {
  assertObjectIntegrity();
  return invoke<object | null>(intrinsicObjectGetPrototypeOf, IntrinsicObject, [value]);
}

export function securityDefineProperty<T extends object>(
  value: T,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): T {
  assertObjectIntegrity();
  const result = invoke<T>(intrinsicObjectDefineProperty, IntrinsicObject, [
    value,
    key,
    descriptor,
  ]);
  if (result !== value) failIntrinsic('Object.defineProperty');
  return result;
}

export function securityHasOwn(value: object, key: PropertyKey): boolean {
  assertObjectIntegrity();
  return invoke(intrinsicObjectHasOwnProperty, value, [key]) === true;
}

export function securityPropertyIsEnumerable(value: object, key: PropertyKey): boolean {
  assertObjectIntegrity();
  return invoke(intrinsicObjectPropertyIsEnumerable, value, [key]) === true;
}

export function securityObjectKeys(value: object): string[] {
  assertObjectIntegrity();
  return invoke<string[]>(intrinsicObjectKeys, IntrinsicObject, [value]);
}

export function securityGetOwnPropertySymbols(value: object): symbol[] {
  assertObjectIntegrity();
  return invoke<symbol[]>(intrinsicObjectGetOwnPropertySymbols, IntrinsicObject, [value]);
}

export function securityObjectIs(left: unknown, right: unknown): boolean {
  assertObjectIntegrity();
  return invoke(intrinsicObjectIs, IntrinsicObject, [left, right]) === true;
}

export function securityIsArray(value: unknown): value is unknown[] {
  assertObjectIntegrity();
  return invoke(intrinsicArrayIsArray, IntrinsicArray, [value]) === true;
}

export function securityIsMap(value: unknown): value is Map<unknown, unknown> {
  assertHasInstanceIntegrity();
  return invoke(intrinsicFunctionHasInstance, IntrinsicMap, [value]) === true;
}

export function securityIsSet(value: unknown): value is Set<unknown> {
  assertHasInstanceIntegrity();
  return invoke(intrinsicFunctionHasInstance, IntrinsicSet, [value]) === true;
}

export function securityIsError(value: unknown): value is Error {
  assertHasInstanceIntegrity();
  return invoke(intrinsicFunctionHasInstance, IntrinsicError, [value]) === true;
}
