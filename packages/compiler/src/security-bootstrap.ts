/* oxlint-disable typescript/unbound-method -- Lockdown captures and invokes getters through pinned Reflect.apply. */
/**
 * Compiler-only trust-root entry for supported config/build runners (SPEC §5.2/§6.6).
 *
 * Keep this entry source-loader-safe: Vite+ loads workspace configuration with Node's native
 * TypeScript loader while constructing a task graph, before ordinary Vite resolution can translate
 * framework `.js` source specifiers. This entry therefore uses a source-real `.ts` edge plus only
 * Node builtins and the compiler's declared TypeScript runtime; it never evaluates authored code.
 */
import builtinAssert from 'node:assert';
import builtinAssertStrict from 'node:assert/strict';
import builtinBuffer, { Buffer as BuiltinBuffer } from 'node:buffer';
import builtinCrypto from 'node:crypto';
import builtinFs, { Dirent as BuiltinDirent, Stats as BuiltinStats } from 'node:fs';
import builtinFsPromises from 'node:fs/promises';
import builtinPath from 'node:path';
import builtinQuerystring from 'node:querystring';
import builtinStringDecoder from 'node:string_decoder';
import builtinUrl from 'node:url';
import builtinUtilTypes from 'node:util/types';

import typescript from 'typescript';

import {
  lockRequestSafeNodeBuiltinFacades,
  lockRequestSafeRuntimeRealm,
} from '@kovojs/core/internal/classifier-verdict';

import { assertCompilerSecurityIntrinsics } from './compiler-security-intrinsics.ts';

assertCompilerSecurityIntrinsics();

const NativeArray = globalThis.Array;
const NativeBigInt = globalThis.BigInt;
const NativeBuffer = BuiltinBuffer;
const NativeDate = globalThis.Date;
const NativeFunction = globalThis.Function;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeMath = globalThis.Math;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeSymbol = globalThis.Symbol;
const NativeTextDecoder = globalThis.TextDecoder;
const NativeTextEncoder = globalThis.TextEncoder;
const NativeUint8Array = globalThis.Uint8Array;
const NativeTypeError = globalThis.TypeError;
const NativeURL = globalThis.URL;
const NativeURLSearchParams = globalThis.URLSearchParams;
const NativeWeakMap = globalThis.WeakMap;
const NativeWeakSet = globalThis.WeakSet;
const nativeDefineProperty = NativeObject.defineProperty;
const nativeFreeze = NativeObject.freeze;
const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeIsFrozen = NativeObject.isFrozen;
const nativeIsSealed = NativeObject.isSealed;
const nativeReflectApply = NativeReflect.apply;
const nativeReflectOwnKeys = NativeReflect.ownKeys;
const nativeSeal = NativeObject.seal;

let compilerRealmLocked = false;

/**
 * @internal Irreversibly lock mutable ECMAScript controls before authored config/plugin/app code.
 *
 * The compiler has defense-in-depth captured controls at security decisions, but ordinary lowering
 * code also performs deterministic collection/string work after plugin evaluation. A supported
 * runner makes selective prototype substitution unrepresentable by locking the shared realm before
 * it imports the dispatcher or evaluates the authored graph. Host preloads remain part of the TCB.
 */
export function lockCompilerSecurityRealm(): void {
  assertCompilerSecurityIntrinsics();
  if (compilerRealmLocked) return;

  // Establish the classifier's exact shared inventory first. Its module-private descriptor record
  // is then the sole idempotence authority when the compiler reaches the shared checkpoint again.
  lockRequestSafeRuntimeRealm();

  // Convert prototype functions to non-configurable accessors that always return the captured
  // native function. The guarded setter rejects writes to the prototype itself but permits an
  // instance to install an own method. That distinction is required by Vite, which decorates a
  // package-cache Map instance, while still making realm-wide selective substitution impossible.
  // Framework graphs instantiated inside a later Vite SSR loader capture Array methods from own
  // data descriptors. Array instances do not require the Map-style decoration exception below,
  // so keep these methods immutable data properties across that second trusted preload.
  guardPrototypeFunctions(NativeArray.prototype, false);
  freezeTarget(NativeArray);
  guardPrototypeFunctions(NativeBigInt.prototype);
  freezeTarget(NativeBigInt);
  guardPrototypeFunctions(NativeBuffer.prototype, false);
  freezeTarget(NativeBuffer);
  guardPrototypeFunctions(NativeDate.prototype, false);
  freezeTarget(NativeDate);
  guardPrototypeFunctions(NativeFunction.prototype);
  freezeTarget(NativeFunction);
  freezeTarget(NativeJSON);
  guardPrototypeFunctions(NativeMap.prototype);
  freezeTarget(NativeMap);
  freezeTarget(NativeMath);
  guardPrototypeFunctions(NativeNumber.prototype);
  freezeTarget(NativeNumber);
  guardPrototypeFunctions(NativeObject.prototype);
  freezeTarget(NativeObject);
  // Promise reflection is used by server-side security membranes to distinguish native promises
  // from app-owned accessor thenables. Keep the native methods immutable as data properties: an
  // accessor guard would make the supported build/dev runner itself look like a hostile thenable.
  guardPrototypeFunctions(NativePromise.prototype, false);
  freezeTarget(NativePromise);
  freezeTarget(NativeReflect);
  guardPrototypeFunctions(NativeRegExp.prototype);
  freezeTarget(NativeRegExp);
  guardPrototypeFunctions(NativeSet.prototype);
  freezeTarget(NativeSet);
  guardPrototypeFunctions(NativeString.prototype);
  freezeTarget(NativeString);
  guardPrototypeFunctions(NativeSymbol.prototype);
  freezeTarget(NativeSymbol);
  guardPrototypeFunctions(NativeTextDecoder.prototype, false);
  freezeTarget(NativeTextDecoder);
  guardPrototypeFunctions(NativeTextEncoder.prototype, false);
  freezeTarget(NativeTextEncoder);
  guardPrototypeFunctions(NativeUint8Array.prototype);
  guardPrototypeFunctions(
    apply<object>(nativeGetPrototypeOf, NativeObject, [NativeUint8Array.prototype]),
  );
  freezeTarget(NativeUint8Array);
  guardPrototypeFunctions(NativeURL.prototype, false);
  freezeTarget(NativeURL);
  guardPrototypeFunctions(NativeURLSearchParams.prototype, false);
  freezeTarget(NativeURLSearchParams);
  guardPrototypeFunctions(NativeWeakMap.prototype);
  freezeTarget(NativeWeakMap);
  guardPrototypeFunctions(NativeWeakSet.prototype);
  freezeTarget(NativeWeakSet);

  // Node builtin named ESM exports can be resynchronized from their mutable CommonJS facade.
  // Freeze the facades that own compiler file discovery, path identity, hashing, byte sizing, and
  // URL conversion so an authored plugin cannot poison them and then call syncBuiltinESMExports().
  guardPrototypeFunctions(BuiltinDirent.prototype, false);
  freezeTarget(BuiltinDirent);
  guardPrototypeFunctions(BuiltinStats.prototype, false);
  freezeTarget(BuiltinStats);
  freezeTarget(builtinCrypto);
  freezeTarget(builtinFsPromises);
  freezeTarget(builtinFs);
  freezeTarget(builtinPath);
  freezeTarget(builtinUrl);

  // The compiler imports both the TypeScript namespace and its default CommonJS facade. The
  // facade, factory, and host adapter are otherwise mutable shared objects: a config plugin could
  // replace createSourceFile/factory/sys after preload and selectively omit or rewrite a sink.
  freezeTarget(typescript.factory);
  freezeTarget(typescript.sys);
  freezeTarget(typescript);

  guardPrototypeFunctions(
    apply<object>(nativeGetPrototypeOf, NativeObject, [[][Symbol.iterator]()]),
  );
  guardPrototypeFunctions(
    apply<object>(nativeGetPrototypeOf, NativeObject, [''[Symbol.iterator]()]),
  );
  guardPrototypeFunctions(
    apply<object>(nativeGetPrototypeOf, NativeObject, [new NativeMap()[Symbol.iterator]()]),
  );
  guardPrototypeFunctions(
    apply<object>(nativeGetPrototypeOf, NativeObject, [new NativeSet()[Symbol.iterator]()]),
  );

  pinGlobalBinding('Array', NativeArray);
  pinGlobalBinding('BigInt', NativeBigInt);
  pinGlobalBinding('Buffer', NativeBuffer);
  pinGlobalBinding('Date', NativeDate);
  pinGlobalBinding('Function', NativeFunction);
  pinGlobalBinding('JSON', NativeJSON);
  pinGlobalBinding('Map', NativeMap);
  pinGlobalBinding('Math', NativeMath);
  pinGlobalBinding('Number', NativeNumber);
  pinGlobalBinding('Object', NativeObject);
  pinGlobalBinding('Promise', NativePromise);
  pinGlobalBinding('Reflect', NativeReflect);
  pinGlobalBinding('RegExp', NativeRegExp);
  pinGlobalBinding('Set', NativeSet);
  pinGlobalBinding('String', NativeString);
  pinGlobalBinding('Symbol', NativeSymbol);
  pinGlobalBinding('TextDecoder', NativeTextDecoder);
  pinGlobalBinding('TextEncoder', NativeTextEncoder);
  pinGlobalBinding('Uint8Array', NativeUint8Array);
  pinGlobalBinding('URL', NativeURL);
  pinGlobalBinding('URLSearchParams', NativeURLSearchParams);
  pinGlobalBinding('WeakMap', NativeWeakMap);
  pinGlobalBinding('WeakSet', NativeWeakSet);

  // SPEC §6.6 rule 6: the request-authority classifier's exact reviewed global inventory is
  // broader than the compiler's own implementation intrinsics. Pin that shared inventory too so
  // app/config/package code cannot replace a classifier-trusted callable or constructor.
  lockRequestSafeRuntimeRealm();
  lockRequestSafeNodeBuiltinFacades([
    builtinAssert,
    builtinAssertStrict,
    builtinBuffer,
    builtinQuerystring,
    builtinStringDecoder,
    builtinUrl,
    builtinUtilTypes,
  ]);

  compilerRealmLocked = true;
}

function freezeTarget(value: object): void {
  apply(nativeFreeze, NativeObject, [value]);
  if (!apply<boolean>(nativeIsFrozen, NativeObject, [value])) {
    throw new TypeError('Kovo compiler realm lockdown could not freeze an intrinsic control.');
  }
}

function guardPrototypeFunctions(prototype: object, allowInstanceOverrides = true): void {
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
          `Kovo compiler realm lockdown found mutable non-configurable ${String(key)}.`,
        );
      }
      continue;
    }
    const method = descriptor.value;
    if (!allowInstanceOverrides) {
      apply(nativeDefineProperty, NativeObject, [
        prototype,
        key,
        {
          configurable: false,
          enumerable: descriptor.enumerable,
          value: method,
          writable: false,
        },
      ]);
      continue;
    }
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
              `Kovo compiler realm lockdown rejected replacement of ${String(key)}.`,
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
    throw new NativeTypeError('Kovo compiler realm lockdown could not seal a prototype.');
  }
}

function pinGlobalBinding(name: string, value: unknown): void {
  const descriptor = apply<PropertyDescriptor | undefined>(
    nativeGetOwnPropertyDescriptor,
    NativeObject,
    [globalThis, name],
  );
  const getter = descriptor !== undefined && 'get' in descriptor ? descriptor.get : undefined;
  const currentValue =
    descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : typeof getter === 'function'
        ? apply(getter, globalThis, [])
        : undefined;
  if (descriptor === undefined || currentValue !== value) {
    throw new TypeError(`Kovo compiler realm lockdown found an invalid global ${name} binding.`);
  }
  if (descriptor.configurable === false) return;
  apply(nativeDefineProperty, NativeObject, [
    globalThis,
    name,
    {
      configurable: false,
      enumerable: descriptor.enumerable,
      value,
      writable: false,
    },
  ]);
}

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}
