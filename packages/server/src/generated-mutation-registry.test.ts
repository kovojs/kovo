import { afterEach, describe, expect, it } from 'vitest';

import {
  registeredGeneratedMutationTouches,
  registerGeneratedMutationTouchRegistry,
} from './generated-mutation-registry.js';

const TEST_KEY = 'generated-mutation-registry/security-authority';

afterEach(() => {
  registerGeneratedMutationTouchRegistry({ [TEST_KEY]: [] });
});

describe('generated mutation touch registry (SPEC §10.3 C9/C15)', () => {
  it('preserves compiler touch authority after evaluated app code poisons mutable intrinsics', () => {
    const registry = {
      [TEST_KEY]: [{ domain: 'inventory', keys: 'arg:id' }],
    };
    const originalArrayIsArray = Array.isArray;
    const originalEvery = Array.prototype.every;
    const originalMapGet = Map.prototype.get;
    const originalMapSet = Map.prototype.set;
    const originalObjectEntries = Object.entries;
    let touches: ReturnType<typeof registeredGeneratedMutationTouches> | undefined;
    try {
      Array.isArray = () => false;
      Array.prototype.every = () => false;
      Map.prototype.get = () => undefined;
      Map.prototype.set = function () {
        return this;
      };
      Object.entries = () => [];

      registerGeneratedMutationTouchRegistry(registry);
      touches = registeredGeneratedMutationTouches(TEST_KEY);
    } finally {
      Array.isArray = originalArrayIsArray;
      Array.prototype.every = originalEvery;
      Map.prototype.get = originalMapGet;
      Map.prototype.set = originalMapSet;
      Object.entries = originalObjectEntries;
    }

    expect(touches).toEqual([{ domain: 'inventory', keys: 'arg:id' }]);
  });

  it('reconstructs and freezes touch facts instead of retaining compiler carriers', () => {
    const touch: { crossTable?: true; domain: string; keys: null | string; via?: string } = {
      crossTable: true,
      domain: 'account',
      keys: null,
      via: 'member',
    };
    const touches = [touch];
    const registry = { [TEST_KEY]: touches };
    registerGeneratedMutationTouchRegistry(registry);

    touch.domain = 'forged-domain';
    touch.keys = 'arg:forged';
    delete touch.crossTable;
    touches.length = 0;

    const registered = registeredGeneratedMutationTouches(TEST_KEY);
    expect(registered).toEqual([
      { crossTable: true, domain: 'account', keys: null, via: 'member' },
    ]);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered[0])).toBe(true);
  });
});
