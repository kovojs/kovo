import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { route } from './route.js';
import { writeJisoAppShellVitePluginBuild } from './vite-plugin-build.js';
import type { JisoAppShellBuild } from './vite-build.js';
import type { JisoAppShellViteBuildOutput } from './vite-build-output.js';

describe('server app shell Vite plugin build boundary', () => {
  it('writes plugin build output and static export through the shared Vite build helper', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-plugin-build-helper-dist-'));
    const exportDir = await mkdtemp(join(tmpdir(), 'jiso-vite-plugin-build-helper-export-'));
    const built: JisoAppShellBuild[] = [];
    const outputs: JisoAppShellViteBuildOutput[] = [];

    try {
      await mkdir(join(outDir, 'assets'), { recursive: true });
      await writeFile(join(outDir, 'assets/cart.css'), '.cart{display:grid}');
      await writeFile(join(outDir, 'assets/cart.js'), 'export const cartAsset = true;');

      const result = await writeJisoAppShellVitePluginBuild({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return [
                  '<main class="cart">Cart',
                  '<button on:click="/c/cart.client.js?v=cart-v1#Cart$add">Add</button>',
                  '</main>',
                ].join('');
              },
            }),
          ],
        }),
        buildOptions: {
          clientModules: [
            {
              path: '/c/cart.client.js',
              source: 'export const cartClient = true;',
              version: 'cart-v1',
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
          path: '/c/cart.client.js',
          targetPath: join(outDir, 'c/cart.client.js'),
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
            'content-type': 'text/javascript; charset=utf-8',
          },
          href: '/c/cart.client.js?v=cart-v1#Cart$add',
          path: '/c/cart.client.js',
          status: 200,
        },
      ]);
      expect(built).toEqual([result.build]);
      expect(outputs).toEqual([result.output]);
      await expect(readFile(join(outDir, 'c/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cartClient = true;',
      );
      await expect(readFile(join(exportDir, 'cart/index.html'), 'utf8')).resolves.toContain(
        '<link rel="stylesheet" href="/assets/cart.css">',
      );
      await expect(readFile(join(exportDir, 'c/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cartClient = true;',
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
