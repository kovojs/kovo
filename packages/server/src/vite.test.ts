import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createApp,
  createJisoAppShellDevDiagnosticLedger,
  createJisoAppShellBuild,
  createJisoAppShellViteBuild,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  exportStaticApp,
  jisoAppShellViteManifestAssets,
  jisoAppShellViteManifestHints,
  jisoAppShellVitePlugin,
  jisoAppShellViteRouteEntries,
  jisoAppShellViteStaticExportAssets,
  route,
  type JisoAppShellViteMiddleware,
  writeJisoAppShellViteBuildOutput,
} from './index.js';

describe('server app shell Vite plugin', () => {
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
    const build = createJisoAppShellBuild({
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
      routeEntries: jisoAppShellViteRouteEntries(
        {
          '/cart': 'src/cart.client.ts',
        },
        { routes: [cartRoute] },
      ),
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

  it('applies Vite base paths to build route hints and asset planning', () => {
    const build = createJisoAppShellBuild({
      app: createApp({ routes: [route('/cart', {})] }),
      base: '/shop/',
      manifest: {
        'src/cart.client.ts': {
          css: ['assets/cart.css'],
          file: 'assets/cart.js',
        },
      },
      routeEntries: [{ entries: ['src/cart.client.ts'], routePath: '/cart' }],
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
        clientModules: [
          {
            file: 'c/cart.client.js',
            href: '/c/cart.client.js?v=cart-v1',
            path: '/c/cart.client.js',
            source: 'export const cart = true;',
            version: 'cart-v1',
          },
        ],
      });
      await expect(readFile(join(outDir, 'c/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cart = true;',
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
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

  it('registers dev middleware that serves through the app shell request handler', async () => {
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
