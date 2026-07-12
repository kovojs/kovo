import type { IncomingMessage } from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { DiagnosticDocumentDiagnostic } from './document-diagnostics.js';
import { guards } from './guards.js';
import { renderedHtml } from './html.js';
import { route } from './route.js';
import {
  createKovoAppShellDevDiagnosticLedger,
  dispatchKovoAppShellViteDevRequest,
  kovoAppShellViteDevPlugin,
  renderKovoAppShellViteDevDiagnosticResponse,
  type KovoAppShellViteDevPluginOptions,
  type KovoAppShellViteMiddleware,
} from './vite-dev.js';

describe('Vite-dev intrinsic closure', () => {
  it('keeps compiler errors blocking after late Array.some replacement', () => {
    const diagnostics = createKovoAppShellDevDiagnosticLedger();
    const errors: DiagnosticDocumentDiagnostic[] = [
      {
        code: 'KV225',
        fileName: 'src/components/cart.tsx',
        message: 'unsafe component must block dev output',
      },
    ];
    const originalSome = Array.prototype.some;
    let poisonHits = 0;
    try {
      Array.prototype.some = function hideBlockingDiagnostic(callback, thisArg) {
        if (this === errors) {
          poisonHits += 1;
          return false;
        }
        return Reflect.apply(originalSome, this, [callback, thisArg]) as boolean;
      };
      diagnostics.recordModuleDiagnostics({
        diagnostics: errors,
        fileName: 'src/components/cart.tsx',
      });
    } finally {
      Array.prototype.some = originalSome;
    }

    const response = renderKovoAppShellViteDevDiagnosticResponse(
      createApp({
        routes: [
          route('/cart', {
            modulepreloads: ['/c/src/components/cart.client.js?v=failed'],
          }),
        ],
      }),
      nodeRequest('/cart'),
      diagnostics,
    );
    expect(poisonHits).toBe(0);
    expect(diagnostics.diagnosticsForModuleHref('/c/src/components/cart.client.js')).toBeDefined();
    expect(response).toMatchObject({ status: 500 });
  });

  it('does not let late Array.find shadow an app route with fabricated CSS', async () => {
    const app = createApp({
      routes: [route('/admin', { page: () => renderedHtml('<main>SAFE ADMIN</main>') })],
    });
    const harness = await startDevServer(app, {
      stylesheetAssets: {
        app: [{ criticalCss: 'body { color: green; }', href: '/assets/safe.css' }],
      },
    });
    const originalFind = Array.prototype.find;
    let poisonHits = 0;
    try {
      Array.prototype.find = function forgeStylesheetAsset(
        this: unknown[],
        callback: (value: unknown, index: number, values: unknown[]) => unknown,
        thisArg?: unknown,
      ) {
        if (
          this.length === 1 &&
          (this[0] as { href?: unknown } | undefined)?.href === '/assets/safe.css'
        ) {
          poisonHits += 1;
          return { criticalCss: 'body { color: red; }', href: '/admin' };
        }
        return Reflect.apply(originalFind, this, [callback, thisArg]);
      } as typeof Array.prototype.find;
      const response = await fetch(`${harness.origin}/admin`);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('SAFE ADMIN');
      expect(body).not.toContain('color: red');
      expect(poisonHits).toBe(0);
    } finally {
      Array.prototype.find = originalFind;
      await harness.close();
    }
  });

  it('does not bless an undeclared route through late Array.map replacement', async () => {
    const forgedRoute = route('/undeclared-admin', {
      page: () => renderedHtml('<main>FORGED DEV ROUTE</main>'),
    });
    const app = createApp({
      routes: [route('/safe', { page: () => renderedHtml('<main>SAFE ROUTE</main>') })],
    });
    const harness = await startDevServer(app, {
      stylesheetAssets: { app: [{ href: '/assets/base.css' }] },
    });
    const originalMap = Array.prototype.map;
    let poisonHits = 0;
    try {
      Array.prototype.map = function injectRoute(this: unknown[], callback, thisArg) {
        if (this.length === 1 && (this[0] as { path?: unknown } | undefined)?.path === '/safe') {
          poisonHits += 1;
          return [forgedRoute];
        }
        return Reflect.apply(originalMap, this, [callback, thisArg]) as unknown[];
      } as typeof Array.prototype.map;
      const response = await fetch(`${harness.origin}/undeclared-admin`, {
        headers: { accept: 'text/html' },
      });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('FORGED DEV ROUTE');
      expect(poisonHits).toBe(0);
    } finally {
      Array.prototype.map = originalMap;
      await harness.close();
    }
  });

  it('does not inject an admin principal through late Request substitution', async () => {
    const app = createApp({
      routes: [
        route('/admin', {
          guard: guards.role<any>('admin'),
          page: () => renderedHtml('<main>ADMIN SECRET</main>'),
        }),
      ],
      sessionProvider(request) {
        return request.headers.get('x-vite-admin') === '1'
          ? { user: { id: 'attacker', roles: ['admin'] } }
          : null;
      },
    });
    const harness = await startDevServer(app);
    const NativeRequest = globalThis.Request;
    const NativeHeaders = globalThis.Headers;
    let poisonHits = 0;
    try {
      globalThis.Request = class InjectedHmrRequest extends NativeRequest {
        constructor(input: RequestInfo | URL, init?: RequestInit) {
          const href = input instanceof URL ? input.href : String(input);
          if (href.endsWith('/admin') && init?.method === 'GET') {
            poisonHits += 1;
            const headers = new NativeHeaders(init.headers);
            headers.set('x-vite-admin', '1');
            super(input, { ...init, headers });
            return;
          }
          super(input, init);
        }
      };
      const response = await fetch(`${harness.origin}/@kovo/hmr/refresh/route?url=/admin`);
      expect(response.status).not.toBe(200);
      expect(await response.text()).not.toContain('ADMIN SECRET');
      expect(poisonHits).toBe(0);
    } finally {
      globalThis.Request = NativeRequest;
      await harness.close();
    }
  });

  it('keeps the HMR same-origin gate pinned after late URL substitution', async () => {
    const app = createApp({
      routes: [route('/origin', { page: () => renderedHtml('<main>HOSTILE ORIGIN</main>') })],
    });
    const harness = await startDevServer(app);
    const NativeURL = globalThis.URL;
    let poisonHits = 0;
    try {
      globalThis.URL = class SpoofedTargetOrigin extends NativeURL {
        #comparisonOrigin: string | undefined;

        constructor(input: string | URL, base?: string | URL) {
          super(input, base);
          if (this.hostname === 'attacker.example' && base !== undefined) {
            poisonHits += 1;
            this.#comparisonOrigin = new NativeURL(base).origin;
          }
        }

        override get origin(): string {
          return this.#comparisonOrigin ?? super.origin;
        }
      };
      const response = await fetch(
        `${harness.origin}/@kovo/hmr/refresh/route?url=${encodeURIComponent('https://attacker.example/origin')}`,
      );
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('HOSTILE ORIGIN');
      expect(poisonHits).toBe(0);
    } finally {
      globalThis.URL = NativeURL;
      await harness.close();
    }
  });

  it('keeps buffered HTML pinned after late Buffer.concat replacement', async () => {
    const app = createApp({
      routes: [
        route('/buffered', {
          page: () => renderedHtml('<main>SAFE BUFFERED DOCUMENT</main>'),
        }),
      ],
    });
    const harness = await startDevServer(app);
    const originalConcat = Buffer.concat;
    const originalFrom = Buffer.from;
    const originalToString = Buffer.prototype.toString;
    let poisonHits = 0;
    try {
      Buffer.concat = function replaceBufferedDocument(list, totalLength) {
        const combined = Reflect.apply(
          originalConcat,
          Buffer,
          totalLength === undefined ? [list] : [list, totalLength],
        ) as Buffer;
        const text = Reflect.apply(originalToString, combined, ['utf8']) as string;
        if (
          text.includes('SAFE BUFFERED DOCUMENT') &&
          new Error().stack?.includes('injectKovoHmrScriptIntoNodeResponse')
        ) {
          poisonHits += 1;
          return Reflect.apply(originalFrom, Buffer, [
            '<script>globalThis.__viteBufferPwned=1</script>',
          ]) as Buffer;
        }
        return combined;
      } as typeof Buffer.concat;
      const response = await fetch(`${harness.origin}/buffered`);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain('SAFE BUFFERED DOCUMENT');
      expect(body).not.toContain('__viteBufferPwned');
      expect(poisonHits).toBe(0);
    } finally {
      Buffer.concat = originalConcat;
      await harness.close();
    }
  });

  it('flushes buffered HTML without live Function.call dispatch', async () => {
    const app = createApp({
      routes: [
        route('/call', {
          page: () => renderedHtml('<main>SAFE CALL DOCUMENT</main>'),
        }),
      ],
    });
    const harness = await startDevServer(app);
    const originalCall = Function.prototype.call;
    const originalReflectApply = Reflect.apply;
    let poisonHits = 0;
    try {
      Function.prototype.call = function replaceBufferedFlush(thisArg, ...args) {
        if (typeof args[0] === 'string' && args[0].includes('SAFE CALL DOCUMENT')) {
          poisonHits += 1;
          return originalReflectApply(originalCall, this, [
            thisArg,
            '<script>globalThis.__viteCallPwned=1</script>',
            ...args.slice(1),
          ]);
        }
        return originalReflectApply(originalCall, this, [thisArg, ...args]);
      } as typeof Function.prototype.call;
      const response = await fetch(`${harness.origin}/call`);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain('SAFE CALL DOCUMENT');
      expect(body).not.toContain('__viteCallPwned');
      expect(poisonHits).toBe(0);
    } finally {
      Function.prototype.call = originalCall;
      await harness.close();
    }
  });

  it('captures the Vite SSR loader without live Function.bind dispatch', async () => {
    let middleware: KovoAppShellViteMiddleware | undefined;
    const app = createApp();
    const genuineLoads: string[] = [];
    const server = {
      middlewares: {
        use(handler: KovoAppShellViteMiddleware) {
          middleware = handler;
        },
      },
      async ssrLoadModule(id: string) {
        genuineLoads.push(id);
        return id === '@kovojs/server/internal/app-shell-vite'
          ? { dispatchKovoAppShellViteDevRequest }
          : id === '@kovojs/server'
            ? {}
            : { default: app };
      },
    };
    const originalBind = Function.prototype.bind;
    let poisonHits = 0;
    try {
      Function.prototype.bind = function redirectSsrLoader(thisArg, ...args) {
        if (this === server.ssrLoadModule) {
          poisonHits += 1;
          return async () => ({ dispatchKovoAppShellViteDevRequest: () => undefined });
        }
        return Reflect.apply(originalBind, this, [thisArg, ...args]);
      } as typeof Function.prototype.bind;
      kovoAppShellViteDevPlugin({ moduleId: '/src/app-shell.ts' }).configureServer(server);
    } finally {
      Function.prototype.bind = originalBind;
    }
    await new Promise<void>((resolve, reject) => {
      middleware?.(nodeRequest('/c/unversioned.js'), {} as never, (error) =>
        error ? reject(error) : resolve(),
      );
    });
    expect(poisonHits).toBe(0);
    expect(genuineLoads).toEqual([
      '@kovojs/server/internal/app-shell-vite',
      '@kovojs/server',
      '/src/app-shell.ts',
    ]);
  });
});

function nodeRequest(url: string): IncomingMessage {
  return { headers: {}, method: 'GET', url } as IncomingMessage;
}

async function startDevServer(
  app: ReturnType<typeof createApp>,
  options: Omit<KovoAppShellViteDevPluginOptions, 'moduleId'> = {},
): Promise<{ close(): Promise<void>; origin: string }> {
  let middleware: KovoAppShellViteMiddleware | undefined;
  kovoAppShellViteDevPlugin({ ...options, moduleId: '/src/app-shell.ts' }).configureServer({
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
    ssrLoadModule: async (id) =>
      id === '@kovojs/server/internal/app-shell-vite'
        ? { dispatchKovoAppShellViteDevRequest }
        : id === '@kovojs/server'
          ? {}
          : { default: app },
  });
  const server = createHttpServer((request, response) => {
    middleware?.(request, response, (error) => {
      response.writeHead(error ? 500 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : 'vite fallback');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}
