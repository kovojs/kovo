import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';
import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';

import { createApp } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { route } from './route.js';
import {
  createKovoAppShellDevDiagnosticLedger,
  dispatchKovoAppShellViteDevRequest,
  kovoAppShellViteDevPlugin,
  kovoAppShellVitePlugin,
  type KovoAppShellViteMiddleware,
} from './internal/app-shell-vite.js';
import { nodeFetch } from './vite-test-http.js';
import { renderedHtml } from './html.js';
import { MAX_REQUEST_QUERY_ENTRIES } from './request-url-limits.js';

interface RejectedVitePreAppIngress {
  readonly body: 'Bad Request' | 'Payload Too Large' | 'URI Too Long';
  readonly label: string;
  readonly request: IncomingMessage;
  readonly status: 400 | 413 | 414;
}

function rejectedVitePreAppIngress(): readonly RejectedVitePreAppIngress[] {
  const base = {
    __kovoRequestIngressSource: 'node-http1',
    complete: true,
    headers: { host: 'app.test' },
    httpVersion: '1.1',
    method: 'GET',
    rawHeaders: ['Host', 'app.test'],
    socket: { remoteAddress: '203.0.113.7' } as Socket,
    url: '/cart',
  } as const;
  return [
    {
      body: 'Bad Request',
      label: 'duplicate Host',
      request: {
        ...base,
        rawHeaders: ['Host', 'app.test', 'Host', 'attacker.test'],
      } as IncomingMessage,
      status: 400,
    },
    {
      body: 'Bad Request',
      label: 'case-changing method',
      request: { ...base, method: 'get' } as IncomingMessage,
      status: 400,
    },
    {
      body: 'Bad Request',
      label: 'mixed HTTP/2 source posture',
      request: {
        ...base,
        __kovoRequestIngressEndStream: true,
        __kovoRequestIngressSource: 'node-http2',
      } as IncomingMessage,
      status: 400,
    },
    {
      body: 'URI Too Long',
      label: 'over-breadth target',
      request: {
        ...base,
        url: `/?${'a&'.repeat(MAX_REQUEST_QUERY_ENTRIES)}a`,
      } as IncomingMessage,
      status: 414,
    },
    {
      body: 'Payload Too Large',
      label: 'body-framed GET',
      request: {
        ...base,
        headers: { host: 'app.test', 'transfer-encoding': 'chunked' },
        rawHeaders: ['Host', 'app.test', 'Transfer-Encoding', 'chunked'],
      } as IncomingMessage,
      status: 413,
    },
  ];
}

describe('server app shell Vite plugin', () => {
  it('rejects over-breadth targets before loading the Vite SSR or app graph', () => {
    const middlewares: KovoAppShellViteMiddleware[] = [];
    const loadedModuleIds: string[] = [];
    let nextCalls = 0;
    let responseBody = '';
    let responseStatus = 0;
    const plugin = kovoAppShellViteDevPlugin();
    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      async ssrLoadModule(id) {
        loadedModuleIds.push(id);
        return {};
      },
    });
    const request = {
      __kovoRequestIngressSource: 'node-http1',
      complete: true,
      headers: { host: 'app.test' },
      httpVersion: '1.1',
      method: 'GET',
      rawHeaders: ['Host', 'app.test'],
      socket: { remoteAddress: '203.0.113.7' } as Socket,
      url: `/?${'a&'.repeat(MAX_REQUEST_QUERY_ENTRIES)}a`,
    } as IncomingMessage;
    const response = {
      end(body?: string) {
        responseBody = body ?? '';
        return this;
      },
      headersSent: false,
      writeHead(status: number) {
        responseStatus = status;
        return this;
      },
    } as unknown as ServerResponse;

    middlewares[0]?.(request, response, () => {
      nextCalls += 1;
    });

    expect(responseStatus).toBe(414);
    expect(responseBody).toBe('URI Too Long');
    expect(loadedModuleIds).toEqual([]);
    expect(nextCalls).toBe(0);
  });

  it('rejects body-framed GET before loading the Vite SSR or app graph', () => {
    const middlewares: KovoAppShellViteMiddleware[] = [];
    const loadedModuleIds: string[] = [];
    let nextCalls = 0;
    let responseBody = '';
    let responseStatus = 0;
    const plugin = kovoAppShellViteDevPlugin();
    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      async ssrLoadModule(id) {
        loadedModuleIds.push(id);
        return {};
      },
    });
    const request = {
      __kovoRequestIngressSource: 'node-http1',
      complete: true,
      headers: { host: 'app.test', 'transfer-encoding': 'chunked' },
      httpVersion: '1.1',
      method: 'GET',
      rawHeaders: ['Host', 'app.test', 'Transfer-Encoding', 'chunked'],
      socket: { remoteAddress: '203.0.113.7' } as Socket,
      url: '/cart',
    } as IncomingMessage;
    const response = {
      end(body?: string) {
        responseBody = body ?? '';
        return this;
      },
      headersSent: false,
      writeHead(status: number) {
        responseStatus = status;
        return this;
      },
    } as unknown as ServerResponse;

    middlewares[0]?.(request, response, () => {
      nextCalls += 1;
    });

    expect(responseStatus).toBe(413);
    expect(responseBody).toBe('Payload Too Large');
    expect(loadedModuleIds).toEqual([]);
    expect(nextCalls).toBe(0);
  });

  it('rejects full ingress failures before loading the Vite SSR dispatcher', () => {
    const middlewares: KovoAppShellViteMiddleware[] = [];
    const loadedModuleIds: string[] = [];
    let nextCalls = 0;
    const plugin = kovoAppShellViteDevPlugin();
    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      async ssrLoadModule(id) {
        loadedModuleIds.push(id);
        return { dispatchKovoAppShellViteDevRequest() {} };
      },
    });
    for (const ingress of rejectedVitePreAppIngress()) {
      let responseBody = '';
      let responseStatus = 0;
      const response = {
        end(body?: string) {
          responseBody = body ?? '';
          return this;
        },
        headersSent: false,
        writeHead(status: number) {
          responseStatus = status;
          return this;
        },
      } as unknown as ServerResponse;

      middlewares[0]?.(ingress.request, response, () => {
        nextCalls += 1;
      });

      expect(loadedModuleIds, ingress.label).toEqual([]);
      expect(nextCalls, ingress.label).toBe(0);
      expect({ body: responseBody, status: responseStatus }, ingress.label).toEqual({
        body: ingress.body,
        status: ingress.status,
      });
    }
  });

  it('rejects body-framed GET before graph-local Vite SSR or app loading', async () => {
    const loadedModuleIds: string[] = [];
    let nextCalls = 0;
    let responseBody = '';
    let responseStatus = 0;
    const request = {
      __kovoRequestIngressSource: 'node-http1',
      complete: true,
      headers: { host: 'app.test', 'transfer-encoding': 'chunked' },
      httpVersion: '1.1',
      method: 'GET',
      rawHeaders: ['Host', 'app.test', 'Transfer-Encoding', 'chunked'],
      socket: { remoteAddress: '203.0.113.7' } as Socket,
      url: '/cart',
    } as IncomingMessage;
    const response = {
      end(body?: string) {
        responseBody = body ?? '';
        return this;
      },
      headersSent: false,
      writeHead(status: number) {
        responseStatus = status;
        return this;
      },
    } as unknown as ServerResponse;

    await dispatchKovoAppShellViteDevRequest(
      {
        middlewares: { use() {} },
        async ssrLoadModule(id) {
          loadedModuleIds.push(id);
          return {};
        },
      },
      {},
      request,
      response,
      () => {
        nextCalls += 1;
      },
    );

    expect({ body: responseBody, status: responseStatus }).toEqual({
      body: 'Payload Too Large',
      status: 413,
    });
    expect(loadedModuleIds).toEqual([]);
    expect(nextCalls).toBe(0);
  });

  it('rejects full ingress failures before graph-local Vite SSR or app loading', async () => {
    const app = createApp({
      routes: [
        route('/cart', {
          page: () =>
            trustedHtml('<main>unreachable</main>', {
              reason: 'framework server rendering test fixture',
            }),
        }),
      ],
    });
    const loadedModuleIds: string[] = [];
    const shouldHandleRequest = vi.fn(() => false);
    let nextCalls = 0;
    for (const ingress of rejectedVitePreAppIngress()) {
      let responseBody = '';
      let responseStatus = 0;
      const response = {
        end(body?: string) {
          responseBody = body ?? '';
          return this;
        },
        headersSent: false,
        writeHead(status: number) {
          responseStatus = status;
          return this;
        },
      } as unknown as ServerResponse;

      await dispatchKovoAppShellViteDevRequest(
        {
          middlewares: { use() {} },
          async ssrLoadModule(id) {
            loadedModuleIds.push(id);
            return { default: app };
          },
        },
        { shouldHandleRequest },
        ingress.request,
        response,
        () => {
          nextCalls += 1;
        },
      );

      expect(loadedModuleIds, ingress.label).toEqual([]);
      expect(shouldHandleRequest, ingress.label).not.toHaveBeenCalled();
      expect(nextCalls, ingress.label).toBe(0);
      expect({ body: responseBody, status: responseStatus }, ingress.label).toEqual({
        body: ingress.body,
        status: ingress.status,
      });
    }
  });

  it('rejects body-framed GET before live Vite filtering or app dispatch', () => {
    const middlewares: KovoAppShellViteMiddleware[] = [];
    const page = vi.fn(() =>
      trustedHtml('<main>unreachable</main>', {
        reason: 'framework server rendering test fixture',
      }),
    );
    const shouldHandleRequest = vi.fn(() => true);
    const plugin = kovoAppShellVitePlugin(createApp({ routes: [route('/cart', { page })] }), {
      shouldHandleRequest,
    });
    let responseBody = '';
    let responseStatus = 0;
    let nextCalls = 0;
    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });
    const request = {
      __kovoRequestIngressSource: 'node-http1',
      complete: true,
      headers: { 'content-length': '1', host: 'app.test' },
      httpVersion: '1.1',
      method: 'GET',
      rawHeaders: ['Host', 'app.test', 'Content-Length', '1'],
      socket: { remoteAddress: '203.0.113.7' } as Socket,
      url: '/cart',
    } as IncomingMessage;
    const response = {
      end(body?: string) {
        responseBody = body ?? '';
        return this;
      },
      headersSent: false,
      writeHead(status: number) {
        responseStatus = status;
        return this;
      },
    } as unknown as ServerResponse;

    middlewares[0]?.(request, response, () => {
      nextCalls += 1;
    });

    expect({ body: responseBody, status: responseStatus }).toEqual({
      body: 'Payload Too Large',
      status: 413,
    });
    expect(shouldHandleRequest).not.toHaveBeenCalled();
    expect(page).not.toHaveBeenCalled();
    expect(nextCalls).toBe(0);
  });

  it('rejects full ingress failures before live Vite filtering or app dispatch', () => {
    const middlewares: KovoAppShellViteMiddleware[] = [];
    const page = vi.fn(() =>
      trustedHtml('<main>unreachable</main>', {
        reason: 'framework server rendering test fixture',
      }),
    );
    const shouldHandleRequest = vi.fn(() => false);
    const plugin = kovoAppShellVitePlugin(createApp({ routes: [route('/cart', { page })] }), {
      shouldHandleRequest,
    });
    let nextCalls = 0;
    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });
    for (const ingress of rejectedVitePreAppIngress()) {
      let responseBody = '';
      let responseStatus = 0;
      const response = {
        end(body?: string) {
          responseBody = body ?? '';
          return this;
        },
        headersSent: false,
        writeHead(status: number) {
          responseStatus = status;
          return this;
        },
      } as unknown as ServerResponse;

      middlewares[0]?.(ingress.request, response, () => {
        nextCalls += 1;
      });

      expect(shouldHandleRequest, ingress.label).not.toHaveBeenCalled();
      expect(page, ingress.label).not.toHaveBeenCalled();
      expect(nextCalls, ingress.label).toBe(0);
      expect({ body: responseBody, status: responseStatus }, ingress.label).toEqual({
        body: ingress.body,
        status: ingress.status,
      });
    }
  });

  it('owns the app-shell dev plugin option matrix for generated module loading', async () => {
    const app = createApp({
      routes: [
        route('/cart', {
          page: () =>
            trustedHtml('<main>Cart</main>', { reason: 'framework server rendering test fixture' }),
        }),
      ],
    });
    const plugin = kovoAppShellViteDevPlugin({
      appExportName: 'shopApp',
      moduleId: '/src/generated/app-shell.kovo-route.tsx',
      name: 'kovo-shop-app-shell-dev',
      nodeHandlerExportName: 'shopNodeHandler',
      order: 'post',
    });
    const middlewares: KovoAppShellViteMiddleware[] = [];
    const loadedModuleIds: string[] = [];
    let handlerCalls = 0;

    const postHook = plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      ssrLoadModule: viteDevSsrLoadModule(async (id) => {
        loadedModuleIds.push(id);
        return {
          shopApp: app,
          shopNodeHandler(_request: unknown, response: { end(body: string): void }) {
            handlerCalls += 1;
            response.end('handled by generated app shell');
          },
        };
      }),
    });

    expect(plugin.name).toBe('kovo-shop-app-shell-dev');
    expect(middlewares).toEqual([]);
    expect(postHook).toBeTypeOf('function');
    if (typeof postHook !== 'function') {
      throw new Error('post-order app-shell dev plugin did not return its install hook');
    }
    postHook();
    expect(middlewares).toHaveLength(1);

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
        body: 'handled by generated app shell',
        status: 200,
      });
      expect(loadedModuleIds).toEqual(['/src/generated/app-shell.kovo-route.tsx']);
      expect(handlerCalls).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('registers dev middleware that serves shell requests and passes source assets onward', async () => {
    const productRoute = route('/products/:id', {
      meta: { title: 'Product' },
      page({ params }) {
        return renderedHtml(`<main>${params.id}</main>`);
      },
    });
    const plugin = kovoAppShellVitePlugin(createApp({ routes: [productRoute] }));
    const middlewares: KovoAppShellViteMiddleware[] = [];

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
        return renderedHtml(`<main>${params.id}</main>`);
      },
    });
    const app = createApp({ routes: [productRoute] });
    const plugin = kovoAppShellViteDevPlugin({
      nodeHandlerExportName: 'shopNodeHandler',
    });
    const middlewares: KovoAppShellViteMiddleware[] = [];
    let moduleLoads = 0;
    let handled = 0;

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      ssrLoadModule: viteDevSsrLoadModule(async (id) => {
        moduleLoads += 1;
        expect(id).toBe('/src/app-shell.ts');
        return {
          shopNodeHandler(_request: unknown, response: { end(body: string): void }) {
            handled += 1;
            response.end('handled by dev app shell');
          },
          default: app,
        };
      }),
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
    });
    const productRoute = route('/products/:id', {
      modulepreloads: [clientHref],
      page({ params }) {
        return renderedHtml(`<main>${params.id}</main>`);
      },
    });
    const app = createApp({ clientModules: registry, routes: [productRoute] });
    const plugin = kovoAppShellViteDevPlugin();
    const middlewares: KovoAppShellViteMiddleware[] = [];
    let moduleLoads = 0;

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      ssrLoadModule: viteDevSsrLoadModule(async (id) => {
        moduleLoads += 1;
        expect(id).toBe('/src/app-shell.ts');
        return { default: app };
      }),
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
          link: `<${clientHref}>; rel=modulepreload`,
        }),
        status: 200,
      });
      await expect(nodeFetch(`${origin}${clientHref}`)).resolves.toMatchObject({
        body: 'export const product = true;',
        headers: expect.objectContaining({
          'cache-control': 'public, max-age=31536000, immutable',
          'cross-origin-resource-policy': 'same-origin',
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
    const plugin = kovoAppShellViteDevPlugin({
      nodeHandlerExportName: 'shopNodeHandler',
    });
    const middlewares: KovoAppShellViteMiddleware[] = [];

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      ssrLoadModule: viteDevSsrLoadModule(async () => {
        return { default: app };
      }),
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
        body: '/src/app-shell.ts must export shopNodeHandler as a Node app-shell handler with (request, response).',
        status: 500,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('serves a diagnostic document for page routes that depend on a failed dev module', async () => {
    const diagnostics = createKovoAppShellDevDiagnosticLedger();
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        createRegisteredDiagnostic(
          'KV225',
          {
            fileName: 'src/components/cart.tsx',
            length: 7,
            start: { column: 11, line: 2 },
          },
          { message: 'JSX nesting violates the HTML content model.' },
        ),
      ],
      fileName: 'src/components/cart.tsx',
      source: ['export const Cart = component({', '  render: () => <p><div /></p>', '});'].join(
        '\n',
      ),
    });
    const cartRoute = route('/cart', {
      modulepreloads: ['/c/src/components/cart.client.js?v=failed'],
      page() {
        return renderedHtml('<main>Cart</main>');
      },
    });
    const plugin = kovoAppShellVitePlugin(createApp({ routes: [cartRoute] }), {
      devDiagnostics: diagnostics,
    });
    const middlewares: KovoAppShellViteMiddleware[] = [];

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
        body: expect.stringContaining('<p class="kovo-diagnostic-code">KV225</p>'),
        headers: expect.objectContaining({
          'content-type': 'text/html; charset=utf-8',
        }),
        status: 500,
      });
      expect(response.body).toContain('<title>KV225 diagnostic</title>');
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

function viteDevSsrLoadModule(
  loadAppModule: (id: string) => Promise<Record<string, unknown>> | Record<string, unknown>,
): (id: string) => Promise<Record<string, unknown>> {
  return async (id) =>
    id === '@kovojs/server/internal/app-shell-vite'
      ? { dispatchKovoAppShellViteDevRequest }
      : id === '@kovojs/server'
        ? {}
        : await loadAppModule(id);
}
