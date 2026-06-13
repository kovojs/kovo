import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';

import { storageBodyToBytes } from '@jiso/core';
import { propertyTest } from '@jiso/test/assertions';
import { createJisoTestHarness } from '@jiso/test/harness';
import {
  fwFragmentFacts,
  fwQueryFacts,
  htmlDocumentFacts,
  htmlElementFacts,
  htmlFormFacts,
  htmlKeyFacts,
  htmlTextContent,
} from '@jiso/test/html-fragment';
import type { TouchGraph } from '@jiso/drizzle';
import { morphStructuralTree, type StructuralMorphNode } from '@jiso/runtime';
import { csrfToken, runMutation } from '@jiso/server';

import {
  addToCart,
  addToCartOptimistic,
  attachmentDownloadRoute,
  commerceAttachmentStorage,
  commerceCsrf,
  commerceCsrfInput,
  commerceAuthCsrf,
  commerceMessageCatalog,
  commercePageHints,
  commerceSessionProvider,
  commerceSignIn,
  commercePaymentWebhookSecret,
  commerceSession,
  commerceTouchGraph,
  createCommerceDb,
  cartQuery,
  loadCartQuery,
  loadProductGrid,
  orderHistoryQuery,
  orderCsvRoute,
  paymentWebhook,
  productGridQuery,
  EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET,
  EXAMPLE_ONLY_COMMERCE_CSRF_SECRET,
  renderCommercePageHints,
  renderAddToCartForm,
  renderAttachmentDownloadRoute,
  renderCommerceAdminRoute,
  renderCommerceLoginForm,
  renderCommerceLogoutForm,
  renderOrderHistory,
  renderOrderCsvRoute,
  renderCartPage,
  renderProductGrid,
  renderProductGridDeferredStream,
  renderProductGridPageFragment,
  renderReceiptUploadForm,
  submitAddToCart,
  submitAddToCartNoJs,
  submitCommerceSignInNoJs,
  submitCommerceSignOutNoJs,
  type AddToCartInput,
  type ProductGridInput,
  uploadReceipt,
  runPaymentWebhook,
  type UploadReceiptInput,
} from './app.js';

function commerceFile(name: string, type: string, size: number) {
  return {
    async arrayBuffer() {
      return new ArrayBuffer(size);
    },
    name,
    size,
    type,
  };
}

interface CommerceAddToCartPropertyState {
  cartItems: { productId: string; qty: number }[];
  products: Record<string, { stock: number }>;
}

function applyCommerceAddToCartEffect(
  state: CommerceAddToCartPropertyState,
  input: AddToCartInput,
): CommerceAddToCartPropertyState {
  const product = state.products[input.productId];
  if (!product || product.stock < input.quantity) {
    throw new Error(`Invalid property case for ${input.productId}`);
  }

  return {
    cartItems: [...state.cartItems, { productId: input.productId, qty: input.quantity }],
    products: {
      ...state.products,
      [input.productId]: {
        stock: product.stock - input.quantity,
      },
    },
  };
}

function shapeCommerceCartQuery(state: CommerceAddToCartPropertyState): { count: number } {
  return {
    count: state.cartItems.reduce((total, item) => total + item.qty, 0),
  };
}

function commerceAddToCartPropertyCases(): {
  input: AddToCartInput;
  state: CommerceAddToCartPropertyState;
}[] {
  const cases: { input: AddToCartInput; state: CommerceAddToCartPropertyState }[] = [];

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

function stripeHeader(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function requestWithDb(
  body: string,
  db = createCommerceDb(),
  headers: Record<string, string> = {},
) {
  const request = new Request('https://commerce.test/webhooks/stripe', {
    body,
    headers,
    method: 'POST',
  }) as Request & { db: ReturnType<typeof createCommerceDb> };
  request.db = db;
  return request;
}

function queryContext(db = createCommerceDb()) {
  return {
    db,
    request: { db, session: { id: 's-query', user: { id: 'u-query' } } },
  };
}

function commerceAuthRequest(cookie?: string, db = createCommerceDb()) {
  const headers = new Headers({ 'user-agent': 'commerce-auth-test' });
  if (cookie) headers.set('cookie', cookie);

  return {
    authCsrfId: 'login-csrf',
    db,
    headers,
  };
}

function setCookieHeaders(response: { headers: Record<string, string | string[]> }): string[] {
  return headerValues(response.headers, 'Set-Cookie');
}

function mutationSetCookieHeaders(result: {
  responseHeaders?: Record<string, string | string[]>;
}): string[] {
  return headerValues(result.responseHeaders ?? {}, 'Set-Cookie');
}

function headerValues(headers: Record<string, string | string[]>, name: string): string[] {
  const cookies = headers[name];
  if (!cookies) return [];

  return Array.isArray(cookies) ? cookies : [cookies];
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0] ?? setCookie;
}

function keyedListNode(
  type: string,
  keys: readonly string[],
  stateByKey: Record<string, StructuralMorphNode['browserState']> = {},
): StructuralMorphNode {
  return {
    children: keys.map((key) => ({
      ...(stateByKey[key] ? { browserState: stateByKey[key] } : {}),
      key,
      props: { 'fw-key': key },
      text: key,
      type: 'li',
    })),
    type,
  };
}

function productGridInput(after: string | null, limit?: number): ProductGridInput {
  return {
    ...(after ? { after } : {}),
    ...(limit === undefined ? {} : { limit }),
  };
}

function formFieldsByName(
  form: ReturnType<typeof htmlFormFacts>[number] | undefined,
): Record<string, ReturnType<typeof htmlFormFacts>[number]['fields'][number]> {
  return Object.fromEntries((form?.fields ?? []).map((field) => [field.name, field]));
}

function htmlKeys(html: string): string[] {
  return htmlKeyFacts(html).map((fact) => fact.key);
}

function htmlKeyTextsByKey(html: string): Record<string, string> {
  return Object.fromEntries(htmlKeyFacts(html).map((fact) => [fact.key, fact.text]));
}

describe('commerce example', () => {
  it('marks demo-only CSRF secrets as example-only source', () => {
    expect(commerceCsrf.secret).toBe(EXAMPLE_ONLY_COMMERCE_CSRF_SECRET);
    expect(commerceAuthCsrf.secret).toBe(EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET);
    expect(commerceCsrf.secret).toMatch(/^EXAMPLE_ONLY_/);
    expect(commerceAuthCsrf.secret).toMatch(/^EXAMPLE_ONLY_/);
  });

  it('commits and rolls back commerce database transactions', async () => {
    const db = createCommerceDb();

    await expect(
      db.transaction(async (tx) => {
        tx.write('cart_items', { productId: 'p1', qty: 1, unitPrice: 1499 });
        return 'committed';
      }),
    ).resolves.toBe('committed');
    expect(db.cartItems).toEqual([{ productId: 'p1', qty: 1, unitPrice: 1499 }]);

    await expect(
      db.transaction(async (tx) => {
        tx.write('cart_items', { productId: 'p2', qty: 1, unitPrice: 2599 });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(db.cartItems).toEqual([{ productId: 'p1', qty: 1, unitPrice: 1499 }]);
  });

  it('executes addToCart and verifies rendered cart badge without a browser', async () => {
    const harness = createJisoTestHarness({
      db: createCommerceDb(),
      pages: {
        '/cart': renderCartPage,
      },
      request: {
        session: { id: 's1', user: { id: 'u1' } },
      },
      touchGraph: { 'cart.addItem': commerceTouchGraph['cart.addItem'] } as unknown as TouchGraph,
      verification: {
        domainByTable: {
          cart_items: 'cart',
          orders: 'order',
          products: 'product',
        },
      },
    });

    await expect(
      harness.exec(
        addToCart,
        commerceCsrfInput(
          { productId: 'p1', quantity: 2 },
          { db: harness.dbHandle(), session: { id: 's1', user: { id: 'u1' } } },
        ),
      ),
    ).resolves.toMatchObject({
      changes: [
        { domain: 'cart', input: { productId: 'p1', quantity: 2 } },
        { domain: 'order', input: { productId: 'p1', quantity: 2 } },
        { domain: 'product', input: { productId: 'p1', quantity: 2 }, keys: ['p1'] },
      ],
      ok: true,
      rerunQueries: ['cart', 'productGrid', 'orderHistory'],
    });
    const cartBadge = await harness.page('/cart').then((page) => page.fragment('cart-badge'));
    expect(htmlElementFacts(cartBadge, { attrs: { 'data-bind': 'cart.count' } })).toHaveLength(1);
  });

  it('loads declared commerce queries from the request database', async () => {
    const db = createCommerceDb();
    const context = queryContext(db);

    await addToCart.handler({ productId: 'p1', quantity: 2 }, context.request, {
      fail(code, payload) {
        return { error: { code, payload }, ok: false, status: 422 };
      },
      invalidate(domain, options) {
        return { domain: domain.key, ...options, manual: true };
      },
    });

    await expect(Promise.resolve(cartQuery.load({}, context))).resolves.toEqual({ count: 2 });
    await expect(Promise.resolve(productGridQuery.load({ limit: 1 }, context))).resolves.toEqual({
      items: [{ id: 'p1', stock: 3, unitPrice: 1499 }],
      nextCursor: 'p1',
    });
    await expect(Promise.resolve(orderHistoryQuery.load({}, context))).resolves.toEqual({
      items: [
        {
          id: 'order-1',
          productId: 'p1',
          qty: 2,
          total: 2998,
          userId: 'u-query',
        },
      ],
    });

    expect(() => productGridQuery.load({ limit: 1 })).toThrow(
      'commerce query loaders require context.db or request.db',
    );
  });

  it('loads every declared query from a custom request database instead of starter data', async () => {
    const db = createCommerceDb();
    db.products = new Map([['custom', { id: 'custom', stock: 42, unitPrice: 777 }]]);
    db.cartItems = [
      { productId: 'custom', qty: 4, unitPrice: 777 },
      { productId: 'custom', qty: 6, unitPrice: 777 },
    ];
    db.orders = [
      {
        id: 'custom-order',
        productId: 'custom',
        qty: 10,
        total: 7770,
        userId: 'u-custom-query',
      },
    ];
    const context = queryContext(db);

    await expect(Promise.resolve(cartQuery.load({}, context))).resolves.toEqual({ count: 10 });
    await expect(Promise.resolve(productGridQuery.load({}, context))).resolves.toEqual({
      items: [{ id: 'custom', stock: 42, unitPrice: 777 }],
      nextCursor: null,
    });
    await expect(Promise.resolve(orderHistoryQuery.load({}, context))).resolves.toEqual({
      items: db.orders,
    });
  });

  it('verifies every declared query through the harness db read seam', async () => {
    const db = createCommerceDb();
    db.products = new Map([['custom', { id: 'custom', stock: 42, unitPrice: 777 }]]);
    db.cartItems = [{ productId: 'custom', qty: 3, unitPrice: 777 }];
    db.orders = [
      {
        id: 'custom-order',
        productId: 'custom',
        qty: 3,
        total: 2331,
        userId: 'u-custom-query',
      },
    ];
    const harness = createJisoTestHarness({
      db,
      touchGraph: {},
      verification: {
        domainByTable: {
          cart_items: 'cart',
          orders: 'order',
          products: 'product',
        },
      },
    });

    await expect(harness.query(cartQuery)).resolves.toEqual({ count: 3 });
    await expect(harness.query(productGridQuery)).resolves.toEqual({
      items: [{ id: 'custom', stock: 42, unitPrice: 777 }],
      nextCursor: null,
    });
    await expect(harness.query(orderHistoryQuery)).resolves.toEqual({
      items: db.orders,
    });
    expect(harness.verificationDiagnostics()).toEqual([]);
  });

  it('renders cursor-paged product grid and order history with stable list keys', async () => {
    const db = createCommerceDb();
    const firstPage = loadProductGrid(db, { limit: 2 });
    const secondPage = loadProductGrid(db, productGridInput(firstPage.nextCursor, 2));

    expect(htmlKeys(renderProductGrid(firstPage))).toEqual(['p1', 'p2']);
    expect(
      htmlElementFacts(renderProductGrid(firstPage), {
        attrs: { href: '/products?after=p2' },
        tag: 'a',
      }),
    ).toHaveLength(1);
    expect(htmlKeys(renderProductGrid(secondPage))).toEqual(['p3']);

    const appendFragment = renderProductGridPageFragment(
      db,
      productGridInput(firstPage.nextCursor, 2),
    );

    expect(fwFragmentFacts(appendFragment, 'product-grid')).toMatchObject([
      { attrs: { mode: 'append', target: 'product-grid' } },
    ]);
    expect(htmlKeys(appendFragment)).toEqual(['p3']);
    expect(htmlElementFacts(appendFragment, { attrs: { 'fw-c': 'product-grid' } })).toHaveLength(0);

    await addToCart.handler(
      { productId: 'p1', quantity: 2 },
      { db, session: { id: 's-direct', user: { id: 'u-direct' } } },
      {
        fail(code, payload) {
          return { error: { code, payload }, ok: false, status: 422 };
        },
        invalidate(domain, options) {
          return { domain: domain.key, ...options, manual: true };
        },
      },
    );

    expect(htmlKeyTextsByKey(renderOrderHistory(db))).toMatchObject({
      'order-1': 'p1 x 2 - 2998',
    });
  });

  it('preserves commerce list identity through append and simultaneous optimistic reorder', async () => {
    const db = createCommerceDb();
    const firstPage = loadProductGrid(db, { limit: 2 });
    const firstPageKeys = firstPage.items.map((item) => item.id);
    const secondPage = loadProductGrid(db, productGridInput(firstPage.nextCursor, 2));
    const currentGrid = keyedListNode('product-grid', firstPageKeys, {
      p1: { islandState: { pendingMutation: 'cart/add' } },
    });
    const firstProduct = currentGrid.children?.[0];
    const secondProduct = currentGrid.children?.[1];
    const appendedGrid = morphStructuralTree(
      currentGrid,
      keyedListNode('product-grid', [...firstPageKeys, ...secondPage.items.map((item) => item.id)]),
    );
    const thirdProduct = appendedGrid.children?.[2];

    expect(htmlKeys(renderProductGrid(firstPage))).toEqual(['p1', 'p2']);
    expect(
      fwFragmentFacts(
        renderProductGridPageFragment(db, productGridInput(firstPage.nextCursor)),
        'product-grid',
      ),
    ).toMatchObject([{ attrs: { mode: 'append', target: 'product-grid' } }]);
    expect(appendedGrid.children?.[0]).toBe(firstProduct);
    expect(appendedGrid.children?.[1]).toBe(secondProduct);
    expect(thirdProduct).not.toBeUndefined();

    const reorderedGrid = morphStructuralTree(
      appendedGrid,
      keyedListNode('product-grid', ['p2', 'p3', 'p1']),
    );

    expect(reorderedGrid.children?.map((item) => item.key)).toEqual(['p2', 'p3', 'p1']);
    expect(reorderedGrid.children?.[0]).toBe(secondProduct);
    expect(reorderedGrid.children?.[1]).toBe(thirdProduct);
    expect(reorderedGrid.children?.[2]).toBe(firstProduct);
    expect(reorderedGrid.children?.[2]?.browserState).toEqual({
      islandState: { pendingMutation: 'cart/add' },
    });

    await addToCart.handler(
      { productId: 'p1', quantity: 1 },
      { db, session: { id: 's-direct', user: { id: 'u-direct' } } },
      {
        fail(code, payload) {
          return { error: { code, payload }, ok: false, status: 422 };
        },
        invalidate(domain, options) {
          return { domain: domain.key, ...options, manual: true };
        },
      },
    );

    const currentHistory = keyedListNode('order-history', ['order-draft'], {
      'order-draft': { islandState: { pendingMutation: 'cart/add' } },
    });
    const optimisticOrder = currentHistory.children?.[0];
    const reconciledHistory = morphStructuralTree(
      currentHistory,
      keyedListNode('order-history', ['order-1', 'order-draft']),
    );

    expect(htmlKeys(renderOrderHistory(db))).toContain('order-1');
    expect(reconciledHistory.children?.[0]?.key).toBe('order-1');
    expect(reconciledHistory.children?.[1]).toBe(optimisticOrder);
    expect(reconciledHistory.children?.[1]?.browserState).toEqual({
      islandState: { pendingMutation: 'cart/add' },
    });
  });

  it('streams deferred product grid fragments with Tailwind stylesheet hints', () => {
    const response = renderProductGridDeferredStream(createCommerceDb());

    expect(response).toMatchObject({
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 200,
    });
    expect(
      htmlElementFacts(response.body, {
        attrs: { class: 'min-h-dvh bg-slate-50 p-6' },
        tag: 'main',
      }),
    ).toHaveLength(1);
    expect(
      htmlElementFacts(response.body, {
        attrs: { state: 'pending', target: 'product-grid' },
        tag: 'fw-defer',
      }),
    ).toHaveLength(1);
    expect(fwQueryFacts(response.body).map((query) => query.name)).toEqual(['productGrid']);
    expect(fwFragmentFacts(response.body, 'product-grid')).toMatchObject([
      { stylesheetHrefs: ['/assets/tailwind.css'] },
    ]);
    expect(
      htmlElementFacts(response.body, {
        attrs: { class: 'rounded border border-slate-200 bg-white p-4' },
      }).length,
    ).toBeGreaterThan(0);
  });

  it('uses the typed commerce session schema in authenticated mutations', async () => {
    const db = createCommerceDb();
    const request = { db, session: { id: 's1', user: { id: 'u1' } } };

    expect(commerceSession.parse(request)).toEqual({ id: 's1', user: { id: 'u1' } });

    await addToCart.handler({ productId: 'p1', quantity: 1 }, request, {
      fail(code, payload) {
        return { error: { code, payload }, ok: false, status: 422 };
      },
      invalidate(domain, options) {
        return { domain: domain.key, ...options, manual: true };
      },
    });

    expect(db.orders[0]?.userId).toBe('u1');
  });

  it('maps Better Auth cookies into the commerce session provider', async () => {
    const request = commerceAuthRequest();
    const signIn = await runMutation(
      commerceSignIn,
      {
        csrf: csrfToken(request, commerceAuthCsrf),
        email: 'ada@example.com',
        password: 'correct',
      },
      request,
      { csrf: commerceAuthCsrf },
    );

    expect(signIn).toMatchObject({
      ok: true,
      value: {
        redirectTo: '/cart',
        status: 'signed-in',
      },
    });
    if (!signIn.ok) throw new Error('expected commerce sign-in to succeed');
    const cookie = cookiePair(mutationSetCookieHeaders(signIn)[0] ?? '');

    await expect(commerceSessionProvider(commerceAuthRequest(cookie))).resolves.toEqual({
      id: 'session-u1',
      user: {
        id: 'u1',
        roles: ['admin', 'member'],
      },
    });
  });

  it('runs commerce login and logout through Better Auth credential mutations', async () => {
    const request = commerceAuthRequest();

    expect(htmlFormFacts(renderCommerceLoginForm(request, { next: '/admin' }))).toMatchObject([
      { attrs: { 'data-mutation': 'auth/sign-in' } },
    ]);
    await expect(
      submitCommerceSignInNoJs(
        {
          csrf: csrfToken(request, commerceAuthCsrf),
          email: 'ada@example.com',
          next: '/admin',
          password: 'correct',
        },
        request,
      ),
    ).resolves.toMatchObject({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/admin',
        'Set-Cookie': ['jiso_commerce_session=session-u1; Path=/; HttpOnly; SameSite=Lax'],
      },
      status: 303,
    });

    await expect(
      submitCommerceSignInNoJs(
        {
          csrf: csrfToken(request, commerceAuthCsrf),
          email: 'ada@example.com',
          password: 'wrong',
        },
        request,
      ),
    ).resolves.toMatchObject({
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });

    const authedRequest = {
      ...commerceAuthRequest('jiso_commerce_session=session-u1'),
      session: {
        id: 'session-u1',
        user: { id: 'u1', roles: ['admin', 'member'] as const },
      },
    };

    expect(htmlFormFacts(renderCommerceLogoutForm(authedRequest))).toMatchObject([
      { attrs: { 'data-mutation': 'auth/sign-out' } },
    ]);
    await expect(submitCommerceSignOutNoJs(authedRequest)).resolves.toMatchObject({
      headers: {
        'Cache-Control': 'no-store',
        Location: '/login',
        'Set-Cookie': ['jiso_commerce_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'],
      },
      status: 303,
    });
  });

  it('renders commerce admin route through real authed and role guards', async () => {
    await expect(renderCommerceAdminRoute(commerceAuthRequest())).resolves.toEqual({
      body: '',
      headers: { Location: '/login?next=%2Fadmin' },
      status: 303,
    });

    const memberRequest = commerceAuthRequest();
    const memberSignIn = await submitCommerceSignInNoJs(
      {
        csrf: csrfToken(memberRequest, commerceAuthCsrf),
        email: 'grace@example.com',
        password: 'correct',
      },
      memberRequest,
    );
    const memberCookie = cookiePair(setCookieHeaders(memberSignIn)[0] ?? '');

    await expect(renderCommerceAdminRoute(commerceAuthRequest(memberCookie))).resolves.toEqual({
      body: '<main>Forbidden</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 403,
    });

    const adminRequest = commerceAuthRequest();
    const adminSignIn = await submitCommerceSignInNoJs(
      {
        csrf: csrfToken(adminRequest, commerceAuthCsrf),
        email: 'ada@example.com',
        password: 'correct',
      },
      adminRequest,
    );
    const adminCookie = cookiePair(setCookieHeaders(adminSignIn)[0] ?? '');

    await expect(renderCommerceAdminRoute(commerceAuthRequest(adminCookie))).resolves.toMatchObject(
      {
        body: expect.stringContaining(
          '<main>admin:u1<form method="post" action="/_m/auth/sign-out"',
        ),
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      },
    );
  });

  it('predicts cart count with the hand-written addToCart optimistic transform', () => {
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

  it('renders SPEC 6.3 no-JS add-to-cart forms as the page output', () => {
    const form = renderAddToCartForm({ id: 'p1', stock: 5 });
    const html = renderCartPage();
    const [addForm] = htmlFormFacts(form);
    const fieldsByName = formFieldsByName(addForm);

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

  it('renders a multipart receipt upload form on the commerce page', () => {
    const form = renderReceiptUploadForm('order-1');
    const html = renderCartPage();
    const [uploadForm] = htmlFormFacts(form);
    const fieldsByName = formFieldsByName(uploadForm);

    expect(uploadForm).toMatchObject({
      action: '/_m/order/receipt',
      attrs: {
        'aria-busy': 'false',
        'data-mutation': 'order/receipt',
        enctype: 'multipart/form-data',
        enhance: '',
        'fw-deps': 'order',
        method: 'post',
      },
      method: 'post',
    });
    expect(fieldsByName.orderId).toMatchObject({ value: 'order-1' });
    expect(fieldsByName.receipt).toMatchObject({
      attrs: { accept: 'application/pdf,image/png', type: 'file' },
    });
    expect(
      htmlElementFacts(form, { attrs: { 'fw-upload-progress': true }, tag: 'progress' }),
    ).toMatchObject([{ attrs: { max: '100', value: '0' } }]);
    expect(
      htmlFormFacts(html).some((pageForm) => pageForm.attrs['data-mutation'] === 'order/receipt'),
    ).toBe(true);
  });

  it('coerces commerce receipt uploads through storage-backed s.file()', async () => {
    const db = createCommerceDb();
    const receipt = commerceFile('receipt.pdf', 'application/pdf', 2048);
    const storedReceipt = await (
      uploadReceipt.input as typeof uploadReceipt.input & {
        parseAsync(input: unknown): Promise<UploadReceiptInput>;
      }
    ).parseAsync({
      orderId: 'order-1',
      receipt,
    });

    expect(storedReceipt.receipt).toMatchObject({
      file: receipt,
      key: 'receipts/receipt.pdf',
      storage: {
        contentType: 'application/pdf',
        key: 'receipts/receipt.pdf',
        metadata: { filename: 'receipt.pdf' },
        size: 2048,
      },
    });
    const storedObject = await commerceAttachmentStorage.stream('receipts/receipt.pdf');
    expect(storedObject).not.toBeUndefined();
    expect(await storageBodyToBytes(storedObject!.body)).toHaveLength(2048);

    expect(
      uploadReceipt.handler(
        storedReceipt,
        { db, session: { id: 's-upload', user: { id: 'u1' } } },
        {
          fail(code, payload) {
            return { error: { code, payload }, ok: false, status: 422 };
          },
          invalidate(domain, options) {
            return { domain: domain.key, ...options, manual: true };
          },
        },
      ),
    ).toEqual({
      attachmentId: 'attachment-1',
      fileName: 'receipt.pdf',
      orderId: 'order-1',
      size: 2048,
      uploadedBy: 'u1',
    });
    expect(db.attachments).toEqual([
      {
        contentType: 'application/pdf',
        filename: 'receipt.pdf',
        id: 'attachment-1',
        orderId: 'order-1',
        size: 2048,
        storageKey: 'receipts/receipt.pdf',
        userId: 'u1',
      },
    ]);

    expect(() =>
      uploadReceipt.input.parse({
        orderId: 'order-1',
        receipt: commerceFile('receipt.txt', 'text/plain', 12),
      }),
    ).toThrow('Expected file type application/pdf, image/png');
  });

  it('adopts the webhook primitive for signed payment order writes', async () => {
    const db = createCommerceDb();
    const body = JSON.stringify({
      data: {
        object: {
          id: 'order-paid-1',
          productId: 'p1',
          quantity: 2,
          total: 2998,
          userId: 'u1',
        },
      },
      id: 'evt_paid_1',
      livemode: false,
      type: 'checkout.session.completed',
    });

    expect(paymentWebhook.webhook).toBe(true);
    expect(paymentWebhook.path).toBe('/webhooks/stripe');
    expect(paymentWebhook.auth).toEqual({
      kind: 'verifier',
      name: 'stripe:v1:hmac-sha256',
    });
    expect(paymentWebhook.csrf).toEqual({
      exempt: true,
      justification: 'payment/stripe webhook verifier stripe:v1:hmac-sha256',
    });

    const first = await runPaymentWebhook(
      requestWithDb(body, db, {
        'stripe-signature': stripeHeader(body, commercePaymentWebhookSecret),
      }),
    );

    expect(first.replayed).toBe(false);
    expect(first.value).toEqual({ orderId: 'order-paid-1' });
    expect(first.changes).toEqual([
      {
        domain: 'order',
        input: { eventId: 'evt_paid_1', orderId: 'order-paid-1' },
        keys: ['order-paid-1'],
        reason: 'payment webhook',
      },
    ]);
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get('FW-Changes')).toBe(
      '[{"domain":"order","keys":["order-paid-1"]}]',
    );
    expect(db.orders).toEqual([
      {
        id: 'order-paid-1',
        productId: 'p1',
        qty: 2,
        total: 2998,
        userId: 'u1',
      },
    ]);

    const replay = await runPaymentWebhook(
      requestWithDb(body, db, {
        'stripe-signature': stripeHeader(body, commercePaymentWebhookSecret),
      }),
    );
    expect(replay.replayed).toBe(true);
    expect(db.orders).toHaveLength(1);

    const tampered = await runPaymentWebhook(
      requestWithDb(body.replace('2998', '9999'), db, {
        'stripe-signature': stripeHeader(body, commercePaymentWebhookSecret),
      }),
    );
    expect(tampered.response.status).toBe(401);
  });

  it('uses route file and stream outcomes for order CSV export and attachment download', async () => {
    const db = createCommerceDb();
    db.write('orders', {
      id: 'order-1',
      productId: 'p1',
      qty: 2,
      total: 2998,
      userId: 'u1',
    });
    db.write('orders', {
      id: 'order-2',
      productId: 'p2',
      qty: 1,
      total: 2599,
      userId: 'u2',
    });
    const storedReceipt = await (
      uploadReceipt.input as typeof uploadReceipt.input & {
        parseAsync(input: unknown): Promise<UploadReceiptInput>;
      }
    ).parseAsync({
      orderId: 'order-1',
      receipt: commerceFile('download.pdf', 'application/pdf', 12),
    });
    await uploadReceipt.handler(
      storedReceipt,
      { db, session: { id: 's-upload', user: { id: 'u1' } } },
      {
        fail(code, payload) {
          return { error: { code, payload }, ok: false, status: 422 };
        },
        invalidate(domain, options) {
          return { domain: domain.key, ...options, manual: true };
        },
      },
    );

    expect(orderCsvRoute.path).toBe('/exports/orders.csv');
    expect(attachmentDownloadRoute.path).toBe('/attachments/:id');

    const csv = await renderOrderCsvRoute({ db, session: { id: 's-csv', user: { id: 'u1' } } });
    expect(csv).toMatchObject({
      headers: {
        'Content-Disposition': 'attachment; filename="orders.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
        ETag: '"orders-2"',
      },
      status: 200,
    });
    expect(await storageBodyToBytes(csv.body)).toEqual(
      new TextEncoder().encode('id,productId,qty,total,userId\norder-1,p1,2,2998,u1\n'),
    );

    const download = await renderAttachmentDownloadRoute(db, 'attachment-1', {
      db,
      session: { id: 's-download', user: { id: 'u1' } },
    });
    expect(download).toMatchObject({
      headers: {
        'Content-Disposition': 'inline; filename="download.pdf"',
        'Content-Type': 'application/pdf',
      },
      status: 200,
    });
    expect(await storageBodyToBytes(download.body)).toHaveLength(12);

    await expect(
      renderAttachmentDownloadRoute(db, 'attachment-1', {
        db,
        session: { id: 's-download-other', user: { id: 'u2' } },
      }),
    ).resolves.toMatchObject({ status: 404 });
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

    expect(htmlTextContent(renderCartPage(db))).toContain('3 in stock');
    expect(htmlKeys(renderOrderHistory(db))).toContain('order-1');
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
          'FW-Fragment': 'true',
          'FW-Targets': 'cart-badge,product-grid,order-history',
        },
      ),
    ).resolves.toMatchObject({
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 200,
    });

    const response = await submitAddToCart(
      { productId: 'p2', quantity: 1 },
      { db, session: { id: 's-enhanced-success-2', user: { id: 'u1' } } },
      {
        'FW-Fragment': 'true',
        'FW-Targets': 'cart-badge,product-grid,order-history',
      },
    );

    expect(fwQueryFacts(response.body).map((query) => query.name)).toEqual([
      'cart',
      'productGrid',
      'orderHistory',
    ]);
    const fragments = fwFragmentFacts(response.body);
    expect(fragments.map((fragment) => fragment.target)).toEqual([
      'cart-badge',
      'product-grid',
      'order-history',
    ]);
    expect(fragments.flatMap((fragment) => fragment.stylesheetHrefs)).toEqual([
      '/assets/tailwind.css',
      '/assets/tailwind.css',
      '/assets/tailwind.css',
    ]);
    expect(htmlKeys(response.body)).toContain('order-2');
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
        'FW-Fragment': 'true',
        'FW-Targets': 'cart-badge,product-grid,order-history',
      },
    );

    expect(response).toMatchObject({
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 200,
    });
    expect(fwFragmentFacts(response.body, 'product-grid')).toMatchObject([
      {
        attrs: { 'error-boundary': 'product-grid', target: 'product-grid' },
        stylesheetHrefs: ['/assets/tailwind.css'],
      },
    ]);
    expect(
      htmlTextContent(fwFragmentFacts(response.body, 'product-grid')[0]?.innerHtml ?? ''),
    ).toBe('Product grid failed: catalog unavailable');
    expect(fwFragmentFacts(response.body).map((fragment) => fragment.target)).toEqual([
      'cart-badge',
      'product-grid',
      'order-history',
    ]);
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
    expect(htmlKeys(renderOrderHistory(db))).not.toContain('order-1');
  });

  it('handles enhanced addToCart failures as a rerendered form fragment', async () => {
    const db = createCommerceDb();
    const response = await submitAddToCart(
      { productId: 'p2', quantity: 3 },
      { db, session: { id: 's-enhanced-fail', user: { id: 'u1' } } },
      {
        'FW-Fragment': 'true',
        'FW-Targets': 'product-form:p2',
      },
    );

    expect(response).toMatchObject({
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 422,
    });
    const [formFragment] = fwFragmentFacts(response.body, 'product-form:p2');
    expect(formFragment).toMatchObject({
      stylesheetHrefs: ['/assets/tailwind.css'],
      target: 'product-form:p2',
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
        attrs: { 'fw-fragment-target': 'product-form:p2' },
      }),
    ).toHaveLength(1);
    expect(
      htmlElementFacts(formFragment?.innerHtml ?? '', {
        attrs: { 'data-error-code': 'OUT_OF_STOCK' },
        tag: 'output',
      }),
    ).toHaveLength(1);
    expect(htmlTextContent(formFragment?.innerHtml ?? '')).toContain('Only 2 available.');
    expect(htmlKeys(renderOrderHistory(db))).not.toContain('order-1');
  });

  it('renders Tailwind-first stylesheet hints and static utility classes', () => {
    const cartPage = renderCartPage();
    const pageHints = htmlDocumentFacts(commercePageHints.html);
    const cartDocument = htmlDocumentFacts(cartPage);

    expect(commerceMessageCatalog).toEqual({
      cartLabel: 'Cart',
      productStock: '{count} in stock',
    });
    expect(commercePageHints.earlyHints).toEqual({
      Link: '</assets/tailwind.css>; rel=preload; as=style',
    });
    expect(pageHints.title).toBe('Jiso Commerce (0)');
    expect(pageHints.metas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: 'Browse products and checkout with 0 verifiable cart item.',
            name: 'description',
          }),
        }),
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: 'Browse products and checkout with 0 verifiable cart item.',
            property: 'og:description',
          }),
        }),
      ]),
    );
    expect(pageHints.jsonScripts.map((script) => script.json)).toEqual([commerceMessageCatalog]);
    expect(pageHints.links).toMatchObject([
      { attrs: { href: '/assets/tailwind.css', rel: 'stylesheet' }, tag: 'link' },
    ]);
    expect(cartDocument.bodyAttrs.class).toBe('min-h-dvh bg-slate-50 p-6');
    expect(
      htmlElementFacts(cartPage, {
        attrs: { class: 'rounded bg-teal-600 px-2 py-0.5 text-white' },
        tag: 'span',
      }),
    ).toHaveLength(1);
  });

  it('resolves commerce route meta from loaded cart query data', () => {
    const db = createCommerceDb();
    db.write('cart_items', { productId: 'p1', qty: 3, unitPrice: 1499 });
    db.write('cart_items', { productId: 'p2', qty: 2, unitPrice: 2599 });

    expect(loadCartQuery(db)).toEqual({ count: 5 });
    expect(htmlDocumentFacts(renderCommercePageHints(loadCartQuery(db)).html).title).toBe(
      'Jiso Commerce (5)',
    );
    expect(htmlDocumentFacts(renderCartPage(db)).metas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: 'Browse products and checkout with 5 verifiable cart item.',
            name: 'description',
          }),
        }),
      ]),
    );
  });

  it('builds the linked Tailwind stylesheet for commerce utility classes', () => {
    rmSync('examples/commerce/dist', { force: true, recursive: true });

    execFileSync('corepack', ['pnpm', '--filter', '@jiso/example-commerce', 'run', 'build'], {
      stdio: 'pipe',
    });

    const css = readFileSync('examples/commerce/dist/assets/tailwind.css', 'utf8');

    expect(css).toContain('.bg-slate-50');
    expect(css).toContain('.rounded');
    expect(css).toContain('.text-red-700');
    expect(css).toContain('.bg-teal-600');
    expect(css).toContain('.border-slate-200');
  });

  it('compiles TSX-authored components to committed IR through the fixpoint gate', () => {
    // SPEC.md section 5.2.3 / Constitution #3: emit-components.mjs asserts the
    // fixpoint (compiling emitted IR is a no-op) and render equivalence for
    // every authored component, and --check fails if committed IR is stale.
    execFileSync('node', ['examples/commerce/scripts/emit-components.mjs', '--check'], {
      stdio: 'pipe',
    });

    for (const name of ['cart-badge', 'order-history', 'product-grid']) {
      const authored = readFileSync(new URL(`./components/${name}.tsx`, import.meta.url), 'utf8');
      const generated = readFileSync(new URL(`./generated/${name}.tsx`, import.meta.url), 'utf8');

      // SPEC.md section 4.8: stamps are compiler-derived, never hand-written
      // in authored sugar (FW222 drift / FW223 duplicates).
      expect(authored).not.toMatch(/(?:data-bind|fw-deps|fw-c|fw-state|data-p-[\w-]+)=/);
      expect(generated).toContain('// @jiso-ir');
    }
  });
});
