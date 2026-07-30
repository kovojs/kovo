/** @jsxImportSource @kovojs/server */
import {
  publicAccess,
  route,
  s,
  session,
  type InferSchema,
  type MutationFail,
} from '@kovojs/server';

import { tutorialShopDb, type ShopRequest } from './db.js';
import { CartBadge } from './components/cart-badge.js';
import { cart, order, product } from './domains.js';
import { OrderHistory } from './components/order-history.js';
import * as productListComponent from './components/product-list.js';
import { cartQuery, orderHistoryQuery, productsQuery, type CartResult } from './queries.js';
import { app } from './kovo.js';

// Tutorial step 07 (chapter 7): the finished app is commerce-shaped — three
// islands, a guarded session-typed mutation writing three domains, and a
// declared app graph that kovo check and kovo explain answer questions about
// without executing a browser (SPEC.md sections 5.3, 10.3, 11.4).

export type { ShopRequest } from './db.js';
export { shopCsrf } from './kovo.js';

export type AddToCartFailure = MutationFail<string, unknown>;

export interface AddToCartFailureState {
  failure: AddToCartFailure;
  productId?: string | undefined;
}

export const { ProductList, renderAddToCartError, renderAddToCartForm } = productListComponent;

// snippet:session
// SPEC.md section 6.5: the session is a declared schema, not an any-bag —
// guard refinements and the cart/order userId fields rest on typed fields.
export const shopSession = session(
  s.object({
    id: s.string(),
    user: s.object({
      id: s.string(),
    }),
  }),
);
// /snippet

export const addToCartTouches = [
  {
    domain: cart.key,
    keys: null,
    site: 'site/tutorial/steps/07-verification/src/app.tsx:addToCart',
    via: 'cart_items',
  },
  {
    domain: order.key,
    keys: null,
    site: 'site/tutorial/steps/07-verification/src/app.tsx:addToCart',
    via: 'orders',
  },
  {
    domain: product.key,
    keys: 'arg:productId',
    predicate: 'eq',
    site: 'site/tutorial/steps/07-verification/src/app.tsx:addToCart',
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

const addToCartInput = s.object({
  productId: s.string(),
  quantity: s.number().int().min(1).default(1),
});

export type AddToCartInput = InferSchema<typeof addToCartInput>;

export function predictCart(current: Readonly<CartResult>, input: AddToCartInput): CartResult {
  return { count: current.count + input.quantity };
}

// snippet:add-to-cart
export const addToCart = app.mutation({
  input: addToCartInput,
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
  },
  access: [app.all(app.authenticated, app.rateLimit({ max: 10, per: 'session' }))],
  registry: {
    queries: [cartQuery, productsQuery, orderHistoryQuery],
    touches: [cart, order, product],
  },
  queue: 'cart',
  optimistic: [
    cartQuery.optimistic(addToCartInput, predictCart),
    orderHistoryQuery.optimistic('await-fragment'),
    productsQuery.optimistic('await-fragment'),
  ],
  transaction<Result>(
    request: ShopRequest,
    run: (transactionRequest: ShopRequest) => Promise<Result>,
  ): Promise<Result> {
    return tutorialShopDb(request).transaction((db) =>
      run(Object.assign(request.clone(), request, { db })),
    );
  },
  handler(input, request, context) {
    const currentSession = shopSession.parse(request);
    const found = request.db.products.get(input.productId);
    if (!found || found.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }

    request.db.cartItems.push({
      productId: input.productId,
      qty: input.quantity,
      unitPrice: found.unitPrice,
      userId: currentSession.user.id,
    });
    request.db.orders.push({
      id: `order-${request.db.orders.length + 1}`,
      productId: input.productId,
      qty: input.quantity,
      total: found.unitPrice * input.quantity,
      userId: currentSession.user.id,
    });
    request.db.products.set(input.productId, { ...found, stock: found.stock - input.quantity });
    return { productId: input.productId, quantity: input.quantity };
  },
});
// /snippet

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
      key: addToCart.key,
      session: 'shopSession',
      writes: ['cart', 'product', 'order'],
    },
  ],
  optimistic: [
    { mutation: addToCart.key, query: 'cart', status: 'hand-written' },
    { mutation: addToCart.key, query: 'products', status: 'await-fragment' },
    { mutation: addToCart.key, query: 'orderHistory', status: 'await-fragment' },
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

export const homeRoute = route('/', {
  access: publicAccess('tutorial storefront browsing'),
  page(_input, request: ShopRequest) {
    return (
      <html>
        <head>
          <title>Kovo Shop</title>
        </head>
        <body>
          <main>
            <h1>Kovo Shop</h1>
            {request.session?.user?.id ? <CartBadge /> : null}
            <ProductList />
            {request.session?.user?.id ? <OrderHistory /> : null}
          </main>
        </body>
      </html>
    );
  },
});
