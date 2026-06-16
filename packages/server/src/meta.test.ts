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

  it('reports invalid query-derived meta declarations early', () => {
    const productQuery = query('product', {
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
      earlyHints: {},
      html: '<script type="application/json" kovo-i18n locale="en-US">{"cartCount":"Cart has {count} items","unsafe":"Use \\u003cstrong>server text\\u003c/strong>"}</script>',
    });
  });
});
