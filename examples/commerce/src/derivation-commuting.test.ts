import { describe, expect, it } from 'vitest';

import {
  addToCartOptimistic,
  createCommerceDb,
  loadCartQuery,
  loadOrderHistory,
  loadProductGrid,
  type AddToCartInput,
  type CommerceDb,
  type OrderHistoryResult,
  type ProductGridResult,
} from './app.js';
import { seedCommerceState } from './app-test-helpers.js';

// SPEC.md §10.5 / §11.4 point 4: the commuting diagram is the deriver's test
// suite — patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i)) for every
// derivable pair. We prove it for all three commerce cart/add derived transforms
// against the REAL async query loaders (run over a real Drizzle/PGlite database
// seeded from the case state) and the real cart/add write effect, modulo
// content-matched placeholder columns (the server-computed order id/total/userId).

interface CommerceState {
  cartItems: { productId: string; qty: number; unitPrice: number }[];
  orders: { id: string; productId: string; qty: number; total: number; userId: string }[];
  products: Record<string, { id: string; stock: number; unitPrice: number }>;
  userId: string;
}

// Seed a real Drizzle/PGlite db from `state` so the REAL loaders run over
// genuine Postgres semantics (not a hand-rolled shim). One db is reused across
// cases (truncate + reseed) — creating a fresh PGlite per case is far slower.
async function seedFrom(db: CommerceDb, state: CommerceState): Promise<CommerceDb> {
  await seedCommerceState(db, {
    cartItems: state.cartItems,
    orders: state.orders,
    products: Object.values(state.products),
  });
  return db;
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

// Drop the placeholder columns (id/total/userId) — content-matched on reconcile.
function orderHistoryProjection(shape: OrderHistoryResult): { productId: string; qty: number }[] {
  return shape.items.map((order) => ({ productId: order.productId, qty: order.qty }));
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
            // SECURITY (SECURITY_FINDINGS.md M9): orderHistory is now scoped to the
            // session user, so the seeded prior order must belong to the same user
            // (`u-test`) to remain visible in the loaded shape; otherwise it is
            // (correctly) filtered out and the case degenerates to the empty seed.
            orders:
              seeded === 0
                ? []
                : [
                    {
                      id: 'order-0',
                      productId: 'p1',
                      qty: seeded,
                      total: 1499 * seeded,
                      userId: 'u-test',
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

// patch(clientShape(s), i) ≡ project(clientShape(apply(s, i))) for each case.
async function assertCommutes<Shape>(
  loadShape: (db: CommerceDb) => Promise<Shape>,
  transform: (shape: Shape, input: AddToCartInput) => Shape,
  project: (shape: Shape) => unknown = (shape) => shape,
): Promise<number> {
  const db = createCommerceDb();
  let count = 0;
  for (const { input, state } of commerceCases()) {
    const predicted = project(transform(await loadShape(await seedFrom(db, state)), input));
    const eventual = project(await loadShape(await seedFrom(db, applyAddToCart(state, input))));
    expect(predicted).toEqual(eventual);
    count += 1;
  }
  return count;
}

describe('commerce derived optimism — commuting diagrams (SPEC §10.5)', () => {
  it('cart (INSERT × SUM): patch(clientShape(s)) ≡ clientShape(apply)', async () => {
    expect(await assertCommutes(loadCartQuery, cartTransform)).toBe(18);
  });

  it('productGrid (UPDATE keyed scalar, guarded + paginated): commutes on- and off-page', async () => {
    expect(
      await assertCommutes(
        (db) => loadProductGrid(db),
        productGridTransform as (
          shape: ProductGridResult,
          input: AddToCartInput,
        ) => ProductGridResult,
      ),
    ).toBe(18);
  });

  it('orderHistory (INSERT × AGG push): commutes modulo placeholder columns', async () => {
    expect(
      // SECURITY (SECURITY_FINDINGS.md M9): the loader is per-user, so bind it to the
      // case's session user (`u-test`) — the same user the seeded/new orders belong to.
      await assertCommutes(
        (db) => loadOrderHistory(db, 'u-test'),
        orderHistoryTransform,
        orderHistoryProjection,
      ),
    ).toBe(18);
  });

  it('fails loudly on a deliberately-broken derivation', async () => {
    // Wrong: doubles the contribution — must NOT commute.
    const brokenCartTransform = (shape: { count: number }, input: AddToCartInput) => ({
      count: shape.count + input.quantity * 2,
    });
    await expect(assertCommutes(loadCartQuery, brokenCartTransform)).rejects.toThrow();
  });
});
