/* eslint-disable typescript/unbound-method */

const NativeArray = globalThis.Array;
const NativeError = globalThis.Error;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeMath = globalThis.Math;
const NativeObject = globalThis.Object;
const NativeNumber = globalThis.Number;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeWeakSet = globalThis.WeakSet;

const nativeApply = NativeReflect.apply;
const nativeArrayIsArray = NativeArray.isArray;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeArrayPush = NativeArray.prototype.push;
const nativeArraySort = NativeArray.prototype.sort;
const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeJsonStringify = NativeJSON.stringify;
const nativeMapDelete = NativeMap.prototype.delete;
const nativeMapEntries = NativeMap.prototype.entries;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapHas = NativeMap.prototype.has;
const nativeMapSet = NativeMap.prototype.set;
const nativeMapValues = NativeMap.prototype.values;
const nativeMapIteratorNext = NativeObject.getPrototypeOf(new NativeMap().values())
  .next as Function;
const nativeMathFloor = NativeMath.floor;
const nativeMathImul = NativeMath.imul;
const nativeMathMax = NativeMath.max;
const nativeMathMin = NativeMath.min;
const nativeObjectFreeze = NativeObject.freeze;
const nativeNumber = NativeNumber;
const nativeNumberIsFinite = NativeNumber.isFinite;
const nativeOwnKeys = NativeReflect.ownKeys;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringLastIndexOf = NativeString.prototype.lastIndexOf;
const nativeStringLocaleCompare = NativeString.prototype.localeCompare;
const nativeStringMatch = NativeString.prototype.match;
const nativeStringReplace = NativeString.prototype.replace;
const nativeStringReplaceAll = NativeString.prototype.replaceAll;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringTrim = NativeString.prototype.trim;
const nativeWeakSetAdd = NativeWeakSet.prototype.add;
const nativeWeakSetHas = NativeWeakSet.prototype.has;

export function styleApply<Return>(
  callback: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  return nativeApply(callback, receiver, args) as Return;
}

export function styleArrayIsArray(value: unknown): value is unknown[] {
  return styleApply(nativeArrayIsArray, NativeArray, [value]);
}

export function styleArrayPush<T>(values: T[], value: T): void {
  styleApply(nativeArrayPush, values, [value]);
}

export function styleArrayJoin(values: readonly unknown[], separator: string): string {
  return styleApply(nativeArrayJoin, values, [separator]);
}

export function styleArraySort<T>(values: T[], compare: (left: T, right: T) => number): T[] {
  return styleApply(nativeArraySort, values, [compare]);
}

export function styleDenseArraySnapshot<T>(
  value: unknown,
  label: string,
  map: (entry: unknown, index: number) => T,
): readonly T[] {
  if (!styleArrayIsArray(value)) throw new TypeError(`${label} must be an array.`);
  const firstPrototype = styleGetPrototypeOf(value);
  const secondPrototype = styleGetPrototypeOf(value);
  if (firstPrototype !== NativeArray.prototype || secondPrototype !== firstPrototype) {
    throw new TypeError(`${label} must be a stable plain array.`);
  }
  const firstLength = styleGetOwnPropertyDescriptor(value, 'length');
  const secondLength = styleGetOwnPropertyDescriptor(value, 'length');
  if (!sameDataDescriptor(firstLength, secondLength) || typeof firstLength?.value !== 'number') {
    throw new TypeError(`${label}.length must be a stable own data property.`);
  }
  const length = firstLength.value;
  const snapshot: T[] = [];
  for (let index = 0; index < length; index += 1) {
    const first = styleGetOwnPropertyDescriptor(value, `${index}`);
    const second = styleGetOwnPropertyDescriptor(value, `${index}`);
    if (!sameDataDescriptor(first, second)) {
      throw new TypeError(`${label}[${index}] must be a stable own data property.`);
    }
    styleArrayPush(snapshot, map(first?.value, index));
  }
  return styleFreeze(snapshot);
}

export function styleOwnDataEntries(
  value: object,
  label: string,
): readonly (readonly [string, unknown])[] {
  const firstPrototype = styleGetPrototypeOf(value);
  const secondPrototype = styleGetPrototypeOf(value);
  if (
    (firstPrototype !== NativeObject.prototype && firstPrototype !== null) ||
    secondPrototype !== firstPrototype
  ) {
    throw new TypeError(`${label} must be a plain data object.`);
  }
  const entries: (readonly [string, unknown])[] = [];
  const keys = stableOwnKeys(value, label);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string')
      throw new TypeError(`${label} must not contain symbol properties.`);
    const first = styleGetOwnPropertyDescriptor(value, key);
    const second = styleGetOwnPropertyDescriptor(value, key);
    if (!sameDataDescriptor(first, second)) {
      throw new TypeError(`${label}.${key} must be a stable own data property.`);
    }
    if (first?.enumerable) styleArrayPush(entries, styleFreeze([key, first.value] as const));
  }
  return styleFreeze(entries);
}

export function styleOwnDataValue(value: object, property: PropertyKey, label: string): unknown {
  const first = styleGetOwnPropertyDescriptor(value, property);
  const second = styleGetOwnPropertyDescriptor(value, property);
  if (first === undefined && second === undefined) return undefined;
  if (!sameDataDescriptor(first, second)) {
    throw new TypeError(
      `${label}.${styleApply<string>(NativeString, undefined, [property])} must be a stable own data property.`,
    );
  }
  return first?.value;
}

function stableOwnKeys(value: object, label: string): (string | symbol)[] {
  const first = styleApply<(string | symbol)[]>(nativeOwnKeys, NativeReflect, [value]);
  const second = styleApply<(string | symbol)[]>(nativeOwnKeys, NativeReflect, [value]);
  if (first.length !== second.length) throw new TypeError(`${label} must have stable own keys.`);
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) throw new TypeError(`${label} must have stable own keys.`);
  }
  return first;
}

function sameDataDescriptor(
  first: PropertyDescriptor | undefined,
  second: PropertyDescriptor | undefined,
): first is PropertyDescriptor & { value: unknown } {
  return (
    first !== undefined &&
    second !== undefined &&
    'value' in first &&
    'value' in second &&
    first.value === second.value &&
    first.enumerable === second.enumerable &&
    first.configurable === second.configurable &&
    first.writable === second.writable
  );
}

export function styleGetOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  return styleApply(nativeGetOwnPropertyDescriptor, NativeObject, [value, property]);
}

export function styleGetPrototypeOf(value: object): object | null {
  return styleApply(nativeGetPrototypeOf, NativeObject, [value]);
}

export function styleFreeze<T extends object>(value: T): Readonly<T> {
  return styleApply(nativeObjectFreeze, NativeObject, [value]);
}

export function styleNullRecord<Value = unknown>(): Record<string, Value> {
  return styleApply(nativeObjectCreate, NativeObject, [null]);
}

export function styleDefineDataProperty<T extends object>(
  value: T,
  property: PropertyKey,
  propertyValue: unknown,
): void {
  styleApply(nativeObjectDefineProperty, NativeObject, [
    value,
    property,
    {
      configurable: false,
      enumerable: true,
      value: propertyValue,
      writable: false,
    },
  ]);
}

export function styleJsonStringify(value: unknown): string {
  const result = styleApply<string | undefined>(nativeJsonStringify, NativeJSON, [value]);
  if (result === undefined) throw new TypeError('Style identity input is not JSON-serializable.');
  return result;
}

export function styleErrorStack(): string {
  try {
    return new NativeError().stack ?? '';
  } catch {
    // Runtime call-site inference is optional provenance. Intrinsic poisoning in
    // an engine's stack formatter must not enter or abort CSS serialization.
    return '';
  }
}

export function styleNumber(value: unknown): number {
  return styleApply(nativeNumber, undefined, [value]);
}

export function styleNumberIsFinite(value: unknown): value is number {
  return styleApply(nativeNumberIsFinite, NativeNumber, [value]);
}

export function styleMap<K, V>(): Map<K, V> {
  return new NativeMap<K, V>();
}

export function styleMapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return styleApply(nativeMapGet, map, [key]);
}

export function styleMapHas<K>(map: Map<K, unknown>, key: K): boolean {
  return styleApply(nativeMapHas, map, [key]);
}

export function styleMapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  styleApply(nativeMapSet, map, [key, value]);
}

export function styleMapDelete<K>(map: Map<K, unknown>, key: K): void {
  styleApply(nativeMapDelete, map, [key]);
}

export function styleMapEntries<K, V>(map: Map<K, V>): [K, V][] {
  return iteratorSnapshot<[K, V]>(styleApply(nativeMapEntries, map, []));
}

export function styleMapValues<V>(map: Map<unknown, V>): V[] {
  return iteratorSnapshot<V>(styleApply(nativeMapValues, map, []));
}

function iteratorSnapshot<T>(iterator: Iterator<T>): T[] {
  const result: T[] = [];
  for (;;) {
    const step = styleApply<IteratorResult<T>>(nativeMapIteratorNext, iterator, []);
    if (step.done) return result;
    styleArrayPush(result, step.value);
  }
}

export function styleSetHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return styleApply(nativeSetHas, set, [value]);
}

export function styleWeakSet<T extends object>(): WeakSet<T> {
  return new NativeWeakSet<T>();
}

export function styleWeakSetAdd<T extends object>(set: WeakSet<T>, value: T): void {
  styleApply(nativeWeakSetAdd, set, [value]);
}

export function styleWeakSetHas<T extends object>(set: WeakSet<T>, value: T): boolean {
  return styleApply(nativeWeakSetHas, set, [value]);
}

export function styleRegExpExec(pattern: RegExp, value: string): RegExpExecArray | null {
  return styleApply(nativeRegExpExec, pattern, [value]);
}

export function styleStringStartsWith(value: string, search: string): boolean {
  return styleApply(nativeStringStartsWith, value, [search]);
}

export function styleStringCharCodeAt(value: string, index: number): number {
  return styleApply(nativeStringCharCodeAt, value, [index]);
}

export function styleStringValue(value: unknown): string {
  return styleApply(NativeString, undefined, [value]);
}

export function styleStringEndsWith(value: string, search: string): boolean {
  return styleApply(nativeStringEndsWith, value, [search]);
}

export function styleStringIncludes(value: string, search: string): boolean {
  return styleApply(nativeStringIncludes, value, [search]);
}

export function styleStringIndexOf(value: string, search: string): number {
  return styleApply(nativeStringIndexOf, value, [search]);
}

export function styleStringLastIndexOf(value: string, search: string): number {
  return styleApply(nativeStringLastIndexOf, value, [search]);
}

export function styleStringSlice(value: string, start: number, end?: number): string {
  return styleApply(nativeStringSlice, value, end === undefined ? [start] : [start, end]);
}

export function styleStringSplit(value: string, separator: string | RegExp): string[] {
  return styleApply(nativeStringSplit, value, [separator]);
}

export function styleStringTrim(value: string): string {
  return styleApply(nativeStringTrim, value, []);
}

export function styleStringReplace(
  value: string,
  search: string | RegExp,
  replacement: string | ((...args: string[]) => string),
): string {
  return styleApply(nativeStringReplace, value, [search, replacement]);
}

export function styleStringReplaceAll(value: string, search: string, replacement: string): string {
  return styleApply(nativeStringReplaceAll, value, [search, replacement]);
}

export function styleStringToLowerCase(value: string): string {
  return styleApply(nativeStringToLowerCase, value, []);
}

export function styleStringLocaleCompare(left: string, right: string): number {
  return styleApply(nativeStringLocaleCompare, left, [right]);
}

export function styleStringMatch(value: string, pattern: RegExp): RegExpMatchArray | null {
  return styleApply(nativeStringMatch, value, [pattern]);
}

export function styleMathImul(left: number, right: number): number {
  return styleApply(nativeMathImul, NativeMath, [left, right]);
}

export function styleMathMax(left: number, right: number): number {
  return styleApply(nativeMathMax, NativeMath, [left, right]);
}

export function styleMathMin(left: number, right: number): number {
  return styleApply(nativeMathMin, NativeMath, [left, right]);
}

export function styleNumberToBase36(value: number): string {
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  let remaining = value >>> 0;
  if (remaining === 0) return '0';
  let output = '';
  while (remaining > 0) {
    output = (digits[remaining % 36] ?? '') + output;
    remaining = styleApply<number>(nativeMathFloor, NativeMath, [remaining / 36]);
  }
  return output;
}
