import { describe, expect, it } from 'vitest';

import { csrfToken } from '@kovojs/server';
import {
  componentLiveTargetRenderer,
  createLiveTargetAttestation,
  renderMutationEndpointResponse,
  type MutationWireHeaderSource,
} from '@kovojs/server/internal/wire';

import {
  addToCart,
  ProductList,
  renderAddToCartError,
  renderAddToCartForm,
  renderShopPage,
  shopCsrf,
  type AddToCartFailure,
  type ShopRequest,
} from './app.js';
import { CartBadge } from './components/cart-badge.js';
import { createShopDb } from './db.js';
import { cartQuery, productsQuery } from './queries.js';

// Tutorial step 04: one mutation endpoint, two response modes:
// POST-redirect-GET without JavaScript, fragment wire with it.
// Both are plain request/response assertions; no browser.

function shopRequest(db = createShopDb()): ShopRequest {
  return { db, session: { id: 's1' } };
}

// The browser would echo the stamped kovo-csrf hidden field back; tests build
// the same submission explicitly.
function formInput(request: ShopRequest, fields: Record<string, string>) {
  return { ...fields, 'kovo-csrf': csrfToken(request, shopCsrf, { mutation: addToCart }) };
}

function submitAddToCartNoJs(rawInput: unknown, request: ShopRequest) {
  return submitAddToCart(rawInput, request, {});
}

function submitAddToCart(
  rawInput: unknown,
  request: ShopRequest,
  headers: MutationWireHeaderSource,
) {
  const productId = productIdFromRawInput(rawInput);
  return renderMutationEndpointResponse(addToCart, {
    buildToken: 'tutorial-step-04-test-build',
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

describe('tutorial step 04 — mutations & forms', () => {
  // snippet:form-markup-test
  it('renders the add-to-cart form, CSRF token included, as the page output', () => {
    const request = shopRequest();
    const html = renderShopPage(request.db, undefined, request);
    const action = `/_m/${addToCart.key}`;

    expect(html).toContain(
      `enhance method="post" action="${action}" data-mutation="${addToCart.key}"`,
    );
    expect(html).toContain('name="kovo-csrf"');
    expect(html).toContain('name="productId" value="p1"');
    expect(html).toContain('name="quantity" type="number" min="1" max="5" value="1"');
    expect(html).toContain('name="kovo-form-key" value="p1"');
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
    expect(response.body).toContain(`enhance method="post" action="/_m/${addToCart.key}"`);
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
        'Kovo-Targets': `cart-badge=${cartQuery.key}; product-list=${productsQuery.key}`,
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
    expect(response.body).toContain('name="kovo-form-key" value="p2"');
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
