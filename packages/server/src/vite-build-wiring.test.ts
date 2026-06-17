import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { route } from './route.js';
import {
  createKovoAppShellViteBuild,
  createKovoAppShellViteBuildFromBundle,
  createKovoAppShellViteBuildFromManifestFile,
  type KovoAppShellBuild,
  type KovoAppShellViteBuildOutput,
} from './api/app-shell/vite.js';
import { kovoAppShellVitePlugin } from './internal/app-shell-vite.js';
import { writeKovoAppShellViteBuildOutput } from './vite-build-output.js';

describe('server app shell Vite plugin', () => {
  it('wires build manifest hints and compiled client modules through the app shell', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const cartRoute = route('/cart', {
      modulepreloads: ['/c/manual.client.js?v=manual'],
      page() {
        return '<main><cart-badge>1</cart-badge></main>';
      },
      stylesheets: ['/assets/manual.css'],
    });
    const build = createKovoAppShellViteBuild({
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
    const build = createKovoAppShellViteBuild({
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
      createKovoAppShellViteBuild({
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

  it('blocks KV228 route-table diagnostics through the Vite build helper', () => {
    expect(() =>
      createKovoAppShellViteBuild({
        app: createApp({
          routes: [route('/products/:id', {}), route('/products/new', {})],
        }),
        manifest: {
          'src/products.client.ts': {
            file: 'assets/products.js',
          },
        },
        routeEntryMap: {
          '/products/new': 'src/products.client.ts',
        },
      }),
    ).toThrow(
      "KV228 Ambiguous route table: '/products/:id' and '/products/new' can both match canonical request path '/products/new'.",
    );
  });

  it('creates a build from a Vite output bundle manifest', () => {
    const build = createKovoAppShellViteBuildFromBundle({
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

  it('creates a Vite app-shell build directly from a manifest file', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-manifest-file-'));

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

      const build = await createKovoAppShellViteBuildFromManifestFile({
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

  it('applies Vite base paths to build route hints and asset planning', () => {
    const build = createKovoAppShellViteBuild({
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

  it('emits compiled app-shell client modules into the Vite output tree', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-client-modules-'));

    try {
      const build = createKovoAppShellViteBuild({
        app: createApp({ routes: [route('/', {})] }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            source: 'export const cart = true;',
            version: 'cart-v1',
          },
        ],
      });

      await expect(writeKovoAppShellViteBuildOutput(build, { outDir })).resolves.toEqual({
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
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-plugin-build-'));
    const built: KovoAppShellBuild[] = [];
    const outputs: KovoAppShellViteBuildOutput[] = [];
    const plugin = kovoAppShellVitePlugin(createApp({ routes: [route('/cart', {})] }), {
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
});
