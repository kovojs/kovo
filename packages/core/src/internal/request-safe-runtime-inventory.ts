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
  'console',
  'crypto',
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

/** Node builtin module facades whose direct exports the classifier currently reviews as safe. @internal */
export const requestSafeNodeBuiltinModules = Object.freeze([
  'assert',
  'assert/strict',
  'buffer',
  'querystring',
  'string_decoder',
  'url',
  'util/types',
] as const);

/** Deeply immutable classifier-to-bootstrap alignment record. @internal */
export const requestSafeRuntimeInventory = Object.freeze({
  callbackGlobals: requestSafeCallbackGlobals,
  globalCallables: requestSafeGlobalCallables,
  globalConstructors: requestSafeGlobalConstructors,
  globalNamespaces: requestSafeGlobalNamespaces,
  nodeBuiltinModules: requestSafeNodeBuiltinModules,
});

type RequestSafeGlobalName =
  | (typeof requestSafeGlobalCallables)[number]
  | (typeof requestSafeGlobalConstructors)[number]
  | (typeof requestSafeGlobalNamespaces)[number]
  | (typeof requestSafeCallbackGlobals)[number];

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
  readonly globalNamespaces: readonly string[];
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
  frameworkOwnedGlobalBindings = Object.freeze(bindings);
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
): void {
  const NativeArray = globalThis.Array;
  const NativeBuffer = globalThis.Buffer;
  const NativeDate = globalThis.Date;
  const NativeObject = globalThis.Object;
  const NativePromise = globalThis.Promise;
  const NativeReflect = globalThis.Reflect;
  const NativeString = globalThis.String;
  const NativeTextDecoder = globalThis.TextDecoder;
  const NativeTextEncoder = globalThis.TextEncoder;
  const NativeTypeError = globalThis.TypeError;
  const NativeURL = globalThis.URL;
  const NativeURLSearchParams = globalThis.URLSearchParams;
  const nativeArrayIsArray = NativeArray.isArray;
  const nativeDefineProperty = NativeObject.defineProperty;
  const nativeFreeze = NativeObject.freeze;
  const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const nativeGetPrototypeOf = NativeObject.getPrototypeOf;
  const nativeIsFrozen = NativeObject.isFrozen;
  const nativeIsSealed = NativeObject.isSealed;
  const nativeObjectIs = NativeObject.is;
  const nativeReflectApply = NativeReflect.apply;
  const nativeReflectOwnKeys = NativeReflect.ownKeys;
  const nativeSeal = NativeObject.seal;
  const nativeStringValue = NativeString;

  const apply = <Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return =>
    nativeReflectApply(fn, receiver, args) as Return;

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

  const captured: CapturedGlobalBinding[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeGetOwnPropertyDescriptor,
      NativeObject,
      [globalThis, name],
    );
    const getter = descriptor !== undefined && 'get' in descriptor ? descriptor.get : undefined;
    const value =
      descriptor === undefined
        ? undefined
        : 'value' in descriptor
          ? descriptor.value
          : typeof getter === 'function'
            ? apply(getter, globalThis, [])
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
  };

  const guardPrototypeDescriptors = (prototype: object): void => {
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
        if ('get' in descriptor && typeof descriptor.set === 'function') {
          throw new NativeTypeError(
            `Kovo runtime lockdown found a mutable non-configurable ${nativeStringValue(key)} accessor.`,
          );
        }
        continue;
      }

      const capturedValue = 'value' in descriptor ? descriptor.value : undefined;
      const capturedGetter = 'get' in descriptor ? descriptor.get : undefined;
      const capturedSetter = 'set' in descriptor ? descriptor.set : undefined;
      if (
        (typeof capturedValue === 'object' && capturedValue !== null) ||
        typeof capturedValue === 'function'
      ) {
        freezeTarget(capturedValue as object);
      }
      const guardedGetter =
        'value' in descriptor
          ? function kovoRuntimePrototypeGetter(): unknown {
              return capturedValue;
            }
          : capturedGetter;
      const guardedSetter = function kovoRuntimePrototypeSetter(this: object, next: unknown): void {
        if (this === prototype) {
          throw new NativeTypeError(
            `Kovo runtime prototype ${nativeStringValue(key)} is immutable.`,
          );
        }
        if ('value' in descriptor) {
          if (descriptor.writable !== true) {
            throw new NativeTypeError(
              `Kovo runtime prototype ${nativeStringValue(key)} is read-only.`,
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
          return;
        }
        if (typeof capturedSetter === 'function') {
          apply(capturedSetter, this, [next]);
          return;
        }
        throw new NativeTypeError(
          `Kovo runtime prototype ${nativeStringValue(key)} has no setter.`,
        );
      };
      const keepImmutableDataMethod =
        'value' in descriptor &&
        typeof capturedValue === 'function' &&
        (prototype === NativeArray.prototype ||
          (typeof NativeBuffer === 'function' && prototype === NativeBuffer.prototype) ||
          prototype === NativeDate.prototype ||
          prototype === NativePromise.prototype ||
          prototype === NativeTextDecoder.prototype ||
          prototype === NativeTextEncoder.prototype ||
          prototype === NativeURL.prototype ||
          prototype === NativeURLSearchParams.prototype);
      apply(nativeDefineProperty, NativeObject, [
        prototype,
        key,
        keepImmutableDataMethod
          ? {
              configurable: false,
              enumerable: descriptor.enumerable,
              value: capturedValue,
              writable: false,
            }
          : {
              configurable: false,
              enumerable: descriptor.enumerable,
              get: guardedGetter,
              set: guardedSetter,
            },
      ]);
    }
    apply(nativeSeal, NativeObject, [prototype]);
    if (!apply<boolean>(nativeIsSealed, NativeObject, [prototype])) {
      throw new NativeTypeError('Kovo runtime lockdown could not seal an intrinsic prototype.');
    }
  };

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

  const lockCallable = (value: Function): void => {
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
    freezeTarget(value);
  };

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
          get() {
            return capturedValue;
          },
          // A no-op setter keeps test-host cleanup and redundant same-realm assignments from
          // throwing while the getter permanently preserves the framework-owned identity.
          set(_next: unknown) {},
        },
      ]);
    }
    freezeTarget(value);
  };

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
      [globalThis, name],
    );
    const getter = current !== undefined && 'get' in current ? current.get : undefined;
    const currentValue =
      current === undefined
        ? undefined
        : 'value' in current
          ? current.value
          : typeof getter === 'function'
            ? apply(getter, globalThis, [])
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
      continue;
    }
    apply(nativeDefineProperty, NativeObject, [
      globalThis,
      name,
      {
        configurable: false,
        enumerable: current?.enumerable ?? false,
        get() {
          return value;
        },
        // Assignment may report success, but the immutable getter never publishes its input.
        // This preserves teardown compatibility without reopening classifier provenance.
        set(_next: unknown) {},
      },
    ]);
  }

  if (!apply<boolean>(nativeArrayIsArray, NativeArray, [captured])) {
    throw new NativeTypeError('Kovo runtime lockdown lost its intrinsic inventory.');
  }
}

/** Lock the CommonJS facades behind every classifier-reviewed Node builtin module. @internal */
export function lockRequestSafeNodeBuiltinFacades(facades: readonly unknown[]): void {
  lockRequestSafeNodeBuiltinFacadesWithInventory(requestSafeNodeBuiltinModules, facades);
}

/**
 * Self-contained generated-entry form of `lockRequestSafeNodeBuiltinFacades`.
 *
 * Node named ESM exports can be rewritten from their mutable CommonJS facade through
 * `syncBuiltinESMExports()`. Freezing only the ESM namespace is therefore not provenance. This
 * locks each facade's complete own-data graph and guards constructor prototypes while preserving
 * instance-owned state (SPEC §6.6 bootstrap rule).
 *
 * @internal
 */
export function lockRequestSafeNodeBuiltinFacadesWithInventory(
  moduleNames: readonly string[],
  facades: readonly unknown[],
): void {
  const NativeArray = globalThis.Array;
  const NativeObject = globalThis.Object;
  const NativeReflect = globalThis.Reflect;
  const NativeString = globalThis.String;
  const NativeTypeError = globalThis.TypeError;
  const NativeWeakSet = globalThis.WeakSet;
  const nativeArrayIsArray = NativeArray.isArray;
  const nativeDefineProperty = NativeObject.defineProperty;
  const nativeFreeze = NativeObject.freeze;
  const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const nativeIsFrozen = NativeObject.isFrozen;
  const nativeIsSealed = NativeObject.isSealed;
  const nativeReflectApply = NativeReflect.apply;
  const nativeReflectOwnKeys = NativeReflect.ownKeys;
  const nativeSeal = NativeObject.seal;
  const nativeStringValue = NativeString;
  const nativeWeakSetAdd = NativeWeakSet.prototype.add;
  const nativeWeakSetHas = NativeWeakSet.prototype.has;

  const apply = <Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return =>
    nativeReflectApply(fn, receiver, args) as Return;
  const has = (set: WeakSet<object>, value: object): boolean =>
    apply<boolean>(nativeWeakSetHas, set, [value]);
  const add = (set: WeakSet<object>, value: object): void => {
    apply(nativeWeakSetAdd, set, [value]);
  };
  const ownDataValue = (value: object, property: PropertyKey): unknown => {
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeGetOwnPropertyDescriptor,
      NativeObject,
      [value, property],
    );
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new NativeTypeError('Kovo Node builtin inventory must use own data properties.');
    }
    return descriptor.value;
  };

  if (
    !apply<boolean>(nativeArrayIsArray, NativeArray, [moduleNames]) ||
    !apply<boolean>(nativeArrayIsArray, NativeArray, [facades]) ||
    moduleNames.length !== facades.length
  ) {
    throw new NativeTypeError('Kovo Node builtin inventory does not match its captured facades.');
  }

  const discovered = new NativeWeakSet<object>();
  const prototypeObjects = new NativeWeakSet<object>();
  const collect = (value: unknown): void => {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return;
    const object = value as object;
    if (has(discovered, object)) return;
    add(discovered, object);
    const keys = apply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [object]);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const descriptor = apply<PropertyDescriptor | undefined>(
        nativeGetOwnPropertyDescriptor,
        NativeObject,
        [object, key],
      );
      if (descriptor === undefined || !('value' in descriptor)) continue;
      if (
        key === 'prototype' &&
        typeof value === 'function' &&
        typeof descriptor.value === 'object' &&
        descriptor.value !== null
      ) {
        add(prototypeObjects, descriptor.value as object);
      }
      collect(descriptor.value);
    }
  };

  for (let index = 0; index < facades.length; index += 1) {
    const moduleName = ownDataValue(moduleNames, index);
    const facade = ownDataValue(facades, index);
    if (typeof moduleName !== 'string') {
      throw new NativeTypeError('Kovo Node builtin inventory contains an invalid module name.');
    }
    if ((typeof facade !== 'object' || facade === null) && typeof facade !== 'function') {
      throw new NativeTypeError(`Kovo Node builtin ${moduleName} facade is unavailable.`);
    }
    collect(facade);
  }

  const locked = new NativeWeakSet<object>();
  const lockPrototype = (prototype: object): void => {
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
        if ('value' in descriptor && descriptor.writable === true) {
          throw new NativeTypeError(
            `Kovo Node builtin prototype has mutable non-configurable ${nativeStringValue(key)}.`,
          );
        }
        // An immutable accessor descriptor may retain its native instance setter. The attacker
        // cannot replace that setter, and invoking it with the prototype itself either performs
        // the native receiver check or affects only native state owned by that exact prototype.
        continue;
      }

      const captured = 'value' in descriptor ? descriptor.value : undefined;
      const capturedGetter = 'get' in descriptor ? descriptor.get : undefined;
      const capturedSetter = 'set' in descriptor ? descriptor.set : undefined;
      const guardedGetter =
        'value' in descriptor
          ? function kovoNodeBuiltinPrototypeGetter(): unknown {
              return captured;
            }
          : capturedGetter;
      const guardedSetter = function kovoNodeBuiltinPrototypeSetter(
        this: object,
        next: unknown,
      ): void {
        if (this === prototype) {
          throw new NativeTypeError(
            `Kovo Node builtin prototype ${nativeStringValue(key)} is immutable.`,
          );
        }
        if (typeof capturedSetter === 'function') {
          apply(capturedSetter, this, [next]);
          return;
        }
        apply(nativeDefineProperty, NativeObject, [
          this,
          key,
          { configurable: true, enumerable: descriptor.enumerable, value: next, writable: true },
        ]);
      };
      apply(nativeDefineProperty, NativeObject, [
        prototype,
        key,
        {
          configurable: false,
          enumerable: descriptor.enumerable,
          get: guardedGetter,
          set: guardedSetter,
        },
      ]);
    }
    apply(nativeSeal, NativeObject, [prototype]);
    if (!apply<boolean>(nativeIsSealed, NativeObject, [prototype])) {
      throw new NativeTypeError('Kovo could not seal a Node builtin prototype.');
    }
  };

  const lock = (value: unknown): void => {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return;
    const object = value as object;
    if (has(locked, object)) return;
    add(locked, object);
    const keys = apply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [object]);
    for (let index = 0; index < keys.length; index += 1) {
      const descriptor = apply<PropertyDescriptor | undefined>(
        nativeGetOwnPropertyDescriptor,
        NativeObject,
        [object, keys[index]!],
      );
      if (descriptor !== undefined && 'value' in descriptor) lock(descriptor.value);
    }
    if (has(prototypeObjects, object)) {
      lockPrototype(object);
      return;
    }

    // Snapshot configurable facade accessors into immutable data. Leaving a setter on a frozen
    // object (for example events.defaultMaxListeners) would still permit shared-process mutation.
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const descriptor = apply<PropertyDescriptor | undefined>(
        nativeGetOwnPropertyDescriptor,
        NativeObject,
        [object, key],
      );
      if (descriptor === undefined || 'value' in descriptor) continue;
      if (descriptor.configurable === false) {
        if (typeof descriptor.set === 'function') {
          throw new NativeTypeError(
            `Kovo Node builtin facade has mutable non-configurable ${nativeStringValue(key)}.`,
          );
        }
        continue;
      }
      const captured =
        typeof descriptor.get === 'function' ? apply(descriptor.get, object, []) : undefined;
      lock(captured);
      apply(nativeDefineProperty, NativeObject, [
        object,
        key,
        {
          configurable: false,
          enumerable: descriptor.enumerable,
          value: captured,
          writable: false,
        },
      ]);
    }
    apply(nativeFreeze, NativeObject, [object]);
    if (!apply<boolean>(nativeIsFrozen, NativeObject, [object])) {
      throw new NativeTypeError('Kovo could not freeze a Node builtin facade.');
    }
  };

  for (let index = 0; index < facades.length; index += 1) {
    lock(ownDataValue(facades, index));
  }
}
