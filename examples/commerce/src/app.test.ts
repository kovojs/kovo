import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

import { createJisoTestHarness, propertyTest } from '@jiso/test';
import type { TouchGraph } from '@jiso/drizzle';
import { morphStructuralTree, type StructuralMorphNode } from '@jiso/runtime';
import { fwCheck, fwExplain } from '../../../packages/cli/src/index.js';

import {
  addToCart,
  addToCartOptimistic,
  commerceGraph,
  commercePageHints,
  commerceSession,
  commerceTouchGraph,
  createCommerceDb,
  loadCartQuery,
  loadProductGrid,
  renderCommercePageHints,
  renderAddToCartForm,
  renderOrderHistory,
  renderCartPage,
  renderProductGrid,
  renderProductGridDeferredStream,
  renderProductGridPageFragment,
  renderReceiptUploadForm,
  submitAddToCart,
  submitAddToCartNoJs,
  type AddToCartInput,
  uploadReceipt,
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

  return new Map(
    updates.split('; ').map((entry) => {
      const [query, consumers = ''] = entry.split('->');

      return [query, explainList(consumers)];
    }),
  );
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

function keyedListNode(
  type: string,
  keys: readonly string[],
  stateByKey: Record<string, StructuralMorphNode['browserState']> = {},
): StructuralMorphNode {
  return {
    children: keys.map((key) => ({
      browserState: stateByKey[key],
      key,
      props: { 'data-key': key },
      text: key,
      type: 'li',
    })),
    type,
  };
}

describe('commerce example', () => {
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
      touchGraph: commerceTouchGraph as unknown as TouchGraph,
      verification: {
        domainByTable: {
          cart_items: 'cart',
          orders: 'order',
          products: 'product',
        },
      },
    });

    await expect(harness.exec(addToCart, { productId: 'p1', quantity: 2 })).resolves.toMatchObject({
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

  it('renders cursor-paged product grid and order history with stable list keys', async () => {
    const db = createCommerceDb();
    const firstPage = loadProductGrid(db, { limit: 2 });
    const secondPage = loadProductGrid(db, { after: firstPage.nextCursor ?? undefined, limit: 2 });

    expect(renderProductGrid(firstPage)).toContain('data-key="p1"');
    expect(renderProductGrid(firstPage)).toContain('data-key="p2"');
    expect(renderProductGrid(firstPage)).toContain('href="/products?after=p2"');
    expect(renderProductGrid(secondPage)).toContain('data-key="p3"');

    const appendFragment = renderProductGridPageFragment(db, {
      after: firstPage.nextCursor ?? undefined,
      limit: 2,
    });

    expect(appendFragment).toContain('<fw-fragment target="product-grid" mode="append">');
    expect(appendFragment).toContain('data-key="p3"');
    expect(appendFragment).not.toContain('data-key="p1"');
    expect(appendFragment).not.toContain('data-key="p2"');
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

    expect(renderOrderHistory(db)).toContain('data-key="order-1"');
    expect(renderOrderHistory(db)).toContain('p1 x 2 - 2998');
  });

  it('preserves commerce list identity through append and simultaneous optimistic reorder', async () => {
    const db = createCommerceDb();
    const firstPage = loadProductGrid(db, { limit: 2 });
    const firstPageKeys = firstPage.items.map((item) => item.id);
    const secondPage = loadProductGrid(db, { after: firstPage.nextCursor ?? undefined, limit: 2 });
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

    expect(renderProductGrid(firstPage)).toContain('data-key="p1"');
    expect(
      renderProductGridPageFragment(db, { after: firstPage.nextCursor ?? undefined }),
    ).toContain('<fw-fragment target="product-grid" mode="append">');
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

    expect(renderOrderHistory(db)).toContain('data-key="order-1"');
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
        'Transfer-Encoding': 'chunked',
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

  it('coerces commerce receipt uploads through s.file()', async () => {
    const receipt = commerceFile('receipt.pdf', 'application/pdf', 2048);

    expect(
      uploadReceipt.handler(
        { orderId: 'order-1', receipt },
        { db: createCommerceDb(), session: { id: 's-upload', user: { id: 'u1' } } },
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
      fileName: 'receipt.pdf',
      orderId: 'order-1',
      size: 2048,
      uploadedBy: 'u1',
    });

    expect(() =>
      uploadReceipt.input.parse({
        orderId: 'order-1',
        receipt: commerceFile('receipt.txt', 'text/plain', 12),
      }),
    ).toThrow('Expected file type application/pdf, image/png');
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
    expect(renderOrderHistory(db)).toContain('data-key="order-1"');
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
    expect(response.body).toContain('data-key="order-2"');
    expect(transactions).toBe(2);
  });

  it('contains product-grid fragment failures with a per-island error boundary', async () => {
    const db = createCommerceDb();
    db.products.values = (() => {
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
      html: '<title>Jiso Commerce (1)</title><meta name="description" content="Browse products and checkout with 1 verifiable cart item."><meta property="og:description" content="Browse products and checkout with 1 verifiable cart item."><script type="application/json" fw-i18n locale="en-US">{"cartLabel":"Cart","productStock":"{count} in stock"}</script><link rel="stylesheet" href="/assets/tailwind.css">',
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

  it('ships graph facts for fw check and explain acceptance', () => {
    expect(addToCart.registry?.touches).toBeUndefined();
    expect(addToCart.registry?.inferredTouches).toEqual(commerceTouchGraph['cart.addItem'].touches);
    expect(commerceTouchGraph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'examples/commerce/src/generated/touch-graph.ts:6',
            via: 'cart_items',
          },
          {
            domain: 'order',
            keys: null,
            site: 'examples/commerce/src/generated/touch-graph.ts:7',
            via: 'orders',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            predicate: 'eq',
            site: 'examples/commerce/src/generated/touch-graph.ts:8',
            via: 'products',
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
        'writes: -',
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
        'writes: -',
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
        'fw-explain/v1\nQUERY orderHistory\nreads: order\nconsumers: component:OrderHistory,page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
    });
    expect(fwExplain(commerceGraph, { kind: 'page', target: '/cart' })).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'PAGE /cart',
        'prefetch: false',
        'meta: title=Jiso Commerce (1) description=Browse products and checkout with 1 verifiable cart item. image=-',
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

  it('answers commerce optimistic coverage mechanically from fw explain output', () => {
    for (const mutation of commerceGraph.mutations) {
      const explanation = fwExplain(commerceGraph, {
        kind: 'mutation',
        optimistic: true,
        target: mutation.key,
      });
      const statuses = optimisticStatuses(explanation.output);
      const affectedQueries = [...mutationUpdateConsumers(explanation.output).keys()];

      for (const query of affectedQueries) {
        expect(statuses.get(query)).toBeDefined();
        expect(statuses.get(query)).not.toBe('UNHANDLED');
      }
      expect(explainLine(explanation.output, 'OPTIMISTIC-SUMMARY ')).toContain('UNHANDLED=0');
    }
  });
});
