import { describe, expect, it } from 'vitest';

import { fragmentHtml, htmlElementFacts } from '@jiso/test/html-fragment';

describe('@jiso/test html fragment seam', () => {
  it('extracts explicit fragments without constructing a harness page assertion', () => {
    expect(
      fragmentHtml(
        '<main><fw-fragment target="cart-badge"><span>1</span></fw-fragment></main>',
        'cart-badge',
      ),
    ).toBe('<span>1</span>');
  });

  it('extracts SPEC §9.1 runtime targets by id and fw-fragment-target only', () => {
    const html = [
      '<section fw-c="cart-badge"><span>ignored</span></section>',
      '<section id="cart-badge"><span>1</span></section>',
      '<aside fw-fragment-target="cart-summary"><span>2</span></aside>',
    ].join('');

    expect(fragmentHtml(html, 'cart-badge')).toBe(
      '<section id="cart-badge"><span>1</span></section>',
    );
    expect(fragmentHtml(html, 'cart-summary')).toBe(
      '<aside fw-fragment-target="cart-summary"><span>2</span></aside>',
    );
    expect(fragmentHtml(html, 'missing-target')).toBe('');
  });

  it('extracts explicitly wrapped fragments with normal HTML attribute variants', () => {
    expect(
      fragmentHtml(
        "<fw-fragment strategy='morph' target='cart-badge'><cart-badge><span>1</span></cart-badge></fw-fragment>",
        'cart-badge',
      ),
    ).toBe('<cart-badge><span>1</span></cart-badge>');
  });

  it('extracts explicitly wrapped fragments with nested fw-fragment children', () => {
    expect(
      fragmentHtml(
        [
          '<fw-fragment target="cart-badge">',
          '<cart-badge><span>1</span><fw-fragment target="nested"><span>nested</span></fw-fragment></cart-badge>',
          '</fw-fragment>',
        ].join(''),
        'cart-badge',
      ),
    ).toBe(
      '<cart-badge><span>1</span><fw-fragment target="nested"><span>nested</span></fw-fragment></cart-badge>',
    );
  });

  it('does not resolve fragments by fw-c stamps or same-tag fw-deps elements', () => {
    const html =
      '<section fw-c=\'cart-badge\'><span>1</span></section><cart-form fw-deps="cart"><button>Add</button></cart-form>';

    expect(fragmentHtml(html, 'cart-badge')).toBe('');
    expect(fragmentHtml(html, 'cart-form')).toBe('');
    expect(fragmentHtml(html, 'missing-target')).toBe('');
  });

  it.each([
    [
      'opening attributes contain quoted angle brackets',
      '<section id="cart-badge" data-label="1 > 0"><span>1</span><section>nested</section></section>',
    ],
    [
      'same-tag text appears inside quoted attributes',
      '<section id="cart-badge" data-template="<section>not real</section>"><span>1</span></section>',
    ],
    [
      'id targets contain nested same-tag children',
      '<section id="cart-badge"><section class="inner"><span>1</span></section><p>done</p></section>',
    ],
    [
      'fw-fragment-target targets contain nested same-tag children',
      '<article fw-fragment-target="cart-badge"><article class="inner"><span>1</span></article><p>done</p></article>',
    ],
  ])('extracts fragment targets when %s', (_name, html) => {
    expect(fragmentHtml(html, 'cart-badge')).toBe(html);
  });

  it('returns structured element facts with normalized attributes and inner HTML', () => {
    expect(
      htmlElementFacts(
        [
          '<main data-shell="cart">',
          '<a HREF="/cart" data-active>Cart</a>',
          '<a href="/products">Products</a>',
          '<link rel="stylesheet" href="/assets/tailwind.css">',
          '</main>',
        ].join(''),
        { tag: 'a', attrs: { href: '/cart', 'data-active': true } },
      ),
    ).toEqual([
      {
        attrs: {
          'data-active': '',
          href: '/cart',
        },
        html: '<a HREF="/cart" data-active>Cart</a>',
        innerHtml: 'Cart',
        tag: 'a',
      },
    ]);
  });

  it('represents void elements as complete facts', () => {
    expect(
      htmlElementFacts(
        '<head><link rel="stylesheet" href="/assets/tailwind.css"><meta name="description" content="Cart"></head>',
        { attrs: { href: '/assets/tailwind.css' }, tag: 'link' },
      ),
    ).toEqual([
      {
        attrs: {
          href: '/assets/tailwind.css',
          rel: 'stylesheet',
        },
        html: '<link rel="stylesheet" href="/assets/tailwind.css">',
        innerHtml: '',
        tag: 'link',
      },
    ]);
  });
});
