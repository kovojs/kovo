import { describe, expect, it } from 'vitest';

import { renderRouteHtml } from '@kovojs/server/rendering';
import { mutationCsrfTokenForTesting as csrfToken } from '@kovojs/test/csrf';
import {
  renderDeferredStream,
  type DeferredStreamChunk,
} from '../../../../../packages/server/src/internal/html.js';
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
import {
  encodeTutorialMutationHeaders,
  encodeTutorialQueryDependency,
} from '../../../mutation-wire-test-headers.js';

import {
  addToCart,
  homeRoute,
  renderAddToCartError,
  renderAddToCartForm,
  shopCsrf,
  type AddToCartFailure,
  type ShopRequest,
} from './app.js';
import { createShopDb, createShopRequest } from './db.js';
import { CartBadge } from './components/cart-badge.js';
import { ProductList } from './components/product-list.js';
import { cartQuery, productsQuery } from './queries.js';

type TutorialMutationHeaders = Record<string, readonly string[] | string | undefined>;
type AddToCartRequest = Parameters<typeof addToCart.handler>[1];

const tutorialLiveTargetAuthority = createLiveTargetTestAuthority<AddToCartRequest>(
  'tutorial-step-06-test-build',
  shopCsrf,
);
const tutorialWireCsrf = tutorialLiveTargetAuthority.app.csrf;

// Tutorial step 06: <kovo-defer> streams the product list out of order inside
// one response, reusing the mutation wire's fragment/query vocabulary
// (SPEC.md section 8) — assertable as a plain string, no browser.

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
    buildToken: 'tutorial-step-06-test-build',
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

// snippet:deferred-stream
async function renderShopPageDeferredStream(db = createShopDb()) {
  const request = shopRequest(db);
  const response = await renderRoutePageResponse(homeRoute, {}, request, renderRouteHtml, {
    attestationAuthority: tutorialLiveTargetAuthority.authority,
    ...(tutorialWireCsrf === undefined ? {} : { csrf: tutorialWireCsrf }),
  });
  if (typeof response.body !== 'string') throw new Error('expected a string page body');
  const pendingChunks =
    'deferredChunks' in response && Array.isArray(response.deferredChunks)
      ? response.deferredChunks
      : [];
  const chunks: DeferredStreamChunk[] = await Promise.all(pendingChunks);
  return renderDeferredStream({
    chunks,
    shell: response.body,
  });
}
// /snippet

describe('tutorial step 06 — streaming & defer', () => {
  // snippet:defer-test
  it('streams the shell first, the product list later in the same response', async () => {
    const response = await renderShopPageDeferredStream(createShopDb());

    expect(response).toMatchObject({
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 200,
    });

    // The shell renders a declared fallback…
    expect(response.body).toContain('<kovo-defer target="product-list" state="pending"');
    // …and the real fragment follows in the same body, after the shell.
    const deferIndex = response.body.indexOf('<kovo-defer target="product-list"');
    const fragmentIndex = response.body.indexOf('<kovo-fragment target="product-list"');
    expect(deferIndex).toBeGreaterThan(-1);
    expect(fragmentIndex).toBeGreaterThan(deferIndex);
  });
  // /snippet

  // snippet:query-order-test
  it('keeps the deferred consumer bound to its compiler-derived query identity', async () => {
    const response = await renderShopPageDeferredStream(createShopDb());
    const fragmentIndex = response.body.indexOf('<kovo-fragment target="product-list"');
    const dependencyIndex = response.body.indexOf(
      `kovo-deps="${encodeTutorialQueryDependency(productsQuery.key)}"`,
    );
    expect(fragmentIndex).toBeGreaterThan(-1);
    expect(dependencyIndex).toBeGreaterThan(fragmentIndex);
  });
  // /snippet

  it('keeps the mutation wire working unchanged alongside streaming', async () => {
    const request = shopRequest();
    const response = await submitAddToCart(
      formInput(request, { productId: 'p1', quantity: '1' }),
      request,
      {
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets':
          'cart-badge#components/cart-badge/cart-badge:{}; product-list#components/product-list/product-list:{}',
        'Kovo-Targets': `cart-badge=${cartQuery.key}; product-list=${productsQuery.key}`,
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toContain(`<kovo-query name="${cartQuery.key}">{"count":1}</kovo-query>`);
  });
});
