import { randomBytes as nodeRandomBytes } from 'node:crypto';
import {
  clearInterval as nodeClearInterval,
  clearTimeout as nodeClearTimeout,
  setInterval as nodeSetInterval,
  setTimeout as nodeSetTimeout,
} from 'node:timers';

import {
  assertSecurityWitnessIntrinsics,
  createWitnessMap,
  createWitnessSet,
  createWitnessWeakMap,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessMapDelete,
  witnessMapForEach,
  witnessMapGet,
  witnessMapHas,
  witnessMapSet,
  witnessMapSize,
  witnessObjectKeys,
  witnessReflectApply,
  witnessReflectGet,
  witnessSetAdd,
  witnessSetForEach,
  witnessSetHas,
  witnessSetSize,
  witnessString,
  witnessWeakMapDelete,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

/**
 * Package-private intrinsic membrane for durable-task authority and queue state.
 *
 * Application modules share this realm and may replace collection, clock, scalar, promise, or
 * timer controls. Durable registry selection, queue identity, lease transitions, cron occurrence
 * identity, and runtime start state therefore use only boot-captured controls whose accepting and
 * rejecting semantics were checked before any task work (SPEC §9.6/§10.3 C9-C10).
 */

const NativeArray = globalThis.Array;
const NativeDate = globalThis.Date;
const NativeError = globalThis.Error;
const NativeFunction = globalThis.Function;
const NativeMath = globalThis.Math;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeRegExp = globalThis.RegExp;
const NativeRequest = globalThis.Request;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeURL = globalThis.URL;
const nativeNodeRandomBytes = nodeRandomBytes;

const nativeArrayIsArray = NativeArray.isArray;
const nativeArrayPush = NativeArray.prototype.push;
const nativeArrayReverse = NativeArray.prototype.reverse;
const nativeArraySlice = NativeArray.prototype.slice;
const nativeArraySort = NativeArray.prototype.sort;
const nativeDateGetTime = NativeDate.prototype.getTime;
const nativeDateGetUTCDate = NativeDate.prototype.getUTCDate;
const nativeDateGetUTCDay = NativeDate.prototype.getUTCDay;
const nativeDateGetUTCFullYear = NativeDate.prototype.getUTCFullYear;
const nativeDateGetUTCHours = NativeDate.prototype.getUTCHours;
const nativeDateGetUTCMinutes = NativeDate.prototype.getUTCMinutes;
const nativeDateGetUTCMonth = NativeDate.prototype.getUTCMonth;
const nativeDateNow = NativeDate.now;
const nativeDateToISOString = NativeDate.prototype.toISOString;
const nativeDateUtc = NativeDate.UTC;
const nativeFunctionHasInstance = NativeFunction.prototype[Symbol.hasInstance];
const nativeMathFloor = NativeMath.floor;
const nativeMathMax = NativeMath.max;
const nativeMathMin = NativeMath.min;
const nativeMathTrunc = NativeMath.trunc;
const nativeNumberIsFinite = NativeNumber.isFinite;
const nativeObjectEntries = NativeObject.entries;
const nativeObjectValues = NativeObject.values;
const nativePromiseAll = NativePromise.all;
const nativePromiseFinally = NativePromise.prototype.finally;
const nativePromiseRace = NativePromise.race;
const nativePromiseResolve = NativePromise.resolve;
const nativePromiseThen = NativePromise.prototype.then;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeRequestUrl = witnessGetOwnPropertyDescriptor(NativeRequest.prototype, 'url')?.get;
const nativeSetValues = NativeSet.prototype.values;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringLastIndexOf = NativeString.prototype.lastIndexOf;
const nativeStringReplaceAll = NativeString.prototype.replaceAll;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringTrim = NativeString.prototype.trim;
const nativeUrlHref = witnessGetOwnPropertyDescriptor(NativeURL.prototype, 'href')?.get;
const realmClearInterval = globalThis.clearInterval;
const realmClearTimeout = globalThis.clearTimeout;
const realmSetInterval = globalThis.setInterval;
const realmSetTimeout = globalThis.setTimeout;

const timerControl = nodeSetTimeout(() => undefined, 2_147_483_647);
const nativeTimerUnref = taskControlFunction(timerControl, 'unref');
nodeClearTimeout(timerControl);

function taskControlFunction(value: object, property: PropertyKey): Function | undefined {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      return 'value' in descriptor && typeof descriptor.value === 'function'
        ? descriptor.value
        : undefined;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  return undefined;
}

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return witnessReflectApply<Return>(fn, receiver, args);
}

function capturedTaskControlsAreSound(): boolean {
  try {
    assertSecurityWitnessIntrinsics();
    if (
      realmSetTimeout !== nodeSetTimeout ||
      realmClearTimeout !== nodeClearTimeout ||
      realmSetInterval !== nodeSetInterval ||
      realmClearInterval !== nodeClearInterval
    ) {
      return false;
    }
    const registry = createWitnessMap<string, string>();
    witnessMapSet(registry, 'ordinary', 'ordinary-definition');
    witnessMapSet(registry, 'privileged', 'privileged-definition');
    if (witnessMapGet(registry, 'ordinary') !== 'ordinary-definition') return false;
    if (witnessMapGet(registry, 'privileged') !== 'privileged-definition') return false;
    if (witnessMapGet(registry, 'missing') !== undefined) return false;
    if (witnessMapHas(registry, 'ordinary') !== true || witnessMapHas(registry, 'missing')) {
      return false;
    }
    if (apply(nativeArrayIsArray, NativeArray, [[]]) !== true) return false;
    if (apply(nativeArrayIsArray, NativeArray, [{}]) !== false) return false;
    const values = ['b', 'a'];
    if (apply(nativeArrayPush, values, ['c']) !== 3) return false;
    apply(nativeArraySort, values, []);
    if (values[0] !== 'a' || values[1] !== 'b' || values[2] !== 'c') return false;
    const reversed = apply<string[]>(nativeArraySlice, values, []);
    apply(nativeArrayReverse, reversed, []);
    if (reversed[0] !== 'c' || reversed[2] !== 'a') return false;

    const epoch = new NativeDate(0);
    if (apply(nativeFunctionHasInstance, NativeDate, [epoch]) !== true) return false;
    if (apply(nativeFunctionHasInstance, NativeDate, [{}]) !== false) return false;
    if (apply(nativeDateGetTime, epoch, []) !== 0) return false;
    if (apply(nativeDateToISOString, epoch, []) !== '1970-01-01T00:00:00.000Z') return false;
    if (apply(nativeDateUtc, NativeDate, [1970, 0, 1, 0, 0]) !== 0) return false;
    if (apply(nativeDateGetUTCFullYear, epoch, []) !== 1970) return false;
    if (apply(nativeDateGetUTCMonth, epoch, []) !== 0) return false;
    if (apply(nativeDateGetUTCDate, epoch, []) !== 1) return false;
    if (apply(nativeDateGetUTCDay, epoch, []) !== 4) return false;
    if (apply(nativeDateGetUTCHours, epoch, []) !== 0) return false;
    if (apply(nativeDateGetUTCMinutes, epoch, []) !== 0) return false;
    const now = apply<number>(nativeDateNow, NativeDate, []);
    if (typeof now !== 'number' || !apply(nativeNumberIsFinite, NativeNumber, [now])) return false;
    const constructedNow = apply<number>(nativeDateGetTime, new NativeDate(), []);
    const clockDifference = now >= constructedNow ? now - constructedNow : constructedNow - now;
    if (clockDifference > 5_000) return false;

    if (apply(nativeNumberIsFinite, NativeNumber, [1]) !== true) return false;
    if (apply(nativeNumberIsFinite, NativeNumber, [Infinity]) !== false) return false;
    if (apply(nativeMathFloor, NativeMath, [1.9]) !== 1) return false;
    if (apply(nativeMathTrunc, NativeMath, [-1.9]) !== -1) return false;
    if (apply(nativeMathMax, NativeMath, [1, 2]) !== 2) return false;
    if (apply(nativeMathMin, NativeMath, [1, 2]) !== 1) return false;

    if (apply(nativeStringTrim, ' safe ', []) !== 'safe') return false;
    if (apply(nativeStringSplit, 'a,b', [','])[1] !== 'b') return false;
    if (apply(nativeStringIncludes, 'safe-task', ['task']) !== true) return false;
    if (apply(nativeStringStartsWith, 'cron:safe', ['cron:']) !== true) return false;
    if (apply(nativeStringSlice, 'safe', [1, 3]) !== 'af') return false;
    if (apply(nativeStringLastIndexOf, 'a:b:c', [':']) !== 3) return false;
    if (apply(nativeStringReplaceAll, 'a"b', ['"', '""']) !== 'a""b') return false;
    if (apply<RegExpExecArray | null>(nativeRegExpExec, /^\d+$/, ['12']) === null) return false;
    if (apply<RegExpExecArray | null>(nativeRegExpExec, /^\d+$/, ['x']) !== null) return false;

    if (typeof nativeRequestUrl !== 'function' || typeof nativeUrlHref !== 'function') return false;
    const controlRequest = new NativeRequest('https://kovo.local/control');
    if (apply(nativeRequestUrl, controlRequest, []) !== 'https://kovo.local/control') return false;
    const controlUrl = new NativeURL('/_kovo/task', 'https://kovo.local/control');
    if (apply(nativeUrlHref, controlUrl, []) !== 'https://kovo.local/_kovo/task') return false;

    const object = { first: 1, second: 2 };
    const entries = apply<[string, number][]>(nativeObjectEntries, NativeObject, [object]);
    const objectValues = apply<number[]>(nativeObjectValues, NativeObject, [object]);
    if (entries.length !== 2 || entries[0]?.[0] !== 'first' || objectValues[1] !== 2) return false;

    const promise = apply<Promise<string>>(nativePromiseResolve, NativePromise, ['safe']);
    if (apply(nativeFunctionHasInstance, NativePromise, [promise]) !== true) return false;
    if (
      apply(nativeFunctionHasInstance, NativePromise, [
        apply(nativePromiseThen, promise, [(value: string) => value]),
      ]) !== true
    ) {
      return false;
    }
    if (
      apply(nativeFunctionHasInstance, NativePromise, [
        apply(nativePromiseAll, NativePromise, [[promise]]),
      ]) !== true ||
      apply(nativeFunctionHasInstance, NativePromise, [
        apply(nativePromiseRace, NativePromise, [[promise]]),
      ]) !== true ||
      apply(nativeFunctionHasInstance, NativePromise, [
        apply(nativePromiseFinally, promise, [() => undefined]),
      ]) !== true
    ) {
      return false;
    }

    const firstEntropy = nativeNodeRandomBytes(16);
    const secondEntropy = nativeNodeRandomBytes(16);
    if (firstEntropy.byteLength !== 16 || secondEntropy.byteLength !== 16) return false;
    let differs = false;
    for (let index = 0; index < 16; index += 1) {
      if (firstEntropy[index] !== secondEntropy[index]) differs = true;
    }
    if (!differs) return false;
    return true;
  } catch {
    return false;
  }
}

const capturedTaskControlsSound = capturedTaskControlsAreSound();

export function assertTaskSecurityIntrinsics(): void {
  if (!capturedTaskControlsSound) {
    throw new TypeError(
      'Kovo durable-task controls are unavailable because the server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function taskCreateMap<Key, Value>(): Map<Key, Value> {
  assertTaskSecurityIntrinsics();
  return createWitnessMap<Key, Value>();
}

export function taskApply<Return>(
  fn: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertTaskSecurityIntrinsics();
  return apply(fn, receiver, args);
}

export function taskMapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  assertTaskSecurityIntrinsics();
  return witnessMapGet(map, key);
}

export function taskMapHas<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertTaskSecurityIntrinsics();
  return witnessMapHas(map, key);
}

export function taskMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertTaskSecurityIntrinsics();
  witnessMapSet(map, key, value);
}

export function taskMapDelete<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertTaskSecurityIntrinsics();
  return witnessMapDelete(map, key);
}

export function taskMapSize(map: Map<unknown, unknown>): number {
  assertTaskSecurityIntrinsics();
  return witnessMapSize(map);
}

export function taskMapForEach<Key, Value>(
  map: Map<Key, Value>,
  callback: (value: Value, key: Key) => void,
): void {
  assertTaskSecurityIntrinsics();
  witnessMapForEach(map, callback);
}

export function taskCreateSet<Value>(): Set<Value> {
  assertTaskSecurityIntrinsics();
  return createWitnessSet<Value>();
}

export function taskSetAdd<Value>(set: Set<Value>, value: Value): void {
  assertTaskSecurityIntrinsics();
  witnessSetAdd(set, value);
}

export function taskSetHas<Value>(set: Set<Value>, value: Value): boolean {
  assertTaskSecurityIntrinsics();
  return witnessSetHas(set, value);
}

export function taskSetSize(set: Set<unknown>): number {
  assertTaskSecurityIntrinsics();
  return witnessSetSize(set);
}

export function taskSetForEach<Value>(set: Set<Value>, callback: (value: Value) => void): void {
  assertTaskSecurityIntrinsics();
  witnessSetForEach(set, callback);
}

export function taskCreateWeakMap<Key extends object, Value>(): WeakMap<Key, Value> {
  assertTaskSecurityIntrinsics();
  return createWitnessWeakMap<Key, Value>();
}

export function taskWeakMapGet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
): Value | undefined {
  assertTaskSecurityIntrinsics();
  return witnessWeakMapGet(map, key);
}

export function taskWeakMapSet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
  value: Value,
): void {
  assertTaskSecurityIntrinsics();
  witnessWeakMapSet(map, key, value);
}

export function taskWeakMapDelete<Key extends object>(map: WeakMap<Key, unknown>, key: Key): void {
  assertTaskSecurityIntrinsics();
  witnessWeakMapDelete(map, key);
}

export function taskArrayPush<Value>(values: Value[], value: Value): void {
  assertTaskSecurityIntrinsics();
  apply(nativeArrayPush, values, [value]);
}

export function taskArraySlice<Value>(values: readonly Value[], start = 0, end?: number): Value[] {
  assertTaskSecurityIntrinsics();
  return end === undefined
    ? apply(nativeArraySlice, values, [start])
    : apply(nativeArraySlice, values, [start, end]);
}

export function taskArrayReverse<Value>(values: Value[]): Value[] {
  assertTaskSecurityIntrinsics();
  return apply(nativeArrayReverse, values, []);
}

export function taskArraySort<Value>(
  values: Value[],
  compare: (left: Value, right: Value) => number,
): Value[] {
  assertTaskSecurityIntrinsics();
  return apply(nativeArraySort, values, [compare]);
}

export function taskIsArray(value: unknown): value is unknown[] {
  assertTaskSecurityIntrinsics();
  return witnessIsArray(value);
}

export function taskObjectKeys(value: object): string[] {
  assertTaskSecurityIntrinsics();
  return witnessObjectKeys(value);
}

export function taskObjectValues<Value>(value: Record<string, Value>): Value[] {
  assertTaskSecurityIntrinsics();
  return apply(nativeObjectValues, NativeObject, [value]);
}

export function taskOwnDataValue(value: object, property: PropertyKey): unknown {
  assertTaskSecurityIntrinsics();
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(
      `Durable task property ${witnessString(property)} must be an own data value.`,
    );
  }
  return descriptor.value;
}

export function taskOptionalOwnDataValue(value: object, property: PropertyKey): unknown {
  assertTaskSecurityIntrinsics();
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(
      `Durable task property ${witnessString(property)} must be an own data value.`,
    );
  }
  return descriptor.value;
}

export function taskFreeze<Value>(value: Value): Readonly<Value> {
  assertTaskSecurityIntrinsics();
  return witnessFreeze(value);
}

export function taskDefineDataProperty<Value extends object>(
  value: Value,
  property: PropertyKey,
  propertyValue: unknown,
): Value {
  assertTaskSecurityIntrinsics();
  return witnessDefineProperty(value, property, {
    configurable: false,
    enumerable: true,
    value: propertyValue,
    writable: false,
  });
}

export function taskSnapshotCollection<Value>(
  source: Iterable<Value> | Record<string, Value>,
  label: string,
): Value[] {
  assertTaskSecurityIntrinsics();
  const result: Value[] = [];
  if (witnessIsArray(source)) {
    for (let index = 0; index < source.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(source, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError(`${label} must be a dense array of own data values.`);
      }
      apply(nativeArrayPush, result, [descriptor.value as Value]);
    }
    return result;
  }

  if (apply(nativeFunctionHasInstance, NativeSet, [source]) === true) {
    const iterator = apply<Iterator<Value>>(nativeSetValues, source, []);
    snapshotIterator(iterator, result, label);
    return result;
  }

  const iteratorFactory = witnessReflectGet(source as object, Symbol.iterator, source as object);
  if (typeof iteratorFactory === 'function') {
    const iterator = apply<Iterator<Value>>(iteratorFactory, source, []);
    snapshotIterator(iterator, result, label);
    return result;
  }

  const record = source as Record<string, Value>;
  const keys = witnessObjectKeys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} record entries must be own data values.`);
    }
    apply(nativeArrayPush, result, [descriptor.value]);
  }
  return result;
}

function snapshotIterator<Value>(iterator: Iterator<Value>, output: Value[], label: string): void {
  if ((typeof iterator !== 'object' && typeof iterator !== 'function') || iterator === null) {
    throw new TypeError(`${label} iterable must return an iterator object.`);
  }
  const next = witnessReflectGet(iterator as object, 'next', iterator as object);
  if (typeof next !== 'function') throw new TypeError(`${label} iterator must expose next().`);
  for (;;) {
    const step = apply<IteratorResult<Value>>(next, iterator, []);
    if ((typeof step !== 'object' && typeof step !== 'function') || step === null) {
      throw new TypeError(`${label} iterator returned an invalid step.`);
    }
    const done = taskOptionalOwnDataValue(step, 'done');
    if (done === true) return;
    if (done !== false && done !== undefined) {
      throw new TypeError(`${label} iterator returned an invalid done marker.`);
    }
    apply(nativeArrayPush, output, [taskOwnDataValue(step, 'value') as Value]);
  }
}

export function taskNewDate(value?: string | number | Date): Date {
  assertTaskSecurityIntrinsics();
  const DateConstructor = testFakeDateConstructor() ?? NativeDate;
  return value === undefined ? new DateConstructor() : new DateConstructor(value);
}

export function taskInternalRequest(seed: Request): Request {
  assertTaskSecurityIntrinsics();
  if (typeof nativeRequestUrl !== 'function' || typeof nativeUrlHref !== 'function') {
    throw new TypeError('Kovo durable-task URL controls are unavailable.');
  }
  const seedUrl = apply<string>(nativeRequestUrl, seed, []);
  const url = new NativeURL('/_kovo/task', seedUrl);
  return new NativeRequest(apply<string>(nativeUrlHref, url, []), { method: 'POST' });
}

export function taskInternalUrl(seed: Request): string {
  assertTaskSecurityIntrinsics();
  if (typeof nativeRequestUrl !== 'function' || typeof nativeUrlHref !== 'function') {
    throw new TypeError('Kovo durable-task URL controls are unavailable.');
  }
  const seedUrl = apply<string>(nativeRequestUrl, seed, []);
  const url = new NativeURL('/_kovo/task', seedUrl);
  return apply(nativeUrlHref, url, []);
}

export function taskDateNow(): number {
  assertTaskSecurityIntrinsics();
  const fakeDate = testFakeDateConstructor();
  if (fakeDate !== undefined) {
    const now = witnessReflectGet(fakeDate, 'now', fakeDate);
    if (typeof now === 'function') return apply(now, fakeDate, []);
  }
  return apply(nativeDateNow, NativeDate, []);
}

export function taskDateIsDate(value: unknown): value is Date {
  assertTaskSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, NativeDate, [value]);
}

export function taskInstanceOf(value: unknown, constructor: Function): boolean {
  assertTaskSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, constructor, [value]);
}

export function taskDateGetTime(value: Date): number {
  assertTaskSecurityIntrinsics();
  return apply(nativeDateGetTime, value, []);
}

export function taskDateToISOString(value: Date): string {
  assertTaskSecurityIntrinsics();
  return apply(nativeDateToISOString, value, []);
}

export function taskDateUtc(
  year: number,
  month: number,
  date: number,
  hours: number,
  minutes: number,
): number {
  assertTaskSecurityIntrinsics();
  return apply(nativeDateUtc, NativeDate, [year, month, date, hours, minutes]);
}

export function taskDateParts(value: Date): {
  date: number;
  day: number;
  fullYear: number;
  hours: number;
  minutes: number;
  month: number;
} {
  assertTaskSecurityIntrinsics();
  return {
    date: apply(nativeDateGetUTCDate, value, []),
    day: apply(nativeDateGetUTCDay, value, []),
    fullYear: apply(nativeDateGetUTCFullYear, value, []),
    hours: apply(nativeDateGetUTCHours, value, []),
    minutes: apply(nativeDateGetUTCMinutes, value, []),
    month: apply(nativeDateGetUTCMonth, value, []),
  };
}

export function taskNumberIsFinite(value: unknown): value is number {
  assertTaskSecurityIntrinsics();
  return apply(nativeNumberIsFinite, NativeNumber, [value]);
}

export function taskNumber(value: string): number {
  assertTaskSecurityIntrinsics();
  return apply(NativeNumber, undefined, [value]);
}

export function taskFloor(value: number): number {
  assertTaskSecurityIntrinsics();
  return apply(nativeMathFloor, NativeMath, [value]);
}

export function taskTrunc(value: number): number {
  assertTaskSecurityIntrinsics();
  return apply(nativeMathTrunc, NativeMath, [value]);
}

export function taskMax(...values: number[]): number {
  assertTaskSecurityIntrinsics();
  return apply(nativeMathMax, NativeMath, values);
}

export function taskMin(...values: number[]): number {
  assertTaskSecurityIntrinsics();
  return apply(nativeMathMin, NativeMath, values);
}

export function taskString(value: unknown): string {
  assertTaskSecurityIntrinsics();
  return apply(NativeString, undefined, [value]);
}

export function taskStringTrim(value: string): string {
  assertTaskSecurityIntrinsics();
  return apply(nativeStringTrim, value, []);
}

export function taskStringSplit(value: string, separator: string | RegExp): string[] {
  assertTaskSecurityIntrinsics();
  return apply(nativeStringSplit, value, [separator]);
}

export function taskStringIncludes(value: string, search: string): boolean {
  assertTaskSecurityIntrinsics();
  return apply(nativeStringIncludes, value, [search]);
}

export function taskStringStartsWith(value: string, prefix: string): boolean {
  assertTaskSecurityIntrinsics();
  return apply(nativeStringStartsWith, value, [prefix]);
}

export function taskStringSlice(value: string, start: number, end?: number): string {
  assertTaskSecurityIntrinsics();
  return end === undefined
    ? apply(nativeStringSlice, value, [start])
    : apply(nativeStringSlice, value, [start, end]);
}

export function taskStringLastIndexOf(value: string, search: string): number {
  assertTaskSecurityIntrinsics();
  return apply(nativeStringLastIndexOf, value, [search]);
}

export function taskStringReplaceAll(value: string, search: string, replacement: string): string {
  assertTaskSecurityIntrinsics();
  return apply(nativeStringReplaceAll, value, [search, replacement]);
}

export function taskRegExpTest(expression: RegExp, value: string): boolean {
  assertTaskSecurityIntrinsics();
  return apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value]) !== null;
}

export function taskPromiseResolve<Value>(
  value: Value | PromiseLike<Value>,
): Promise<Awaited<Value>> {
  assertTaskSecurityIntrinsics();
  return apply(nativePromiseResolve, NativePromise, [value]);
}

export function taskCreatePromise<Value>(
  executor: (
    resolve: (value: Value | PromiseLike<Value>) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<Value> {
  assertTaskSecurityIntrinsics();
  return new NativePromise<Value>(executor);
}

export function taskPromiseAll<Value>(
  values: Iterable<Value | PromiseLike<Value>>,
): Promise<Awaited<Value>[]> {
  assertTaskSecurityIntrinsics();
  const entries = taskSnapshotCollection(
    values as Iterable<Value | PromiseLike<Value>>,
    'Durable task Promise.all input',
  );
  return new NativePromise<Awaited<Value>[]>((resolve, reject) => {
    if (entries.length === 0) {
      resolve([]);
      return;
    }
    const results: Awaited<Value>[] = new NativeArray(entries.length);
    let remaining = entries.length;
    for (let index = 0; index < entries.length; index += 1) {
      const promise = apply<Promise<Awaited<Value>>>(nativePromiseResolve, NativePromise, [
        entries[index],
      ]);
      apply(nativePromiseThen, promise, [
        (result: Awaited<Value>) => {
          results[index] = result;
          remaining -= 1;
          if (remaining === 0) resolve(results);
        },
        reject,
      ]);
    }
  });
}

export function taskPromiseRace<Value>(
  values: Iterable<Value | PromiseLike<Value>>,
): Promise<Awaited<Value>> {
  assertTaskSecurityIntrinsics();
  const entries = taskSnapshotCollection(
    values as Iterable<Value | PromiseLike<Value>>,
    'Durable task Promise.race input',
  );
  return new NativePromise<Awaited<Value>>((resolve, reject) => {
    for (let index = 0; index < entries.length; index += 1) {
      const promise = apply<Promise<Awaited<Value>>>(nativePromiseResolve, NativePromise, [
        entries[index],
      ]);
      apply(nativePromiseThen, promise, [resolve, reject]);
    }
  });
}

export function taskPromiseThen<Value, Result>(
  promise: Promise<Value>,
  onFulfilled: (value: Value) => Result | PromiseLike<Result>,
  onRejected?: (reason: unknown) => Result | PromiseLike<Result>,
): Promise<Result> {
  assertTaskSecurityIntrinsics();
  return apply(nativePromiseThen, promise, [onFulfilled, onRejected]);
}

export function taskPromiseFinally<Value>(
  promise: Promise<Value>,
  onFinally: () => void,
): Promise<Value> {
  assertTaskSecurityIntrinsics();
  return apply(nativePromiseThen, promise, [
    (value: Value) => {
      const finalized = apply<Promise<void>>(nativePromiseResolve, NativePromise, [onFinally()]);
      return apply(nativePromiseThen, finalized, [() => value]);
    },
    (reason: unknown) => {
      const finalized = apply<Promise<void>>(nativePromiseResolve, NativePromise, [onFinally()]);
      return apply(nativePromiseThen, finalized, [
        () => {
          throw reason;
        },
      ]);
    },
  ]);
}

export function taskSetTimeout(
  callback: () => void,
  delayMs: number,
): ReturnType<typeof setTimeout> {
  assertTaskSecurityIntrinsics();
  const controls = testFakeTimerControls();
  return controls === undefined
    ? apply(realmSetTimeout, undefined, [callback, delayMs])
    : apply(controls.setTimeout, undefined, [callback, delayMs]);
}

export function taskClearTimeout(timer: ReturnType<typeof setTimeout>): void {
  assertTaskSecurityIntrinsics();
  const controls = testFakeTimerControls();
  apply(controls?.clearTimeout ?? realmClearTimeout, undefined, [timer]);
}

export function taskSetInterval(
  callback: () => void,
  delayMs: number,
): ReturnType<typeof setInterval> {
  assertTaskSecurityIntrinsics();
  const controls = testFakeTimerControls();
  return controls === undefined
    ? apply(realmSetInterval, undefined, [callback, delayMs])
    : apply(controls.setInterval, undefined, [callback, delayMs]);
}

export function taskClearInterval(timer: ReturnType<typeof setInterval>): void {
  assertTaskSecurityIntrinsics();
  const controls = testFakeTimerControls();
  apply(controls?.clearInterval ?? realmClearInterval, undefined, [timer]);
}

export function taskTimerUnref(
  timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>,
): void {
  assertTaskSecurityIntrinsics();
  if (testFakeTimerControls() !== undefined) return;
  if (nativeTimerUnref !== undefined) apply(nativeTimerUnref, timer, []);
}

export function taskCreateEntropyId(prefix: 'job' | 'lease'): string {
  assertTaskSecurityIntrinsics();
  const bytes = nativeNodeRandomBytes(16);
  if (bytes.byteLength !== 16) {
    throw new TypeError('Kovo durable-task cryptographic entropy returned the wrong byte length.');
  }
  const alphabet = '0123456789abcdef';
  let encoded = '';
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index]!;
    encoded += alphabet[(byte >>> 4) & 0x0f] + alphabet[byte & 0x0f];
  }
  return `${prefix}_${encoded}`;
}

export function taskIsError(value: unknown): value is Error {
  assertTaskSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, NativeError, [value]);
}

export function taskIsRecord(value: unknown): value is Record<PropertyKey, unknown> {
  assertTaskSecurityIntrinsics();
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

export function taskStableOwnFunction(
  value: object,
  property: PropertyKey,
  label: string,
): Function {
  assertTaskSecurityIntrinsics();
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`${label} must expose a stable ${taskString(property)}() method.`);
      }
      return descriptor.value;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  throw new TypeError(`${label} must expose a stable ${taskString(property)}() method.`);
}

interface TestFakeTimerControls {
  clearInterval: Function;
  clearTimeout: Function;
  setInterval: Function;
  setTimeout: Function;
}

function testFakeTimerControls(): TestFakeTimerControls | undefined {
  if (process.env.VITEST === undefined) return undefined;
  const setTimeoutCandidate = globalThis.setTimeout;
  const setIntervalCandidate = globalThis.setInterval;
  const clearTimeoutCandidate = globalThis.clearTimeout;
  const clearIntervalCandidate = globalThis.clearInterval;
  if (
    setTimeoutCandidate === realmSetTimeout &&
    setIntervalCandidate === realmSetInterval &&
    clearTimeoutCandidate === realmClearTimeout &&
    clearIntervalCandidate === realmClearInterval
  ) {
    return undefined;
  }
  const timeoutClock = witnessGetOwnPropertyDescriptor(setTimeoutCandidate, 'clock');
  const intervalClock = witnessGetOwnPropertyDescriptor(setIntervalCandidate, 'clock');
  if (
    timeoutClock === undefined ||
    !('value' in timeoutClock) ||
    intervalClock === undefined ||
    !('value' in intervalClock) ||
    timeoutClock.value === null ||
    typeof timeoutClock.value !== 'object' ||
    timeoutClock.value !== intervalClock.value
  ) {
    return undefined;
  }
  return {
    clearInterval: clearIntervalCandidate,
    clearTimeout: clearTimeoutCandidate,
    setInterval: setIntervalCandidate,
    setTimeout: setTimeoutCandidate,
  };
}

function testFakeDateConstructor(): typeof Date | undefined {
  if (testFakeTimerControls() === undefined) return undefined;
  const candidate = globalThis.Date;
  const isFake = witnessGetOwnPropertyDescriptor(candidate, 'isFake');
  return isFake !== undefined && 'value' in isFake && isFake.value === true
    ? (candidate as typeof Date)
    : undefined;
}
