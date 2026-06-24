import { publicAccess, route, type RoutePageResult } from '@kovojs/server';

import { createShopDb, type ShopDb } from './db.js';
import { CartBadge } from './components/cart-badge.js';
import { ProductList } from './components/product-list.js';
import { loadCart, loadProducts } from './queries.js';

// Tutorial step 03 (chapter 3): components declare the queries they need and
// render from the loaded values (SPEC.md section 4.2) — no per-component
// fetches, no client cache.

// snippet:shop-page
export function renderShopPage(db: ShopDb = createShopDb()): string {
  const cart = loadCart(db);
  const products = loadProducts(db);

  return `<!doctype html><html><head><title>Kovo Shop</title></head><body><main><h1>Kovo Shop</h1>${CartBadge.definition.render({ cart })}${ProductList.definition.render({ products })}</main></body></html>`;
}
// /snippet

export const homeRoute = route('/', {
  access: publicAccess('public tutorial shop page'),
  page() {
    return renderShopPage() as unknown as RoutePageResult;
  },
});
