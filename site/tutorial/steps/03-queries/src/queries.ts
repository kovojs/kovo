import { query } from '@jiso/server';

import { createShopDb, type ShopDb, type ShopProduct } from './db.js';
import { cart, product } from './domains.js';

// Tutorial step 03 (chapter 3): typed reads declared once (SPEC.md section
// 10.2). Each query couples a key, a loader, and the domains it reads — the
// read set is the whole invalidation declaration; nothing else registers
// anywhere.

export interface CartResult {
  count: number;
}

export interface ProductsResult {
  items: ShopProduct[];
}

// snippet:loaders
export function loadCart(db: ShopDb): CartResult {
  return { count: db.cartItems.reduce((total, item) => total + item.qty, 0) };
}

export function loadProducts(db: ShopDb): ProductsResult {
  return {
    items: [...db.products.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}
// /snippet

// snippet:queries
export const cartQuery = query('cart', {
  load: (_input: unknown) => loadCart(createShopDb()),
  reads: [cart],
});

export const productsQuery = query('products', {
  load: (_input: unknown) => loadProducts(createShopDb()),
  reads: [product],
});
// /snippet
