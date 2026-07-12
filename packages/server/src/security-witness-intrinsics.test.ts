import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  witnessArrayAppend,
  witnessCreateNullRecord,
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessFreeze,
  witnessIsArray,
  witnessJsonStringifyPrimitive,
  witnessRegExpTest,
  witnessStringReplaceAll,
  witnessStringStartsWith,
  witnessStringToLowerCase,
  witnessSortStrings,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

const moduleUrl = new URL('./security-witness-intrinsics.ts', import.meta.url).href;

describe('server security witness intrinsics', () => {
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
      witnessArrayAppend(values, 'reviewed', 'Security witness test values');
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

  it('keeps private receipt semantics after evaluated app code poisons ambient prototypes', () => {
    const originalWeakMapGet = WeakMap.prototype.get;
    const originalObjectCreate = Object.create;
    const originalIsArray = Array.isArray;
    const originalArraySort = Array.prototype.sort;
    const originalJsonStringify = JSON.stringify;
    const originalReplaceAll = String.prototype.replaceAll;
    const originalStartsWith = String.prototype.startsWith;
    const originalToLowerCase = String.prototype.toLowerCase;
    const originalRegExpExec = RegExp.prototype.exec;
    const originalRegExpTest = RegExp.prototype.test;
    const originalWeakMapSet = WeakMap.prototype.set;
    const originalWeakSetAdd = WeakSet.prototype.add;
    const originalWeakSetHas = WeakSet.prototype.has;
    const originalFreeze = Object.freeze;
    try {
      WeakMap.prototype.get = () => ({ forged: true });
      Object.create = (() => ({})) as typeof Object.create;
      Array.isArray = () => false;
      Array.prototype.sort = function () {
        return this;
      };
      JSON.stringify = () => 'forged';
      String.prototype.replaceAll = () => '<script>poisoned</script>';
      String.prototype.startsWith = () => true;
      String.prototype.toLowerCase = () => 'poisoned';
      RegExp.prototype.exec = () => ['forged'] as unknown as RegExpExecArray;
      RegExp.prototype.test = () => true;
      WeakMap.prototype.set = function () {
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
      const map = createWitnessWeakMap<object, object>();
      expect(Object.getPrototypeOf(witnessCreateNullRecord())).toBeNull();
      witnessWeakMapSet(map, key, value);
      expect(witnessWeakMapGet(map, key)).toBe(value);
      expect(witnessWeakMapGet(map, other)).toBeUndefined();
      const set = createWitnessWeakSet<object>();
      witnessWeakSetAdd(set, key);
      expect(witnessWeakSetHas(set, key)).toBe(true);
      expect(witnessWeakSetHas(set, other)).toBe(false);
      expect(Object.isFrozen(witnessFreeze({ proof: true }))).toBe(true);
      expect(witnessIsArray([])).toBe(true);
      expect(witnessIsArray({})).toBe(false);
      const strings = ['z', 'a', 'aa'];
      witnessSortStrings(strings);
      expect(strings[0]).toBe('a');
      expect(strings[1]).toBe('aa');
      expect(strings[2]).toBe('z');
      expect(witnessJsonStringifyPrimitive('a"b')).toBe('"a\\"b"');
      expect(witnessStringReplaceAll('a-b-a', 'a', 'x')).toBe('x-b-x');
      expect(witnessStringStartsWith('kovo-control', 'kovo-')).toBe(true);
      expect(witnessStringStartsWith('app-control', 'kovo-')).toBe(false);
      expect(witnessStringToLowerCase('KoVo')).toBe('kovo');
      expect(witnessRegExpTest(/^safe$/, 'unsafe')).toBe(false);
    } finally {
      WeakMap.prototype.get = originalWeakMapGet;
      Object.create = originalObjectCreate;
      Array.isArray = originalIsArray;
      Array.prototype.sort = originalArraySort;
      JSON.stringify = originalJsonStringify;
      String.prototype.replaceAll = originalReplaceAll;
      String.prototype.startsWith = originalStartsWith;
      String.prototype.toLowerCase = originalToLowerCase;
      RegExp.prototype.exec = originalRegExpExec;
      RegExp.prototype.test = originalRegExpTest;
      WeakMap.prototype.set = originalWeakMapSet;
      WeakSet.prototype.add = originalWeakSetAdd;
      WeakSet.prototype.has = originalWeakSetHas;
      Object.freeze = originalFreeze;
    }
  });

  it('does not rely on ambient Array prototype methods during its import-order self-test', () => {
    const script = `
      Array.prototype.includes = () => { throw new Error('ambient includes reached'); };
      const witness = await import(${JSON.stringify(`${moduleUrl}?clean-probe`)});
      const key = {};
      const other = {};
      const set = witness.createWitnessWeakSet();
      witness.witnessWeakSetAdd(set, key);
      if (!witness.witnessWeakSetHas(set, key) || witness.witnessWeakSetHas(set, other)) process.exit(2);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails closed when a receipt control was poisoned before framework import', () => {
    const script = `
      WeakSet.prototype.has = () => true;
      const witness = await import(${JSON.stringify(`${moduleUrl}?poisoned-probe`)});
      try {
        witness.assertSecurityWitnessIntrinsics();
      } catch (error) {
        if (String(error).includes('intrinsics were modified')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
