import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { route } from './route.js';
import { StaticExportError } from './static-export-diagnostics.js';
import { createJisoAppShellViteBuild } from './vite-build.js';
import {
  jisoAppShellViteBuildDryRunStaticExportOptions,
  jisoAppShellViteBuildWriteStaticExportOptions,
  jisoAppShellViteManifestFileDryRunStaticExportOptions,
  jisoAppShellViteManifestFileWriteStaticExportOptions,
} from './vite-static-export-options.js';

describe('server app shell Vite static export options boundary', () => {
  it('normalizes build static-export options without changing the replay contract', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-static-export-options-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-static-export-options-out-'));

    try {
      const build = createJisoAppShellViteBuild({
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
        jisoAppShellViteBuildWriteStaticExportOptions(build, {
          assets: [robots],
          distDir,
          htmlPathStyle: 'flat',
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
        htmlPathStyle: 'flat',
        onNonExportable: 'skip',
        origin: 'https://static.example',
        outDir,
      });

      expect(
        jisoAppShellViteBuildDryRunStaticExportOptions(build, {
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

  it('projects manifest-file options without leaking build-only fields', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-manifest-export-options-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-manifest-export-options-out-'));

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
        jisoAppShellViteManifestFileWriteStaticExportOptions({
          app,
          assets: [robots],
          base: '/docs/',
          clientModules,
          distDir,
          htmlPathStyle: 'flat',
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
        htmlPathStyle: 'flat',
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
      expect(jisoAppShellViteManifestFileDryRunStaticExportOptions(dryRunOptions)).toEqual({
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
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-dry-run-reject-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-dry-run-reject-out-'));

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
      const build = createJisoAppShellViteBuild({
        app,
        manifest: {},
      });
      const expectedError = {
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
            message: expect.stringContaining(
              'Vite app-shell static export inventory/manifest tasks are dry runs and must not receive outDir.',
            ),
            routePath: 'vite-static-export',
          },
        ],
      };

      let buildError: unknown;
      try {
        jisoAppShellViteBuildDryRunStaticExportOptions(build, {
          distDir,
          outDir,
        } as unknown as Parameters<typeof jisoAppShellViteBuildDryRunStaticExportOptions>[1]);
      } catch (error) {
        buildError = error;
      }
      expect(buildError).toBeInstanceOf(StaticExportError);
      expect(buildError).toMatchObject(expectedError);

      let manifestFileError: unknown;
      try {
        jisoAppShellViteManifestFileDryRunStaticExportOptions({
          app,
          distDir,
          outDir,
        } as unknown as Parameters<
          typeof jisoAppShellViteManifestFileDryRunStaticExportOptions
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
});
