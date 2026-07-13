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
const intrinsicObjectCreate = Object.create;
const intrinsicObjectHasOwnProperty = Object.prototype.hasOwnProperty;
const intrinsicObjectPropertyIsEnumerable = Object.prototype.propertyIsEnumerable;
const intrinsicObjectKeys = Object.keys;
const intrinsicObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const intrinsicObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const intrinsicObjectIs = Object.is;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicString = String;
const intrinsicStringTrim = String.prototype.trim;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicStringSplit = String.prototype.split;
const intrinsicStringToLowerCase = String.prototype.toLowerCase;
const intrinsicStringToUpperCase = String.prototype.toUpperCase;
const intrinsicRegExpExec = RegExp.prototype.exec;
const intrinsicEncodeURIComponent = globalThis.encodeURIComponent;
const intrinsicDecodeURIComponent = globalThis.decodeURIComponent;
const intrinsicJsonStringify = JSON.stringify;
const intrinsicFunctionHasInstance = Function.prototype[Symbol.hasInstance];

function invoke<T>(
  target: (...args: any[]) => unknown,
  receiver: unknown,
  args: readonly unknown[],
): T {
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
const createdNullPrototypeControl = invoke<object>(intrinsicObjectCreate, IntrinsicObject, [null]);
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
  const propertyNames = invoke<string[]>(intrinsicObjectGetOwnPropertyNames, IntrinsicObject, [
    objectControl,
  ]);
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
    invoke(intrinsicObjectGetPrototypeOf, IntrinsicObject, [createdNullPrototypeControl]) !==
      null ||
    invoke(intrinsicObjectHasOwnProperty, objectControl, ['visible']) !== true ||
    invoke(intrinsicObjectHasOwnProperty, objectControl, ['missing']) !== false ||
    invoke(intrinsicObjectPropertyIsEnumerable, objectControl, ['visible']) !== true ||
    invoke(intrinsicObjectPropertyIsEnumerable, objectControl, ['hidden']) !== false ||
    invoke(intrinsicObjectIs, IntrinsicObject, [objectControlValue, objectControlValue]) !== true ||
    invoke(intrinsicObjectIs, IntrinsicObject, [objectControlValue, objectControl]) !== false ||
    keys.length !== 1 ||
    keys[0] !== 'visible' ||
    propertyNames.length !== 2 ||
    propertyNames[0] !== 'visible' ||
    propertyNames[1] !== 'hidden' ||
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
  const match = invoke<RegExpExecArray | null>(intrinsicRegExpExec, /^([a-z]+):/, ['https:']);
  const segments = invoke<string[]>(intrinsicStringSplit, 'root/child/file', ['/']);
  const firstSegment = invoke<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [segments, 0],
  );
  const lastSegment = invoke<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [segments, 2],
  );
  if (
    invoke(intrinsicString, undefined, ['kovo-security-control']) !== 'kovo-security-control' ||
    invoke(intrinsicString, undefined, [422]) !== '422' ||
    invoke(intrinsicStringTrim, ' \tKovo\n', []) !== 'Kovo' ||
    invoke(intrinsicStringSlice, 'Kovo-security', [5, 13]) !== 'security' ||
    invoke(intrinsicStringCharCodeAt, 'Kovo', [0]) !== 0x4b ||
    invoke(intrinsicStringCharCodeAt, 'Kovo', [99]) ===
      invoke(intrinsicStringCharCodeAt, 'Kovo', [99]) ||
    invoke(intrinsicStringStartsWith, 'kovo/security', ['kovo/', 0]) !== true ||
    invoke(intrinsicStringStartsWith, 'kovo/security', ['security', 0]) !== false ||
    segments.length !== 3 ||
    firstSegment?.value !== 'root' ||
    lastSegment?.value !== 'file' ||
    invoke(intrinsicStringToLowerCase, 'JaVaScRiPt', []) !== 'javascript' ||
    invoke(intrinsicStringToUpperCase, 'x-kovo', []) !== 'X-KOVO' ||
    invoke(intrinsicEncodeURIComponent, undefined, ['a/b c']) !== 'a%2Fb%20c' ||
    invoke(intrinsicDecodeURIComponent, undefined, ['a%2Fb%20c']) !== 'a/b c' ||
    invoke(intrinsicJsonStringify, JSON, [{ kovo: 418 }]) !== '{"kovo":418}' ||
    match?.[0] !== 'https:' ||
    match[1] !== 'https' ||
    invoke(intrinsicRegExpExec, /^https:/, ['javascript:']) !== null ||
    invoke(intrinsicRegExpExec, /^https:/, ['https://kovo.test']) === null ||
    invoke(intrinsicRegExpExec, /^https:/, ['javascript:']) !== null
  ) {
    failIntrinsic('String');
  }
}

const capturedSecurityControlsSound = (() => {
  try {
    assertWeakMapIntegrity();
    assertWeakSetIntegrity();
    assertMapIntegrity();
    assertSetIntegrity();
    assertFreezeIntegrity();
    assertObjectIntegrity();
    assertStringIntegrity();
    assertHasInstanceIntegrity();
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

export function securityWeakSetDelete<T extends object>(set: WeakSet<T>, value: T): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicWeakSetDelete, set, [value]) === true;
}

export function securityMap<K, V>(): Map<K, V> {
  assertCapturedSecurityControls();
  return new IntrinsicMap<K, V>();
}

export function securityMapGet<K, V>(map: ReadonlyMap<K, V>, key: K): V | undefined {
  assertCapturedSecurityControls();
  return invoke<V | undefined>(intrinsicMapGet, map, [key]);
}

export function securityMapHas<K>(map: ReadonlyMap<K, unknown>, key: K): boolean {
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
  return new IntrinsicSet<T>();
}

export function securitySetAdd<T>(set: Set<T>, value: T): void {
  assertCapturedSecurityControls();
  invoke(intrinsicSetAdd, set, [value]);
  if (invoke(intrinsicSetHas, set, [value]) !== true) failIntrinsic('Set write');
}

export function securitySetHas<T>(set: ReadonlySet<T>, value: T): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicSetHas, set, [value]) === true;
}

export function securitySetDelete<T>(set: Set<T>, value: T): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicSetDelete, set, [value]) === true;
}

export function securitySetForEach<T>(set: ReadonlySet<T>, callback: (value: T) => void): void {
  assertCapturedSecurityControls();
  invoke(intrinsicSetForEach, set, [callback]);
}

export function securitySetValues<T>(set: ReadonlySet<T>): T[] {
  const values: T[] = [];
  securitySetForEach(set, (value) => {
    securityArrayAppend(values, value);
  });
  return values;
}

export function securityArrayAppend<T>(values: T[], value: T): void {
  assertCapturedSecurityControls();
  const lengthDescriptor = securityGetOwnPropertyDescriptor(values, 'length');
  const length =
    lengthDescriptor !== undefined && 'value' in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
  if (typeof length !== 'number' || length % 1 !== 0 || length < 0 || length >= 1_000_000) {
    failIntrinsic('Array append length');
  }
  securityDefineProperty(values, length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  const committed = securityGetOwnPropertyDescriptor(values, length);
  const committedLength = securityGetOwnPropertyDescriptor(values, 'length');
  if (
    committed === undefined ||
    !('value' in committed) ||
    !securityObjectIs(committed.value, value) ||
    committedLength === undefined ||
    !('value' in committedLength) ||
    committedLength.value !== length + 1
  ) {
    failIntrinsic('Array append own-data commit');
  }
}

export function freezeSecurityValue<T extends object>(value: T): T {
  assertCapturedSecurityControls();
  const frozen = invoke<T>(intrinsicObjectFreeze, IntrinsicObject, [value]);
  if (frozen !== value || invoke(intrinsicObjectIsFrozen, IntrinsicObject, [value]) !== true) {
    failIntrinsic('Object.freeze result');
  }
  return frozen;
}

export function securityString(value: unknown): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicString, undefined, [value]);
}

export function securityStringTrim(value: string): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringTrim, value, []);
}

export function securityStringSlice(value: string, start?: number, end?: number): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringSlice, value, [start, end]);
}

export function securityStringCharCodeAt(value: string, index: number): number {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringCharCodeAt, value, [index]);
}

export function securityStringStartsWith(value: string, search: string, position = 0): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringStartsWith, value, [search, position]) === true;
}

export function securityStringSplit(value: string, separator: string): string[] {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringSplit, value, [separator]);
}

export function securityEncodeURIComponent(value: string): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicEncodeURIComponent, undefined, [value]);
}

export function securityDecodeURIComponent(value: string): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicDecodeURIComponent, undefined, [value]);
}

export function securityJsonStringify(value: unknown): string | undefined {
  assertCapturedSecurityControls();
  return invoke<string | undefined>(intrinsicJsonStringify, JSON, [value]);
}

export function securityStringToLowerCase(value: string): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringToLowerCase, value, []);
}

export function securityStringToUpperCase(value: string): string {
  assertCapturedSecurityControls();
  return invoke(intrinsicStringToUpperCase, value, []);
}

export function securityRegExpExec(pattern: RegExp, value: string): RegExpExecArray | null {
  assertCapturedSecurityControls();
  return invoke(intrinsicRegExpExec, pattern, [value]);
}

export function securityRegExpTest(pattern: RegExp, value: string): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicRegExpExec, pattern, [value]) !== null;
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

export function securityNullRecord<Value = unknown>(): Record<string, Value> {
  assertCapturedSecurityControls();
  const value = invoke<Record<string, Value>>(intrinsicObjectCreate, IntrinsicObject, [null]);
  if (securityGetPrototypeOf(value) !== null) failIntrinsic('Object.create(null)');
  return value;
}

export function securityGetPrototypeOf(value: object): object | null {
  assertCapturedSecurityControls();
  return invoke<object | null>(intrinsicObjectGetPrototypeOf, IntrinsicObject, [value]);
}

export function securityDefineProperty<T extends object>(
  value: T,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): T {
  assertCapturedSecurityControls();
  // ToPropertyDescriptor consults inherited `get`/`set`/`value` fields. Passing
  // an ordinary descriptor literal after Object.prototype pollution can change
  // a data definition into an invalid or attacker-selected accessor definition.
  const exactDescriptor = snapshotSecurityPropertyDescriptor(descriptor);
  const result = invoke<T>(intrinsicObjectDefineProperty, IntrinsicObject, [
    value,
    key,
    exactDescriptor,
  ]);
  if (result !== value) failIntrinsic('Object.defineProperty');
  return result;
}

function snapshotSecurityPropertyDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
  if (typeof descriptor !== 'object' || descriptor === null) {
    throw new TypeError('Kovo security property descriptor must be an object.');
  }
  const snapshot = invoke<Record<string, unknown>>(intrinsicObjectCreate, IntrinsicObject, [null]);
  copySecurityDescriptorField(descriptor, snapshot, 'configurable');
  copySecurityDescriptorField(descriptor, snapshot, 'enumerable');
  copySecurityDescriptorField(descriptor, snapshot, 'value');
  copySecurityDescriptorField(descriptor, snapshot, 'writable');
  copySecurityDescriptorField(descriptor, snapshot, 'get');
  copySecurityDescriptorField(descriptor, snapshot, 'set');
  return snapshot;
}

function copySecurityDescriptorField(
  descriptor: PropertyDescriptor,
  snapshot: Record<string, unknown>,
  field: string,
): void {
  const own = invoke<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [descriptor, field],
  );
  if (own === undefined) return;
  if (!('value' in own)) {
    throw new TypeError('Kovo security property descriptor fields must be own data properties.');
  }
  snapshot[field] = own.value;
}

export function securityHasOwn(value: object, key: PropertyKey): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicObjectHasOwnProperty, value, [key]) === true;
}

export function securityPropertyIsEnumerable(value: object, key: PropertyKey): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicObjectPropertyIsEnumerable, value, [key]) === true;
}

export function securityObjectKeys(value: object): string[] {
  assertCapturedSecurityControls();
  return invoke<string[]>(intrinsicObjectKeys, IntrinsicObject, [value]);
}

export function securityGetOwnPropertyNames(value: object): string[] {
  assertCapturedSecurityControls();
  return invoke<string[]>(intrinsicObjectGetOwnPropertyNames, IntrinsicObject, [value]);
}

export function securityGetOwnPropertySymbols(value: object): symbol[] {
  assertCapturedSecurityControls();
  return invoke<symbol[]>(intrinsicObjectGetOwnPropertySymbols, IntrinsicObject, [value]);
}

export function securityObjectIs(left: unknown, right: unknown): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicObjectIs, IntrinsicObject, [left, right]) === true;
}

export function securityIsArray(value: unknown): value is unknown[] {
  assertCapturedSecurityControls();
  return invoke(intrinsicArrayIsArray, IntrinsicArray, [value]) === true;
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

export function securityArrayIncludesExact<T>(values: readonly T[], expected: T): boolean {
  const descriptor = securityGetOwnPropertyDescriptor(values, 'length');
  const length = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  if (typeof length !== 'number' || length % 1 !== 0 || length < 0 || length > 1_000_000) {
    return false;
  }
  for (let index = 0; index < length; index += 1) {
    const entry = securityOwnArrayEntry(values, index);
    if (!entry.ok) return false;
    if (securityObjectIs(entry.value, expected)) return true;
  }
  return false;
}

export function securityIsMap(value: unknown): value is Map<unknown, unknown> {
  assertCapturedSecurityControls();
  return invoke(intrinsicFunctionHasInstance, IntrinsicMap, [value]) === true;
}

export function securityIsSet(value: unknown): value is Set<unknown> {
  assertCapturedSecurityControls();
  return invoke(intrinsicFunctionHasInstance, IntrinsicSet, [value]) === true;
}

export function securityIsError(value: unknown): value is Error {
  assertCapturedSecurityControls();
  return invoke(intrinsicFunctionHasInstance, IntrinsicError, [value]) === true;
}

export function securityHasInstance(constructor: Function, value: unknown): boolean {
  assertCapturedSecurityControls();
  return invoke(intrinsicFunctionHasInstance, constructor, [value]) === true;
}

export function securityApply<Return>(
  target: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertCapturedSecurityControls();
  return invoke<Return>(target as (...args: any[]) => unknown, receiver, args);
}
