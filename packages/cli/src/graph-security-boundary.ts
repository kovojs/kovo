/* oxlint-disable typescript/unbound-method -- Verifier controls are captured before app evaluation. */

/**
 * Boot-pinned boundary for the public in-process graph verifier.
 *
 * The supported CLI locks the shared realm before app/config evaluation, but `kovoCheck()` and
 * `kovoExplain()` are also importable APIs. Copy their caller-owned data through descriptors and
 * fail closed if a late prototype/global substitution could steer a blocking diagnostic. This is
 * the runtime floor for SPEC.md §2 and §11.4; graph facts remain the proof surface.
 */

const NativeArray = globalThis.Array;
const NativeBoolean = globalThis.Boolean;
const NativeFunction = globalThis.Function;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeSymbol = globalThis.Symbol;
const nativeArrayIsArray = NativeArray.isArray;
const nativeNumberIsFinite = NativeNumber.isFinite;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIs = NativeObject.is;
const nativeObjectIsSealed = NativeObject.isSealed;
const nativeReflectApply = NativeReflect.apply;
const nativeReflectOwnKeys = NativeReflect.ownKeys;
const nativeArrayIterator = NativeArray.prototype[NativeSymbol.iterator];
const nativeMapIterator = NativeMap.prototype[NativeSymbol.iterator];
const nativeSetIterator = NativeSet.prototype[NativeSymbol.iterator];
const nativeStringIterator = NativeString.prototype[NativeSymbol.iterator];

const verifierArrayIterator = nativeApply<Iterator<unknown>>(nativeArrayIterator, [], []);
const verifierMapIterator = nativeApply<Iterator<unknown>>(nativeMapIterator, new NativeMap(), []);
const verifierSetIterator = nativeApply<Iterator<unknown>>(nativeSetIterator, new NativeSet(), []);
const verifierStringIterator = nativeApply<Iterator<unknown>>(nativeStringIterator, '', []);
const NativeArrayIteratorPrototype = nativeApply<object>(nativeObjectGetPrototypeOf, NativeObject, [
  verifierArrayIterator,
]);
const NativeMapIteratorPrototype = nativeApply<object>(nativeObjectGetPrototypeOf, NativeObject, [
  verifierMapIterator,
]);
const NativeSetIteratorPrototype = nativeApply<object>(nativeObjectGetPrototypeOf, NativeObject, [
  verifierSetIterator,
]);
const NativeStringIteratorPrototype = nativeApply<object>(
  nativeObjectGetPrototypeOf,
  NativeObject,
  [verifierStringIterator],
);

const verifierSecurityFailureMessage =
  'Kovo verifier security boundary rejected unstable input or changed controls.';
const maximumVerifierSnapshotDepth = 100;
const maximumVerifierSnapshotNodes = 1_000_000;

interface CapturedSurface {
  readonly descriptors: readonly (PropertyDescriptor | undefined)[];
  readonly keys: readonly PropertyKey[];
  readonly receiver: unknown;
  readonly target: object;
}

interface SnapshotBudget {
  remaining: number;
}

export type GraphVerifierInvocationSnapshot<Input, Options> =
  | { readonly input: Input; readonly ok: true; readonly options: Options }
  | { readonly ok: false };

const capturedSurfaces = [
  captureSurface(NativeArray, NativeArray),
  captureSurface(NativeArray.prototype, []),
  captureSurface(NativeArrayIteratorPrototype, verifierArrayIterator),
  captureSurface(NativeBoolean, NativeBoolean),
  captureSurface(NativeBoolean.prototype, new NativeBoolean(false)),
  captureSurface(NativeFunction, NativeFunction),
  captureSurface(NativeFunction.prototype, function verifierFunctionReceiver() {}),
  captureSurface(NativeJSON, NativeJSON),
  captureSurface(NativeMap, NativeMap),
  captureSurface(NativeMap.prototype, new NativeMap()),
  captureSurface(NativeMapIteratorPrototype, verifierMapIterator),
  captureSurface(NativeNumber, NativeNumber),
  captureSurface(NativeNumber.prototype, new NativeNumber(0)),
  captureSurface(NativeObject, NativeObject),
  captureSurface(
    NativeObject.prototype,
    nativeApply(nativeObjectCreate, NativeObject, [NativeObject.prototype]),
  ),
  captureSurface(NativeReflect, NativeReflect),
  captureSurface(NativeRegExp, NativeRegExp),
  captureSurface(NativeRegExp.prototype, new NativeRegExp('')),
  captureSurface(NativeSet, NativeSet),
  captureSurface(NativeSet.prototype, new NativeSet()),
  captureSurface(NativeSetIteratorPrototype, verifierSetIterator),
  captureSurface(NativeString, NativeString),
  captureSurface(NativeString.prototype, new NativeString('')),
  captureSurface(NativeStringIteratorPrototype, verifierStringIterator),
  captureSurface(NativeSymbol, NativeSymbol),
  captureSurface(NativeSymbol.prototype, NativeSymbol('verifier')),
] as const;

const capturedGlobalBindings = [
  captureGlobalBinding('Array'),
  captureGlobalBinding('Boolean'),
  captureGlobalBinding('Function'),
  captureGlobalBinding('JSON'),
  captureGlobalBinding('Map'),
  captureGlobalBinding('Number'),
  captureGlobalBinding('Object'),
  captureGlobalBinding('Reflect'),
  captureGlobalBinding('RegExp'),
  captureGlobalBinding('Set'),
  captureGlobalBinding('String'),
  captureGlobalBinding('Symbol'),
] as const;

/** Copy graph/options authority, then prove the synchronous verifier can use ordinary intrinsics. */
export function snapshotGraphVerifierInvocation<Input, Options>(
  input: Input,
  options: Options,
): GraphVerifierInvocationSnapshot<Input, Options> {
  try {
    const budget: SnapshotBudget = { remaining: maximumVerifierSnapshotNodes };
    const inputSnapshot = snapshotVerifierData(input, budget, 0) as Input;
    const optionsSnapshot = snapshotVerifierData(options, budget, 0) as Options;
    if (!verifierSecuritySurfacesAreStable()) return { ok: false };
    return { input: inputSnapshot, ok: true, options: optionsSnapshot };
  } catch {
    return { ok: false };
  }
}

/** Stable fail-closed result used before any caller-influenced collection/string method runs. */
export function graphVerifierSecurityFailure(version: string): {
  exitCode: 1;
  output: string;
} {
  return {
    exitCode: 1,
    output: `${version}\nERROR SECURITY ${verifierSecurityFailureMessage}\n`,
  };
}

function snapshotVerifierData(value: unknown, budget: SnapshotBudget, depth: number): unknown {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > maximumVerifierSnapshotDepth) {
    throw new TypeError('Kovo verifier input exceeds the snapshot bound.');
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && nativeApply(nativeNumberIsFinite, NativeNumber, [value]))
  ) {
    return value;
  }
  if (nativeApply(nativeArrayIsArray, NativeArray, [value])) {
    return snapshotVerifierArray(value as readonly unknown[], budget, depth);
  }
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Kovo verifier input must contain only finite JSON data.');
  }

  const prototype = nativeApply<object | null>(nativeObjectGetPrototypeOf, NativeObject, [value]);
  if (prototype !== null && prototype !== NativeObject.prototype) {
    throw new TypeError('Kovo verifier records must use the ordinary or null prototype.');
  }
  const keys = nativeApply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [value]);
  const snapshot = nativeApply<Record<PropertyKey, unknown>>(nativeObjectCreate, NativeObject, [
    null,
  ]);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string') {
      throw new TypeError('Kovo verifier records must not contain symbol keys.');
    }
    const entry = stableOwnDataDescriptor(value, key);
    if (entry.enumerable !== true) {
      throw new TypeError('Kovo verifier records must contain enumerable data.');
    }
    if (entry.value === undefined) continue;
    defineSnapshotData(snapshot, key, snapshotVerifierData(entry.value, budget, depth + 1));
  }
  return snapshot;
}

function snapshotVerifierArray(
  value: readonly unknown[],
  budget: SnapshotBudget,
  depth: number,
): unknown[] {
  const lengthDescriptor = stableOwnDataDescriptor(value, 'length');
  const length = lengthDescriptor.value;
  if (
    typeof length !== 'number' ||
    !nativeApply(nativeNumberIsFinite, NativeNumber, [length]) ||
    length < 0 ||
    length > maximumVerifierSnapshotNodes ||
    length % 1 !== 0
  ) {
    throw new TypeError('Kovo verifier arrays must have a bounded stable length.');
  }
  const keys = nativeApply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [value]);
  if (keys.length !== length + 1) {
    throw new TypeError('Kovo verifier arrays must be dense and contain no extra properties.');
  }
  const snapshot: unknown[] = new NativeArray();
  for (let index = 0; index < length; index += 1) {
    const entry = stableOwnDataDescriptor(value, index);
    if (entry.enumerable !== true) {
      throw new TypeError('Kovo verifier array entries must be enumerable data.');
    }
    defineSnapshotData(snapshot, index, snapshotVerifierData(entry.value, budget, depth + 1));
  }
  return snapshot;
}

function defineSnapshotData(target: object, key: PropertyKey, value: unknown): void {
  nativeApply(nativeObjectDefineProperty, NativeObject, [
    target,
    key,
    {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    },
  ]);
}

function stableOwnDataDescriptor(target: object, key: PropertyKey): PropertyDescriptor {
  const before = descriptor(target, key);
  const after = descriptor(target, key);
  if (
    before === undefined ||
    after === undefined ||
    !sameDescriptor(before, after) ||
    ownDescriptorField(before, 'value').present !== true
  ) {
    throw new TypeError('Kovo verifier input properties must be stable own data.');
  }
  return before;
}

function verifierSecuritySurfacesAreStable(): boolean {
  for (let index = 0; index < capturedSurfaces.length; index += 1) {
    if (!surfaceIsStable(capturedSurfaces[index]!)) return false;
  }
  for (let index = 0; index < capturedGlobalBindings.length; index += 1) {
    const binding = capturedGlobalBindings[index]!;
    const current = descriptor(globalThis, binding.key);
    if (!descriptorRetainsAuthority(binding.descriptor, current, globalThis, globalThis)) {
      return false;
    }
  }
  return true;
}

function captureSurface(target: object, receiver: unknown): CapturedSurface {
  const keys = nativeApply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [target]);
  const descriptors: (PropertyDescriptor | undefined)[] = new NativeArray();
  for (let index = 0; index < keys.length; index += 1) {
    defineSnapshotData(descriptors, index, descriptor(target, keys[index]!));
  }
  return { descriptors, keys, receiver, target };
}

function surfaceIsStable(surface: CapturedSurface): boolean {
  const currentKeys = nativeApply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [
    surface.target,
  ]);
  if (currentKeys.length !== surface.keys.length) return false;
  for (let index = 0; index < surface.keys.length; index += 1) {
    const key = surface.keys[index]!;
    if (!nativeApply(nativeObjectIs, NativeObject, [currentKeys[index], key])) return false;
    if (
      !descriptorRetainsAuthority(
        surface.descriptors[index],
        descriptor(surface.target, key),
        surface.receiver,
        surface.target,
      )
    ) {
      return false;
    }
  }
  return true;
}

function captureGlobalBinding(key: string): {
  readonly descriptor: PropertyDescriptor | undefined;
  readonly key: string;
} {
  return { descriptor: descriptor(globalThis, key), key };
}

function descriptorRetainsAuthority(
  expected: PropertyDescriptor | undefined,
  current: PropertyDescriptor | undefined,
  receiver: unknown,
  target: object,
): boolean {
  if (expected === undefined || current === undefined) return expected === current;
  const expectedValue = ownDescriptorField(expected, 'value');
  const currentValue = ownDescriptorField(current, 'value');
  const expectedGet = ownDescriptorField(expected, 'get');
  const currentGet = ownDescriptorField(current, 'get');
  if (expectedValue.present && typeof expectedValue.value === 'function' && currentGet.present) {
    // `lockCompilerSecurityRealm()` intentionally narrows prototype methods to sealed,
    // non-configurable accessors that always return the boot-captured method.
    if (
      current.configurable !== false ||
      !nativeApply(nativeObjectIsSealed, NativeObject, [target])
    ) {
      return false;
    }
    if (typeof currentGet.value !== 'function') return false;
    let resolved: unknown;
    try {
      resolved = nativeApply(currentGet.value as Function, receiver, []);
    } catch {
      return false;
    }
    return (
      current.configurable === false &&
      nativeApply(nativeObjectIs, NativeObject, [resolved, expectedValue.value]) &&
      current.enumerable === expected.enumerable
    );
  }
  if (expectedValue.present !== currentValue.present) return false;
  if (expectedGet.present !== currentGet.present) return false;
  const expectedSet = ownDescriptorField(expected, 'set');
  const currentSet = ownDescriptorField(current, 'set');
  if (expectedSet.present !== currentSet.present) return false;
  if (
    expectedValue.present &&
    !nativeApply(nativeObjectIs, NativeObject, [expectedValue.value, currentValue.value])
  ) {
    return false;
  }
  if (
    expectedGet.present &&
    !nativeApply(nativeObjectIs, NativeObject, [expectedGet.value, currentGet.value])
  ) {
    return false;
  }
  if (
    expectedSet.present &&
    !nativeApply(nativeObjectIs, NativeObject, [expectedSet.value, currentSet.value])
  ) {
    return false;
  }
  // Lockdown may only narrow mutability/configurability; it may not widen or alter enumeration.
  return (
    current.enumerable === expected.enumerable &&
    !(expected.configurable === false && current.configurable !== false) &&
    !(expected.writable === false && current.writable !== false)
  );
}

function sameDescriptor(left: PropertyDescriptor, right: PropertyDescriptor): boolean {
  const fields = ['configurable', 'enumerable', 'get', 'set', 'value', 'writable'] as const;
  for (let index = 0; index < fields.length; index += 1) {
    const key = fields[index]!;
    const leftField = ownDescriptorField(left, key);
    const rightField = ownDescriptorField(right, key);
    if (
      leftField.present !== rightField.present ||
      (leftField.present &&
        !nativeApply(nativeObjectIs, NativeObject, [leftField.value, rightField.value]))
    ) {
      return false;
    }
  }
  return true;
}

function ownDescriptorField(
  value: PropertyDescriptor,
  key: PropertyKey,
): { present: boolean; value?: unknown } {
  const field = descriptor(value, key);
  return field === undefined || !('value' in field)
    ? { present: false }
    : { present: true, value: field.value };
}

function descriptor(target: object, key: PropertyKey): PropertyDescriptor | undefined {
  return nativeApply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [target, key]);
}

function nativeApply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}
