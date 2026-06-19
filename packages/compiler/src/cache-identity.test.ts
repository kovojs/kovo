import { describe, expect, it } from 'vitest';

import { compilerBuildId } from './cache-identity.js';

describe('compilerBuildId', () => {
  it('is stable for equivalent source fingerprints regardless of object order', () => {
    expect(
      compilerBuildId({
        sourceFingerprints: {
          'src/compile.ts': 'a1',
          'src/vite.ts': 'b2',
        },
      }),
    ).toBe(
      compilerBuildId({
        sourceFingerprints: {
          'src/vite.ts': 'b2',
          'src/compile.ts': 'a1',
        },
      }),
    );
  });

  it('changes when a compiler source fingerprint changes', () => {
    expect(
      compilerBuildId({
        sourceFingerprints: {
          'src/compile.ts': 'a1',
        },
      }),
    ).not.toBe(
      compilerBuildId({
        sourceFingerprints: {
          'src/compile.ts': 'a2',
        },
      }),
    );
  });
});
