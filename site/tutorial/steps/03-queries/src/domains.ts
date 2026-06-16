import { domain } from '@kovojs/server';

// Tutorial step 03 (chapter 3): domains are the invalidation currency
// (SPEC.md section 10.1). They live in a leaf module so component modules can
// import their queries without import cycles — the same layout
// examples/commerce uses.

// snippet:domains
export const cart = domain('cart');
export const product = domain('product');
// /snippet
