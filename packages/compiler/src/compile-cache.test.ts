import { describe, expect, it, vi } from 'vitest';

import {
  CompileCache,
  compileCacheKey,
  compileComponentCacheKeyInput,
} from './compile-cache.js';

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

  it('includes every declared component compile input that can affect lowering', () => {
    const base = compileComponentCacheKeyInput({
      fileName: 'product-card.tsx',
      packagePrefixDiscoveryRoot: '/workspace/app',
      queryShapeFacts: [{ query: 'product', shape: { name: 'string' }, source: 'queries.ts' }],
      queryShapes: { product: { name: 'string' } },
      registryFacts: { mutationInputs: { updateProduct: [] } },
      source: 'component({})',
      sourceProvenance: 'app',
    });

    expect(
      compileCacheKey({
        ...base,
        queryShapeFacts: [{ query: 'product', shape: { name: 'number' }, source: 'queries.ts' }],
      }),
    ).not.toBe(compileCacheKey(base));
    expect(compileCacheKey({ ...base, queryShapes: { product: { name: 'number' } } })).not.toBe(
      compileCacheKey(base),
    );
    expect(compileCacheKey({ ...base, sourceProvenance: 'compiler-emitted' })).not.toBe(
      compileCacheKey(base),
    );
  });
});
