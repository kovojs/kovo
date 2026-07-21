import { publicAccess, query, type QueryLoadContext } from '@kovojs/server';

import { createShopDb, type ShopDb, type ShopProduct, type ShopRequest } from './db.js';
import { cart, product } from './domains.js';

// Tutorial step 03 (chapter 3): typed reads declared once (SPEC.md section
// 10.2). Each query couples a key, a loader, and the domains it reads — the
// read set is the whole invalidation declaration; nothing else registers
// anywhere.

export type CartResult = {
  count: number;
};

export type ProductsResult = {
  items: ShopProduct[];
};

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

function dbFrom(context?: QueryLoadContext<ShopRequest>): ShopDb {
  return context?.request?.db ?? createShopDb();
}

// snippet:queries
export const cartQuery = query({
  access: publicAccess('tutorial single-cart storefront read'),
  load: (_input: unknown, context?: QueryLoadContext<ShopRequest>) => loadCart(dbFrom(context)),
  reads: [cart],
});

export const productsQuery = query({
  access: publicAccess('tutorial public product catalog'),
  load: (_input: unknown, context?: QueryLoadContext<ShopRequest>) => loadProducts(dbFrom(context)),
  reads: [product],
});
// /snippet
