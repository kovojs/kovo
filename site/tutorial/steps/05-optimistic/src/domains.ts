import { domain } from '@kovojs/server';

// Domains are the invalidation currency (SPEC.md section 10.1); unchanged
// from step 03.

export const cart = domain('cart');
export const product = domain('product');
