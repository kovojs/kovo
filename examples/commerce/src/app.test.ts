import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';

import { storageBodyToBytes } from '@jiso/core';
import { createJisoTestHarness, propertyTest } from '@jiso/test';
import type { TouchGraph } from '@jiso/drizzle';
import { morphStructuralTree, type StructuralMorphNode } from '@jiso/runtime';
import { csrfToken, runMutation } from '@jiso/server';
import { fwCheck, fwExplain } from '../../../packages/cli/src/index.js';

import {
  addToCart,
  addToCartOptimistic,
  attachmentDownloadRoute,
  commerceAttachmentStorage,
  commerceCsrf,
  commerceCsrfInput,
  commerceGraph,
  commerceAuthCsrf,
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

function lineNumberFor(source: string, needle: string): number {
  const index = source.indexOf(needle);
  expect(index).not.toBe(-1);
  return source.slice(0, index).split('\n').length;
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

function explainLine(output: string, prefix: string) {
  const line = output.split('\n').find((item) => item.startsWith(prefix));

  if (!line) {
    throw new Error(`Missing fw explain line: ${prefix}`);
  }

  return line.slice(prefix.length);
}

function explainList(value: string) {
  return value === '-' ? [] : value.split(',');
}

function mutationUpdateConsumers(output: string) {
  const updates = explainLine(output, 'updates: ');

  if (updates === '-') {
    return new Map<string, string[]>();
  }

  const result = new Map<string, string[]>();
  for (const entry of updates.split('; ')) {
    const [query, consumers = ''] = entry.split('->');
    if (!query) {
      throw new Error(`Malformed fw explain update entry: ${entry}`);
    }

    result.set(query, explainList(consumers));
  }

  return result;
}

function optimisticStatuses(output: string) {
  return new Map(
    output
      .split('\n')
      .filter((line) => line.startsWith('OPTIMISTIC '))
      .map((line) => {
        const [, query, status] = line.split(' ');

        return [query, status] as const;
      }),
  );
}

function queryChunkNames(html: string) {
  return [...html.matchAll(/<fw-query name="([^"]+)">/g)].map((match) => {
    const name = match[1];
    if (!name) {
      throw new Error(`Malformed fw-query chunk: ${match[0]}`);
    }

    return name;
  });
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

function fragmentTargetForQuery(query: string) {
  const component = commerceGraph.components.find((item) => item.queries.includes(query));
  const fragment = component?.fragments[0];

  if (!fragment) {
    throw new Error(`Missing commerce fragment target for query ${query}`);
  }

  return fragment;
}

function invalidatedByQueries() {
  return new Map(
    commerceGraph.queries.map((query) => {
      const explanation = fwExplain(commerceGraph, { kind: 'query', target: query.query });

      return [query.query, explainList(explainLine(explanation.output, 'invalidated-by: '))];
    }),
  );
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
    await expect(
      harness.page('/cart').then((page) => page.fragment('cart-badge')),
    ).resolves.toContain('data-bind="cart.count"');
  });

  it('loads declared commerce queries from the request database', async () => {
    const db = createCommerceDb();
    const request = { db, session: { id: 's-query', user: { id: 'u-query' } } };

    await addToCart.handler({ productId: 'p1', quantity: 2 }, request, {
      fail(code, payload) {
        return { error: { code, payload }, ok: false, status: 422 };
      },
      invalidate(domain, options) {
        return { domain: domain.key, ...options, manual: true };
      },
    });

    await expect(Promise.resolve(cartQuery.load({}, { request }))).resolves.toEqual({ count: 2 });
    await expect(
      Promise.resolve(productGridQuery.load({ limit: 1 }, { request })),
    ).resolves.toEqual({
      items: [{ id: 'p1', stock: 3, unitPrice: 1499 }],
      nextCursor: 'p1',
    });
    await expect(Promise.resolve(orderHistoryQuery.load({}, { request }))).resolves.toEqual({
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
      'commerce query loaders require request.db',
    );
  });

  it('does not fall back to starter commerce data when loading product queries', async () => {
    const db = createCommerceDb();
    db.products = new Map([['custom', { id: 'custom', stock: 42, unitPrice: 777 }]]);
    const request = { db, session: { id: 's-custom-query', user: { id: 'u-custom-query' } } };

    await expect(Promise.resolve(productGridQuery.load({}, { request }))).resolves.toEqual({
      items: [{ id: 'custom', stock: 42, unitPrice: 777 }],
      nextCursor: null,
    });
  });

  it('renders cursor-paged product grid and order history with stable list keys', async () => {
    const db = createCommerceDb();
    const firstPage = loadProductGrid(db, { limit: 2 });
    const secondPage = loadProductGrid(db, productGridInput(firstPage.nextCursor, 2));

    expect(renderProductGrid(firstPage)).toContain('fw-key="p1"');
    expect(renderProductGrid(firstPage)).toContain('fw-key="p2"');
    expect(renderProductGrid(firstPage)).toContain('href="/products?after=p2"');
    expect(renderProductGrid(secondPage)).toContain('fw-key="p3"');

    const appendFragment = renderProductGridPageFragment(
      db,
      productGridInput(firstPage.nextCursor, 2),
    );

    expect(appendFragment).toContain('<fw-fragment target="product-grid" mode="append">');
    expect(appendFragment).toContain('fw-key="p3"');
    expect(appendFragment).not.toContain('fw-key="p1"');
    expect(appendFragment).not.toContain('fw-key="p2"');
    expect(appendFragment).not.toContain('<section fw-c="product-grid"');

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

    expect(renderOrderHistory(db)).toContain('fw-key="order-1"');
    expect(renderOrderHistory(db)).toContain('p1 x 2 - 2998');
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

    expect(renderProductGrid(firstPage)).toContain('fw-key="p1"');
    expect(renderProductGridPageFragment(db, productGridInput(firstPage.nextCursor))).toContain(
      '<fw-fragment target="product-grid" mode="append">',
    );
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

    expect(renderOrderHistory(db)).toContain('fw-key="order-1"');
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
    expect(response.body).toContain(
      '<main class="min-h-dvh bg-slate-50 p-6"><fw-defer target="product-grid" state="pending"></fw-defer>',
    );
    expect(response.body).toContain('<fw-query name="productGrid">');
    expect(response.body).toContain('<fw-fragment target="product-grid">');
    expect(response.body).toContain('<link rel="stylesheet" href="/assets/tailwind.css">');
    expect(response.body).toContain('class="rounded border border-slate-200 bg-white p-4"');
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

    expect(renderCommerceLoginForm(request, { next: '/admin' })).toContain(
      'data-mutation="auth/sign-in"',
    );
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

    expect(renderCommerceLogoutForm(authedRequest)).toContain('data-mutation="auth/sign-out"');
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
    const html = renderCartPage();

    expect(renderAddToCartForm({ id: 'p1', stock: 5 })).toContain(
      '<form method="post" action="/_m/cart/add" enhance data-mutation="cart/add"',
    );
    expect(html).toContain('name="productId" value="p1"');
    expect(html).toContain('name="quantity" type="number" min="1" max="5" value="1"');
    expect(html).toContain('type="submit">Add</button>');
  });

  it('renders a multipart receipt upload form on the commerce page', () => {
    const form = renderReceiptUploadForm('order-1');
    const html = renderCartPage();

    expect(form).toContain(
      '<form method="post" action="/_m/order/receipt" enhance data-mutation="order/receipt" enctype="multipart/form-data"',
    );
    expect(form).toContain('fw-deps="order"');
    expect(form).toContain('aria-busy="false"');
    expect(form).toContain('name="orderId" value="order-1"');
    expect(form).toContain('name="receipt" type="file" accept="application/pdf,image/png"');
    expect(form).toContain('fw-upload-progress value="0" max="100"');
    expect(html).toContain('data-mutation="order/receipt"');
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

    expect(renderCartPage(db)).toContain('3 in stock');
    expect(renderOrderHistory(db)).toContain('fw-key="order-1"');
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

    expect(response.body).toContain('<fw-query name="cart">');
    expect(response.body).toContain('<fw-query name="productGrid">');
    expect(response.body).toContain('<fw-query name="orderHistory">');
    expect(response.body).toContain('<fw-fragment target="cart-badge">');
    expect(response.body).toContain('<fw-fragment target="product-grid">');
    expect(response.body).toContain('<fw-fragment target="order-history">');
    expect(response.body.match(/\/assets\/tailwind\.css/g) ?? []).toHaveLength(3);
    expect(response.body).toContain('fw-key="order-2"');
    expect(transactions).toBe(2);
  });

  it('contains product-grid fragment failures with a per-island error boundary', async () => {
    const db = createCommerceDb();
    const values = db.products.values.bind(db.products);
    let productGridReads = 0;
    db.products.values = (() => {
      productGridReads += 1;
      if (productGridReads === 1) return values();

      throw new Error('catalog unavailable');
    }) as typeof db.products.values;

    const response = await submitAddToCart(
      { productId: 'p1', quantity: 1 },
      { db, session: { id: 's-enhanced-boundary', user: { id: 'u1' } } },
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
    expect(response.body).toContain(
      '<fw-fragment target="product-grid" error-boundary="product-grid">',
    );
    expect(response.body).toContain('<link rel="stylesheet" href="/assets/tailwind.css">');
    expect(response.body).toContain('Product grid failed: catalog unavailable');
    expect(response.body).toContain('<fw-fragment target="cart-badge">');
    expect(response.body).toContain('<fw-fragment target="order-history">');
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
    expect(response.body).toContain('<html>');
    expect(response.body).toContain('<form method="post" action="/_m/cart/add" enhance');
    expect(response.body).toContain('name="productId" value="p2"');
    expect(response.body).toContain('data-error-code="OUT_OF_STOCK"');
    expect(response.body).toContain('Only 2 available.');
    expect(renderOrderHistory(db)).not.toContain('order-1');
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
    expect(response.body).toContain('<fw-fragment target="product-form:p2">');
    expect(response.body).toContain('<link rel="stylesheet" href="/assets/tailwind.css">');
    expect(response.body).toContain('<form method="post" action="/_m/cart/add" enhance');
    expect(response.body).toContain('fw-fragment-target="product-form:p2"');
    expect(response.body).toContain('name="productId" value="p2"');
    expect(response.body).toContain('data-error-code="OUT_OF_STOCK"');
    expect(response.body).toContain('Only 2 available.');
    expect(renderOrderHistory(db)).not.toContain('order-1');
  });

  it('renders Tailwind-first stylesheet hints and static utility classes', () => {
    const commerceSource = readFileSync(new URL('./app.ts', import.meta.url), 'utf8');
    const catalogSource =
      /export const commerceMessages = i18n\('en-US', \{(?<body>[\s\S]*?)\}\);/.exec(commerceSource)
        ?.groups?.body;

    expect(catalogSource?.match(/\bcartLabel:/g) ?? []).toHaveLength(1);
    expect(commercePageHints).toEqual({
      earlyHints: {
        Link: '</assets/tailwind.css>; rel=preload; as=style',
      },
      html: '<title>Jiso Commerce (0)</title><meta name="description" content="Browse products and checkout with 0 verifiable cart item."><meta property="og:description" content="Browse products and checkout with 0 verifiable cart item."><script type="application/json" fw-i18n locale="en-US">{"cartLabel":"Cart","productStock":"{count} in stock"}</script><link rel="stylesheet" href="/assets/tailwind.css">',
    });

    expect(renderCartPage()).toContain('<link rel="stylesheet" href="/assets/tailwind.css">');
    expect(renderCartPage()).toContain('<title>Jiso Commerce (0)</title>');
    expect(renderCartPage()).toContain('fw-i18n locale="en-US"');
    expect(renderCartPage()).toContain('class="min-h-dvh bg-slate-50 p-6"');
    expect(renderCartPage()).toContain('class="rounded bg-teal-600 px-2 py-0.5 text-white"');
  });

  it('resolves commerce route meta from loaded cart query data', () => {
    const db = createCommerceDb();
    db.write('cart_items', { productId: 'p1', qty: 3, unitPrice: 1499 });
    db.write('cart_items', { productId: 'p2', qty: 2, unitPrice: 2599 });

    expect(loadCartQuery(db)).toEqual({ count: 5 });
    expect(renderCommercePageHints(loadCartQuery(db)).html).toContain(
      '<title>Jiso Commerce (5)</title>',
    );
    expect(renderCartPage(db)).toContain(
      '<meta name="description" content="Browse products and checkout with 5 verifiable cart item.">',
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

  it('ships graph facts for fw check and explain acceptance', () => {
    execFileSync('node', ['examples/commerce/scripts/emit-graph.mjs', '--check'], {
      stdio: 'pipe',
    });
    const emitGraphScript = readFileSync(
      new URL('../scripts/emit-graph.mjs', import.meta.url),
      'utf8',
    );
    const graphArtifact = JSON.parse(
      readFileSync(new URL('./generated/graph.json', import.meta.url), 'utf8'),
    );
    const commerceSource = readFileSync(new URL('./app.ts', import.meta.url), 'utf8');
    const cartItemsLine = lineNumberFor(commerceSource, "request.db.write('cart_items'");
    const ordersLine = lineNumberFor(commerceSource, "request.db.write('orders'");
    const productsLine = lineNumberFor(commerceSource, "request.db.write('products'");
    const attachmentsLine = lineNumberFor(commerceSource, "request.db.write('attachments'");
    const paymentOrdersLine = lineNumberFor(commerceSource, "tx.write('orders'");

    expect(emitGraphScript).toContain("await import('@jiso/compiler/graph');");
    expect(emitGraphScript).not.toContain('const deriveAppGraph = ({ graph }) => ({ graph })');
    expect(graphArtifact).toEqual(commerceGraph);
    expect(fwCheck(graphArtifact).output).toBe('fw-check/v1\nOK\n');
    expect(addToCart.registry?.touches).toBeUndefined();
    expect(addToCart.registry?.inferredTouches).toEqual(commerceTouchGraph['cart.addItem'].touches);
    expect(commerceTouchGraph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: `examples/commerce/src/app.ts:${cartItemsLine}`,
            via: 'cart_items',
          },
          {
            domain: 'order',
            keys: null,
            site: `examples/commerce/src/app.ts:${ordersLine}`,
            via: 'orders',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            predicate: 'eq',
            site: `examples/commerce/src/app.ts:${productsLine}`,
            via: 'products',
          },
        ],
        unresolved: [],
      },
      'order.receipt': {
        reads: [],
        touches: [
          {
            domain: 'attachment',
            keys: 'arg:orderId',
            predicate: 'eq',
            site: `examples/commerce/src/app.ts:${attachmentsLine}`,
            via: 'attachments',
          },
        ],
        unresolved: [],
      },
      'payment.webhook': {
        reads: [],
        touches: [
          {
            domain: 'order',
            keys: 'arg:data.object.id',
            predicate: 'eq',
            site: `examples/commerce/src/app.ts:${paymentOrdersLine}`,
            via: 'orders',
          },
        ],
        unresolved: [],
      },
    });
    expect(fwCheck(commerceGraph)).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
    expect(fwCheck(commerceGraph).output).not.toContain('FW310');

    expect(
      fwExplain(commerceGraph, { kind: 'mutation', optimistic: true, target: 'cart/add' }),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION cart/add',
        'guards: authed,rateLimit:session',
        'session: commerceSession',
        'input-fields: productId,quantity',
        'writes: cart,product,order',
        'invalidates: cart,product,order',
        'manual-invalidates: -',
        'updates: cart->component:CartBadge,page:/cart; orderHistory->component:OrderHistory,page:/cart; productGrid->component:ProductGrid,page:/cart',
        'OPTIMISTIC cart hand-written',
        'OPTIMISTIC productGrid await-fragment',
        'OPTIMISTIC orderHistory await-fragment',
        'OPTIMISTIC-SUMMARY total=3 hand-written=1 await-fragment=2 UNHANDLED=0',
        '',
      ].join('\n'),
    });
    expect(fwExplain(commerceGraph, { kind: 'mutation', target: 'order/receipt' })).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION order/receipt',
        'guards: authed,rateLimit:session',
        'session: commerceSession',
        'enctype: multipart/form-data',
        'input-fields: orderId,receipt',
        'file-fields: receipt',
        'writes: attachment',
        'invalidates: -',
        'manual-invalidates: -',
        'updates: -',
        '',
      ].join('\n'),
    });
    expect(
      fwExplain(commerceGraph, { kind: 'mutation', optimistic: true, target: 'order/receipt' }),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION order/receipt',
        'guards: authed,rateLimit:session',
        'session: commerceSession',
        'enctype: multipart/form-data',
        'input-fields: orderId,receipt',
        'file-fields: receipt',
        'writes: attachment',
        'invalidates: -',
        'manual-invalidates: -',
        'updates: -',
        'OPTIMISTIC-SUMMARY total=0 hand-written=0 await-fragment=0 UNHANDLED=0',
        '',
      ].join('\n'),
    });
    expect(fwExplain(commerceGraph, { kind: 'query', target: 'cart' })).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge,page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
    });
    expect(fwExplain(commerceGraph, { kind: 'query', target: 'productGrid' })).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nQUERY productGrid\nreads: product\nconsumers: component:ProductGrid,page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
    });
    expect(fwExplain(commerceGraph, { kind: 'query', target: 'orderHistory' })).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nQUERY orderHistory\nreads: order\nconsumers: component:OrderHistory,page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem,payment.webhook\n',
    });
    expect(fwExplain(commerceGraph, { kind: 'page', target: '/cart' })).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'PAGE /cart',
        'prefetch: false',
        'meta: title=Jiso Commerce (0) description=Browse products and checkout with 0 verifiable cart item. image=-',
        'i18n: en-US:cartLabel,productStock',
        'modulepreloads: -',
        'stylesheets: /assets/tailwind.css',
        'queries: cart,productGrid,orderHistory',
        'view-transitions: -',
        '',
      ].join('\n'),
    });
    expect(fwExplain(commerceGraph, { unguarded: true })).toEqual({
      exitCode: 0,
      output: 'fw-explain/v1\nUNGUARDED\nSUMMARY total=0\n',
    });
    expect(fwExplain(commerceGraph, { endpoints: true })).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'ENDPOINTS',
        'ENDPOINT attachments/download method=GET path=/attachments/:id mount=exact auth=authed csrf=checked writes=-',
        'ENDPOINT orders/export method=GET path=/exports/orders.csv mount=exact auth=authed csrf=checked writes=-',
        'ENDPOINT payment/stripe method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe:v1:hmac-sha256 csrf=exempt:payment/stripe webhook verifier stripe:v1:hmac-sha256 writes=order',
        'SUMMARY total=3',
        '',
      ].join('\n'),
    });
    expect(fwExplain(commerceGraph, { unscoped: true })).toEqual({
      exitCode: 0,
      output: 'fw-explain/v1\nUNSCOPED\nSUMMARY total=0\n',
    });
    expect(
      fwExplain(
        {
          ...commerceGraph,
          scopeAudits: commerceGraph.scopeAudits.map((fact, index) =>
            index === 0
              ? {
                  ...fact,
                  scope: 'unscoped',
                  site: 'examples/commerce/src/app.ts:deliberately-unscoped-download',
                }
              : fact,
          ),
        },
        { unscoped: true },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'UNSCOPED',
        'UNSCOPED QUERY attachments/download domain=attachment scope=unscoped site=examples/commerce/src/app.ts:deliberately-unscoped-download attachment download filters id plus session user',
        'SUMMARY total=1',
        '',
      ].join('\n'),
    });
  });

  it('answers cart/add update intent mechanically from fw explain output', () => {
    const mutation = fwExplain(commerceGraph, { kind: 'mutation', target: 'cart/add' });
    const page = fwExplain(commerceGraph, { kind: 'page', target: '/cart' });
    const updates = mutationUpdateConsumers(mutation.output);
    const pageQueries = explainList(explainLine(page.output, 'queries: '));

    expect(pageQueries).toEqual(['cart', 'productGrid', 'orderHistory']);

    for (const query of pageQueries) {
      const queryExplain = fwExplain(commerceGraph, { kind: 'query', target: query });
      const consumers = explainList(explainLine(queryExplain.output, 'consumers: '));
      const componentConsumers = consumers.filter((consumer) => consumer.startsWith('component:'));

      expect(updates.get(query)).toEqual(expect.arrayContaining(componentConsumers));
      expect(updates.get(query)).toContain('page:/cart');
      expect(consumers).toContain('page:/cart');
      expect(componentConsumers.length).toBeGreaterThan(0);
    }
  });

  it('answers the full commerce mutation-query matrix mechanically from fw explain output', () => {
    const invalidatedBy = invalidatedByQueries();
    const matrix: Record<string, Record<string, string>> = {};

    for (const mutation of commerceGraph.mutations) {
      const explanation = fwExplain(commerceGraph, {
        kind: 'mutation',
        optimistic: true,
        target: mutation.key,
      });
      const statuses = optimisticStatuses(explanation.output);
      const affectedQueries = [...mutationUpdateConsumers(explanation.output).keys()];
      const mutationMatrix: Record<string, string> = {};
      matrix[mutation.key] = mutationMatrix;

      for (const query of commerceGraph.queries) {
        const queryInvalidators = invalidatedBy.get(query.query) ?? [];
        const invalidated = affectedQueries.includes(query.query);

        expect(queryInvalidators.includes(mutation.key)).toBe(invalidated);
        if (invalidated) {
          expect(statuses.get(query.query)).toBeDefined();
          expect(statuses.get(query.query)).not.toBe('UNHANDLED');
          mutationMatrix[query.query] = statuses.get(query.query) ?? 'missing';
        } else {
          expect(statuses.get(query.query)).toBeUndefined();
          mutationMatrix[query.query] = 'no-invalidation';
        }
      }
      expect(explainLine(explanation.output, 'OPTIMISTIC-SUMMARY ')).toContain('UNHANDLED=0');
    }

    // SPEC.md §10.4/§16.5: every mutation/query cell either has an explicit
    // optimistic status or is proven not to be invalidated by that mutation.
    expect(matrix).toEqual({
      'auth/sign-out': {
        cart: 'no-invalidation',
        orderHistory: 'no-invalidation',
        productGrid: 'no-invalidation',
      },
      'cart/add': {
        cart: 'hand-written',
        orderHistory: 'await-fragment',
        productGrid: 'await-fragment',
      },
      'order/receipt': {
        cart: 'no-invalidation',
        orderHistory: 'no-invalidation',
        productGrid: 'no-invalidation',
      },
    });
  });

  it('accepts the commerce mutation-query matrix through static graph, verifier, and enhanced wire', async () => {
    const addToCartExplanation = fwExplain(commerceGraph, {
      kind: 'mutation',
      optimistic: true,
      target: 'cart/add',
    });
    const uploadReceiptExplanation = fwExplain(commerceGraph, {
      kind: 'mutation',
      optimistic: true,
      target: 'order/receipt',
    });
    const affectedQueries = [...mutationUpdateConsumers(addToCartExplanation.output).keys()];
    const uploadReceiptAffectedQueries = [
      ...mutationUpdateConsumers(uploadReceiptExplanation.output).keys(),
    ];
    const statuses = optimisticStatuses(addToCartExplanation.output);
    const db = createCommerceDb();
    const harness = createJisoTestHarness({
      db,
      request: {
        session: { id: 's-commerce-acceptance', user: { id: 'u1' } },
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
    const verifiedDb = harness.dbHandle();
    verifiedDb.transaction = (run) => run(verifiedDb);
    const receiptHarness = createJisoTestHarness({
      db: createCommerceDb(),
      request: {
        session: { id: 's-commerce-receipt', user: { id: 'u1' } },
      },
      touchGraph: { 'order.receipt': commerceTouchGraph['order.receipt'] } as unknown as TouchGraph,
      verification: {
        domainByTable: {
          attachments: 'attachment',
          cart_items: 'cart',
          orders: 'order',
          products: 'product',
        },
      },
    });

    // SPEC.md §10.4/§11.2: every invalidated query pair must have an explicit
    // optimistic status, and executed writes must stay within the static graph.
    expect(Object.fromEntries(statuses)).toEqual({
      cart: 'hand-written',
      orderHistory: 'await-fragment',
      productGrid: 'await-fragment',
    });
    expect(uploadReceiptAffectedQueries).toEqual([]);
    expect(explainLine(uploadReceiptExplanation.output, 'invalidates: ')).toBe('-');
    expect(explainLine(uploadReceiptExplanation.output, 'updates: ')).toBe('-');
    await expect(
      harness.exec(
        addToCart,
        commerceCsrfInput(
          { productId: 'p1', quantity: 2 },
          { db: verifiedDb, session: { id: 's-commerce-acceptance', user: { id: 'u1' } } },
        ),
        { touchGraphKey: 'cart.addItem' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      rerunQueries: expect.arrayContaining(affectedQueries),
    });
    expect(harness.verificationDiagnostics()).toEqual([]);
    await expect(
      receiptHarness.exec(
        uploadReceipt,
        commerceCsrfInput(
          {
            orderId: 'order-1',
            receipt: commerceFile('receipt.pdf', 'application/pdf', 2048),
          },
          {
            db: receiptHarness.dbHandle(),
            session: { id: 's-commerce-receipt', user: { id: 'u1' } },
          },
        ),
        { csrf: commerceCsrf, touchGraphKey: 'order.receipt' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        attachmentId: 'attachment-1',
        fileName: 'receipt.pdf',
        orderId: 'order-1',
        size: 2048,
        uploadedBy: 'u1',
      },
    });
    expect(receiptHarness.verificationDiagnostics()).toEqual([]);

    const response = await submitAddToCart(
      { productId: 'p2', quantity: 1 },
      { db: verifiedDb, session: { id: 's-commerce-acceptance-2', user: { id: 'u1' } } },
      {
        'FW-Fragment': 'true',
        'FW-Targets': affectedQueries.map(fragmentTargetForQuery).join(','),
      },
    );

    expect(response).toMatchObject({
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 200,
    });
    expect(queryChunkNames(response.body).sort((a, b) => a.localeCompare(b))).toEqual(
      [...affectedQueries].sort((a, b) => a.localeCompare(b)),
    );
    for (const query of affectedQueries) {
      expect(response.body).toContain(`<fw-fragment target="${fragmentTargetForQuery(query)}">`);
    }
    expect(response.body).toContain('fw-key="order-2"');
  });
});
