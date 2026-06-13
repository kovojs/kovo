import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { route } from './route.js';
import { staticExportManifest } from './static-export.js';
import { createJisoAppShellViteBuild } from './vite-build.js';
import {
  jisoAppShellViteOutputDir,
  writeJisoAppShellViteBuildOutput,
} from './vite-build-output.js';
import {
  exportJisoAppShellViteBuildFromManifestFile,
  exportJisoAppShellViteBuild,
  staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
  staticExportInventoryForJisoAppShellViteBuild,
  staticExportManifestForJisoAppShellViteBuildFromManifestFile,
} from './vite-static-export.js';
import {
  jisoAppShellViteBuildStaticExportAssets,
  jisoAppShellViteManifestFile,
  jisoAppShellViteStaticExportAssetsFromManifestFile,
} from './vite-build-assets.js';

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

      const output = await writeJisoAppShellViteBuildOutput(build, {
        outDir: distDir,
        staticExport: { outDir },
      });
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

      const exported = output.staticExport;
      if (!exported) throw new Error('expected app-shell build output static export');
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

  it('requires an app when Vite build output is asked to run static export', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-output-static-export-dist-'));

    try {
      await expect(
        writeJisoAppShellViteBuildOutput(
          {
            clientModules: [],
          },
          { outDir: distDir, staticExport: {} },
        ),
      ).rejects.toThrow('App shell Vite build output static export requires a Jiso app.');
    } finally {
      await rm(distDir, { force: true, recursive: true });
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

  it('keeps Vite output path selection and writes inside the build output directory', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-output-boundary-dist-'));

    try {
      expect(jisoAppShellViteOutputDir({ dir: join(distDir, 'client') })).toBe(
        join(distDir, 'client'),
      );
      expect(jisoAppShellViteOutputDir({ file: join(distDir, 'server/app-shell.js') })).toBe(
        join(distDir, 'server'),
      );
      expect(() => jisoAppShellViteOutputDir({})).toThrow(
        'App shell Vite build output requires output.dir or output.file.',
      );

      await expect(
        writeJisoAppShellViteBuildOutput(
          {
            clientModules: [
              {
                file: '../escape.js',
                href: '/c/escape.js?v=escape',
                path: '/c/escape.js',
                source: 'export const escape = true;',
                version: 'escape',
              },
            ],
          },
          { outDir: distDir },
        ),
      ).rejects.toThrow(
        'App shell build asset must stay within the Vite output directory: ../escape.js',
      );
      await expect(readFile(join(distDir, '../escape.js'))).rejects.toThrow();
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });

  it('exports Vite build param routes from staticPaths with manifest assets', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-param-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-param-export-'));

    try {
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/product.css'), '.product{color:green}');
      await writeFile(join(distDir, 'assets/product.js'), 'export const productAsset = true;');

      const build = createJisoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/products/:id', {
              page(context) {
                const params = context.params as { id: string };
                return `<main class="product">Product ${params.id}</main>`;
              },
              staticPaths: ['/products/p1', '/products/p2'],
            }),
          ],
        }),
        manifest: {
          'src/product.client.ts': {
            css: ['assets/product.css'],
            file: 'assets/product.js',
          },
        },
        routeEntryMap: {
          '/products/:id': 'src/product.client.ts',
        },
      });

      const exported = await exportJisoAppShellViteBuild(build, { distDir, outDir });

      expect(exported.artifacts.map((artifact) => artifact.path)).toEqual([
        '/products/p1/index.html',
        '/products/p2/index.html',
      ]);
      expect(exported.diagnostics).toEqual([]);
      await expect(readFile(join(outDir, 'products/p1/index.html'), 'utf8')).resolves.toContain(
        '<main class="product">Product p1</main>',
      );
      await expect(readFile(join(outDir, 'products/p2/index.html'), 'utf8')).resolves.toContain(
        '<link rel="stylesheet" href="/assets/product.css">',
      );
      await expect(readFile(join(outDir, 'assets/product.css'), 'utf8')).resolves.toBe(
        '.product{color:green}',
      );
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('returns Vite build static export assets without exposing build internals', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-assets-dist-'));

    try {
      const build = createJisoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return '<main>Cart</main>';
              },
            }),
          ],
        }),
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

      expect(
        jisoAppShellViteBuildStaticExportAssets(build, {
          assets: [
            {
              headers: { 'cache-control': 'public, max-age=60' },
              path: '/robots.txt',
              source: join(distDir, 'public/robots.txt'),
            },
          ],
          distDir,
        }),
      ).toEqual([
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
        {
          headers: { 'cache-control': 'public, max-age=60' },
          path: '/robots.txt',
          source: join(distDir, 'public/robots.txt'),
        },
      ]);
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });

  it('rejects manifest and caller asset collisions during Vite export inventory planning', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-asset-collision-dist-'));

    try {
      const build = createJisoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return '<main>Cart</main>';
              },
            }),
          ],
        }),
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

      await expect(
        staticExportInventoryForJisoAppShellViteBuild(build, {
          assets: [
            {
              path: '/assets/cart.css',
              source: join(distDir, 'public/cart.css'),
            },
          ],
          distDir,
        }),
      ).rejects.toMatchObject({
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
            message: expect.stringContaining(
              "static asset '/assets/cart.css' because it conflicts with static asset '/assets/cart.css'",
            ),
            routePath: '/assets/cart.css',
          },
        ],
      });
    } finally {
      await rm(distDir, { force: true, recursive: true });
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

  it('returns manifest-file backed static export manifests matching write export output', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-manifest-proof-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-manifest-proof-export-'));

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/docs.css'), '.docs{display:grid}');
      await writeFile(join(distDir, 'assets/docs.js'), 'export const docs = true;');
      await writeFile(
        jisoAppShellViteManifestFile(distDir),
        JSON.stringify({
          'src/docs.client.ts': {
            css: ['assets/docs.css'],
            file: 'assets/docs.js',
          },
        }),
      );

      const app = createApp({
        routes: [
          route('/docs/intro', {
            modulepreloads: ['/c/docs.client.js?v=docs-v1'],
            page() {
              return '<main class="docs">Intro</main>';
            },
          }),
        ],
      });
      const clientModules = [
        {
          path: '/c/docs.client.js',
          source: 'export const docsClient = true;',
          version: 'docs-v1',
        },
      ];
      const routeEntryMap = {
        '/docs/intro': 'src/docs.client.ts',
      };

      const dryRunManifest = await staticExportManifestForJisoAppShellViteBuildFromManifestFile({
        app,
        clientModules,
        distDir,
        routeEntryMap,
      });
      const written = await exportJisoAppShellViteBuildFromManifestFile({
        app,
        clientModules,
        distDir,
        outDir,
        routeEntryMap,
      });

      expect(dryRunManifest).toEqual({
        assets: [
          {
            headers: { 'content-type': 'text/css; charset=utf-8' },
            path: '/assets/docs.css',
            source: join(distDir, 'assets/docs.css'),
            status: 200,
          },
          {
            headers: { 'content-type': 'text/javascript; charset=utf-8' },
            path: '/assets/docs.js',
            source: join(distDir, 'assets/docs.js'),
            status: 200,
          },
        ],
        clientModules: [
          {
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'content-type': 'text/javascript; charset=utf-8',
            },
            href: '/c/docs.client.js?v=docs-v1',
            path: '/c/docs.client.js',
            status: 200,
          },
        ],
        files: [
          {
            headers: {
              'content-type': 'text/html; charset=utf-8',
              link: '</assets/docs.css>; rel=preload; as=style, </c/docs.client.js?v=docs-v1>; rel=modulepreload, </assets/docs.js>; rel=modulepreload',
            },
            kind: 'route-document',
            path: '/docs/intro/index.html',
            status: 200,
          },
          {
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'content-type': 'text/javascript; charset=utf-8',
            },
            href: '/c/docs.client.js?v=docs-v1',
            kind: 'client-module',
            path: '/c/docs.client.js',
            status: 200,
          },
          {
            headers: { 'content-type': 'text/css; charset=utf-8' },
            kind: 'static-asset',
            path: '/assets/docs.css',
            source: join(distDir, 'assets/docs.css'),
            status: 200,
          },
          {
            headers: { 'content-type': 'text/javascript; charset=utf-8' },
            kind: 'static-asset',
            path: '/assets/docs.js',
            source: join(distDir, 'assets/docs.js'),
            status: 200,
          },
        ],
        routeDocuments: [
          {
            headers: {
              'content-type': 'text/html; charset=utf-8',
              link: '</assets/docs.css>; rel=preload; as=style, </c/docs.client.js?v=docs-v1>; rel=modulepreload, </assets/docs.js>; rel=modulepreload',
            },
            path: '/docs/intro/index.html',
            status: 200,
          },
        ],
      });
      expect(dryRunManifest.files).toEqual(staticExportManifest(written).files);
      await expect(readFile(join(outDir, 'docs/intro/index.html'), 'utf8')).resolves.toContain(
        '<link rel="stylesheet" href="/assets/docs.css">',
      );
      await expect(readFile(join(outDir, 'c/docs.client.js'), 'utf8')).resolves.toBe(
        'export const docsClient = true;',
      );
      await expect(readFile(join(outDir, 'assets/docs.css'), 'utf8')).resolves.toBe(
        '.docs{display:grid}',
      );
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
