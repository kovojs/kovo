import { publicAccess } from './access.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { route } from './route.js';
import { StaticExportError } from './static-export-diagnostics.js';
import {
  kovoAppShellViteManifestAssets,
  kovoAppShellViteManifestAssetsFromFile,
  kovoAppShellViteManifestFromBundle,
  kovoAppShellViteManifestFromFile,
  kovoAppShellViteManifestHints,
  kovoAppShellViteManifestStylesheetHref,
  kovoAppShellViteManifestStylesheetHrefFromFile,
  kovoAppShellViteRouteEntries,
} from './vite-manifest.js';

describe('server app shell Vite manifest planning', () => {
  it('extracts deterministic stylesheet and modulepreload hints from a Vite manifest', () => {
    expect(
      kovoAppShellViteManifestHints(
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

  it('validates Vite hint asset paths through the static-host dist boundary', () => {
    expect(
      kovoAppShellViteManifestHints(
        {
          'src/cart.client.ts': {
            css: ['/assets/cart.css', 'https://cdn.example.test/reset.css'],
            file: '/assets/cart.js',
          },
        },
        ['src/cart.client.ts'],
        { base: '/static/' },
      ),
    ).toEqual({
      modulepreloads: ['/static/assets/cart.js'],
      stylesheets: ['/static/assets/cart.css', 'https://cdn.example.test/reset.css'],
    });

    expect(() =>
      kovoAppShellViteManifestHints(
        {
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: '../cart.js',
          },
        },
        ['src/cart.client.ts'],
      ),
    ).toThrow('App shell build asset must stay within the Vite output directory');

    expect(() =>
      kovoAppShellViteManifestHints(
        {
          'src/cart.client.ts': {
            css: ['assets/%2e%2e/cart.css'],
            file: 'assets/cart.js',
          },
        },
        ['src/cart.client.ts'],
      ),
    ).toThrow('App shell build asset must stay within the Vite output directory');
  });

  it('normalizes route-to-Vite-entry build facts in app route order', () => {
    const cartRoute = route('/cart', { access: publicAccess('test fixture') });
    const accountRoute = route('/account', { access: publicAccess('test fixture') });
    const entries = kovoAppShellViteRouteEntries(
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

  it('rejects invalid route-to-Vite-entry build facts before hint wiring', () => {
    expect(() =>
      kovoAppShellViteRouteEntries(
        {
          '/missing': 'src/missing.client.ts',
        },
        { routes: [route('/cart', { access: publicAccess('test fixture') })] },
      ),
    ).toThrow('App shell route build entry does not match an app route: /missing');

    expect(() =>
      kovoAppShellViteRouteEntries(
        {
          '/cart': 'src/cart.client.ts',
        },
        {
          manifest: {
            'src/other.client.ts': {
              file: 'assets/other.js',
            },
          },
          routes: [route('/cart', { access: publicAccess('test fixture') })],
        },
      ),
    ).toThrow(
      'App shell route build entry is missing from the Vite manifest: /cart -> src/cart.client.ts',
    );
  });

  it('plans deterministic Vite dist assets from the manifest', () => {
    expect(
      kovoAppShellViteManifestAssets(
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

  it('loads Vite manifest files through the shared app-shell validator', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-manifest-file-'));

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

      await expect(kovoAppShellViteManifestFromFile(manifestFile)).resolves.toEqual({
        'src/cart.client.ts': {
          css: ['assets/cart.css'],
          file: 'assets/cart.js',
        },
      });
      await expect(kovoAppShellViteManifestAssetsFromFile(manifestFile)).resolves.toEqual([
        { file: 'assets/cart.css', href: '/assets/cart.css', path: '/assets/cart.css' },
        { file: 'assets/cart.js', href: '/assets/cart.js', path: '/assets/cart.js' },
      ]);
      await expect(kovoAppShellViteManifestStylesheetHrefFromFile(manifestFile)).resolves.toBe(
        '/assets/cart.css',
      );
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });

  it('rejects non-file Vite manifest URLs before filesystem reads', async () => {
    await expect(
      kovoAppShellViteManifestFromFile(new URL('https://cdn.example.test/.vite/manifest.json')),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining(
            'Vite app-shell manifest files must be filesystem paths or file: URLs',
          ),
          routePath: 'vite-manifestFile',
        },
      ],
    });
    await expect(
      kovoAppShellViteManifestAssetsFromFile(
        new URL('https://cdn.example.test/.vite/manifest.json'),
      ),
    ).rejects.toBeInstanceOf(StaticExportError);
    await expect(
      kovoAppShellViteManifestStylesheetHrefFromFile(
        new URL('https://cdn.example.test/.vite/manifest.json'),
      ),
    ).rejects.toBeInstanceOf(StaticExportError);
  });

  it('rejects multi-stylesheet manifests for singular export task stylesheet lookup', () => {
    expect(() =>
      kovoAppShellViteManifestStylesheetHref(
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

  it('resolves exactly one built stylesheet href for export tasks', () => {
    expect(
      kovoAppShellViteManifestStylesheetHref(
        {
          'src/cart.ts': {
            css: ['assets/cart.css', 'https://cdn.example.test/reset.css'],
            file: 'assets/cart.js',
          },
        },
        { base: '/docs/' },
      ),
    ).toBe('/docs/assets/cart.css');
  });

  it('resolves exactly one built stylesheet href for starter export tasks', () => {
    expect(
      kovoAppShellViteManifestStylesheetHref(
        {
          'src/app.ts': {
            css: ['assets/app.css'],
            file: 'assets/app.js',
          },
        },
        { base: '/static/' },
      ),
    ).toBe('/static/assets/app.css');

    expect(() =>
      kovoAppShellViteManifestStylesheetHref({
        'src/app.ts': {
          file: 'assets/app.js',
        },
      }),
    ).toThrow('App shell Vite build manifest must contain exactly one stylesheet asset; found 0.');

    expect(() =>
      kovoAppShellViteManifestStylesheetHref({
        'src/admin.ts': {
          css: ['assets/admin.css'],
          file: 'assets/admin.js',
        },
        'src/cart.ts': {
          css: ['assets/cart.css'],
          file: 'assets/cart.js',
        },
      }),
    ).toThrow('App shell Vite build manifest must contain exactly one stylesheet asset; found 2.');
  });

  it('rejects malformed Vite output bundle manifests before app-shell build wiring', () => {
    expect(() => kovoAppShellViteManifestFromBundle({})).toThrow(
      'App shell Vite build requires .vite/manifest.json.',
    );

    expect(() =>
      kovoAppShellViteManifestFromBundle({
        '.vite/manifest.json': {
          fileName: '.vite/manifest.json',
          source: '{',
          type: 'asset',
        },
      }),
    ).toThrow('App shell Vite build manifest must be valid JSON');

    expect(() =>
      kovoAppShellViteManifestFromBundle({
        '.vite/manifest.json': {
          fileName: '.vite/manifest.json',
          source: JSON.stringify([]),
          type: 'asset',
        },
      }),
    ).toThrow('App shell Vite build manifest must be a JSON object.');

    expect(() =>
      kovoAppShellViteManifestFromBundle({
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
      }),
    ).toThrow(
      "App shell Vite build manifest entry 'src/cart.client.ts' field 'css' must be an array of strings.",
    );
  });

  it('rejects malformed manifest files and unsafe output asset paths before export wiring', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-bad-manifest-file-'));

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

      await expect(kovoAppShellViteManifestAssetsFromFile(manifestFile)).rejects.toThrow(
        "App shell Vite build manifest entry 'src/cart.client.ts' field 'css' must be an array of strings.",
      );
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }

    expect(() =>
      kovoAppShellViteManifestAssets({
        'src/cart.client.ts': {
          file: '../cart.js',
        },
      }),
    ).toThrow('App shell build asset must stay within the Vite output directory');
  });
});
