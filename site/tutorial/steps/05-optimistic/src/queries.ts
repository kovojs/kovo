import { tutorialShopDb, type ShopProduct, type ShopReadModel } from './db.js';
import { cart, product } from './domains.js';
import { app } from './kovo.js';

// Tutorial step 05 (chapter 5): the loaders now read the per-request database
// through the query load context, so post-commit reruns (SPEC.md section
// 10.3) render the data the mutation just wrote — never pre-commit state.

export type CartResult = {
  count: number;
};

export type ProductsResult = {
  items: ShopProduct[];
};

export function loadCart(db: ShopReadModel): CartResult {
  return { count: db.cartItems.reduce((total, item) => total + item.qty, 0) };
}

export function loadProducts(db: ShopReadModel): ProductsResult {
  return {
    items: [...db.products.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

// snippet:queries
export const cartQuery = app.query({
  access: app.publicAccess('tutorial single-cart storefront read'),
  load: (_input, context) => loadCart(tutorialShopDb(context.request).query.snapshot()),
  reads: [cart],
});

export const productsQuery = app.query({
  access: app.publicAccess('tutorial public product catalog'),
  load: (_input, context) => loadProducts(tutorialShopDb(context.request).query.snapshot()),
  reads: [product],
});
// /snippet
