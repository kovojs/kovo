/** @jsxImportSource @kovojs/server */
import { publicAccess, route, s, type InferSchema, type MutationFail } from '@kovojs/server';

import { tutorialShopDb, type ShopRequest } from './db.js';
import { CartBadge } from './components/cart-badge.js';
import * as productListComponent from './components/product-list.js';
import { cart, product } from './domains.js';
import { app } from './kovo.js';
import { cartQuery, productsQuery, type CartResult } from './queries.js';

// Tutorial step 05 (chapter 5): the mutation declares what it touches, the
// framework derives which queries to re-run (SPEC.md sections 10.3, 11.1),
// and optimism is keyed to queries — one transform per (mutation ×
// invalidated query), coverage-checked by the registry plus kovo check
// (sections 10.4, 10.6).

export type { ShopRequest } from './db.js';
export { shopCsrf } from './kovo.js';

export type AddToCartFailure = MutationFail<string, unknown>;

export interface AddToCartFailureState {
  failure: AddToCartFailure;
  productId?: string | undefined;
}

export const { ProductList, renderAddToCartError, renderAddToCartForm } = productListComponent;

// snippet:touches
// SPEC.md section 11.1: with the blessed @kovojs/drizzle adapter these touch
// sites are extracted from the write ASTs and committed as a reviewable
// graph. The tutorial's plain in-memory db has no ASTs to analyze, so it
// declares the touches — the SPEC.md section 14 v1 floor — and chapter 7
// runtime-verifies the declaration against observed writes.
export const addToCartTouches = [
  {
    domain: cart.key,
    keys: null,
    site: 'site/tutorial/steps/05-optimistic/src/app.tsx:addToCart',
    via: 'cart_items',
  },
  {
    domain: product.key,
    keys: 'arg:productId',
    predicate: 'eq',
    site: 'site/tutorial/steps/05-optimistic/src/app.tsx:addToCart',
    via: 'products',
  },
] as const;
// /snippet

const addToCartInput = s.object({
  productId: s.string(),
  quantity: s.number().int().min(1).default(1),
});

export type AddToCartInput = InferSchema<typeof addToCartInput>;

// The predictor is an ordinary pure function, so it is cheap to unit- and
// property-test without reaching through framework-owned plan objects.
export function predictCart(current: Readonly<CartResult>, input: AddToCartInput): CartResult {
  return { count: current.count + input.quantity };
}

export const addToCart = app.mutation({
  access: app.publicAccess('tutorial anonymous single-cart write protected by CSRF'),
  input: addToCartInput,
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
  },
  registry: {
    queries: [cartQuery, productsQuery],
    touches: [cart, product],
  },
  // snippet:optimistic
  // SPEC.md section 10.4: optimism is keyed to queries, never islands. The
  // cart count is predictable from the input alone — a pure value transform.
  // The product list depends on server truth (stock math lives in the handler),
  // so it explicitly accepts the 1-RTT fragment: 'await-fragment' is a recorded
  // decision, not an omission. Query handles bind both decisions to their
  // exact result types; kovo check proves coverage against invalidation.
  queue: 'cart',
  optimistic: [
    cartQuery.optimistic(addToCartInput, predictCart),
    productsQuery.optimistic('await-fragment'),
  ],
  // /snippet
  transaction<Result>(
    request: ShopRequest,
    run: (transactionRequest: ShopRequest) => Promise<Result>,
  ): Promise<Result> {
    return tutorialShopDb(request).transaction((db) =>
      run(Object.assign(request.clone(), request, { db })),
    );
  },
  handler(input, request, context) {
    const found = request.db.products.get(input.productId);
    if (!found || found.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }

    request.db.cartItems.push({
      productId: input.productId,
      qty: input.quantity,
      unitPrice: found.unitPrice,
    });
    request.db.products.set(input.productId, { ...found, stock: found.stock - input.quantity });
    return { productId: input.productId, quantity: input.quantity };
  },
});

export const homeRoute = route('/', {
  access: publicAccess('tutorial storefront browsing'),
  page(_input, _request: ShopRequest) {
    return (
      <html>
        <head>
          <title>Kovo Shop</title>
        </head>
        <body>
          <main>
            <h1>Kovo Shop</h1>
            <CartBadge />
            <ProductList />
          </main>
        </body>
      </html>
    );
  },
});
