import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  CompileCache,
  compileCacheKey,
  compileComponentCacheKeyInput,
  registryFactChanges,
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

  it('folds source with a >=256-bit collision-resistant digest, not a 32-bit FNV-1a', () => {
    // L8-2 (plans/bug-and-testing-part3.md): the cache key stores no source
    // preimage, so a hash collision is a stale wrong-output hit. SPEC.md
    // §5.2.1#1 mandates a collision-resistant hash. Assert the sourceHash in the
    // emitted key is a SHA-256 hex digest (64 chars / 256 bits), never the prior
    // 8-char (32-bit) FNV-1a.
    const key = compileCacheKey({ fileName: 'cart.tsx', source: 'component({})' });
    const match = /"sourceHash":"([0-9a-f]+)"/.exec(key);
    expect(match).not.toBeNull();
    const digest = match?.[1] ?? '';
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest.length * 4).toBeGreaterThanOrEqual(256);

    // It is the SHA-256 of the source, with no app-visible FNV-1a constant in
    // the key path.
    const expected = createHash('sha256').update('component({})').digest('hex');
    expect(digest).toBe(expected);
    expect(key).not.toContain('811c9dc5');
    expect(key).not.toContain('01000193');
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
    const cache = new CompileCache<{
      dependencyFootprint: CompileDependencyFootprint;
      value: number;
    }>();
    const compile = vi.fn(
      (): { dependencyFootprint: CompileDependencyFootprint; value: number } => ({
        dependencyFootprint: {
          queryShapes: { cart: { count: 'number' } },
          reads: { queryShapeNames: ['cart'] },
        },
        value: 1,
      }),
    );

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

  it('invalidates only modules indexed to changed dependency facts', () => {
    const cache = new CompileCache<{
      dependencyFootprint: CompileDependencyFootprint;
      value: string;
    }>();
    const compileCart = vi.fn(
      (): { dependencyFootprint: CompileDependencyFootprint; value: string } => ({
        dependencyFootprint: {
          queryShapes: { cart: { count: 'number' } },
          reads: { queryShapeNames: ['cart'] },
        },
        value: `cart-${compileCart.mock.calls.length}`,
      }),
    );
    const compileProduct = vi.fn(
      (): { dependencyFootprint: CompileDependencyFootprint; value: string } => ({
        dependencyFootprint: {
          queryShapes: { product: { name: 'string' } },
          reads: { queryShapeNames: ['product'] },
        },
        value: `product-${compileProduct.mock.calls.length}`,
      }),
    );
    const cartInput = compileComponentCacheKeyInput({
      fileName: 'cart.tsx',
      queryShapes: { cart: { count: 'number' } },
      source: 'component({})',
    });
    const productInput = compileComponentCacheKeyInput({
      fileName: 'product.tsx',
      queryShapes: { product: { name: 'string' } },
      source: 'component({})',
    });

    const firstCart = cache.getOrCreate(cartInput, compileCart);
    const firstProduct = cache.getOrCreate(productInput, compileProduct);
    cache.invalidateFacts([{ kind: 'queryShape', name: 'cart' }]);
    const secondCart = cache.getOrCreate(cartInput, compileCart);
    const secondProduct = cache.getOrCreate(productInput, compileProduct);

    expect(secondCart).not.toBe(firstCart);
    expect(secondProduct).toBe(firstProduct);
    expect(compileCart).toHaveBeenCalledTimes(2);
    expect(compileProduct).toHaveBeenCalledTimes(1);
  });

  it('feeds registry fact diffs into the inverse index', () => {
    const cache = new CompileCache<{
      dependencyFootprint: CompileDependencyFootprint;
      value: string;
    }>();
    const compileCart = vi.fn(
      (): { dependencyFootprint: CompileDependencyFootprint; value: string } => ({
        dependencyFootprint: {
          reads: { mutationInputKeys: ['cart/add'] },
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
        },
        value: `cart-${compileCart.mock.calls.length}`,
      }),
    );
    const compileProduct = vi.fn(
      (): { dependencyFootprint: CompileDependencyFootprint; value: string } => ({
        dependencyFootprint: {
          reads: { mutationInputKeys: ['product/save'] },
          registryFacts: { mutationInputs: { 'product/save': [] } },
        },
        value: `product-${compileProduct.mock.calls.length}`,
      }),
    );
    const cartInput = compileComponentCacheKeyInput({
      fileName: 'cart.tsx',
      registryFacts: { mutationInputs: { 'cart/add': [] } },
      source: 'component({})',
    });
    const productInput = compileComponentCacheKeyInput({
      fileName: 'product.tsx',
      registryFacts: { mutationInputs: { 'product/save': [] } },
      source: 'component({})',
    });

    const firstCart = cache.getOrCreate(cartInput, compileCart);
    const firstProduct = cache.getOrCreate(productInput, compileProduct);
    cache.invalidateFacts(
      registryFactChanges(
        { mutationInputs: { 'cart/add': [] } },
        {
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
      ),
    );

    expect(cache.getOrCreate(cartInput, compileCart)).not.toBe(firstCart);
    expect(cache.getOrCreate(productInput, compileProduct)).toBe(firstProduct);
    expect(compileCart).toHaveBeenCalledTimes(2);
    expect(compileProduct).toHaveBeenCalledTimes(1);
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
