import { describe, expect, it } from 'vitest';

import { createJisoTestHarness } from '@jiso/test';
import type { TouchGraph } from '@jiso/drizzle';

import { addToCart, commerceTouchGraph, createCommerceDb, renderCartPage } from './app.js';

describe('commerce example', () => {
  it('executes addToCart and verifies rendered cart badge without a browser', async () => {
    const harness = createJisoTestHarness({
      db: createCommerceDb(),
      pages: {
        '/cart': renderCartPage,
      },
      touchGraph: commerceTouchGraph as unknown as TouchGraph,
      verification: {
        domainByTable: {
          cart_items: 'cart',
          products: 'product',
        },
      },
    });

    await expect(harness.exec(addToCart, { productId: 'p1', quantity: 2 })).resolves.toMatchObject({
      changes: [
        { domain: 'cart', input: { productId: 'p1', quantity: 2 } },
        { domain: 'product', input: { productId: 'p1', quantity: 2 } },
      ],
      ok: true,
      rerunQueries: ['cart'],
    });
    await expect(
      harness.page('/cart').then((page) => page.fragment('cart-badge')),
    ).resolves.toContain('data-bind="cart.count"');
  });
});
