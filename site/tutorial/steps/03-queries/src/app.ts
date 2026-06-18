import { renderQueryScript, route } from '@kovojs/server';

import { createShopDb, type ShopDb } from './db.js';
import { CartBadge } from './generated/cart-badge.js';
import { ProductList } from './generated/product-list.js';
import { loadCart, loadProducts } from './queries.js';

// Tutorial step 03 (chapter 3): the shop page renders both components from
// their committed lowered IR and ships each query value exactly once as
// shared client data (SPEC.md section 4.2) — no per-component fetches, no
// client cache.

// snippet:shop-page
export function renderShopPage(db: ShopDb = createShopDb()): string {
  const cart = loadCart(db);
  const products = loadProducts(db);
  const queryData =
    renderQueryScript({ name: 'cart', value: cart }) +
    renderQueryScript({ name: 'products', value: products });

  return `<!doctype html><html><head><title>Kovo Shop</title></head><body><main><h1>Kovo Shop</h1>${queryData}${CartBadge.definition.render({ cart })}${ProductList.definition.render({ products })}</main></body></html>`;
}
// /snippet

export const homeRoute = route('/', {
  page() {
    return renderShopPage();
  },
});
