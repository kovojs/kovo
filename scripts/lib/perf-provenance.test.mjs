import { describe, expect, it } from 'vitest';

import { sha256PerformanceBytes } from './perf-provenance.mjs';

describe('performance provenance digest authority', () => {
  it('preserves exact input bytes and the sha256 identity prefix', () => {
    expect(sha256PerformanceBytes(Buffer.from('abc'))).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const backing = Uint8Array.from([0xaa, 0x00, 0xff, 0x41, 0xbb]);
    expect(sha256PerformanceBytes(backing.subarray(1, 4))).toBe(
      'sha256:a90a10503fbfc95789ff38a1bb5039cb71869ab9c0eb1cb51c4a9099f2933c6b',
    );
  });
});
