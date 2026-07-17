import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { createMutationIdemSecurityControls } from './mutation-idem-intrinsics.js';

const NOW = 1_768_000_000_000;

class TestDate extends Date {
  static override now(): number {
    return NOW;
  }
}

describe('mutation idem security controls', () => {
  it('rejects pre-initialization constant crypto sources instead of degrading to a clock', () => {
    const controls = createMutationIdemSecurityControls({
      crypto: {
        getRandomValues(array: Uint8Array) {
          array.fill(0);
          return array;
        },
        randomUUID: () => '00000000-0000-4000-8000-000000000000',
      },
      Date: TestDate,
    } as typeof globalThis);

    expect(() => controls.createMutationIdem()).toThrow(/verified 128-bit cryptographic source/);
  });

  it('does not collapse getRandomValues ids through a late TypedArray length replacement', () => {
    let randomCall = 0;
    const controls = createMutationIdemSecurityControls({
      crypto: {
        getRandomValues(array: Uint8Array) {
          randomCall += 1;
          for (let index = 0; index < 16; index += 1) array[index] = randomCall * 16 + index;
          return array;
        },
      },
      Date: TestDate,
    } as typeof globalThis);
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length');
    if (!lengthDescriptor) throw new Error('TypedArray length descriptor unavailable');

    Object.defineProperty(typedArrayPrototype, 'length', {
      configurable: true,
      get: () => 0,
    });
    try {
      // Two boot witnesses consume calls 1/2; the logical token receives call 3.
      expect(controls.createMutationIdem()).toBe(`v1_${NOW}_303132333435363738393a3b3c3d3e3f`);
    } finally {
      Object.defineProperty(typedArrayPrototype, 'length', lengthDescriptor);
    }
  });

  it('preserves a canonical server timestamp while replacing the exact 16-byte nonce', () => {
    let randomCall = 0;
    const controls = createMutationIdemSecurityControls({
      crypto: {
        getRandomValues(array: Uint8Array) {
          randomCall += 1;
          for (let index = 0; index < 16; index += 1) array[index] = randomCall * 16 + index;
          return array;
        },
      },
      Date: TestDate,
    } as typeof globalThis);

    const refreshed = controls.refreshMutationIdem(
      'v1_1750000000000_000102030405060708090a0b0c0d0e0f',
    );
    expect(refreshed).toBe('v1_1750000000000_303132333435363738393a3b3c3d3e3f');
    expect(Buffer.from(refreshed.slice(-32), 'hex')).toHaveLength(16);
  });

  it('rejects malformed or timeless enhanced seeds instead of extending their horizon', () => {
    let randomCall = 0;
    const controls = createMutationIdemSecurityControls({
      crypto: {
        getRandomValues(array: Uint8Array) {
          randomCall += 1;
          for (let index = 0; index < 16; index += 1) array[index] = randomCall + index;
          return array;
        },
      },
      Date: TestDate,
    } as typeof globalThis);

    expect(() => controls.refreshMutationIdem('idem_legacy')).toThrow(/server-stamped token/);
    expect(() => controls.refreshMutationIdem(undefined)).toThrow(/server-stamped token/);
  });

  it('uses the boot-captured clock only for a direct seedless token', () => {
    let randomCall = 0;
    class ReplaceableDate extends Date {
      static override now(): number {
        return NOW;
      }
    }
    const controls = createMutationIdemSecurityControls({
      crypto: {
        getRandomValues(array: Uint8Array) {
          randomCall += 1;
          for (let index = 0; index < 16; index += 1) array[index] = randomCall + index;
          return array;
        },
      },
      Date: ReplaceableDate,
    } as typeof globalThis);
    Object.defineProperty(ReplaceableDate, 'now', { value: () => NOW + 86_400_000 });

    expect(controls.createMutationIdem()).toMatch(new RegExp(`^v1_${NOW}_[0-9a-f]{32}$`, 'u'));
  });

  it('rejects randomUUID-only sources because RFC v4 carries only 122 random bits', () => {
    const controls = createMutationIdemSecurityControls({
      crypto: { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' },
      Date: TestDate,
    } as typeof globalThis);

    expect(() => controls.createMutationIdem()).toThrow(/128-bit cryptographic source/);
  });
});
