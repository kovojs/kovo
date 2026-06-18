import { describe, expect, it } from 'vitest';

import {
  htmlElementFacts,
  htmlFormFacts,
  htmlKeyValues,
  htmlTextContent,
} from '@kovojs/test/html-fragment';

import { createCommerceScenarioClient } from './app-test-helpers.js';
import { createCommerceApp } from './app.generated-fixtures.js';

describe('commerce generated app artifacts', () => {
  it('stamps generated live-target hooks into the rendered cart document', async () => {
    const client = createCommerceScenarioClient(createCommerceApp());
    const response = await client.get('/cart');
    const html = await response.text();

    expect(response.status, html).toBe(200);
    expect(htmlElementFacts(html, { attrs: { 'kovo-fragment-target': 'cart-badge' } })).toHaveLength(
      1,
    );
  });

  it('render generated live-target UI fragments for enhanced addToCart success', async () => {
    const client = createCommerceScenarioClient(createCommerceApp());
    const login = await client.signIn({ remoteAddress: '203.0.113.171' });
    expect(login.status).toBe(303);

    const first = await client.addToCartEnhanced({ productId: 'p1', quantity: 2 });
    expect(first.status, await first.text()).toBe(200);

    const response = await client.addToCartEnhanced({ productId: 'p2', quantity: 1 });
    const body = await response.text();

    expect(response.status, body).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    expect(htmlKeyValues(body)).toContain('order-2');
    expect(htmlTextContent(body)).toContain('Only 1 left');
  });

  it('renders generated live-target failure fragments with form helpers', async () => {
    const client = createCommerceScenarioClient(createCommerceApp());
    const login = await client.signIn({ remoteAddress: '203.0.113.174' });
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
    const cart = await client.get('/cart');
    expect(htmlKeyValues(await cart.text())).not.toContain('order-1');
  });
});
