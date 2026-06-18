import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { KovoExplainInput, PageExplain } from '@kovojs/core/internal/graph';
import { htmlDocumentFacts } from '@kovojs/test/html-fragment';
import { renderPageHints } from '@kovojs/server';
import { kovoExplain } from 'kovo';
import { describe, expect, it } from 'vitest';

import {
  commerceCartPageMeta,
  commerceMessages,
  commerceMeta,
  commerceStylesheets,
  createCommerceDb,
  loadCartQuery,
  productGridQuery,
  type CartQueryResult,
} from './app.js';
import { resetProducts } from './app-test-helpers.js';

const commerceRoot = fileURLToPath(new URL('..', import.meta.url));
const generatedGraph = JSON.parse(
  readFileSync(join(commerceRoot, 'src/generated/graph.json'), 'utf8'),
) as KovoExplainInput;

function renderCommercePageHints(cart: CartQueryResult = { count: 0 }) {
  return renderPageHints(
    {
      i18n: commerceMessages,
      meta: commerceMeta,
      stylesheets: commerceStylesheets,
    },
    { queries: { cart } },
  );
}

describe('commerce graph', () => {
  it('keeps cart/add refresh behavior visible', () => {
    expect(statusesFor('cart/add')).toEqual({
      cart: 'derived',
      orderHistory: 'derived',
      productGrid: 'derived',
    });

    const explanation = kovoExplain(generatedGraph, {
      kind: 'mutation',
      optimistic: true,
      target: 'cart/add',
    });
    expect(explanation.exitCode).toBe(0);
    expect(explanation.output).toContain(
      'updates: cart->component:CartBadge; orderHistory->component:OrderHistory; productGrid->component:ProductGrid',
    );
    expect(explanation.output).toContain('OPTIMISTIC-SUMMARY total=3 derived=3');
  });

  it('derives cart page metadata from query data', async () => {
    const starterCart = await loadCartQuery(createCommerceDb());
    const cartMeta = commerceCartPageMeta(starterCart);
    const pageHints = htmlDocumentFacts(renderCommercePageHints(starterCart).html);
    const commerceGraph = authoredGraphFacts(generatedGraph);

    expect(commerceGraph.pages?.find((page) => page.route === '/cart')?.meta).toEqual(cartMeta);
    expect(pageHints.title).toBe(cartMeta.title);
    expect(pageHints.metas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: cartMeta.description,
            name: 'description',
          }),
        }),
      ]),
    );
  });

  it('loads paginated product data with ordinary query input', async () => {
    const db = createCommerceDb();
    await resetProducts(db, [
      { id: 'custom-a', stock: 3, unitPrice: 100 },
      { id: 'custom-b', stock: 4, unitPrice: 200 },
      { id: 'custom-c', stock: 5, unitPrice: 300 },
    ]);

    await expect(productGridQuery.load({ after: 'custom-a', limit: 2 }, { db })).resolves.toEqual({
      items: [
        {
          category: 'General',
          emoji: '📦',
          id: 'custom-b',
          name: 'Sample Product',
          stock: 4,
          unitPrice: 200,
        },
        {
          category: 'General',
          emoji: '📦',
          id: 'custom-c',
          name: 'Sample Product',
          stock: 5,
          unitPrice: 300,
        },
      ],
      nextCursor: null,
    });
  });
});

function statusesFor(mutation: string): Record<string, string> {
  return Object.fromEntries(
    (authoredGraphFacts(generatedGraph).optimistic ?? [])
      .filter((entry) => entry.mutation === mutation)
      .map((entry) => [entry.query, entry.status]),
  );
}

function authoredGraphFacts(graph: KovoExplainInput): KovoExplainInput {
  const { components: _components, pages, packageComponentPrefixes: _prefixes, ...rest } = graph;

  return {
    ...rest,
    pages: pages?.map(authoredPageFacts),
  };
}

function authoredPageFacts(page: PageExplain): PageExplain {
  const {
    layouts: _layouts,
    navigationSegments: _navigationSegments,
    queries: _queries,
    ...authoredFacts
  } = page;

  return authoredFacts;
}
