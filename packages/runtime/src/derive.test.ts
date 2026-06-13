import { describe, expect, it } from 'vitest';

import { derive as deriveFromBarrel } from './index.js';
import { derive } from './derive.js';

describe('derive runtime surface', () => {
  it('keeps the public barrel wired to the extracted derive owner', () => {
    expect(deriveFromBarrel).toBe(derive);
  });

  it('returns a compiled query derive definition without wrapping the run function', () => {
    const run = (count: unknown) => Number(count) + 1;

    // SPEC.md §5.2 keeps app-authored component code in TSX/JSX; runtime query
    // derive definitions stay as source-level helper metadata, not lowered IR.
    const definition = derive(['cart.count'] as const, run);

    expect(definition.inputs).toEqual(['cart.count']);
    expect(Object.getOwnPropertyDescriptor(definition, 'run')?.value).toBe(run);
    expect(definition.run(2)).toBe(3);
  });

  it('declares named derive inputs beside the pure derive function', () => {
    const isEmpty = derive(['cart'], (cart) => (cart as { count: number }).count === 0);

    expect(isEmpty.inputs).toEqual(['cart']);
    expect(isEmpty.run({ count: 0 })).toBe(true);
    expect(isEmpty.run({ count: 2 })).toBe(false);
  });
});
