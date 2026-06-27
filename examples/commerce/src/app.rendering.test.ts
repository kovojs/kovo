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

  it('keeps authored global CSS clean while route-specific CSS stays split', async () => {
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
    expect(css).not.toContain('.kv-auth-form-');
    expect(css).not.toContain('.kv-product-grid-');
    expect(css).not.toContain('.bg-slate-50');
    expect(css).not.toContain('.text-red-700');

    const loginCss = readBuiltCssAsset((href) =>
      /^assets\/routes\/login-[a-f0-9]{8}\.css$/.test(href),
    );
    expect(loginCss.css).toContain('.kv-auth-form-');
    expect(loginCss.css).not.toContain('.kv-commerce-app-');
    expect(loginCss.css).not.toContain('.kv-product-grid-');
    expect(loginCss.css).not.toContain('.kv-cart-badge-');

    const serverModule = (await import(
      `${pathToFileURL(path.join(commerceRoot, 'dist', 'server', 'server.mjs')).href}?t=${Date.now()}`
    )) as {
      createKovoNodeServer(): Server;
    };
    const server = serverModule.createKovoNodeServer();
    await listen(server);
    const origin = serverOrigin(server);
    try {
      const routeHtml: Record<'/' | '/cart' | '/login', string> = {
        '/': '',
        '/cart': '',
        '/login': '',
      };

      for (const routePath of Object.keys(routeHtml) as Array<keyof typeof routeHtml>) {
        const response = await fetch(`${origin}${routePath}`);
        const html = await response.text();

        expect(response.status, html).toBe(200);
        routeHtml[routePath] = html;
      }

      expect(routeSpecificCssAssetPaths(routeHtml['/'])).toEqual([]);
      expect(routeSpecificCssAssetPaths(routeHtml['/cart'])).toEqual([]);
      expect(routeSpecificCssAssetPaths(routeHtml['/login'])).toEqual([loginCss.path]);

      for (const assetPath of linkedCssAssetPaths(routeHtml['/login'])) {
        if (assetPath === loginCss.path) continue;
        expect(readBuiltCssAssetByPath(assetPath)).not.toContain('.kv-auth-form-');
      }
    } finally {
      await close(server);
    }
  }, 120_000);
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

function linkedCssAssetPaths(html: string): string[] {
  return linkedCssHrefs(html).map(cssHrefToAssetPath);
}

function routeSpecificCssAssetPaths(html: string): string[] {
  return linkedCssAssetPaths(html).filter((href) => href.startsWith('assets/routes/'));
}

function readBuiltCssAssetByPath(assetPath: string): string {
  return readFileSync(path.join(commerceRoot, 'dist', 'server', 'client', assetPath), 'utf8');
}

function cssHrefToAssetPath(href: string): string {
  return href.replace(/^\//, '');
}

function linkedCssHrefs(html: string): string[] {
  return [
    ...new Set(
      [...html.matchAll(/<link rel="(?:stylesheet|preload)"(?: as="style")? href="([^"]+)"/g)]
        .map((match) => match[1] ?? '')
        .filter(Boolean),
    ),
  ];
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
