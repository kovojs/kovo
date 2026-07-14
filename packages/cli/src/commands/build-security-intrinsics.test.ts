import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { buildByteLength, buildMapClear, buildSetClear } from './build-security-intrinsics.js';

describe('build security byte accounting', () => {
  it('does not dispatch through an authored typed-array byteLength property', () => {
    const bytes = Buffer.from('safe');
    let getterHits = 0;
    Object.defineProperty(bytes, 'byteLength', {
      configurable: true,
      get() {
        getterHits += 1;
        return 1_000_000_000;
      },
    });

    expect(buildByteLength(bytes)).toBe(4);
    expect(getterHits).toBe(0);
    expect(buildByteLength('safe')).toBe(4);
  });
});

describe('build security collection teardown', () => {
  it('clears framework-owned maps and sets through boot-pinned controls', () => {
    const map = new Map([['retained', true]]);
    const set = new Set(['retained']);
    const mapClear = Map.prototype.clear;
    const setClear = Set.prototype.clear;

    try {
      Map.prototype.clear = () => {
        throw new Error('late Map.clear replacement');
      };
      Set.prototype.clear = () => {
        throw new Error('late Set.clear replacement');
      };

      buildMapClear(map);
      buildSetClear(set);

      expect(map.size).toBe(0);
      expect(set.size).toBe(0);
    } finally {
      Map.prototype.clear = mapClear;
      Set.prototype.clear = setClear;
    }
  });
});
