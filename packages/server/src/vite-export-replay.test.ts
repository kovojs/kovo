import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';
import { createKovoAppShellViteBuild } from './vite-build.js';
import type { KovoAppShellViteBuildOutput } from './vite-build-output.js';
import { exportKovoAppShellViteBuild } from './vite-static-export-build.js';
import { exportKovoAppShellViteBuildFromManifestFile } from './vite-static-export-manifest-file.js';
import { kovoAppShellVitePlugin } from './internal/app-shell-vite.js';
import { kovoAppShellViteStaticExportAssets } from './vite-build-assets.js';

describe('server app shell Vite plugin', () => {
  it('turns Vite build asset plans into static-export copy inputs', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-export-'));

    try {
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart{color:oklch(50% 0.1 180)}');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const cart = true;');

      const build = createKovoAppShellViteBuild({
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
      const assets = kovoAppShellViteStaticExportAssets(build.assets, { distDir });

      expect(assets).toEqual([
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

      const result = await exportStaticApp(build.app, { assets, outDir });

      expect(result.assets).toEqual([
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          path: '/assets/cart.css',
          source: join(distDir, 'assets/cart.css'),
          status: 200,
        },
        {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
          path: '/assets/cart.js',
          source: join(distDir, 'assets/cart.js'),
          status: 200,
        },
      ]);
      await expect(readFile(join(outDir, 'assets/cart.css'), 'utf8')).resolves.toBe(
        '.cart{color:oklch(50% 0.1 180)}',
      );
      await expect(readFile(join(outDir, 'assets/cart.js'), 'utf8')).resolves.toBe(
        'export const cart = true;',
      );
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('exports a Vite app-shell build with route-entry hints and copied dist assets', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-export-'));

    try {
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart{display:grid}');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const cart = "manifest";');

      const build = createKovoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return '<main class="cart">Cart</main>';
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

      const result = await exportKovoAppShellViteBuild(build, { distDir, outDir });

      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]?.path).toBe('/cart/index.html');
      expect(result.artifacts[0]?.body).toContain(
        '<link rel="stylesheet" href="/assets/cart.css">',
      );
      expect(result.artifacts[0]?.body).toContain(
        '<link rel="modulepreload" href="/assets/cart.js">',
      );
      expect(result.assets).toEqual([
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          path: '/assets/cart.css',
          source: join(distDir, 'assets/cart.css'),
          status: 200,
        },
        {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
          path: '/assets/cart.js',
          source: join(distDir, 'assets/cart.js'),
          status: 200,
        },
      ]);
      await expect(readFile(join(outDir, 'cart', 'index.html'), 'utf8')).resolves.toContain(
        '<main class="cart">Cart</main>',
      );
      await expect(readFile(join(outDir, 'assets/cart.css'), 'utf8')).resolves.toBe(
        '.cart{display:grid}',
      );
      await expect(readFile(join(outDir, 'assets/cart.js'), 'utf8')).resolves.toBe(
        'export const cart = "manifest";',
      );
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('exports a Vite app-shell build directly from the dist manifest file', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-dist-manifest-export-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-manifest-export-'));

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart{display:flex}');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const cart = "dist";');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        }),
      );

      const result = await exportKovoAppShellViteBuildFromManifestFile({
        app: createApp({
          routes: [
            route('/cart', {
              modulepreloads: ['/c/cart.client.js?v=cart-v1'],
              page() {
                return '<main class="cart">Cart</main>';
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            source: 'export const client = "cart";',
            version: 'cart-v1',
          },
        ],
        distDir,
        outDir,
        routeEntryMap: {
          '/cart': 'src/cart.client.ts',
        },
      });

      expect(result.artifacts[0]?.path).toBe('/cart/index.html');
      expect(result.artifacts[0]?.body).toContain(
        '<link rel="stylesheet" href="/assets/cart.css">',
      );
      expect(result.artifacts[0]?.body).toContain(
        '<link rel="modulepreload" href="/c/cart.client.js?v=cart-v1">',
      );
      expect(result.artifacts[0]?.body).toContain(
        '<link rel="modulepreload" href="/assets/cart.js">',
      );
      expect(result.clientModules).toEqual([
        {
          body: 'export const client = "cart";',
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'content-type': 'text/javascript; charset=utf-8',
          },
          href: '/c/cart.client.js?v=cart-v1',
          path: '/c/cart.client.js',
          status: 200,
        },
        {
          body: expect.stringContaining('installKovoDeferredRuntime'),
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'content-type': 'text/javascript; charset=utf-8',
          },
          href: expect.stringMatching(/^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/),
          path: expect.stringMatching(/^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/),
          status: 200,
        },
      ]);
      expect(result.assets).toEqual([
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          path: '/assets/cart.css',
          source: join(distDir, 'assets/cart.css'),
          status: 200,
        },
        {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
          path: '/assets/cart.js',
          source: join(distDir, 'assets/cart.js'),
          status: 200,
        },
      ]);
      await expect(readFile(join(outDir, 'cart', 'index.html'), 'utf8')).resolves.toContain(
        '<main class="cart">Cart</main>',
      );
      await expect(readFile(join(outDir, 'c', 'cart.client.js'), 'utf8')).resolves.toBe(
        'export const client = "cart";',
      );
      await expect(readFile(join(outDir, 'assets/cart.css'), 'utf8')).resolves.toBe(
        '.cart{display:flex}',
      );
      await expect(readFile(join(outDir, 'assets/cart.js'), 'utf8')).resolves.toBe(
        'export const cart = "dist";',
      );
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('rejects non-file Vite distDir URLs before manifest-file export replay', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-bad-dist-url-manifest-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-bad-dist-url-export-'));
    let rendered = false;

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      const manifestFile = join(distDir, '.vite/manifest.json');
      await writeFile(
        manifestFile,
        JSON.stringify({
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        }),
      );

      await expect(
        exportKovoAppShellViteBuildFromManifestFile({
          app: createApp({
            routes: [
              route('/cart', {
                page() {
                  rendered = true;
                  return '<main class="cart">Cart</main>';
                },
              }),
            ],
          }),
          distDir: new URL('https://cdn.example/dist/'),
          manifestFile,
          outDir,
          routeEntryMap: {
            '/cart': 'src/cart.client.ts',
          },
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            routePath: 'vite-distDir',
          },
        ],
      });

      expect(rendered).toBe(false);
      await expect(readFile(join(outDir, 'cart', 'index.html'), 'utf8')).rejects.toThrow();
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('runs app-shell static export from the Vite plugin writeBundle hook', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-plugin-build-export-dist-'));
    const exportDir = await mkdtemp(join(tmpdir(), 'kovo-vite-plugin-build-export-out-'));
    const outputs: KovoAppShellViteBuildOutput[] = [];

    try {
      await mkdir(join(outDir, 'assets'), { recursive: true });
      await writeFile(join(outDir, 'assets/cart.css'), '.cart{display:grid}');
      await writeFile(join(outDir, 'assets/cart.js'), 'export const cartAsset = true;');

      const plugin = kovoAppShellVitePlugin(
        createApp({
          routes: [
            route('/cart', {
              page() {
                return [
                  '<main class="cart">Cart',
                  '<button on:click="/c/__v/cart-v1/cart.client.js#Cart$add">Add</button>',
                  '</main>',
                ].join('');
              },
            }),
          ],
        }),
        {
          build: {
            clientModules: [
              {
                path: '/c/cart.client.js',
                source: 'export const cartClient = true;',
                version: 'cart-v1',
              },
            ],
            onBuild(_build, output) {
              outputs.push(output);
            },
            routeEntryMap: {
              '/cart': 'src/cart.client.ts',
            },
            staticExport: {
              outDir: exportDir,
            },
          },
        },
      );

      await plugin.writeBundle?.(
        { dir: outDir },
        {
          '.vite/manifest.json': {
            fileName: '.vite/manifest.json',
            source: JSON.stringify({
              'src/cart.client.ts': {
                css: ['assets/cart.css'],
                file: 'assets/cart.js',
              },
            }),
            type: 'asset',
          },
        },
      );

      expect(outputs).toHaveLength(1);
      expect(outputs[0]?.clientModuleOutputPlan).toEqual([
        {
          path: '/c/__v/cart-v1/cart.client.js',
          targetPath: join(outDir, 'c/__v/cart-v1/cart.client.js'),
        },
      ]);
      expect(outputs[0]?.staticExportAssets).toEqual([
        {
          contentType: 'text/css; charset=utf-8',
          path: '/assets/cart.css',
          source: join(outDir, 'assets/cart.css'),
        },
        {
          contentType: 'text/javascript; charset=utf-8',
          path: '/assets/cart.js',
          source: join(outDir, 'assets/cart.js'),
        },
      ]);
      expect(outputs[0]?.staticExport?.artifacts.map((artifact) => artifact.path)).toEqual([
        '/cart/index.html',
      ]);
      expect(outputs[0]?.staticExport?.clientModules).toEqual([
        {
          body: 'export const cartClient = true;',
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'content-type': 'text/javascript; charset=utf-8',
          },
          href: '/c/__v/cart-v1/cart.client.js#Cart$add',
          path: '/c/__v/cart-v1/cart.client.js',
          status: 200,
        },
        {
          body: expect.stringContaining('installKovoDeferredRuntime'),
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'content-type': 'text/javascript; charset=utf-8',
          },
          href: expect.stringMatching(/^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/),
          path: expect.stringMatching(/^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/),
          status: 200,
        },
      ]);
      expect(outputs[0]?.staticExport?.assets).toEqual([
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          path: '/assets/cart.css',
          source: join(outDir, 'assets/cart.css'),
          status: 200,
        },
        {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
          path: '/assets/cart.js',
          source: join(outDir, 'assets/cart.js'),
          status: 200,
        },
      ]);
      await expect(readFile(join(outDir, 'c/__v/cart-v1/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cartClient = true;',
      );
      await expect(readFile(join(exportDir, 'cart/index.html'), 'utf8')).resolves.toContain(
        '<link rel="stylesheet" href="/assets/cart.css">',
      );
      await expect(readFile(join(exportDir, 'cart/index.html'), 'utf8')).resolves.toContain(
        '<button on:click="/c/__v/cart-v1/cart.client.js#Cart$add">Add</button>',
      );
      await expect(readFile(join(exportDir, 'c/__v/cart-v1/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cartClient = true;',
      );
      await expect(readFile(join(exportDir, 'assets/cart.css'), 'utf8')).resolves.toBe(
        '.cart{display:grid}',
      );
      await expect(readFile(join(exportDir, 'assets/cart.js'), 'utf8')).resolves.toBe(
        'export const cartAsset = true;',
      );
    } finally {
      await Promise.all([
        rm(outDir, { force: true, recursive: true }),
        rm(exportDir, { force: true, recursive: true }),
      ]);
    }
  });
});
