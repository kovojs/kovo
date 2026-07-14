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
  'structuredClone',
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
  'events',
  'querystring',
  'string_decoder',
  'url',
  'util',
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
  const NativeArray = globalThis.Array;
  const NativeObject = globalThis.Object;
  const NativeReflect = globalThis.Reflect;
  const NativeString = globalThis.String;
  const NativeTypeError = globalThis.TypeError;
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
  appendUniqueNames(requestSafeGlobalCallables);
  appendUniqueNames(requestSafeGlobalNamespaces);
  appendUniqueNames(requestSafeGlobalConstructors);
  appendUniqueNames(requestSafeCallbackGlobals);

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

  const guardPrototypeFunctions = (prototype: object): void => {
    const keys = apply<readonly PropertyKey[]>(nativeReflectOwnKeys, NativeReflect, [prototype]);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const descriptor = apply<PropertyDescriptor | undefined>(
        nativeGetOwnPropertyDescriptor,
        NativeObject,
        [prototype, key],
      );
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'function'
      ) {
        continue;
      }
      if (descriptor.configurable === false) {
        if (descriptor.writable !== false) {
          throw new NativeTypeError(
            `Kovo runtime lockdown found mutable non-configurable ${nativeStringValue(key)}.`,
          );
        }
        continue;
      }
      const method = descriptor.value;
      apply(nativeDefineProperty, NativeObject, [
        prototype,
        key,
        {
          configurable: false,
          enumerable: descriptor.enumerable,
          get() {
            return method;
          },
          set(this: object, replacement: unknown) {
            if (this === prototype) {
              throw new NativeTypeError(
                `Kovo runtime lockdown rejected replacement of ${nativeStringValue(key)}.`,
              );
            }
            apply(nativeDefineProperty, NativeObject, [
              this,
              key,
              {
                configurable: true,
                enumerable: descriptor.enumerable,
                value: replacement,
                writable: true,
              },
            ]);
          },
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
    guardPrototypeFunctions(prototype);
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
      const descriptor = apply<PropertyDescriptor | undefined>(
        nativeGetOwnPropertyDescriptor,
        NativeObject,
        [value, keys[index]!],
      );
      if (
        descriptor !== undefined &&
        'value' in descriptor &&
        typeof descriptor.value === 'function'
      ) {
        lockCallable(descriptor.value);
      }
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
        value,
        writable: false,
      },
    ]);
  }

  if (!apply<boolean>(nativeArrayIsArray, NativeArray, [captured])) {
    throw new NativeTypeError('Kovo runtime lockdown lost its intrinsic inventory.');
  }
}
