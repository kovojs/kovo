import { describe, expect, it } from 'vitest';

import { createJisoTestHarness } from './index.js';

describe('@jiso/test page assertions', () => {
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

  it('asserts explicitly wrapped fragments with normal HTML attribute variants', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart':
          "<fw-fragment strategy='morph' target='cart-badge'><cart-badge><span>1</span></cart-badge></fw-fragment>",
      },
    });

    await expect(harness.page('/cart').then((page) => page.fragment('cart-badge'))).resolves.toBe(
      '<cart-badge><span>1</span></cart-badge>',
    );
  });

  it('asserts explicitly wrapped fragments with nested fw-fragment children', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart': [
          '<fw-fragment target="cart-badge">',
          '<cart-badge><span>1</span><fw-fragment target="nested"><span>nested</span></fw-fragment></cart-badge>',
          '</fw-fragment>',
        ].join(''),
      },
    });

    await expect(harness.page('/cart').then((page) => page.fragment('cart-badge'))).resolves.toBe(
      '<cart-badge><span>1</span><fw-fragment target="nested"><span>nested</span></fw-fragment></cart-badge>',
    );
  });

  it('does not resolve fragments by fw-c stamps or same-tag fw-deps elements', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart':
          '<section fw-c=\'cart-badge\'><span>1</span></section><cart-form fw-deps="cart"><button>Add</button></cart-form>',
      },
    });

    const page = await harness.page('/cart');

    expect(page.fragment('cart-badge')).toBe('');
    expect(page.fragment('cart-form')).toBe('');
    expect(page.fragment('missing-target')).toBe('');
  });

  it('asserts runtime-style id and fw-fragment-target fragments', async () => {
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
  });

  it('asserts fragments whose opening attributes contain quoted angle brackets', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart':
          '<section id="cart-badge" data-label="1 > 0"><span>1</span><section>nested</section></section>',
      },
    });

    await expect(harness.page('/cart').then((page) => page.fragment('cart-badge'))).resolves.toBe(
      '<section id="cart-badge" data-label="1 > 0"><span>1</span><section>nested</section></section>',
    );
  });

  it('does not count same-tag text inside quoted attributes as fragment nesting', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart':
          '<section id="cart-badge" data-template="<section>not real</section>"><span>1</span></section>',
      },
    });

    await expect(harness.page('/cart').then((page) => page.fragment('cart-badge'))).resolves.toBe(
      '<section id="cart-badge" data-template="<section>not real</section>"><span>1</span></section>',
    );
  });

  it('asserts id fragment targets with nested same-tag children', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart':
          '<section id="cart-badge"><section class="inner"><span>1</span></section><p>done</p></section>',
      },
    });

    await expect(harness.page('/cart').then((page) => page.fragment('cart-badge'))).resolves.toBe(
      '<section id="cart-badge"><section class="inner"><span>1</span></section><p>done</p></section>',
    );
  });

  it('asserts fw-fragment-target fragments with nested same-tag children', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart':
          '<article fw-fragment-target="cart-badge"><article class="inner"><span>1</span></article><p>done</p></article>',
      },
    });

    await expect(harness.page('/cart').then((page) => page.fragment('cart-badge'))).resolves.toBe(
      '<article fw-fragment-target="cart-badge"><article class="inner"><span>1</span></article><p>done</p></article>',
    );
  });
});
