import { propertyTest } from '@jiso/test/assertions';
import { describe, expect, it } from 'vitest';

import {
  addToCartOptimistic,
  loadCartQuery,
  loadProductGrid,
  type AddToCartInput,
  type CommerceDb,
  type ProductGridResult,
} from './app.js';

// SPEC.md §10.5 / §11.4 point 4: the commuting diagram is the deriver's test
// suite — patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i)) for every
// derivable pair. Here we prove it for all three commerce cart/add derived
// transforms against the real query loaders and the real cart/add write effect
// (mirrored from the handler), modulo content-matched placeholder columns.

interface CommerceState {
  cartItems: { productId: string; qty: number; unitPrice: number }[];
  orders: { id: string; productId: string; qty: number; total: number; userId: string }[];
  products: Record<string, { id: string; stock: number; unitPrice: number }>;
  userId: string;
}

// A minimal read-only db shim so the REAL loaders run over plain (cloneable) state.
function dbFor(state: CommerceState): CommerceDb {
  return {
    read(table: string) {
      if (table === 'cart_items') return state.cartItems;
      if (table === 'orders') return state.orders;
      if (table === 'products') return Object.values(state.products);
      return [];
    },
  } as unknown as CommerceDb;
}

// The real cart/add write effect (app.ts handler): append cart item + order row,
// decrement the product's stock. Server-computed columns (order id, total, userId)
// are exactly the placeholder columns the derived push leaves pending.
function applyAddToCart(state: CommerceState, input: AddToCartInput): CommerceState {
  const found = state.products[input.productId];
  if (!found || found.stock < input.quantity) {
    throw new Error(`invalid commuting case: ${input.productId}`);
  }
  return {
    cartItems: [
      ...state.cartItems,
      { productId: input.productId, qty: input.quantity, unitPrice: found.unitPrice },
    ],
    orders: [
      ...state.orders,
      {
        id: `order-${state.orders.length + 1}`,
        productId: input.productId,
        qty: input.quantity,
        total: found.unitPrice * input.quantity,
        userId: state.userId,
      },
    ],
    products: {
      ...state.products,
      [input.productId]: { ...found, stock: found.stock - input.quantity },
    },
    userId: state.userId,
  };
}

function orderHistoryShape(state: CommerceState): { items: { productId: string; qty: number }[] } {
  // Drop the placeholder columns (id/total/userId) — content-matched on reconcile.
  return { items: state.orders.map((order) => ({ productId: order.productId, qty: order.qty })) };
}

function commerceCases(): { input: AddToCartInput; state: CommerceState }[] {
  const cases: { input: AddToCartInput; state: CommerceState }[] = [];
  for (const productId of ['p1', 'p2', 'p3']) {
    for (const quantity of [1, 2]) {
      for (const seeded of [0, 1, 3]) {
        cases.push({
          input: { productId, quantity },
          state: {
            cartItems: seeded === 0 ? [] : [{ productId: 'p1', qty: seeded, unitPrice: 1499 }],
            orders:
              seeded === 0
                ? []
                : [
                    {
                      id: 'order-0',
                      productId: 'p1',
                      qty: seeded,
                      total: 1499 * seeded,
                      userId: 'u9',
                    },
                  ],
            products: {
              p1: { id: 'p1', stock: 6, unitPrice: 1499 },
              p2: { id: 'p2', stock: 4, unitPrice: 2599 },
              p3: { id: 'p3', stock: 8, unitPrice: 399 },
            },
            userId: 'u-test',
          },
        });
      }
    }
  }
  return cases;
}

const cartTransform = addToCartOptimistic.transforms.cart;
const productGridTransform = addToCartOptimistic.transforms.productGrid;
const orderHistoryTransform = addToCartOptimistic.transforms.orderHistory;

describe('commerce derived optimism — commuting diagrams (SPEC §10.5)', () => {
  it('cart (INSERT × SUM): patch(clientShape(s)) ≡ clientShape(apply)', () => {
    expect(
      propertyTest<CommerceState, AddToCartInput, { count: number }>({
        apply: applyAddToCart,
        cases: commerceCases(),
        predict: (state, input) => cartTransform(loadCartQuery(dbFor(state)), input),
        shape: (state) => loadCartQuery(dbFor(state)),
      }),
    ).toEqual({ cases: 18 });
  });

  it('productGrid (UPDATE keyed scalar, guarded + paginated): commutes on- and off-page', () => {
    expect(
      propertyTest<CommerceState, AddToCartInput, ProductGridResult>({
        apply: applyAddToCart,
        cases: commerceCases(),
        predict: (state, input) => productGridTransform(loadProductGrid(dbFor(state)), input),
        shape: (state) => loadProductGrid(dbFor(state)),
      }),
    ).toEqual({ cases: 18 });
  });

  it('orderHistory (INSERT × AGG push): commutes modulo placeholder columns', () => {
    expect(
      propertyTest<CommerceState, AddToCartInput, { items: { productId: string; qty: number }[] }>({
        apply: applyAddToCart,
        cases: commerceCases(),
        predict: (state, input) => {
          const predicted = orderHistoryTransform({ items: state.orders }, input);
          return orderHistoryShape({ ...state, orders: predicted.items });
        },
        shape: orderHistoryShape,
      }),
    ).toEqual({ cases: 18 });
  });

  it('fails loudly on a deliberately-broken derivation', () => {
    expect(() =>
      propertyTest<CommerceState, AddToCartInput, { count: number }>({
        apply: applyAddToCart,
        cases: commerceCases(),
        // Wrong: doubles the contribution — must NOT commute.
        predict: (state, input) => ({
          count: loadCartQuery(dbFor(state)).count + input.quantity * 2,
        }),
        shape: (state) => loadCartQuery(dbFor(state)),
      }),
    ).toThrow(/Optimistic property failed/);
  });
});
