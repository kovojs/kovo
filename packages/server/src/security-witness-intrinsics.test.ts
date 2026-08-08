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

  // plans/good-perf.md D8 (threat model: security/boot-captured-direct-call.md): dispatch is a
  // boot-minted direct caller, so post-boot replacement of Function.prototype.call/apply/bind and
  // Reflect.apply — the exact surfaces the old per-call Reflect.apply indirection defended — has
  // no effect on witness operations.
  it('keeps witness semantics after evaluated app code poisons call/apply/bind and Reflect.apply', () => {
    const originalCall = Function.prototype.call;
    const originalApply = Function.prototype.apply;
    const originalBind = Function.prototype.bind;
    const originalReflectApply = Reflect.apply;
    let poisonHits = 0;
    try {
      // eslint-disable-next-line no-extend-native
      Function.prototype.call = function poisonedCall() {
        poisonHits += 1;
        return undefined as never;
      } as typeof Function.prototype.call;
      // eslint-disable-next-line no-extend-native
      Function.prototype.apply = function poisonedApply() {
        poisonHits += 1;
        return undefined as never;
      } as typeof Function.prototype.apply;
      // eslint-disable-next-line no-extend-native
      Function.prototype.bind = function poisonedBind() {
        poisonHits += 1;
        return (() => undefined) as never;
      } as typeof Function.prototype.bind;
      Reflect.apply = ((target: Function) => {
        poisonHits += 1;
        return target === WeakSet.prototype.has ? true : undefined;
      }) as typeof Reflect.apply;

      // Collect under poison, assert after restore: the test harness itself may dispatch
      // through Function.prototype.call/apply, and the claim under test is only about the
      // witness membrane's dispatch.
      const key = {};
      const other = {};
      const value = {};
      const map = createWitnessWeakMap<object, object>();
      witnessWeakMapSet(map, key, value);
      const observed = {
        weakMapGetKey: witnessWeakMapGet(map, key),
        weakMapGetOther: witnessWeakMapGet(map, other),
        weakSet: (() => {
          const set = createWitnessWeakSet<object>();
          witnessWeakSetAdd(set, key);
          return [witnessWeakSetHas(set, key), witnessWeakSetHas(set, other)];
        })(),
        replaceAll: witnessStringReplaceAll('a-b-a', 'a', 'x'),
        toLowerCase: witnessStringToLowerCase('KoVo'),
        regExpTest: witnessRegExpTest(/^safe$/, 'unsafe'),
        isArray: witnessIsArray([]),
      };
      // eslint-disable-next-line no-extend-native
      Function.prototype.call = originalCall;
      // eslint-disable-next-line no-extend-native
      Function.prototype.apply = originalApply;
      // eslint-disable-next-line no-extend-native
      Function.prototype.bind = originalBind;
      Reflect.apply = originalReflectApply;
      expect(observed.weakMapGetKey).toBe(value);
      expect(observed.weakMapGetOther).toBeUndefined();
      expect(observed.weakSet).toEqual([true, false]);
      expect(observed.replaceAll).toBe('x-b-x');
      expect(observed.toLowerCase).toBe('kovo');
      expect(observed.regExpTest).toBe(false);
      expect(observed.isArray).toBe(true);
      expect(poisonHits).toBe(0);
    } finally {
      // eslint-disable-next-line no-extend-native
      Function.prototype.call = originalCall;
      // eslint-disable-next-line no-extend-native
      Function.prototype.apply = originalApply;
      // eslint-disable-next-line no-extend-native
      Function.prototype.bind = originalBind;
      Reflect.apply = originalReflectApply;
    }
  });

  // D8 R1 (security/boot-captured-direct-call.md): Function.prototype.call/bind are capture
  // inputs for the direct-caller mint, so a pre-import forgery of either fails closed through the
  // probe corpus exactly like any other pre-boot capture poisoning.
  it('fails closed when Function.prototype.bind was poisoned before framework import', () => {
    const script = `
      Function.prototype.bind = function poisonedBind() { return () => true; };
      const witness = await import(${JSON.stringify(`${moduleUrl}?poisoned-bind-probe`)});
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

  it('fails closed when Function.prototype.call was poisoned before framework import', () => {
    const script = `
      const originalCall = Function.prototype.call;
      Function.prototype.call = function poisonedCall(receiver, ...args) {
        if (receiver === 'kovo-control') return 'forged';
        return Reflect.apply(originalCall, this, [receiver, ...args]);
      };
      const witness = await import(${JSON.stringify(`${moduleUrl}?poisoned-call-probe`)});
      try {
        witness.witnessStringStartsWith('kovo-control', 'kovo-');
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
