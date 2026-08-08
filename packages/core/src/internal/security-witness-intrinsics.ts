/**
 * Captured intrinsics for module-private proof registries (SPEC §6.6).
 *
 * Security decisions never dispatch through mutable ambient collection prototypes. Private
 * positive and negative controls make generic pre-import poisoning fail closed at boot and before
 * each witness operation.
 *
 * Dispatch follows plans/good-perf.md D8 (threat model:
 * security/boot-captured-direct-call.md): receiver-insensitive captured statics are called
 * directly and per-receiver methods go through direct callers minted at module init from the
 * boot-captured `Function.prototype.call`/`bind`. Neither form performs an observable property
 * lookup or touches the iterator protocol at invocation time; only the caller-shaped
 * `securityApply` keeps the boot-captured `Reflect.apply` (residual R3).
 */

const IntrinsicWeakMap = WeakMap;
const IntrinsicWeakSet = WeakSet;
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const IntrinsicObject = Object;
const IntrinsicArray = Array;
const IntrinsicError = Error;
const IntrinsicFunction = Function;

const intrinsicReflectApply = Reflect.apply;
const intrinsicFunctionCall = IntrinsicFunction.prototype.call;
const intrinsicFunctionBind = IntrinsicFunction.prototype.bind;
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
const intrinsicJsonStringify = JSON.stringify as (value: unknown) => string | undefined;
const intrinsicFunctionHasInstance = Function.prototype[Symbol.hasInstance];

// Boot-derived direct-caller mint (D8; SPEC §6.6 rule 6). Fixed-arity call sites only — see
// security/boot-captured-direct-call.md R4.
const uncurryThis = intrinsicReflectApply(intrinsicFunctionBind, intrinsicFunctionBind, [
  intrinsicFunctionCall,
]) as (fn: Function) => (receiver: unknown, ...args: unknown[]) => unknown;

const callWeakMapGet = uncurryThis(intrinsicWeakMapGet) as <K extends object, V>(
  map: WeakMap<K, V>,
  key: K,
) => V | undefined;
const callWeakMapSet = uncurryThis(intrinsicWeakMapSet) as <K extends object, V>(
  map: WeakMap<K, V>,
  key: K,
  value: V,
) => WeakMap<K, V>;
const callWeakMapHas = uncurryThis(intrinsicWeakMapHas) as <K extends object>(
  map: WeakMap<K, unknown>,
  key: K,
) => boolean;
const callWeakSetAdd = uncurryThis(intrinsicWeakSetAdd) as <T extends object>(
  set: WeakSet<T>,
  value: T,
) => WeakSet<T>;
const callWeakSetHas = uncurryThis(intrinsicWeakSetHas) as <T extends object>(
  set: WeakSet<T>,
  value: T,
) => boolean;
const callWeakSetDelete = uncurryThis(intrinsicWeakSetDelete) as <T extends object>(
  set: WeakSet<T>,
  value: T,
) => boolean;
const callMapGet = uncurryThis(intrinsicMapGet) as <K, V>(
  map: ReadonlyMap<K, V>,
  key: K,
) => V | undefined;
const callMapSet = uncurryThis(intrinsicMapSet) as <K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
) => Map<K, V>;
const callMapHas = uncurryThis(intrinsicMapHas) as <K>(
  map: ReadonlyMap<K, unknown>,
  key: K,
) => boolean;
const callMapDelete = uncurryThis(intrinsicMapDelete) as <K>(
  map: Map<K, unknown>,
  key: K,
) => boolean;
const callMapForEach = uncurryThis(intrinsicMapForEach) as <K, V>(
  map: ReadonlyMap<K, V>,
  callback: (value: V, key: K) => void,
) => void;
const callSetAdd = uncurryThis(intrinsicSetAdd) as <T>(set: Set<T>, value: T) => Set<T>;
const callSetHas = uncurryThis(intrinsicSetHas) as <T>(set: ReadonlySet<T>, value: T) => boolean;
const callSetDelete = uncurryThis(intrinsicSetDelete) as <T>(set: Set<T>, value: T) => boolean;
const callSetForEach = uncurryThis(intrinsicSetForEach) as <T>(
  set: ReadonlySet<T>,
  callback: (value: T) => void,
) => void;
const callHasOwnProperty = uncurryThis(intrinsicObjectHasOwnProperty) as (
  value: object,
  key: PropertyKey,
) => boolean;
const callPropertyIsEnumerable = uncurryThis(intrinsicObjectPropertyIsEnumerable) as (
  value: object,
  key: PropertyKey,
) => boolean;
const callStringTrim = uncurryThis(intrinsicStringTrim) as (value: string) => string;
const callStringSlice = uncurryThis(intrinsicStringSlice) as (
  value: string,
  start?: number,
  end?: number,
) => string;
const callStringCharCodeAt = uncurryThis(intrinsicStringCharCodeAt) as (
  value: string,
  index: number,
) => number;
const callStringStartsWith = uncurryThis(intrinsicStringStartsWith) as (
  value: string,
  search: string,
  position?: number,
) => boolean;
const callStringSplit = uncurryThis(intrinsicStringSplit) as (
  value: string,
  separator: string,
) => string[];
const callStringToLowerCase = uncurryThis(intrinsicStringToLowerCase) as (value: string) => string;
const callStringToUpperCase = uncurryThis(intrinsicStringToUpperCase) as (value: string) => string;
const callRegExpExec = uncurryThis(intrinsicRegExpExec) as (
  pattern: RegExp,
  value: string,
) => RegExpExecArray | null;
const callHasInstance = uncurryThis(intrinsicFunctionHasInstance) as (
  constructor: Function,
  value: unknown,
) => boolean;

const weakMapPositiveKeyA = {};
const weakMapPositiveKeyB = () => undefined;
const weakMapNegativeKey = {};
const weakMapValueA = {};
const weakMapValueB = {};
const weakMapControl = new IntrinsicWeakMap<object, object>();
callWeakMapSet(weakMapControl, weakMapPositiveKeyA, weakMapValueA);
callWeakMapSet(weakMapControl, weakMapPositiveKeyB, weakMapValueB);

const weakSetPositiveKeyA = {};
const weakSetPositiveKeyB = () => undefined;
const weakSetNegativeKey = {};
const weakSetControl = new IntrinsicWeakSet<object>();
callWeakSetAdd(weakSetControl, weakSetPositiveKeyA);
callWeakSetAdd(weakSetControl, weakSetPositiveKeyB);

const mapPositiveKeyA = Symbol('kovo.security.map-control-a');
const mapPositiveKeyB = {};
const mapNegativeKey = Symbol('kovo.security.map-control-negative');
const mapValueA = {};
const mapValueB = {};
const mapControl = new IntrinsicMap<unknown, object>();
callMapSet(mapControl, mapPositiveKeyA, mapValueA);
callMapSet(mapControl, mapPositiveKeyB, mapValueB);

const setPositiveValueA = Symbol('kovo.security.set-control-a');
const setPositiveValueB = {};
const setNegativeValue = Symbol('kovo.security.set-control-negative');
const setControl = new IntrinsicSet<unknown>();
callSetAdd(setControl, setPositiveValueA);
callSetAdd(setControl, setPositiveValueB);

const freezeControl = { marker: {} };
const freezeResult = intrinsicObjectFreeze(freezeControl);
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
const definePropertyResult = intrinsicObjectDefineProperty(objectControl, 'hidden', {
  configurable: false,
  enumerable: false,
  value: objectControlValue,
  writable: false,
});
const nullPrototypeControl = { __proto__: null } as object;
const createdNullPrototypeControl = intrinsicObjectCreate(null) as object;
const jsonStringifyControl = intrinsicObjectCreate(null) as object;
intrinsicObjectDefineProperty(jsonStringifyControl, 'kovo', {
  configurable: false,
  enumerable: true,
  value: 418,
  writable: false,
});
class HasInstanceControl {}
const hasInstancePositive = new HasInstanceControl();
const hasInstanceNegative = {};

function failIntrinsic(name: string): never {
  throw new TypeError(`Kovo security intrinsic integrity check failed: ${name}`);
}

function assertWeakMapIntegrity(): void {
  if (
    callWeakMapGet(weakMapControl, weakMapPositiveKeyA) !== weakMapValueA ||
    callWeakMapGet(weakMapControl, weakMapPositiveKeyB) !== weakMapValueB ||
    callWeakMapHas(weakMapControl, weakMapPositiveKeyA) !== true ||
    callWeakMapHas(weakMapControl, weakMapPositiveKeyB) !== true ||
    callWeakMapHas(weakMapControl, weakMapNegativeKey) !== false ||
    callWeakMapGet(weakMapControl, weakMapNegativeKey) !== undefined
  ) {
    failIntrinsic('WeakMap');
  }
}

function assertWeakSetIntegrity(): void {
  if (
    callWeakSetHas(weakSetControl, weakSetPositiveKeyA) !== true ||
    callWeakSetHas(weakSetControl, weakSetPositiveKeyB) !== true ||
    callWeakSetHas(weakSetControl, weakSetNegativeKey) !== false
  ) {
    failIntrinsic('WeakSet');
  }
  const deletionControl = new IntrinsicWeakSet<object>();
  callWeakSetAdd(deletionControl, weakSetPositiveKeyA);
  if (
    callWeakSetDelete(deletionControl, weakSetPositiveKeyA) !== true ||
    callWeakSetDelete(deletionControl, weakSetNegativeKey) !== false ||
    callWeakSetHas(deletionControl, weakSetPositiveKeyA) !== false
  ) {
    failIntrinsic('WeakSet.delete');
  }
}

function assertMapIntegrity(): void {
  if (
    callMapGet(mapControl, mapPositiveKeyA) !== mapValueA ||
    callMapGet(mapControl, mapPositiveKeyB) !== mapValueB ||
    callMapHas(mapControl, mapPositiveKeyA) !== true ||
    callMapHas(mapControl, mapPositiveKeyB) !== true ||
    callMapHas(mapControl, mapNegativeKey) !== false ||
    callMapGet(mapControl, mapNegativeKey) !== undefined
  ) {
    failIntrinsic('Map');
  }
  let visitedCount = 0;
  let visitedA = false;
  let visitedB = false;
  callMapForEach(mapControl, (value: object, key: unknown) => {
    visitedCount += 1;
    if (key === mapPositiveKeyA && value === mapValueA) visitedA = true;
    if (key === mapPositiveKeyB && value === mapValueB) visitedB = true;
  });
  if (visitedCount !== 2 || !visitedA || !visitedB) {
    failIntrinsic('Map.forEach');
  }
  const deletionControl = new IntrinsicMap<unknown, object>();
  callMapSet(deletionControl, mapPositiveKeyA, mapValueA);
  if (
    callMapDelete(deletionControl, mapPositiveKeyA) !== true ||
    callMapDelete(deletionControl, mapNegativeKey) !== false ||
    callMapHas(deletionControl, mapPositiveKeyA) !== false
  ) {
    failIntrinsic('Map.delete');
  }
}

function assertSetIntegrity(): void {
  if (
    callSetHas(setControl, setPositiveValueA) !== true ||
    callSetHas(setControl, setPositiveValueB) !== true ||
    callSetHas(setControl, setNegativeValue) !== false
  ) {
    failIntrinsic('Set');
  }
  let visitedCount = 0;
  let visitedA = false;
  let visitedB = false;
  callSetForEach(setControl, (value: unknown) => {
    visitedCount += 1;
    if (value === setPositiveValueA) visitedA = true;
    if (value === setPositiveValueB) visitedB = true;
  });
  if (visitedCount !== 2 || !visitedA || !visitedB) {
    failIntrinsic('Set.forEach');
  }
  const deletionControl = new IntrinsicSet<unknown>();
  callSetAdd(deletionControl, setPositiveValueA);
  if (
    callSetDelete(deletionControl, setPositiveValueA) !== true ||
    callSetDelete(deletionControl, setNegativeValue) !== false ||
    callSetHas(deletionControl, setPositiveValueA) !== false
  ) {
    failIntrinsic('Set.delete');
  }
}

function assertFreezeIntegrity(): void {
  const marker = intrinsicObjectGetOwnPropertyDescriptor(freezeControl, 'marker');
  if (
    freezeResult !== freezeControl ||
    intrinsicObjectIsFrozen(freezeControl) !== true ||
    intrinsicObjectIsExtensible(freezeControl) !== false ||
    marker === undefined ||
    marker.configurable !== false ||
    marker.writable !== false
  ) {
    failIntrinsic('Object.freeze');
  }
}

function assertObjectIntegrity(): void {
  const visible = intrinsicObjectGetOwnPropertyDescriptor(objectControl, 'visible');
  const hidden = intrinsicObjectGetOwnPropertyDescriptor(objectControl, 'hidden');
  const missing = intrinsicObjectGetOwnPropertyDescriptor(objectControl, 'missing');
  const keys = intrinsicObjectKeys(objectControl);
  const propertyNames = intrinsicObjectGetOwnPropertyNames(objectControl);
  const symbols = intrinsicObjectGetOwnPropertySymbols(objectControl);
  if (
    definePropertyResult !== objectControl ||
    visible?.value !== objectControlValue ||
    hidden?.value !== objectControlValue ||
    hidden.enumerable !== false ||
    missing !== undefined ||
    intrinsicObjectGetPrototypeOf(objectControl) !== IntrinsicObject.prototype ||
    intrinsicObjectGetPrototypeOf(nullPrototypeControl) !== null ||
    intrinsicObjectGetPrototypeOf(createdNullPrototypeControl) !== null ||
    callHasOwnProperty(objectControl, 'visible') !== true ||
    callHasOwnProperty(objectControl, 'missing') !== false ||
    callPropertyIsEnumerable(objectControl, 'visible') !== true ||
    callPropertyIsEnumerable(objectControl, 'hidden') !== false ||
    intrinsicObjectIs(objectControlValue, objectControlValue) !== true ||
    intrinsicObjectIs(objectControlValue, objectControl) !== false ||
    keys.length !== 1 ||
    keys[0] !== 'visible' ||
    propertyNames.length !== 2 ||
    propertyNames[0] !== 'visible' ||
    propertyNames[1] !== 'hidden' ||
    symbols.length !== 1 ||
    symbols[0] !== objectControlSymbol ||
    intrinsicArrayIsArray([]) !== true ||
    intrinsicArrayIsArray(objectControl) !== false
  ) {
    failIntrinsic('Object/Array');
  }
}

/**
 * `securityApply` (residual R3, security/boot-captured-direct-call.md) still dispatches
 * caller-shaped targets through the boot-captured `Reflect.apply`, so that dynamic path keeps its
 * own positive/negative probes: a pre-import `Reflect.apply` forgery that misroutes a captured
 * control fails closed here even though fixed-shape operations no longer route through it.
 */
function assertDynamicApplyIntegrity(): void {
  if (
    intrinsicReflectApply(intrinsicFunctionHasInstance, HasInstanceControl, [
      hasInstancePositive,
    ]) !== true ||
    intrinsicReflectApply(intrinsicFunctionHasInstance, HasInstanceControl, [
      hasInstanceNegative,
    ]) !== false ||
    intrinsicReflectApply(intrinsicStringToLowerCase, 'JaVaScRiPt', []) !== 'javascript' ||
    intrinsicReflectApply(intrinsicArrayIsArray, IntrinsicArray, [objectControl]) !== false
  ) {
    failIntrinsic('Reflect.apply');
  }
}

function assertHasInstanceIntegrity(): void {
  if (
    callHasInstance(HasInstanceControl, hasInstancePositive) !== true ||
    callHasInstance(HasInstanceControl, hasInstanceNegative) !== false ||
    callHasInstance(IntrinsicMap, mapControl) !== true ||
    callHasInstance(IntrinsicMap, setControl) !== false ||
    callHasInstance(IntrinsicSet, setControl) !== true ||
    callHasInstance(IntrinsicSet, mapControl) !== false ||
    callHasInstance(IntrinsicError, new IntrinsicError('control')) !== true ||
    callHasInstance(IntrinsicError, objectControl) !== false
  ) {
    failIntrinsic('Function@@hasInstance');
  }
}

function assertStringIntegrity(): void {
  const match = callRegExpExec(/^([a-z]+):/, 'https:');
  const segments = callStringSplit('root/child/file', '/');
  const firstSegment = intrinsicObjectGetOwnPropertyDescriptor(segments, 0);
  const lastSegment = intrinsicObjectGetOwnPropertyDescriptor(segments, 2);
  if (
    intrinsicString('kovo-security-control') !== 'kovo-security-control' ||
    intrinsicString(422) !== '422' ||
    callStringTrim(' \tKovo\n') !== 'Kovo' ||
    callStringSlice('Kovo-security', 5, 13) !== 'security' ||
    callStringCharCodeAt('Kovo', 0) !== 0x4b ||
    callStringCharCodeAt('Kovo', 99) === callStringCharCodeAt('Kovo', 99) ||
    callStringStartsWith('kovo/security', 'kovo/', 0) !== true ||
    callStringStartsWith('kovo/security', 'security', 0) !== false ||
    segments.length !== 3 ||
    firstSegment?.value !== 'root' ||
    lastSegment?.value !== 'file' ||
    callStringToLowerCase('JaVaScRiPt') !== 'javascript' ||
    callStringToUpperCase('x-kovo') !== 'X-KOVO' ||
    intrinsicEncodeURIComponent('a/b c') !== 'a%2Fb%20c' ||
    intrinsicDecodeURIComponent('a%2Fb%20c') !== 'a/b c' ||
    intrinsicJsonStringify(jsonStringifyControl) !== '{"kovo":418}' ||
    match?.[0] !== 'https:' ||
    match[1] !== 'https' ||
    callRegExpExec(/^https:/, 'javascript:') !== null ||
    callRegExpExec(/^https:/, 'https://kovo.test') === null ||
    callRegExpExec(/^https:/, 'javascript:') !== null
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
    assertDynamicApplyIntegrity();
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
  if (callWeakMapHas(value, weakMapNegativeKey as K) !== false) {
    failIntrinsic('WeakMap constructor');
  }
  return value;
}

export function securityWeakMapGet<K extends object, V>(map: WeakMap<K, V>, key: K): V | undefined {
  assertCapturedSecurityControls();
  return callWeakMapGet(map, key);
}

export function securityWeakMapHas<K extends object>(map: WeakMap<K, unknown>, key: K): boolean {
  assertCapturedSecurityControls();
  return callWeakMapHas(map, key) === true;
}

export function securityWeakMapSet<K extends object, V>(
  map: WeakMap<K, V>,
  key: K,
  value: V,
): void {
  assertCapturedSecurityControls();
  callWeakMapSet(map, key, value);
  if (callWeakMapHas(map, key) !== true || callWeakMapGet(map, key) !== value) {
    failIntrinsic('WeakMap write');
  }
}

export function securityWeakSet<T extends object>(): WeakSet<T> {
  assertCapturedSecurityControls();
  const value = new IntrinsicWeakSet<T>();
  if (callWeakSetHas(value, weakSetNegativeKey as T) !== false) {
    failIntrinsic('WeakSet constructor');
  }
  return value;
}

export function securityWeakSetAdd<T extends object>(set: WeakSet<T>, value: T): void {
  assertCapturedSecurityControls();
  callWeakSetAdd(set, value);
  if (callWeakSetHas(set, value) !== true) failIntrinsic('WeakSet write');
}

export function securityWeakSetHas<T extends object>(set: WeakSet<T>, value: T): boolean {
  assertCapturedSecurityControls();
  return callWeakSetHas(set, value) === true;
}

export function securityWeakSetDelete<T extends object>(set: WeakSet<T>, value: T): boolean {
  assertCapturedSecurityControls();
  return callWeakSetDelete(set, value) === true;
}

export function securityMap<K, V>(): Map<K, V> {
  assertCapturedSecurityControls();
  return new IntrinsicMap<K, V>();
}

export function securityMapGet<K, V>(map: ReadonlyMap<K, V>, key: K): V | undefined {
  assertCapturedSecurityControls();
  return callMapGet(map, key);
}

export function securityMapHas<K>(map: ReadonlyMap<K, unknown>, key: K): boolean {
  assertCapturedSecurityControls();
  return callMapHas(map, key) === true;
}

export function securityMapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  assertCapturedSecurityControls();
  callMapSet(map, key, value);
  if (callMapHas(map, key) !== true || callMapGet(map, key) !== value) {
    failIntrinsic('Map write');
  }
}

export function securityMapDelete<K>(map: Map<K, unknown>, key: K): boolean {
  assertCapturedSecurityControls();
  return callMapDelete(map, key) === true;
}

export function securityMapForEach<K, V>(
  map: ReadonlyMap<K, V>,
  callback: (value: V, key: K) => void,
): void {
  assertCapturedSecurityControls();
  callMapForEach(map, callback);
}

export function securitySet<T>(): Set<T> {
  assertCapturedSecurityControls();
  return new IntrinsicSet<T>();
}

export function securitySetAdd<T>(set: Set<T>, value: T): void {
  assertCapturedSecurityControls();
  callSetAdd(set, value);
  if (callSetHas(set, value) !== true) failIntrinsic('Set write');
}

export function securitySetHas<T>(set: ReadonlySet<T>, value: T): boolean {
  assertCapturedSecurityControls();
  return callSetHas(set, value) === true;
}

export function securitySetDelete<T>(set: Set<T>, value: T): boolean {
  assertCapturedSecurityControls();
  return callSetDelete(set, value) === true;
}

export function securitySetForEach<T>(set: ReadonlySet<T>, callback: (value: T) => void): void {
  assertCapturedSecurityControls();
  callSetForEach(set, callback);
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
  const frozen = intrinsicObjectFreeze(value);
  if (frozen !== value || intrinsicObjectIsFrozen(value) !== true) {
    failIntrinsic('Object.freeze result');
  }
  return frozen;
}

export function securityString(value: unknown): string {
  assertCapturedSecurityControls();
  return intrinsicString(value);
}

export function securityStringTrim(value: string): string {
  assertCapturedSecurityControls();
  return callStringTrim(value);
}

export function securityStringSlice(value: string, start?: number, end?: number): string {
  assertCapturedSecurityControls();
  return callStringSlice(value, start, end);
}

export function securityStringCharCodeAt(value: string, index: number): number {
  assertCapturedSecurityControls();
  return callStringCharCodeAt(value, index);
}

export function securityStringStartsWith(value: string, search: string, position = 0): boolean {
  assertCapturedSecurityControls();
  return callStringStartsWith(value, search, position) === true;
}

export function securityStringSplit(value: string, separator: string): string[] {
  assertCapturedSecurityControls();
  return callStringSplit(value, separator);
}

export function securityEncodeURIComponent(value: string): string {
  assertCapturedSecurityControls();
  return intrinsicEncodeURIComponent(value);
}

export function securityDecodeURIComponent(value: string): string {
  assertCapturedSecurityControls();
  return intrinsicDecodeURIComponent(value);
}

export function securityJsonStringify(value: unknown): string | undefined {
  assertCapturedSecurityControls();
  return intrinsicJsonStringify(value);
}

export function securityStringToLowerCase(value: string): string {
  assertCapturedSecurityControls();
  return callStringToLowerCase(value);
}

export function securityStringToUpperCase(value: string): string {
  assertCapturedSecurityControls();
  return callStringToUpperCase(value);
}

export function securityRegExpExec(pattern: RegExp, value: string): RegExpExecArray | null {
  assertCapturedSecurityControls();
  return callRegExpExec(pattern, value);
}

export function securityRegExpTest(pattern: RegExp, value: string): boolean {
  assertCapturedSecurityControls();
  return callRegExpExec(pattern, value) !== null;
}

export function securityGetOwnPropertyDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  assertCapturedSecurityControls();
  return intrinsicObjectGetOwnPropertyDescriptor(value, key);
}

export function securityNullRecord<Value = unknown>(): Record<string, Value> {
  assertCapturedSecurityControls();
  const value = intrinsicObjectCreate(null) as Record<string, Value>;
  if (securityGetPrototypeOf(value) !== null) failIntrinsic('Object.create(null)');
  return value;
}

export function securityGetPrototypeOf(value: object): object | null {
  assertCapturedSecurityControls();
  return intrinsicObjectGetPrototypeOf(value);
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
  const result = intrinsicObjectDefineProperty(value, key, exactDescriptor);
  if (result !== value) failIntrinsic('Object.defineProperty');
  return result;
}

function snapshotSecurityPropertyDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
  if (typeof descriptor !== 'object' || descriptor === null) {
    throw new TypeError('Kovo security property descriptor must be an object.');
  }
  const snapshot = intrinsicObjectCreate(null) as Record<string, unknown>;
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
  const own = intrinsicObjectGetOwnPropertyDescriptor(descriptor, field);
  if (own === undefined) return;
  if (!('value' in own)) {
    throw new TypeError('Kovo security property descriptor fields must be own data properties.');
  }
  snapshot[field] = own.value;
}

export function securityHasOwn(value: object, key: PropertyKey): boolean {
  assertCapturedSecurityControls();
  return callHasOwnProperty(value, key) === true;
}

export function securityPropertyIsEnumerable(value: object, key: PropertyKey): boolean {
  assertCapturedSecurityControls();
  return callPropertyIsEnumerable(value, key) === true;
}

export function securityObjectKeys(value: object): string[] {
  assertCapturedSecurityControls();
  return intrinsicObjectKeys(value);
}

export function securityGetOwnPropertyNames(value: object): string[] {
  assertCapturedSecurityControls();
  return intrinsicObjectGetOwnPropertyNames(value);
}

export function securityGetOwnPropertySymbols(value: object): symbol[] {
  assertCapturedSecurityControls();
  return intrinsicObjectGetOwnPropertySymbols(value);
}

export function securityObjectIs(left: unknown, right: unknown): boolean {
  assertCapturedSecurityControls();
  return intrinsicObjectIs(left, right) === true;
}

export function securityIsArray(value: unknown): value is unknown[] {
  assertCapturedSecurityControls();
  return intrinsicArrayIsArray(value) === true;
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
  return callHasInstance(IntrinsicMap, value) === true;
}

export function securityIsSet(value: unknown): value is Set<unknown> {
  assertCapturedSecurityControls();
  return callHasInstance(IntrinsicSet, value) === true;
}

export function securityIsError(value: unknown): value is Error {
  assertCapturedSecurityControls();
  return callHasInstance(IntrinsicError, value) === true;
}

export function securityHasInstance(constructor: Function, value: unknown): boolean {
  assertCapturedSecurityControls();
  return callHasInstance(constructor, value) === true;
}

/**
 * Residual dynamic dispatch (security/boot-captured-direct-call.md R3): caller-shaped target and
 * arity stay on the boot-captured `Reflect.apply`.
 */
export function securityApply<Return>(
  target: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertCapturedSecurityControls();
  return intrinsicReflectApply(target, receiver, args) as Return;
}
