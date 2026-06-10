import { component } from '@jiso/core';
import { domain, guards, i18n, meta, mutation, query, renderPageHints, s, t } from '@jiso/server';
import type { FwExplainInput } from '../../../packages/cli/src/index.js';

export interface CommerceDb {
  cartItems: { productId: string; qty: number; unitPrice: number }[];
  orders: { id: string; productId: string; qty: number; total: number }[];
  products: Map<string, { id: string; stock: number; unitPrice: number }>;
  read(table: string): unknown[];
  write(table: string, value: unknown): void;
}

export interface CommerceRequest {
  db: CommerceDb;
  session?: { id?: string; user?: { id: string } | null } | null;
}

export function createCommerceDb(): CommerceDb {
  const db: CommerceDb = {
    cartItems: [],
    orders: [],
    products: new Map([
      ['p1', { id: 'p1', stock: 5, unitPrice: 1499 }],
      ['p2', { id: 'p2', stock: 2, unitPrice: 2599 }],
      ['p3', { id: 'p3', stock: 8, unitPrice: 399 }],
    ]),
    read(table) {
      if (table === 'cart_items') return db.cartItems;
      if (table === 'orders') return db.orders;
      if (table === 'products') return [...db.products.values()];
      return [];
    },
    write(table, value) {
      if (table === 'cart_items') {
        db.cartItems.push(value as { productId: string; qty: number; unitPrice: number });
      }
      if (table === 'orders') {
        db.orders.push(value as { id: string; productId: string; qty: number; total: number });
      }
      if (table === 'products') {
        const product = value as { id: string; stock: number; unitPrice: number };
        db.products.set(product.id, product);
      }
    },
  };
  return db;
}

export const cart = domain('cart');
export const order = domain('order');
export const product = domain('product');

export const cartQuery = query('cart', {
  load: (_input: unknown) => ({ count: 1 }),
  reads: [cart],
});

export interface ProductGridInput {
  after?: string;
  limit?: number;
}

export interface ProductGridResult {
  items: { id: string; stock: number; unitPrice: number }[];
  nextCursor: string | null;
}

export const productGridQuery = query('productGrid', {
  load: (input: unknown) => loadProductGrid(createCommerceDb(), input as ProductGridInput),
  reads: [product],
});

export const orderHistoryQuery = query('orderHistory', {
  load: (_input: unknown) => ({ items: [] as CommerceDb['orders'] }),
  reads: [order],
});

export const addToCart = mutation('cart/add', {
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
  },
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  guard: guards.all(
    guards.authed<CommerceRequest>(),
    guards.rateLimit<CommerceRequest>({ max: 10, per: 'session' }),
  ),
  registry: {
    queries: [cartQuery, productGridQuery, orderHistoryQuery],
    touches: [cart, product, order],
  },
  handler(input, request: CommerceRequest, context) {
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
    });
    request.db.write('products', {
      ...found,
      stock: found.stock - input.quantity,
    });
    return { productId: input.productId, quantity: input.quantity };
  },
});

export const commerceMeta = meta({
  description: 'Browse products and checkout with a verifiable cart.',
  title: 'Jiso Commerce',
});

export const commerceMessages = i18n('en-US', {
  cartLabel: 'Cart',
  productStock: '{count} in stock',
});

export function loadProductGrid(db: CommerceDb, input: ProductGridInput = {}): ProductGridResult {
  const limit = input.limit ?? 2;
  const products = [...db.products.values()].sort((left, right) => left.id.localeCompare(right.id));
  const start = input.after
    ? Math.max(products.findIndex((item) => item.id === input.after) + 1, 0)
    : 0;
  const items = products.slice(start, start + limit);
  const next = products[start + limit];

  return {
    items,
    nextCursor: next ? (items.at(-1)?.id ?? null) : null,
  };
}

export function renderProductGrid(result: ProductGridResult): string {
  const items = result.items
    .map(
      (item) =>
        `<article data-key="${item.id}" class="rounded border border-slate-200 bg-white p-4"><h2 class="font-semibold">${item.id}</h2><p data-bind="productGrid.items.stock">${item.stock} in stock</p></article>`,
    )
    .join('');
  const more = result.nextCursor
    ? `<a href="/products?after=${result.nextCursor}" data-cursor="${result.nextCursor}">More</a>`
    : '';

  return `<section fw-c="product-grid" fw-deps="product" data-page-cursor="${result.nextCursor ?? ''}">${items}${more}</section>`;
}

export function renderOrderHistory(db: CommerceDb): string {
  const items = db.orders
    .map((item) => `<li data-key="${item.id}">${item.productId} x ${item.qty} - ${item.total}</li>`)
    .join('');

  return `<ol fw-c="order-history" fw-deps="order">${items}</ol>`;
}

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  queries: { cart: cartQuery },
  state: () => ({}),
  render: () =>
    `<cart-badge class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm" fw-deps="cart"><span>${t(commerceMessages, 'cartLabel')}</span><span class="rounded bg-teal-600 px-2 py-0.5 text-white" data-bind="cart.count">1</span></cart-badge>`,
});

export const commercePageHints = renderPageHints({
  i18n: commerceMessages,
  meta: commerceMeta,
  stylesheets: ['/assets/tailwind.css'],
});

export function renderCartPage(): string {
  const db = createCommerceDb();
  return `<html><head>${commercePageHints.html}</head><body class="min-h-dvh bg-slate-50 p-6"><main class="mx-auto max-w-4xl"><fw-fragment target="cart-badge">${CartBadge.definition.render()}</fw-fragment><fw-fragment target="product-grid">${renderProductGrid(loadProductGrid(db))}</fw-fragment><fw-fragment target="order-history">${renderOrderHistory(db)}</fw-fragment></main></body></html>`;
}

export const commerceTouchGraph = {
  'cart.addItem': {
    touches: [
      { domain: 'cart', keys: null, site: 'examples/commerce/src/app.ts:58', via: 'cart_items' },
      {
        domain: 'product',
        keys: 'arg:productId',
        site: 'examples/commerce/src/app.ts:63',
        via: 'products',
      },
      { domain: 'order', keys: null, site: 'examples/commerce/src/app.ts:67', via: 'orders' },
    ],
    unresolved: [],
  },
} as const;

export const commerceGraph = {
  components: [
    {
      fragments: ['cart-badge'],
      name: 'CartBadge',
      queries: ['cart'],
    },
    {
      fragments: ['product-grid'],
      name: 'ProductGrid',
      queries: ['productGrid'],
    },
    {
      fragments: ['order-history'],
      name: 'OrderHistory',
      queries: ['orderHistory'],
    },
  ],
  mutations: [
    {
      guards: ['authed', 'rateLimit:session'],
      invalidates: ['cart', 'product', 'order'],
      key: 'cart/add',
      writes: ['cart', 'product', 'order'],
    },
  ],
  optimistic: [
    { mutation: 'cart/add', query: 'cart', status: 'await-fragment' },
    { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
    { mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' },
  ],
  pages: [
    {
      modulepreloads: [],
      prefetch: false,
      queries: ['cart', 'productGrid', 'orderHistory'],
      route: '/cart',
    },
  ],
  queries: [
    { domains: ['cart'], query: 'cart' },
    { domains: ['product'], query: 'productGrid' },
    { domains: ['order'], query: 'orderHistory' },
  ],
  touchGraph: commerceTouchGraph,
} satisfies FwExplainInput;
