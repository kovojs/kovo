import { readFileSync } from 'node:fs';

import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from '@jiso/compiler';
import { describe, expect, it } from 'vitest';

describe('compiler fixpoint', () => {
  it('keeps the starter component lowering authorable', () => {
    // SPEC.md section 5.2 requires generated starters to enforce the compiler fixpoint.
    const result = compileComponentModule({
      fileName: 'src/app.tsx',
      source: readFileSync(new URL('./app.tsx', import.meta.url), 'utf8'),
    });

    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });
});
