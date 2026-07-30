import { tutorialShopDb, type ShopOrder, type ShopProduct, type ShopReadModel } from './db.js';
import { cart, order, product } from './domains.js';
import { app } from './kovo.js';
import type { TutorialSession } from './kovo.js';

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

export function loadProducts(db: ShopReadModel): ProductsResult {
  return {
    items: [...db.products.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function requireShopUserId(context: { request: { session?: TutorialSession | null } }): string {
  const userId = context.request.session?.user.id;
  if (!userId) throw new Error('private shop data requires an authenticated tutorial session');
  return userId;
}

// snippet:private-cart
export function loadCart(db: ShopReadModel, userId: string): CartResult {
  return {
    count: db.cartItems
      .filter((item) => item.userId === userId)
      .reduce((total, item) => total + item.qty, 0),
  };
}

export const cartQuery = app.query({
  access: [app.authenticated],
  load: (_input, context) =>
    loadCart(tutorialShopDb(context.request).query.snapshot(), requireShopUserId(context)),
  reads: [cart],
});
// /snippet

export const productsQuery = app.query({
  access: app.publicAccess('tutorial public product catalog'),
  load: (_input, context) => loadProducts(tutorialShopDb(context.request).query.snapshot()),
  reads: [product],
});

// snippet:private-order-history
export function loadOrderHistory(db: ShopReadModel, userId: string): OrderHistoryResult {
  return { items: db.orders.filter((item) => item.userId === userId) };
}

export const orderHistoryQuery = app.query({
  access: [app.authenticated],
  load: (_input, context) =>
    loadOrderHistory(tutorialShopDb(context.request).query.snapshot(), requireShopUserId(context)),
  reads: [order],
});
// /snippet
