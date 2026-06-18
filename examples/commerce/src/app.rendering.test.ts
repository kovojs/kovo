import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { htmlDocumentFacts, htmlElementFacts } from '@kovojs/test/html-fragment';
import { renderPageHints } from '@kovojs/server';

import {
  commerceMessages,
  commerceMeta,
  commerceMessageCatalog,
  commerceStylesheets,
  createCommerceDb,
  loadCartQuery,
  type CartQueryResult,
} from './app.js';
import { createCommerceScenarioClient, seedCartItems } from './app-test-helpers.js';

const commerceRoot = fileURLToPath(new URL('..', import.meta.url));
const commercePageHints = renderCommercePageHints();

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

describe('commerce example', () => {
  it('renders StyleX-first stylesheet hints and static utility classes', async () => {
    const cartResponse = await createCommerceScenarioClient().get('/cart');
    const cartPage = await cartResponse.text();
    const pageHints = htmlDocumentFacts(commercePageHints.html);
    const cartDocument = htmlDocumentFacts(cartPage);

    expect(commerceMessageCatalog).toEqual({
      cartLabel: 'Cart',
      productStock: '{count} in stock',
    });
    expect(commercePageHints.earlyHints).toEqual({
      Link: '</assets/styles.css>; rel=preload; as=style',
    });
    expect(pageHints.title).toBe('Kovo Commerce (0)');
    expect(pageHints.metas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: 'Browse products and checkout with 0 verifiable cart item.',
            name: 'description',
          }),
        }),
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: 'Browse products and checkout with 0 verifiable cart item.',
            property: 'og:description',
          }),
        }),
      ]),
    );
    expect(pageHints.jsonScripts.map((script) => script.json)).toEqual([commerceMessageCatalog]);
    expect(pageHints.links).toMatchObject([
      { attrs: { href: '/assets/styles.css', rel: 'stylesheet' }, tag: 'link' },
    ]);
    expect(
      htmlElementFacts(cartPage, {
        attrs: { class: 'mx-auto max-w-4xl' },
        tag: 'main',
      }),
    ).toHaveLength(1);
    expect(
      htmlElementFacts(cartPage, {
        attrs: {
          class:
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-xs font-semibold tabular-nums text-white',
        },
        tag: 'span',
      }),
    ).toHaveLength(1);
  });

  it('resolves commerce route meta from loaded cart query data', async () => {
    const db = createCommerceDb();
    await seedCartItems(db, [
      { productId: 'p1', qty: 3, unitPrice: 1499 },
      { productId: 'p2', qty: 2, unitPrice: 2599 },
    ]);

    expect(await loadCartQuery(db)).toEqual({ count: 5 });
    expect(htmlDocumentFacts(renderCommercePageHints(await loadCartQuery(db)).html).title).toBe(
      'Kovo Commerce (5)',
    );
  });

  it('builds the linked app stylesheet for commerce utility classes', () => {
    rmSync(path.join(commerceRoot, 'dist'), { force: true, recursive: true });

    execFileSync('corepack', ['pnpm', '--filter', '@kovojs/example-commerce', 'run', 'build'], {
      cwd: path.join(commerceRoot, '..', '..'),
      stdio: 'pipe',
    });

    const css = readFileSync(path.join(commerceRoot, 'dist', 'assets', 'styles.css'), 'utf8');

    expect(css).toContain('.bg-slate-50');
    expect(css).toContain('.rounded');
    expect(css).toContain('.text-red-700');
    expect(css).toContain('.bg-teal-600');
    expect(css).toContain('.border-slate-200');
  });

});
