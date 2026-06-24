import { publicAccess } from './access.js';
import { describe, expect, it } from 'vitest';

import { renderPageHints } from './hints.js';
import { i18n, meta, metaFromQuery, t } from './meta.js';
import { domain } from './domain.js';
import { query } from './query.js';

describe('server route meta and i18n hints', () => {
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
      access: publicAccess('test fixture'),
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
    // F2 (bugs-part3 L2-early-hints-2): a query-derived meta factory whose query data
    // is absent must skip silently (emit no derived tags), NOT throw — the document
    // head path previously called `renderPageHints` with no query context, so any
    // `metaFromQuery` factory hard-500'd the whole page. (Inverts the prior throw
    // assertion.)
    expect(renderPageHints({ meta: productMeta })).toEqual({
      earlyHints: {},
      html: '',
    });

    // A throwing `derive` (e.g. a not-found row) also drops only the derived tags
    // rather than 500ing; the rest of the document still renders.
    const throwingMeta = metaFromQuery(productQuery, (product) => {
      if (!product) throw new Error('not found');
      return { title: product.name };
    });
    expect(
      renderPageHints(
        { meta: [{ description: 'Static fallback' }, throwingMeta] },
        { queries: { product: undefined } },
      ),
    ).toEqual({
      earlyHints: {},
      html: [
        '<meta name="description" content="Static fallback">',
        '<meta property="og:description" content="Static fallback">',
      ].join(''),
    });
  });

  it('scheme-checks the og:image URL sink against a metaFromQuery-derived value (L-i18n-meta-1)', () => {
    // part-4 L-i18n-meta-1 / SPEC.md §4.8 + §5.2#10: og:image is a URL sink, so a
    // metaFromQuery-derived `image` carrying an unsafe scheme (e.g. an attacker-controlled
    // product row surfacing `javascript:alert(1)`) must be sanitized to `#` before escaping,
    // while an http(s) origin URL is preserved verbatim.
    const productQuery = query('product', {
      access: publicAccess('test fixture'),
      load: (_input: { id: string }) => ({ id: 'p1', image: '/products/p1.png' }),
      reads: [domain('product')],
    });
    const imageMeta = metaFromQuery(productQuery, (product) => ({ image: product.image }));

    expect(
      renderPageHints(
        { meta: imageMeta },
        { queries: { product: { id: 'evil', image: 'javascript:alert(1)' } } },
      ),
    ).toEqual({
      earlyHints: {},
      html: '<meta property="og:image" content="#">',
    });

    expect(
      renderPageHints(
        { meta: imageMeta },
        { queries: { product: { id: 'ok', image: 'https://cdn.example.com/x.png' } } },
      ),
    ).toEqual({
      earlyHints: {},
      html: '<meta property="og:image" content="https://cdn.example.com/x.png">',
    });
  });

  it('reports invalid query-derived meta declarations early', () => {
    const productQuery = query('product', {
      access: publicAccess('test fixture'),
      load: (_input: { id: string }) => ({ id: 'p1', name: 'Coffee' }),
      reads: [domain('product')],
    });
    const anonymousQuery = { ...productQuery, key: undefined } as unknown as typeof productQuery;

    expect(() =>
      metaFromQuery(anonymousQuery, (product) => ({
        title: product.name,
      })),
    ).toThrow('metaFromQuery requires a query key for deferred meta');
    expect(() =>
      metaFromQuery(
        productQuery,
        productQuery.load({ id: 'p1' }),
        undefined as unknown as (product: { id: string; name: string }) => { title: string },
      ),
    ).toThrow('metaFromQuery requires a derive function');
  });

  it('renders server-side i18n catalogs with page hints', () => {
    const en = i18n('en-US', {
      cartCount: 'Cart has {count} items',
      unsafe: 'Use <strong>server text</strong>',
    });

    expect(t(en, 'cartCount', { count: 3 })).toBe('Cart has 3 items');
    expect(t(en, 'cartCount')).toBe('Cart has {count} items');
    expect(() => t(en, 'missing' as 'cartCount')).toThrow('Missing i18n message: missing');
    expect(renderPageHints({ i18n: en })).toEqual({
      csp: {
        scripts: ['sha256-EIplYLOXD0CrpSrilranaOD5BAzgvnAuyLvbvLshN8k='],
        styles: [],
      },
      earlyHints: {},
      html: '<script type="application/json" kovo-i18n locale="en-US" data-kovo-csp-hash="sha256-EIplYLOXD0CrpSrilranaOD5BAzgvnAuyLvbvLshN8k=">{"cartCount":"Cart has {count} items","unsafe":"Use \\u003cstrong>server text\\u003c/strong>"}</script>',
    });
  });
});
