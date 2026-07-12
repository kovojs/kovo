import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessFreeze,
  witnessIsArray,
  witnessRegExpTest,
  witnessStringReplaceAll,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

const moduleUrl = new URL('./security-witness-intrinsics.ts', import.meta.url).href;

describe('server security witness intrinsics', () => {
  it('keeps private receipt semantics after evaluated app code poisons ambient prototypes', () => {
    const originalWeakMapGet = WeakMap.prototype.get;
    const originalIsArray = Array.isArray;
    const originalReplaceAll = String.prototype.replaceAll;
    const originalRegExpTest = RegExp.prototype.test;
    const originalWeakMapSet = WeakMap.prototype.set;
    const originalWeakSetAdd = WeakSet.prototype.add;
    const originalWeakSetHas = WeakSet.prototype.has;
    const originalFreeze = Object.freeze;
    try {
      WeakMap.prototype.get = () => ({ forged: true });
      Array.isArray = () => false;
      String.prototype.replaceAll = () => '<script>poisoned</script>';
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
      expect(witnessStringReplaceAll('a-b-a', 'a', 'x')).toBe('x-b-x');
      expect(witnessRegExpTest(/^safe$/, 'unsafe')).toBe(false);
    } finally {
      WeakMap.prototype.get = originalWeakMapGet;
      Array.isArray = originalIsArray;
      String.prototype.replaceAll = originalReplaceAll;
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
