import { component } from '@jiso/core';
import { domain, mutation, query, renderPageHints, s } from '@jiso/server';
import type { FwExplainInput } from '../../../packages/cli/src/index.js';

export interface CommerceDb {
  cartItems: { productId: string; qty: number; unitPrice: number }[];
  products: Map<string, { id: string; stock: number; unitPrice: number }>;
  read(table: string): unknown[];
  write(table: string, value: unknown): void;
}

export function createCommerceDb(): CommerceDb {
  const db: CommerceDb = {
    cartItems: [],
    products: new Map([['p1', { id: 'p1', stock: 5, unitPrice: 1499 }]]),
    read(table) {
      if (table === 'cart_items') return db.cartItems;
      if (table === 'products') return [...db.products.values()];
      return [];
    },
    write(table, value) {
      if (table === 'cart_items') {
        db.cartItems.push(value as { productId: string; qty: number; unitPrice: number });
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
export const product = domain('product');

export const cartQuery = query('cart', {
  load: (_input: unknown) => ({ count: 1 }),
  reads: [cart],
});

export const addToCart = mutation('cart/add', {
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
  },
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  registry: {
    queries: [cartQuery],
    touches: [cart, product],
  },
  handler(input, request: { db: CommerceDb }, context) {
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

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  queries: { cart: cartQuery },
  state: () => ({}),
  render: () =>
    '<cart-badge class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm" fw-deps="cart"><span>Cart</span><span class="rounded bg-teal-600 px-2 py-0.5 text-white" data-bind="cart.count">1</span></cart-badge>',
});

export const commercePageHints = renderPageHints({
  stylesheets: ['/assets/tailwind.css'],
});

export function renderCartPage(): string {
  return `<html><head>${commercePageHints.html}</head><body class="min-h-dvh bg-slate-50 p-6"><main class="mx-auto max-w-4xl"><fw-fragment target="cart-badge">${CartBadge.definition.render()}</fw-fragment></main></body></html>`;
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
  ],
  mutations: [
    {
      guards: ['rateLimit:session'],
      invalidates: ['cart'],
      key: 'cart/add',
      writes: ['cart', 'product'],
    },
  ],
  optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'await-fragment' }],
  pages: [
    {
      modulepreloads: [],
      prefetch: false,
      queries: ['cart'],
      route: '/cart',
    },
  ],
  queries: [{ domains: ['cart'], query: 'cart' }],
  touchGraph: commerceTouchGraph as unknown as FwExplainInput['touchGraph'],
} satisfies FwExplainInput;
