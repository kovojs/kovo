import { describe, expect, it } from 'vitest';

import { jisoTest } from './index.js';

describe('@jiso/test case wrapper', () => {
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
