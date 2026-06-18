import { describe, expect, it } from 'vitest';

import { propertyTest } from '@kovojs/test/assertions';
import {
  htmlElementFacts,
  htmlFormFieldsByName,
  htmlFormFacts,
  htmlKeyValues,
  htmlTextContent,
} from '@kovojs/test/html-fragment';

import {
  type AddToCartInput,
} from './app.js';
import { renderAddToCartForm } from './components/product-grid.js';
import {
  applyCommerceAddToCartEffect,
  commerceAddToCartPropertyCases,
  createCommerceScenarioClient,
  shapeCommerceCartQuery,
  type CommerceAddToCartPropertyState,
} from './app-test-helpers.js';
import { cartAddDerivedOptimistic } from './generated/optimistic/cart-add.js';

describe('commerce example', () => {
  it('predicts cart count with the compiler-derived addToCart optimistic transform', () => {
    expect(cartAddDerivedOptimistic.queue).toBe('cart');
    expect(
      cartAddDerivedOptimistic.transforms.cart({ count: 1 }, { productId: 'p1', quantity: 2 }),
    ).toEqual({
      count: 3,
    });

    expect(
      propertyTest<CommerceAddToCartPropertyState, AddToCartInput, { count: number }>({
        apply(state, input) {
          return applyCommerceAddToCartEffect(state, input);
        },
        cases: commerceAddToCartPropertyCases(),
        predict(state, input) {
          return cartAddDerivedOptimistic.transforms.cart(shapeCommerceCartQuery(state), input);
        },
        shape(state) {
          return shapeCommerceCartQuery(state);
        },
      }),
    ).toEqual({ cases: 18 });
  });

  it('renders SPEC 6.3 no-JS add-to-cart forms as the page output', async () => {
    const client = createCommerceScenarioClient();
    const form = renderAddToCartForm({ id: 'p1', stock: 5 });
    const response = await client.get('/cart');
    const html = await response.text();
    const [addForm] = htmlFormFacts(form);
    const fieldsByName = htmlFormFieldsByName(addForm);

    expect(addForm).toMatchObject({
      action: '/_m/cart/add',
      attrs: {
        'data-mutation': 'cart/add',
        enhance: '',
        method: 'post',
      },
      method: 'post',
    });
    expect(fieldsByName.productId).toMatchObject({ value: 'p1' });
    expect(fieldsByName.quantity).toMatchObject({
      attrs: { max: '5', min: '1', type: 'number' },
      value: '1',
    });
    expect(htmlFormFacts(html).some((pageForm) => pageForm.action === '/_m/cart/add')).toBe(true);
  });

  it('handles no-JS addToCart success as POST-redirect-GET', async () => {
    const client = createCommerceScenarioClient();
    const login = await client.signIn({ remoteAddress: '203.0.113.70' });
    expect(login.status).toBe(303);

    const response = await client.addToCartNoJs({ productId: 'p1', quantity: 2 });
    expect(response.status).toBe(303);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('location')).toBe('/cart');
    await expect(response.text()).resolves.toBe('');

    const cart = await client.get('/cart');
    const cartHtml = await cart.text();
    expect(cart.status, cartHtml).toBe(200);
    expect(htmlTextContent(cartHtml)).toContain('3 in stock');
    // SECURITY (SECURITY_FINDINGS.md M9): orderHistory is scoped to the session user.
    expect(htmlKeyValues(cartHtml)).toContain('order-1');
  });

  it('handles enhanced addToCart through the same endpoint as fragment wire', async () => {
    const client = createCommerceScenarioClient();
    const transaction = client.shell.db.transaction.bind(client.shell.db);
    let transactions = 0;

    client.shell.db.transaction = (run) => {
      transactions += 1;
      return transaction(run);
    };

    const login = await client.signIn({ remoteAddress: '203.0.113.71' });
    expect(login.status).toBe(303);

    const first = await client.addToCartEnhanced({ productId: 'p1', quantity: 2 });
    expect(first.status, await first.text()).toBe(200);

    const response = await client.addToCartEnhanced({ productId: 'p2', quantity: 1 });
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    expect(htmlKeyValues(body)).toContain('order-2');
    expect(htmlTextContent(body)).toContain('Only 1 left');
    expect(transactions).toBe(2);
  });

  it('handles no-JS addToCart failures as a full 422 page with the form rerendered', async () => {
    const client = createCommerceScenarioClient();
    const login = await client.signIn({ remoteAddress: '203.0.113.73' });
    expect(login.status).toBe(303);

    const response = await client.addToCartNoJs({ productId: 'p2', quantity: 3 });
    const body = await response.text();

    expect(response.status, body).toBe(422);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(htmlElementFacts(body, { tag: 'html' })).toHaveLength(1);
    expect(htmlFormFacts(body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: '/_m/cart/add',
          attrs: expect.objectContaining({ enhance: '', method: 'post' }),
          fields: expect.arrayContaining([
            expect.objectContaining({ name: 'productId', value: 'p2' }),
          ]),
        }),
      ]),
    );
    expect(
      htmlElementFacts(body, {
        attrs: { 'data-error-code': 'OUT_OF_STOCK' },
        tag: 'output',
      }),
    ).toHaveLength(1);
    expect(htmlTextContent(body)).toContain('Only 2 available.');
    // SECURITY (SECURITY_FINDINGS.md M9): orderHistory is scoped to the session user.
    expect(htmlKeyValues(body)).not.toContain('order-1');
  });

  it('handles enhanced addToCart failures as a rerendered form fragment', async () => {
    const client = createCommerceScenarioClient();
    const login = await client.signIn({ remoteAddress: '203.0.113.74' });
    expect(login.status).toBe(303);

    const response = await client.addToCartEnhanced(
      { productId: 'p2', quantity: 3 },
      { target: 'form' },
    );
    const body = await response.text();

    expect(response.status, body).toBe(422);
    expect(response.headers.get('content-type')).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    expect(htmlFormFacts(body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: '/_m/cart/add',
          fields: expect.arrayContaining([
            expect.objectContaining({ name: 'productId', value: 'p2' }),
          ]),
        }),
      ]),
    );
    expect(
      htmlElementFacts(body, {
        attrs: { target: 'product-grid' },
        tag: 'kovo-fragment',
      }),
    ).toHaveLength(1);
    expect(
      htmlElementFacts(body, {
        attrs: { 'data-error-code': 'OUT_OF_STOCK' },
        tag: 'output',
      }),
    ).toHaveLength(1);
    expect(htmlTextContent(body)).toContain('Only 2 available.');
    // SECURITY (SECURITY_FINDINGS.md M9): orderHistory is scoped to the session user.
    const cart = await client.get('/cart');
    expect(htmlKeyValues(await cart.text())).not.toContain('order-1');
  });
});
