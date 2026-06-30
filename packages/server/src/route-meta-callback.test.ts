import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { domain } from './domain.js';
import { renderedHtml } from './html.js';
import { renderPageHints } from './hints.js';
import { metaFromQuery } from './meta.js';
import { query } from './query.js';
import { parseRouteRequest, route } from './route.js';
import { s } from './schema.js';

describe('param-dependent route meta callbacks', () => {
  it('types callbacks against route params/search and renders them from page hints', () => {
    const contactRoute = route('/contacts/:id', {
      meta: ({ params, search }, queries) => {
        const id: string = params.id;
        const tab: string = search.tab;
        const source = queries.source as string | undefined;
        // @ts-expect-error route params keep their schema-derived type.
        expectNumber(params.id);
        return { title: `Contact ${id} (${tab}${source ? `:${source}` : ''})` };
      },
      page: () => renderedHtml('<main>Contact</main>'),
      params: s.object({ id: s.string() }),
      search: s.object({ tab: s.string().default('overview') }),
    });
    const context = parseRouteRequest(contactRoute, {
      params: { id: 'c1' },
      search: {},
    });

    expect(
      renderPageHints(contactRoute, {
        queries: { source: 'crm' },
        route: context,
      }),
    ).toEqual({
      earlyHints: {},
      html: '<title>Contact c1 (overview:crm)</title>',
    });
  });

  it('threads callback meta through full app document rendering', async () => {
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/contacts/:id', {
            meta: ({ params }) => ({ title: `Contact ${params.id}` }),
            page: ({ params }) => renderedHtml(`<main>${params.id}</main>`),
            params: s.object({ id: s.string() }),
          }),
        ],
      }),
    );

    const response = await handler(new Request('https://example.test/contacts/c7'));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('<title>Contact c7</title>');
  });

  it('preserves static and query-derived meta behavior alongside callbacks', () => {
    const productQuery = query('product', {
      load: (_input: { id: string }) => ({ name: 'Coffee', stock: 5 }),
      reads: [domain('product')],
    });
    const productMeta = metaFromQuery(productQuery, (product) => ({
      description: `${product.stock} available`,
      title: product.name,
    }));
    const productRoute = route('/products/:id', {
      meta: [
        { image: '/products/p1.png' },
        productMeta,
        ({ params }) => ({ description: `Product ${params.id}` }),
      ],
      page: () => renderedHtml('<main>Product</main>'),
      params: s.object({ id: s.string() }),
    });
    const context = parseRouteRequest(productRoute, { params: { id: 'p1' } });

    expect(
      renderPageHints(productRoute, {
        queries: { product: { name: 'Coffee', stock: 5 } },
        route: context,
      }),
    ).toEqual({
      earlyHints: {},
      html: [
        '<meta property="og:image" content="/products/p1.png">',
        '<title>Coffee</title>',
        '<meta name="description" content="5 available">',
        '<meta property="og:description" content="5 available">',
        '<meta name="description" content="Product p1">',
        '<meta property="og:description" content="Product p1">',
      ].join(''),
    });
  });
});

function expectNumber(_value: number): void {}
