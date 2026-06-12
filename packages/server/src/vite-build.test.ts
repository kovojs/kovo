import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { route } from './route.js';
import {
  createJisoAppShellViteBuild,
  exportJisoAppShellViteBuild,
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
});
