/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */

const NativeArray = Array;
const NativeMap = Map;
const NativeObject = Object;
const NativeReflect = Reflect;
const NativeRegExp = RegExp;
const NativeSet = Set;
const NativeWeakSet = WeakSet;

const intrinsicArrayIsArray = NativeArray.isArray;
const intrinsicMapForEach = NativeMap.prototype.forEach;
const intrinsicMapEntries = NativeMap.prototype.entries;
const intrinsicMapGet = NativeMap.prototype.get;
const intrinsicMapHas = NativeMap.prototype.has;
const intrinsicMapKeys = NativeMap.prototype.keys;
const intrinsicMapSet = NativeMap.prototype.set;
const intrinsicMapValues = NativeMap.prototype.values;
const intrinsicObjectDefineProperty = NativeObject.defineProperty;
const intrinsicObjectCreate = NativeObject.create;
const intrinsicObjectFreeze = NativeObject.freeze;
const intrinsicObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const intrinsicObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const intrinsicObjectGetOwnPropertySymbols = NativeObject.getOwnPropertySymbols;
const intrinsicObjectIsFrozen = NativeObject.isFrozen;
const intrinsicObjectKeys = NativeObject.keys;
const intrinsicReflectApply = NativeReflect.apply;
const intrinsicReflectOwnKeys = NativeReflect.ownKeys;
const intrinsicRegExpTest = NativeRegExp.prototype.test;
const intrinsicSetAdd = NativeSet.prototype.add;
const intrinsicSetEntries = NativeSet.prototype.entries;
const intrinsicSetForEach = NativeSet.prototype.forEach;
const intrinsicSetHas = NativeSet.prototype.has;
const intrinsicSetKeys = NativeSet.prototype.keys;
const intrinsicSetValues = NativeSet.prototype.values;
const intrinsicWeakSetAdd = NativeWeakSet.prototype.add;
const intrinsicWeakSetHas = NativeWeakSet.prototype.has;
const intrinsicMapSize = intrinsicObjectGetOwnPropertyDescriptor(NativeMap.prototype, 'size')?.get;
const intrinsicSetSize = intrinsicObjectGetOwnPropertyDescriptor(NativeSet.prototype, 'size')?.get;
const runtimeMetadataCollectionFacades = new NativeWeakSet<object>();

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return intrinsicReflectApply(fn, receiver, args) as Return;
}

const controlsSound = (() => {
  try {
    const array = ['array-control'];
    const entry = apply<PropertyDescriptor | undefined>(
      intrinsicObjectGetOwnPropertyDescriptor,
      NativeObject,
      [array, 0],
    );
    const object = { key: 'object-control' };
    const keys = apply<string[]>(intrinsicObjectKeys, NativeObject, [object]);
    const symbol = Symbol('object-symbol-control');
    const symbolObject = { [symbol]: 'symbol-control' };
    const symbols = apply<symbol[]>(intrinsicObjectGetOwnPropertySymbols, NativeObject, [
      symbolObject,
    ]);
    const ownKeysSymbol = Symbol('own-keys-control');
    const ownKeysObject = { visible: 'visible-control', [ownKeysSymbol]: 'symbol-control' };
    apply(intrinsicObjectDefineProperty, NativeObject, [
      ownKeysObject,
      'hidden',
      { value: 'hidden-control' },
    ]);
    const ownKeys = apply<PropertyKey[]>(intrinsicReflectOwnKeys, NativeReflect, [ownKeysObject]);
    const defined: Record<string, unknown> = {};
    const nullRecord = apply<Record<string, unknown>>(intrinsicObjectCreate, NativeObject, [null]);
    apply(intrinsicObjectDefineProperty, NativeObject, [
      defined,
      'defined',
      { value: 'define-control' },
    ]);
    const map = new NativeMap<string, string>();
    apply(intrinsicMapSet, map, ['key', 'map-control']);
    let mapForEachControl = '';
    apply(intrinsicMapForEach, map, [
      (value: string, key: string) => {
        mapForEachControl = `${key}:${value}`;
      },
    ]);
    const set = new NativeSet<string>();
    apply(intrinsicSetAdd, set, ['set-control']);
    let setForEachControl = '';
    apply(intrinsicSetForEach, set, [
      (value: string) => {
        setForEachControl = value;
      },
    ]);
    const frozen = apply<object>(intrinsicObjectFreeze, NativeObject, [{ frozen: true }]);
    const weakSet = new NativeWeakSet<object>();
    const weakSetValue = {};
    apply(intrinsicWeakSetAdd, weakSet, [weakSetValue]);
    return (
      apply<boolean>(intrinsicArrayIsArray, NativeArray, [array]) === true &&
      entry !== undefined &&
      'value' in entry &&
      entry.value === 'array-control' &&
      keys.length === 1 &&
      keys[0] === 'key' &&
      symbols.length === 1 &&
      symbols[0] === symbol &&
      ownKeys.length === 3 &&
      ownKeys[0] === 'visible' &&
      ownKeys[1] === 'hidden' &&
      ownKeys[2] === ownKeysSymbol &&
      defined.defined === 'define-control' &&
      apply(intrinsicObjectGetPrototypeOf, NativeObject, [nullRecord]) === null &&
      apply<string | undefined>(intrinsicMapGet, map, ['key']) === 'map-control' &&
      apply<boolean>(intrinsicMapHas, map, ['key']) === true &&
      mapForEachControl === 'key:map-control' &&
      intrinsicMapSize !== undefined &&
      apply<number>(intrinsicMapSize, map, []) === 1 &&
      apply<boolean>(intrinsicSetHas, set, ['set-control']) === true &&
      intrinsicSetSize !== undefined &&
      apply<number>(intrinsicSetSize, set, []) === 1 &&
      setForEachControl === 'set-control' &&
      apply<boolean>(intrinsicRegExpTest, /control/u, ['control']) === true &&
      apply<boolean>(intrinsicObjectIsFrozen, NativeObject, [frozen]) === true &&
      apply<boolean>(intrinsicWeakSetHas, weakSet, [weakSetValue]) === true &&
      apply<boolean>(intrinsicWeakSetHas, weakSet, [{}]) === false
    );
  } catch {
    return false;
  }
})();

function assertControls(): void {
  if (!controlsSound) {
    throw new TypeError('Kovo Drizzle runtime security controls are unavailable.');
  }
}

/** @internal Invoke a boot-captured callable without consulting mutable `Reflect.apply`. */
export function runtimeReflectApply<Return>(
  fn: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertControls();
  return apply<Return>(fn, receiver, args);
}

export function runtimeArrayIsArray(value: unknown): value is readonly unknown[] {
  assertControls();
  return apply<boolean>(intrinsicArrayIsArray, NativeArray, [value]);
}

export function runtimeArrayLength(values: readonly unknown[], label: string): number {
  const descriptor = runtimeGetOwnPropertyDescriptor(values, 'length');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'number' ||
    descriptor.value < 0 ||
    descriptor.value % 1 !== 0 ||
    descriptor.value > 1_000_000
  ) {
    throw new TypeError(`${label} requires a stable dense array.`);
  }
  return descriptor.value;
}

export function runtimeArrayValue<T>(values: readonly T[], index: number, label: string): T {
  const descriptor = runtimeGetOwnPropertyDescriptor(values, index);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label} requires stable own-data entries.`);
  }
  return descriptor.value as T;
}

export function runtimeArrayAppend<T>(target: T[], value: T, label: string): void {
  const index = runtimeArrayLength(target, label);
  runtimeDefineOwnData(target, index, value, label);
}

export function runtimeSnapshotArray<T>(values: readonly T[], label: string): readonly T[] {
  if (!runtimeArrayIsArray(values)) throw new TypeError(`${label} must be an array.`);
  const length = runtimeArrayLength(values, label);
  const snapshot: T[] = [];
  for (let index = 0; index < length; index += 1) {
    runtimeArrayAppend(snapshot, runtimeArrayValue(values, index, label), label);
  }
  return runtimeFreeze(snapshot);
}

export function runtimeGetOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  assertControls();
  return apply<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    NativeObject,
    [value, property],
  );
}

export function runtimeOwnDataValue(
  value: object,
  property: PropertyKey,
): { found: false } | { found: true; value: unknown } {
  const descriptor = runtimeGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return { found: false };
  if (!('value' in descriptor)) {
    throw new TypeError('Kovo Drizzle runtime metadata requires own-data properties.');
  }
  return { found: true, value: descriptor.value };
}

export function runtimeDefineOwnData(
  target: object,
  property: PropertyKey,
  value: unknown,
  label: string,
): void {
  assertControls();
  apply(intrinsicObjectDefineProperty, NativeObject, [
    target,
    property,
    { configurable: false, enumerable: true, value, writable: false },
  ]);
  const descriptor = runtimeGetOwnPropertyDescriptor(target, property);
  if (descriptor === undefined || !('value' in descriptor) || descriptor.value !== value) {
    throw new TypeError(`${label} own-data commit failed.`);
  }
}

export function runtimeObjectKeys(value: object): readonly string[] {
  assertControls();
  return runtimeSnapshotArray(
    apply<string[]>(intrinsicObjectKeys, NativeObject, [value]),
    'Kovo Drizzle object keys',
  );
}

export function runtimeObjectSymbols(value: object): readonly symbol[] {
  assertControls();
  return runtimeSnapshotArray(
    apply<symbol[]>(intrinsicObjectGetOwnPropertySymbols, NativeObject, [value]),
    'Kovo Drizzle object symbols',
  );
}

export function runtimeOwnKeys(value: object): readonly PropertyKey[] {
  assertControls();
  return runtimeSnapshotArray(
    apply<PropertyKey[]>(intrinsicReflectOwnKeys, NativeReflect, [value]),
    'Kovo Drizzle own keys',
  );
}

export function runtimeNullRecord(): Record<string, unknown> {
  assertControls();
  const record = apply<Record<string, unknown>>(intrinsicObjectCreate, NativeObject, [null]);
  if (apply(intrinsicObjectGetPrototypeOf, NativeObject, [record]) !== null) {
    throw new TypeError('Kovo Drizzle runtime null-record construction failed.');
  }
  return record;
}

export function runtimeFreeze<T extends object>(value: T): T {
  assertControls();
  const frozen = apply<T>(intrinsicObjectFreeze, NativeObject, [value]);
  if (!apply<boolean>(intrinsicObjectIsFrozen, NativeObject, [frozen])) {
    throw new TypeError('Kovo Drizzle runtime metadata freeze failed.');
  }
  return frozen;
}

export function runtimeRegExpTest(pattern: RegExp, value: string): boolean {
  assertControls();
  return apply<boolean>(intrinsicRegExpTest, pattern, [value]);
}

export function runtimeMap<Key, Value>(): Map<Key, Value> {
  assertControls();
  return new NativeMap<Key, Value>();
}

export function runtimeMapGet<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  key: Key,
): Value | undefined {
  assertControls();
  return apply<Value | undefined>(intrinsicMapGet, map, [key]);
}

export function runtimeMapHas<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): boolean {
  assertControls();
  return apply<boolean>(intrinsicMapHas, map, [key]);
}

export function runtimeMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertControls();
  apply(intrinsicMapSet, map, [key, value]);
  if (!runtimeMapHas(map, key) || runtimeMapGet(map, key) !== value) {
    throw new TypeError('Kovo Drizzle runtime metadata map commit failed.');
  }
}

export function runtimeMapForEach<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  callback: (value: Value, key: Key) => void,
): void {
  assertControls();
  apply(intrinsicMapForEach, map, [callback]);
}

export function runtimeMapSize(map: ReadonlyMap<unknown, unknown>): number {
  assertControls();
  if (intrinsicMapSize === undefined) {
    throw new TypeError('Kovo Drizzle runtime Map size control is unavailable.');
  }
  return apply<number>(intrinsicMapSize, map, []);
}

export function runtimeSet<Value>(): Set<Value> {
  assertControls();
  return new NativeSet<Value>();
}

export function runtimeSetAdd<Value>(set: Set<Value>, value: Value): void {
  assertControls();
  apply(intrinsicSetAdd, set, [value]);
  if (!runtimeSetHas(set, value)) {
    throw new TypeError('Kovo Drizzle runtime metadata set commit failed.');
  }
}

export function runtimeSetHas<Value>(set: ReadonlySet<Value>, value: Value): boolean {
  assertControls();
  return apply<boolean>(intrinsicSetHas, set, [value]);
}

export function runtimeSetForEach<Value>(
  set: ReadonlySet<Value>,
  callback: (value: Value) => void,
): void {
  assertControls();
  apply(intrinsicSetForEach, set, [callback]);
}

export function runtimeSetSize<Value>(set: ReadonlySet<Value>): number {
  assertControls();
  if (intrinsicSetSize === undefined) {
    throw new TypeError('Kovo Drizzle runtime Set size control is unavailable.');
  }
  return apply<number>(intrinsicSetSize, set, []);
}

/** @internal Unforgeable provenance check for immutable runtime-metadata collection facades. */
export function isKovoRuntimeMetadataCollectionFacade(value: unknown): value is object {
  assertControls();
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    apply<boolean>(intrinsicWeakSetHas, runtimeMetadataCollectionFacades, [value])
  );
}

function recordRuntimeMetadataCollectionFacade<Value extends object>(value: Value): Value {
  assertControls();
  apply(intrinsicWeakSetAdd, runtimeMetadataCollectionFacades, [value]);
  if (!isKovoRuntimeMetadataCollectionFacade(value)) {
    throw new TypeError('Kovo Drizzle runtime metadata collection provenance commit failed.');
  }
  return value;
}

export function runtimeSealMap<Key, Value>(map: Map<Key, Value>): ReadonlyMap<Key, Value> {
  const backing = runtimeMap<Key, Value>();
  runtimeMapForEach(map, (value, key) => runtimeMapSet(backing, key, value));
  let facade: ReadonlyMap<Key, Value>;
  const target: Record<PropertyKey, unknown> = {};
  runtimeDefineOwnData(
    target,
    'entries',
    () => apply<MapIterator<[Key, Value]>>(intrinsicMapEntries, backing, []),
    'Kovo Drizzle metadata map',
  );
  runtimeDefineOwnData(
    target,
    'forEach',
    (callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown) =>
      runtimeMapForEach(backing, (value, key) => apply(callback, thisArg, [value, key, facade])),
    'Kovo Drizzle metadata map',
  );
  runtimeDefineOwnData(
    target,
    'get',
    (key: Key) => runtimeMapGet(backing, key),
    'Kovo Drizzle metadata map',
  );
  runtimeDefineOwnData(
    target,
    'has',
    (key: Key) => runtimeMapHas(backing, key),
    'Kovo Drizzle metadata map',
  );
  runtimeDefineOwnData(
    target,
    'keys',
    () => apply<MapIterator<Key>>(intrinsicMapKeys, backing, []),
    'Kovo Drizzle metadata map',
  );
  runtimeDefineOwnData(target, 'size', runtimeMapSize(backing), 'Kovo Drizzle metadata map');
  runtimeDefineOwnData(
    target,
    'values',
    () => apply<MapIterator<Value>>(intrinsicMapValues, backing, []),
    'Kovo Drizzle metadata map',
  );
  runtimeDefineOwnData(
    target,
    Symbol.iterator,
    () => apply<MapIterator<[Key, Value]>>(intrinsicMapEntries, backing, []),
    'Kovo Drizzle metadata map',
  );
  facade = recordRuntimeMetadataCollectionFacade(runtimeFreeze(target)) as unknown as ReadonlyMap<
    Key,
    Value
  >;
  return facade;
}

export function runtimeSealSet<Value>(set: Set<Value>): ReadonlySet<Value> {
  const backing = runtimeSet<Value>();
  runtimeSetForEach(set, (value) => runtimeSetAdd(backing, value));
  let facade: ReadonlySet<Value>;
  const target: Record<PropertyKey, unknown> = {};
  runtimeDefineOwnData(
    target,
    'entries',
    () => apply<SetIterator<[Value, Value]>>(intrinsicSetEntries, backing, []),
    'Kovo Drizzle metadata set',
  );
  runtimeDefineOwnData(
    target,
    'forEach',
    (callback: (value: Value, key: Value, set: ReadonlySet<Value>) => void, thisArg?: unknown) =>
      runtimeSetForEach(backing, (value) => apply(callback, thisArg, [value, value, facade])),
    'Kovo Drizzle metadata set',
  );
  runtimeDefineOwnData(
    target,
    'has',
    (value: Value) => runtimeSetHas(backing, value),
    'Kovo Drizzle metadata set',
  );
  runtimeDefineOwnData(
    target,
    'keys',
    () => apply<SetIterator<Value>>(intrinsicSetKeys, backing, []),
    'Kovo Drizzle metadata set',
  );
  runtimeDefineOwnData(target, 'size', runtimeSetSize(backing), 'Kovo Drizzle metadata set');
  runtimeDefineOwnData(
    target,
    'values',
    () => apply<SetIterator<Value>>(intrinsicSetValues, backing, []),
    'Kovo Drizzle metadata set',
  );
  runtimeDefineOwnData(
    target,
    Symbol.iterator,
    () => apply<SetIterator<Value>>(intrinsicSetValues, backing, []),
    'Kovo Drizzle metadata set',
  );
  facade = recordRuntimeMetadataCollectionFacade(
    runtimeFreeze(target),
  ) as unknown as ReadonlySet<Value>;
  return facade;
}
