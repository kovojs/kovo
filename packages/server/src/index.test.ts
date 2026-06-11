import { describe, expect, it } from 'vitest';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';

import {
  domain,
  errorBoundary,
  guards,
  i18n,
  invalidate,
  meta,
  metaFromQuery,
  mutation,
  mutationWireRequestFromHeaders,
  query,
  createMemoryMutationReplayStore,
  readMutationWireHeaders,
  renderDeferredStream,
  renderPageHints,
  renderMutationEndpointResponse,
  renderMutationResponse,
  renderNoJsMutationResponse,
  renderQueryScript,
  runMutation,
  s,
  session,
  stylesheetsForTargets,
  t,
  tag,
  type ChangeRecord,
} from './index.js';

describe('server mutation primitives', () => {
  it('renders modulepreloads, opt-in speculation rules, and Early Hints headers', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart.client.js', '/c/cart.client.js', '/c/recs.client.js'],
        prefetch: 'conservative',
        prerenderUrls: ['/cart', '/checkout'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</c/cart.client.js>; rel=modulepreload, </c/recs.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/cart.client.js">',
        '<link rel="modulepreload" href="/c/recs.client.js">',
        '<script type="speculationrules">{"prerender":[{"eagerness":"conservative","urls":["/cart","/checkout"]}]}</script>',
      ].join(''),
    });
  });

  it('renders and preloads the generated app bootstrap script', () => {
    expect(
      renderPageHints({
        bootstrapScript: '/c/generated/app.client.js',
        modulepreloads: ['/c/cart.client.js', '/c/generated/app.client.js'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</c/cart.client.js>; rel=modulepreload, </c/generated/app.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/cart.client.js">',
        '<link rel="modulepreload" href="/c/generated/app.client.js">',
        '<script type="module" src="/c/generated/app.client.js"></script>',
      ].join(''),
    });
  });

  it('reads enhanced mutation wire headers case-insensitively', () => {
    expect(
      readMutationWireHeaders({
        'fw-fragment': 'true',
        'FW-Idem': ' idem_01HX ',
        'FW-Targets': 'cart-badge=cart; recommendations=product:p1, cart-badge=cart',
      }),
    ).toEqual({
      fragment: true,
      idem: 'idem_01HX',
      targets: ['cart-badge', 'recommendations'],
    });
  });

  it('builds mutation wire requests from iterable HTTP headers', () => {
    const replayStore = createMemoryMutationReplayStore();

    expect(
      mutationWireRequestFromHeaders({
        headers: new Map([
          ['FW-Fragment', 'true'],
          ['FW-Idem', 'idem_01HY'],
          ['FW-Targets', 'product-form:p1'],
        ]),
        rawInput: { productId: 'p1', quantity: 99 },
        replayStore,
        request: { sessionId: 's1' },
      }),
    ).toEqual({
      fragment: true,
      idem: 'idem_01HY',
      rawInput: { productId: 'p1', quantity: 99 },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['product-form:p1'],
    });
  });

  it('routes mutation endpoints without FW-Fragment through the no-JS POST redirect', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {},
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/cart',
      },
      status: 303,
    });
  });

  it('routes mutation endpoints with FW-Fragment through enhanced fragment wire responses', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        fragmentRenderers: [{ render: () => '<cart-badge>1</cart-badge>', target: 'cart-badge' }],
        headers: {
          'FW-Fragment': 'true',
          'FW-Targets': 'cart-badge',
        },
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: [
        '<fw-query name="cart">{"count":1}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
      ].join('\n'),
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 200,
    });
  });

  it('rerenders only matching keyed query instances in enhanced mutation responses', async () => {
    const product = domain('product');
    const productP1 = query('productDetail', {
      instanceKey: 'product:p1',
      load: () => ({ id: 'p1', stock: 0 }),
      reads: [product],
    });
    const productP2 = query('productDetail', {
      instanceKey: 'product:p2',
      load: () => ({ id: 'p2', stock: 10 }),
      reads: [product],
    });
    const reserveProduct = mutation('product/reserve', {
      input: s.object({ productId: s.string() }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [productP1, productP2],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(reserveProduct, {
        fragmentRenderers: [],
        headers: {
          'FW-Fragment': 'true',
        },
        rawInput: { productId: 'p1' },
        redirectTo: '/products/p1',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '<fw-query name="productDetail" key="product:p1">{"id":"p1","stock":0}</fw-query>',
      status: 200,
    });
  });

  it('routes mutation endpoint validation failures by request mode', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        failureTarget: 'cart-form',
        headers: { 'FW-Fragment': 'true' },
        rawInput: { productId: 'p1', quantity: 0 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="cart-form"><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 422,
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {},
        rawInput: { productId: 'p1', quantity: 0 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });

  it('renders stylesheet assets for Tailwind-first CSS delivery', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart.client.js'],
        stylesheets: [
          '/assets/tailwind.css',
          '/assets/tailwind.css',
          { href: '/assets/print.css', preload: false },
        ],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/tailwind.css>; rel=preload; as=style, </c/cart.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="stylesheet" href="/assets/tailwind.css">',
        '<link rel="stylesheet" href="/assets/print.css">',
        '<link rel="modulepreload" href="/c/cart.client.js">',
      ].join(''),
    });
  });

  it('inlines critical component CSS without losing stylesheet identity', () => {
    expect(
      renderPageHints({
        stylesheets: [
          '/assets/components/cart/cart-badge.css',
          {
            criticalCss: 'cart-badge { color: teal; }</style> cart-badge { display: block; }',
            href: '/assets/components/cart/cart-badge.css',
          },
        ],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/components/cart/cart-badge.css>; rel=preload; as=style',
      },
      html: [
        '<style data-jiso-critical-href="/assets/components/cart/cart-badge.css">cart-badge { color: teal; }<\\/style> cart-badge { display: block; }</style>',
        '<link rel="stylesheet" href="/assets/components/cart/cart-badge.css">',
      ].join(''),
    });
  });

  it('selects manifest stylesheets for pages and late fragments', () => {
    const manifest = [
      {
        criticalCss: 'cart-badge { color: teal; }',
        fragmentTargets: ['cart-badge'],
        href: '/assets/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
      {
        fragmentTargets: ['cart-drawer'],
        href: '/assets/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
      {
        fragmentTargets: ['cart-drawer'],
        href: '/assets/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ];

    expect(renderPageHints({ stylesheets: stylesheetsForTargets(manifest) })).toEqual({
      earlyHints: {
        Link: '</assets/components/cart/cart-badge.css>; rel=preload; as=style, </assets/components/cart/cart-drawer.css>; rel=preload; as=style',
      },
      html: [
        '<style data-jiso-critical-href="/assets/components/cart/cart-badge.css">cart-badge { color: teal; }</style>',
        '<link rel="stylesheet" href="/assets/components/cart/cart-badge.css">',
        '<link rel="stylesheet" href="/assets/components/cart/cart-drawer.css">',
      ].join(''),
    });
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [
              {
                html: '<cart-drawer>Ready</cart-drawer>',
                stylesheets: stylesheetsForTargets(manifest, ['cart-drawer']),
                target: 'cart-drawer',
              },
            ],
          },
        ],
        shell: '<!doctype html><html><body><fw-defer target="cart-drawer"></fw-defer>',
      }).body,
    ).toContain(
      '<fw-fragment target="cart-drawer"><link rel="stylesheet" href="/assets/components/cart/cart-drawer.css"><cart-drawer>Ready</cart-drawer></fw-fragment>',
    );
  });

  it('encodes Early Hints link targets without changing rendered hrefs', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart client.js?target=<badge>'],
        stylesheets: ['/assets/tailwind,print.css'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/tailwind%2Cprint.css>; rel=preload; as=style, </c/cart%20client.js?target=%3Cbadge%3E>; rel=modulepreload',
      },
      html: [
        '<link rel="stylesheet" href="/assets/tailwind,print.css">',
        '<link rel="modulepreload" href="/c/cart client.js?target=&lt;badge&gt;">',
      ].join(''),
    });
  });

  it('renders typed route meta with page hints', () => {
    const productMeta = meta({
      description: 'Fast cart <checkout>',
      image: '/products/p1.png',
      title: 'Cart & Checkout',
    });

    expect(
      renderPageHints({
        meta: productMeta,
        modulepreloads: ['/c/cart.client.js'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</c/cart.client.js>; rel=modulepreload',
      },
      html: [
        '<title>Cart &amp; Checkout</title>',
        '<meta name="description" content="Fast cart &lt;checkout&gt;">',
        '<meta property="og:description" content="Fast cart &lt;checkout&gt;">',
        '<meta property="og:image" content="/products/p1.png">',
        '<link rel="modulepreload" href="/c/cart.client.js">',
      ].join(''),
    });
  });

  it('derives typed route meta from query results', () => {
    const productQuery = query('product', {
      load: (_input: { id: string }) => ({
        id: 'p1',
        name: 'Coffee',
        stock: 5,
      }),
      reads: [domain('product')],
    });
    const eagerProductMeta = metaFromQuery(
      productQuery,
      productQuery.load({ id: 'p1' }),
      (product) => ({
        description: `${product.stock} available`,
        title: product.name,
      }),
    );
    const productMeta = metaFromQuery(productQuery, (product) => ({
      description: `${product.stock} available`,
      title: product.name,
    }));

    metaFromQuery(productQuery, productQuery.load({ id: 'p1' }), (product) => ({
      // @ts-expect-error query-derived meta can only use fields present in the query result.
      title: product.missingName,
    }));

    expect(renderPageHints({ meta: eagerProductMeta })).toEqual({
      earlyHints: {},
      html: [
        '<title>Coffee</title>',
        '<meta name="description" content="5 available">',
        '<meta property="og:description" content="5 available">',
      ].join(''),
    });
    expect(
      renderPageHints(
        { meta: productMeta },
        { queries: { product: { id: 'p2', name: 'Tea', stock: 3 } } },
      ),
    ).toEqual({
      earlyHints: {},
      html: [
        '<title>Tea</title>',
        '<meta name="description" content="3 available">',
        '<meta property="og:description" content="3 available">',
      ].join(''),
    });
    expect(() => renderPageHints({ meta: productMeta })).toThrow(
      'Missing query data for route meta: product',
    );
  });

  it('renders server-side i18n catalogs with page hints', () => {
    const en = i18n('en-US', {
      cartCount: 'Cart has {count} items',
      unsafe: 'Use <strong>server text</strong>',
    });

    expect(t(en, 'cartCount', { count: 3 })).toBe('Cart has 3 items');
    expect(t(en, 'cartCount')).toBe('Cart has {count} items');
    expect(renderPageHints({ i18n: en })).toEqual({
      earlyHints: {},
      html: '<script type="application/json" fw-i18n locale="en-US">{"cartCount":"Cart has {count} items","unsafe":"Use \\u003cstrong>server text\\u003c/strong>"}</script>',
    });
  });

  it('renders initial query scripts for document-load hydration', () => {
    expect(
      renderQueryScript({
        key: 'cart:c1',
        name: 'cart',
        value: {
          html: '</script><script>alert(1)</script>',
          items: [{ productId: 'p1', qty: 1 }],
        },
      }),
    ).toBe(
      '<script type="application/json" fw-query="cart" key="cart:c1">{"html":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>","items":[{"productId":"p1","qty":1}]}</script>',
    );
  });

  it('keeps speculation rules default-off for ordinary page hints', () => {
    expect(renderPageHints({ modulepreloads: ['/c/cart.client.js'] })).toEqual({
      earlyHints: { Link: '</c/cart.client.js>; rel=modulepreload' },
      html: '<link rel="modulepreload" href="/c/cart.client.js">',
    });
    expect(renderPageHints({ prefetch: false, prerenderUrls: ['/cart'] })).toEqual({
      earlyHints: {},
      html: '',
    });
    expect(renderPageHints({ prefetch: 'moderate', prerenderUrls: ['', ''] })).toEqual({
      earlyHints: {},
      html: '',
    });
  });

  it('renders moderate speculation rules with deduped escaped prerender urls only when opted in', () => {
    expect(
      renderPageHints({
        prefetch: 'moderate',
        prerenderUrls: ['/cart', '', '/cart', '/search?q=</script><x>'],
      }),
    ).toEqual({
      earlyHints: {},
      html: '<script type="speculationrules">{"prerender":[{"eagerness":"moderate","urls":["/cart","/search?q=\\u003c/script>\\u003cx>"]}]}</script>',
    });
  });

  it('renders deferred streams with shell first and query JSON before fragments', () => {
    expect(
      renderDeferredStream({
        closeHtml: '</body></html>',
        chunks: [
          {
            fragments: [
              {
                html: '<section fw-c="reviews" fw-deps="product:p1"><article data-key="r1">5</article></section>',
                target: 'reviews:p1',
              },
            ],
            queries: [
              { key: 'product:p1', name: 'reviews', value: { items: [{ id: 'r1', rating: 5 }] } },
            ],
          },
        ],
        shell:
          '<!doctype html>\n<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer></product-page></main>',
      }),
    ).toEqual({
      body: [
        '<!doctype html>\n<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer></product-page></main>',
        '--jiso-boundary',
        '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><section fw-c="reviews" fw-deps="product:p1"><article data-key="r1">5</article></section></fw-fragment>',
        '--jiso-boundary--',
        '</body></html>',
      ].join('\n'),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
      status: 200,
    });
  });

  it('matches the deferred stream wire fixture response byte-for-byte', async () => {
    const response = renderDeferredStream({
      closeHtml: '</body></html>',
      chunks: [
        {
          fragments: [
            {
              html: '<section fw-c="reviews" fw-deps="product:p1"><article data-key="r1">5</article></section>',
              priority: 5,
              stylesheets: ['/assets/reviews.css'],
              target: 'reviews:p1',
            },
            {
              html: '<section fw-c="recommendations" fw-deps="product:p1"><article data-key="rec-1">Beans</article></section>',
              target: 'recommendations:p1',
            },
          ],
          queries: [
            { key: 'product:p1', name: 'reviews', value: { items: [{ id: 'r1', rating: 5 }] } },
            { key: 'product:p1', name: 'recommendations', value: { items: [{ id: 'rec-1' }] } },
          ],
        },
      ],
      shell:
        '<!doctype html>\n<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer><fw-defer target="recommendations:p1" state="pending"></fw-defer></product-page></main>\n',
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/defer-stream.http', import.meta.url),
      'utf8',
    );

    expect(normalizeWireResponse(response, 'OK')).toEqual(readFixtureResponses(fixture).at(-1));
  });

  it('orders deferred stream chunks and fragments by priority while keeping query JSON first', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [{ html: '<section>low</section>', target: 'low' }],
            priority: 'low',
            queries: [{ name: 'lowQuery', value: { ready: true } }],
          },
          {
            fragments: [
              { html: '<section>normal</section>', target: 'normal' },
              { html: '<section>critical</section>', priority: 5, target: 'critical&details' },
            ],
            priority: 'high',
            queries: [{ name: 'criticalQuery', value: { ready: true } }],
          },
        ],
        shell: '<!doctype html><html><body><fw-defer target="critical&details"></fw-defer>',
      }),
    ).toEqual({
      body: [
        '<!doctype html><html><body><fw-defer target="critical&details"></fw-defer>',
        '--jiso-boundary',
        '<fw-query name="criticalQuery">{"ready":true}</fw-query>',
        '<fw-fragment target="critical&amp;details" priority="5"><section>critical</section></fw-fragment>',
        '<fw-fragment target="normal"><section>normal</section></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="lowQuery">{"ready":true}</fw-query>',
        '<fw-fragment target="low"><section>low</section></fw-fragment>',
        '--jiso-boundary--',
        '',
      ].join('\n'),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
      status: 200,
    });
  });

  it('renders explicit numeric deferred fragment priority hints including zero', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [{ html: '<section>normal</section>', priority: 0, target: 'normal' }],
            queries: [{ name: 'cart', value: { count: 1 } }],
          },
        ],
        closeHtml: '',
        shell: '<!doctype html><html><body><fw-defer target="normal"></fw-defer>',
      }).body,
    ).toBe(
      [
        '<!doctype html><html><body><fw-defer target="normal"></fw-defer>',
        '--jiso-boundary',
        '<fw-query name="cart">{"count":1}</fw-query>',
        '<fw-fragment target="normal" priority="0"><section>normal</section></fw-fragment>',
        '--jiso-boundary--',
        '',
      ].join('\n'),
    );
  });

  it('renders deferred append fragment mode for streamed pagination fragments', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [
              {
                html: '<article data-key="p3">Third</article>',
                mode: 'append',
                target: 'product-grid',
              },
            ],
          },
        ],
        closeHtml: '',
        shell: '<!doctype html><html><body><fw-defer target="product-grid"></fw-defer>',
      }).body,
    ).toBe(
      [
        '<!doctype html><html><body><fw-defer target="product-grid"></fw-defer>',
        '--jiso-boundary',
        '<fw-fragment target="product-grid" mode="append"><article data-key="p3">Third</article></fw-fragment>',
        '--jiso-boundary--',
        '',
      ].join('\n'),
    );
  });

  it('delivers late stylesheets with deferred fragments', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [
              {
                html: '<section class="reviews-card">Ready</section>',
                stylesheets: ['/assets/reviews.css', '/assets/reviews.css'],
                target: 'reviews:p1',
              },
            ],
          },
        ],
        shell: '<!doctype html><html><body><fw-defer target="reviews:p1"></fw-defer>',
      }).body,
    ).toContain(
      '<fw-fragment target="reviews:p1"><link rel="stylesheet" href="/assets/reviews.css"><section class="reviews-card">Ready</section></fw-fragment>',
    );
  });

  it('coerces FormData once through the declared schema', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.set('productId', 'p1');
    form.set('quantity', '2');

    await expect(runMutation(addToCart, form, {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: { productId: 'p1', quantity: 2 },
    });
  });

  it('coerces checkbox booleans and repeated FormData fields through declared schemas', async () => {
    const updatePreferences = mutation('preferences/update', {
      input: s.object({
        emailOptIn: s.boolean(),
        tags: s.array(s.string()),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.set('emailOptIn', 'on');
    form.append('tags', 'cart');
    form.append('tags', 'deals');

    await expect(runMutation(updatePreferences, form, {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: {
        emailOptIn: true,
        tags: ['cart', 'deals'],
      },
    });

    await expect(runMutation(updatePreferences, new FormData(), {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: {
        emailOptIn: false,
        tags: [],
      },
    });
  });

  it('treats single submitted values as one-item arrays', async () => {
    const filterProducts = mutation('products/filter', {
      input: s.object({
        categories: s.array(s.string()),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.set('categories', 'books');

    await expect(runMutation(filterProducts, form, {})).resolves.toMatchObject({
      ok: true,
      value: {
        categories: ['books'],
      },
    });
  });

  it('returns indexed validation paths for array schema errors', async () => {
    const bulkAdd = mutation('cart/bulk-add', {
      input: s.object({
        quantities: s.array(s.number().int().min(1)),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.append('quantities', '1');
    form.append('quantities', '0');

    await expect(runMutation(bulkAdd, form, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected number >= 1', path: ['quantities', '1'] }] },
      },
      ok: false,
      status: 422,
    });
  });

  it('coerces multipart file fields through s.file()', async () => {
    const uploadAvatar = mutation('profile/avatar', {
      input: s.object({
        avatar: s.file({ maxBytes: 16, mime: ['image/png'] }),
      }),
      handler(input) {
        return {
          name: input.avatar.name,
          size: input.avatar.size,
          type: input.avatar.type,
        };
      },
    });
    const form = new FormData();
    form.set('avatar', formDataFile(['avatar'], 'avatar.png', 'image/png'));

    await expect(runMutation(uploadAvatar, form, {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: {
        name: 'avatar.png',
        size: 6,
        type: 'image/png',
      },
    });
  });

  it('returns validation failures with field paths for schema errors', async () => {
    const uploadAvatar = mutation('profile/avatar', {
      input: s.object({
        avatar: s.file().maxBytes(4).mime(['image/png']),
      }),
      handler(input) {
        return input.avatar.name;
      },
    });
    const oversized = new FormData();
    oversized.set('avatar', formDataFile(['large'], 'avatar.png', 'image/png'));
    const wrongType = new FormData();
    wrongType.set('avatar', formDataFile(['ok'], 'avatar.txt', 'text/plain'));

    await expect(runMutation(uploadAvatar, new FormData(), {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected file', path: ['avatar'] }] },
      },
      ok: false,
      status: 422,
    });
    await expect(runMutation(uploadAvatar, oversized, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected file <= 4 bytes', path: ['avatar'] }] },
      },
      ok: false,
      status: 422,
    });
    await expect(runMutation(uploadAvatar, wrongType, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected file type image/png', path: ['avatar'] }] },
      },
      ok: false,
      status: 422,
    });
  });

  it('returns typed validation failures from ctx.fail', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1', quantity: 9 }, {})).resolves.toEqual({
      error: {
        code: 'OUT_OF_STOCK',
        payload: { availableQuantity: 0 },
      },
      ok: false,
      status: 422,
    });
  });

  it('composes guards with all()', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.all<{ authed: boolean }>((request) => request.authed),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, { productId: 'p1' }, { authed: false })).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
  });

  it('parses mutation input before running guards', async () => {
    let guardCalls = 0;
    const guarded = mutation('cart/add', {
      guard() {
        guardCalls += 1;
        return false;
      },
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, {}, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected string', path: ['productId'] }] },
      },
      ok: false,
      status: 422,
    });
    expect(guardCalls).toBe(0);
  });

  it('runs guarded mutation handlers inside the configured transaction', async () => {
    const events: string[] = [];
    const transactional = mutation('cart/add', {
      guard() {
        events.push('guard');
        return true;
      },
      input: s.object({ productId: s.string() }),
      async transaction(request: { tx?: boolean }, run) {
        events.push('begin');
        const value = await run({ ...request, tx: true });
        events.push('commit');
        return value;
      },
      handler(input, request: { tx?: boolean }) {
        events.push(`handler:${request.tx === true ? 'tx' : 'plain'}`);
        return input.productId;
      },
    });

    await expect(runMutation(transactional, { productId: 'p1' }, {})).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
    expect(events).toEqual(['guard', 'begin', 'handler:tx', 'commit']);
  });

  it('types transaction callbacks with the mutation request shape', async () => {
    interface TxRequest {
      db: {
        txOnly(): void;
        write(table: string): void;
      };
    }

    const events: string[] = [];
    const typeOnly = undefined as unknown as boolean;
    const transactional = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      transaction(request: TxRequest, run) {
        request.db.txOnly();
        if (typeOnly) {
          // @ts-expect-error transaction callbacks must receive the typed request shape.
          void run({ db: { write() {} } });
        }
        return run(request);
      },
      handler(input, request: TxRequest) {
        request.db.txOnly();
        request.db.write('cart_items');
        return input.productId;
      },
    });

    await expect(
      runMutation(
        transactional,
        { productId: 'p1' },
        {
          db: {
            txOnly() {
              events.push('tx');
            },
            write(table) {
              events.push(`write:${table}`);
            },
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
    expect(events).toEqual(['tx', 'tx', 'write:cart_items']);
  });

  it('rolls back configured transactions for typed mutation failures', async () => {
    const events: string[] = [];
    const transactional = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      async transaction(request: {}, run) {
        events.push('begin');
        try {
          return await run(request);
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
      handler(_input, _request, context) {
        events.push('handler');
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(runMutation(transactional, { productId: 'p1' }, {})).resolves.toEqual({
      error: {
        code: 'OUT_OF_STOCK',
        payload: { availableQuantity: 0 },
      },
      ok: false,
      status: 422,
    });
    expect(events).toEqual(['begin', 'handler', 'rollback']);
  });

  it('guards mutations by authenticated session user', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, { productId: 'p1' }, { session: null })).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { user: { id: 'u1' } } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
  });

  it('parses typed sessions through the declared schema', () => {
    const appSession = session(
      s.object({
        cartId: s.string(),
        userId: s.string(),
      }),
    );

    expect(appSession.parse({ session: { cartId: 'cart-1', userId: 'u1' } })).toEqual({
      cartId: 'cart-1',
      userId: 'u1',
    });
    expect(() => appSession.parse({})).toThrow('Expected object input');
  });

  it('guards mutations by session user role', async () => {
    const guarded = mutation('admin/refund', {
      guard: guards.role('admin'),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { user: { roles: ['staff'] } } }),
    ).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { user: { roles: ['admin'] } } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
  });

  it('rate-limits mutations by session by default', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.rateLimit({ max: 1, per: 'session' }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
    ).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { id: 's2' } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
  });

  it('derives post-commit rerun queries from declared touches', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        queries: [cartQuery, productQuery],
        touches: [cart],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'cart',
          input: { productId: 'p1' },
        },
      ],
      ok: true,
      rerunQueries: ['cart'],
      value: 'p1',
    });
  });

  it('renders mutation query chunks after the configured transaction commits', async () => {
    const state = { committed: 0, pending: 0 };
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: state.committed }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ quantity: s.number().int().min(1) }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      async transaction(request: {}, run) {
        const result = await run(request);
        state.committed = state.pending;
        return result;
      },
      handler(input) {
        state.pending += input.quantity;
        return input.quantity;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragment: true,
        rawInput: { quantity: 2 },
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '<fw-query name="cart">{"count":2}</fw-query>',
      status: 200,
    });
  });

  it('derives post-commit rerun queries from inferred touch sites when touches are absent or empty', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });

    const addToCartWithEmptyTouches = mutation('cart/add-empty', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
        touches: [],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCartWithEmptyTouches, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });
  });

  it('narrows post-commit rerun query instances by row keys', async () => {
    const product = domain('product');
    const productP1 = query('productDetail', { instanceKey: 'product:p1', reads: [product] });
    const productP2 = query('productDetail', { instanceKey: 'product:p2', reads: [product] });
    const reserveProduct = mutation('product/reserve', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [productP1, productP2],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(reserveProduct, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
      ],
      ok: true,
      rerunQueries: ['productDetail'],
      rerunQueryInstances: [{ instanceKey: 'product:p1', key: 'productDetail' }],
      value: 'p1',
    });
  });

  it('preserves manual invalidations when inferred touch sites are active', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
      },
      handler(input, _request, context) {
        context.invalidate(cart, {
          keys: [input.productId],
          reason: 'cart side effect',
        });
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
        {
          domain: 'cart',
          keys: ['p1'],
          manual: true,
          reason: 'cart side effect',
        },
      ],
      ok: true,
      rerunQueries: ['cart', 'product'],
      value: 'p1',
    });
  });

  it('keeps declared touches authoritative over inferred touch sites', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: null }],
        queries: [cartQuery, productQuery],
        touches: [cart],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'cart',
          input: { productId: 'p1' },
        },
      ],
      ok: true,
      rerunQueries: ['cart'],
      value: 'p1',
    });
  });

  it('uses flat tags as the low-ceremony domain on-ramp', async () => {
    const pricing = tag('pricing');
    const pricingQuery = query('pricing', { reads: [pricing] });
    const recalculate = mutation('pricing/recalculate', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [pricingQuery],
        touches: [pricing],
      },
      handler(input, _request, context) {
        context.invalidate(pricing, {
          keys: [input.productId],
          reason: 'external catalog feed',
        });
        return input.productId;
      },
    });

    await expect(runMutation(recalculate, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'pricing',
          input: { productId: 'p1' },
        },
        {
          domain: 'pricing',
          keys: ['p1'],
          manual: true,
          reason: 'external catalog feed',
        },
      ],
      ok: true,
      rerunQueries: ['pricing'],
      value: 'p1',
    });
    expect(invalidate(pricing, { reason: 'manual price import' })).toEqual({
      domain: 'pricing',
      manual: true,
      reason: 'manual price import',
    });
  });

  it('emits manual invalidate escape-hatch records from mutation context', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const syncInventory = mutation('inventory/sync', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery, productQuery],
      },
      handler(input, _request, context) {
        context.invalidate(product, {
          input,
          keys: [input.productId],
          reason: 'external inventory webhook',
        });
        return input.productId;
      },
    });

    await expect(runMutation(syncInventory, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
          manual: true,
          reason: 'external inventory webhook',
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });
  });

  it('creates standalone manual invalidate records for external systems', () => {
    const product = domain('product');

    expect(invalidate(product, { keys: ['p1'], reason: 'stripe webhook' })).toEqual({
      domain: 'product',
      keys: ['p1'],
      manual: true,
      reason: 'stripe webhook',
    });
  });

  it('types change records by domain key and invalidation input', () => {
    const cart = domain('cart');
    const record = invalidate(cart, {
      input: { cartId: 'c1', quantity: 2 },
      keys: ['c1'],
    });
    const typed = record satisfies ChangeRecord<'cart', { cartId: string; quantity: number }>;
    const assertWrongDomainRejected = () => {
      // @ts-expect-error cart invalidation records cannot satisfy the product domain.
      const wrongDomain: ChangeRecord<'product', { cartId: string; quantity: number }> = record;
      return wrongDomain;
    };
    const assertWrongInputRejected = () => {
      // @ts-expect-error sku is not part of the invalidation input payload.
      const wrongInput: ChangeRecord<'cart', { sku: string }> = record;
      return wrongInput;
    };

    expect(typed).toEqual({
      domain: 'cart',
      input: { cartId: 'c1', quantity: 2 },
      keys: ['c1'],
      manual: true,
    });
    expect(assertWrongDomainRejected).toBeTypeOf('function');
    expect(assertWrongInputRejected).toBeTypeOf('function');
  });

  it('renders enhanced mutation responses as query and fragment chunks', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      instanceKey: (input) => `cart:${(input as { cartId?: string }).cartId ?? 'c1'}`,
      load: () => ({ count: 1, items: [{ productId: 'p1', qty: 1, unitPrice: 1499 }] }),
      reads: [cart],
      version: 7,
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          {
            render: () =>
              '<cart-badge fw-deps="cart"><button commandfor="cart-drawer" command="show-modal"><span data-bind="cart.count">1</span></button></cart-badge>',
            target: 'cart-badge',
          },
          {
            render: () => '<section fw-c="recommendations" fw-deps="product:p1"></section>',
            target: 'recommendations',
          },
        ],
        rawInput: { cartId: 'c1', productId: 'p1' },
        request: {},
        targets: ['cart-badge', 'recommendations'],
      }),
    ).resolves.toEqual({
      body: [
        '<fw-query name="cart" key="cart:c1" version="7">{"count":1,"items":[{"productId":"p1","qty":1,"unitPrice":1499}]}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge fw-deps="cart"><button commandfor="cart-drawer" command="show-modal"><span data-bind="cart.count">1</span></button></cart-badge></fw-fragment>',
        '<fw-fragment target="recommendations"><section fw-c="recommendations" fw-deps="product:p1"></section></fw-fragment>',
      ].join('\n'),
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"cart","input":{"productId":"p1"}}]',
      },
      status: 200,
    });
  });

  it('renders append fragment mode for pagination fragments', async () => {
    const product = domain('product');
    const productQuery = query('productGrid', {
      load: () => ({ items: [{ id: 'p3' }], nextCursor: null }),
      reads: [product],
    });
    const loadMore = mutation('product/loadMore', {
      input: s.object({ after: s.string() }),
      registry: {
        queries: [productQuery],
        touches: [product],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(loadMore, {
        fragmentRenderers: [
          {
            mode: 'append',
            render: () => '<article data-key="p3"></article>',
            target: 'product-grid',
          },
        ],
        rawInput: { after: 'p2' },
        request: {},
        targets: ['product-grid'],
      }),
    ).resolves.toMatchObject({
      body: expect.stringContaining(
        '<fw-fragment target="product-grid" mode="append"><article data-key="p3"></article></fw-fragment>',
      ),
      status: 200,
    });
  });

  it('renders enhanced mutation responses from schema-coerced mutation input', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: (input) => ({ count: (input as { quantity: number }).quantity }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input.quantity;
      },
    });
    const form = new FormData();
    form.set('productId', 'p1');
    form.set('quantity', '2');

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          {
            render: (input) =>
              `<cart-badge>${typeof (input as { quantity: unknown }).quantity}:${(input as { quantity: number }).quantity}</cart-badge>`,
            target: 'cart-badge',
          },
        ],
        rawInput: form,
        request: {},
        targets: ['cart-badge'],
      }),
    ).resolves.toMatchObject({
      body: [
        '<fw-query name="cart">{"count":2}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>number:2</cart-badge></fw-fragment>',
      ].join('\n'),
      headers: {
        'FW-Changes': '[{"domain":"cart","input":{"productId":"p1","quantity":2}}]',
      },
      status: 200,
    });
  });

  it('matches the enhanced mutation wire fixture response byte-for-byte', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      instanceKey: 'cart:c1',
      load: () => ({ count: 1, items: [{ productId: 'p1', qty: 1, unitPrice: 1499 }] }),
      reads: [cart],
      version: 7,
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });

    const response = await renderMutationResponse(addToCart, {
      fragmentRenderers: [
        {
          render: () =>
            '<cart-badge fw-deps="cart"><button commandfor="cart-drawer" command="show-modal"><span data-bind="cart.count">1</span></button></cart-badge>',
          target: 'cart-badge',
        },
        {
          render: () => '<section fw-c="recommendations" fw-deps="product:p1"></section>',
          target: 'recommendations',
        },
      ],
      idem: 'idem_01HX',
      rawInput: { productId: 'p1', quantity: 1 },
      request: {},
      targets: ['cart-badge', 'recommendations'],
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/enhanced-mutation.http', import.meta.url),
      'utf8',
    );

    expect(normalizeWireResponse(response, 'OK')).toEqual(readFixtureResponses(fixture).at(-1));
  });

  it('replays enhanced mutation responses by FW-Idem without re-running the handler', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const cartQuery = query('cart', {
      load: () => ({ count: writes }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const request = {
      idem: 'idem_01',
      rawInput: { productId: 'p1' },
      replayStore,
      request: {},
      targets: ['cart-badge'],
    };

    const first = await renderMutationResponse(addToCart, request);
    first.headers['X-Mutated-By-Test'] = 'yes';
    const second = await renderMutationResponse(addToCart, request);

    expect(writes).toBe(1);
    expect(second).toEqual({
      body: '<fw-query name="cart">{"count":1}</fw-query>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"cart","input":{"productId":"p1"}}]',
        'FW-Idem': 'idem_01',
      },
      status: 200,
    });
  });

  it('replays enhanced mutation validation failures by FW-Idem', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let attempts = 0;
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        attempts += 1;
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });
    const request = {
      idem: 'idem_422',
      rawInput: { productId: 'p1' },
      replayStore,
      request: {},
    };

    await expect(renderMutationResponse(addToCart, request)).resolves.toMatchObject({
      status: 422,
    });
    await expect(renderMutationResponse(addToCart, request)).resolves.toEqual({
      body: '<fw-fragment target="error"><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Idem': 'idem_422',
      },
      status: 422,
    });
    expect(attempts).toBe(1);
  });

  it('delivers late stylesheets with enhanced mutation fragments', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          {
            render: () => '<cart-drawer class="drawer-open">Added</cart-drawer>',
            stylesheets: [
              '/assets/cart-drawer.css',
              '/assets/cart-drawer.css',
              { href: '/assets/theme.css', preload: false },
            ],
            target: 'cart-drawer',
          },
        ],
        rawInput: { productId: 'p1' },
        request: {},
        targets: ['cart-drawer'],
      }),
    ).resolves.toMatchObject({
      body: '<fw-fragment target="cart-drawer"><link rel="stylesheet" href="/assets/cart-drawer.css"><link rel="stylesheet" href="/assets/theme.css"><cart-drawer class="drawer-open">Added</cart-drawer></fw-fragment>',
      status: 200,
    });
  });

  it('renders per-island error boundary fragments when a fragment renderer fails', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          errorBoundary(
            {
              render() {
                throw new Error('recommendations failed');
              },
              stylesheets: ['/assets/recommendations.css'],
              target: 'recommendations',
            },
            {
              render(error) {
                return `<section role="alert">${(error as Error).message}</section>`;
              },
            },
          ),
        ],
        rawInput: { productId: 'p1' },
        request: {},
        targets: ['recommendations'],
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="recommendations" error-boundary="recommendations"><link rel="stylesheet" href="/assets/recommendations.css"><section role="alert">recommendations failed</section></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[]',
      },
      status: 200,
    });
  });

  it('fails enhanced mutation rendering when an island errors without a boundary', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          {
            render() {
              throw new Error('unhandled island error');
            },
            target: 'recommendations',
          },
        ],
        rawInput: { productId: 'p1' },
        request: {},
        targets: ['recommendations'],
      }),
    ).rejects.toThrow('unhandled island error');
  });

  it('renders typed failures as 422 validation fragments', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        rawInput: { productId: 'p1' },
        request: {},
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="error"><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></fw-fragment>',
      headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('renders schema validation failures into the submitted form target', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        failureTarget: 'product-form:p1',
        rawInput: { productId: 'p1', quantity: 0 },
        request: {},
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="product-form:p1"><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></fw-fragment>',
      headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('delivers late stylesheets with enhanced mutation failure fragments', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        failureStylesheets: [
          '/assets/product-form.css',
          '/assets/product-form.css',
          { href: '/assets/theme.css', preload: false },
        ],
        failureTarget: 'product-form:p1',
        rawInput: { productId: 'p1' },
        renderFailureFragment: () => '<form>Out of stock</form>',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="product-form:p1"><link rel="stylesheet" href="/assets/product-form.css"><link rel="stylesheet" href="/assets/theme.css"><form>Out of stock</form></fw-fragment>',
      headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('lets enhanced forms override validation failure fragments', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        failureTarget: 'product-form:p1',
        rawInput: { productId: 'p1', quantity: 0 },
        renderFailureFragment: (failure, rawInput) =>
          `<form fw-c="product-form" aria-invalid="true"><output role="alert" data-error-code="${failure.error.code}">${(rawInput as { quantity: number }).quantity}</output></form>`,
        request: {},
      }),
    ).resolves.toEqual({
      body: '<fw-fragment target="product-form:p1"><form fw-c="product-form" aria-invalid="true"><output role="alert" data-error-code="VALIDATION">0</output></form></fw-fragment>',
      headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('matches the validation failure wire fixture response byte-for-byte', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 5 });
      },
    });

    const response = await renderMutationResponse(addToCart, {
      failureTarget: 'product-form:p1',
      idem: 'idem_01HY',
      rawInput: { productId: 'p1', quantity: 99 },
      renderFailureFragment: (failure, rawInput) => {
        const input = rawInput as { productId: string; quantity: number };
        const data = failure.error.payload as { availableQuantity: number };

        return [
          '<form fw-c="product-form" aria-invalid="true">',
          `<output role="alert" data-error-code="${failure.error.code}">Only ${data.availableQuantity} left.</output>`,
          `<input name="productId" value="${input.productId}">`,
          `<input name="quantity" value="${input.quantity}">`,
          '</form>',
        ].join('');
      },
      request: {},
      targets: ['product-form:p1'],
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/validation-422-fragment.http', import.meta.url),
      'utf8',
    );

    expect(normalizeWireResponse(response, 'Unprocessable Content')).toEqual(
      readFixtureResponses(fixture).at(-1),
    );
  });

  it('renders no-JS mutation success as POST-redirect-GET', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1', quantity: 1 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/cart',
      },
      status: 303,
    });
  });

  it('matches the no-JS POST redirect wire fixture response byte-for-byte', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(input) {
        return input;
      },
    });

    const response = await renderNoJsMutationResponse(addToCart, {
      rawInput: { productId: 'p1', quantity: 1 },
      redirectTo: '/cart',
      request: {},
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/no-js-post-redirect-get.http', import.meta.url),
      'utf8',
    );
    const [postResponse] = readFixtureResponses(fixture);

    expect(postResponse).toEqual({
      body: `${response.body}`,
      headers: {
        'cache-control': response.headers['Cache-Control'],
        location: response.headers.Location,
      },
      statusLine: 'HTTP/1.1 303 See Other',
    });
  });

  it('renders no-JS mutation failures as a full HTML 422 page', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });

  it('renders no-JS schema validation failures with field paths by default', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1', quantity: 0 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });
});

function formDataFile(bits: string[], name: string, type: string): Blob {
  return new File(bits, name, { type }) as unknown as Blob;
}

function normalizeWireResponse(
  response: { body: string; headers: Record<string, string>; status: number },
  reason: string,
): { body: string; headers: Record<string, string>; statusLine: string } {
  return {
    body: `${response.body}\n`,
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]),
    ),
    statusLine: `HTTP/1.1 ${response.status} ${reason}`,
  };
}

function readFixtureResponses(
  fixture: string,
): { body: string; headers: Record<string, string>; statusLine: string }[] {
  const responses: { body: string; headers: Record<string, string>; statusLine: string }[] = [];
  let cursor = 0;

  while (true) {
    const responseStart = fixture.indexOf('<<< RESPONSE', cursor);
    if (responseStart === -1) return responses;

    const statusStart = fixture.indexOf('\n', responseStart);
    expect(statusStart).toBeGreaterThanOrEqual(0);

    const nextRequestStart = fixture.indexOf('\n>>> REQUEST', statusStart + 1);
    const responseBlock =
      nextRequestStart === -1
        ? fixture.slice(statusStart + 1)
        : fixture.slice(statusStart + 1, nextRequestStart);
    const headerEnd = responseBlock.indexOf('\n\n');
    const headerText =
      headerEnd === -1 ? responseBlock.trimEnd() : responseBlock.slice(0, headerEnd);
    const [statusLine = '', ...headerLines] = headerText.split('\n');
    const body = headerEnd === -1 ? '' : responseBlock.slice(headerEnd + 2);
    const headers = Object.fromEntries(
      headerLines.map((line) => {
        const separator = line.indexOf(':');
        expect(separator).toBeGreaterThan(0);
        return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
      }),
    );

    responses.push({ body, headers, statusLine });
    cursor = nextRequestStart === -1 ? fixture.length : nextRequestStart + 1;
  }
}
