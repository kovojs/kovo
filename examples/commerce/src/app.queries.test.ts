import { describe, expect, it } from 'vitest';

import {
  addToCart,
  cartQuery,
  commerceAuthCsrf,
  commerceCsrf,
  createCommerceDb,
  EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET,
  EXAMPLE_ONLY_COMMERCE_CSRF_SECRET,
  loadOrderHistory,
  loadProductGrid,
  orderHistoryQuery,
  productGridQuery,
} from './domain.js';
import {
  productGridInput,
  queryContext,
  readCartItems,
  readOrders,
  resetProducts,
  seedCartItems,
  seedOrders,
} from './app-test-helpers.js';
import { cartItems } from './schema.js';

describe('commerce example queries', () => {
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

  it('executes addToCart against the request database', async () => {
    const db = createCommerceDb();
    const request = { db, session: { id: 's-direct', user: { id: 'u-direct' } } };

    await expect(
      addToCart.handler({ productId: 'p1', quantity: 2 }, request, {
        fail(code, payload) {
          return { error: { code, payload }, ok: false, status: 422 };
        },
        invalidate(domain, options) {
          return { domain: domain.key, ...options, manual: true };
        },
      }),
    ).resolves.toEqual({ productId: 'p1', quantity: 2 });

    expect(await readCartItems(db)).toEqual([{ productId: 'p1', qty: 2, unitPrice: 1499 }]);
    expect(await readOrders(db)).toEqual([
      {
        id: 'order-1',
        productId: 'p1',
        qty: 2,
        total: 2998,
        userId: 'u-direct',
      },
    ]);
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

    await expect(
      Promise.resolve(
        orderHistoryQuery.load(
          {},
          {
            db,
            request: { db, session: { id: 's-custom', user: { id: 'u-custom-query' } } },
            session: { id: 's-custom', user: { id: 'u-custom-query' } },
          },
        ),
      ),
    ).resolves.toEqual({ items: customOrders });
    await expect(Promise.resolve(orderHistoryQuery.load({}, context))).resolves.toEqual({
      items: [],
    });
  });

  it('loads cursor-paged products and user-scoped order history', async () => {
    const db = createCommerceDb();
    const firstPage = await loadProductGrid(db, { limit: 2 });
    const secondPage = await loadProductGrid(db, productGridInput(firstPage.nextCursor, 2));

    expect(firstPage.items.map((item) => item.id)).toEqual(['p1', 'p2']);
    expect(firstPage.nextCursor).toBe('p2');
    expect(secondPage.items.map((item) => item.id)).toEqual(['p3']);
    expect(secondPage.nextCursor).toBeNull();

    await addToCart.handler(
      { productId: 'p1', quantity: 2 },
      { db, session: { id: 's-history', user: { id: 'u-history' } } },
      {
        fail(code, payload) {
          return { error: { code, payload }, ok: false, status: 422 };
        },
        invalidate(domain, options) {
          return { domain: domain.key, ...options, manual: true };
        },
      },
    );

    await expect(loadOrderHistory(db, 'u-history')).resolves.toMatchObject({
      items: [{ id: 'order-1', productId: 'p1', qty: 2, total: 2998, userId: 'u-history' }],
    });
    await expect(loadOrderHistory(db, 'someone-else')).resolves.toEqual({ items: [] });
  });
});
