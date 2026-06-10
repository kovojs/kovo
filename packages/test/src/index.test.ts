import { describe, expect, it } from 'vitest';

import { mutation, s } from '@jiso/server';

import { createJisoTestHarness, jisoTest } from './index.js';

describe('@jiso/test harness', () => {
  it('executes mutations against the provided db context', async () => {
    const addToCart = mutation('cart/add', {
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

  it('asserts fragments from rendered HTML without a browser', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart':
          '<html><body><fw-fragment target="cart-badge"><cart-badge fw-deps="cart"><span data-bind="cart.count">1</span></cart-badge></fw-fragment></body></html>',
      },
    });

    await expect(harness.page('/cart')).resolves.toMatchObject({
      html: expect.stringContaining('cart-badge'),
    });
    await expect(
      harness.page('/cart').then((page) => page.fragment('cart-badge')),
    ).resolves.toContain('data-bind="cart.count"');
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
      ),
    ).resolves.toBeUndefined();
  });
});
