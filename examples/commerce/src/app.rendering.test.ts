import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { htmlDocumentFacts } from '@kovojs/test/html-fragment';
import { renderPageHints } from '@kovojs/server/internal/html';

import {
  commerceMessages,
  commerceMeta,
  commerceMessageCatalog,
  createCommerceDb,
  loadCartQuery,
  type CartQueryResult,
} from './domain.js';
import { commerceStylesheets } from './app.js';
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
  it('renders theme-backed stylesheet hints and authored StyleX classes', async () => {
    const cartResponse = await createCommerceScenarioClient().get('/cart');
    const cartPage = await cartResponse.text();
    const pageHints = htmlDocumentFacts(commercePageHints.html);

    expect(commerceMessageCatalog).toEqual({
      cartLabel: 'Cart',
      productStock: '{count} in stock',
    });
    expect(commercePageHints.earlyHints).toEqual({
      Link: '</assets/styles.css>; rel=preload; as=style',
    });
    expect(commercePageHints.html).toContain('data-kovo-critical-href="/assets/styles.css"');
    expect(commercePageHints.html).toContain('--kovo-theme-sys-color-primary');
    expect(commercePageHints.html).toContain('.kv-commerce-');
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
    expect(cartPage).toContain('data-style-src="examples/commerce/src/app.tsx#cartShell"');
    expect(cartPage).toContain(
      'data-style-src="examples/commerce/src/components/cart-badge.tsx#count"',
    );
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

  it('builds the linked app stylesheet as reset plus generated UI CSS', () => {
    rmSync(path.join(commerceRoot, 'dist'), { force: true, recursive: true });

    execFileSync('corepack', ['pnpm', '--filter', '@kovojs/example-commerce', 'run', 'build'], {
      cwd: path.join(commerceRoot, '..', '..'),
      stdio: 'pipe',
    });

    const css = readFileSync(
      path.join(commerceRoot, 'dist', 'server', 'client', 'assets', 'styles.css'),
      'utf8',
    );

    expect(css).toContain('var(--kovo-theme-sys-color-surface)');
    expect(css).toContain('var(--kovo-theme-sys-color-on-surface)');
    expect(css).not.toContain('.bg-slate-50');
    expect(css).not.toContain('.text-red-700');
  });
});
