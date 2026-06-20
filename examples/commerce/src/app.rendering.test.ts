import '../../../tests/example-generated-graphs.setup.js';

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
// Base + the original headroom, plus ~13.7KB for the @kovojs/ui shadcn-parity UX
// overhaul (plans/better-components-ux.md): new Dialog/AlertDialog header/footer/
// close-X families, menu/toolbar button resets, anchored-overlay positioning, and
// disclosure open/close animations enlarge the monolithic kovo-ui.css that every
// app links (measured deterministically at 143,447 B from a clean commerce build).
const phase0CommerceRouteCssBytes = 148_746;

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
    expect(cartPage).toContain('class="kv-style-');
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

  it('keeps authored global CSS clean while building the linked app stylesheet', async () => {
    const authoredCss = readFileSync(path.join(commerceRoot, 'src', 'styles.css'), 'utf8');
    expect(authoredCss).not.toContain('./generated/');

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
    expect(css).toContain('--kovo-color-background:');
    expect(css).toContain('.kv-button-');
    expect(css).not.toContain('.kv-commerce-app-');
    expect(css).not.toContain('.kv-product-grid-');
    expect(css).not.toContain('.bg-slate-50');
    expect(css).not.toContain('.text-red-700');

    const routeCssFiles = [
      readBuiltCssAsset((href) => /^assets\/routes\/login-[a-f0-9]{8}\.css$/.test(href)),
    ];
    const [loginCss] = routeCssFiles;
    expect(loginCss?.css).toContain('.kv-auth-form-');
    expect(loginCss?.css).not.toContain('.kv-product-grid-');

    const serverModule = (await import(
      `${pathToFileURL(path.join(commerceRoot, 'dist', 'server', 'server.mjs')).href}?t=${Date.now()}`
    )) as {
      createKovoNodeServer(): Server;
    };
    const server = serverModule.createKovoNodeServer();
    await listen(server);
    const origin = serverOrigin(server);
    try {
      for (const routePath of ['/', '/cart', '/login']) {
        const response = await fetch(`${origin}${routePath}`);
        const html = await response.text();

        expect(response.status, html).toBe(200);
        expect(routeCssBytes(html)).toBeLessThan(phase0CommerceRouteCssBytes);
      }
    } finally {
      await close(server);
    }
  });
});

function readBuiltCssAsset(predicate: (path: string) => boolean): { css: string; path: string } {
  const assetPath = listBuiltCssAssets().find(predicate);
  if (!assetPath) throw new Error('Expected built CSS asset.');
  return {
    css: readFileSync(path.join(commerceRoot, 'dist', 'server', 'client', assetPath), 'utf8'),
    path: assetPath,
  };
}

function listBuiltCssAssets(relativeDir = 'assets'): string[] {
  const root = path.join(commerceRoot, 'dist', 'server', 'client', relativeDir);
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) return listBuiltCssAssets(relativePath);
    return entry.isFile() && relativePath.endsWith('.css') ? [relativePath] : [];
  });
}

function routeCssBytes(html: string): number {
  return linkedCssHrefs(html).reduce(
    (total, href) =>
      total +
      readFileSync(path.join(commerceRoot, 'dist', 'server', 'client', href.replace(/^\//, '')))
        .byteLength,
    inlinedCriticalCssBytes(html),
  );
}

function linkedCssHrefs(html: string): string[] {
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(
    (match) => match[1] ?? '',
  );
}

function inlinedCriticalCssBytes(html: string): number {
  return [...html.matchAll(/<style data-kovo-critical-href="[^"]+"[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1] ?? '')
    .reduce((total, css) => total + Buffer.byteLength(css, 'utf8'), 0);
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function serverOrigin(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
  return `http://127.0.0.1:${address.port}`;
}
