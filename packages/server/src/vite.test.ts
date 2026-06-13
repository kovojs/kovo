import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';
import {
  createJisoAppShellDevDiagnosticLedger,
  createJisoAppShellViteBuild,
  createJisoAppShellViteBuildFromBundle,
  createJisoAppShellViteBuildFromManifestFile,
  exportJisoAppShellViteBuild,
  exportJisoAppShellViteBuildFromManifestFile,
  jisoAppShellViteManifestAssets,
  jisoAppShellViteManifestAssetsFromFile,
  jisoAppShellViteManifestFromBundle,
  jisoAppShellViteManifestFromFile,
  jisoAppShellViteManifestHints,
  jisoAppShellViteManifestStylesheetHref,
  jisoAppShellViteManifestStylesheetHrefFromFile,
  jisoAppShellVitePlugin,
  jisoAppShellViteRouteEntries,
  jisoAppShellViteSsrDevPlugin,
  jisoAppShellViteStaticExportAssets,
  type JisoAppShellBuild,
  type JisoAppShellViteBuildOutput,
  type JisoAppShellViteMiddleware,
  writeJisoAppShellViteBuildOutput,
} from './api/app-shell/vite.js';
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

  it('wires build manifest hints and compiled client modules through the app shell', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const cartRoute = route('/cart', {
      modulepreloads: ['/c/manual.client.js?v=manual'],
      page() {
        return '<main><cart-badge>1</cart-badge></main>';
      },
      stylesheets: ['/assets/manual.css'],
    });
    const build = createJisoAppShellViteBuild({
      app: createApp({ clientModules: registry, routes: [cartRoute] }),
      clientModules: [
        {
          path: '/c/cart.client.js',
          source: 'export const cart = 1;',
        },
      ],
      manifest: {
        '_shared.js': {
          css: ['assets/theme.css'],
          file: 'assets/shared.js',
        },
        'src/cart.client.ts': {
          css: ['assets/cart.css'],
          file: 'assets/cart.js',
          imports: ['_shared.js'],
        },
      },
      routeEntryMap: {
        '/cart': 'src/cart.client.ts',
      },
    });
    const module = build.clientModules[0];
    if (!module) throw new Error('expected a compiled client module');
    expect(module).toMatchObject({
      file: 'c/cart.client.js',
      href: expect.stringMatching(/^\/c\/cart\.client\.js\?v=[a-f0-9]{12}$/),
      path: '/c/cart.client.js',
      source: 'export const cart = 1;',
    });
    expect(build.assets).toEqual([
      { file: 'assets/cart.css', href: '/assets/cart.css', path: '/assets/cart.css' },
      { file: 'assets/cart.js', href: '/assets/cart.js', path: '/assets/cart.js' },
      { file: 'assets/shared.js', href: '/assets/shared.js', path: '/assets/shared.js' },
      { file: 'assets/theme.css', href: '/assets/theme.css', path: '/assets/theme.css' },
    ]);
    expect(build.routeHints).toEqual([
      {
        hints: {
          modulepreloads: ['/assets/cart.js', '/assets/shared.js'],
          stylesheets: ['/assets/cart.css', '/assets/theme.css'],
        },
        routePath: '/cart',
      },
    ]);

    const handler = createRequestHandler(build.app);
    const routeResponse = await handler(new Request('https://example.test/cart'));

    expect(routeResponse.status).toBe(200);
    expect(routeResponse.headers.get('link')).toBe(
      '</assets/manual.css>; rel=preload; as=style, </assets/cart.css>; rel=preload; as=style, </assets/theme.css>; rel=preload; as=style, </c/manual.client.js?v=manual>; rel=modulepreload, </assets/cart.js>; rel=modulepreload, </assets/shared.js>; rel=modulepreload',
    );
    await expect(routeResponse.text()).resolves.toContain(
      [
        '<link rel="stylesheet" href="/assets/manual.css">',
        '<link rel="stylesheet" href="/assets/cart.css">',
        '<link rel="stylesheet" href="/assets/theme.css">',
        '<link rel="modulepreload" href="/c/manual.client.js?v=manual">',
        '<link rel="modulepreload" href="/assets/cart.js">',
        '<link rel="modulepreload" href="/assets/shared.js">',
      ].join(''),
    );

    const moduleResponse = await handler(new Request(`https://example.test${module.href}`));
    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expect(moduleResponse.text()).resolves.toBe('export const cart = 1;');
  });

  it('wires a route-entry map through the Vite build helper before route hints are applied', async () => {
    const accountRoute = route('/account', {
      page() {
        return '<main>Account</main>';
      },
    });
    const build = createJisoAppShellViteBuild({
      app: createApp({ routes: [accountRoute] }),
      manifest: {
        '_shared.js': {
          file: 'assets/shared.js',
        },
        'src/account.client.ts': {
          css: ['assets/account.css'],
          file: 'assets/account.js',
          imports: ['_shared.js'],
        },
      },
      routeEntryMap: {
        '/account': 'src/account.client.ts',
      },
    });

    expect(build.routeHints).toEqual([
      {
        hints: {
          modulepreloads: ['/assets/account.js', '/assets/shared.js'],
          stylesheets: ['/assets/account.css'],
        },
        routePath: '/account',
      },
    ]);

    const response = await createRequestHandler(build.app)(
      new Request('https://example.test/account'),
    );

    expect(response.headers.get('link')).toBe(
      '</assets/account.css>; rel=preload; as=style, </assets/account.js>; rel=modulepreload, </assets/shared.js>; rel=modulepreload',
    );
  });

  it('rejects stale route-entry maps through the Vite build helper', () => {
    expect(() =>
      createJisoAppShellViteBuild({
        app: createApp({ routes: [route('/cart', {})] }),
        manifest: {
          'src/account.client.ts': {
            file: 'assets/account.js',
          },
        },
        routeEntryMap: {
          '/account': 'src/account.client.ts',
        },
      }),
    ).toThrow('App shell route build entry does not match an app route: /account');
  });

  it('creates a build from a Vite output bundle manifest', () => {
    const build = createJisoAppShellViteBuildFromBundle({
      app: createApp({ routes: [route('/cart', {})] }),
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
    expect(build.assets).toEqual([
      { file: 'assets/cart.css', href: '/assets/cart.css', path: '/assets/cart.css' },
      { file: 'assets/cart.js', href: '/assets/cart.js', path: '/assets/cart.js' },
    ]);
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

  it('creates a Vite app-shell build directly from a manifest file', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-build-manifest-file-'));

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        }),
      );

      const build = await createJisoAppShellViteBuildFromManifestFile({
        app: createApp({ routes: [route('/cart', {})] }),
        manifestFile: join(distDir, '.vite/manifest.json'),
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
      expect(build.assets).toEqual([
        { file: 'assets/cart.css', href: '/assets/cart.css', path: '/assets/cart.css' },
        { file: 'assets/cart.js', href: '/assets/cart.js', path: '/assets/cart.js' },
      ]);
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
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

  it('applies Vite base paths to build route hints and asset planning', () => {
    const build = createJisoAppShellViteBuild({
      app: createApp({ routes: [route('/cart', {})] }),
      base: '/shop/',
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
          modulepreloads: ['/shop/assets/cart.js'],
          stylesheets: ['/shop/assets/cart.css'],
        },
        routePath: '/cart',
      },
    ]);
    expect(build.assets).toEqual([
      { file: 'assets/cart.css', href: '/shop/assets/cart.css', path: '/shop/assets/cart.css' },
      { file: 'assets/cart.js', href: '/shop/assets/cart.js', path: '/shop/assets/cart.js' },
    ]);
  });

  it('turns Vite build asset plans into static-export copy inputs', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-export-'));

    try {
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart{color:oklch(50% 0.1 180)}');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const cart = true;');

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
      const assets = jisoAppShellViteStaticExportAssets(build.assets, { distDir });

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
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-export-'));

    try {
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart{display:grid}');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const cart = "manifest";');

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

      const result = await exportJisoAppShellViteBuild(build, { distDir, outDir });

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
    const distDir = await mkdtemp(join(tmpdir(), 'jiso-vite-dist-manifest-export-'));
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-manifest-export-'));

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

      const result = await exportJisoAppShellViteBuildFromManifestFile({
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

  it('emits compiled app-shell client modules into the Vite output tree', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-client-modules-'));

    try {
      const build = createJisoAppShellViteBuild({
        app: createApp({ routes: [route('/', {})] }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            source: 'export const cart = true;',
            version: 'cart-v1',
          },
        ],
      });

      await expect(writeJisoAppShellViteBuildOutput(build, { outDir })).resolves.toEqual({
        clientModuleOutputPlan: [
          {
            path: '/c/cart.client.js',
            targetPath: join(outDir, 'c/cart.client.js'),
          },
        ],
        clientModules: [
          {
            file: 'c/cart.client.js',
            href: '/c/cart.client.js?v=cart-v1',
            path: '/c/cart.client.js',
            source: 'export const cart = true;',
            version: 'cart-v1',
          },
        ],
        staticExportAssets: [],
      });
      await expect(readFile(join(outDir, 'c/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cart = true;',
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('emits app-shell build output from the Vite plugin writeBundle hook', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-plugin-build-'));
    const built: JisoAppShellBuild[] = [];
    const outputs: JisoAppShellViteBuildOutput[] = [];
    const plugin = jisoAppShellVitePlugin(createApp({ routes: [route('/cart', {})] }), {
      build: {
        clientModules: [
          {
            path: '/c/cart.client.js',
            source: 'export const cart = true;',
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
      },
    });

    try {
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

      await expect(readFile(join(outDir, 'c/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cart = true;',
      );
      expect(built).toHaveLength(1);
      expect(outputs).toEqual([
        {
          clientModuleOutputPlan: [
            {
              path: '/c/cart.client.js',
              targetPath: join(outDir, 'c/cart.client.js'),
            },
          ],
          clientModules: [
            {
              file: 'c/cart.client.js',
              href: '/c/cart.client.js?v=cart-v1',
              path: '/c/cart.client.js',
              source: 'export const cart = true;',
              version: 'cart-v1',
            },
          ],
          staticExportAssets: [
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
          ],
        },
      ]);
      expect(built[0]?.routeHints).toEqual([
        {
          hints: {
            modulepreloads: ['/assets/cart.js'],
            stylesheets: ['/assets/cart.css'],
          },
          routePath: '/cart',
        },
      ]);
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('runs app-shell static export from the Vite plugin writeBundle hook', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-vite-plugin-build-export-dist-'));
    const exportDir = await mkdtemp(join(tmpdir(), 'jiso-vite-plugin-build-export-out-'));
    const outputs: JisoAppShellViteBuildOutput[] = [];

    try {
      await mkdir(join(outDir, 'assets'), { recursive: true });
      await writeFile(join(outDir, 'assets/cart.css'), '.cart{display:grid}');
      await writeFile(join(outDir, 'assets/cart.js'), 'export const cartAsset = true;');

      const plugin = jisoAppShellVitePlugin(
        createApp({
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
          path: '/c/cart.client.js',
          targetPath: join(outDir, 'c/cart.client.js'),
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
          href: '/c/cart.client.js?v=cart-v1#Cart$add',
          path: '/c/cart.client.js',
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
      await expect(readFile(join(outDir, 'c/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cartClient = true;',
      );
      await expect(readFile(join(exportDir, 'cart/index.html'), 'utf8')).resolves.toContain(
        '<link rel="stylesheet" href="/assets/cart.css">',
      );
      await expect(readFile(join(exportDir, 'cart/index.html'), 'utf8')).resolves.toContain(
        '<button on:click="/c/cart.client.js?v=cart-v1#Cart$add">Add</button>',
      );
      await expect(readFile(join(exportDir, 'c/cart.client.js'), 'utf8')).resolves.toBe(
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

  it('rejects unsafe Vite output asset paths before they can be copied', () => {
    expect(() =>
      jisoAppShellViteManifestAssets({
        'src/cart.client.ts': {
          file: '../cart.js',
        },
      }),
    ).toThrow('App shell build asset must stay within the Vite output directory');
  });

  it('registers dev middleware that serves shell requests and passes source assets onward', async () => {
    const productRoute = route('/products/:id', {
      meta: { title: 'Product' },
      page({ params }) {
        return `<main>${params.id}</main>`;
      },
    });
    const plugin = jisoAppShellVitePlugin(createApp({ routes: [productRoute] }));
    const middlewares: JisoAppShellViteMiddleware[] = [];

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const server = createServer((request, response) => {
      middlewares[0]?.(request, response, (error) => {
        if (error) {
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end(error instanceof Error ? error.message : JSON.stringify(error));
          return;
        }

        response.writeHead(418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('next');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      await expect(
        nodeFetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/src/styles.css`),
      ).resolves.toMatchObject({
        body: 'next',
        status: 418,
      });

      const response = await nodeFetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/products/p1`,
      );

      expect(response).toMatchObject({
        body: expect.stringContaining('<main>p1</main>'),
        headers: expect.objectContaining({
          'content-type': 'text/html; charset=utf-8',
        }),
        status: 200,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('registers SSR dev middleware that loads the routed app shell through Vite', async () => {
    const productRoute = route('/products/:id', {
      page({ params }) {
        return `<main>${params.id}</main>`;
      },
    });
    const app = createApp({ routes: [productRoute] });
    const plugin = jisoAppShellViteSsrDevPlugin({
      nodeHandlerExportName: 'commerceNodeHandler',
    });
    const middlewares: JisoAppShellViteMiddleware[] = [];
    let moduleLoads = 0;
    let handled = 0;

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      async ssrLoadModule(id) {
        moduleLoads += 1;
        expect(id).toBe('/src/app-shell.ts');
        return {
          commerceNodeHandler(_request: unknown, response: { end(body: string): void }) {
            handled += 1;
            response.end('handled by SSR app shell');
          },
          default: app,
        };
      },
    });

    const server = createServer((request, response) => {
      middlewares[0]?.(request, response, (error) => {
        if (error) {
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end(error instanceof Error ? error.message : JSON.stringify(error));
          return;
        }

        response.writeHead(418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('next');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      await expect(nodeFetch(`${origin}/src/styles.css`)).resolves.toMatchObject({
        body: 'next',
        status: 418,
      });
      await expect(nodeFetch(`${origin}/products/p1`)).resolves.toMatchObject({
        body: 'handled by SSR app shell',
        status: 200,
      });
      expect(moduleLoads).toBe(2);
      expect(handled).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('registers SSR dev middleware that derives the node handler from the loaded app shell', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const clientHref = registry.put({
      path: '/c/product.client.js',
      source: 'export const product = true;',
      version: 'product-v1',
    });
    const productRoute = route('/products/:id', {
      modulepreloads: [clientHref],
      page({ params }) {
        return `<main>${params.id}</main>`;
      },
    });
    const app = createApp({ clientModules: registry, routes: [productRoute] });
    const plugin = jisoAppShellViteSsrDevPlugin();
    const middlewares: JisoAppShellViteMiddleware[] = [];
    let moduleLoads = 0;

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      async ssrLoadModule(id) {
        moduleLoads += 1;
        expect(id).toBe('/src/app-shell.ts');
        return { default: app };
      },
    });

    const server = createServer((request, response) => {
      middlewares[0]?.(request, response, (error) => {
        if (error) {
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end(error instanceof Error ? error.message : JSON.stringify(error));
          return;
        }

        response.writeHead(418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('next');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      await expect(nodeFetch(`${origin}/src/styles.css`)).resolves.toMatchObject({
        body: 'next',
        status: 418,
      });
      await expect(nodeFetch(`${origin}/products/p1`)).resolves.toMatchObject({
        body: expect.stringContaining('<main>p1</main>'),
        headers: expect.objectContaining({
          link: `</c/product.client.js?v=product-v1>; rel=modulepreload`,
        }),
        status: 200,
      });
      await expect(nodeFetch(`${origin}${clientHref}`)).resolves.toMatchObject({
        body: 'export const product = true;',
        headers: expect.objectContaining({
          'cache-control': 'public, max-age=31536000, immutable',
        }),
        status: 200,
      });
      expect(moduleLoads).toBe(3);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('keeps explicit SSR dev node handler exports strict', async () => {
    const app = createApp({ routes: [route('/cart', {})] });
    const plugin = jisoAppShellViteSsrDevPlugin({
      nodeHandlerExportName: 'commerceNodeHandler',
    });
    const middlewares: JisoAppShellViteMiddleware[] = [];

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      async ssrLoadModule() {
        return { default: app };
      },
    });

    const server = createServer((request, response) => {
      middlewares[0]?.(request, response, (error) => {
        response.writeHead(error ? 500 : 418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : 'next');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      await expect(
        nodeFetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/cart`),
      ).resolves.toMatchObject({
        body: '/src/app-shell.ts must export commerceNodeHandler as a Node app-shell handler with (request, response).',
        status: 500,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('serves a diagnostic document for page routes that depend on a failed dev module', async () => {
    const diagnostics = createJisoAppShellDevDiagnosticLedger();
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'FW225',
          fileName: 'src/components/cart.tsx',
          length: 7,
          message: 'JSX nesting violates the HTML content model.',
          start: { column: 11, line: 2 },
        },
      ],
      fileName: 'src/components/cart.tsx',
      source: [
        'export const Cart = component("cart", {',
        '  render: () => <p><div /></p>',
        '});',
      ].join('\n'),
    });
    const cartRoute = route('/cart', {
      modulepreloads: ['/c/src/components/cart.client.js?v=failed'],
      page() {
        return '<main>Cart</main>';
      },
    });
    const plugin = jisoAppShellVitePlugin(createApp({ routes: [cartRoute] }), {
      devDiagnostics: diagnostics,
    });
    const middlewares: JisoAppShellViteMiddleware[] = [];

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const server = createServer((request, response) => {
      middlewares[0]?.(request, response, (error) => {
        if (error) {
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end(error instanceof Error ? error.message : JSON.stringify(error));
          return;
        }

        response.writeHead(418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('next');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const response = await nodeFetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/cart`,
      );

      expect(response).toMatchObject({
        body: expect.stringContaining('<p class="jiso-diagnostic-code">FW225</p>'),
        headers: expect.objectContaining({
          'content-type': 'text/html; charset=utf-8',
        }),
        status: 500,
      });
      expect(response.body).toContain('<title>FW225 diagnostic</title>');
      expect(response.body).toContain('src/components/cart.tsx:2:11');
      expect(response.body).toContain('2 |   render: () =&gt; &lt;p&gt;&lt;div /&gt;&lt;/p&gt;');
      expect(response.body).not.toContain('<main>Cart</main>');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

interface NodeResponse {
  body: string;
  headers: Record<string, string | string[] | undefined>;
  status: number;
}

async function nodeFetch(url: string): Promise<NodeResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          headers: response.headers,
          status: response.statusCode ?? 0,
        });
      });
    });
    request.on('error', reject);
    request.end();
  });
}
