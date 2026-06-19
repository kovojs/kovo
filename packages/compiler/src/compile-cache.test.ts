import { describe, expect, it, vi } from 'vitest';

import {
  CompileCache,
  compileCacheKey,
  compileComponentCacheKeyInput,
} from './compile-cache.js';
import type { CompileDependencyFootprint } from './types.js';

describe('CompileCache', () => {
  it('dedupes compile work for the same key', () => {
    const cache = new CompileCache<{ dependencyFootprint: {}; value: number }>();
    const compile = vi.fn(() => ({ dependencyFootprint: {}, value: 1 }));

    expect(cache.getOrCreate({ fileName: 'cart.tsx', source: 'component({})' }, compile)).toEqual({
      dependencyFootprint: {},
      value: 1,
    });
    expect(cache.getOrCreate({ fileName: 'cart.tsx', source: 'component({})' }, compile)).toEqual({
      dependencyFootprint: {},
      value: 1,
    });
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('keys by source hash and the whole passed fact set before a footprint exists', () => {
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

  it('keys by the dependency footprint slice when one is available', () => {
    const footprint = {
      queryShapes: { cart: { count: 'number' } },
      reads: {
        mutationInputKeys: ['cart/add'],
        queryShapeNames: ['cart'],
      },
      registryFacts: {
        mutationInputs: {
          'cart/add': [
            {
              coercion: 'number',
              defaulted: false,
              name: 'quantity',
              optional: false,
              provenance: 'registry',
              required: true,
            },
          ],
        },
      },
    } as const;
    const base = compileComponentCacheKeyInput(
      {
        fileName: 'cart.tsx',
        queryShapes: { cart: { count: 'number' }, product: { name: 'string' } },
        registryFacts: {
          mutationInputs: {
            'cart/add': footprint.registryFacts.mutationInputs['cart/add'],
            'product/save': [],
          },
        },
        source: 'component({})',
      },
      footprint,
    );

    expect(
      compileCacheKey(
        compileComponentCacheKeyInput(
          {
            fileName: 'cart.tsx',
            queryShapes: { cart: { count: 'number' }, product: { title: 'string' } },
            registryFacts: {
              mutationInputs: {
                'cart/add': footprint.registryFacts.mutationInputs['cart/add'],
                'product/save': [
                  {
                    coercion: 'string',
                    defaulted: false,
                    name: 'ignored',
                    optional: false,
                    provenance: 'registry',
                    required: true,
                  },
                ],
              },
            },
            source: 'component({})',
          },
          footprint,
        ),
      ),
    ).toBe(compileCacheKey(base));
    expect(
      compileCacheKey(
        compileComponentCacheKeyInput(
          {
            fileName: 'cart.tsx',
            queryShapes: { cart: { count: 'string' }, product: { name: 'string' } },
            registryFacts: {
              mutationInputs: {
                'cart/add': footprint.registryFacts.mutationInputs['cart/add'],
              },
            },
            source: 'component({})',
          },
          footprint,
        ),
      ),
    ).not.toBe(compileCacheKey(base));
  });

  it('reuses a compiled entry when only facts outside the learned footprint change', () => {
    const cache = new CompileCache<{ dependencyFootprint: CompileDependencyFootprint; value: number }>();
    const compile = vi.fn((): { dependencyFootprint: CompileDependencyFootprint; value: number } => ({
      dependencyFootprint: {
        queryShapes: { cart: { count: 'number' } },
        reads: { queryShapeNames: ['cart'] },
      },
      value: 1,
    }));

    const first = cache.getOrCreate(
      compileComponentCacheKeyInput({
        fileName: 'cart.tsx',
        queryShapes: { cart: { count: 'number' }, product: { name: 'string' } },
        source: 'component({})',
      }),
      compile,
    );
    const second = cache.getOrCreate(
      compileComponentCacheKeyInput({
        fileName: 'cart.tsx',
        queryShapes: { cart: { count: 'number' }, product: { title: 'string' } },
        source: 'component({})',
      }),
      compile,
    );

    expect(second).toBe(first);
    expect(compile).toHaveBeenCalledTimes(1);
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
