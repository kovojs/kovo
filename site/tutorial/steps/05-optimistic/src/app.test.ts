import { describe, expect, it } from 'vitest';

import { renderRouteHtml } from '@kovojs/server/rendering';
import { mutationCsrfTokenForTesting as csrfToken } from '@kovojs/test/csrf';
import { renderRoutePageResponse } from '../../../../../packages/server/src/internal/route.js';
import {
  componentLiveTargetRenderer,
  renderMutationEndpointResponse,
} from '../../../../../packages/server/src/internal/wire.js';
import {
  createLiveTargetAttestation,
  type MutationEndpointRequest,
} from '../../../../../packages/server/src/mutation-wire.js';
import { createLiveTargetTestAuthority } from '../../../../../packages/server/src/test-fixtures.js';
import { propertyTest } from '@kovojs/test/assertions';
import { encodeTutorialMutationHeaders } from '../../../mutation-wire-test-headers.js';

import {
  addToCart,
  addToCartTouches,
  homeRoute,
  predictCart,
  ProductList,
  renderAddToCartError,
  renderAddToCartForm,
  shopCsrf,
  type AddToCartFailure,
  type AddToCartInput,
  type ShopRequest,
} from './app.js';
import { CartBadge } from './components/cart-badge.js';
import { createShopDb, createShopRequest } from './db.js';
import { cart, product } from './domains.js';
import { cartQuery, productsQuery } from './queries.js';

type TutorialMutationHeaders = Record<string, readonly string[] | string | undefined>;
type AddToCartRequest = Parameters<typeof addToCart.handler>[1];

const tutorialLiveTargetAuthority = createLiveTargetTestAuthority<AddToCartRequest>(
  'tutorial-step-05-test-build',
  shopCsrf,
);
const tutorialWireCsrf = tutorialLiveTargetAuthority.app.csrf;

// Tutorial step 05: invalidation is derived from declared touches, server
// truth rides the same wire as fragments, and every optimistic prediction is
// a pure draft transform that can be property-tested against the real handler
// (SPEC.md sections 10.3-10.6, 11.4).

function shopRequest(db = createShopDb()): ShopRequest {
  return createShopRequest(db);
}

function formInput(request: ShopRequest, fields: Record<string, string>) {
  return { ...fields, 'kovo-csrf': csrfToken(request, shopCsrf, { mutation: addToCart }) };
}

function submitAddToCart(
  rawInput: unknown,
  request: ShopRequest,
  headers: TutorialMutationHeaders,
) {
  const productId = productIdFromRawInput(rawInput);
  const endpointRequest: MutationEndpointRequest<
    AddToCartRequest,
    { productId: string; quantity: number }
  > = {
    buildToken: 'tutorial-step-05-test-build',
    ...(tutorialWireCsrf === undefined ? {} : { csrf: tutorialWireCsrf }),
    headers: withAttestedLiveTargets(headers, request),
    liveTargetRenderers: successLiveTargetRenderers(),
    liveTargetAttestationAuthority: tutorialLiveTargetAuthority.authority,
    liveTargetAudience: tutorialLiveTargetAuthority.audience,
    rawInput,
    redirectTo: '/',
    renderFailureFragment: (failure) => renderAddToCartFailureFragment(request, rawInput, failure),
    renderFailurePage: (failure) =>
      renderShopPageForTest(request, { failure, productId }, rawInput),
    request,
  };
  return renderMutationEndpointResponse(addToCart, endpointRequest);
}

function successLiveTargetRenderers() {
  return [
    componentLiveTargetRenderer<NonNullable<Parameters<typeof CartBadge>[0]>, AddToCartRequest>({
      component: CartBadge,
      componentId: 'components/cart-badge/cart-badge',
    }),
    componentLiveTargetRenderer<NonNullable<Parameters<typeof ProductList>[0]>, AddToCartRequest>({
      component: ProductList,
      componentId: 'components/product-list/product-list',
    }),
  ];
}

function withAttestedLiveTargets(
  headers: TutorialMutationHeaders,
  request: ShopRequest,
): TutorialMutationHeaders {
  return encodeTutorialMutationHeaders(headers, ({ component, props, target }) =>
    createLiveTargetAttestation(
      { component, props, target },
      {
        buildToken: tutorialLiveTargetAuthority.audience,
        ...(tutorialWireCsrf === undefined ? {} : { csrf: tutorialWireCsrf }),
        request,
      },
    ),
  );
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

async function renderShopPageForTest(
  request: ShopRequest,
  failure?: { failure: AddToCartFailure; productId?: string | undefined },
  rawInput?: unknown,
): Promise<string> {
  const response = await renderRoutePageResponse(homeRoute, {}, request, renderRouteHtml, {
    attestationAuthority: tutorialLiveTargetAuthority.authority,
    ...(tutorialWireCsrf === undefined ? {} : { csrf: tutorialWireCsrf }),
    ...(failure === undefined
      ? {}
      : {
          mutationFailure: {
            failure: failure.failure,
            input: rawInput,
            mutationKey: addToCart.key,
          },
        }),
  });
  if (typeof response.body !== 'string') throw new Error('expected a string page body');
  return response.body;
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
        'Kovo-Targets': `cart-badge=${cartQuery.key}; product-list=${productsQuery.key}`,
      },
    );
    expect(response.status).toBe(200);
    // Server truth for every invalidated query, as readable chunks: the
    // loader replaces each value and runs its update plan (SPEC.md §9.1).
    expect(response.body).toContain(`<kovo-query name="${cartQuery.key}">{"count":2}</kovo-query>`);
    expect(response.body).toContain(`<kovo-query name="${productsQuery.key}">`);
    expect(response.body).toContain('<kovo-fragment target="cart-badge">');
    expect(response.body).toContain('<kovo-fragment target="product-list">');
    // The sanitized write summary: domains and keys, never input values.
    expect(response.headers['Kovo-Changes']).toBe(
      `[{"domain":"${cart.key}"},{"domain":"${product.key}"}]`,
    );
  });
  // /snippet

  // snippet:transform-test
  it('predicts the cart count with the hand-written transform', () => {
    expect(predictCart({ count: 1 }, { productId: 'p1', quantity: 2 })).toEqual({ count: 3 });
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
          return predictCart(shapeCartQuery(state), input);
        },
        shape(state) {
          return shapeCartQuery(state);
        },
      }),
    ).toEqual({ cases: 18 });
  });
  // /snippet

  it('records declared touches as change records on the mutation result', async () => {
    expect(addToCartTouches.map((touch) => touch.domain)).toEqual([cart.key, product.key]);
  });
});
