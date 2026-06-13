import { describe, expect, it } from 'vitest';

import {
  fragmentHtml,
  fwFragmentFacts,
  fwQueryFacts,
  htmlElementFacts,
} from '@jiso/test/html-fragment';

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

  it('returns structured framework query facts for element and script carriers', () => {
    const html = [
      '<fw-query name="cart" key="cart:c1" version="7">{"count":2}</fw-query>',
      '<script type="application/json" fw-query="productGrid">{"items":[{"id":"p1"}]}</script>',
    ].join('');

    expect(fwQueryFacts(html)).toEqual([
      {
        attrs: {
          key: 'cart:c1',
          name: 'cart',
          version: '7',
        },
        html: '<fw-query name="cart" key="cart:c1" version="7">{"count":2}</fw-query>',
        json: { count: 2 },
        name: 'cart',
        rawJson: '{"count":2}',
        tag: 'fw-query',
      },
      {
        attrs: {
          'fw-query': 'productGrid',
          type: 'application/json',
        },
        html: '<script type="application/json" fw-query="productGrid">{"items":[{"id":"p1"}]}</script>',
        json: { items: [{ id: 'p1' }] },
        name: 'productGrid',
        rawJson: '{"items":[{"id":"p1"}]}',
        tag: 'script',
      },
    ]);
    expect(fwQueryFacts(html, 'cart').map((fact) => fact.json)).toEqual([{ count: 2 }]);
  });

  it('returns structured framework fragment facts with nested stylesheet hints', () => {
    const html = [
      '<fw-fragment target="cart-badge"><cart-badge><span>2</span></cart-badge></fw-fragment>',
      '<fw-fragment target="product-grid" error-boundary="product-grid">',
      '<link rel="stylesheet" href="/assets/tailwind.css">',
      '<section><article fw-key="p1">Mug</article></section>',
      '</fw-fragment>',
    ].join('');

    expect(fwFragmentFacts(html).map((fact) => fact.target)).toEqual([
      'cart-badge',
      'product-grid',
    ]);
    expect(fwFragmentFacts(html, 'product-grid')).toEqual([
      {
        attrs: {
          'error-boundary': 'product-grid',
          target: 'product-grid',
        },
        html: '<fw-fragment target="product-grid" error-boundary="product-grid"><link rel="stylesheet" href="/assets/tailwind.css"><section><article fw-key="p1">Mug</article></section></fw-fragment>',
        innerHtml:
          '<link rel="stylesheet" href="/assets/tailwind.css"><section><article fw-key="p1">Mug</article></section>',
        stylesheetHrefs: ['/assets/tailwind.css'],
        target: 'product-grid',
      },
    ]);
  });
});
