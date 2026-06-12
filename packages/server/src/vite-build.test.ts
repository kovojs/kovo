import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { route } from './route.js';
import {
  createJisoAppShellViteBuild,
  exportJisoAppShellViteBuild,
  jisoAppShellViteManifestFile,
  jisoAppShellViteStaticExportAssetsFromManifestFile,
  staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
  staticExportInventoryForJisoAppShellViteBuild,
  writeJisoAppShellViteBuildOutput,
} from './vite-build.js';

describe('server app shell Vite build seam', () => {
  it('wires route-entry hints, compiled modules, output files, and static export assets', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-seam-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-seam-export-'));

    try {
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart{display:grid}');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const cartAsset = true;');

      const build = createJisoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return '<main class="cart">Cart</main>';
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            source: 'export const cartClient = true;',
            version: 'cartclient',
          },
        ],
        manifest: {
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        },
        routeEntryMap: {
          '/cart': 'src/cart.client.ts',
        },
      });

      expect(build.routeHints).toEqual([
        {
          hints: {
            modulepreloads: ['/assets/cart.js'],
            stylesheets: ['/assets/cart.css'],
          },
          routePath: '/cart',
        },
      ]);

      const output = await writeJisoAppShellViteBuildOutput(build, { outDir: distDir });
      expect(output.staticExportAssets).toEqual([
        {
          contentType: 'text/css; charset=utf-8',
          path: '/assets/cart.css',
          source: join(distDir, 'assets/cart.css'),
        },
        {
          contentType: 'text/javascript; charset=utf-8',
          path: '/assets/cart.js',
          source: join(distDir, 'assets/cart.js'),
        },
      ]);
      await expect(readFile(join(distDir, 'c/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cartClient = true;',
      );

      const exported = await exportJisoAppShellViteBuild(build, { distDir, outDir });
      expect(exported.artifacts[0]?.body).toContain(
        '<link rel="stylesheet" href="/assets/cart.css">',
      );
      expect(exported.artifacts[0]?.body).toContain(
        '<link rel="modulepreload" href="/assets/cart.js">',
      );
      await expect(readFile(join(outDir, 'cart/index.html'), 'utf8')).resolves.toContain(
        '<main class="cart">Cart</main>',
      );
      await expect(readFile(join(outDir, 'assets/cart.css'), 'utf8')).resolves.toBe(
        '.cart{display:grid}',
      );
      await expect(readFile(join(outDir, 'assets/cart.js'), 'utf8')).resolves.toBe(
        'export const cartAsset = true;',
      );
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('returns Vite build-backed static export inventory without writing output', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-inventory-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-inventory-export-'));

    try {
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/shop.css'), '.shop{color:green}');
      await writeFile(join(distDir, 'assets/shop.js'), 'export const shopAsset = true;');

      const build = createJisoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/shop', {
              page() {
                return [
                  '<main class="shop">Shop',
                  '<button on:click="/c/shop.client.js?v=shopclient#Shop$add">Add</button>',
                  '</main>',
                ].join('');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/shop.client.js',
            source: 'export const shopClient = true;',
            version: 'shopclient',
          },
        ],
        manifest: {
          'src/shop.client.ts': {
            css: ['assets/shop.css'],
            file: 'assets/shop.js',
          },
        },
        routeEntryMap: {
          '/shop': 'src/shop.client.ts',
        },
      });

      const inventory = await staticExportInventoryForJisoAppShellViteBuild(build, {
        distDir,
        outDir,
      } as unknown as Parameters<typeof staticExportInventoryForJisoAppShellViteBuild>[1]);

      expect(inventory).toEqual([
        {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            link: '</assets/shop.css>; rel=preload; as=style, </assets/shop.js>; rel=modulepreload',
          },
          kind: 'route-document',
          path: '/shop/index.html',
          status: 200,
        },
        {
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'content-type': 'text/javascript; charset=utf-8',
          },
          href: '/c/shop.client.js?v=shopclient#Shop$add',
          kind: 'client-module',
          path: '/c/shop.client.js',
          status: 200,
        },
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          kind: 'static-asset',
          path: '/assets/shop.css',
          source: join(distDir, 'assets/shop.css'),
          status: 200,
        },
        {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
          kind: 'static-asset',
          path: '/assets/shop.js',
          source: join(distDir, 'assets/shop.js'),
          status: 200,
        },
      ]);
      await expect(readFile(join(outDir, 'shop/index.html'))).rejects.toThrow();
      await expect(readFile(join(outDir, 'assets/shop.css'))).rejects.toThrow();
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('returns manifest-file backed static export inventory without writing output', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-manifest-inventory-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-manifest-inventory-export-'));

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/catalog.css'), '.catalog{display:block}');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/catalog.client.ts': {
            css: ['assets/catalog.css'],
            file: 'assets/catalog.js',
          },
        }),
      );

      const inventory = await staticExportInventoryForJisoAppShellViteBuildFromManifestFile({
        app: createApp({
          routes: [
            route('/catalog', {
              page() {
                return '<main class="catalog">Catalog</main>';
              },
            }),
          ],
        }),
        distDir,
        routeEntryMap: {
          '/catalog': 'src/catalog.client.ts',
        },
      });

      expect(inventory).toEqual([
        {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            link: '</assets/catalog.css>; rel=preload; as=style, </assets/catalog.js>; rel=modulepreload',
          },
          kind: 'route-document',
          path: '/catalog/index.html',
          status: 200,
        },
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          kind: 'static-asset',
          path: '/assets/catalog.css',
          source: join(distDir, 'assets/catalog.css'),
          status: 200,
        },
        {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
          kind: 'static-asset',
          path: '/assets/catalog.js',
          source: join(distDir, 'assets/catalog.js'),
          status: 200,
        },
      ]);
      await expect(readFile(join(outDir, 'catalog/index.html'))).rejects.toThrow();
      await expect(readFile(join(outDir, 'assets/catalog.css'))).rejects.toThrow();
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('returns manifest-file static export assets for task wiring', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-manifest-assets-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-manifest-assets-export-'));

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/catalog.css'), '.catalog{color:blue}');
      await writeFile(join(distDir, 'assets/catalog.js'), 'export const catalog = true;');
      await writeFile(
        jisoAppShellViteManifestFile(distDir),
        JSON.stringify({
          'src/catalog.client.ts': {
            css: ['assets/catalog.css'],
            file: 'assets/catalog.js',
          },
        }),
      );

      await expect(
        jisoAppShellViteStaticExportAssetsFromManifestFile({
          base: '/shop/',
          distDir,
        }),
      ).resolves.toEqual([
        {
          contentType: 'text/css; charset=utf-8',
          path: '/shop/assets/catalog.css',
          source: join(distDir, 'assets/catalog.css'),
        },
        {
          contentType: 'text/javascript; charset=utf-8',
          path: '/shop/assets/catalog.js',
          source: join(distDir, 'assets/catalog.js'),
        },
      ]);
      await expect(readFile(join(outDir, 'assets/catalog.css'))).rejects.toThrow();
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });
});
