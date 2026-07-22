import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { clientModuleRepresentationDigest } from '@kovojs/core/internal/client-module-url';
import { createApp } from './app.js';
import { computeRenderPlanFingerprint, versionedClientModuleHref } from './client-modules.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';
import { createKovoAppShellViteBuild } from './vite-build.js';
import type { KovoAppShellViteBuildOutput } from './vite-build-output.js';
import { exportKovoAppShellViteBuild } from './vite-static-export-build.js';
import { exportKovoAppShellViteBuildFromManifestFile } from './vite-static-export-manifest-file.js';
import { kovoAppShellVitePlugin } from './internal/app-shell-vite.js';
import { kovoAppShellViteStaticExportAssets } from './vite-build-assets.js';
import { renderedHtml } from './html.js';

const testRenderPlanFingerprint = computeRenderPlanFingerprint({
  test: 'field:id',
});

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
                return renderedHtml('<main>Cart</main>');
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
                return renderedHtml('<main class="cart">Cart</main>');
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
      expect(result.artifacts[0]?.body).toMatch(
        /<link rel="stylesheet" href="\/assets\/cart\.css" integrity="sha384-[^"]+">/,
      );
      expect(result.artifacts[0]?.body).toMatch(
        /<link rel="modulepreload" href="\/assets\/cart\.js" integrity="sha384-[^"]+">/,
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
      const cartClientSource = 'export const client = "cart";';
      const cartClientHref = versionedClientModuleHref(
        '/c/cart.client.js',
        clientModuleRepresentationDigest(cartClientSource),
      );

      const result = await exportKovoAppShellViteBuildFromManifestFile({
        app: createApp({
          routes: [
            route('/cart', {
              modulepreloads: [cartClientHref],
              page() {
                return renderedHtml('<main class="cart">Cart</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: cartClientSource,
          },
        ],
        distDir,
        outDir,
        routeEntryMap: {
          '/cart': 'src/cart.client.ts',
        },
      });

      expect(result.artifacts[0]?.path).toBe('/cart/index.html');
      expect(result.artifacts[0]?.body).toMatch(
        /<link rel="stylesheet" href="\/assets\/cart\.css" integrity="sha384-[^"]+">/,
      );
      expect(result.artifacts[0]?.body).toMatch(
        new RegExp(
          `<link rel="modulepreload" href="${cartClientHref}" data-kovo-module-allowlist integrity="sha384-[^"]+">`,
        ),
      );
      expect(result.artifacts[0]?.body).toMatch(
        /<link rel="modulepreload" href="\/assets\/cart\.js" integrity="sha384-[^"]+">/,
      );
      expect(result.clientModules).toEqual([
        {
          body: 'export const client = "cart";',
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'cross-origin-resource-policy': 'same-origin',
            'content-type': 'text/javascript; charset=utf-8',
            'x-content-type-options': 'nosniff',
          },
          href: cartClientHref,
          path: cartClientHref,
          status: 200,
        },
        {
          body: expect.stringContaining('installKovoDeferredRuntime'),
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'cross-origin-resource-policy': 'same-origin',
            'content-type': 'text/javascript; charset=utf-8',
            'x-content-type-options': 'nosniff',
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
      await expect(readFile(join(outDir, cartClientHref.slice(1)), 'utf8')).resolves.toBe(
        cartClientSource,
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
                  return renderedHtml('<main class="cart">Cart</main>');
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

  it('fails closed when Vite-backed static export replays a redirect route outcome', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-redirect-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-redirect-export-'));

    try {
      const build = createKovoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/old-home', {
              page() {
                return { location: '/', status: 303 } as never;
              },
            }),
            route('/', {
              page() {
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        manifest: {},
        routeEntryMap: {},
      });

      await expect(exportKovoAppShellViteBuild(build, { distDir, outDir })).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining('replay returned redirect status 303'),
            routePath: '/old-home',
          },
        ],
      });
      await expect(readFile(join(outDir, 'old-home', 'index.html'), 'utf8')).rejects.toThrow();
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
    const cartClientSource = 'export const cartClient = true;';
    const cartClientHref = versionedClientModuleHref(
      '/c/cart.client.js',
      clientModuleRepresentationDigest(cartClientSource),
    );

    try {
      await mkdir(join(outDir, 'assets'), { recursive: true });
      await writeFile(join(outDir, 'assets/cart.css'), '.cart{display:grid}');
      await writeFile(join(outDir, 'assets/cart.js'), 'export const cartAsset = true;');

      const plugin = kovoAppShellVitePlugin(
        createApp({
          routes: [
            route('/cart', {
              page() {
                return renderedHtml(
                  [
                    '<main class="cart">Cart',
                    `<button on:click="${cartClientHref}#Cart$add">Add</button>`,
                    '</main>',
                  ].join(''),
                );
              },
            }),
          ],
        }),
        {
          build: {
            clientModules: [
              {
                path: '/c/cart.client.js',
                renderPlanFingerprint: testRenderPlanFingerprint,
                source: cartClientSource,
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
          path: cartClientHref,
          targetPath: join(outDir, cartClientHref.slice(1)),
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
            'cross-origin-resource-policy': 'same-origin',
            'content-type': 'text/javascript; charset=utf-8',
            'x-content-type-options': 'nosniff',
          },
          href: `${cartClientHref}#Cart$add`,
          path: cartClientHref,
          status: 200,
        },
        {
          body: expect.stringContaining('installKovoDeferredRuntime'),
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'cross-origin-resource-policy': 'same-origin',
            'content-type': 'text/javascript; charset=utf-8',
            'x-content-type-options': 'nosniff',
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
      await expect(readFile(join(outDir, cartClientHref.slice(1)), 'utf8')).resolves.toBe(
        cartClientSource,
      );
      await expect(readFile(join(exportDir, 'cart/index.html'), 'utf8')).resolves.toMatch(
        /<link rel="stylesheet" href="\/assets\/cart\.css" integrity="sha384-[^"]+">/,
      );
      await expect(readFile(join(exportDir, 'cart/index.html'), 'utf8')).resolves.toContain(
        `<button on:click="${cartClientHref}#Cart$add">Add</button>`,
      );
      await expect(readFile(join(exportDir, cartClientHref.slice(1)), 'utf8')).resolves.toBe(
        cartClientSource,
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
