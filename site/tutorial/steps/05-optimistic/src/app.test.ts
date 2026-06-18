import { describe, expect, it } from 'vitest';

import { csrfToken } from '@kovojs/server';
import { propertyTest } from '@kovojs/test/assertions';

import {
  addToCart,
  addToCartOptimistic,
  shopCsrf,
  submitAddToCart,
  type AddToCartInput,
  type ShopRequest,
} from './app.js';
import { createShopDb } from './db.js';

// Tutorial step 05: invalidation is derived from declared touches, server
// truth rides the same wire as fragments, and every optimistic prediction is
// a pure transform that can be property-tested against the real handler
// (SPEC.md sections 10.3-10.6, 11.4).

function shopRequest(db = createShopDb()): ShopRequest {
  return { db, session: { id: 's1' } };
}

function formInput(request: ShopRequest, fields: Record<string, string>) {
  return { ...fields, 'kovo-csrf': csrfToken(request, shopCsrf) };
}

interface ShopPropertyState {
  cartItems: { productId: string; qty: number }[];
  products: Record<string, { stock: number }>;
}

// snippet:property-helpers
// The real write effect, restated over plain state: what the handler commits.
function applyAddToCart(state: ShopPropertyState, input: AddToCartInput): ShopPropertyState {
  const found = state.products[input.productId];
  if (!found || found.stock < input.quantity) {
    throw new Error(`invalid property case for ${input.productId}`);
  }

  return {
    cartItems: [...state.cartItems, { productId: input.productId, qty: input.quantity }],
    products: {
      ...state.products,
      [input.productId]: { stock: found.stock - input.quantity },
    },
  };
}

// What the cart query ships to the client for a given state.
function shapeCartQuery(state: ShopPropertyState): { count: number } {
  return { count: state.cartItems.reduce((total, item) => total + item.qty, 0) };
}
// /snippet

function propertyCases(): { input: AddToCartInput; state: ShopPropertyState }[] {
  const cases: { input: AddToCartInput; state: ShopPropertyState }[] = [];

  for (const productId of ['p1', 'p2']) {
    for (const quantity of [1, 2, 3]) {
      for (const initialCount of [0, 1, 5]) {
        cases.push({
          input: { productId, quantity },
          state: {
            cartItems: initialCount === 0 ? [] : [{ productId: 'existing', qty: initialCount }],
            products: {
              p1: { stock: 6 },
              p2: { stock: 4 },
            },
          },
        });
      }
    }
  }

  return cases;
}

describe('tutorial step 05 — invalidation & optimistic updates', () => {
  // snippet:rerun-test
  it('derives the queries to re-run and ships server truth on the wire', async () => {
    const request = shopRequest();
    const response = await submitAddToCart(
      formInput(request, { productId: 'p1', quantity: '2' }),
      request,
      {
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets':
          'cart-badge#components/cart-badge/cart-badge:{}; product-list#components/product-list/product-list:{}',
        'Kovo-Targets': 'cart-badge=cart; product-list=products',
      },
    );

    expect(response.status).toBe(200);
    // Server truth for every invalidated query, as readable chunks: the
    // loader replaces each value and runs its update plan (SPEC.md §9.1).
    expect(response.body).toContain('<kovo-query name="cart">{"count":2}</kovo-query>');
    expect(response.body).toContain('<kovo-query name="products">');
    expect(response.body).toContain('<kovo-fragment target="cart-badge">');
    expect(response.body).toContain('<kovo-fragment target="product-list">');
    // The sanitized write summary: domains and keys, never input values.
    expect(response.headers['Kovo-Changes']).toBe(
      '[{"domain":"cart"},{"domain":"product","keys":["p1"]}]',
    );
  });
  // /snippet

  // snippet:transform-test
  it('predicts the cart count with the hand-written transform', () => {
    expect(addToCartOptimistic.queue).toBe('cart');
    expect(
      addToCartOptimistic.transforms.cart({ count: 1 }, { productId: 'p1', quantity: 2 }),
    ).toEqual({ count: 3 });
    // Every invalidated query has an explicit status (SPEC.md §10.6).
    expect(Object.keys(addToCartOptimistic.transforms).sort()).toEqual(['cart', 'products']);
    expect(addToCartOptimistic.transforms.products).toBe('await-fragment');
  });
  // /snippet

  // snippet:property-test
  it('proves prediction ⊆ eventual truth over generated states', () => {
    expect(
      propertyTest<ShopPropertyState, AddToCartInput, { count: number }>({
        apply(state, input) {
          return applyAddToCart(state, input);
        },
        cases: propertyCases(),
        predict(state, input) {
          return addToCartOptimistic.transforms.cart(shapeCartQuery(state), input);
        },
        shape(state) {
          return shapeCartQuery(state);
        },
      }),
    ).toEqual({ cases: 18 });
  });
  // /snippet

  it('records declared touches as change records on the mutation result', async () => {
    expect(addToCart.registry?.inferredTouches?.map((touch) => touch.domain)).toEqual([
      'cart',
      'product',
    ]);
  });
});
