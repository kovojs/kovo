import { createHash } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

import { CompileCache, compileCacheKey, compileComponentCacheKeyInput } from './compile-cache.js';
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

  it('authorizes hits with the full source and extra-file preimages, never a digest alone', () => {
    const key = compileCacheKey({
      extraFiles: [{ fileName: 'shared.ts', source: 'export const shared = 1;' }],
      fileName: 'cart.tsx',
      source: 'component({})',
    });
    const parsed = JSON.parse(key) as {
      extraFiles: Array<{ fileName: string; source: string }>;
      source: string;
      sourceHash?: unknown;
    };
    expect(parsed.source).toBe('component({})');
    expect(parsed.extraFiles).toEqual([
      { fileName: 'shared.ts', source: 'export const shared = 1;' },
    ]);
    expect(parsed.sourceHash).toBeUndefined();
  });

  it('does not alias unsafe source to a safe in-memory result through a late createHash replacement', () => {
    const cache = new CompileCache<{ dependencyFootprint: {}; source: string }>();
    const safeSource = 'export const Account = component({ render: () => <p>safe</p> });';
    const unsafeSource =
      'export const Account = component({ render: () => <script>{adminToken}</script> });';
    const safeDigest = createHash('sha256').update(safeSource).digest('hex');
    const compile = vi.fn((source: string) => ({ dependencyFootprint: {}, source }));
    expect(
      cache.getOrCreate({ fileName: 'account.tsx', source: safeSource }, () => compile(safeSource)),
    ).toMatchObject({ source: safeSource });

    const require = createRequire(import.meta.url);
    const mutableCrypto = require('node:crypto') as {
      createHash: (typeof import('node:crypto'))['createHash'];
    };
    const nativeCreateHash = mutableCrypto.createHash;
    mutableCrypto.createHash = ((algorithm: string, options?: unknown) => {
      const real = nativeCreateHash(algorithm, options as never);
      let input = '';
      return {
        digest(encoding: import('node:crypto').BinaryToTextEncoding) {
          if (input === unsafeSource && encoding === 'hex') return safeDigest;
          return real.digest(encoding);
        },
        update(value: string) {
          input += value;
          real.update(value);
          return this;
        },
      };
    }) as unknown as typeof mutableCrypto.createHash;
    syncBuiltinESMExports();

    try {
      expect(
        cache.getOrCreate({ fileName: 'account.tsx', source: unsafeSource }, () =>
          compile(unsafeSource),
        ),
      ).toMatchObject({ source: unsafeSource });
      expect(compile).toHaveBeenCalledTimes(2);
    } finally {
      mutableCrypto.createHash = nativeCreateHash;
      syncBuiltinESMExports();
    }
  });

  it('keys by exact source and the whole passed fact set before a footprint exists', () => {
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

  it('does not replay a learned footprint through selective registry Array.filter replacement', () => {
    const cache = new CompileCache<{
      dependencyFootprint: CompileDependencyFootprint;
      value: number;
    }>();
    const safeComponents = ['safe/cart-badge'];
    const unsafeComponents = ['unsafe/cart-badge'];
    let value = 0;
    const compile = vi.fn(() => ({
      dependencyFootprint: {
        previousRegistryFacts: { components: safeComponents },
        reads: { previousRegistryComponentDomLeaves: ['cart-badge'] },
      },
      value: value++,
    }));
    const first = cache.getOrCreate(
      compileComponentCacheKeyInput({
        fileName: 'cart.tsx',
        previousRegistryFacts: { components: safeComponents },
        source: 'component({})',
      }),
      compile,
    );
    const nativeFilter = Array.prototype.filter;
    const nativeApply = Reflect.apply;
    Array.prototype.filter = function poisonedRegistryFilter(
      callback: (value: unknown, index: number, array: unknown[]) => unknown,
      thisArg?: unknown,
    ): unknown[] {
      if (this === unsafeComponents) return safeComponents;
      return nativeApply(nativeFilter, this, [callback, thisArg]);
    };

    try {
      const second = cache.getOrCreate(
        compileComponentCacheKeyInput({
          fileName: 'cart.tsx',
          previousRegistryFacts: { components: unsafeComponents },
          source: 'component({})',
        }),
        compile,
      );
      expect(second).not.toBe(first);
      expect(compile).toHaveBeenCalledTimes(2);
    } finally {
      Array.prototype.filter = nativeFilter;
    }
  });

  it('does not reuse learned-footprint entries across production render-plan gates', () => {
    const cache = new CompileCache<{
      dependencyFootprint: CompileDependencyFootprint;
      value: number;
    }>();
    let value = 0;
    const compile = vi.fn(
      (): { dependencyFootprint: CompileDependencyFootprint; value: number } => ({
        dependencyFootprint: {
          queryShapes: { cart: { count: 'number' } },
          reads: { queryShapeNames: ['cart'] },
        },
        value: value++,
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
        productionRenderPlanGate: { previous: { cart: 'tok-1' } },
        queryShapes: { cart: { count: 'number' }, product: { name: 'string' } },
        source: 'component({})',
      }),
      compile,
    );
    const third = cache.getOrCreate(
      compileComponentCacheKeyInput({
        fileName: 'cart.tsx',
        productionRenderPlanGate: { previous: { cart: 'tok-2' } },
        queryShapes: { cart: { count: 'number' }, product: { name: 'string' } },
        source: 'component({})',
      }),
      compile,
    );

    expect(first).toEqual(expect.objectContaining({ value: 0 }));
    expect(second).toEqual(expect.objectContaining({ value: 1 }));
    expect(third).toEqual(expect.objectContaining({ value: 2 }));
    expect(compile).toHaveBeenCalledTimes(3);
  });

  it('productionRenderPlanGate is included in the cache key (SPEC §5.2.1 total-function)', () => {
    // Two compiles of identical source differing only in productionRenderPlanGate must produce
    // different cache keys — the gate flips the KV435 confidentiality and KV416 token-monotonicity
    // diagnostics, so a stale-green hit on the wrong key suppresses a build-failing diagnostic.
    const withoutGate = compileComponentCacheKeyInput({
      fileName: 'cart.tsx',
      source: 'component({})',
    });
    const withGate = compileComponentCacheKeyInput({
      fileName: 'cart.tsx',
      productionRenderPlanGate: { previous: { cart: 'tok-1' } },
      source: 'component({})',
    });
    const withDifferentPrevious = compileComponentCacheKeyInput({
      fileName: 'cart.tsx',
      productionRenderPlanGate: { previous: { cart: 'tok-2' } },
      source: 'component({})',
    });
    const withCustomTokenFn = compileComponentCacheKeyInput({
      fileName: 'cart.tsx',
      productionRenderPlanGate: {
        previous: { cart: 'tok-1' },
        tokenFn: (input) => JSON.stringify(input),
      },
      source: 'component({})',
    });

    // A gate-absent compile must differ from a gate-present compile.
    expect(compileCacheKey(withGate)).not.toBe(compileCacheKey(withoutGate));
    // Different `previous` values must differ.
    expect(compileCacheKey(withDifferentPrevious)).not.toBe(compileCacheKey(withGate));
    // A custom tokenFn must differ from no tokenFn (same previous).
    expect(compileCacheKey(withCustomTokenFn)).not.toBe(compileCacheKey(withGate));
    // Identical inputs must produce identical keys.
    expect(
      compileCacheKey(
        compileComponentCacheKeyInput({
          fileName: 'cart.tsx',
          productionRenderPlanGate: { previous: { cart: 'tok-1' } },
          source: 'component({})',
        }),
      ),
    ).toBe(compileCacheKey(withGate));
  });

  it('preserves productionRenderPlanGate when projecting by a dependency footprint', () => {
    const footprint: CompileDependencyFootprint = {
      queryShapes: { cart: { count: 'number' } },
      reads: { queryShapeNames: ['cart'] },
    };

    const withGate = compileComponentCacheKeyInput(
      {
        fileName: 'cart.tsx',
        productionRenderPlanGate: { previous: { cart: 'tok-1' } },
        queryShapes: { cart: { count: 'number' }, ignored: { name: 'string' } },
        source: 'component({})',
      },
      footprint,
    );
    const withDifferentGate = compileComponentCacheKeyInput(
      {
        fileName: 'cart.tsx',
        productionRenderPlanGate: { previous: { cart: 'tok-2' } },
        queryShapes: { cart: { count: 'number' }, ignored: { title: 'string' } },
        source: 'component({})',
      },
      footprint,
    );

    expect(compileCacheKey(withDifferentGate)).not.toBe(compileCacheKey(withGate));
  });

  it('includes every declared component compile input that can affect lowering', () => {
    const base = compileComponentCacheKeyInput({
      extraFiles: [
        { fileName: 'browser-barrel.ts', source: 'export const th = (value) => value;' },
      ],
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
    expect(
      compileCacheKey(
        compileComponentCacheKeyInput({
          extraFiles: [
            {
              fileName: 'browser-barrel.ts',
              source: "export { trustedHtml as th } from '@kovojs/browser';",
            },
          ],
          fileName: 'product-card.tsx',
          packagePrefixDiscoveryRoot: '/workspace/app',
          queryShapeFacts: [{ query: 'product', shape: { name: 'string' }, source: 'queries.ts' }],
          queryShapes: { product: { name: 'string' } },
          registryFacts: { mutationInputs: { updateProduct: [] } },
          source: 'component({})',
          sourceProvenance: 'app',
        }),
      ),
    ).not.toBe(compileCacheKey(base));
    expect(compileCacheKey({ ...base, sourceProvenance: 'compiler-emitted' })).not.toBe(
      compileCacheKey(base),
    );
  });
});
