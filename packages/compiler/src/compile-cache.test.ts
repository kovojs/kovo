import { describe, expect, it, vi } from 'vitest';

import { CompileCache, compileCacheKey } from './compile-cache.js';

describe('CompileCache', () => {
  it('dedupes compile work for the same conservative key', () => {
    const cache = new CompileCache<{ value: number }>();
    const compile = vi.fn(() => ({ value: 1 }));

    expect(cache.getOrCreate({ fileName: 'cart.tsx', source: 'component({})' }, compile)).toEqual({
      value: 1,
    });
    expect(cache.getOrCreate({ fileName: 'cart.tsx', source: 'component({})' }, compile)).toEqual({
      value: 1,
    });
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('keys by source hash and the whole passed fact set in Phase 1', () => {
    const base = compileCacheKey({
      fileName: 'cart.tsx',
      registryFacts: { queries: { cart: 'CartQuery' } },
      source: 'component({})',
    });

    expect(
      compileCacheKey({
        fileName: 'cart.tsx',
        registryFacts: { queries: { cart: 'CartQuery' } },
        source: 'component({})',
      }),
    ).toBe(base);
    expect(
      compileCacheKey({
        fileName: 'cart.tsx',
        registryFacts: { queries: { cart: 'ChangedQuery' } },
        source: 'component({})',
      }),
    ).not.toBe(base);
    expect(
      compileCacheKey({
        fileName: 'cart.tsx',
        registryFacts: { queries: { cart: 'CartQuery' } },
        source: 'component({ render: () => null })',
      }),
    ).not.toBe(base);
  });
});
