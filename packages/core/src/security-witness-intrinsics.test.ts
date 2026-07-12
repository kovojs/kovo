import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  freezeSecurityValue,
  securityMap,
  securityMapGet,
  securityMapSet,
  securitySet,
  securitySetAdd,
  securitySetValues,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetHas,
} from './internal/security-witness-intrinsics.js';

const moduleUrl = new URL('./internal/security-witness-intrinsics.ts', import.meta.url).href;

describe('core security witness intrinsics', () => {
  it('uses captured operations after ambient collection/freeze replacement', () => {
    const originalMapGet = Map.prototype.get;
    const originalMapSet = Map.prototype.set;
    const originalWeakSetAdd = WeakSet.prototype.add;
    const originalWeakSetHas = WeakSet.prototype.has;
    const originalFreeze = Object.freeze;
    let mapValue: object | undefined;
    let positive = false;
    let negative = true;
    let frozen = false;
    try {
      Map.prototype.get = () => ({ forged: true });
      Map.prototype.set = function () {
        return this;
      };
      WeakSet.prototype.add = function () {
        return this;
      };
      WeakSet.prototype.has = () => true;
      Object.freeze = ((value: unknown) => value) as typeof Object.freeze;

      const key = {};
      const other = {};
      const value = {};
      const map = securityMap<object, object>();
      securityMapSet(map, key, value);
      mapValue = securityMapGet(map, key);
      const set = securityWeakSet<object>();
      securityWeakSetAdd(set, key);
      positive = securityWeakSetHas(set, key);
      negative = securityWeakSetHas(set, other);
      frozen = Object.isFrozen(freezeSecurityValue({ proof: true }));
    } finally {
      Map.prototype.get = originalMapGet;
      Map.prototype.set = originalMapSet;
      WeakSet.prototype.add = originalWeakSetAdd;
      WeakSet.prototype.has = originalWeakSetHas;
      Object.freeze = originalFreeze;
    }

    expect(mapValue).toBeDefined();
    expect(positive).toBe(true);
    expect(negative).toBe(false);
    expect(frozen).toBe(true);
  });

  it('C241 commits materialized Set values as own array data under a late inherited setter', () => {
    const marker = Symbol('security-set-value');
    const set = securitySet<symbol>();
    securitySetAdd(set, marker);
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let poisonHits = 0;
    let values: symbol[] = [];
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (value === marker) {
            poisonHits += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      values = securitySetValues(set);
    } finally {
      if (originalDescriptor === undefined) delete Array.prototype[0];
      else nativeDefineProperty(Array.prototype, '0', originalDescriptor);
    }

    expect(poisonHits).toBe(0);
    expect(Object.getOwnPropertyDescriptor(values, '0')?.value).toBe(marker);
    expect(values).toHaveLength(1);
  });

  it('C241 resists an inherited Set-value setter installed before module import', () => {
    const script = `
      const marker = Symbol('pre-import-security-set-value');
      const define = Object.defineProperty;
      let hits = 0;
      define(Array.prototype, '0', {
        configurable: true,
        set(value) {
          if (value === marker) { hits += 1; return; }
          define(this, '0', { configurable: true, enumerable: true, value, writable: true });
        },
      });
      const witness = await import(${JSON.stringify(`${moduleUrl}?probe=C241`)});
      const set = witness.securitySet();
      witness.securitySetAdd(set, marker);
      const values = witness.securitySetValues(set);
      const descriptor = Object.getOwnPropertyDescriptor(values, '0');
      process.exit(hits === 0 && values.length === 1 && descriptor?.value === marker ? 0 : 7);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    ['WeakSet', `WeakSet.prototype.has = () => true;`],
    [
      'Map',
      `const original = Map.prototype.get;
       Map.prototype.get = function (key) {
         return typeof key === 'symbol' ? {} : Reflect.apply(original, this, [key]);
       };`,
    ],
    [
      'Set',
      `const original = Set.prototype.has;
       Set.prototype.has = function (value) {
         return typeof value === 'symbol' ? true : Reflect.apply(original, this, [value]);
       };`,
    ],
    ['Object.freeze', `Object.freeze = (value) => value;`],
    [
      'getOwnPropertyDescriptor',
      `const original = Object.getOwnPropertyDescriptor;
       Object.getOwnPropertyDescriptor = (value, key) => key === 'marker' ? undefined : original(value, key);`,
    ],
    [
      'getPrototypeOf',
      `const original = Object.getPrototypeOf;
       Object.getPrototypeOf = (value) => value && value.visible ? null : original(value);`,
    ],
    [
      'defineProperty',
      `const original = Object.defineProperty;
       Object.defineProperty = (value, key, descriptor) => key === 'hidden' ? value : original(value, key, descriptor);`,
    ],
    [
      'hasOwnProperty',
      `const original = Object.prototype.hasOwnProperty;
       Object.prototype.hasOwnProperty = function (key) {
         return key === 'missing' ? true : Reflect.apply(original, this, [key]);
       };`,
    ],
    [
      'propertyIsEnumerable',
      `const original = Object.prototype.propertyIsEnumerable;
       Object.prototype.propertyIsEnumerable = function (key) {
         return key === 'hidden' ? true : Reflect.apply(original, this, [key]);
       };`,
    ],
    [
      'Object.keys',
      `const original = Object.keys;
       Object.keys = (value) => value && value.visible ? [] : original(value);`,
    ],
    [
      'getOwnPropertySymbols',
      `const original = Object.getOwnPropertySymbols;
       Object.getOwnPropertySymbols = (value) => value && value.visible ? [] : original(value);`,
    ],
    [
      'Array.isArray',
      `const original = Array.isArray;
       Array.isArray = (value) => value && value.visible ? true : original(value);`,
    ],
    [
      'String',
      `const original = globalThis.String;
       globalThis.String = function (value) { return value === 422 ? 'forged' : original(value); };`,
    ],
    [
      'String/RegExp methods',
      String.raw`const trim = String.prototype.trim;
       const slice = String.prototype.slice;
       const charCodeAt = String.prototype.charCodeAt;
       const startsWith = String.prototype.startsWith;
       const split = String.prototype.split;
       const toLowerCase = String.prototype.toLowerCase;
       const toUpperCase = String.prototype.toUpperCase;
       const exec = RegExp.prototype.exec;
       const test = RegExp.prototype.test;
       String.prototype.trim = function () { return this === ' \tKovo\n' ? 'forged' : Reflect.apply(trim, this, []); };
       String.prototype.slice = function (start, end) { return this === 'Kovo-security' ? 'forged' : Reflect.apply(slice, this, [start, end]); };
       String.prototype.charCodeAt = function (index) { return this === 'Kovo' ? 0 : Reflect.apply(charCodeAt, this, [index]); };
       String.prototype.startsWith = function (search, position) { return this === 'kovo/security' ? false : Reflect.apply(startsWith, this, [search, position]); };
       String.prototype.split = function (separator, limit) { return this === 'root/child/file' ? [] : Reflect.apply(split, this, [separator, limit]); };
       String.prototype.toLowerCase = function () { return this === 'JaVaScRiPt' ? 'forged' : Reflect.apply(toLowerCase, this, []); };
       String.prototype.toUpperCase = function () { return this === 'x-kovo' ? 'forged' : Reflect.apply(toUpperCase, this, []); };
       RegExp.prototype.exec = function (value) { return value === 'https:' ? null : Reflect.apply(exec, this, [value]); };
       RegExp.prototype.test = function (value) { return value === 'https://kovo.test' ? false : Reflect.apply(test, this, [value]); };`,
    ],
    [
      'URI/JSON methods',
      `const encode = globalThis.encodeURIComponent;
       const decode = globalThis.decodeURIComponent;
       const stringify = JSON.stringify;
       globalThis.encodeURIComponent = (value) => value === 'a/b c' ? 'forged' : encode(value);
       globalThis.decodeURIComponent = (value) => value === 'a%2Fb%20c' ? 'forged' : decode(value);
       JSON.stringify = (value, replacer, space) => value?.kovo === 418 ? 'forged' : stringify(value, replacer, space);`,
    ],
    [
      'Reflect.apply/Function@@hasInstance',
      `const original = Reflect.apply;
       const hasInstance = Function.prototype[Symbol.hasInstance];
       Reflect.apply = (target, receiver, args) => target === hasInstance ? true : original(target, receiver, args);`,
    ],
  ])('fails closed when %s is poisoned before import', (label, poison) => {
    const script = `
      ${poison}
      try {
        const witness = await import(${JSON.stringify(`${moduleUrl}?probe=${label}`)});
        witness.securityWeakMap();
      } catch (error) {
        if (String(error).includes('integrity check failed')) process.exit(0);
        console.error(error);
      }
      process.exit(7);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.status, `${label}: ${result.stderr}`).toBe(0);
  });
});
