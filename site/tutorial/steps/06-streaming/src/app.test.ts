import { describe, expect, it } from 'vitest';

import { csrfToken, renderMutationEndpointResponse } from '@kovojs/server';
import type { MutationWireHeaderSource } from '@kovojs/server/internal/wire';

import {
  addToCart,
  renderAddToCartError,
  renderAddToCartForm,
  renderShopPage,
  renderShopPageDeferredStream,
  shopCsrf,
  type AddToCartFailure,
  type ShopRequest,
} from './app.js';
import { createShopDb } from './db.js';

// Tutorial step 06: <kovo-defer> streams the product list out of order inside
// one response, reusing the mutation wire's fragment/query vocabulary
// (SPEC.md section 8) — assertable as a plain string, no browser.

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
    headers,
    rawInput,
    redirectTo: '/',
    renderFailureFragment: (failure) => renderAddToCartFailureFragment(request, rawInput, failure),
    renderFailurePage: (failure) => renderShopPage(request.db, { failure, productId }, request),
    request,
  });
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

describe('tutorial step 06 — streaming & defer', () => {
  // snippet:defer-test
  it('streams the shell first, the product list later in the same response', () => {
    const response = renderShopPageDeferredStream(createShopDb());

    expect(response).toMatchObject({
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 200,
    });

    // The shell renders a declared fallback…
    expect(response.body).toContain('<kovo-defer target="product-list" state="pending">');
    // …and the real fragment follows in the same body, after the shell.
    const deferIndex = response.body.indexOf('<kovo-defer target="product-list"');
    const fragmentIndex = response.body.indexOf('<kovo-fragment target="product-list">');
    expect(deferIndex).toBeGreaterThan(-1);
    expect(fragmentIndex).toBeGreaterThan(deferIndex);
  });
  // /snippet

  // snippet:query-order-test
  it('guarantees deferred query JSON arrives before or with its consumers', () => {
    const response = renderShopPageDeferredStream(createShopDb());

    const queryIndex = response.body.indexOf('<kovo-query name="products">');
    const fragmentIndex = response.body.indexOf('<kovo-fragment target="product-list">');
    expect(queryIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeLessThan(fragmentIndex);
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
        'Kovo-Targets': 'cart-badge=cart; product-list=products',
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toContain('<kovo-query name="cart">{"count":1}</kovo-query>');
  });
});
