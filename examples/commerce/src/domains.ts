import { domain } from '@jiso/server';

// SPEC.md section 10.1: domains are the invalidation currency. They live in a
// leaf module so TSX component modules can import their queries without
// creating an eagerly-evaluated cycle through app.ts.
export const cart = domain('cart');
export const attachment = domain('attachment');
export const order = domain('order');
export const product = domain('product');
