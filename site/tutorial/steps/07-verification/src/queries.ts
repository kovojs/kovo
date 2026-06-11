import { query, type QueryLoadContext } from '@jiso/server';

import {
  createShopDb,
  type ShopDb,
  type ShopOrder,
  type ShopProduct,
  type ShopRequest,
} from './db.js';
import { cart, order, product } from './domains.js';

// Tutorial step 07 (chapter 7), carried from step 06: the loaders now read the per-request database
// through the query load context, so post-commit reruns (SPEC.md section
// 10.3) render the data the mutation just wrote — never pre-commit state.

export interface CartResult {
  count: number;
}

export interface ProductsResult {
  items: ShopProduct[];
}

export interface OrderHistoryResult {
  items: ShopOrder[];
}

export function loadCart(db: ShopDb): CartResult {
  return { count: db.cartItems.reduce((total, item) => total + item.qty, 0) };
}

export function loadProducts(db: ShopDb): ProductsResult {
  return {
    items: [...db.products.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function loadOrderHistory(db: ShopDb): OrderHistoryResult {
  return { items: db.orders };
}

function dbFrom(context?: QueryLoadContext<ShopRequest>): ShopDb {
  return context?.request?.db ?? createShopDb();
}

// snippet:queries
export const cartQuery = query('cart', {
  load: (_input: unknown, context?: QueryLoadContext<ShopRequest>) => loadCart(dbFrom(context)),
  reads: [cart],
});

export const productsQuery = query('products', {
  load: (_input: unknown, context?: QueryLoadContext<ShopRequest>) => loadProducts(dbFrom(context)),
  reads: [product],
});

export const orderHistoryQuery = query('orderHistory', {
  load: (_input: unknown, context?: QueryLoadContext<ShopRequest>) =>
    loadOrderHistory(dbFrom(context)),
  reads: [order],
});
// /snippet
