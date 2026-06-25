import { describe, expect, it } from 'vitest';

import { csrfToken } from '@kovojs/server';
import {
  componentLiveTargetRenderer,
  createLiveTargetAttestation,
  renderMutationEndpointResponse,
  type MutationWireHeaderSource,
} from '@kovojs/server/internal/wire';
import { propertyTest } from '@kovojs/test/assertions';

import {
  addToCart,
  addToCartOptimistic,
  ProductList,
  renderAddToCartError,
  renderAddToCartForm,
  renderShopPage,
  shopCsrf,
  type AddToCartFailure,
  type AddToCartInput,
  type ShopRequest,
} from './app.js';
import { CartBadge } from './components/cart-badge.js';
import { createShopDb } from './db.js';

// Tutorial step 05: invalidation is derived from declared touches, server
// truth rides the same wire as fragments, and every optimistic prediction is
// a pure draft transform that can be property-tested against the real handler
// (SPEC.md sections 10.3-10.6, 11.4).

function shopRequest(db = createShopDb()): ShopRequest {
  return { db, session: { id: 's1' } };
}

function formInput(request: ShopRequest, fields: Record<string, string>) {
  return { ...fields, 'kovo-csrf': csrfToken(request, shopCsrf) };
}

function submitAddToCart(
  rawInput: unknown,
  request: ShopRequest,
  headers: MutationWireHeaderSource,
) {
  const productId = productIdFromRawInput(rawInput);
  return renderMutationEndpointResponse(addToCart, {
    buildToken: 'tutorial-step-05-test-build',
    headers: withAttestedLiveTargets(headers, request),
    liveTargetRenderers: successLiveTargetRenderers(),
    rawInput,
    redirectTo: '/',
    renderFailureFragment: (failure) => renderAddToCartFailureFragment(request, rawInput, failure),
    renderFailurePage: (failure) => renderShopPage(request.db, { failure, productId }, request),
    request,
  });
}

function successLiveTargetRenderers() {
  return [
    componentLiveTargetRenderer({
      component: CartBadge,
      componentId: 'components/cart-badge/cart-badge',
    }),
    componentLiveTargetRenderer({
      component: ProductList,
      componentId: 'components/product-list/product-list',
    }),
  ];
}

function withAttestedLiveTargets(
  headers: MutationWireHeaderSource,
  request: ShopRequest,
): MutationWireHeaderSource {
  const value = headers['Kovo-Live-Targets'];
  if (typeof value !== 'string') return headers;

  return { ...headers, 'Kovo-Live-Targets': attestLiveTargetEntries(value, request) };
}

function attestLiveTargetEntries(value: string, request: ShopRequest): string {
  return value
    .split(';')
    .map((entry) => {
      const trimmed = entry.trim();
      const componentSeparator = trimmed.indexOf('#');
      const propsSeparator = trimmed.indexOf(':', componentSeparator + 1);
      if (componentSeparator <= 0 || propsSeparator <= componentSeparator + 1) return trimmed;
      const target = trimmed.slice(0, componentSeparator);
      const component = trimmed.slice(componentSeparator + 1, propsSeparator);
      const propsJson = trimmed.slice(propsSeparator + 1);
      const props = JSON.parse(propsJson) as Record<string, unknown>;
      const token = createLiveTargetAttestation({ component, props, target }, { request });
      return `${target}#${component}@${token}:${propsJson}`;
    })
    .join('; ');
}

function renderAddToCartFailureFragment(
  request: ShopRequest,
  rawInput: unknown,
  failure: AddToCartFailure,
) {
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
      applyOptimisticTransform(
        addToCartOptimistic.transforms.cart,
        { count: 1 },
        { productId: 'p1', quantity: 2 },
      ),
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
          return applyOptimisticTransform(
            addToCartOptimistic.transforms.cart,
            shapeCartQuery(state),
            input,
          );
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

function applyOptimisticTransform<Value, Input>(
  transform: unknown,
  current: Value,
  input: Input,
): Value {
  if (typeof transform !== 'function') return current;

  const draft = structuredClone(current);
  const returned = (transform as (draft: Value, input: Input) => unknown)(draft, input);
  return returned === undefined ? draft : (returned as Value);
}
