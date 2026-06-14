import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { route } from './route.js';
import {
  createJisoAppShellDevDiagnosticLedger,
  jisoAppShellViteDevPlugin,
  jisoAppShellVitePlugin,
  type JisoAppShellViteMiddleware,
} from './api/app-shell/vite.js';
import { nodeFetch } from './vite-test-http.js';

describe('server app shell Vite plugin', () => {
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

  it('registers dev middleware that loads the routed app shell through Vite', async () => {
    const productRoute = route('/products/:id', {
      page({ params }) {
        return `<main>${params.id}</main>`;
      },
    });
    const app = createApp({ routes: [productRoute] });
    const plugin = jisoAppShellViteDevPlugin({
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
            response.end('handled by dev app shell');
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
        body: 'handled by dev app shell',
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

  it('registers dev middleware that derives the node handler from the loaded app shell', async () => {
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
    const plugin = jisoAppShellViteDevPlugin();
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

  it('keeps explicit dev node handler exports strict', async () => {
    const app = createApp({ routes: [route('/cart', {})] });
    const plugin = jisoAppShellViteDevPlugin({
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
