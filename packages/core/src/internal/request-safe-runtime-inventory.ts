/* oxlint-disable typescript/unbound-method -- Lockdown invokes captured controls through pinned Reflect.apply. */
/**
 * Exact runtime controls the request-authority classifier may treat as intrinsic (SPEC §6.6).
 *
 * This is data, not provenance. Supported Kovo runners establish provenance by calling
 * `lockRequestSafeRuntimeRealm()` before any authored or caller-controlled package module runs.
 * The security-classifier corpus gate mechanically prevents the classifier's private sets from
 * growing beyond this reviewed inventory.
 *
 * @internal
 */
export const requestSafeGlobalCallables = Object.freeze([
  'BigInt',
  'Boolean',
  'Number',
  'String',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
] as const);

/** @internal */
export const requestSafeGlobalNamespaces = Object.freeze([
  'Array',
  'BigInt',
  'Buffer',
  'Date',
  'Error',
  'JSON',
  'Math',
  'Number',
  'Object',
  'Promise',
  'Reflect',
  'Response',
  'String',
  'Symbol',
  'URL',
  'crypto',
] as const);

/**
 * Exact direct namespace members the request classifier may execute as runtime intrinsics.
 *
 * Keeping this as inert flattened data makes the classifier/runtime alignment gate mechanical
 * without treating nested object-valued properties as trusted capability graphs (SPEC §6.6).
 *
 * @internal
 */
export const requestSafeGlobalNamespaceMemberPaths = Object.freeze([
  'Array.from',
  'Array.fromAsync',
  'Array.isArray',
  'Array.of',
  'BigInt.asIntN',
  'BigInt.asUintN',
  'Buffer.byteLength',
  'Buffer.compare',
  'Buffer.concat',
  'Buffer.from',
  'Buffer.isBuffer',
  'Date.now',
  'Date.parse',
  'Date.UTC',
  'JSON.parse',
  'JSON.stringify',
  'Math.abs',
  'Math.acos',
  'Math.acosh',
  'Math.asin',
  'Math.asinh',
  'Math.atan',
  'Math.atan2',
  'Math.atanh',
  'Math.cbrt',
  'Math.ceil',
  'Math.clz32',
  'Math.cos',
  'Math.cosh',
  'Math.exp',
  'Math.expm1',
  'Math.floor',
  'Math.fround',
  'Math.hypot',
  'Math.imul',
  'Math.log',
  'Math.log10',
  'Math.log1p',
  'Math.log2',
  'Math.max',
  'Math.min',
  'Math.pow',
  'Math.random',
  'Math.round',
  'Math.sign',
  'Math.sin',
  'Math.sinh',
  'Math.sqrt',
  'Math.tan',
  'Math.tanh',
  'Math.trunc',
  'Number.isFinite',
  'Number.isInteger',
  'Number.isNaN',
  'Number.isSafeInteger',
  'Number.parseFloat',
  'Number.parseInt',
  'Object.assign',
  'Object.create',
  'Object.defineProperties',
  'Object.defineProperty',
  'Object.entries',
  'Object.freeze',
  'Object.fromEntries',
  'Object.getOwnPropertyDescriptor',
  'Object.getOwnPropertyDescriptors',
  'Object.getOwnPropertyNames',
  'Object.getOwnPropertySymbols',
  'Object.getPrototypeOf',
  'Object.groupBy',
  'Object.hasOwn',
  'Object.is',
  'Object.isExtensible',
  'Object.isFrozen',
  'Object.isSealed',
  'Object.keys',
  'Object.preventExtensions',
  'Object.seal',
  'Object.setPrototypeOf',
  'Object.values',
  'Promise.all',
  'Promise.allSettled',
  'Promise.any',
  'Promise.race',
  'Promise.reject',
  'Promise.resolve',
  'Promise.try',
  'Promise.withResolvers',
  'Reflect.apply',
  'Reflect.construct',
  'Reflect.defineProperty',
  'Reflect.deleteProperty',
  'Reflect.get',
  'Reflect.getOwnPropertyDescriptor',
  'Reflect.getPrototypeOf',
  'Reflect.has',
  'Reflect.isExtensible',
  'Reflect.ownKeys',
  'Reflect.preventExtensions',
  'Reflect.set',
  'Reflect.setPrototypeOf',
  'Response.error',
  'Response.json',
  'Response.redirect',
  'String.fromCharCode',
  'String.fromCodePoint',
  'String.raw',
  'Symbol.for',
  'Symbol.keyFor',
  'URL.canParse',
  'URL.parse',
  'crypto.getRandomValues',
  'crypto.randomUUID',
] as const);

/** @internal */
export const requestSafeGlobalConstructors = Object.freeze([
  'AbortController',
  'AggregateError',
  'Array',
  'ArrayBuffer',
  'BigInt64Array',
  'BigUint64Array',
  'Blob',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'File',
  'Float32Array',
  'Float64Array',
  'FormData',
  'Headers',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'Map',
  'Promise',
  'RangeError',
  'ReferenceError',
  'RegExp',
  'Request',
  'Response',
  'Set',
  'SyntaxError',
  'TextDecoder',
  'TextEncoder',
  'TypeError',
  'URIError',
  'URL',
  'URLSearchParams',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakSet',
] as const);

/** Callback schedulers that have a separate closed-callback rule in the classifier. @internal */
export const requestSafeCallbackGlobals = Object.freeze([
  'queueMicrotask',
  'setInterval',
  'setTimeout',
] as const);

/**
 * Governed global sinks recognized by dedicated classifier rules, not generic safe-call rules.
 * `fetch` stays separate because its arguments require outbound-egress analysis (SPEC §6.6).
 * @internal
 */
export const requestGovernedGlobalBindings = Object.freeze(['fetch'] as const);

/** Deeply immutable classifier-to-bootstrap alignment record. @internal */
export const requestSafeRuntimeInventory = Object.freeze({
  callbackGlobals: requestSafeCallbackGlobals,
  globalCallables: requestSafeGlobalCallables,
  globalConstructors: requestSafeGlobalConstructors,
  globalNamespaceMemberPaths: requestSafeGlobalNamespaceMemberPaths,
  globalNamespaces: requestSafeGlobalNamespaces,
  governedGlobals: requestGovernedGlobalBindings,
});

type RequestSafeGlobalName =
  | (typeof requestSafeGlobalCallables)[number]
  | (typeof requestSafeGlobalConstructors)[number]
  | (typeof requestSafeGlobalNamespaces)[number]
  | (typeof requestSafeCallbackGlobals)[number]
  | (typeof requestGovernedGlobalBindings)[number];

interface CapturedGlobalBinding {
  readonly descriptor: PropertyDescriptor | undefined;
  readonly name: RequestSafeGlobalName;
  readonly value: unknown;
}

interface FrameworkOwnedGlobalBinding {
  readonly configurable: boolean | undefined;
  readonly enumerable: boolean | undefined;
  readonly getter: (() => unknown) | undefined;
  readonly name: RequestSafeGlobalName;
  readonly setter: ((value: unknown) => void) | undefined;
  readonly value: unknown;
  readonly writable: boolean | undefined;
}

let frameworkOwnedGlobalBindings: readonly FrameworkOwnedGlobalBinding[] | undefined;

const runtimeLockGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const runtimeLockDefineProperty = Object.defineProperty;
const runtimeLockObjectIs = Object.is;

function frameworkOwnedGlobalBinding(name: RequestSafeGlobalName): FrameworkOwnedGlobalBinding {
  const descriptor = runtimeLockGetOwnPropertyDescriptor(globalThis, name);
  return {
    configurable: descriptor?.configurable,
    enumerable: descriptor?.enumerable,
    getter: descriptor !== undefined && 'get' in descriptor ? descriptor.get : undefined,
    name,
    setter: descriptor !== undefined && 'set' in descriptor ? descriptor.set : undefined,
    value: descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined,
    writable: descriptor !== undefined && 'value' in descriptor ? descriptor.writable : undefined,
  };
}

function assertFrameworkOwnedGlobalBindings(
  bindings: readonly FrameworkOwnedGlobalBinding[],
): void {
  for (let index = 0; index < bindings.length; index += 1) {
    const expected = bindings[index]!;
    const current = frameworkOwnedGlobalBinding(expected.name);
    if (
      current.configurable !== expected.configurable ||
      current.enumerable !== expected.enumerable ||
      current.getter !== expected.getter ||
      current.setter !== expected.setter ||
      !runtimeLockObjectIs(current.value, expected.value) ||
      current.writable !== expected.writable
    ) {
      throw new TypeError(
        `Kovo runtime global ${expected.name} no longer has its framework-owned lock.`,
      );
    }
  }
}

/** Runtime-neutral global portion of the classifier inventory. @internal */
export interface RequestSafeRuntimeGlobalInventory {
  readonly callbackGlobals: readonly string[];
  readonly globalCallables: readonly string[];
  readonly globalConstructors: readonly string[];
  readonly globalNamespaceMemberPaths: readonly string[];
  readonly globalNamespaces: readonly string[];
  readonly governedGlobals: readonly string[];
}

/**
 * Pin every classifier-reviewed global to a framework-owned immutable binding (SPEC §6.6 rule 6).
 *
 * Missing platform controls are pinned to `undefined`, so caller code cannot install a lookalike
 * after bootstrap. Host preloads that run before this function remain privileged host compromise;
 * no function fingerprint or probe corpus is used as provenance.
 *
 * @internal
 */
export function lockRequestSafeRuntimeRealm(): void {
  if (frameworkOwnedGlobalBindings !== undefined) {
    assertFrameworkOwnedGlobalBindings(frameworkOwnedGlobalBindings);
    return;
  }
  lockRequestSafeRuntimeRealmWithInventory(requestSafeRuntimeInventory);
  const names: RequestSafeGlobalName[] = [];
  const bindings: FrameworkOwnedGlobalBinding[] = [];
  const appendBindings = (values: readonly RequestSafeGlobalName[]): void => {
    for (let index = 0; index < values.length; index += 1) {
      const name = values[index]!;
      let found = false;
      for (let prior = 0; prior < names.length; prior += 1) {
        if (names[prior] === name) {
          found = true;
          break;
        }
      }
      if (found) continue;
      runtimeLockDefineProperty(names, names.length, {
        configurable: true,
        enumerable: true,
        value: name,
        writable: true,
      });
      runtimeLockDefineProperty(bindings, bindings.length, {
        configurable: true,
        enumerable: true,
        value: Object.freeze(frameworkOwnedGlobalBinding(name)),
        writable: true,
      });
    }
  };
  appendBindings(requestSafeGlobalCallables);
  appendBindings(requestSafeGlobalNamespaces);
  appendBindings(requestSafeGlobalConstructors);
  appendBindings(requestSafeCallbackGlobals);
  appendBindings(requestGovernedGlobalBindings);
  frameworkOwnedGlobalBindings = Object.freeze(bindings);
}

/**
 * Refuse unless a supported runner already installed and preserved the exact realm-wide lock.
 * Unlike the locking entrypoint, this assertion never creates missing state (SPEC §6.6 rule 6).
 *
 * @internal
 */
export function assertRequestSafeRuntimeRealmLocked(): void {
  lockRequestSafeRuntimeRealmWithInventory(requestSafeRuntimeInventory, true);
}

/**
 * Self-contained form used by generated deployment entries that cannot import framework source.
 * The build serializes this function with its boot-pinned source control and supplies the exact
 * shared inventory as inert generated data (SPEC §6.6 rule 6).
 *
 * @internal
 */
export function lockRequestSafeRuntimeRealmWithInventory(
  inventory: RequestSafeRuntimeGlobalInventory,
  requireExisting = false,
): void {
  const RuntimeGlobal = globalThis;
  const NativeArray = RuntimeGlobal.Array;
  const NativeFormData = RuntimeGlobal.FormData;
  const NativeFunction = RuntimeGlobal.Function;
  const NativeHeaders = RuntimeGlobal.Headers;
  const NativeMap = RuntimeGlobal.Map;
  const NativeObject = RuntimeGlobal.Object;
  const NativeReflect = RuntimeGlobal.Reflect;
  const NativeRegExp = RuntimeGlobal.RegExp;
  const NativeSet = RuntimeGlobal.Set;
  const NativeString = RuntimeGlobal.String;
  const NativeSymbol = RuntimeGlobal.Symbol;
  const NativeTypeError = RuntimeGlobal.TypeError;
  const NativeURL = RuntimeGlobal.URL;
  const NativeURLSearchParams = RuntimeGlobal.URLSearchParams;
  const nativeArrayIsArray = NativeArray.isArray;
  const nativeDefineProperty = NativeObject.defineProperty;
  const nativeFreeze = NativeObject.freeze;
  const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const nativeGetPrototypeOf = NativeObject.getPrototypeOf;
  const nativeIsFrozen = NativeObject.isFrozen;
  const nativeIsSealed = NativeObject.isSealed;
  const nativeMapGet = NativeMap.prototype.get;
  const nativeMapSet = NativeMap.prototype.set;
  const nativeObjectIs = NativeObject.is;
  const nativeReflectApply = NativeReflect.apply;
  const nativeReflectOwnKeys = NativeReflect.ownKeys;
  const nativeSeal = NativeObject.seal;
  const nativeSetAdd = NativeSet.prototype.add;
  const nativeSetHas = NativeSet.prototype.has;
  const nativeStringIndexOf = NativeString.prototype.indexOf;
  const nativeStringSlice = NativeString.prototype.slice;
  const nativeStringValue = NativeString;

  const apply = <Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return =>
    nativeReflectApply(fn, receiver, args) as Return;

  // Independent bundles cannot share a module-private idempotence flag. Publish only a frozen,
  // internal realm record after a complete successful lock, then require every later copy to
  // validate the exact inventory and every locked descriptor/identity before returning. The
  // record is idempotence/drift state, never provenance: code that executes before the supported
  // entry is privileged host code, while malformed or incomplete state fails closed (SPEC §6.6).
  const runtimeLockStateSymbol = apply<symbol>(NativeSymbol.for, NativeSymbol, [
    '@kovojs/request-safe-runtime-lock/v1',
  ]);
  const runtimeLockStateDescriptor = apply<PropertyDescriptor | undefined>(
    nativeGetOwnPropertyDescriptor,
    NativeObject,
    [RuntimeGlobal, runtimeLockStateSymbol],
  );

  const exactOwnDataValue = (owner: object, key: PropertyKey): unknown => {
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeGetOwnPropertyDescriptor,
      NativeObject,
      [owner, key],
    );
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new NativeTypeError('Kovo runtime lock record contains a non-data property.');
    }
    return descriptor.value;
  };

  const exactArrayLength = (value: object, label: string): number => {
    const length = exactOwnDataValue(value, 'length');
    if (typeof length !== 'number' || length < 0 || length % 1 !== 0) {
      throw new NativeTypeError(`Kovo runtime lock record ${label} has an invalid length.`);
    }
    return length;
  };

  const exactArrayValue = (value: object, index: number): unknown =>
    exactOwnDataValue(value, nativeStringValue(index));

  const validateRuntimeLockState = (descriptor: PropertyDescriptor): void => {
    if (
      descriptor.configurable !== false ||
      descriptor.enumerable !== false ||
      !('value' in descriptor) ||
      descriptor.writable !== false ||
      (typeof descriptor.value !== 'object' && typeof descriptor.value !== 'function') ||
      descriptor.value === null
    ) {
      throw new NativeTypeError('Kovo runtime lock record is malformed.');
    }
    const state = descriptor.value as object;
    if (!apply<boolean>(nativeIsFrozen, NativeObject, [state])) {
      throw new NativeTypeError('Kovo runtime lock record is mutable.');
    }
    const stateInventory = exactOwnDataValue(state, 'inventory');
    const stateProperties = exactOwnDataValue(state, 'properties');
    const stateTargets = exactOwnDataValue(state, 'targets');
    if (
      (typeof stateInventory !== 'object' && typeof stateInventory !== 'function') ||
      stateInventory === null ||
      !apply<boolean>(nativeIsFrozen, NativeObject, [stateInventory]) ||
      !apply<boolean>(nativeArrayIsArray, NativeArray, [stateProperties]) ||
      !apply<boolean>(nativeIsFrozen, NativeObject, [stateProperties]) ||
      !apply<boolean>(nativeArrayIsArray, NativeArray, [stateTargets]) ||
      !apply<boolean>(nativeIsFrozen, NativeObject, [stateTargets])
    ) {
      throw new NativeTypeError('Kovo runtime lock record is incomplete.');
    }
    const properties = stateProperties as object;
    const targets = stateTargets as object;
    const propertyCount = exactArrayLength(properties, 'properties');
    const targetCount = exactArrayLength(targets, 'targets');
    if (propertyCount === 0 || targetCount === 0) {
      throw new NativeTypeError('Kovo runtime lock record has no descriptor coverage.');
    }

    const validateInventoryArray = (key: keyof RequestSafeRuntimeGlobalInventory): void => {
      const expected = exactOwnDataValue(stateInventory as object, key);
      const current = inventory[key];
      if (
        !apply<boolean>(nativeArrayIsArray, NativeArray, [expected]) ||
        !apply<boolean>(nativeIsFrozen, NativeObject, [expected])
      ) {
        throw new NativeTypeError(`Kovo runtime lock inventory ${key} changed across bundles.`);
      }
      const expectedArray = expected as object;
      const expectedLength = exactArrayLength(expectedArray, key);
      if (expectedLength !== current.length) {
        throw new NativeTypeError(`Kovo runtime lock inventory ${key} changed across bundles.`);
      }
      for (let index = 0; index < expectedLength; index += 1) {
        if (
          !apply<boolean>(nativeObjectIs, NativeObject, [
            exactArrayValue(expectedArray, index),
            current[index],
          ])
        ) {
          throw new NativeTypeError(`Kovo runtime lock inventory ${key} changed across bundles.`);
        }
      }
    };
    validateInventoryArray('callbackGlobals');
    validateInventoryArray('globalCallables');
    validateInventoryArray('globalConstructors');
    validateInventoryArray('globalNamespaceMemberPaths');
    validateInventoryArray('globalNamespaces');
    validateInventoryArray('governedGlobals');

    const propertyRecords: object[] = [];
    const recordsByTarget = new NativeMap<object, object[]>();
    const countMatchingRecords = (target: object, key: PropertyKey): number => {
      const records = apply<object[] | undefined>(nativeMapGet, recordsByTarget, [target]);
      if (records === undefined) return 0;
      let found = 0;
      for (let index = 0; index < records.length; index += 1) {
        if (exactOwnDataValue(records[index]!, 'key') === key) found += 1;
      }
      return found;
    };

    for (let index = 0; index < propertyCount; index += 1) {
      const recordValue = exactArrayValue(properties, index);
      if (
        (typeof recordValue !== 'object' && typeof recordValue !== 'function') ||
        recordValue === null ||
        !apply<boolean>(nativeIsFrozen, NativeObject, [recordValue])
      ) {
        throw new NativeTypeError('Kovo runtime lock descriptor record is malformed.');
      }
      const record = recordValue;
      const target = exactOwnDataValue(record, 'target');
      const key = exactOwnDataValue(record, 'key') as PropertyKey;
      if ((typeof target !== 'object' && typeof target !== 'function') || target === null) {
        throw new NativeTypeError('Kovo runtime lock descriptor target is invalid.');
      }
      let targetRecords = apply<object[] | undefined>(nativeMapGet, recordsByTarget, [target]);
      if (targetRecords === undefined) {
        targetRecords = [];
        apply(nativeMapSet, recordsByTarget, [target, targetRecords]);
      } else {
        for (let prior = 0; prior < targetRecords.length; prior += 1) {
          if (exactOwnDataValue(targetRecords[prior]!, 'key') === key) {
            throw new NativeTypeError('Kovo runtime lock descriptor coverage is duplicated.');
          }
        }
      }
      apply(nativeDefineProperty, NativeObject, [
        targetRecords,
        targetRecords.length,
        { configurable: true, enumerable: true, value: record, writable: true },
      ]);
      apply(nativeDefineProperty, NativeObject, [
        propertyRecords,
        propertyRecords.length,
        { configurable: true, enumerable: true, value: record, writable: true },
      ]);
      if (countMatchingRecords(target, key) !== 1) {
        throw new NativeTypeError('Kovo runtime lock descriptor coverage is duplicated.');
      }
      const current = apply<PropertyDescriptor | undefined>(
        nativeGetOwnPropertyDescriptor,
        NativeObject,
        [target, key],
      );
      if (
        current === undefined ||
        current.configurable !== false ||
        exactOwnDataValue(record, 'configurable') !== false ||
        current.enumerable !== exactOwnDataValue(record, 'enumerable') ||
        'value' in current !== exactOwnDataValue(record, 'data')
      ) {
        throw new NativeTypeError('Kovo runtime locked descriptor changed across bundles.');
      }
      if ('value' in current) {
        if (
          current.writable !== false ||
          exactOwnDataValue(record, 'writable') !== false ||
          !apply<boolean>(nativeObjectIs, NativeObject, [
            current.value,
            exactOwnDataValue(record, 'value'),
          ])
        ) {
          throw new NativeTypeError('Kovo runtime locked data identity changed across bundles.');
        }
      } else if (
        !apply<boolean>(nativeObjectIs, NativeObject, [
          current.get,
          exactOwnDataValue(record, 'getter'),
        ]) ||
        !apply<boolean>(nativeObjectIs, NativeObject, [
          current.set,
          exactOwnDataValue(record, 'setter'),
        ])
      ) {
        throw new NativeTypeError('Kovo runtime locked accessor identity changed across bundles.');
      }
    }

    let expectedPropertyCount = 0;
    const coveredTargets = new NativeSet<object>();
    for (let index = 0; index < targetCount; index += 1) {
      const targetValue = exactArrayValue(targets, index);
      if (
        (typeof targetValue !== 'object' && typeof targetValue !== 'function') ||
        targetValue === null
      ) {
        throw new NativeTypeError('Kovo runtime lock target coverage is malformed.');
      }
      const target = targetValue;
      if (!apply<boolean>(nativeIsSealed, NativeObject, [target])) {
        throw new NativeTypeError('Kovo runtime lock target is no longer sealed.');
      }
      if (apply<boolean>(nativeSetHas, coveredTargets, [target])) {
        throw new NativeTypeError('Kovo runtime lock target coverage is duplicated.');
      }
      apply(nativeSetAdd, coveredTargets, [target]);
      const keys = apply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [target]);
      expectedPropertyCount += keys.length;
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        if (countMatchingRecords(target, keys[keyIndex]!) !== 1) {
          throw new NativeTypeError('Kovo runtime lock target descriptor coverage is incomplete.');
        }
      }
    }

    const expectedGlobalNames: string[] = [];
    const appendExpectedGlobalNames = (values: readonly string[]): void => {
      for (let index = 0; index < values.length; index += 1) {
        const name = values[index]!;
        let found = false;
        for (let prior = 0; prior < expectedGlobalNames.length; prior += 1) {
          if (expectedGlobalNames[prior] === name) {
            found = true;
            break;
          }
        }
        if (!found) {
          apply(nativeDefineProperty, NativeObject, [
            expectedGlobalNames,
            expectedGlobalNames.length,
            { configurable: true, enumerable: true, value: name, writable: true },
          ]);
        }
      }
    };
    appendExpectedGlobalNames(inventory.globalCallables);
    appendExpectedGlobalNames(inventory.globalNamespaces);
    appendExpectedGlobalNames(inventory.globalConstructors);
    appendExpectedGlobalNames(inventory.callbackGlobals);
    appendExpectedGlobalNames(inventory.governedGlobals);
    appendExpectedGlobalNames(['globalThis']);
    for (let index = 0; index < expectedGlobalNames.length; index += 1) {
      const name = expectedGlobalNames[index]!;
      const current = apply<PropertyDescriptor | undefined>(
        nativeGetOwnPropertyDescriptor,
        NativeObject,
        [RuntimeGlobal, name],
      );
      if (
        current === undefined ||
        !('value' in current) ||
        current.configurable !== false ||
        current.writable !== false ||
        countMatchingRecords(RuntimeGlobal, name) !== 1
      ) {
        throw new NativeTypeError(`Kovo runtime global ${name} lost its cross-bundle lock.`);
      }
    }
    expectedPropertyCount += expectedGlobalNames.length;
    if (propertyCount !== expectedPropertyCount) {
      throw new NativeTypeError('Kovo runtime lock descriptor coverage count changed.');
    }
    for (let index = 0; index < propertyCount; index += 1) {
      const record = propertyRecords[index]!;
      const target = exactOwnDataValue(record, 'target');
      if (target === RuntimeGlobal) continue;
      if (!apply<boolean>(nativeSetHas, coveredTargets, [target])) {
        throw new NativeTypeError('Kovo runtime lock descriptor target is outside coverage.');
      }
    }
  };

  if (runtimeLockStateDescriptor !== undefined) {
    validateRuntimeLockState(runtimeLockStateDescriptor);
    return;
  }
  if (requireExisting) {
    throw new NativeTypeError('Kovo request-safe runtime realm is not locked.');
  }

  const lockedDescriptorRecords: object[] = [];
  const recordedLockedTargets: object[] = [];
  const recordLockedProperty = (target: object, key: PropertyKey): void => {
    for (let index = 0; index < lockedDescriptorRecords.length; index += 1) {
      const record = lockedDescriptorRecords[index]!;
      if (
        exactOwnDataValue(record, 'target') === target &&
        exactOwnDataValue(record, 'key') === key
      ) {
        return;
      }
    }
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeGetOwnPropertyDescriptor,
      NativeObject,
      [target, key],
    );
    if (descriptor === undefined) {
      throw new NativeTypeError('Kovo runtime lock lost a descriptor before recording it.');
    }
    const data = 'value' in descriptor;
    const record = {
      configurable: descriptor.configurable,
      data,
      enumerable: descriptor.enumerable,
      getter: data ? undefined : descriptor.get,
      key,
      setter: data ? undefined : descriptor.set,
      target,
      value: data ? descriptor.value : undefined,
      writable: data ? descriptor.writable : undefined,
    };
    apply(nativeFreeze, NativeObject, [record]);
    apply(nativeDefineProperty, NativeObject, [
      lockedDescriptorRecords,
      lockedDescriptorRecords.length,
      { configurable: true, enumerable: true, value: record, writable: true },
    ]);
  };
  const recordLockedTarget = (target: object): void => {
    for (let index = 0; index < recordedLockedTargets.length; index += 1) {
      if (recordedLockedTargets[index] === target) return;
    }
    apply(nativeDefineProperty, NativeObject, [
      recordedLockedTargets,
      recordedLockedTargets.length,
      { configurable: true, enumerable: true, value: target, writable: true },
    ]);
    const keys = apply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [target]);
    for (let index = 0; index < keys.length; index += 1) {
      recordLockedProperty(target, keys[index]!);
    }
  };

  const hiddenProtocolValues: object[] = [];
  const appendHiddenProtocolValue = (value: unknown): void => {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return;
    apply(nativeDefineProperty, NativeObject, [
      hiddenProtocolValues,
      hiddenProtocolValues.length,
      { configurable: true, enumerable: true, value, writable: true },
    ]);
  };
  const nativeArrayIterator = apply<object>(NativeArray.prototype.values, [], []);
  const nativeArrayIteratorPrototype = apply<object | null>(nativeGetPrototypeOf, NativeObject, [
    nativeArrayIterator,
  ]);
  const NativeIteratorPrototype =
    nativeArrayIteratorPrototype === null
      ? null
      : apply<object | null>(nativeGetPrototypeOf, NativeObject, [nativeArrayIteratorPrototype]);
  appendHiddenProtocolValue(nativeArrayIterator);
  appendHiddenProtocolValue(apply(NativeString.prototype[NativeSymbol.iterator], '', []));
  appendHiddenProtocolValue(apply(NativeMap.prototype.entries, new NativeMap(), []));
  appendHiddenProtocolValue(apply(NativeSet.prototype.values, new NativeSet(), []));
  if (typeof NativeURLSearchParams === 'function') {
    appendHiddenProtocolValue(
      apply(NativeURLSearchParams.prototype.entries, new NativeURLSearchParams(), []),
    );
  }
  if (typeof NativeHeaders === 'function') {
    appendHiddenProtocolValue(apply(NativeHeaders.prototype.entries, new NativeHeaders(), []));
  }
  if (typeof NativeFormData === 'function') {
    appendHiddenProtocolValue(apply(NativeFormData.prototype.entries, new NativeFormData(), []));
  }
  appendHiddenProtocolValue(
    apply(NativeRegExp.prototype[NativeSymbol.matchAll], new NativeRegExp('', 'g'), ['']),
  );
  appendHiddenProtocolValue(
    (function* kovoRuntimeGeneratorPrototypeWitness() {
      yield undefined;
    })(),
  );
  appendHiddenProtocolValue(
    (async function* kovoRuntimeAsyncGeneratorPrototypeWitness() {
      yield undefined;
    })(),
  );

  const names: RequestSafeGlobalName[] = [];
  const appendUniqueNames = (values: readonly RequestSafeGlobalName[]): void => {
    for (let index = 0; index < values.length; index += 1) {
      const name = values[index]!;
      let found = false;
      for (let prior = 0; prior < names.length; prior += 1) {
        if (names[prior] === name) {
          found = true;
          break;
        }
      }
      if (!found) {
        apply(nativeDefineProperty, NativeObject, [
          names,
          names.length,
          { configurable: true, enumerable: true, value: name, writable: true },
        ]);
      }
    }
  };
  appendUniqueNames(inventory.globalCallables as readonly RequestSafeGlobalName[]);
  appendUniqueNames(inventory.globalNamespaces as readonly RequestSafeGlobalName[]);
  appendUniqueNames(inventory.globalConstructors as readonly RequestSafeGlobalName[]);
  appendUniqueNames(inventory.callbackGlobals as readonly RequestSafeGlobalName[]);
  appendUniqueNames(inventory.governedGlobals as readonly RequestSafeGlobalName[]);

  if (!apply<boolean>(nativeArrayIsArray, NativeArray, [inventory.globalNamespaceMemberPaths])) {
    throw new NativeTypeError('Kovo runtime namespace member inventory must be an array.');
  }
  const reviewedNamespaceMembers: {
    readonly member: string;
    readonly namespace: RequestSafeGlobalName;
  }[] = [];
  for (let index = 0; index < inventory.globalNamespaceMemberPaths.length; index += 1) {
    const path = inventory.globalNamespaceMemberPaths[index];
    if (typeof path !== 'string') {
      throw new NativeTypeError('Kovo runtime namespace member inventory contains a non-string.');
    }
    const separator = apply<number>(nativeStringIndexOf, path, ['.']);
    if (separator < 1 || separator === path.length - 1) {
      throw new NativeTypeError(
        'Kovo runtime namespace member inventory contains an invalid path.',
      );
    }
    const namespace = apply<string>(nativeStringSlice, path, [0, separator]);
    const member = apply<string>(nativeStringSlice, path, [separator + 1]);
    let namespaceReviewed = false;
    for (let nameIndex = 0; nameIndex < inventory.globalNamespaces.length; nameIndex += 1) {
      if (inventory.globalNamespaces[nameIndex] === namespace) {
        namespaceReviewed = true;
        break;
      }
    }
    if (!namespaceReviewed) {
      throw new NativeTypeError(
        `Kovo runtime namespace member ${path} has no reviewed namespace binding.`,
      );
    }
    apply(nativeDefineProperty, NativeObject, [
      reviewedNamespaceMembers,
      reviewedNamespaceMembers.length,
      {
        configurable: true,
        enumerable: true,
        value: { member, namespace: namespace as RequestSafeGlobalName },
        writable: true,
      },
    ]);
  }

  const captured: CapturedGlobalBinding[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeGetOwnPropertyDescriptor,
      NativeObject,
      [RuntimeGlobal, name],
    );
    const getter = descriptor !== undefined && 'get' in descriptor ? descriptor.get : undefined;
    const value =
      descriptor === undefined
        ? undefined
        : 'value' in descriptor
          ? descriptor.value
          : typeof getter === 'function'
            ? apply(getter, RuntimeGlobal, [])
            : undefined;
    apply(nativeDefineProperty, NativeObject, [
      captured,
      captured.length,
      {
        configurable: true,
        enumerable: true,
        value: { descriptor, name, value },
        writable: true,
      },
    ]);
  }

  const freezeTarget = (value: object): void => {
    apply(nativeFreeze, NativeObject, [value]);
    if (!apply<boolean>(nativeIsFrozen, NativeObject, [value])) {
      throw new NativeTypeError('Kovo runtime lockdown could not freeze an intrinsic control.');
    }
    recordLockedTarget(value);
  };

  const lockedCallables: Function[] = [];

  function guardPrototypeDescriptors(prototype: object): void {
    const keys = apply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [prototype]);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const descriptor = apply<PropertyDescriptor | undefined>(
        nativeGetOwnPropertyDescriptor,
        NativeObject,
        [prototype, key],
      );
      if (descriptor === undefined) continue;
      if (descriptor.configurable === false) {
        if ('value' in descriptor && descriptor.writable !== false) {
          // Array.prototype.length is a non-configurable array-exotic slot, but ECMAScript permits
          // its one-way writable true -> false transition. Pin it before sealing so trusted Array
          // methods cannot inherit attacker-sized length state.
          if (
            prototype === NativeArray.prototype &&
            key === 'length' &&
            apply<boolean>(nativeObjectIs, NativeObject, [descriptor.value, 0])
          ) {
            apply(nativeDefineProperty, NativeObject, [
              prototype,
              key,
              {
                configurable: false,
                enumerable: descriptor.enumerable,
                value: descriptor.value,
                writable: false,
              },
            ]);
            continue;
          }
          throw new NativeTypeError(
            `Kovo runtime lockdown found mutable non-configurable ${nativeStringValue(key)}.`,
          );
        }
        if (
          'get' in descriptor &&
          typeof descriptor.set === 'function' &&
          !prototypeAccessorSetterIsAudited(prototype, key)
        ) {
          throw new NativeTypeError(
            `Kovo runtime lockdown found a mutable non-configurable ${nativeStringValue(key)} accessor.`,
          );
        }
        if ('value' in descriptor && typeof descriptor.value === 'function') {
          lockCallable(descriptor.value);
        }
        if ('get' in descriptor && typeof descriptor.get === 'function') {
          lockCallable(descriptor.get);
        }
        if ('get' in descriptor && typeof descriptor.set === 'function') {
          lockCallable(descriptor.set);
        }
        continue;
      }

      const capturedValue = 'value' in descriptor ? descriptor.value : undefined;
      const capturedGetter = 'get' in descriptor ? descriptor.get : undefined;
      const capturedSetter = 'set' in descriptor ? descriptor.set : undefined;
      if (typeof capturedValue === 'function') {
        lockCallable(capturedValue);
      } else if (typeof capturedValue === 'object' && capturedValue !== null) {
        freezeTarget(capturedValue as object);
      }
      if (typeof capturedGetter === 'function') lockCallable(capturedGetter);
      if (typeof capturedSetter === 'function') {
        if (!prototypeAccessorSetterIsAudited(prototype, key)) {
          throw new NativeTypeError(
            `Kovo runtime lockdown found an unreviewed ${nativeStringValue(key)} setter.`,
          );
        }
        lockCallable(capturedSetter);
      }
      const preserveInstanceDataShadowing =
        'value' in descriptor &&
        typeof capturedValue !== 'function' &&
        descriptor.writable === true;
      const guardedGetter = preserveInstanceDataShadowing
        ? function kovoRuntimePrototypeGetter(): unknown {
            return capturedValue;
          }
        : undefined;
      const guardedSetter = preserveInstanceDataShadowing
        ? function kovoRuntimePrototypeSetter(this: object, next: unknown): void {
            if (this === prototype) {
              throw new NativeTypeError(
                `Kovo runtime prototype ${nativeStringValue(key)} is immutable.`,
              );
            }
            apply(nativeDefineProperty, NativeObject, [
              this,
              key,
              {
                configurable: true,
                enumerable: descriptor.enumerable,
                value: next,
                writable: true,
              },
            ]);
          }
        : undefined;
      if (guardedGetter !== undefined) lockCallable(guardedGetter);
      if (guardedSetter !== undefined) lockCallable(guardedSetter);
      apply(nativeDefineProperty, NativeObject, [
        prototype,
        key,
        preserveInstanceDataShadowing
          ? {
              configurable: false,
              enumerable: descriptor.enumerable,
              get: guardedGetter,
              set: guardedSetter,
            }
          : 'value' in descriptor
            ? {
                configurable: false,
                enumerable: descriptor.enumerable,
                value: capturedValue,
                writable: false,
              }
            : {
                configurable: false,
                enumerable: descriptor.enumerable,
                get: capturedGetter,
                set: capturedSetter,
              },
      ]);
    }

    function prototypeAccessorSetterIsAudited(owner: object, property: PropertyKey): boolean {
      if (owner === NativeObject.prototype && property === '__proto__') return true;
      if (
        owner === NativeFunction.prototype &&
        (property === 'arguments' || property === 'caller')
      ) {
        return true;
      }
      // Node 24 exposes the iterator-helper proposal through %IteratorPrototype%. Its
      // `constructor` and @@toStringTag properties are native configurable accessors with
      // setters, shared by Array/String/Map/Set/Headers/FormData and RegExp matchAll iterators.
      // Preserve those exact boot-captured accessors while making the descriptors immutable.
      if (
        owner === NativeIteratorPrototype &&
        (property === 'constructor' || property === NativeSymbol.toStringTag)
      ) {
        return true;
      }
      if (owner === NativeMap.prototype) {
        switch (property) {
          case 'clear':
          case 'constructor':
          case 'delete':
          case 'entries':
          case 'forEach':
          case 'get':
          case 'has':
          case 'keys':
          case 'set':
          case 'values':
          case NativeSymbol.iterator:
            return true;
          default:
            return false;
        }
      }
      if (owner !== NativeURL.prototype || typeof property !== 'string') return false;
      switch (property) {
        case 'hash':
        case 'host':
        case 'hostname':
        case 'href':
        case 'password':
        case 'pathname':
        case 'port':
        case 'protocol':
        case 'search':
        case 'username':
          return true;
        default:
          return false;
      }
    }
    apply(nativeSeal, NativeObject, [prototype]);
    if (!apply<boolean>(nativeIsSealed, NativeObject, [prototype])) {
      throw new NativeTypeError('Kovo runtime lockdown could not seal an intrinsic prototype.');
    }
    recordLockedTarget(prototype);
  }

  const guardedPrototypes: object[] = [];
  const guardPrototypeOnce = (prototype: object): void => {
    for (let index = 0; index < guardedPrototypes.length; index += 1) {
      if (guardedPrototypes[index] === prototype) return;
    }
    apply(nativeDefineProperty, NativeObject, [
      guardedPrototypes,
      guardedPrototypes.length,
      { configurable: true, enumerable: true, value: prototype, writable: true },
    ]);
    guardPrototypeDescriptors(prototype);
  };

  function lockCallable(value: Function): void {
    for (let index = 0; index < lockedCallables.length; index += 1) {
      if (lockedCallables[index] === value) return;
    }
    apply(nativeDefineProperty, NativeObject, [
      lockedCallables,
      lockedCallables.length,
      { configurable: true, enumerable: true, value, writable: true },
    ]);

    const prototype = apply<PropertyDescriptor | undefined>(
      nativeGetOwnPropertyDescriptor,
      NativeObject,
      [value, 'prototype'],
    );
    if (
      prototype !== undefined &&
      'value' in prototype &&
      typeof prototype.value === 'object' &&
      prototype.value !== null
    ) {
      let current: object | null = prototype.value;
      for (let depth = 0; current !== null && depth < 16; depth += 1) {
        guardPrototypeOnce(current);
        if (current === NativeObject.prototype) break;
        current = apply<object | null>(nativeGetPrototypeOf, NativeObject, [current]);
      }
    }

    let functionPrototype = apply<object | null>(nativeGetPrototypeOf, NativeObject, [value]);
    for (let depth = 0; functionPrototype !== null && depth < 16; depth += 1) {
      guardPrototypeOnce(functionPrototype);
      if (functionPrototype === NativeObject.prototype) break;
      functionPrototype = apply<object | null>(nativeGetPrototypeOf, NativeObject, [
        functionPrototype,
      ]);
    }

    const keys = apply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [value]);
    for (let index = 0; index < keys.length; index += 1) {
      const descriptor = apply<PropertyDescriptor | undefined>(
        nativeGetOwnPropertyDescriptor,
        NativeObject,
        [value, keys[index]!],
      );
      if (descriptor === undefined) continue;
      if ('value' in descriptor && typeof descriptor.value === 'function') {
        lockCallable(descriptor.value);
      }
      if ('get' in descriptor && typeof descriptor.get === 'function') {
        lockCallable(descriptor.get);
      }
      if ('get' in descriptor && typeof descriptor.set === 'function') {
        lockCallable(descriptor.set);
      }
    }
    freezeTarget(value);
  }

  const lockNamespace = (value: object): void => {
    let prototype = apply<object | null>(nativeGetPrototypeOf, NativeObject, [value]);
    for (let depth = 0; prototype !== null && depth < 16; depth += 1) {
      guardPrototypeOnce(prototype);
      if (prototype === NativeObject.prototype) break;
      prototype = apply<object | null>(nativeGetPrototypeOf, NativeObject, [prototype]);
    }
    const keys = apply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [value]);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const descriptor = apply<PropertyDescriptor | undefined>(
        nativeGetOwnPropertyDescriptor,
        NativeObject,
        [value, key],
      );
      if (descriptor === undefined) continue;
      if (descriptor.configurable === false) {
        if ('value' in descriptor && descriptor.writable === true) {
          throw new NativeTypeError(
            `Kovo runtime namespace has mutable non-configurable ${nativeStringValue(key)}.`,
          );
        }
        if ('get' in descriptor && typeof descriptor.set === 'function') {
          throw new NativeTypeError(
            `Kovo runtime namespace has a mutable non-configurable ${nativeStringValue(key)} accessor.`,
          );
        }
        if ('value' in descriptor && typeof descriptor.value === 'function') {
          lockCallable(descriptor.value);
        }
        if ('get' in descriptor && typeof descriptor.get === 'function') {
          lockCallable(descriptor.get);
        }
        continue;
      }
      const capturedGetter = 'get' in descriptor ? descriptor.get : undefined;
      const capturedValue =
        'value' in descriptor
          ? descriptor.value
          : typeof capturedGetter === 'function'
            ? apply(capturedGetter, value, [])
            : undefined;
      if (typeof capturedValue === 'function') lockCallable(capturedValue);
      apply(nativeDefineProperty, NativeObject, [
        value,
        key,
        {
          configurable: false,
          enumerable: descriptor.enumerable,
          value: capturedValue,
          writable: false,
        },
      ]);
    }
    freezeTarget(value);
  };

  // Iterator/generator prototypes are hidden intrinsics: no global constructor directly exposes
  // them, yet spread/for-of/Object.fromEntries and generator execution dispatch through their
  // mutable `next`/iterator methods. Representative pristine instances close those prototype
  // chains before any authored module can evaluate (SPEC §6.6 rule 6).
  for (let index = 0; index < hiddenProtocolValues.length; index += 1) {
    let prototype = apply<object | null>(nativeGetPrototypeOf, NativeObject, [
      hiddenProtocolValues[index]!,
    ]);
    for (let depth = 0; prototype !== null && depth < 16; depth += 1) {
      guardPrototypeOnce(prototype);
      if (prototype === NativeObject.prototype) break;
      prototype = apply<object | null>(nativeGetPrototypeOf, NativeObject, [prototype]);
    }
  }

  // Lock every captured value before publishing immutable global descriptors. Namespaces retain
  // their exact object identity; their own callable members and prototype methods are immutable.
  for (let index = 0; index < captured.length; index += 1) {
    const { name, value } = captured[index]!;
    if (value === undefined) continue;
    if (typeof value === 'function') {
      lockCallable(value);
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      lockNamespace(value);
      continue;
    }
    throw new NativeTypeError(`Kovo runtime lockdown found an invalid global ${name} binding.`);
  }

  for (let index = 0; index < captured.length; index += 1) {
    const { descriptor, name, value } = captured[index]!;
    const current = apply<PropertyDescriptor | undefined>(
      nativeGetOwnPropertyDescriptor,
      NativeObject,
      [RuntimeGlobal, name],
    );
    const getter = current !== undefined && 'get' in current ? current.get : undefined;
    const currentValue =
      current === undefined
        ? undefined
        : 'value' in current
          ? current.value
          : typeof getter === 'function'
            ? apply(getter, RuntimeGlobal, [])
            : undefined;
    if (
      (descriptor === undefined) !== (current === undefined) ||
      !apply<boolean>(nativeObjectIs, NativeObject, [currentValue, value])
    ) {
      throw new NativeTypeError(`Kovo runtime global ${name} changed during bootstrap.`);
    }
    if (current !== undefined && current.configurable === false) {
      if (!('value' in current) || current.writable !== false) {
        throw new NativeTypeError(`Kovo runtime global ${name} cannot be pinned on this platform.`);
      }
      recordLockedProperty(RuntimeGlobal, name);
      continue;
    }
    apply(nativeDefineProperty, NativeObject, [
      RuntimeGlobal,
      name,
      {
        configurable: false,
        enumerable: current?.enumerable ?? false,
        value,
        writable: false,
      },
    ]);
    recordLockedProperty(RuntimeGlobal, name);
  }

  const runtimeGlobalDescriptor = apply<PropertyDescriptor | undefined>(
    nativeGetOwnPropertyDescriptor,
    NativeObject,
    [RuntimeGlobal, 'globalThis'],
  );
  const runtimeGlobalGetter =
    runtimeGlobalDescriptor !== undefined && 'get' in runtimeGlobalDescriptor
      ? runtimeGlobalDescriptor.get
      : undefined;
  const runtimeGlobalValue =
    runtimeGlobalDescriptor === undefined
      ? undefined
      : 'value' in runtimeGlobalDescriptor
        ? runtimeGlobalDescriptor.value
        : typeof runtimeGlobalGetter === 'function'
          ? apply(runtimeGlobalGetter, RuntimeGlobal, [])
          : undefined;
  if (!apply<boolean>(nativeObjectIs, NativeObject, [runtimeGlobalValue, RuntimeGlobal])) {
    throw new NativeTypeError('Kovo runtime globalThis changed during bootstrap.');
  }
  if (runtimeGlobalDescriptor?.configurable === false) {
    if (!('value' in runtimeGlobalDescriptor) || runtimeGlobalDescriptor.writable !== false) {
      throw new NativeTypeError('Kovo runtime globalThis cannot be pinned on this platform.');
    }
  } else {
    apply(nativeDefineProperty, NativeObject, [
      RuntimeGlobal,
      'globalThis',
      {
        configurable: false,
        enumerable: runtimeGlobalDescriptor?.enumerable ?? false,
        value: RuntimeGlobal,
        writable: false,
      },
    ]);
  }
  recordLockedProperty(RuntimeGlobal, 'globalThis');

  for (let index = 0; index < reviewedNamespaceMembers.length; index += 1) {
    const reviewed = reviewedNamespaceMembers[index]!;
    let namespaceValue: unknown;
    for (let bindingIndex = 0; bindingIndex < captured.length; bindingIndex += 1) {
      const binding = captured[bindingIndex]!;
      if (binding.name === reviewed.namespace) {
        namespaceValue = binding.value;
        break;
      }
    }
    if (
      (typeof namespaceValue !== 'object' || namespaceValue === null) &&
      typeof namespaceValue !== 'function'
    ) {
      // A platform may legitimately omit an entire reviewed namespace; its global binding is
      // still pinned to undefined, so caller code cannot install a lookalike after bootstrap.
      continue;
    }
    let owner: object | null = namespaceValue as object;
    let descriptor: PropertyDescriptor | undefined;
    for (let depth = 0; owner !== null && depth < 16; depth += 1) {
      descriptor = apply<PropertyDescriptor | undefined>(
        nativeGetOwnPropertyDescriptor,
        NativeObject,
        [owner, reviewed.member],
      );
      if (descriptor !== undefined) break;
      owner = apply<object | null>(nativeGetPrototypeOf, NativeObject, [owner]);
    }
    if (descriptor === undefined) continue;
    if (
      descriptor.configurable !== false ||
      ('value' in descriptor ? descriptor.writable !== false : typeof descriptor.set === 'function')
    ) {
      throw new NativeTypeError(
        `Kovo runtime namespace member ${reviewed.namespace}.${reviewed.member} is not immutable.`,
      );
    }
  }

  const cloneInventoryArray = (values: readonly string[], label: string): readonly string[] => {
    if (!apply<boolean>(nativeArrayIsArray, NativeArray, [values])) {
      throw new NativeTypeError(`Kovo runtime lock inventory ${label} must be an array.`);
    }
    const clone: string[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (typeof value !== 'string') {
        throw new NativeTypeError(`Kovo runtime lock inventory ${label} contains a non-string.`);
      }
      apply(nativeDefineProperty, NativeObject, [
        clone,
        clone.length,
        { configurable: true, enumerable: true, value, writable: true },
      ]);
    }
    apply(nativeFreeze, NativeObject, [clone]);
    return clone;
  };
  const lockedInventory = {
    callbackGlobals: cloneInventoryArray(inventory.callbackGlobals, 'callbackGlobals'),
    globalCallables: cloneInventoryArray(inventory.globalCallables, 'globalCallables'),
    globalConstructors: cloneInventoryArray(inventory.globalConstructors, 'globalConstructors'),
    globalNamespaceMemberPaths: cloneInventoryArray(
      inventory.globalNamespaceMemberPaths,
      'globalNamespaceMemberPaths',
    ),
    globalNamespaces: cloneInventoryArray(inventory.globalNamespaces, 'globalNamespaces'),
    governedGlobals: cloneInventoryArray(inventory.governedGlobals, 'governedGlobals'),
  };
  apply(nativeFreeze, NativeObject, [lockedInventory]);
  apply(nativeFreeze, NativeObject, [lockedDescriptorRecords]);
  apply(nativeFreeze, NativeObject, [recordedLockedTargets]);
  const runtimeLockState = {
    inventory: lockedInventory,
    properties: lockedDescriptorRecords,
    targets: recordedLockedTargets,
  };
  apply(nativeFreeze, NativeObject, [runtimeLockState]);
  const lateRuntimeLockStateDescriptor = apply<PropertyDescriptor | undefined>(
    nativeGetOwnPropertyDescriptor,
    NativeObject,
    [RuntimeGlobal, runtimeLockStateSymbol],
  );
  if (lateRuntimeLockStateDescriptor !== undefined) {
    throw new NativeTypeError('Kovo runtime lock record appeared during bootstrap.');
  }
  apply(nativeDefineProperty, NativeObject, [
    RuntimeGlobal,
    runtimeLockStateSymbol,
    {
      configurable: false,
      enumerable: false,
      value: runtimeLockState,
      writable: false,
    },
  ]);
  const installedRuntimeLockStateDescriptor = apply<PropertyDescriptor | undefined>(
    nativeGetOwnPropertyDescriptor,
    NativeObject,
    [RuntimeGlobal, runtimeLockStateSymbol],
  );
  if (installedRuntimeLockStateDescriptor === undefined) {
    throw new NativeTypeError('Kovo runtime lock record could not be installed.');
  }
  validateRuntimeLockState(installedRuntimeLockStateDescriptor);

  if (!apply<boolean>(nativeArrayIsArray, NativeArray, [captured])) {
    throw new NativeTypeError('Kovo runtime lockdown lost its intrinsic inventory.');
  }
}
