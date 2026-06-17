import { describe, expect, it } from 'vitest';

import { commerceDeclaredQueriesHarnessFact } from '@kovojs/conformance-fixtures/commerce-fixtures';
import { createKovoTestHarness } from '@kovojs/test/harness';
import {
  kovoFragmentFacts,
  kovoResponseBodyFact,
  htmlElementFacts,
  htmlKeyTextMap,
  htmlKeyValues,
} from '@kovojs/test/html-fragment';
import type { QueryDefinition } from '@kovojs/server';

import type { TouchGraph } from '@kovojs/drizzle';
import { morphStructuralTree } from '@kovojs/runtime';

import {
  addToCart,
  commerceCsrf,
  commerceCsrfInput,
  commerceAuthCsrf,
  commerceTouchGraph,
  createCommerceDb,
  cartQuery,
  loadProductGrid,
  orderHistoryQuery,
  productGridQuery,
  EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET,
  EXAMPLE_ONLY_COMMERCE_CSRF_SECRET,
  renderOrderHistory,
  renderCartPage,
  renderProductGrid,
  renderProductGridDeferredStream,
  renderProductGridPageFragment,
} from './app.js';
import {
  keyedListNode,
  productGridInput,
  queryContext,
  readCartItems,
  resetProducts,
  seedCartItems,
  seedOrders,
} from './app-test-helpers.js';
import { cartItems, orders, products } from './schema.js';

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
        await tx.insert(cartItems).values({ productId: 'p1', qty: 1, unitPrice: 1499 });
        return 'committed';
      }),
    ).resolves.toBe('committed');
    expect(await readCartItems(db)).toEqual([{ productId: 'p1', qty: 1, unitPrice: 1499 }]);

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(cartItems).values({ productId: 'p2', qty: 1, unitPrice: 2599 });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await readCartItems(db)).toEqual([{ productId: 'p1', qty: 1, unitPrice: 1499 }]);
  });

  it('executes addToCart and verifies rendered cart badge without a browser', async () => {
    const harness = createKovoTestHarness({
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
      items: [
        {
          id: 'p1',
          name: 'Aero Wireless Keyboard',
          category: 'Peripherals',
          emoji: '⌨️',
          stock: 3,
          unitPrice: 1499,
        },
      ],
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

    await expect(productGridQuery.load({ limit: 1 })).rejects.toThrow(
      'commerce query loaders require context.db or request.db',
    );
  });

  it('loads every declared query from a custom request database instead of starter data', async () => {
    const db = createCommerceDb();
    await resetProducts(db, [{ id: 'custom', stock: 42, unitPrice: 777 }]);
    await seedCartItems(db, [
      { productId: 'custom', qty: 4, unitPrice: 777 },
      { productId: 'custom', qty: 6, unitPrice: 777 },
    ]);
    const customOrders = [
      {
        id: 'custom-order',
        productId: 'custom',
        qty: 10,
        total: 7770,
        userId: 'u-custom-query',
      },
    ];
    await seedOrders(db, customOrders);
    const context = queryContext(db);

    await expect(Promise.resolve(cartQuery.load({}, context))).resolves.toEqual({ count: 10 });
    await expect(Promise.resolve(productGridQuery.load({}, context))).resolves.toEqual({
      items: [
        {
          id: 'custom',
          name: 'Sample Product',
          category: 'General',
          emoji: '📦',
          stock: 42,
          unitPrice: 777,
        },
      ],
      nextCursor: null,
    });
    // SECURITY (SECURITY_FINDINGS.md M9): orderHistory is scoped to the session
    // user, so it only returns rows owned by the requesting user.
    const customOrderContext = {
      db,
      request: { db, session: { id: 'u-custom-query', user: { id: 'u-custom-query' } } },
      session: { id: 'u-custom-query', user: { id: 'u-custom-query' } },
    };
    await expect(Promise.resolve(orderHistoryQuery.load({}, customOrderContext))).resolves.toEqual({
      items: customOrders,
    });
    // A different session user sees none of those orders.
    await expect(Promise.resolve(orderHistoryQuery.load({}, context))).resolves.toEqual({
      items: [],
    });
  });

  it('verifies every declared query through the harness db read seam', async () => {
    await expect(
      commerceDeclaredQueriesHarnessFact({
        createDb: createCommerceDb,
        queries: {
          cart: cartQuery,
          // orderHistory now carries an `authed` guard (SECURITY_FINDINGS.md M9); its narrowed
          // request type is invariant, so cast to the bare QueryDefinition the harness accepts.
          orderHistory: orderHistoryQuery as unknown as QueryDefinition,
          productGrid: productGridQuery,
        },
        // SECURITY (SECURITY_FINDINGS.md M9): orderHistory is scoped to the session
        // user, so the harness must run as the user that owns the seeded orders.
        request: { session: { id: 'u-custom-query', user: { id: 'u-custom-query' } } },
        setupDb(db) {
          // The harness does not await setupDb, so submit the seed as
          // fire-and-queue Drizzle statements via .execute(): that hands each
          // op to the PGlite client synchronously, and PGlite runs operations
          // FIFO, so they land before the later awaited harness.query select
          // (the same pattern createCommerceDb uses for its DDL + product seed).
          void db.delete(products).execute();
          void db.insert(products).values({ id: 'custom', stock: 42, unitPrice: 777 }).execute();
          void db
            .insert(cartItems)
            .values({ productId: 'custom', qty: 3, unitPrice: 777 })
            .execute();
          void db
            .insert(orders)
            .values({
              id: 'custom-order',
              productId: 'custom',
              qty: 3,
              total: 2331,
              userId: 'u-custom-query',
            })
            .execute();
        },
        verification: {
          domainByTable: {
            cart_items: 'cart',
            orders: 'order',
            products: 'product',
          },
        },
      }),
    ).resolves.toEqual({
      cart: {
        diagnostics: [],
        result: { count: 3 },
      },
      orderHistory: {
        diagnostics: [],
        result: {
          items: [
            {
              id: 'custom-order',
              productId: 'custom',
              qty: 3,
              total: 2331,
              userId: 'u-custom-query',
            },
          ],
        },
      },
      productGrid: {
        diagnostics: [],
        result: {
          items: [
            {
              id: 'custom',
              name: 'Sample Product',
              category: 'General',
              emoji: '📦',
              stock: 42,
              unitPrice: 777,
            },
          ],
          nextCursor: null,
        },
      },
    });
  });

  it('renders cursor-paged product grid and order history with stable list keys', async () => {
    const db = createCommerceDb();
    const firstPage = await loadProductGrid(db, { limit: 2 });
    const secondPage = await loadProductGrid(db, productGridInput(firstPage.nextCursor, 2));

    expect(htmlKeyValues(renderProductGrid(firstPage))).toEqual(['p1', 'p2']);
    expect(
      htmlElementFacts(renderProductGrid(firstPage), {
        attrs: { href: '/products?after=p2' },
        tag: 'a',
      }),
    ).toHaveLength(1);
    expect(htmlKeyValues(renderProductGrid(secondPage))).toEqual(['p3']);

    const appendFragment = await renderProductGridPageFragment(
      db,
      productGridInput(firstPage.nextCursor, 2),
    );

    expect(kovoFragmentFacts(appendFragment, 'product-grid')).toMatchObject([
      { attrs: { mode: 'append', target: 'product-grid' } },
    ]);
    expect(htmlKeyValues(appendFragment)).toEqual(['p3']);
    expect(htmlElementFacts(appendFragment, { attrs: { 'kovo-c': 'product-grid' } })).toHaveLength(
      0,
    );

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

    // SECURITY (SECURITY_FINDINGS.md M9): renderOrderHistory is scoped to the
    // session user, so it must be given the owning user id to surface the order.
    expect(htmlKeyTextMap(await renderOrderHistory(db, 'u-direct'))).toMatchObject({
      'order-1': 'p1 x 2 - 2998',
    });
  });

  it('preserves commerce list identity through append and simultaneous optimistic reorder', async () => {
    const db = createCommerceDb();
    const firstPage = await loadProductGrid(db, { limit: 2 });
    const firstPageKeys = firstPage.items.map((item) => item.id);
    const secondPage = await loadProductGrid(db, productGridInput(firstPage.nextCursor, 2));
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

    expect(htmlKeyValues(renderProductGrid(firstPage))).toEqual(['p1', 'p2']);
    expect(
      kovoFragmentFacts(
        await renderProductGridPageFragment(db, productGridInput(firstPage.nextCursor)),
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

    // SECURITY (SECURITY_FINDINGS.md M9): scope to the owning session user.
    expect(htmlKeyValues(await renderOrderHistory(db, 'u-direct'))).toContain('order-1');
    expect(reconciledHistory.children?.[0]?.key).toBe('order-1');
    expect(reconciledHistory.children?.[1]).toBe(optimisticOrder);
    expect(reconciledHistory.children?.[1]?.browserState).toEqual({
      islandState: { pendingMutation: 'cart/add' },
    });
  });

  it('streams deferred product grid fragments with app stylesheet hints', async () => {
    const response = await renderProductGridDeferredStream(createCommerceDb());

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
        tag: 'kovo-defer',
      }),
    ).toHaveLength(1);
    const responseFact = kovoResponseBodyFact(response.body);
    expect(responseFact.queryNames).toEqual(['productGrid']);
    expect(
      responseFact.fragments.filter((fragment) => fragment.target === 'product-grid'),
    ).toMatchObject([{ stylesheetHrefs: ['/assets/styles.css'] }]);
    // The streamed grid renders @kovojs/ui Card-based product cards, each a
    // keyed <article> the §9.1 morph targets.
    expect(htmlKeyValues(response.body)).toContain('p1');
  });
});
