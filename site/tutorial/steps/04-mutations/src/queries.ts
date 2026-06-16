import { query } from '@kovojs/server';

import { createShopDb, type ShopDb, type ShopProduct } from './db.js';
import { cart, product } from './domains.js';

// Typed reads declared once (SPEC.md section 10.2); unchanged from step 03.

export interface CartResult {
  count: number;
}

export interface ProductsResult {
  items: ShopProduct[];
}

export function loadCart(db: ShopDb): CartResult {
  return { count: db.cartItems.reduce((total, item) => total + item.qty, 0) };
}

export function loadProducts(db: ShopDb): ProductsResult {
  return {
    items: [...db.products.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export const cartQuery = query('cart', {
  load: (_input: unknown) => loadCart(createShopDb()),
  reads: [cart],
});

export const productsQuery = query('products', {
  load: (_input: unknown) => loadProducts(createShopDb()),
  reads: [product],
});
