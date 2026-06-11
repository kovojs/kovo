import { request as httpRequest, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import {
  createApp,
  createJisoAppShellBuild,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  jisoAppShellVitePlugin,
  jisoAppShellViteManifestHints,
  route,
  type JisoAppShellViteMiddleware,
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
      routeEntries: [{ entries: ['src/cart.client.ts'], routePath: '/cart' }],
    });
    const module = build.clientModules[0];
    if (!module) throw new Error('expected a compiled client module');
    expect(module).toMatchObject({
      href: expect.stringMatching(/^\/c\/cart\.client\.js\?v=[a-f0-9]{12}$/),
      path: '/c/cart.client.js',
    });
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
