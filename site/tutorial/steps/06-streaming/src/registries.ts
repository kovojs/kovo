import type { CartResult, ProductsResult } from './queries.js';

// Tutorial step 06 (chapter 6), carried from step 05: in a full app these interfaces are generated
// registry .d.ts files emitted on every compile (SPEC.md sections 5.2 and
// 6.1) — examples/commerce emits them from its graph script. The tutorial
// declares them inline so the OptimisticFor exhaustiveness proof (section
// 10.6) is visible in one file: the invalidation set for cart/add is what
// makes TypeScript demand a transform (or 'await-fragment') per query.

// snippet:registries
declare module '@jiso/core' {
  interface QueryRegistry {
    cart: CartResult;
    products: ProductsResult;
  }

  interface InvalidationSets {
    'cart/add': 'cart' | 'products';
  }
}
// /snippet

export {};
