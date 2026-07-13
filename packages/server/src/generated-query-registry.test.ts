import { afterEach, describe, expect, it } from 'vitest';

import { domain } from './domain.js';
import {
  queryWithGeneratedReads,
  registeredGeneratedQueryReads,
  registerGeneratedQueryReadRegistry,
} from './generated-query-registry.js';
import { query } from './query.js';

// The registry is process-global module state; reset it between cases by
// overwriting each query key we touch with an empty domain set.
afterEach(() => {
  for (const key of [
    'foldQuery',
    'emptyQuery',
    'dedupeQuery',
    'noopQuery',
    'compilerDerivedQuery',
    'intrinsicAuthorityQuery',
    'carrierSnapshotQuery',
  ]) {
    registerGeneratedQueryReadRegistry([{ domains: [], query: key }]);
  }
});

const product = domain('product');
const inventory = domain('inventory');

function readKeys(reads: readonly { key: string }[] | undefined): string[] {
  return (reads ?? []).map((d) => d.key);
}

describe('queryWithGeneratedReads (SPEC §10.2:1018 — declared reads folded into the read set)', () => {
  // RED on the current overwrite impl: author-declared `reads` is discarded,
  // so a mutation touching `inventory` would no longer invalidate the query
  // (silent under-invalidation). SPEC §10.2:1018 requires the declared `reads:`
  // set to be FOLDED INTO (union) the compiler-derived read set.
  it('unions author-declared reads with compiler-registered reads (does not overwrite)', () => {
    const opaqueQuery = query('foldQuery', {
      reads: [product, inventory],
      load: () => ({ rows: [] as unknown[] }),
    });

    // Compiler registered only the statically-visible base read (`product`),
    // missing the opaque `sql<T>` over `inventory` the author declared.
    registerGeneratedQueryReadRegistry([{ domains: ['product'], query: 'foldQuery' }]);

    const effective = queryWithGeneratedReads(opaqueQuery);

    expect(readKeys(effective.reads).sort()).toEqual(['inventory', 'product']);
    // Specifically: the author-declared `inventory` MUST survive.
    expect(readKeys(effective.reads)).toContain('inventory');
  });

  it('populates an empty author read set from the registered reads', () => {
    const bareQuery = query('emptyQuery', {
      load: () => ({ rows: [] as unknown[] }),
    });
    expect(readKeys(bareQuery.reads)).toEqual([]);

    registerGeneratedQueryReadRegistry([
      { domains: ['product', 'inventory'], query: 'emptyQuery' },
    ]);

    const effective = queryWithGeneratedReads(bareQuery);

    expect(readKeys(effective.reads).sort()).toEqual(['inventory', 'product']);
  });

  it('dedupes domains shared by author and registered reads', () => {
    const overlapQuery = query('dedupeQuery', {
      reads: [product, inventory],
      load: () => ({ rows: [] as unknown[] }),
    });

    // `product` overlaps the author declaration; only `inventory` is shared too.
    registerGeneratedQueryReadRegistry([
      { domains: ['product', 'inventory'], query: 'dedupeQuery' },
    ]);

    const effective = queryWithGeneratedReads(overlapQuery);

    expect(readKeys(effective.reads).sort()).toEqual(['inventory', 'product']);
    expect(readKeys(effective.reads)).toHaveLength(2);
  });

  it('returns the definition unchanged when the union adds nothing', () => {
    const coveredQuery = query('noopQuery', {
      reads: [product, inventory],
      load: () => ({ rows: [] as unknown[] }),
    });

    // Registered reads are a subset of the author declaration → no new domain.
    registerGeneratedQueryReadRegistry([{ domains: ['product'], query: 'noopQuery' }]);

    const effective = queryWithGeneratedReads(coveredQuery);

    expect(effective).toBe(coveredQuery);
    expect(readKeys(effective.reads).sort()).toEqual(['inventory', 'product']);
  });

  it('replaces compiler-derived domain placeholders with generated read keys', () => {
    const compilerDerived = domain();
    const derivedQuery = query('compilerDerivedQuery', {
      reads: [compilerDerived],
      load: () => ({ rows: [] as unknown[] }),
    });

    registerGeneratedQueryReadRegistry([
      { domains: ['domains/cart-domain'], query: 'compilerDerivedQuery' },
    ]);

    const effective = queryWithGeneratedReads(derivedQuery);

    expect(readKeys(effective.reads)).toEqual(['domains/cart-domain']);
  });

  it('preserves compiler read authority after evaluated app code poisons mutable intrinsics', () => {
    const definition = query('intrinsicAuthorityQuery', {
      load: () => ({ rows: [] as unknown[] }),
      reads: [inventory],
    });
    const registry = [{ domains: ['generated-authority'], query: 'intrinsicAuthorityQuery' }];

    const originalArrayIsArray = Array.isArray;
    const originalEvery = Array.prototype.every;
    const originalFilter = Array.prototype.filter;
    const originalMap = Array.prototype.map;
    const originalMapGet = Map.prototype.get;
    const originalSetAdd = Set.prototype.add;
    const originalSetHas = Set.prototype.has;
    let effective: typeof definition | undefined;
    try {
      Array.isArray = () => false;
      Array.prototype.every = () => false;
      Array.prototype.filter = () => [];
      Array.prototype.map = () => [];
      Map.prototype.get = () => undefined;
      Set.prototype.add = function () {
        return this;
      };
      Set.prototype.has = () => false;

      registerGeneratedQueryReadRegistry(registry);
      effective = queryWithGeneratedReads(definition);
    } finally {
      Array.isArray = originalArrayIsArray;
      Array.prototype.every = originalEvery;
      Array.prototype.filter = originalFilter;
      Array.prototype.map = originalMap;
      Map.prototype.get = originalMapGet;
      Set.prototype.add = originalSetAdd;
      Set.prototype.has = originalSetHas;
    }

    expect(readKeys(effective?.reads).sort()).toEqual(['generated-authority', 'inventory']);
  });

  it('reconstructs and freezes registered reads instead of retaining compiler carriers', () => {
    const domains = ['carrier-authority'];
    const entry = { domains, query: 'carrierSnapshotQuery' };
    const registry = [entry];
    registerGeneratedQueryReadRegistry(registry);

    domains[0] = 'forged-domain';
    entry.query = 'forged-query';
    registry.length = 0;

    const reads = registeredGeneratedQueryReads('carrierSnapshotQuery');
    expect(readKeys(reads)).toEqual(['carrier-authority']);
    expect(Object.isFrozen(reads)).toBe(true);
    expect(Object.isFrozen(reads[0])).toBe(true);
  });
});
