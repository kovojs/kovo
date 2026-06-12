import { describe, expect, it } from 'vitest';

import { createJisoTestHarness } from './index.js';
import { createPageAssertion } from './page.js';

describe('@jiso/test page assertions', () => {
  it('creates page assertions that preserve the rendered HTML', () => {
    const page = createPageAssertion(
      '<main><fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment></main>',
    );

    expect(page.html).toContain('<main>');
    expect(page.fragment('cart-badge')).toBe('<cart-badge>1</cart-badge>');
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

  it('asserts runtime-style id and fw-fragment-target fragments through harness pages', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart': [
          '<section id="cart-badge" fw-deps="cart"><span>1</span></section>',
          '<aside fw-fragment-target="cart-summary" fw-deps="cart"><span>2</span></aside>',
        ].join(''),
      },
    });

    const page = await harness.page('/cart');

    expect(page.fragment('cart-badge')).toBe(
      '<section id="cart-badge" fw-deps="cart"><span>1</span></section>',
    );
    expect(page.fragment('cart-summary')).toBe(
      '<aside fw-fragment-target="cart-summary" fw-deps="cart"><span>2</span></aside>',
    );
    expect(page.fragment('missing-target')).toBe('');
  });
});
