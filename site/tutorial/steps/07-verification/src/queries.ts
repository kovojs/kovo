import { guards, publicAccess, query, type QueryLoadContext } from '@kovojs/server';

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

export type CartResult = {
  count: number;
};

export type ProductsResult = {
  items: ShopProduct[];
};

export type OrderHistoryResult = {
  items: ShopOrder[];
};

export function loadProducts(db: ShopDb): ProductsResult {
  return {
    items: [...db.products.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function dbFrom(context?: QueryLoadContext<ShopRequest>): ShopDb {
  return context?.request?.db ?? createShopDb();
}

function requireShopUserId(context?: QueryLoadContext<ShopRequest>): string {
  const userId = context?.request?.session?.user?.id;
  if (!userId) throw new Error('private shop data requires an authenticated tutorial session');
  return userId;
}

// snippet:private-cart
export function loadCart(db: ShopDb, userId: string): CartResult {
  return {
    count: db.cartItems
      .filter((item) => item.userId === userId)
      .reduce((total, item) => total + item.qty, 0),
  };
}

export const cartQuery = query({
  access: [guards.authed<ShopRequest>()],
  load: (_input: unknown, context?: QueryLoadContext<ShopRequest>) =>
    loadCart(dbFrom(context), requireShopUserId(context)),
  reads: [cart],
});
// /snippet

export const productsQuery = query({
  access: publicAccess('tutorial public product catalog'),
  load: (_input: unknown, context?: QueryLoadContext<ShopRequest>) => loadProducts(dbFrom(context)),
  reads: [product],
});

// snippet:private-order-history
export function loadOrderHistory(db: ShopDb, userId: string): OrderHistoryResult {
  return { items: db.orders.filter((item) => item.userId === userId) };
}

export const orderHistoryQuery = query({
  access: [guards.authed<ShopRequest>()],
  load: (_input: unknown, context?: QueryLoadContext<ShopRequest>) =>
    loadOrderHistory(dbFrom(context), requireShopUserId(context)),
  reads: [order],
});
// /snippet
