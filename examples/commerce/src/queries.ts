import { query } from '@jiso/server';

import {
  createCommerceDb,
  loadProductGrid,
  type CommerceDb,
  type ProductGridInput,
} from './app.js';
import { cart, order, product } from './domains.js';

// SPEC.md section 10.2: typed reads declared once, consumed by components and
// mutation registries. Queries live in a leaf module (the circular value
// imports from app.ts are function declarations, referenced only inside the
// lazy load closures) so TSX components can declare `queries:` dependencies
// that the compiler lowers into fw-deps stamps (SPEC.md section 4.2).
export const cartQuery = query('cart', {
  load: (_input: unknown) => ({ count: 1 }),
  reads: [cart],
});

export const productGridQuery = query('productGrid', {
  load: (input: unknown) => loadProductGrid(createCommerceDb(), input as ProductGridInput),
  reads: [product],
});

export const orderHistoryQuery = query('orderHistory', {
  load: (_input: unknown) => ({ items: [] as CommerceDb['orders'] }),
  reads: [order],
});
