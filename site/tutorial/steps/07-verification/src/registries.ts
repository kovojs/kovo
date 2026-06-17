import type { CartResult, OrderHistoryResult, ProductsResult } from './queries.js';

// Tutorial step 07 (chapter 7), carried from step 06: in a full app these interfaces are generated
// registry .d.ts files emitted on every compile (SPEC.md sections 5.2 and
// 6.1) — examples/commerce emits them from its graph script. The tutorial
// declares them inline so the OptimisticFor exhaustiveness proof (section
// 10.6) is visible in one file: the invalidation set for cart/add is what
// makes TypeScript demand a transform (or 'await-fragment') per query.

// snippet:registries
declare module '@kovojs/core' {
  interface QueryRegistry {
    cart: CartResult;
    orderHistory: OrderHistoryResult;
    products: ProductsResult;
  }

  interface MutationRegistry {
    'cart/add': typeof import('./app.js').addToCart;
  }

  interface InvalidationSets {
    'cart/add': 'cart' | 'orderHistory' | 'products';
  }
}
// /snippet

export {};
