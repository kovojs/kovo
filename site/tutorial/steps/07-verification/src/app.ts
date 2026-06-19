import { form, type FormInput } from '@kovojs/core';
import type { OptimisticFor } from '@kovojs/browser';
import { guards, mutation, route, s, session, type MutationFail } from '@kovojs/server';

import './registries.js';
import { createShopDb, type ShopDb, type ShopRequest } from './db.js';
import { CartBadge } from './components/cart-badge.js';
import { OrderHistory } from './components/order-history.js';
import * as productListComponent from './components/product-list.js';
import {
  cartQuery,
  loadCart,
  loadOrderHistory,
  loadProducts,
  orderHistoryQuery,
  productsQuery,
} from './queries.js';

// Tutorial step 07 (chapter 7): the finished app is commerce-shaped — three
// islands, a guarded session-typed mutation writing three domains, and a
// declared app graph that kovo check and kovo explain answer questions about
// without executing a browser (SPEC.md sections 5.3, 10.3, 11.4).

export type { ShopRequest } from './db.js';

export type AddToCartFailure = MutationFail<string, unknown>;

export interface AddToCartFailureState {
  failure: AddToCartFailure;
  productId?: string | undefined;
}

export const { ProductList, renderAddToCartError, renderAddToCartForm } = productListComponent;

// snippet:session
// SPEC.md section 6.5: the session is a declared schema, not an any-bag —
// guard refinements and the order's userId rest on typed fields.
export const shopSession = session(
  s.object({
    id: s.string(),
    user: s.object({
      id: s.string(),
    }),
  }),
);
// /snippet

export const shopCsrf = {
  secret: 'tutorial-shop-secret',
  sessionId(request: ShopRequest) {
    return request.session?.id;
  },
};

export const addToCartForm = form('cart/add');
export type AddToCartInput = FormInput<typeof addToCartForm>;

export const addToCartTouches = [
  {
    domain: 'cart',
    keys: null,
    site: 'site/tutorial/steps/07-verification/src/app.ts:addToCart',
    via: 'cart_items',
  },
  {
    domain: 'order',
    keys: null,
    site: 'site/tutorial/steps/07-verification/src/app.ts:addToCart',
    via: 'orders',
  },
  {
    domain: 'product',
    keys: 'arg:productId',
    predicate: 'eq',
    site: 'site/tutorial/steps/07-verification/src/app.ts:addToCart',
    via: 'products',
  },
] as const;

export const shopTouchGraph = {
  'cart.addItem': {
    reads: [],
    touches: addToCartTouches,
    unresolved: [],
  },
} as const;

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
  guard: guards.all(
    guards.authed<ShopRequest>(),
    guards.rateLimit<ShopRequest>({ max: 10, per: 'session' }),
  ),
  registry: {
    inferredTouches: addToCartTouches,
    queries: [cartQuery, productsQuery, orderHistoryQuery],
  },
  transaction(request: ShopRequest, run) {
    return request.db.transaction((db) => run({ ...request, db }));
  },
  handler(input, request: ShopRequest, context) {
    const currentSession = shopSession.parse(request);
    const found = request.db.products.get(input.productId);
    if (!found || found.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }

    request.db.write('cart_items', {
      productId: input.productId,
      qty: input.quantity,
      unitPrice: found.unitPrice,
    });
    request.db.write('orders', {
      id: `order-${request.db.orders.length + 1}`,
      productId: input.productId,
      qty: input.quantity,
      total: found.unitPrice * input.quantity,
      userId: currentSession.user.id,
    });
    request.db.write('products', {
      ...found,
      stock: found.stock - input.quantity,
    });
    return { productId: input.productId, quantity: input.quantity };
  },
});
// /snippet

export const addToCartOptimistic = {
  queue: 'cart',
  transforms: {
    cart(current, input) {
      return {
        count: (current?.count ?? 0) + input.quantity,
      };
    },
    orderHistory: 'await-fragment',
    products: 'await-fragment',
  },
} satisfies OptimisticFor<typeof addToCartForm>;

// snippet:graph
// The app graph: every fact kovo check and kovo explain reason over. In the
// blessed @kovojs/drizzle path most of this is derived (SPEC.md section 11.1);
// examples/commerce commits it as a generated artifact. Declared or derived,
// it is the same machine-checkable shape (section 11.4).
export const shopGraph = {
  components: [
    { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
    { fragments: ['product-list'], name: 'ProductList', queries: ['products'] },
    { fragments: ['order-history'], name: 'OrderHistory', queries: ['orderHistory'] },
  ],
  mutations: [
    {
      guards: ['authed', 'rateLimit:session'],
      invalidates: ['cart', 'product', 'order'],
      inputFields: ['productId', 'quantity'],
      key: 'cart/add',
      session: 'shopSession',
      writes: ['cart', 'product', 'order'],
    },
  ],
  optimistic: [
    { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    { mutation: 'cart/add', query: 'products', status: 'await-fragment' },
    { mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' },
  ],
  pages: [
    {
      modulepreloads: [],
      prefetch: false,
      queries: ['cart', 'products', 'orderHistory'],
      route: '/',
      stylesheets: [],
    },
  ],
  queries: [
    { domains: ['cart'], query: 'cart' },
    { domains: ['product'], query: 'products' },
    { domains: ['order'], query: 'orderHistory' },
  ],
  touchGraph: shopTouchGraph,
} as const;
// /snippet

export function renderShopPage(
  db: ShopDb = createShopDb(),
  addToCartFailure?: AddToCartFailureState,
  request?: ShopRequest,
): string {
  const cart = loadCart(db);
  const products = loadProducts(db);
  const orderHistory = loadOrderHistory(db);
  const badge = `<kovo-fragment target="cart-badge">${CartBadge.definition.render({ cart })}</kovo-fragment>`;
  const list = `<kovo-fragment target="product-list">${ProductList.definition.render({ products }, { failure: addToCartFailure, request })}</kovo-fragment>`;
  const orders = `<kovo-fragment target="order-history">${OrderHistory.definition.render({ orderHistory })}</kovo-fragment>`;

  return `<!doctype html><html><head><title>Kovo Shop</title></head><body><main><h1>Kovo Shop</h1>${badge}${list}${orders}</main></body></html>`;
}

export const homeRoute = route('/', {
  page() {
    return renderShopPage();
  },
});
