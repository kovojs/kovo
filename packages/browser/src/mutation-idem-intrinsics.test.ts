import { describe, expect, it } from 'vitest';

import { createMutationIdemSecurityControls } from './mutation-idem-intrinsics.js';

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
    } as typeof globalThis);

    expect(() => controls.createMutationIdem()).toThrow(/verified cryptographic source/);
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
      expect(controls.createMutationIdem()).toBe('idem_303132333435363738393a3b3c3d3e3f');
    } finally {
      Object.defineProperty(typedArrayPrototype, 'length', lengthDescriptor);
    }
  });
});
