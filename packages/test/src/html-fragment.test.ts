import { describe, expect, it } from 'vitest';

import {
  fragmentHtml,
  kovoQueryJsonValues,
  htmlDocumentFacts,
  htmlElementCount,
  htmlElementFacts,
  htmlFormActions,
  htmlFormFacts,
  htmlFormFieldsByName,
  htmlFormFields,
  htmlKeyValues,
  htmlTextContent,
  documentQueryScriptBehaviorFact,
  kovoFragmentFacts,
  kovoQueryFacts,
  kovoResponseBodyFact,
  htmlDocumentRegions,
  htmlJsonScriptFacts,
  htmlKeyFacts,
  htmlKeyTextMap,
  htmlLinkHrefs,
  htmlMainMarkerFact,
} from '@kovojs/test/html-fragment';

describe('@kovojs/test html fragment seam', () => {
  it('extracts explicit fragments without constructing a harness page assertion', () => {
    expect(
      fragmentHtml(
        '<main><kovo-fragment target="cart-badge"><span>1</span></kovo-fragment></main>',
        'cart-badge',
      ),
    ).toBe('<span>1</span>');
  });

  it('extracts SPEC §9.1 runtime targets by id and kovo-fragment-target only', () => {
    const html = [
      '<section kovo-c="cart-badge"><span>ignored</span></section>',
      '<section id="cart-badge"><span>1</span></section>',
      '<aside kovo-fragment-target="cart-summary"><span>2</span></aside>',
    ].join('');

    expect(fragmentHtml(html, 'cart-badge')).toBe(
      '<section id="cart-badge"><span>1</span></section>',
    );
    expect(fragmentHtml(html, 'cart-summary')).toBe(
      '<aside kovo-fragment-target="cart-summary"><span>2</span></aside>',
    );
    expect(fragmentHtml(html, 'missing-target')).toBe('');
  });

  it('extracts explicitly wrapped fragments with normal HTML attribute variants', () => {
    expect(
      fragmentHtml(
        "<kovo-fragment strategy='morph' target='cart-badge'><cart-badge><span>1</span></cart-badge></kovo-fragment>",
        'cart-badge',
      ),
    ).toBe('<cart-badge><span>1</span></cart-badge>');
  });

  it('extracts explicitly wrapped fragments with nested kovo-fragment children', () => {
    expect(
      fragmentHtml(
        [
          '<kovo-fragment target="cart-badge">',
          '<cart-badge><span>1</span><kovo-fragment target="nested"><span>nested</span></kovo-fragment></cart-badge>',
          '</kovo-fragment>',
        ].join(''),
        'cart-badge',
      ),
    ).toBe(
      '<cart-badge><span>1</span><kovo-fragment target="nested"><span>nested</span></kovo-fragment></cart-badge>',
    );
  });

  it('does not resolve fragments by kovo-c stamps or same-tag kovo-deps elements', () => {
    const html =
      '<section kovo-c=\'cart-badge\'><span>1</span></section><cart-form kovo-deps="cart"><button>Add</button></cart-form>';

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
      'kovo-fragment-target targets contain nested same-tag children',
      '<article kovo-fragment-target="cart-badge"><article class="inner"><span>1</span></article><p>done</p></article>',
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
          '<link rel="stylesheet" href="/assets/styles.css">',
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

  it('counts selected elements without commerce-local query selectors', () => {
    expect(
      htmlElementCount(
        [
          '<div data-commerce-shell="cart">Cart</div>',
          '<div data-commerce-shell="cart">Duplicate</div>',
          '<div data-commerce-shell="admin">Admin</div>',
        ].join(''),
        { attrs: { 'data-commerce-shell': 'cart' }, tag: 'div' },
      ),
    ).toBe(2);
  });

  it('represents void elements as complete facts', () => {
    expect(
      htmlElementFacts(
        '<head><link rel="stylesheet" href="/assets/styles.css"><meta name="description" content="Cart"></head>',
        { attrs: { href: '/assets/styles.css' }, tag: 'link' },
      ),
    ).toEqual([
      {
        attrs: {
          href: '/assets/styles.css',
          rel: 'stylesheet',
        },
        html: '<link rel="stylesheet" href="/assets/styles.css">',
        innerHtml: '',
        tag: 'link',
      },
    ]);
  });

  it('returns document-level facts for metadata, links, JSON scripts, and visible text', () => {
    const html = [
      '<!doctype html><html lang="en"><head>',
      '<title>Cart &amp; Checkout</title>',
      '<meta name="description" content="Ready cart">',
      '<link rel="modulepreload" href="/c/app.js">',
      '<link rel="stylesheet" href="/assets/styles.css">',
      '<script type="application/json" kovo-i18n locale="en-US">{"cartLabel":"Cart"}</script>',
      '</head><body class="page-shell"><main>Sign in <strong>ready</strong></main></body></html>',
    ].join('');

    expect(htmlDocumentFacts(html)).toMatchObject({
      bodyAttrs: { class: 'page-shell' },
      jsonScripts: [
        {
          attrs: { 'kovo-i18n': '', locale: 'en-US', type: 'application/json' },
          json: { cartLabel: 'Cart' },
          rawJson: '{"cartLabel":"Cart"}',
        },
      ],
      links: [
        { attrs: { href: '/c/app.js', rel: 'modulepreload' }, tag: 'link' },
        { attrs: { href: '/assets/styles.css', rel: 'stylesheet' }, tag: 'link' },
      ],
      metas: [{ attrs: { content: 'Ready cart', name: 'description' }, tag: 'meta' }],
      text: 'Sign in ready',
      title: 'Cart & Checkout',
    });
    expect(htmlJsonScriptFacts(html, { 'kovo-i18n': true }).map((script) => script.json)).toEqual([
      { cartLabel: 'Cart' },
    ]);
  });

  it('returns required document regions and link hrefs without local parsers', () => {
    const html = [
      '<!doctype html><html lang="en"><head>',
      '<meta charset="utf-8">',
      '<link rel="modulepreload" href="/c/app.js">',
      '<link rel="stylesheet" href="/assets/styles.css">',
      '</head><body class="page"><main>Ready</main></body></html>',
    ].join('');

    expect(htmlDocumentRegions(html)).toMatchObject({
      body: { attrs: { class: 'page' }, tag: 'body' },
      head: { tag: 'head' },
      html: { attrs: { lang: 'en' }, tag: 'html' },
    });
    expect(
      htmlElementFacts(htmlDocumentRegions(html).body.innerHtml).map((item) => item.tag),
    ).toEqual(['main']);
    expect(htmlLinkHrefs(html, { rel: 'modulepreload' })).toEqual(['/c/app.js']);
    expect(htmlLinkHrefs(html, { rel: 'stylesheet' })).toEqual(['/assets/styles.css']);
  });

  it('rejects malformed document region probes with a useful count summary', () => {
    expect(() => htmlDocumentRegions('<main>Fragment</main>')).toThrow(
      'Expected one html/head/body document region; found html=0 head=0 body=0',
    );
  });

  it('projects document query-script behavior without local kovo-check HTML mechanics', () => {
    const queryScript =
      '<script type="application/json" kovo-query="cart" key="cart:c1">{"html":"\\u003c/script>"}</script>';
    const document = [
      '<!doctype html><html><head>',
      queryScript,
      '</head><body><main></main></body></html>',
    ].join('');

    expect(
      documentQueryScriptBehaviorFact(document, {
        queryName: 'cart',
        renderedDocumentQueryScript: queryScript,
        renderedQueryScript: queryScript,
      }),
    ).toEqual({
      bodyElements: [{ attrs: {}, html: '<main></main>', innerHtml: '', tag: 'main' }],
      bodyQueryScripts: [],
      documentQueryScripts: [
        {
          attrs: {
            'kovo-query': 'cart',
            key: 'cart:c1',
            type: 'application/json',
          },
          rawJson: '{"html":"\\u003c/script>"}',
        },
      ],
      headQueryScripts: [
        {
          attrs: {
            'kovo-query': 'cart',
            key: 'cart:c1',
            type: 'application/json',
          },
          rawJson: '{"html":"\\u003c/script>"}',
        },
      ],
      renderedDocumentQueryScript: queryScript,
      renderedQueryScript: queryScript,
    });
  });

  it('projects static export main marker facts without local kovo-check HTML mechanics', () => {
    expect(
      htmlMainMarkerFact(
        '<!doctype html><html><body><main data-kovo-check-export="cli">Ready</main></body></html>',
      ),
    ).toEqual({
      attribute: 'data-kovo-check-export',
      mainCount: 1,
      marker: 'cli',
    });
    expect(
      htmlMainMarkerFact('<main data-commerce-shell="checkout"></main>', 'data-commerce-shell'),
    ).toEqual({
      attribute: 'data-commerce-shell',
      mainCount: 1,
      marker: 'checkout',
    });
    expect(htmlMainMarkerFact('<section>No main</section>')).toEqual({
      attribute: 'data-kovo-check-export',
      mainCount: 0,
      marker: undefined,
    });
  });

  it('returns structured framework query facts for element and script carriers', () => {
    const html = [
      '<kovo-query name="cart" key="cart:c1" version="7">{"count":2}</kovo-query>',
      '<script type="application/json" kovo-query="productGrid">{"items":[{"id":"p1"}]}</script>',
    ].join('');

    expect(kovoQueryFacts(html)).toEqual([
      {
        attrs: {
          key: 'cart:c1',
          name: 'cart',
          version: '7',
        },
        html: '<kovo-query name="cart" key="cart:c1" version="7">{"count":2}</kovo-query>',
        json: { count: 2 },
        name: 'cart',
        rawJson: '{"count":2}',
        tag: 'kovo-query',
      },
      {
        attrs: {
          'kovo-query': 'productGrid',
          type: 'application/json',
        },
        html: '<script type="application/json" kovo-query="productGrid">{"items":[{"id":"p1"}]}</script>',
        json: { items: [{ id: 'p1' }] },
        name: 'productGrid',
        rawJson: '{"items":[{"id":"p1"}]}',
        tag: 'script',
      },
    ]);
    expect(kovoQueryFacts(html, 'cart').map((fact) => fact.json)).toEqual([{ count: 2 }]);
  });

  it('keeps adjacent inline and JSON scripts as separate raw-text facts', () => {
    const html = [
      '<head>',
      '<script>const closing = "</" + "script>";</script>',
      '<script type="application/json" kovo-query="cart">{"count":2}</script>',
      '</head>',
    ].join('');

    expect(htmlElementFacts(html, { tag: 'script' }).map((script) => script.attrs)).toEqual([
      {},
      { 'kovo-query': 'cart', type: 'application/json' },
    ]);
    expect(kovoQueryFacts(html, 'cart')).toMatchObject([
      {
        attrs: { 'kovo-query': 'cart', type: 'application/json' },
        json: { count: 2 },
        name: 'cart',
        rawJson: '{"count":2}',
        tag: 'script',
      },
    ]);
  });

  it('returns structured framework fragment facts with nested stylesheet hints', () => {
    const html = [
      '<kovo-fragment target="cart-badge"><cart-badge><span>2</span></cart-badge></kovo-fragment>',
      '<kovo-fragment target="product-grid" error-boundary="product-grid">',
      '<link rel="stylesheet" href="/assets/styles.css">',
      '<section><article kovo-key="p1">Mug</article></section>',
      '</kovo-fragment>',
    ].join('');

    expect(kovoFragmentFacts(html).map((fact) => fact.target)).toEqual([
      'cart-badge',
      'product-grid',
    ]);
    expect(kovoFragmentFacts(html, 'product-grid')).toEqual([
      {
        attrs: {
          'error-boundary': 'product-grid',
          target: 'product-grid',
        },
        html: '<kovo-fragment target="product-grid" error-boundary="product-grid"><link rel="stylesheet" href="/assets/styles.css"><section><article kovo-key="p1">Mug</article></section></kovo-fragment>',
        innerHtml:
          '<link rel="stylesheet" href="/assets/styles.css"><section><article kovo-key="p1">Mug</article></section>',
        stylesheetHrefs: ['/assets/styles.css'],
        target: 'product-grid',
      },
    ]);
  });

  it('summarizes framework response bodies without commerce-local fixture parsing', () => {
    const html = [
      '<kovo-query name="cart">{"count":2}</kovo-query>',
      '<kovo-query name="productGrid">{"items":[{"id":"p1"}]}</kovo-query>',
      '<kovo-fragment target="cart-badge"><cart-badge><span>2</span></cart-badge></kovo-fragment>',
      '<kovo-fragment target="product-grid">',
      '<link rel="stylesheet" href="/assets/styles.css">',
      '<section><article kovo-key="p1">Mug</article></section>',
      '</kovo-fragment>',
    ].join('');

    expect(kovoResponseBodyFact(html)).toMatchObject({
      fragmentTargets: ['cart-badge', 'product-grid'],
      keyValues: ['p1'],
      queryJsonByName: {
        cart: [{ count: 2 }],
        productGrid: [{ items: [{ id: 'p1' }] }],
      },
      queryNames: ['cart', 'productGrid'],
      stylesheetHrefsByTarget: {
        'cart-badge': [],
        'product-grid': ['/assets/styles.css'],
      },
    });
    expect(kovoQueryJsonValues(html, 'cart')).toEqual([{ count: 2 }]);
    expect(kovoQueryJsonValues(html, 'missing')).toEqual([]);
  });

  it('returns structured form facts with named controls', () => {
    expect(
      htmlFormFacts(
        [
          '<form method="post" action="/_m/cart/add" enhance data-mutation="cart/add">',
          '<input name="productId" value="p1">',
          '<input name="quantity" type="number" min="1" max="5" value="1">',
          '<textarea name="note">gift wrap</textarea>',
          '<button type="submit">Add</button>',
          '</form>',
        ].join(''),
      ),
    ).toEqual([
      {
        action: '/_m/cart/add',
        attrs: {
          action: '/_m/cart/add',
          'data-mutation': 'cart/add',
          enhance: '',
          method: 'post',
        },
        fields: [
          {
            attrs: { name: 'productId', value: 'p1' },
            html: '<input name="productId" value="p1">',
            name: 'productId',
            tag: 'input',
            type: '',
            value: 'p1',
          },
          {
            attrs: {
              max: '5',
              min: '1',
              name: 'quantity',
              type: 'number',
              value: '1',
            },
            html: '<input name="quantity" type="number" min="1" max="5" value="1">',
            name: 'quantity',
            tag: 'input',
            type: 'number',
            value: '1',
          },
          {
            attrs: { name: 'note' },
            html: '<textarea name="note">gift wrap</textarea>',
            name: 'note',
            tag: 'textarea',
            type: '',
            value: 'gift wrap',
          },
        ],
        html: '<form method="post" action="/_m/cart/add" enhance data-mutation="cart/add"><input name="productId" value="p1"><input name="quantity" type="number" min="1" max="5" value="1"><textarea name="note">gift wrap</textarea><button type="submit">Add</button></form>',
        innerHtml:
          '<input name="productId" value="p1"><input name="quantity" type="number" min="1" max="5" value="1"><textarea name="note">gift wrap</textarea><button type="submit">Add</button>',
        method: 'post',
      },
    ]);
    expect(
      htmlFormActions(
        '<form method="post" action="/_m/cart/add"><input name="productId" value="p1"></form>',
      ),
    ).toEqual(['/_m/cart/add']);
    expect(
      htmlFormFields(
        [
          '<form method="post" action="/_m/cart/add">',
          '<input name="productId" value="p1">',
          '<input name="quantity" value="2">',
          '</form>',
        ].join(''),
        'quantity',
      ),
    ).toMatchObject([{ name: 'quantity', value: '2' }]);
    expect(
      htmlFormFieldsByName(
        htmlFormFacts(
          '<form><input name="productId" value="p1"><input name="quantity" value="2"></form>',
        )[0],
      ),
    ).toMatchObject({
      productId: { value: 'p1' },
      quantity: { value: '2' },
    });
  });

  it('returns keyed framework element facts with normalized text', () => {
    const html = [
      '<section>',
      '<article kovo-key="p1"><h2>Coffee &amp; mug</h2><span>3 in stock</span></article>',
      '<article kovo-key="p2"><span>Tea</span><span>&#36;25</span></article>',
      '</section>',
    ].join('');

    expect(htmlKeyFacts(html)).toMatchObject([
      {
        key: 'p1',
        tag: 'article',
        text: 'Coffee & mug3 in stock',
      },
      {
        key: 'p2',
        tag: 'article',
        text: 'Tea$25',
      },
    ]);
    expect(htmlKeyFacts('<li kovo-key="order-1">Order</li>', 'order-1')).toMatchObject([
      { key: 'order-1', text: 'Order' },
    ]);
    expect(htmlKeyValues(html)).toEqual(['p1', 'p2']);
    expect(htmlKeyTextMap(html)).toEqual({
      p1: 'Coffee & mug3 in stock',
      p2: 'Tea$25',
    });
  });

  it('normalizes HTML text content outside raw markup assertions', () => {
    expect(
      htmlTextContent('<p>Only <strong>2</strong> available &amp; ready.</p><span>&#x24;25</span>'),
    ).toBe('Only 2 available & ready.$25');
  });
});
