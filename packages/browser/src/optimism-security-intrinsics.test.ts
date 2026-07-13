import { afterEach, expect, it } from 'vitest';

import { submitOptimisticEnhancedMutation } from './mutation-optimistic.js';
import { OptimisticRebaser } from './optimism.js';
import { createQueryStore } from './query-store.js';
import { FakeMorphRoot } from './runtime-test-fakes.js';

const nativeArrayFilter = Array.prototype.filter;
const nativeMapGet = Map.prototype.get;
const nativeObjectKeys = Object.keys;

afterEach(() => {
  Array.prototype.filter = nativeArrayFilter;
  Map.prototype.get = nativeMapGet;
  Object.keys = nativeObjectKeys;
});

it('rolls rejected optimism back after late Array.filter replacement', () => {
  const store = createQueryStore();
  const rebaser = new OptimisticRebaser(store);
  store.set('account', { role: 'user' });
  rebaser.add('rejected-role-change', {}, {
    transforms: {
      account() {
        return { role: 'admin' };
      },
    },
  });
  expect(store.get('account')).toEqual({ role: 'admin' });

  Array.prototype.filter = function poisonedFilter(callback, thisArg) {
    for (let index = 0; index < this.length; index += 1) {
      const value = this[index] as { id?: unknown } | undefined;
      if (value?.id === 'rejected-role-change') return this.slice();
    }
    return Reflect.apply(nativeArrayFilter, this, [callback, thisArg]);
  } as typeof Array.prototype.filter;

  rebaser.settleWithoutServerTruth('rejected-role-change', 'account');

  expect(store.get('account')).toEqual({ role: 'user' });
  expect(rebaser.pendingCount('account')).toBe(0);
});

it('rolls a failed submit back after late Object.keys replacement', async () => {
  const store = createQueryStore();
  const rebaser = new OptimisticRebaser(store);
  const transforms = {
    account() {
      return { role: 'admin' };
    },
  };
  store.set('account', { role: 'user' });
  const failure = new Error('server refused role change');
  Object.keys = function poisonedKeys(value: object) {
    if (value === transforms) {
      Object.keys = nativeObjectKeys;
      return [];
    }
    return Reflect.apply(nativeObjectKeys, Object, [value]);
  } as typeof Object.keys;

  await expect(
    submitOptimisticEnhancedMutation({
      fetch: async () => {
        expect(store.get('account')).toEqual({ role: 'admin' });
        throw failure;
      },
      form: { action: '/_m/account/elevate', method: 'post' },
      formData: new FormData(),
      idem: 'rejected-role-submit',
      input: {},
      optimistic: { transforms },
      rebaser,
      root: new FakeMorphRoot(),
      store,
    }),
  ).rejects.toBe(failure);

  expect(store.get('account')).toEqual({ role: 'user' });
  expect(rebaser.pendingCount('account')).toBe(0);
});

it('restores the captured server baseline after late Map.get replacement', () => {
  const store = createQueryStore();
  const rebaser = new OptimisticRebaser(store);
  store.set('account', { role: 'user' });
  rebaser.add('rejected-role-change', {}, {
    transforms: {
      account() {
        return { role: 'admin' };
      },
    },
  });

  let matchingReads = 0;
  Map.prototype.get = function poisonedGet(key: unknown) {
    if (key === 'account') {
      matchingReads += 1;
      if (matchingReads === 2) return { role: 'admin' };
    }
    return Reflect.apply(nativeMapGet, this, [key]);
  } as typeof Map.prototype.get;

  rebaser.settleWithoutServerTruth('rejected-role-change', 'account');

  expect(store.get('account')).toEqual({ role: 'user' });
  expect(rebaser.pendingCount('account')).toBe(0);
});
