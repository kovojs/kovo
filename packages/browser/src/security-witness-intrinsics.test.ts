import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  defineSecurityProperties,
  freezeSecurityValue,
  securityArrayAppend,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
} from './security-witness-intrinsics.js';

const moduleUrl = new URL('./security-witness-intrinsics.ts', import.meta.url).href;

describe('browser security witness intrinsics', () => {
  it('commits array entries without invoking inherited numeric setters', () => {
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let poisonHits = 0;
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (value === 'reviewed') {
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
      const values: string[] = [];
      securityArrayAppend(values, 'reviewed', 'Browser witness test values');
      expect(values).toEqual(['reviewed']);
      expect(poisonHits).toBe(0);
    } finally {
      if (originalDescriptor === undefined) {
        delete (Array.prototype as unknown as Record<string, unknown>)['0'];
      } else {
        nativeDefineProperty(Array.prototype, '0', originalDescriptor);
      }
    }
  });

  it('keeps captured snapshot and object controls after ambient replacement', () => {
    const originalGet = WeakMap.prototype.get;
    const originalSet = WeakMap.prototype.set;
    const originalDefineProperties = Object.defineProperties;
    const originalFreeze = Object.freeze;
    const key = {};
    const value = {};
    let result: object | undefined;
    let frozen = false;
    let hidden = false;
    try {
      WeakMap.prototype.get = () => ({ forged: true });
      WeakMap.prototype.set = function () {
        return this;
      };
      Object.defineProperties = ((target: object) => target) as typeof Object.defineProperties;
      Object.freeze = ((target: unknown) => target) as typeof Object.freeze;

      const map = securityWeakMap<object, object>();
      securityWeakMapSet(map, key, value);
      result = securityWeakMapGet(map, key);
      const carrier = defineSecurityProperties({}, { hidden: { value: true } });
      hidden = Object.getOwnPropertyDescriptor(carrier, 'hidden')?.value === true;
      frozen = Object.isFrozen(freezeSecurityValue(carrier));
    } finally {
      WeakMap.prototype.get = originalGet;
      WeakMap.prototype.set = originalSet;
      Object.defineProperties = originalDefineProperties;
      Object.freeze = originalFreeze;
    }

    expect(result).toBe(value);
    expect(hidden).toBe(true);
    expect(frozen).toBe(true);
  });

  it.each([
    ['WeakSet', `WeakSet.prototype.has = () => true;`],
    [
      'Object.defineProperties',
      `const original = Object.defineProperties;
       Object.defineProperties = (value, descriptors) => descriptors.hidden && descriptors.visible ? value : original(value, descriptors);`,
    ],
    ['Object.freeze', `Object.freeze = (value) => value;`],
    [
      'String',
      `const original = globalThis.String;
       globalThis.String = function (value) { return value === 418 ? 'forged' : original(value); };`,
    ],
    [
      'String/RegExp methods',
      String.raw`const replaceAll = String.prototype.replaceAll;
       const trim = String.prototype.trim;
       const slice = String.prototype.slice;
       const indexOf = String.prototype.indexOf;
       const charCodeAt = String.prototype.charCodeAt;
       const toLowerCase = String.prototype.toLowerCase;
       const exec = RegExp.prototype.exec;
       const test = RegExp.prototype.test;
       String.prototype.replaceAll = function (search, replacement) { return this === '<&<' ? 'forged' : Reflect.apply(replaceAll, this, [search, replacement]); };
       String.prototype.trim = function () { return this === ' \tKovo\n' ? 'forged' : Reflect.apply(trim, this, []); };
       String.prototype.slice = function (start, end) { return this === 'Kovo-security' ? 'forged' : Reflect.apply(slice, this, [start, end]); };
       String.prototype.indexOf = function (search, start) { return this === 'Kovo-security' ? -1 : Reflect.apply(indexOf, this, [search, start]); };
       String.prototype.charCodeAt = function (index) { return this === 'Kovo' ? 0 : Reflect.apply(charCodeAt, this, [index]); };
       String.prototype.toLowerCase = function () { return this === 'JaVaScRiPt' ? 'forged' : Reflect.apply(toLowerCase, this, []); };
       RegExp.prototype.exec = function (value) { return value === 'https:' ? null : Reflect.apply(exec, this, [value]); };
       RegExp.prototype.test = function (value) { return value === 'https://kovo.test' ? false : Reflect.apply(test, this, [value]); };`,
    ],
    [
      'Object.keys/hasOwnProperty',
      `Object.keys = () => [];
       Object.prototype.hasOwnProperty = () => false;`,
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
      process.exit(9);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.status, `${label}: ${result.stderr}`).toBe(0);
  });
});
