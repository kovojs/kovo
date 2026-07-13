/* oxlint-disable typescript/unbound-method -- Boot-captured controls lock the static analyzer dependency graph. */
import * as tsMorph from 'ts-morph';
import {
  runtimeSealSet,
  runtimeSet,
  runtimeSetAdd,
  runtimeSnapshotArray,
} from './runtime-security-intrinsics.js';

/**
 * Lock the third-party AST classifier/method surface before authored Vite/config/app code runs.
 *
 * SPEC §6.6 rule 6 makes bootstrap ordering load-bearing: a late app/plugin mutation must not be
 * able to replace a classifier used by the Drizzle security pass. The compiler realm lockdown owns
 * ECMAScript and TypeScript controls, but ts-morph is a separate mutable module graph. Its exported
 * classes expose both static `Node.is*` classifiers and instance traversal methods. Freeze every
 * exported constructor plus its prototype chain, and the exported enum/namespace objects, while
 * this trusted module is initializing. Host code that runs before the supported bootstrap remains
 * part of the host TCB, as specified by §6.6.
 */

const NativeFunction = globalThis.Function;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeTypeError = globalThis.TypeError;
const nativeFreeze = NativeObject.freeze;
const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeIsFrozen = NativeObject.isFrozen;
const nativeObjectValues = NativeObject.values;
const nativeReflectApply = NativeReflect.apply;
const nativeReflectOwnKeys = NativeReflect.ownKeys;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function ownDataValue(value: object, key: PropertyKey): unknown {
  const descriptor = apply<PropertyDescriptor | undefined>(
    nativeGetOwnPropertyDescriptor,
    NativeObject,
    [value, key],
  );
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

/** @internal Boot-pinned own enumerable value traversal for the static proof graph. */
export function drizzleStaticObjectValues<Value>(value: Record<string, Value>): Value[] {
  const values = apply<Value[]>(nativeObjectValues, NativeObject, [value]);
  const length = ownDataValue(values, 'length');
  if (typeof length !== 'number' || length < 0 || length % 1 !== 0) {
    throw new NativeTypeError('Kovo Drizzle Object.values returned an invalid authority array.');
  }
  return values;
}

/** @internal Immutable closure-backed policy set; callers never receive the mutable backing Set. */
export function drizzleStaticReadonlySet<Value>(values: readonly Value[]): ReadonlySet<Value> {
  const snapshot = runtimeSnapshotArray(values, 'Kovo Drizzle static policy set');
  const backing = runtimeSet<Value>();
  for (let index = 0; index < snapshot.length; index += 1) {
    runtimeSetAdd(backing, snapshot[index]!);
  }
  return runtimeSealSet(backing);
}

function freezeAuthority(value: object): void {
  apply(nativeFreeze, NativeObject, [value]);
  if (!apply<boolean>(nativeIsFrozen, NativeObject, [value])) {
    throw new NativeTypeError('Kovo Drizzle could not lock the static analyzer authority graph.');
  }
}

function freezePrototypeChain(prototype: object): void {
  let current: object | null = prototype;
  for (let depth = 0; current !== null && depth < 64; depth += 1) {
    if (current === NativeObject.prototype || current === NativeFunction.prototype) return;
    const next = apply<object | null>(nativeGetPrototypeOf, NativeObject, [current]);
    freezeAuthority(current);
    current = next;
  }
  if (current !== null) {
    throw new NativeTypeError('Kovo Drizzle found an unbounded ts-morph prototype chain.');
  }
}

const exportKeys = apply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [tsMorph]);
for (let index = 0; index < exportKeys.length; index += 1) {
  const exported = ownDataValue(tsMorph, exportKeys[index]!);
  if ((typeof exported !== 'object' || exported === null) && typeof exported !== 'function') {
    continue;
  }
  if (typeof exported === 'function') {
    const prototype = ownDataValue(exported, 'prototype');
    if (typeof prototype === 'object' && prototype !== null) freezePrototypeChain(prototype);
  }
  freezeAuthority(exported);
}

const typescriptNamespace = ownDataValue(tsMorph, 'ts');
if (typeof typescriptNamespace === 'object' && typescriptNamespace !== null) {
  const factory = ownDataValue(typescriptNamespace, 'factory');
  const system = ownDataValue(typescriptNamespace, 'sys');
  if (typeof factory === 'object' && factory !== null) freezeAuthority(factory);
  if (typeof system === 'object' && system !== null) freezeAuthority(system);
  freezeAuthority(typescriptNamespace);
}

const nodeAuthority = ownDataValue(tsMorph, 'Node');
const objectValuesProbe = drizzleStaticObjectValues({ safe: 'value' });
if (
  typeof nodeAuthority !== 'function' ||
  typeof ownDataValue(nodeAuthority, 'isCallExpression') !== 'function' ||
  objectValuesProbe.length !== 1 ||
  ownDataValue(objectValuesProbe, 0) !== 'value'
) {
  throw new NativeTypeError('Kovo Drizzle ts-morph classifier authority is unavailable.');
}
