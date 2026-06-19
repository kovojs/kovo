import type { IncomingMessage } from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import type { LiveTargetRenderer } from './mutation-wire.js';
import { route } from './route.js';
import {
  createKovoAppShellDevDiagnosticLedger,
  createKovoAppShellViteDevIntegration,
  kovoAppShellViteDevPlugin,
  renderKovoAppShellViteDevDiagnosticResponse,
  type KovoAppShellViteMiddleware,
  shouldHandleKovoAppShellViteRequest,
} from './vite-dev.js';

describe('server app shell Vite dev seam', () => {
  it('derives request ownership from the app-shell dispatch table', () => {
    const app = createApp({
      mutations: [{ key: 'cart/add' }],
      routes: [route('/products/:id', {})],
    });

    expect(
      shouldHandleKovoAppShellViteRequest(request('/products/p1', { method: 'GET' }), app),
    ).toBe(true);
    expect(
      shouldHandleKovoAppShellViteRequest(request('/products/p1', { method: 'HEAD' }), app),
    ).toBe(true);
    expect(
      shouldHandleKovoAppShellViteRequest(request('/products/p1', { method: 'POST' }), app),
    ).toBe(true);
    expect(
      shouldHandleKovoAppShellViteRequest(request('/_m/cart/add', { method: 'POST' }), app),
    ).toBe(true);
    expect(
      shouldHandleKovoAppShellViteRequest(
        request('/missing', { headers: { accept: 'text/html' } }),
        app,
      ),
    ).toBe(true);
    expect(shouldHandleKovoAppShellViteRequest(request('/missing'), app)).toBe(false);
    expect(shouldHandleKovoAppShellViteRequest(request('/c/dev.client.js?v=r7'), app)).toBe(true);
    expect(shouldHandleKovoAppShellViteRequest(request('/c/dev.client.js'), app)).toBe(false);
    expect(shouldHandleKovoAppShellViteRequest(request('/src/styles.css'), app)).toBe(false);
    expect(shouldHandleKovoAppShellViteRequest(request('/@kovo/hmr-client'), app)).toBe(true);
    expect(
      shouldHandleKovoAppShellViteRequest(
        request('/@kovo/hmr/refresh/route?url=/products/p1'),
        app,
      ),
    ).toBe(true);
    expect(
      shouldHandleKovoAppShellViteRequest(
        request('/@kovo/hmr/refresh/live-targets', {
          headers: {
            'Kovo-Live-Targets': 'product-card#src/components/ProductCard:{"id":"p1"}',
          },
          method: 'POST',
        }),
        app,
      ),
    ).toBe(true);
  });

  it('renders route diagnostics directly from the dev ledger', () => {
    const diagnostics = createKovoAppShellDevDiagnosticLedger();
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'KV225',
          fileName: 'src/components/cart.tsx',
          message: 'JSX nesting violates the HTML content model.',
        },
      ],
      fileName: 'src/components/cart.tsx',
    });

    const response = renderKovoAppShellViteDevDiagnosticResponse(
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
      body: expect.stringContaining('<p class="kovo-diagnostic-code">KV225</p>'),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 500,
    });
  });

  it('wires compiler module diagnostics into app-shell dev middleware', async () => {
    const integration = createKovoAppShellViteDevIntegration({
      appExportName: 'shopApp',
      moduleId: '/src/app-shell.ts',
    });
    integration.onModuleDiagnostics({
      diagnostics: [
        {
          code: 'KV225',
          fileName: 'src/components/cart.tsx',
          message: 'JSX nesting violates the HTML content model.',
        },
      ],
      fileName: 'src/components/cart.tsx',
      source: 'export const Cart = component({ render: () => <p><div /></p> });',
    });

    const middlewares: KovoAppShellViteMiddleware[] = [];
    integration.plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      async ssrLoadModule(id) {
        expect(id).toBe('/src/app-shell.ts');
        return {
          shopApp: createApp({
            routes: [
              route('/cart', {
                modulepreloads: ['/c/src/components/cart.client.js?v=failed'],
                page: () => '<main>Cart</main>',
              }),
            ],
          }),
        };
      },
    });

    const server = createHttpServer((request, response) => {
      middlewares[0]?.(request, response, (error) => {
        response.writeHead(error ? 500 : 418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : 'next');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/cart`,
      );
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).toContain('<p class="kovo-diagnostic-code">KV225</p>');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('emits route-shell HMR events for app-shell module edits', async () => {
    const ws = { send: vi.fn() };
    const plugin = kovoAppShellViteDevPlugin({
      moduleId: '/src/app-shell.ts',
    });
    const server = {
      config: { root: '/workspace/app' },
      middlewares: { use() {} },
      async ssrLoadModule() {
        return { default: createApp() };
      },
      ws,
    };
    plugin.configureServer(server);

    const modules = await plugin.handleHotUpdate?.({
      file: '/workspace/app/src/app-shell.ts',
      modules: ['vite-module'],
      read: async () => 'export default createApp({ routes: [] });',
      server,
    });

    expect(modules).toEqual([]);
    expect(ws.send).toHaveBeenCalledWith({
      data: {
        impact: 'routeRefresh',
        reasons: ['route-shell'],
        sourceFile: 'src/app-shell.ts',
      },
      event: 'kovo:route-shell',
      type: 'custom',
    });
    expect(ws.send).toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('keeps non-error module diagnostics observable without making them blocking', () => {
    const diagnostics = createKovoAppShellDevDiagnosticLedger();
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'KV210',
          fileName: 'src/components/cart.tsx',
          message: 'Anonymous handler; name it for stable identity.',
        },
      ],
      fileName: 'src/components/cart.tsx',
      moduleHrefs: ['/c/custom-cart.client.js?v=lint'],
    });

    expect(diagnostics.diagnosticsForModuleHref('/c/custom-cart.client.js?v=lint')).toBeUndefined();
    expect(diagnostics.allDiagnosticsForFile('src/components/cart.tsx')).toMatchObject({
      diagnostics: [{ code: 'KV210' }],
      fileName: 'src/components/cart.tsx',
    });
    expect(
      diagnostics.allDiagnosticsForModuleHref('/c/custom-cart.client.js?v=lint'),
    ).toMatchObject({
      diagnostics: [{ code: 'KV210' }],
      fileName: 'src/components/cart.tsx',
    });

    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'KV225',
          fileName: 'src/components/cart.tsx',
          message: 'JSX nesting violates the HTML content model.',
        },
      ],
      fileName: 'src/components/cart.tsx',
    });

    expect(
      diagnostics.allDiagnosticsForModuleHref('/c/custom-cart.client.js?v=lint'),
    ).toBeUndefined();
    expect(
      diagnostics.diagnosticsForModuleHref('/c/src/components/cart.client.js?v=failed'),
    ).toMatchObject({
      diagnostics: [{ code: 'KV225' }],
      fileName: 'src/components/cart.tsx',
    });
  });

  it('renders mutation diagnostics as fragment wire responses when requested', () => {
    const diagnostics = createKovoAppShellDevDiagnosticLedger();
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'KV225',
          fileName: 'src/mutations/cart.ts',
          message: 'JSX nesting violates the HTML content model.',
        },
      ],
      fileName: 'src/mutations/cart.ts',
      moduleHrefs: ['/_m/cart/add'],
    });

    const response = renderKovoAppShellViteDevDiagnosticResponse(
      createApp({
        mutations: [{ key: 'cart/add' }],
      }),
      request('/_m/cart/add', {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Targets': 'cart-errors;cart-summary',
        },
        method: 'POST',
      }),
      diagnostics,
    );

    expect(response).toMatchObject({
      body: expect.stringContaining('<kovo-fragment target="cart-errors">'),
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
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
      routes: [
        route('/', {
          modulepreloads: [moduleHref],
          page() {
            return '<main>dev app shell</main>';
          },
        }),
      ],
    });
    app.clientModules = clientModules;
    let middleware: KovoAppShellViteMiddleware | undefined;
    const plugin = kovoAppShellViteDevPlugin({ moduleId: '/src/app-shell.ts' });

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
      expect(documentBody).toContain('<script type="module" src="/@kovo/hmr-client"></script>');

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

  it('serves build-owned stylesheet chunks through the default dev handler', async () => {
    const app = createApp({
      routes: [
        route('/', {
          page() {
            return '<main>styled dev app shell</main>';
          },
        }),
        route('/login', {
          page() {
            return '<main>login</main>';
          },
        }),
      ],
    });
    let middleware: KovoAppShellViteMiddleware | undefined;
    const plugin = kovoAppShellViteDevPlugin({
      earlyHints: false,
      moduleId: '/src/app-shell.ts',
      stylesheetAssets: () => ({
        app: [{ criticalCss: '.base{display:block}', href: '/assets/base.css' }],
        routes: {
          '/': [{ criticalCss: '.home{color:teal}', href: '/assets/routes/index.css' }],
          '/login': [{ criticalCss: '.login{color:purple}', href: '/assets/routes/login.css' }],
        },
      }),
    });

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

      expect(documentResponse.status, documentBody).toBe(200);
      expect(documentBody).toContain('data-kovo-critical-href="/assets/base.css"');
      expect(documentBody).toContain('data-kovo-critical-href="/assets/routes/index.css"');
      expect(documentBody).toContain('<link rel="stylesheet" href="/assets/base.css">');
      expect(documentBody).toContain('<link rel="stylesheet" href="/assets/routes/index.css">');
      expect(documentBody).not.toContain('/assets/routes/login.css');
      expect(documentBody).toContain('.base{display:block}');
      expect(documentBody).toContain('.home{color:teal}');
      expect(documentBody).not.toContain('.login{color:purple}');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('serves KV228 route-table diagnostics through the default dev handler', async () => {
    const app = createApp({
      routes: [
        route('/products/:id', { page: () => '<main>Param</main>' }),
        route('/products/new', { page: () => '<main>New</main>' }),
      ],
    });
    let middleware: KovoAppShellViteMiddleware | undefined;
    const plugin = kovoAppShellViteDevPlugin({ moduleId: '/src/app-shell.ts' });

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
      const response = await fetch(`http://127.0.0.1:${address.port}/products/new`);
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).toContain('<p class="kovo-diagnostic-code">KV228</p>');
      expect(body).not.toContain('<main>New</main>');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('keeps unversioned client modules on the Vite fallback even with a custom predicate', async () => {
    const app = createApp({ routes: [route('/cart', {})] });
    let middleware: KovoAppShellViteMiddleware | undefined;
    let customPredicateCalls = 0;
    const plugin = kovoAppShellViteDevPlugin({
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
          {} as Parameters<KovoAppShellViteMiddleware>[1],
          (error) => (error ? reject(error) : resolve()),
        );
      }),
    ).resolves.toBeUndefined();
    expect(customPredicateCalls).toBe(0);
  });

  it('serves and injects the dev-only HMR client through Vite middleware', async () => {
    const app = createApp({
      routes: [route('/cart', { page: () => '<main>Cart</main>' })],
    });
    let middleware: KovoAppShellViteMiddleware | undefined;
    const plugin = kovoAppShellViteDevPlugin({
      moduleId: '/src/app-shell.ts',
      nodeHandlerExportName: 'shopNodeHandler',
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
          shopNodeHandler(
            _request: unknown,
            response: {
              end(body: string): void;
              setHeader(name: string, value: string): void;
            },
          ) {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end('<!doctype html><html><head></head><body><main>Cart</main></body></html>');
          },
        };
      },
    });

    const server = createHttpServer((request, response) => {
      middleware?.(request, response, (error) => {
        response.writeHead(error ? 500 : 418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : 'vite fallback');
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

      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const documentResponse = await fetch(`${origin}/cart`);
      const documentBody = await documentResponse.text();
      const clientResponse = await fetch(`${origin}/@kovo/hmr-client`);
      const clientBody = await clientResponse.text();

      expect(documentResponse.status).toBe(200);
      expect(documentBody).toContain(
        '<script type="module" src="/@kovo/hmr-client"></script></head>',
      );
      expect(clientResponse.status).toBe(200);
      expect(clientResponse.headers.get('cache-control')).toBe('no-store');
      expect(clientBody).toContain('createHotContext("/@kovo/hmr-client")');
      expect(clientBody).toContain('hot.on("kovo:component-render"');
      expect(clientBody).toContain('hot.on("kovo:diagnostics"');
      expect(clientBody).toContain('/@kovo/hmr/refresh/route');
      expect(clientBody).toContain('/@kovo/hmr/refresh/live-targets');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('serves dev-only HMR route refresh through the Vite app-shell middleware', async () => {
    const clientModules = createMemoryVersionedClientModuleRegistry();
    clientModules.put({
      path: '/c/cart.client.js',
      source: 'export const cart = true;',
      version: 'cart-v1',
    });
    const app = createApp({
      routes: [
        route('/cart', {
          page() {
            return '<main>Cart refresh</main>';
          },
        }),
      ],
    });
    app.clientModules = clientModules;
    let middleware: KovoAppShellViteMiddleware | undefined;
    const plugin = kovoAppShellViteDevPlugin({ moduleId: '/src/app-shell.ts' });

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

    const server = createHttpServer((request, response) => {
      middleware?.(request, response, (error) => {
        response.writeHead(error ? 500 : 418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : 'vite fallback');
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

      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/@kovo/hmr/refresh/route?url=/cart&oldBuild=old-build`,
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('kovo-hmr-refresh')).toBe('route');
      expect(response.headers.get('kovo-previous-build')).toBe('old-build');
      expect(response.headers.get('kovo-build')).toBe(clientModules.buildToken());
      expect(body).toContain('<meta name="kovo-build" content="');
      expect(body).toContain('<script type="module" src="/@kovo/hmr-client"></script>');
      expect(body).toContain('<main>Cart refresh</main>');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('serves HMR route refresh diagnostics from the dev ledger', async () => {
    const diagnostics = createKovoAppShellDevDiagnosticLedger();
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'KV225',
          fileName: 'src/components/cart.tsx',
          message: 'JSX nesting violates the HTML content model.',
        },
      ],
      fileName: 'src/components/cart.tsx',
      source: 'export const Cart = component({ render: () => <p><div /></p> });',
    });
    const app = createApp({
      routes: [
        route('/cart', {
          modulepreloads: ['/c/src/components/cart.client.js?v=failed'],
          page() {
            return '<main>Cart refresh</main>';
          },
        }),
      ],
    });
    let middleware: KovoAppShellViteMiddleware | undefined;
    const plugin = kovoAppShellViteDevPlugin({
      devDiagnostics: diagnostics,
      moduleId: '/src/app-shell.ts',
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

    const server = createHttpServer((request, response) => {
      middleware?.(request, response, (error) => {
        response.writeHead(error ? 500 : 418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : 'vite fallback');
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

      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/@kovo/hmr/refresh/route?url=/cart`,
      );
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('kovo-hmr-refresh')).toBe('route');
      expect(body).toContain('<p class="kovo-diagnostic-code">KV225</p>');
      expect(body).toContain('<script type="module" src="/@kovo/hmr-client"></script>');
      expect(body).not.toContain('<main>Cart refresh</main>');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('serves dev-only HMR live-target refresh through fragment wire', async () => {
    const clientModules = createMemoryVersionedClientModuleRegistry();
    clientModules.put({
      path: '/c/cart.client.js',
      source: 'export const cart = true;',
      version: 'cart-v1',
    });
    const cartRenderer: LiveTargetRenderer<Request> = {
      component: 'src/components/CartBadge',
      async render(context) {
        expect(new URL(context.request.url).pathname).toBe('/cart');
        return `<cart-badge data-target="${context.target}">${String(context.props.count)}</cart-badge>`;
      },
      stylesheets: ['/assets/cart.css'],
    };
    const app = createApp({
      liveTargetRenderers: [cartRenderer],
    });
    app.clientModules = clientModules;
    let middleware: KovoAppShellViteMiddleware | undefined;
    const plugin = kovoAppShellViteDevPlugin({ moduleId: '/src/app-shell.ts' });

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

    const server = createHttpServer((request, response) => {
      middleware?.(request, response, (error) => {
        response.writeHead(error ? 500 : 418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : 'vite fallback');
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

      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/@kovo/hmr/refresh/live-targets?oldBuild=old-build`,
        {
          headers: {
            'Kovo-Current-Url': '/cart?tab=summary',
            'Kovo-Live-Targets': 'cart-badge#src/components/CartBadge:{"count":3}',
          },
          method: 'POST',
        },
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'text/vnd.kovo.fragment+html; charset=utf-8',
      );
      expect(response.headers.get('kovo-hmr-refresh')).toBe('live-targets');
      expect(response.headers.get('kovo-previous-build')).toBe('old-build');
      expect(response.headers.get('kovo-build')).toBe(clientModules.buildToken());
      expect(body).toBe(
        '<kovo-fragment target="cart-badge"><link rel="stylesheet" href="/assets/cart.css"><cart-badge data-target="cart-badge">3</cart-badge></kovo-fragment>',
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('does not expose HMR refresh endpoints through the production request handler', async () => {
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/cart', {
            page() {
              return '<main>Cart production page</main>';
            },
          }),
        ],
      }),
    );

    const routeResponse = await handler(
      new Request('http://kovo.test/@kovo/hmr/refresh/route?url=/cart'),
    );
    const liveTargetResponse = await handler(
      new Request('http://kovo.test/@kovo/hmr/refresh/live-targets', {
        headers: {
          'Kovo-Live-Targets': 'cart-badge#src/components/CartBadge:{"count":3}',
        },
        method: 'POST',
      }),
    );
    const clientResponse = await handler(new Request('http://kovo.test/@kovo/hmr-client'));

    expect(routeResponse.status).toBe(404);
    expect(routeResponse.headers.get('kovo-hmr-refresh')).toBeNull();
    expect(await routeResponse.text()).not.toContain('Cart production page');
    expect(liveTargetResponse.status).toBe(404);
    expect(liveTargetResponse.headers.get('kovo-hmr-refresh')).toBeNull();
    expect(clientResponse.status).toBe(404);
  });

  it('rejects Request -> Response exports at the explicit node handler boundary', async () => {
    const app = createApp({ routes: [route('/cart', {})] });
    let middleware: KovoAppShellViteMiddleware | undefined;
    const plugin = kovoAppShellViteDevPlugin({
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
        middleware?.(request('/cart'), {} as Parameters<KovoAppShellViteMiddleware>[1], (error) =>
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
