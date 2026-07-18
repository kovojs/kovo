import { route } from '@kovojs/server';

import { createShopDb, type ShopDb, type ShopRequest } from './db.js';
import './mutations.js';
import { CartBadge } from './components/cart-badge.js';
import * as productListComponent from './components/product-list.js';
import type { AddToCartFailureState } from './mutations.js';
import { loadCart, loadProducts } from './queries.js';

// Tutorial step 04 (chapter 4): a typed write over a real form. One mutation
// endpoint answers both response modes: POST-redirect-GET without JavaScript
// and the fragment wire with it.

export type { ShopRequest } from './db.js';
export * from './mutations.js';

export const { ProductList, renderAddToCartError, renderAddToCartForm } = productListComponent;

// snippet:shop-page
export function renderShopPage(
  db: ShopDb = createShopDb(),
  addToCartFailure?: AddToCartFailureState,
  request?: ShopRequest,
): string {
  const cart = loadCart(db);
  const products = loadProducts(db);
  const badge = `<kovo-fragment target="cart-badge">${CartBadge.definition.render({ cart })}</kovo-fragment>`;
  const list = `<kovo-fragment target="product-list">${ProductList.definition.render({ products }, { failure: addToCartFailure, request })}</kovo-fragment>`;

  return `<!doctype html><html><head><title>Kovo Shop</title></head><body><main><h1>Kovo Shop</h1>${badge}${list}</main></body></html>`;
}
// /snippet

export const homeRoute = route('/', {
  page() {
    return renderShopPage();
  },
});
