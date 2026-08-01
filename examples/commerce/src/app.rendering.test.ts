import '../../../tests/example-generated-graphs.setup.js';

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { htmlDocumentFacts } from '@kovojs/test/html-fragment';

import { commerceMessageCatalog, createCommerceDb } from './domain.js';
import {
  createCommerceScenarioClient,
  createCommerceTestApp,
  loadCartQuery,
  seedCartItems,
} from './app-test-helpers.js';

const commerceRoot = fileURLToPath(new URL('..', import.meta.url));

describe('commerce example', () => {
  it('renders theme-backed stylesheet hints and authored StyleX classes', async () => {
    const cartResponse = await createCommerceScenarioClient().get('/cart');
    const cartPage = await cartResponse.text();
    const pageHints = htmlDocumentFacts(cartPage);
    const i18nScripts = pageHints.jsonScripts.filter(
      (script) => script.attrs['kovo-i18n'] !== undefined,
    );
    const queryScripts = pageHints.jsonScripts.filter(
      (script) => script.attrs['kovo-query'] !== undefined,
    );

    expect(commerceMessageCatalog).toEqual({
      cartLabel: 'Cart',
      productStock: '{count} in stock',
    });
    expect(cartResponse.headers.get('link')).toBe('</assets/styles.css>; rel=preload; as=style');
    expect(cartPage).toContain('data-kovo-critical-href="/assets/styles.css"');
    expect(cartPage).toContain('--kovo-theme-sys-color-primary');
    expect(pageHints.title).toBe('Kovo Commerce');
    expect(pageHints.metas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: 'Browse products and checkout with verifiable cart state.',
            name: 'description',
          }),
        }),
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: 'Browse products and checkout with verifiable cart state.',
            property: 'og:description',
          }),
        }),
      ]),
    );
    expect(i18nScripts.map((script) => script.json)).toEqual([commerceMessageCatalog]);
    expect(queryScripts.map((script) => script.json)).toEqual(
      expect.arrayContaining([
        { count: 0 },
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ id: 'p1' })]),
          nextCursor: 'p2',
        }),
      ]),
    );
    expect(pageHints.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attrs: expect.objectContaining({
            href: '/assets/styles.css',
            rel: 'stylesheet',
          }),
          tag: 'link',
        }),
      ]),
    );
    expect(cartPage).toContain('class="kv-style-');
  });

  it('renders loaded cart state through the public app response', async () => {
    const db = createCommerceDb();
    await seedCartItems(db, [
      { productId: 'p1', qty: 3, unitPrice: 1499 },
      { productId: 'p2', qty: 2, unitPrice: 2599 },
    ]);

    expect(await loadCartQuery(db)).toEqual({ count: 5 });
    const cartResponse = await createCommerceScenarioClient(createCommerceTestApp({ db })).get(
      '/cart',
    );
    const cartHtml = await cartResponse.text();
    expect(cartResponse.status, cartHtml).toBe(200);
    expect(htmlDocumentFacts(cartHtml).title).toBe('Kovo Commerce');
    expect(cartHtml).toContain('>5</span>');
  });

  it('keeps authored global CSS clean without route/component leakage', async () => {
    const authoredCss = readFileSync(path.join(commerceRoot, 'src', 'styles.css'), 'utf8');
    expect(authoredCss).not.toContain('./generated/');

    rmSync(path.join(commerceRoot, 'dist'), { force: true, recursive: true });

    execFileSync(
      'corepack',
      ['pnpm', '--filter', '@kovojs/example-commerce', 'run', 'build:demo'],
      {
        cwd: path.join(commerceRoot, '..', '..'),
        stdio: 'pipe',
      },
    );

    const css = readFileSync(path.join(commerceRoot, 'dist', 'assets', 'styles.css'), 'utf8');

    expect(css).toContain('var(--kovo-theme-sys-color-surface)');
    expect(css).toContain('var(--kovo-theme-sys-color-on-surface)');
    expect(css).not.toContain('.kv-commerce-app-');
    expect(css).not.toContain('.kv-auth-form-');
    expect(css).not.toContain('.kv-product-grid-');
    expect(css).not.toContain('.kv-button-');
    expect(css).not.toContain('.bg-slate-50');
    expect(css).not.toContain('.text-red-700');
  }, 120_000);
});
