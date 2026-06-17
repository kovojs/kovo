import { describe, expect, it } from 'vitest';

import { csrfToken } from '@kovojs/server';

import {
  renderShopPage,
  shopCsrf,
  submitAddToCart,
  submitAddToCartNoJs,
  type ShopRequest,
} from './app.js';
import { createShopDb } from './db.js';

// Tutorial step 04: one mutation endpoint, two response modes (SPEC.md
// section 9.1) — POST-redirect-GET without JavaScript, fragment wire with it.
// Both are plain request/response assertions; no browser.

function shopRequest(db = createShopDb()): ShopRequest {
  return { db, session: { id: 's1' } };
}

// The browser would echo the stamped kovo-csrf hidden field back; tests build
// the same submission explicitly (SPEC.md section 6.6).
function formInput(request: ShopRequest, fields: Record<string, string>) {
  return { ...fields, 'kovo-csrf': csrfToken(request, shopCsrf) };
}

describe('tutorial step 04 — mutations & forms', () => {
  // snippet:form-markup-test
  it('renders the add-to-cart form, CSRF token included, as the page output', () => {
    const request = shopRequest();
    const html = renderShopPage(request.db, undefined, request);

    expect(html).toContain(
      '<form enhance method="post" action="/_m/cart/add" data-mutation="cart/add"',
    );
    expect(html).toContain('name="kovo-csrf"');
    expect(html).toContain('name="productId" value="p1"');
    expect(html).toContain('name="quantity" type="number" min="1" max="5" value="1"');
    expect(html).toContain('kovo-fragment-target="add-to-cart:p1"');
  });
  // /snippet

  // snippet:no-js-test
  it('handles no-JS success as POST-redirect-GET', async () => {
    const request = shopRequest();

    // FormData arrives as strings; the schema declared the coercion once.
    const response = await submitAddToCartNoJs(
      formInput(request, { productId: 'p1', quantity: '2' }),
      request,
    );

    expect(response).toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/',
      },
      status: 303,
    });
    expect(request.db.cartItems).toEqual([{ productId: 'p1', qty: 2, unitPrice: 1499 }]);
    expect(renderShopPage(request.db)).toContain('(3 in stock)');
  });
  // /snippet

  // snippet:no-js-failure-test
  it('handles no-JS failure as a full 422 page with the form re-rendered', async () => {
    const request = shopRequest();
    const response = await submitAddToCartNoJs(
      formInput(request, { productId: 'p2', quantity: '3' }),
      request,
    );

    expect(response.status).toBe(422);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.body).toContain('<form enhance method="post" action="/_m/cart/add"');
    expect(response.body).toContain('data-error-code="OUT_OF_STOCK"');
    expect(response.body).toContain('Only 2 available.');
    expect(request.db.cartItems).toEqual([]); // fail() rolled the transaction back
  });
  // /snippet

  // snippet:enhanced-test
  it('answers the enhanced path with readable fragments from the same endpoint', async () => {
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
    expect(response.headers['Content-Type']).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    expect(response.body).toContain('<kovo-fragment target="cart-badge">');
    expect(response.body).toContain('<span data-bind="cart.count">2</span>');
    expect(response.body).toContain('<kovo-fragment target="product-list">');
    expect(response.body).toContain('(3 in stock)');
  });
  // /snippet

  // snippet:enhanced-failure-test
  it('answers enhanced failures as a re-rendered form fragment', async () => {
    const request = shopRequest();
    const response = await submitAddToCart(
      formInput(request, { productId: 'p2', quantity: '3' }),
      request,
      {
        'Kovo-Fragment': 'true',
        'Kovo-Form-Target': 'add-to-cart:p2',
        'Kovo-Targets': 'add-to-cart:p2',
      },
    );

    expect(response.status).toBe(422);
    expect(response.body).toContain('<kovo-fragment target="add-to-cart:p2">');
    expect(response.body).toContain('kovo-fragment-target="add-to-cart:p2"');
    expect(response.body).toContain('data-error-code="OUT_OF_STOCK"');
    expect(request.db.cartItems).toEqual([]);
  });
  // /snippet

  // snippet:csrf-test
  it('fails closed on a POST without the session-bound CSRF token', async () => {
    const request = shopRequest();
    const response = await submitAddToCart(
      { productId: 'p1', quantity: '1' }, // no kovo-csrf field
      request,
      {
        'Kovo-Form-Target': 'add-to-cart:p1',
        'Kovo-Fragment': 'true',
        'Kovo-Targets': 'add-to-cart:p1',
      },
    );

    expect(response.status).toBe(422);
    expect(response.body).toContain('data-error-code="CSRF"');
    expect(request.db.cartItems).toEqual([]);
  });
  // /snippet

  it('rejects input outside the declared schema with a 422', async () => {
    const request = shopRequest();
    const response = await submitAddToCartNoJs(
      formInput(request, { productId: 'p1', quantity: '0' }),
      request,
    );

    expect(response.status).toBe(422);
    expect(request.db.cartItems).toEqual([]);
  });
});
