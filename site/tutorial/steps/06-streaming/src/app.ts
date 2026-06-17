import { form } from '@kovojs/core';
import type { OptimisticFor } from '@kovojs/runtime';
import {
  mutation,
  renderDeferredStream,
  renderMutationEndpointResponse,
  renderQueryScript,
  renderRoutePageResponse,
  route,
  s,
  type MutationFail,
} from '@kovojs/server';
import type { MutationWireHeaderSource } from '@kovojs/server/internal/wire';

import './registries.js';
import { createShopDb, type ShopDb, type ShopRequest } from './db.js';
import { CartBadge } from './generated/cart-badge.js';
import * as productListComponent from './generated/product-list.js';
import { cartQuery, loadCart, loadProducts, productsQuery } from './queries.js';

// Tutorial step 06 (chapter 6), carried from step 05: the mutation declares what it touches, the
// framework derives which queries to re-run (SPEC.md sections 10.3, 11.1),
// and optimism is keyed to queries — one transform per (mutation ×
// invalidated query), exhaustiveness-checked in tsc (sections 10.4, 10.6).

export type { ShopRequest } from './db.js';

export type AddToCartFailure = MutationFail<string, unknown>;

export interface AddToCartFailureState {
  failure: AddToCartFailure;
  productId?: string | undefined;
}

export const { ProductList, renderAddToCartError, renderAddToCartForm } = productListComponent;

export const shopCsrf = {
  secret: 'tutorial-shop-secret',
  sessionId(request: ShopRequest) {
    return request.session?.id;
  },
};

// snippet:form-value
export type AddToCartInput = {
  productId: string;
  quantity: number;
};

export const addToCartForm = form<'cart/add', AddToCartInput>('cart/add');
// /snippet

// snippet:touches
// SPEC.md section 11.1: with the blessed @kovojs/drizzle adapter these touch
// sites are extracted from the write ASTs and committed as a reviewable
// graph. The tutorial's plain in-memory db has no ASTs to analyze, so it
// declares the touches — the SPEC.md section 14 v1 floor — and chapter 7
// runtime-verifies the declaration against observed writes.
export const addToCartTouches = [
  {
    domain: 'cart',
    keys: null,
    site: 'site/tutorial/steps/06-streaming/src/app.ts:addToCart',
    via: 'cart_items',
  },
  {
    domain: 'product',
    keys: 'arg:productId',
    predicate: 'eq',
    site: 'site/tutorial/steps/06-streaming/src/app.ts:addToCart',
    via: 'products',
  },
] as const;
// /snippet

// snippet:add-to-cart
export const addToCart = mutation('cart/add', {
  csrf: shopCsrf,
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
  },
  registry: {
    inferredTouches: addToCartTouches,
    queries: [cartQuery, productsQuery],
  },
  transaction(request: ShopRequest, run) {
    return request.db.transaction((db) => run({ ...request, db }));
  },
  handler(input, request: ShopRequest, context) {
    const found = request.db.products.get(input.productId);
    if (!found || found.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }

    request.db.write('cart_items', {
      productId: input.productId,
      qty: input.quantity,
      unitPrice: found.unitPrice,
    });
    request.db.write('products', {
      ...found,
      stock: found.stock - input.quantity,
    });
    return { productId: input.productId, quantity: input.quantity };
  },
});
// /snippet

// snippet:optimistic
// SPEC.md section 10.4: optimism is keyed to queries, never islands. The
// cart count is predictable from the input alone — a pure transform. The
// product list depends on server truth (stock math lives in the handler), so
// it explicitly accepts the 1-RTT fragment: 'await-fragment' is a recorded
// decision, not an omission. tsc requires an entry per invalidated query
// (section 10.6) — delete one and this satisfies clause turns red.
export const addToCartOptimistic = {
  queue: 'cart',
  transforms: {
    cart(current, input) {
      return {
        count: (current?.count ?? 0) + input.quantity,
      };
    },
    products: 'await-fragment',
  },
} satisfies OptimisticFor<typeof addToCartForm>;
// /snippet

export function renderShopPage(
  db: ShopDb = createShopDb(),
  addToCartFailure?: AddToCartFailureState,
  request?: ShopRequest,
): string {
  const cart = loadCart(db);
  const products = loadProducts(db);
  const queryData =
    renderQueryScript({ name: 'cart', value: cart }) +
    renderQueryScript({ name: 'products', value: products });
  const badge = `<kovo-fragment target="cart-badge">${CartBadge.definition.render({ cart })}</kovo-fragment>`;
  const list = `<kovo-fragment target="product-list">${ProductList.definition.render({ products }, { failure: addToCartFailure, request })}</kovo-fragment>`;

  return `<!doctype html><html><head><title>Kovo Shop</title></head><body><main><h1>Kovo Shop</h1>${queryData}${badge}${list}</main></body></html>`;
}

export const homeRoute = route('/', {
  page() {
    return renderShopPage();
  },
});

export function renderHomeRoute() {
  return renderRoutePageResponse(homeRoute, {}, {});
}

// snippet:deferred-stream
// Tutorial step 06 (chapter 6): out-of-order streaming (SPEC.md section 8).
// The shell ships immediately with a declared fallback; the expensive product
// list streams later in the same response using the same fragment/query
// vocabulary as mutation responses — <kovo-defer> is the section 9.1 wire
// reused within first render, not a second mechanism.
export function renderShopPageDeferredStream(db: ShopDb = createShopDb(), request?: ShopRequest) {
  const cart = loadCart(db);
  const shell = `<!doctype html><html><head><title>Kovo Shop</title></head><body><main><h1>Kovo Shop</h1>${renderQueryScript({ name: 'cart', value: cart })}<kovo-fragment target="cart-badge">${CartBadge.definition.render({ cart })}</kovo-fragment><kovo-defer target="product-list" state="pending">Loading products…</kovo-defer>`;
  const products = loadProducts(db);

  return renderDeferredStream({
    chunks: [
      {
        fragments: [
          {
            html: ProductList.definition.render({ products }, { request }),
            target: 'product-list',
          },
        ],
        queries: [{ name: 'products', value: products }],
      },
    ],
    closeHtml: '</main></body></html>',
    shell,
  });
}
// /snippet

export function submitAddToCartNoJs(rawInput: unknown, request: ShopRequest) {
  return submitAddToCart(rawInput, request, {});
}

export function submitAddToCart(
  rawInput: unknown,
  request: ShopRequest,
  headers: MutationWireHeaderSource,
) {
  const productId = productIdFromRawInput(rawInput);
  return renderMutationEndpointResponse(addToCart, {
    fragmentRenderers: [
      {
        render: () => CartBadge.definition.render({ cart: loadCart(request.db) }),
        target: 'cart-badge',
      },
      {
        render: () =>
          ProductList.definition.render({ products: loadProducts(request.db) }, { request }),
        target: 'product-list',
      },
    ],
    headers,
    rawInput,
    redirectTo: '/',
    renderFailureFragment: (failure) => renderAddToCartFailureFragment(request, rawInput, failure),
    renderFailurePage: (failure) => renderShopPage(request.db, { failure, productId }, request),
    request,
  });
}

function renderAddToCartFailureFragment(
  request: ShopRequest,
  rawInput: unknown,
  failure: AddToCartFailure,
): string {
  const productId = productIdFromRawInput(rawInput);
  const product = productId ? request.db.products.get(productId) : undefined;

  if (!product) return renderAddToCartError(failure);

  return renderAddToCartForm(product, failure, request);
}

function productIdFromRawInput(rawInput: unknown): string | undefined {
  if (typeof rawInput !== 'object' || rawInput === null || !('productId' in rawInput)) {
    return undefined;
  }
  const productId = rawInput.productId;
  return typeof productId === 'string' ? productId : undefined;
}
