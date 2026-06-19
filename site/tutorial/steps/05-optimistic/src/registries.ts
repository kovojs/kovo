import type { CartResult, ProductsResult } from './queries.js';

// Tutorial step 05 (chapter 5): in a full app these interfaces are generated
// registry .d.ts files emitted on every compile (SPEC.md sections 5.2 and
// 6.1) — examples/commerce emits them from its graph script. The tutorial
// declares them inline so the optimistic-key proof (section 10.6) is visible
// in one file: the invalidation set for cart/add is what lets TypeScript type
// the inline mutation.optimistic keys and drafts.

// snippet:registries
declare module '@kovojs/core' {
  interface QueryRegistry {
    cart: CartResult;
    products: ProductsResult;
  }

  interface MutationRegistry {
    'cart/add': typeof import('./app.js').addToCart;
  }

  interface InvalidationSets {
    'cart/add': 'cart' | 'products';
  }
}
// /snippet

export {};
