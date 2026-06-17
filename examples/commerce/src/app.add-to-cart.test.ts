import { describe, expect, it } from 'vitest';

import { propertyTest } from '@kovojs/test/assertions';
import {
  kovoFragmentFacts,
  kovoResponseBodyFact,
  htmlElementFacts,
  htmlFormFieldsByName,
  htmlFormFacts,
  htmlKeyValues,
  htmlTextContent,
} from '@kovojs/test/html-fragment';

import {
  addToCartOptimistic,
  createCommerceDb,
  renderAddToCartForm,
  renderOrderHistory,
  renderCartPage,
  submitAddToCart,
  submitAddToCartNoJs,
  type AddToCartInput,
} from './app.js';
import {
  applyCommerceAddToCartEffect,
  commerceAddToCartPropertyCases,
  shapeCommerceCartQuery,
  type CommerceAddToCartPropertyState,
} from './app-test-helpers.js';

describe('commerce example', () => {
  it('predicts cart count with the compiler-derived addToCart optimistic transform', () => {
    expect(addToCartOptimistic.queue).toBe('cart');
    expect(
      addToCartOptimistic.transforms.cart({ count: 1 }, { productId: 'p1', quantity: 2 }),
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
          return addToCartOptimistic.transforms.cart(shapeCommerceCartQuery(state), input);
        },
        shape(state) {
          return shapeCommerceCartQuery(state);
        },
      }),
    ).toEqual({ cases: 18 });
  });

  it('renders SPEC 6.3 no-JS add-to-cart forms as the page output', async () => {
    const form = renderAddToCartForm({ id: 'p1', stock: 5 });
    const html = await renderCartPage();
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
    const db = createCommerceDb();

    await expect(
      submitAddToCartNoJs(
        { productId: 'p1', quantity: 2 },
        { db, session: { id: 's-no-js-success', user: { id: 'u1' } } },
      ),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/cart',
      },
      status: 303,
    });

    expect(htmlTextContent(await renderCartPage(db))).toContain('3 in stock');
    // SECURITY (SECURITY_FINDINGS.md M9): orderHistory is scoped to the session user.
    expect(htmlKeyValues(await renderOrderHistory(db, 'u1'))).toContain('order-1');
  });

  it('handles enhanced addToCart through the same endpoint as fragment wire', async () => {
    const db = createCommerceDb();
    const transaction = db.transaction.bind(db);
    let transactions = 0;

    db.transaction = (run) => {
      transactions += 1;
      return transaction(run);
    };

    await expect(
      submitAddToCart(
        { productId: 'p1', quantity: 2 },
        { db, session: { id: 's-enhanced-success', user: { id: 'u1' } } },
        {
          'Kovo-Fragment': 'true',
          'Kovo-Targets': 'cart-badge,product-grid,order-history',
        },
      ),
    ).resolves.toMatchObject({
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
      },
      status: 200,
    });

    const response = await submitAddToCart(
      { productId: 'p2', quantity: 1 },
      { db, session: { id: 's-enhanced-success-2', user: { id: 'u1' } } },
      {
        'Kovo-Fragment': 'true',
        'Kovo-Targets': 'cart-badge,product-grid,order-history',
      },
    );

    const responseFact = kovoResponseBodyFact(response.body);
    expect(responseFact.queryNames).toEqual(['cart', 'productGrid', 'orderHistory']);
    expect(responseFact.fragmentTargets).toEqual(['cart-badge', 'product-grid', 'order-history']);
    expect(responseFact.fragments.flatMap((fragment) => fragment.stylesheetHrefs)).toEqual([
      '/assets/styles.css',
      '/assets/styles.css',
      '/assets/styles.css',
    ]);
    expect(responseFact.keyValues).toContain('order-2');
    expect(transactions).toBe(2);
  });

  it('contains product-grid fragment failures with a per-island error boundary', async () => {
    const db = createCommerceDb();

    const response = await submitAddToCart(
      { productId: 'p1', quantity: 1 },
      {
        db,
        renderFaults: {
          productGrid: () => new Error('catalog unavailable'),
        },
        session: { id: 's-enhanced-boundary', user: { id: 'u1' } },
      },
      {
        'Kovo-Fragment': 'true',
        'Kovo-Targets': 'cart-badge,product-grid,order-history',
      },
    );

    expect(response).toMatchObject({
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
      },
      status: 200,
    });
    const responseFact = kovoResponseBodyFact(response.body);
    expect(
      responseFact.fragments.filter((fragment) => fragment.target === 'product-grid'),
    ).toMatchObject([
      {
        attrs: { 'error-boundary': 'product-grid', target: 'product-grid' },
        stylesheetHrefs: ['/assets/styles.css'],
      },
    ]);
    expect(
      htmlTextContent(
        responseFact.fragments.find((fragment) => fragment.target === 'product-grid')?.innerHtml ??
          '',
      ),
    ).toBe('Product grid failed: catalog unavailable');
    expect(responseFact.fragmentTargets).toEqual(['cart-badge', 'product-grid', 'order-history']);
  });

  it('handles no-JS addToCart failures as a full 422 page with the form rerendered', async () => {
    const db = createCommerceDb();
    const response = await submitAddToCartNoJs(
      { productId: 'p2', quantity: 3 },
      { db, session: { id: 's-no-js-fail', user: { id: 'u1' } } },
    );

    expect(response).toMatchObject({
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
    expect(htmlElementFacts(response.body, { tag: 'html' })).toHaveLength(1);
    expect(htmlFormFacts(response.body)).toEqual(
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
      htmlElementFacts(response.body, {
        attrs: { 'data-error-code': 'OUT_OF_STOCK' },
        tag: 'output',
      }),
    ).toHaveLength(1);
    expect(htmlTextContent(response.body)).toContain('Only 2 available.');
    // SECURITY (SECURITY_FINDINGS.md M9): orderHistory is scoped to the session user.
    expect(htmlKeyValues(await renderOrderHistory(db, 'u1'))).not.toContain('order-1');
  });

  it('handles enhanced addToCart failures as a rerendered form fragment', async () => {
    const db = createCommerceDb();
    const response = await submitAddToCart(
      { productId: 'p2', quantity: 3 },
      { db, session: { id: 's-enhanced-fail', user: { id: 'u1' } } },
      {
        'Kovo-Fragment': 'true',
        'Kovo-Targets': 'add-to-cart:p2',
      },
    );

    expect(response).toMatchObject({
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
      },
      status: 422,
    });
    const [formFragment] = kovoFragmentFacts(response.body, 'add-to-cart:p2');
    expect(formFragment).toMatchObject({
      stylesheetHrefs: ['/assets/styles.css'],
      target: 'add-to-cart:p2',
    });
    expect(htmlFormFacts(formFragment?.innerHtml ?? '')).toMatchObject([
      {
        action: '/_m/cart/add',
        attrs: { method: 'post' },
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'productId', value: 'p2' }),
        ]),
      },
    ]);
    expect(
      htmlElementFacts(formFragment?.innerHtml ?? '', {
        attrs: { 'kovo-fragment-target': 'add-to-cart:p2' },
      }),
    ).toHaveLength(1);
    expect(
      htmlElementFacts(formFragment?.innerHtml ?? '', {
        attrs: { 'data-error-code': 'OUT_OF_STOCK' },
        tag: 'output',
      }),
    ).toHaveLength(1);
    expect(htmlTextContent(formFragment?.innerHtml ?? '')).toContain('Only 2 available.');
    // SECURITY (SECURITY_FINDINGS.md M9): orderHistory is scoped to the session user.
    expect(htmlKeyValues(await renderOrderHistory(db, 'u1'))).not.toContain('order-1');
  });
});
