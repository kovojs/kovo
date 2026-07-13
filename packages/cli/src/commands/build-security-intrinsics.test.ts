import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { buildByteLength } from './build-security-intrinsics.js';

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
