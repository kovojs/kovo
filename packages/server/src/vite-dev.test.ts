import type { IncomingMessage } from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { route } from './route.js';
import {
  createJisoAppShellDevDiagnosticLedger,
  jisoAppShellViteDevPlugin,
  renderJisoAppShellViteDevDiagnosticResponse,
  type JisoAppShellViteMiddleware,
  shouldHandleJisoAppShellViteRequest,
} from './vite-dev.js';

describe('server app shell Vite dev seam', () => {
  it('derives request ownership from the app-shell dispatch table', () => {
    const app = createApp({
      mutations: [{ key: 'cart/add' }],
      routes: [route('/products/:id', {})],
    });

    expect(
      shouldHandleJisoAppShellViteRequest(request('/products/p1', { method: 'GET' }), app),
    ).toBe(true);
    expect(
      shouldHandleJisoAppShellViteRequest(request('/products/p1', { method: 'HEAD' }), app),
    ).toBe(true);
    expect(
      shouldHandleJisoAppShellViteRequest(request('/products/p1', { method: 'POST' }), app),
    ).toBe(false);
    expect(
      shouldHandleJisoAppShellViteRequest(request('/_m/cart/add', { method: 'POST' }), app),
    ).toBe(true);
    expect(shouldHandleJisoAppShellViteRequest(request('/c/dev.client.js?v=r7'), app)).toBe(true);
    expect(shouldHandleJisoAppShellViteRequest(request('/c/dev.client.js'), app)).toBe(false);
    expect(shouldHandleJisoAppShellViteRequest(request('/src/styles.css'), app)).toBe(false);
  });

  it('renders route diagnostics directly from the dev ledger', () => {
    const diagnostics = createJisoAppShellDevDiagnosticLedger();
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'FW225',
          fileName: 'src/components/cart.tsx',
          message: 'JSX nesting violates the HTML content model.',
        },
      ],
      fileName: 'src/components/cart.tsx',
    });

    const response = renderJisoAppShellViteDevDiagnosticResponse(
      createApp({
        routes: [
          route('/cart', {
            modulepreloads: ['/c/src/components/cart.client.js?v=failed'],
          }),
        ],
      }),
      request('/cart'),
      diagnostics,
    );

    expect(response).toMatchObject({
      body: expect.stringContaining('<p class="jiso-diagnostic-code">FW225</p>'),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 500,
    });
  });

  it('renders mutation diagnostics as fragment wire responses when requested', () => {
    const diagnostics = createJisoAppShellDevDiagnosticLedger();
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'FW225',
          fileName: 'src/mutations/cart.ts',
          message: 'JSX nesting violates the HTML content model.',
        },
      ],
      fileName: 'src/mutations/cart.ts',
      moduleHrefs: ['/_m/cart/add'],
    });

    const response = renderJisoAppShellViteDevDiagnosticResponse(
      createApp({
        mutations: [{ key: 'cart/add' }],
      }),
      request('/_m/cart/add', {
        headers: {
          'FW-Fragment': 'true',
          'FW-Targets': 'cart-errors;cart-summary',
        },
        method: 'POST',
      }),
      diagnostics,
    );

    expect(response).toMatchObject({
      body: expect.stringContaining('<fw-fragment target="cart-errors">'),
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 500,
    });
  });

  it('adapts the loaded app through the default Request -> Response dev handler', async () => {
    const clientModules = createMemoryVersionedClientModuleRegistry();
    const moduleHref = clientModules.put({
      path: '/c/dev.client.js',
      source: 'export const loaded = true;',
      version: 'r7',
    });
    const app = createApp({
      clientModules,
      routes: [
        route('/', {
          modulepreloads: [moduleHref],
          page() {
            return '<main>dev app shell</main>';
          },
        }),
      ],
    });
    let middleware: JisoAppShellViteMiddleware | undefined;
    const plugin = jisoAppShellViteDevPlugin({ moduleId: '/src/app-shell.ts' });

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
      async ssrLoadModule(id) {
        expect(id).toBe('/src/app-shell.ts');
        return { default: app };
      },
    });

    expect(middleware).toBeDefined();
    const server = createHttpServer((request, response) => {
      middleware?.(request, response, (error) => {
        if (error) {
          const message = error instanceof Error ? error.message : 'Unknown app-shell dev error';
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end(message);
          return;
        }

        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('vite fallback');
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });

      const address = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${address.port}`;
      const documentResponse = await fetch(`${origin}/`);
      const documentBody = await documentResponse.text();

      // SPEC.md section 9.5: dev and export share the app-shell request handler.
      expect(documentResponse.status).toBe(200);
      expect(documentResponse.headers.get('content-type')).toContain('text/html');
      expect(documentBody).toContain('<main>dev app shell</main>');

      const moduleResponse = await fetch(`${origin}${moduleHref}`);
      const moduleBody = await moduleResponse.text();

      expect(moduleResponse.status).toBe(200);
      expect(moduleResponse.headers.get('cache-control')).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(moduleBody).toBe('export const loaded = true;');

      const unversionedModuleResponse = await fetch(`${origin}/c/dev.client.js`);
      const unversionedModuleBody = await unversionedModuleResponse.text();

      expect(unversionedModuleResponse.status).toBe(404);
      expect(unversionedModuleBody).toBe('vite fallback');

      const assetFallbackResponse = await fetch(`${origin}/src/styles.css`);
      const assetFallbackBody = await assetFallbackResponse.text();

      expect(assetFallbackResponse.status).toBe(404);
      expect(assetFallbackBody).toBe('vite fallback');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('keeps unversioned client modules on the Vite fallback even with a custom predicate', async () => {
    const app = createApp({ routes: [route('/cart', {})] });
    let middleware: JisoAppShellViteMiddleware | undefined;
    let customPredicateCalls = 0;
    const plugin = jisoAppShellViteDevPlugin({
      moduleId: '/src/app-shell.ts',
      shouldHandleRequest() {
        customPredicateCalls += 1;
        return true;
      },
    });

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
      async ssrLoadModule() {
        return { default: app };
      },
    });

    await expect(
      new Promise<void>((resolve, reject) => {
        middleware?.(
          request('/c/cart.client.js'),
          {} as Parameters<JisoAppShellViteMiddleware>[1],
          (error) => (error ? reject(error) : resolve()),
        );
      }),
    ).resolves.toBeUndefined();
    expect(customPredicateCalls).toBe(0);
  });

  it('rejects Request -> Response exports at the explicit node handler boundary', async () => {
    const app = createApp({ routes: [route('/cart', {})] });
    let middleware: JisoAppShellViteMiddleware | undefined;
    const plugin = jisoAppShellViteDevPlugin({
      moduleId: '/src/app-shell.ts',
      nodeHandlerExportName: 'handler',
    });

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
      async ssrLoadModule() {
        return {
          default: app,
          async handler(_request: Request) {
            return new Response('stale web handler');
          },
        };
      },
    });

    await expect(
      new Promise<void>((resolve, reject) => {
        middleware?.(request('/cart'), {} as Parameters<JisoAppShellViteMiddleware>[1], (error) =>
          error ? reject(error) : resolve(),
        );
      }),
    ).rejects.toThrow(
      '/src/app-shell.ts must export handler as a Node app-shell handler with (request, response).',
    );
  });
});

function request(
  url: string,
  options: {
    headers?: IncomingMessage['headers'];
    method?: string;
  } = {},
): IncomingMessage {
  return {
    headers: options.headers ?? {},
    method: options.method ?? 'GET',
    url,
  } as IncomingMessage;
}
