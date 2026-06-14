import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { route } from './route.js';
import {
  createJisoAppShellViteBuildFromBundle,
  jisoAppShellViteManifestStylesheetHrefFromFile,
  jisoAppShellVitePlugin,
} from './api/app-shell/vite.js';
import {
  jisoAppShellViteManifestAssets,
  jisoAppShellViteManifestAssetsFromFile,
  jisoAppShellViteManifestFromBundle,
  jisoAppShellViteManifestFromFile,
  jisoAppShellViteManifestHints,
  jisoAppShellViteManifestStylesheetHref,
  jisoAppShellViteRouteEntries,
} from './vite-manifest.js';
import { jisoAppShellVitePlugin as splitJisoAppShellVitePlugin } from './vite-plugin.js';

describe('server app shell Vite plugin', () => {
  it('exports the Vite plugin from the split plugin boundary', () => {
    expect(jisoAppShellVitePlugin).toBe(splitJisoAppShellVitePlugin);

    const app = createApp();
    expect(jisoAppShellVitePlugin(app).name).toBe('jiso-app-shell');
    expect(() =>
      jisoAppShellVitePlugin(createRequestHandler(app) as unknown as ReturnType<typeof createApp>),
    ).toThrow(
      'jisoAppShellVitePlugin() requires a Jiso app aggregate. SPEC §9.5 Vite dev/build/export replay must start from createApp(), not a raw request handler or compatibility shell.',
    );
    expect(() =>
      jisoAppShellVitePlugin({ routes: [], endpoints: [] } as unknown as ReturnType<
        typeof createApp
      >),
    ).toThrow('jisoAppShellVitePlugin() requires a Jiso app aggregate.');

    function expectVitePluginAppOnly(app: ReturnType<typeof createApp>): void {
      jisoAppShellVitePlugin(app);
      // SPEC.md section 9.5: R5 plugin inputs stay tied to the closed app aggregate
      // so request ownership, diagnostics, build, and export replay share one shell.
      // @ts-expect-error raw request handlers are node-adapter boundaries, not Vite plugin apps.
      jisoAppShellVitePlugin(createRequestHandler(app));
    }
    void expectVitePluginAppOnly;
  });

  it('extracts deterministic stylesheet and modulepreload hints from a Vite manifest', () => {
    expect(
      jisoAppShellViteManifestHints(
        {
          '_shared.js': {
            css: ['assets/theme.css', 'assets/cart.css'],
            file: 'assets/shared.js',
          },
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
            imports: ['_shared.js'],
          },
          'src/recommendations.client.ts': {
            css: ['assets/recommendations.css'],
            file: 'assets/recommendations.js',
            imports: ['_shared.js'],
          },
        },
        ['src/cart.client.ts', 'src/recommendations.client.ts'],
      ),
    ).toEqual({
      modulepreloads: ['/assets/cart.js', '/assets/shared.js', '/assets/recommendations.js'],
      stylesheets: ['/assets/cart.css', '/assets/theme.css', '/assets/recommendations.css'],
    });
  });

  it('normalizes route-to-Vite-entry build facts in app route order', () => {
    const cartRoute = route('/cart', {});
    const accountRoute = route('/account', {});
    const entries = jisoAppShellViteRouteEntries(
      {
        '/account': 'src/account.client.ts',
        '/cart': ['src/cart.client.ts', 'assets/cart.js', 'src/cart.client.ts'],
      },
      {
        manifest: {
          'src/account.client.ts': {
            file: 'assets/account.js',
          },
          'src/cart.client.ts': {
            file: 'assets/cart.js',
          },
        },
        routes: [cartRoute, accountRoute],
      },
    );

    expect(entries).toEqual([
      { entries: ['src/cart.client.ts', 'assets/cart.js'], routePath: '/cart' },
      { entries: ['src/account.client.ts'], routePath: '/account' },
    ]);
  });

  it('rejects stale route-to-Vite-entry build facts before hint wiring', () => {
    expect(() =>
      jisoAppShellViteRouteEntries(
        {
          '/missing': 'src/missing.client.ts',
        },
        { routes: [route('/cart', {})] },
      ),
    ).toThrow('App shell route build entry does not match an app route: /missing');
  });

  it('rejects route-to-Vite-entry build facts missing from the manifest', () => {
    expect(() =>
      jisoAppShellViteRouteEntries(
        {
          '/cart': 'src/cart.client.ts',
        },
        {
          manifest: {
            'src/other.client.ts': {
              file: 'assets/other.js',
            },
          },
          routes: [route('/cart', {})],
        },
      ),
    ).toThrow(
      'App shell route build entry is missing from the Vite manifest: /cart -> src/cart.client.ts',
    );
  });

  it('plans deterministic Vite dist assets from the manifest', () => {
    expect(
      jisoAppShellViteManifestAssets(
        {
          'src/cart.client.ts': {
            css: ['assets/cart.css', '/assets/theme.css'],
            file: 'assets/cart.js',
          },
          'src/recommendations.client.ts': {
            css: ['assets/cart.css', 'https://cdn.example.test/reset.css'],
            file: 'assets/recommendations.js',
          },
        },
        { base: '/static/' },
      ),
    ).toEqual([
      { file: 'assets/cart.css', href: '/static/assets/cart.css', path: '/static/assets/cart.css' },
      { file: 'assets/cart.js', href: '/static/assets/cart.js', path: '/static/assets/cart.js' },
      {
        file: 'assets/recommendations.js',
        href: '/static/assets/recommendations.js',
        path: '/static/assets/recommendations.js',
      },
      {
        file: 'assets/theme.css',
        href: '/static/assets/theme.css',
        path: '/static/assets/theme.css',
      },
    ]);
  });

  it('rejects multi-stylesheet manifests for singular export task stylesheet lookup', () => {
    expect(() =>
      jisoAppShellViteManifestStylesheetHref(
        {
          'src/admin.ts': {
            css: ['assets/shared.css', 'assets/admin.css'],
            file: 'assets/admin.js',
          },
          'src/cart.ts': {
            css: ['assets/shared.css', 'assets/cart.css'],
            file: 'assets/cart.js',
          },
        },
        { base: '/docs/' },
      ),
    ).toThrow('App shell Vite build manifest must contain exactly one stylesheet asset; found 3.');
  });

  it('resolves exactly one built stylesheet href through the app-shell Vite API', () => {
    expect(
      jisoAppShellViteManifestStylesheetHref(
        {
          'src/cart.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        },
        { base: '/docs/' },
      ),
    ).toBe('/docs/assets/cart.css');
  });

  it('rejects Vite output bundles without a manifest before app-shell build wiring', () => {
    expect(() => jisoAppShellViteManifestFromBundle({})).toThrow(
      'App shell Vite build requires .vite/manifest.json.',
    );
  });

  it('rejects malformed Vite output bundle manifests before app-shell build wiring', () => {
    expect(() =>
      jisoAppShellViteManifestFromBundle({
        '.vite/manifest.json': {
          fileName: '.vite/manifest.json',
          source: '{',
          type: 'asset',
        },
      }),
    ).toThrow('App shell Vite build manifest must be valid JSON');

    expect(() =>
      jisoAppShellViteManifestFromBundle({
        '.vite/manifest.json': {
          fileName: '.vite/manifest.json',
          source: JSON.stringify([]),
          type: 'asset',
        },
      }),
    ).toThrow('App shell Vite build manifest must be a JSON object.');

    expect(() =>
      createJisoAppShellViteBuildFromBundle({
        app: createApp({ routes: [route('/cart', {})] }),
        bundle: {
          '.vite/manifest.json': {
            fileName: '.vite/manifest.json',
            source: JSON.stringify({
              'src/cart.client.ts': {
                css: ['assets/cart.css', 42],
                file: 'assets/cart.js',
              },
            }),
            type: 'asset',
          },
        },
        routeEntryMap: {
          '/cart': 'src/cart.client.ts',
        },
      }),
    ).toThrow(
      "App shell Vite build manifest entry 'src/cart.client.ts' field 'css' must be an array of strings.",
    );
  });

  it('rejects unsafe Vite output asset paths before they can be copied', () => {
    expect(() =>
      jisoAppShellViteManifestAssets({
        'src/cart.client.ts': {
          file: '../cart.js',
        },
      }),
    ).toThrow('App shell build asset must stay within the Vite output directory');
  });

  it('loads Vite manifest files through the shared app-shell validator', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-manifest-file-'));

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

      await expect(jisoAppShellViteManifestFromFile(manifestFile)).resolves.toEqual({
        'src/cart.client.ts': {
          css: ['assets/cart.css'],
          file: 'assets/cart.js',
        },
      });
      await expect(jisoAppShellViteManifestAssetsFromFile(manifestFile)).resolves.toEqual([
        { file: 'assets/cart.css', href: '/assets/cart.css', path: '/assets/cart.css' },
        { file: 'assets/cart.js', href: '/assets/cart.js', path: '/assets/cart.js' },
      ]);
      await expect(jisoAppShellViteManifestStylesheetHrefFromFile(manifestFile)).resolves.toBe(
        '/assets/cart.css',
      );
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });

  it('rejects malformed Vite manifest files before export asset wiring', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-bad-manifest-file-'));

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      const manifestFile = join(distDir, '.vite/manifest.json');
      await writeFile(
        manifestFile,
        JSON.stringify({
          'src/cart.client.ts': {
            css: ['assets/cart.css', 42],
            file: 'assets/cart.js',
          },
        }),
      );

      await expect(jisoAppShellViteManifestAssetsFromFile(manifestFile)).rejects.toThrow(
        "App shell Vite build manifest entry 'src/cart.client.ts' field 'css' must be an array of strings.",
      );
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });
});
