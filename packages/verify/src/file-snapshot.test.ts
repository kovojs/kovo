import { describe, expect, it } from 'vitest';

import { readBoundedDescriptor } from './file-snapshot.js';

describe('bounded descriptor snapshots', () => {
  it('accepts exactly the cap and rejects deterministic concurrent growth at cap+1', () => {
    const exact = descriptorReader(new Uint8Array([1, 2, 3, 4]));
    expect(readBoundedDescriptor(123, 4, 'evidence', exact.read)).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(exact.bufferSizes).toEqual([5, 5]);

    const growing = descriptorReader(new Uint8Array([1, 2, 3, 4, 5]));
    expect(() => readBoundedDescriptor(123, 4, 'evidence', growing.read)).toThrow(
      /exceeds its 4-byte limit/u,
    );
    expect(growing.bufferSizes).toEqual([5]);
  });
});

function descriptorReader(source: Uint8Array) {
  let sourceOffset = 0;
  const bufferSizes: number[] = [];
  return {
    bufferSizes,
    read(
      _descriptor: number,
      buffer: Uint8Array,
      offset: number,
      length: number,
      _position: null,
    ): number {
      bufferSizes.push(buffer.byteLength);
      const count = Math.min(length, source.byteLength - sourceOffset);
      buffer.set(source.subarray(sourceOffset, sourceOffset + count), offset);
      sourceOffset += count;
      return count;
    },
  };
}
