import { describe, expect, it } from 'vitest';

import { mutation, s } from '@jiso/server';

import { createJisoTestHarness, jisoTest } from './index.js';
import { createFakeDb } from './test-fixtures.js';

describe('@jiso/test harness context', () => {
  it('executes mutations against the provided db context', async () => {
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: { cart: string[] } }) {
        request.db.cart.push(input.productId);
        return request.db.cart;
      },
    });
    const harness = createJisoTestHarness({ db: { cart: [] as string[] } });

    await expect(harness.exec(addToCart, { productId: 'p1' })).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: ['p1'],
    });
  });

  it('merges request fixtures into mutation exec context', async () => {
    const guarded = mutation('cart/add', {
      csrf: false,
      guard(request: { db: { cart: string[] }; session?: { user?: { id: string } | null } }) {
        return Boolean(request.session?.user);
      },
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: { cart: string[] }; session?: { user?: { id: string } } }) {
        request.db.cart.push(`${request.session?.user?.id}:${input.productId}`);
        return request.db.cart;
      },
    });
    const harness = createJisoTestHarness({
      db: { cart: [] as string[] },
      request: { session: { user: { id: 'u1' } } },
    });

    await expect(harness.exec(guarded, { productId: 'p1' })).resolves.toMatchObject({
      ok: true,
      value: ['u1:p1'],
    });
  });

  it('lets exec override request fixtures per assertion while keeping harness db authoritative', async () => {
    const addToCart = mutation('cart/add', {
      csrf: false,
      guard(request: { db: { cart: string[] }; session?: { user?: { id: string } | null } }) {
        return Boolean(request.session?.user);
      },
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: { cart: string[] }; session?: { user?: { id: string } } }) {
        request.db.cart.push(`${request.session?.user?.id}:${input.productId}`);
        return request.db.cart;
      },
    });
    const harness = createJisoTestHarness({
      db: { cart: [] as string[] },
      request: { session: { user: { id: 'default-user' } } },
    });

    await expect(
      harness.exec(
        addToCart,
        { productId: 'p1' },
        {
          request: { session: { user: { id: 'u2' } } },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: ['u2:p1'],
    });
    await expect(harness.exec(addToCart, { productId: 'p2' })).resolves.toMatchObject({
      ok: true,
      value: ['u2:p1', 'default-user:p2'],
    });

    const assertDbOverrideRejected = () => {
      void harness.exec(
        addToCart,
        { productId: 'p3' },
        {
          // @ts-expect-error Per-exec request fixtures cannot replace the harness db.
          request: { db: { cart: [] as string[] } },
        },
      );
    };
    expect(assertDbOverrideRejected).toBeTypeOf('function');
  });

  it('exposes a stable db handle for direct harness assertions', async () => {
    const harness = createJisoTestHarness({ db: { cart: [] as string[] } });

    expect(harness.dbHandle()).toBe(harness.db);
    harness.dbHandle().cart.push('direct');

    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: { cart: string[] } }) {
        request.db.cart.push(input.productId);
        return request.db.cart;
      },
    });

    await expect(harness.exec(addToCart, { productId: 'p1' })).resolves.toMatchObject({
      ok: true,
      value: ['direct', 'p1'],
    });
  });

  it('exposes the verifier-wrapped db handle for direct observed operations', () => {
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart.addItem': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          cart_items: 'cart',
        },
      },
    });

    harness.dbHandle().write('cart_items', 'p1');

    expect(harness.dbHandle().read('cart_items')).toEqual(['p1']);
  });

  it('returns no verification diagnostics when verification is not configured', () => {
    const harness = createJisoTestHarness({ db: createFakeDb() });

    expect(harness.verificationDiagnostics()).toEqual([]);
  });

  it('runs a provided callback with a harness context', async () => {
    await expect(
      jisoTest(
        'cart page',
        async ({ page }) => {
          await expect(
            page('/cart').then((result) => result.fragment('cart-badge')),
          ).resolves.toContain('<cart-badge');
        },
        {
          db: {},
          pages: {
            '/cart': '<fw-fragment target="cart-badge"><cart-badge></cart-badge></fw-fragment>',
          },
        },
      ).run(),
    ).resolves.toBeUndefined();
  });

  it('returns a named test case that can be registered with a runner', async () => {
    const calls: string[] = [];
    const testCase = jisoTest(
      'cart page',
      async ({ page }) => {
        const result = await page('/cart');
        calls.push(result.fragment('cart-badge'));
      },
      {
        db: {},
        pages: {
          '/cart': '<fw-fragment target="cart-badge"><cart-badge></cart-badge></fw-fragment>',
        },
      },
    );

    expect(testCase.name).toBe('cart page');
    expect(calls).toEqual([]);

    await testCase.run();

    expect(calls).toEqual(['<cart-badge></cart-badge>']);
  });

  it('registers with an explicit runner without eagerly running the body', async () => {
    const calls: string[] = [];
    const registered: { name: string; run: () => Promise<void> }[] = [];
    const testCase = jisoTest(
      'cart page',
      async ({ page }) => {
        const result = await page('/cart');
        calls.push(result.fragment('cart-badge'));
      },
      {
        db: {},
        pages: {
          '/cart': '<fw-fragment target="cart-badge"><cart-badge></cart-badge></fw-fragment>',
        },
      },
      (name, run) => {
        registered.push({ name, run });
      },
    );

    expect(testCase.name).toBe('cart page');
    expect(registered).toHaveLength(1);
    expect(registered[0]?.name).toBe('cart page');
    expect(calls).toEqual([]);

    await registered[0]?.run();

    expect(calls).toEqual(['<cart-badge></cart-badge>']);
  });
});
