import type { IncomingMessage } from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';
import { component } from '@kovojs/core';

import { publicAccess } from './access.js';
import { createApp, createRequestHandler } from './app.js';
import { appLiveTargetAttestationAudience } from './live-target-app-identity.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { endpoint } from './endpoint.js';
import { guard, resolveLifecycleRequest } from './guards.js';
import { componentLiveTargetRenderer } from './live-target-renderer.js';
import {
  registerGeneratedLiveTargetRenderer,
  runWithGeneratedLiveTargetRegistry,
} from './live-target-registry.js';
import type { LiveTargetRenderer } from './mutation-wire.js';
import { query, type QueryLoadContext } from './query.js';
import { layout, route } from './route.js';
import {
  createKovoAppShellDevDiagnosticLedger,
  createKovoAppShellViteDevIntegration,
  dispatchKovoAppShellViteDevRequest,
  kovoAppShellViteDevPlugin,
  renderKovoAppShellViteDevDiagnosticResponse,
  type KovoAppShellViteMiddleware,
  shouldHandleKovoAppShellViteRequest,
} from './vite-dev.js';
import { renderedHtml } from './html.js';
import { createLiveTargetAttestation } from './mutation-wire.js';

function withCompilerLiveTargetRenderers<Result>(
  renderers: readonly LiveTargetRenderer<any>[],
  action: () => Result,
): Result {
  return runWithGeneratedLiveTargetRegistry(() => {
    for (const renderer of renderers) registerGeneratedLiveTargetRenderer(renderer);
    return action();
  });
}

function attestedLiveTargetHeader(
  target: string,
  component: string,
  buildToken: string,
  props: Record<string, unknown> = {},
  sourceUrl?: string,
): string {
  const token = createLiveTargetAttestation(
    { component, props, target },
    { buildToken, request: {}, ...(sourceUrl === undefined ? {} : { sourceUrl }) },
  );
  return `${target}#${component}@${token}:${JSON.stringify(props)}`;
}

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
            'Kovo-Live-Targets': `${attestedLiveTargetHeader('product-card', 'src/components/ProductCard', appLiveTargetAttestationAudience(app), { id: 'p1' })}`,
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

  it('records endpoint posture mismatches in the dev diagnostic ledger', async () => {
    const previous = process.env.KOVO_VERIFY_ENDPOINT_POSTURE;
    process.env.KOVO_VERIFY_ENDPOINT_POSTURE = '1';
    const diagnostics = createKovoAppShellDevDiagnosticLedger();
    const app = createApp({
      endpoints: [
        endpoint('/machine/posture-bad', {
          auth: { justification: 'dev diagnostic regression', kind: 'none' },
          csrf: false,
          csrfJustification: 'dev diagnostic regression',
          handler: () =>
            new Response('{"ok":true}', {
              headers: { 'Cache-Control': 'public, max-age=60', 'Content-Type': 'text/plain' },
            }),
          method: 'POST',
          reason: 'dev diagnostic regression',
          response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
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
      ssrLoadModule: viteDevSsrLoadModule(async () => {
        return { default: app };
      }),
    });

    const server = createHttpServer((request, response) => {
      middleware?.(request, response, (error) => {
        response.writeHead(error ? 500 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
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
      const firstResponse = await fetch(`${origin}/machine/posture-bad`, { method: 'POST' });
      await firstResponse.text();
      expect(firstResponse.status).toBe(500);

      const diagnosticResponse = await fetch(`${origin}/machine/posture-bad`, { method: 'POST' });
      const diagnosticBody = await diagnosticResponse.text();

      expect(diagnosticResponse.status).toBe(500);
      expect(diagnosticBody).toContain('<p class="kovo-diagnostic-code">KV423</p>');
      expect(diagnosticBody).toContain('response posture mismatch');
      expect(diagnosticBody).toContain('Cache-Control: no-store');
      expect(diagnosticBody).toContain('content type is not JSON');
    } finally {
      if (previous === undefined) delete process.env.KOVO_VERIFY_ENDPOINT_POSTURE;
      else process.env.KOVO_VERIFY_ENDPOINT_POSTURE = previous;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('logs server-side route render exceptions in dev without app onError', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const oauthCode = 'OAUTH_CODE_SHOULD_NEVER_LOG';
    const state = 'RESET_STATE_SHOULD_NEVER_LOG';
    const app = createApp({
      routes: [
        route('/throws', {
          page(_input, request) {
            throw new Error(`render exploded at ${request.url}`);
          },
        }),
      ],
    });
    let middleware: KovoAppShellViteMiddleware | undefined;
    const plugin = kovoAppShellViteDevPlugin({
      moduleId: '/src/app-shell.ts',
    });

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
      ssrLoadModule: viteDevSsrLoadModule(async () => {
        return { default: app };
      }),
    });

    const server = createHttpServer((request, response) => {
      middleware?.(request, response, (error) => {
        response.writeHead(error ? 500 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
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
      const response = await fetch(`${origin}/throws?OAuthCode=${oauthCode}&State=${state}`);
      await response.text();

      expect(response.status).toBe(500);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[kovo dev] route-page failed route=/throws'),
        expect.any(Error),
      );
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(oauthCode);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(state);
      expect(String(errorSpy.mock.calls[0]?.[1])).toContain('/throws?OAuthCode&State');
    } finally {
      errorSpy.mockRestore();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
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
    await integration.plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      ssrLoadModule: viteDevSsrLoadModule(async (id) => {
        expect(id).toBe('/src/app-shell.ts');
        return {
          shopApp: createApp({
            routes: [
              route('/cart', {
                modulepreloads: ['/c/src/components/cart.client.js?v=failed'],
                page: () => trustedHtml('<main>Cart</main>'),
              }),
            ],
          }),
        };
      }),
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

  it('reloads the graph-local request dispatcher after Vite SSR invalidation', async () => {
    let middleware: KovoAppShellViteMiddleware | undefined;
    const integration = createKovoAppShellViteDevIntegration({
      moduleId: '/src/app-shell.ts',
    });
    const firstDispatch = vi.fn(
      async (...args: Parameters<typeof dispatchKovoAppShellViteDevRequest>) => args[4](),
    );
    const reloadedDispatch = vi.fn(
      async (...args: Parameters<typeof dispatchKovoAppShellViteDevRequest>) => args[4](),
    );
    let requestCount = 0;
    const server = {
      config: { root: '/workspace/app' },
      middlewares: {
        use(handler: KovoAppShellViteMiddleware) {
          middleware = handler;
        },
      },
      async ssrLoadModule(id: string) {
        expect(id).toBe('@kovojs/server/internal/app-shell-vite');
        return {
          dispatchKovoAppShellViteDevRequest:
            requestCount++ === 0 ? firstDispatch : reloadedDispatch,
        };
      },
      ws: { send: vi.fn() },
    };

    integration.plugin.configureServer(server);
    const invoke = () =>
      new Promise<void>((resolve, reject) => {
        middleware?.(request('/'), {} as Parameters<KovoAppShellViteMiddleware>[1], (error) =>
          error ? reject(error) : resolve(),
        );
      });

    await invoke();
    await invoke();

    expect(firstDispatch).toHaveBeenCalledOnce();
    expect(reloadedDispatch).toHaveBeenCalledOnce();
    expect(firstDispatch.mock.calls[0]?.[1]).toMatchObject({
      devDiagnostics: integration.diagnostics,
      moduleId: '/src/app-shell.ts',
    });
    expect(reloadedDispatch.mock.calls[0]?.[1]).toMatchObject({
      devDiagnostics: integration.diagnostics,
      moduleId: '/src/app-shell.ts',
    });
  });

  it('rejects a structural app clone after a simulated HMR module reload', async () => {
    const app = createApp();
    const structuralClone = { ...app };
    let middleware: KovoAppShellViteMiddleware | undefined;
    let appLoad = 0;
    const plugin = kovoAppShellViteDevPlugin({ moduleId: '/src/app-shell.ts' });
    plugin.configureServer({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
      async ssrLoadModule(id) {
        if (id === '@kovojs/server/internal/app-shell-vite') {
          return { dispatchKovoAppShellViteDevRequest };
        }
        if (id === '@kovojs/server') return {};
        expect(id).toBe('/src/app-shell.ts');
        return { default: appLoad++ === 0 ? app : structuralClone };
      },
    });
    const invoke = () =>
      new Promise<void>((resolve, reject) => {
        middleware?.(
          request('/c/unversioned.client.js'),
          {} as Parameters<KovoAppShellViteMiddleware>[1],
          (error) => (error ? reject(error) : resolve()),
        );
      });

    await expect(invoke()).resolves.toBeUndefined();
    await expect(invoke()).rejects.toThrow(
      '/src/app-shell.ts must export default as a Kovo app for Vite dev.',
    );
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
      clientModules,
      routes: [
        route('/', {
          modulepreloads: [moduleHref],
          page() {
            return renderedHtml('<main>dev app shell</main>');
          },
        }),
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
      ssrLoadModule: viteDevSsrLoadModule(async (id) => {
        expect(id).toBe('/src/app-shell.ts');
        return { default: app };
      }),
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

  it('does not inject the dev HMR client into typed-read fragment responses', async () => {
    const app = createApp({
      queries: [
        query('directory-stats', {
          load: () => ({ contacts: 2 }),
          reads: [],
        }),
      ],
      routes: [
        route('/directory', {
          page() {
            return renderedHtml('<main>Directory</main>');
          },
        }),
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
      ssrLoadModule: viteDevSsrLoadModule(async () => {
        return { default: app };
      }),
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
      const queryResponse = await fetch(`${origin}/_q/directory-stats`, {
        headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
      });
      const queryBody = await queryResponse.text();
      const documentResponse = await fetch(`${origin}/directory`, {
        headers: { Accept: 'text/html' },
      });
      const documentBody = await documentResponse.text();

      expect(queryResponse.status).toBe(200);
      expect(queryResponse.headers.get('content-type')).toContain('text/html');
      expect(queryBody).toBe('<kovo-query name="directory-stats">{"contacts":2}</kovo-query>');
      expect(queryBody).not.toContain('<script type="module" src="/@kovo/hmr-client"></script>');
      expect(documentResponse.status).toBe(200);
      expect(documentBody).toContain('<script type="module" src="/@kovo/hmr-client"></script>');
      expect(documentBody).toContain('<main>Directory</main>');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('serves build-owned stylesheet chunks through the default dev handler', async () => {
    const ShellLayout = layout({
      render(_queries, _state, { children }) {
        return renderedHtml(`<section data-shell="true">${String(children)}</section>`);
      },
    });
    const app = createApp({
      routes: [
        route('/', {
          layout: ShellLayout,
          page() {
            return renderedHtml('<main>styled dev app shell</main>');
          },
        }),
        route('/login', {
          page() {
            return renderedHtml('<main>login</main>');
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
      ssrLoadModule: viteDevSsrLoadModule(async (id) => {
        expect(id).toBe('/src/app-shell.ts');
        return { default: app };
      }),
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
      expect(documentBody).not.toContain(
        '<link rel="preload" as="style" href="/assets/base.css" data-kovo-deferred-style>',
      );
      expect(documentBody).not.toContain(
        '<link rel="preload" as="style" href="/assets/routes/index.css" data-kovo-deferred-style>',
      );
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
        route('/products/:id', { page: () => trustedHtml('<main>Param</main>') }),
        route('/products/new', { page: () => trustedHtml('<main>New</main>') }),
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
      ssrLoadModule: viteDevSsrLoadModule(async (id) => {
        expect(id).toBe('/src/app-shell.ts');
        return { default: app };
      }),
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
      ssrLoadModule: viteDevSsrLoadModule(async () => {
        return { default: app };
      }),
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
    const originalStringReplace = String.prototype.replace;
    const NativeResponse = globalThis.Response;
    const safeDocument = '<!doctype html><html><head></head><body><main>Cart</main></body></html>';
    const poisonedDocument = '<script>globalThis.__kovoDevHmrPwned=1</script>';
    const poisonedClient = 'globalThis.__kovoDevHmrClientPwned=1;';
    const app = createApp({
      routes: [route('/cart', { page: () => trustedHtml('<main>Cart</main>') })],
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
      ssrLoadModule: viteDevSsrLoadModule(async () => {
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
            response.end(safeDocument);
          },
        };
      }),
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
      String.prototype.replace = function replaceReviewedDevDocument(search, replacement) {
        const value = Reflect.apply(String, undefined, [this]) as string;
        if (value === safeDocument && search === '</head>') return poisonedDocument;
        return Reflect.apply(originalStringReplace, value, [search, replacement]);
      } as typeof String.prototype.replace;
      const documentResponse = await fetch(`${origin}/cart`);
      const documentBody = await documentResponse.text();
      globalThis.Response = class PoisonedHmrResponse extends NativeResponse {
        constructor(body?: BodyInit | null, init?: ResponseInit) {
          super(
            typeof body === 'string' && body.includes('createHotContext') ? poisonedClient : body,
            init,
          );
        }
      };
      const clientResponse = await fetch(`${origin}/@kovo/hmr-client`);
      const clientBody = await clientResponse.text();

      expect(documentResponse.status).toBe(200);
      expect(documentBody).toContain(
        '<script type="module" src="/@kovo/hmr-client"></script></head>',
      );
      expect(documentBody).not.toContain(poisonedDocument);
      expect(clientResponse.status).toBe(200);
      expect(clientResponse.headers.get('cache-control')).toBe('no-store');
      expect(clientBody).not.toBe(poisonedClient);
      expect(clientBody).toContain('createHotContext("/@kovo/hmr-client")');
      expect(clientBody).toContain('hot.on("kovo:component-render"');
      expect(clientBody).toContain('hot.on("kovo:diagnostics"');
      expect(clientBody).toContain('/@kovo/hmr/refresh/route');
      expect(clientBody).toContain('/@kovo/hmr/refresh/live-targets');
    } finally {
      String.prototype.replace = originalStringReplace;
      globalThis.Response = NativeResponse;
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
      clientModules,
      routes: [
        route('/cart', {
          page() {
            return renderedHtml('<main>Cart refresh</main>');
          },
        }),
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
      ssrLoadModule: viteDevSsrLoadModule(async () => {
        return { default: app };
      }),
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
            return renderedHtml('<main>Cart refresh</main>');
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
      ssrLoadModule: viteDevSsrLoadModule(async () => {
        return { default: app };
      }),
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
    const observedSourceRequests: Request[] = [];
    const cartRenderer: LiveTargetRenderer<Request> = {
      component: 'src/components/CartBadge',
      mutationKeys: [],
      async render(context) {
        observedSourceRequests.push(context.request);
        expect(new URL(context.request.url).pathname).toBe('/cart');
        return `<cart-badge data-target="${context.target}">${String(context.props.count)}</cart-badge>`;
      },
      stylesheets: ['/assets/cart.css'],
    };
    const app = withCompilerLiveTargetRenderers([cartRenderer], () =>
      createApp({
        clientModules,
        routes: [
          route('/cart', {
            access: [
              guard('canonical HMR source request', (request) => {
                observedSourceRequests.push(request);
                return true;
              }),
            ],
            page: () => renderedHtml('<main>Cart</main>'),
          }),
        ],
      }),
    );
    let middleware: KovoAppShellViteMiddleware | undefined;
    const plugin = kovoAppShellViteDevPlugin({ moduleId: '/src/app-shell.ts' });

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
      ssrLoadModule: viteDevSsrLoadModule(async () => {
        return { default: app };
      }),
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
      const response = await fetch(`${origin}/@kovo/hmr/refresh/live-targets?oldBuild=old-build`, {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer retained',
          cookie: 'session=retained',
          'Content-Type': 'application/json',
          'Kovo-Current-Url': '/cart?tab=summary',
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart-badge', 'src/components/CartBadge', appLiveTargetAttestationAudience(app), { count: 3 }, `${origin}/cart?tab=summary`)}`,
          origin: 'https://attacker.invalid',
          referer: `${origin}/forged-source`,
          'Sec-Fetch-Site': 'cross-site',
          'X-App-Context': 'retained',
          'X-HTTP-Method-Override': 'DELETE',
          'X-Requested-With': 'XMLHttpRequest',
        },
        method: 'POST',
      });
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
      expect(observedSourceRequests).toHaveLength(2);
      for (const sourceRequest of observedSourceRequests) {
        expect(sourceRequest.method).toBe('GET');
        expect(sourceRequest.url).toBe(`${origin}/cart?tab=summary`);
        expect(sourceRequest.headers.get('accept')).toBe('text/html');
        expect(sourceRequest.headers.get('authorization')).toBe('Bearer retained');
        expect(sourceRequest.headers.get('cookie')).toBe('session=retained');
        expect(sourceRequest.headers.get('x-app-context')).toBe('retained');
        expect(sourceRequest.headers.get('content-type')).toBeNull();
        expect(sourceRequest.headers.get('kovo-current-url')).toBeNull();
        expect(sourceRequest.headers.get('kovo-fragment')).toBeNull();
        expect(sourceRequest.headers.get('kovo-live-targets')).toBeNull();
        expect(sourceRequest.headers.get('origin')).toBeNull();
        expect(sourceRequest.headers.get('referer')).toBeNull();
        expect(sourceRequest.headers.get('sec-fetch-site')).toBeNull();
        expect(sourceRequest.headers.get('x-http-method-override')).toBeNull();
        expect(sourceRequest.headers.get('x-requested-with')).toBeNull();
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('runs the exact target route and layout guards before HMR live-target queries', async () => {
    const secret = 'ADMIN_HMR_SECRET_MUST_NOT_LEAK';
    let layoutGuardRuns = 0;
    let routeGuardRuns = 0;
    let secretQueryLoads = 0;
    const adminLayout = layout<Request>({
      access: [
        guard('hmr-admin-layout', () => {
          layoutGuardRuns += 1;
          return true;
        }),
      ],
    });
    const adminRoute = route('/admin', {
      access: [
        guard<Request>('hmr-admin-route', (request) => {
          routeGuardRuns += 1;
          return request.headers.get('x-kovo-admin') === 'true'
            ? true
            : { kind: 'forbidden' as const };
        }),
      ],
      layout: adminLayout,
      page: () => renderedHtml('<main>Admin</main>'),
    });
    const publicRoute = route('/public', {
      access: publicAccess('HMR public-route regression'),
      page: () => renderedHtml('<main>Public</main>'),
    });
    const secretQuery = query('hmr-route-secret', {
      access: publicAccess('enclosing route owns this HMR regression authorization'),
      load(_input: unknown, context?: QueryLoadContext<Request>) {
        secretQueryLoads += 1;
        const pathname = new URL((context?.request as Request).url).pathname;
        return { value: pathname === '/admin' ? secret : 'PUBLIC_VALUE' };
      },
    });
    const SecretPanel = component({
      render: ({ record }) =>
        renderedHtml(`<secret-panel>${(record as { value: string }).value}</secret-panel>`),
    });
    const renderer = componentLiveTargetRenderer({
      component: SecretPanel,
      componentId: 'src/components/SecretPanel',
      queries: [{ name: 'record', query: secretQuery }],
    });
    const app = withCompilerLiveTargetRenderers([renderer], () =>
      createApp({ routes: [publicRoute, adminRoute] }),
    );
    let middleware: KovoAppShellViteMiddleware | undefined;
    kovoAppShellViteDevPlugin({ moduleId: '/src/app-shell.ts' }).configureServer({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
      ssrLoadModule: viteDevSsrLoadModule(async () => ({ default: app })),
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
      const directAdmin = await fetch(`${origin}/admin`);
      expect(directAdmin.status).toBe(403);
      expect(await directAdmin.text()).not.toContain(secret);

      const liveTarget = attestedLiveTargetHeader(
        'secret-panel',
        'src/components/SecretPanel',
        appLiveTargetAttestationAudience(app),
        {},
        `${origin}/public`,
      );
      const publicRefresh = await fetch(`${origin}/@kovo/hmr/refresh/live-targets?url=/public`, {
        headers: {
          'Kovo-Current-Url': '/public',
          'Kovo-Live-Targets': liveTarget,
        },
        method: 'POST',
      });
      const publicBody = await publicRefresh.text();
      expect(publicRefresh.status, publicBody).toBe(200);
      expect(publicBody).toContain('<secret-panel>PUBLIC_VALUE</secret-panel>');
      expect(secretQueryLoads).toBe(1);

      const missingRouteRefresh = await fetch(
        `${origin}/@kovo/hmr/refresh/live-targets?url=/missing`,
        {
          headers: {
            'Kovo-Current-Url': '/public',
            'Kovo-Live-Targets': liveTarget,
          },
          method: 'POST',
        },
      );
      expect(missingRouteRefresh.status).toBe(409);
      expect(missingRouteRefresh.headers.get('kovo-hmr-fallback')).toBe('full-reload');
      expect(await missingRouteRefresh.text()).not.toContain(secret);
      expect(secretQueryLoads).toBe(1);

      const layoutRunsBeforeAttack = layoutGuardRuns;
      const routeRunsBeforeAttack = routeGuardRuns;
      const queryLoadsBeforeAttack = secretQueryLoads;
      const crossRouteAttack = await fetch(`${origin}/@kovo/hmr/refresh/live-targets?url=/admin`, {
        headers: {
          'Kovo-Current-Url': '/public',
          'Kovo-Live-Targets': liveTarget,
        },
        method: 'POST',
      });
      const attackBody = await crossRouteAttack.text();

      expect(crossRouteAttack.status, attackBody).toBe(403);
      expect(crossRouteAttack.headers.get('kovo-hmr-fallback')).toBe('full-reload');
      expect(attackBody).not.toContain(secret);
      expect(layoutGuardRuns).toBe(layoutRunsBeforeAttack + 1);
      expect(routeGuardRuns).toBe(routeRunsBeforeAttack + 1);
      expect(secretQueryLoads).toBe(queryLoadsBeforeAttack);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('rejects a live-target descriptor minted for a different resolved principal without app CSRF config', async () => {
    type SessionRequest = Request & {
      session: { user: { id: string } } | null;
    };
    const victimSecret = 'VICTIM_HMR_DESCRIPTOR_SECRET';
    const sessions = (request: Request) => {
      const id = request.headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/u)?.[1];
      return id === undefined ? null : { user: { id } };
    };
    const render = vi.fn((context: { props: Record<string, unknown> }) =>
      context.props.accountId === 'victim'
        ? `<account-secret>${victimSecret}</account-secret>`
        : '<account-secret>own</account-secret>',
    );
    const renderer: LiveTargetRenderer<SessionRequest> = {
      component: 'src/components/AccountSecret',
      mutationKeys: [],
      render,
    };
    const accountRoute = route<SessionRequest>('/account', {
      access: [
        guard<SessionRequest>('hmr-authenticated-account', (request) =>
          request.session === null ? { kind: 'unauthenticated' as const } : true,
        ),
      ],
      page: () => renderedHtml('<main>Account</main>'),
    });
    const app = withCompilerLiveTargetRenderers([renderer], () =>
      createApp({ routes: [accountRoute], sessionProvider: sessions }),
    );
    let middleware: KovoAppShellViteMiddleware | undefined;
    kovoAppShellViteDevPlugin({ moduleId: '/src/app-shell.ts' }).configureServer({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
      ssrLoadModule: viteDevSsrLoadModule(async () => ({ default: app })),
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
      const sourceUrl = `${origin}/account`;
      const victimRequest = await resolveLifecycleRequest(
        new Request(sourceUrl, { headers: { cookie: 'session=victim' } }),
        { sessionProvider: sessions },
      );
      const descriptor = {
        component: renderer.component,
        props: { accountId: 'victim' },
        target: 'account-secret',
      };
      const victimToken = createLiveTargetAttestation(descriptor, {
        buildToken: appLiveTargetAttestationAudience(app),
        request: victimRequest,
        sourceUrl,
      });

      const response = await fetch(`${origin}/@kovo/hmr/refresh/live-targets?url=/account`, {
        headers: {
          cookie: 'session=attacker',
          'Kovo-Live-Targets': `account-secret#${renderer.component}@${victimToken}:{"accountId":"victim"}`,
        },
        method: 'POST',
      });
      const body = await response.text();

      expect(response.status, body).toBe(400);
      expect(body).not.toContain(victimSecret);
      expect(render).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('keeps HMR live-target wire assembly pinned after an authored renderer mutates arrays', async () => {
    const originalJoin = Array.prototype.join;
    const payload =
      '<kovo-fragment target="cart-badge"><img src=x onerror="globalThis.__kovoHmrXss=1"></kovo-fragment>';
    let poisonHits = 0;
    const cartRenderer: LiveTargetRenderer<Request> = {
      component: 'src/components/CartBadge',
      mutationKeys: [],
      async render(context) {
        Array.prototype.join = function substituteHmrFragment(separator) {
          if (
            separator === '\n' &&
            this.length === 1 &&
            typeof this[0] === 'string' &&
            Reflect.apply(String.prototype.startsWith, this[0], [
              '<kovo-fragment target="cart-badge">',
            ])
          ) {
            poisonHits += 1;
            return payload;
          }
          return Reflect.apply(originalJoin, this, [separator]) as string;
        };
        return `<cart-badge data-target="${context.target}">safe</cart-badge>`;
      },
    };
    const app = withCompilerLiveTargetRenderers([cartRenderer], () =>
      createApp({
        routes: [
          route('/cart', {
            access: publicAccess('HMR intrinsic-pinning regression'),
            page: () => renderedHtml('<main>Cart</main>'),
          }),
        ],
      }),
    );
    let middleware: KovoAppShellViteMiddleware | undefined;
    kovoAppShellViteDevPlugin({ moduleId: '/src/app-shell.ts' }).configureServer({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
      ssrLoadModule: viteDevSsrLoadModule(async () => ({ default: app })),
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
      const response = await fetch(`${origin}/@kovo/hmr/refresh/live-targets`, {
        headers: {
          'Kovo-Current-Url': '/cart',
          'Kovo-Live-Targets': attestedLiveTargetHeader(
            'cart-badge',
            'src/components/CartBadge',
            appLiveTargetAttestationAudience(app),
            {},
            `${origin}/cart`,
          ),
        },
        method: 'POST',
      });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).not.toContain(payload);
      expect(body).toContain('<cart-badge data-target="cart-badge">safe</cart-badge>');
      expect(poisonHits).toBe(0);
    } finally {
      Array.prototype.join = originalJoin;
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
              return renderedHtml('<main>Cart production page</main>');
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
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart-badge', 'src/components/CartBadge', 'unused-production-build', { count: 3 })}`,
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
      ssrLoadModule: viteDevSsrLoadModule(async () => {
        return {
          default: app,
          async handler(_request: Request) {
            return new Response('stale web handler');
          },
        };
      }),
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
