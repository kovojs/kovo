import { query, type QueryLoadContext } from '@kovojs/server';

import { createShopDb, type ShopDb, type ShopProduct, type ShopRequest } from './db.js';
import { cart, product } from './domains.js';

// Tutorial step 06 (chapter 6), carried from step 05: the loaders now read the per-request database
// through the query load context, so post-commit reruns (SPEC.md section
// 10.3) render the data the mutation just wrote — never pre-commit state.

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

function dbFrom(context?: QueryLoadContext<ShopRequest>): ShopDb {
  return context?.request?.db ?? createShopDb();
}

// snippet:queries
export const cartQuery = query({
  load: (_input: unknown, context?: QueryLoadContext<ShopRequest>) => loadCart(dbFrom(context)),
  reads: [cart],
});

export const productsQuery = query({
  load: (_input: unknown, context?: QueryLoadContext<ShopRequest>) => loadProducts(dbFrom(context)),
  reads: [product],
});
// /snippet
