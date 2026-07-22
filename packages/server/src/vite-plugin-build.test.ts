import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { clientModuleRepresentationDigest } from '@kovojs/core/internal/client-module-url';
import { createApp } from './app.js';
import { computeRenderPlanFingerprint, versionedClientModuleHref } from './client-modules.js';
import { renderedHtml } from './html.js';
import { route } from './route.js';
import { writeKovoAppShellVitePluginBuild } from './vite-plugin-build.js';
import type { KovoAppShellBuild } from './vite-build.js';
import type { KovoAppShellViteBuildOutput } from './vite-build-output.js';

const testRenderPlanFingerprint = computeRenderPlanFingerprint({
  test: 'field:id',
});

describe('server app shell Vite plugin build boundary', () => {
  it('writes plugin build output and static export through the shared Vite build helper', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-plugin-build-helper-dist-'));
    const exportDir = await mkdtemp(join(tmpdir(), 'kovo-vite-plugin-build-helper-export-'));
    const built: KovoAppShellBuild[] = [];
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

      const result = await writeKovoAppShellVitePluginBuild({
        app: createApp({
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
        buildOptions: {
          clientModules: [
            {
              path: '/c/cart.client.js',
              renderPlanFingerprint: testRenderPlanFingerprint,
              source: cartClientSource,
            },
          ],
          onBuild(build, output) {
            built.push(build);
            outputs.push(output);
          },
          routeEntryMap: {
            '/cart': 'src/cart.client.ts',
          },
          staticExport: {
            outDir: exportDir,
          },
        },
        bundle: {
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
        outputOptions: { dir: outDir },
      });

      expect(result.build.routeHints).toEqual([
        {
          hints: {
            modulepreloads: ['/assets/cart.js'],
            stylesheets: ['/assets/cart.css'],
          },
          routePath: '/cart',
        },
      ]);
      expect(result.output.clientModuleOutputPlan).toEqual([
        {
          path: cartClientHref,
          targetPath: join(outDir, cartClientHref.slice(1)),
        },
      ]);
      expect(result.output.staticExportAssets).toEqual([
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
      expect(result.output.staticExport?.artifacts.map((artifact) => artifact.path)).toEqual([
        '/cart/index.html',
      ]);
      expect(result.output.staticExport?.clientModules).toEqual([
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
      expect(built).toEqual([result.build]);
      expect(outputs).toEqual([result.output]);
      await expect(readFile(join(outDir, cartClientHref.slice(1)), 'utf8')).resolves.toBe(
        cartClientSource,
      );
      await expect(readFile(join(exportDir, 'cart/index.html'), 'utf8')).resolves.toMatch(
        /<link rel="stylesheet" href="\/assets\/cart\.css" integrity="sha384-[^"]+">/,
      );
      await expect(readFile(join(exportDir, cartClientHref.slice(1)), 'utf8')).resolves.toBe(
        cartClientSource,
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
