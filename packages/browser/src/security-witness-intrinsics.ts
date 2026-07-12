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
const IntrinsicObject = Object;

const intrinsicReflectApply = Reflect.apply;
const intrinsicWeakMapGet = WeakMap.prototype.get;
const intrinsicWeakMapSet = WeakMap.prototype.set;
const intrinsicWeakMapHas = WeakMap.prototype.has;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;
const intrinsicMapGet = Map.prototype.get;
const intrinsicMapSet = Map.prototype.set;
const intrinsicMapHas = Map.prototype.has;
const intrinsicSetAdd = Set.prototype.add;
const intrinsicSetHas = Set.prototype.has;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectIsFrozen = Object.isFrozen;
const intrinsicObjectIsExtensible = Object.isExtensible;
const intrinsicObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const intrinsicObjectDefineProperties = Object.defineProperties;
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
}

function assertSetIntegrity(): void {
  if (
    invoke(intrinsicSetHas, setControl, [setPositiveValueA]) !== true ||
    invoke(intrinsicSetHas, setControl, [setPositiveValueB]) !== true ||
    invoke(intrinsicSetHas, setControl, [setNegativeValue]) !== false
  ) {
    failIntrinsic('Set');
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
  if (
    definePropertiesResult !== definePropertiesControl ||
    hidden?.value !== definePropertiesValue ||
    hidden.configurable !== false ||
    hidden.enumerable !== false ||
    hidden.writable !== false ||
    visible?.value !== definePropertiesValue ||
    visible.configurable !== true ||
    visible.enumerable !== true ||
    visible.writable !== true
  ) {
    failIntrinsic('Object.defineProperties');
  }
}

function assertStringIntegrity(): void {
  if (
    invoke(intrinsicString, undefined, ['kovo-security-control']) !== 'kovo-security-control' ||
    invoke(intrinsicString, undefined, [418]) !== '418'
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

assertWeakMapIntegrity();
assertWeakSetIntegrity();
assertMapIntegrity();
assertSetIntegrity();
assertFreezeIntegrity();
assertDefinePropertiesIntegrity();
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

export function securityMap<K, V>(): Map<K, V> {
  assertMapIntegrity();
  const value = new IntrinsicMap<K, V>();
  if (invoke(intrinsicMapHas, value, [mapNegativeKey]) !== false) {
    failIntrinsic('Map constructor');
  }
  return value;
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

export function securitySet<T>(): Set<T> {
  assertSetIntegrity();
  const value = new IntrinsicSet<T>();
  if (invoke(intrinsicSetHas, value, [setNegativeValue]) !== false) {
    failIntrinsic('Set constructor');
  }
  return value;
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

export function freezeSecurityValue<T extends object>(value: T): T {
  assertFreezeIntegrity();
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
  assertDefinePropertiesIntegrity();
  const result = invoke<T>(intrinsicObjectDefineProperties, IntrinsicObject, [value, descriptors]);
  if (result !== value) failIntrinsic('Object.defineProperties');
  return result;
}

export function securityString(value: unknown): string {
  assertStringIntegrity();
  return invoke(intrinsicString, undefined, [value]);
}

export function securityHasInstance(constructor: Function, value: unknown): boolean {
  assertHasInstanceIntegrity();
  return invoke(intrinsicFunctionHasInstance, constructor, [value]) === true;
}

export function applySecurityIntrinsic<T>(
  target: (...args: any[]) => unknown,
  receiver: unknown,
  args: unknown[],
): T {
  assertHasInstanceIntegrity();
  return invoke<T>(target, receiver, args);
}
