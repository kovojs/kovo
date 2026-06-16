import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { route } from './route.js';
import { StaticExportError } from './static-export-diagnostics.js';
import { createKovoAppShellViteBuild } from './vite-build.js';
import {
  kovoAppShellViteBuildDryRunStaticExportOptions,
  kovoAppShellViteBuildOutputStaticExportPlan,
  kovoAppShellViteBuildWriteStaticExportOptions,
  kovoAppShellViteManifestFileDryRunStaticExportOptions,
  kovoAppShellViteManifestFileWriteStaticExportOptions,
} from './vite-static-export-options.js';

describe('server app shell Vite static export options boundary', () => {
  it('normalizes build static-export options without changing the replay contract', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-static-export-options-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-static-export-options-out-'));

    try {
      const build = createKovoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/shop', {
              page() {
                return '<main>Shop</main>';
              },
            }),
          ],
        }),
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
      const robots = {
        path: '/robots.txt',
        source: join(distDir, 'public/robots.txt'),
      };

      expect(
        kovoAppShellViteBuildWriteStaticExportOptions(build, {
          assets: [robots],
          distDir,
          onNonExportable: 'skip',
          origin: 'https://static.example',
          outDir,
        }),
      ).toEqual({
        assets: [
          {
            contentType: 'text/css; charset=utf-8',
            path: '/assets/shop.css',
            source: join(distDir, 'assets/shop.css'),
          },
          {
            contentType: 'text/javascript; charset=utf-8',
            path: '/assets/shop.js',
            source: join(distDir, 'assets/shop.js'),
          },
          robots,
        ],
        onNonExportable: 'skip',
        origin: 'https://static.example',
        outDir,
      });

      expect(
        kovoAppShellViteBuildDryRunStaticExportOptions(build, {
          assets: [robots],
          distDir,
        }),
      ).toEqual({
        assets: [
          {
            contentType: 'text/css; charset=utf-8',
            path: '/assets/shop.css',
            source: join(distDir, 'assets/shop.css'),
          },
          {
            contentType: 'text/javascript; charset=utf-8',
            path: '/assets/shop.js',
            source: join(distDir, 'assets/shop.js'),
          },
          robots,
        ],
      });
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('projects Vite build-output static export through one observable asset plan', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-output-export-options-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-output-export-options-out-'));

    try {
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
      const robots = {
        headers: { 'cache-control': 'public, max-age=60' },
        path: '/robots.txt',
        source: join(distDir, 'public/robots.txt'),
      };

      const plan = kovoAppShellViteBuildOutputStaticExportPlan(
        build,
        {
          assets: [robots],
          origin: 'https://cart.example',
          outDir,
        },
        distDir,
      );

      expect(plan.assets).toEqual([
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
        robots,
      ]);
      expect(plan.options).toEqual({
        assets: plan.assets,
        origin: 'https://cart.example',
        outDir,
      });
      expect(plan.options).not.toHaveProperty('distDir');
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('projects manifest-file options without leaking build-only fields', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-manifest-export-options-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-manifest-export-options-out-'));

    try {
      const app = createApp({
        routes: [
          route('/docs', {
            page() {
              return '<main>Docs</main>';
            },
          }),
        ],
      });
      const clientModules = [
        {
          path: '/c/docs.client.js',
          source: 'export const docs = true;',
          version: 'docs-v1',
        },
      ];
      const robots = {
        path: '/robots.txt',
        source: join(distDir, 'public/robots.txt'),
      };

      expect(
        kovoAppShellViteManifestFileWriteStaticExportOptions({
          app,
          assets: [robots],
          base: '/docs/',
          clientModules,
          distDir,
          manifestFile: join(distDir, 'manifest.web.json'),
          origin: 'https://docs.example',
          outDir,
          routeEntryMap: {
            '/docs': 'src/docs.client.ts',
          },
        }),
      ).toEqual({
        assets: [robots],
        distDir,
        origin: 'https://docs.example',
        outDir,
      });

      const dryRunOptions = {
        app,
        base: '/docs/',
        clientModules,
        distDir,
        manifestFile: join(distDir, 'manifest.web.json'),
        onNonExportable: 'skip' as const,
        routeEntryMap: {
          '/docs': 'src/docs.client.ts',
        },
      };
      expect(kovoAppShellViteManifestFileDryRunStaticExportOptions(dryRunOptions)).toEqual({
        distDir,
        onNonExportable: 'skip',
      });
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('rejects write targets on dry-run inventory option helpers', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-dry-run-reject-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-dry-run-reject-out-'));

    try {
      const app = createApp({
        routes: [
          route('/preview', {
            page() {
              return '<main>Preview</main>';
            },
          }),
        ],
      });
      const build = createKovoAppShellViteBuild({
        app,
        manifest: {},
      });
      const expectedError = {
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining(
              'Vite app-shell static export inventory/manifest tasks are dry runs and must not receive outDir.',
            ),
            routePath: 'vite-static-export',
          },
        ],
      };

      let buildError: unknown;
      try {
        kovoAppShellViteBuildDryRunStaticExportOptions(build, {
          distDir,
          outDir,
        } as unknown as Parameters<typeof kovoAppShellViteBuildDryRunStaticExportOptions>[1]);
      } catch (error) {
        buildError = error;
      }
      expect(buildError).toBeInstanceOf(StaticExportError);
      expect(buildError).toMatchObject(expectedError);

      let manifestFileError: unknown;
      try {
        kovoAppShellViteManifestFileDryRunStaticExportOptions({
          app,
          distDir,
          outDir,
        } as unknown as Parameters<
          typeof kovoAppShellViteManifestFileDryRunStaticExportOptions
        >[0]);
      } catch (error) {
        manifestFileError = error;
      }
      expect(manifestFileError).toBeInstanceOf(StaticExportError);
      expect(manifestFileError).toMatchObject(expectedError);
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('rejects build-only distDir on plugin-time static export options', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-output-reject-dist-'));
    const staleDistDir = await mkdtemp(join(tmpdir(), 'kovo-vite-output-reject-stale-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-output-reject-out-'));

    try {
      const build = createKovoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/plugin', {
              page() {
                return '<main>Plugin</main>';
              },
            }),
          ],
        }),
        manifest: {
          'src/plugin.client.ts': {
            css: ['assets/plugin.css'],
            file: 'assets/plugin.js',
          },
        },
        routeEntryMap: {
          '/plugin': 'src/plugin.client.ts',
        },
      });

      let error: unknown;
      try {
        kovoAppShellViteBuildOutputStaticExportPlan(
          build,
          {
            distDir: staleDistDir,
            outDir,
          } as unknown as Parameters<typeof kovoAppShellViteBuildOutputStaticExportPlan>[1],
          distDir,
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(StaticExportError);
      expect(error).toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining(
              'Vite app-shell plugin/build-output static export uses the Vite output directory as its asset root and must not receive distDir.',
            ),
            routePath: 'vite-static-export',
          },
        ],
      });
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(staleDistDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });
});
