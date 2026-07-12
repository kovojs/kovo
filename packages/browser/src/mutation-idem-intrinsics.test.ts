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
});
