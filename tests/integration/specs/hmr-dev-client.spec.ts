// SPEC.md §9.5.1: dev HMR asks the app shell for server-owned fragment output.
import { component } from '@kovojs/core';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileComponentModule,
  kovoVitePlugin,
  type KovoVitePlugin,
  type KovoVitePluginOptions,
} from '@kovojs/compiler';
import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { createApp } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, route, s } from '@kovojs/server';
import { jsx } from '@kovojs/server/jsx-runtime';
import {
  createKovoAppShellDevDiagnosticLedger,
  createKovoAppShellViteDevIntegration,
  dispatchKovoAppShellViteDevRequest,
  kovoAppShellViteDevPlugin,
  runWithGeneratedLiveTargetRegistry,
  type KovoAppShellViteMiddleware,
} from '@kovojs/server/internal/app-shell-vite';
import {
  assignDerivedComponentName,
  componentLiveTargetRenderer,
  registerGeneratedLiveTargetRenderer,
} from '@kovojs/server/internal/wire';
// These specs spin up ad hoc Vite/HTTP HMR servers and mutate module graphs; running
// them concurrently inside one file causes CI-only startup/teardown contention.
test.describe.configure({ mode: 'serial' });

type ViteMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;
type OnModuleDiagnostics = Exclude<KovoVitePluginOptions['onModuleDiagnostics'], undefined>;

test('dev HMR client applies server-rendered live-target fragments without reloading', async ({
  page,
}) => {
  const hmr = domain('hmr');
  let renderVersion = 1;
  const hmrQuery = query('hmr', {
    load() {
      return { version: renderVersion };
    },
    reads: [hmr],
  });
  const Card = assignDerivedComponentName(
    component({
      queries: { hmr: hmrQuery },
      render({ hmr }: { hmr: { version: number } }) {
        return jsx('section', {
          children: [
            jsx('label', { children: 'Draft', for: 'hmr-input' }),
            jsx('input', {
              id: 'hmr-input',
              'kovo-key': 'input',
              value: `server ${hmr.version}`,
            }),
            jsx('output', {
              children: `Version ${hmr.version}`,
              id: 'hmr-output',
              'kovo-key': 'output',
            }),
          ],
        });
      },
    }),
    'hmr/Card',
  );
  const renderer = componentLiveTargetRenderer({
    component: Card,
    componentId: 'hmr/Card',
  });
  const app = runWithGeneratedLiveTargetRegistry(() => {
    registerGeneratedLiveTargetRenderer(renderer);
    return createApp({
      routes: [
        route('/', {
          page() {
            return jsx('main', { children: jsx(Card, {}) });
          },
        }),
      ],
    });
  });
  const server = await serveHmrFixture(app);

  try {
    await navigateToReadyHmrFixture(page, server.origin, 'kovo:component-render');

    await expect(page.locator('#hmr-output')).toHaveText('Version 1');
    await page.locator('#hmr-input').focus();
    await page.locator('#hmr-input').fill('user draft');

    renderVersion = 2;
    const refreshRequest = page.waitForRequest(
      (request) => request.url().includes('/@kovo/hmr/refresh/live-targets'),
      { timeout: 5_000 },
    );
    const refreshResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/@kovo/hmr/refresh/live-targets') && response.status() === 200,
      { timeout: 5_000 },
    );

    await page.evaluate(() => {
      const hot = (
        window as typeof window & {
          __kovoHot?: Record<string, (event?: unknown) => void>;
        }
      ).__kovoHot;
      hot?.['kovo:component-render']?.({ oldFactHash: 'old' });
    });
    const [request] = await Promise.all([refreshRequest, refreshResponse]);
    const headers = request.headers();
    expect(headers['kovo-live-targets']).toContain('Card#hmr%2FCard@');
    expect(headers['kovo-live-targets']).toContain(':{}');
    expect(headers['kovo-targets']).toContain('Card=hmr');
    await expect(page.locator('#hmr-output')).toHaveText('Version 2');
    await expect(page.locator('#hmr-input')).toHaveValue('user draft');
    await expect(page.locator('#hmr-input')).toBeFocused();
    expect(page.url()).toBe(`${server.origin}/`);
  } finally {
    await server.close();
  }
});

test('dev HMR client refreshes query-backed live targets from server state', async ({ page }) => {
  const product = domain('product');
  let stock = 7;
  const queryLoads: string[] = [];
  const productQuery = query('product', {
    args: s.object({ id: s.string() }),
    load(input: { id: string }, context: unknown) {
      const request =
        typeof context === 'object' && context !== null && 'request' in context
          ? (context as { request?: { url?: string } }).request
          : undefined;
      const pathname = new URL(request?.url ?? 'http://kovo.test/').pathname;
      queryLoads.push(`${input.id}:${pathname}`);
      return { id: input.id, stock };
    },
    reads: [product],
  });
  const ProductCard = assignDerivedComponentName(
    component({
      props: { productId: String },
      queries: {
        product: productQuery.args((props: { productId: string }) => ({ id: props.productId })),
      },
      render({ product }: { product: { id: string; stock: number }; productId: string }) {
        return jsx('section', {
          children: [
            jsx('label', { children: 'Note', for: 'product-note' }),
            jsx('input', {
              id: 'product-note',
              'kovo-key': 'note',
              value: `server ${product.stock}`,
            }),
            jsx('output', { children: product.stock, id: 'product-stock', 'kovo-key': 'stock' }),
          ],
        });
      },
    }),
    'hmr/ProductCard',
  );
  const productRenderer = componentLiveTargetRenderer({
    component: ProductCard,
    componentId: 'hmr/ProductCard',
  });
  const app = runWithGeneratedLiveTargetRegistry(() => {
    registerGeneratedLiveTargetRenderer(productRenderer);
    return createApp({
      routes: [
        route('/', {
          page() {
            return jsx('main', {
              children: jsx(ProductCard, { productId: 'p1' }),
            });
          },
        }),
      ],
    });
  });
  const server = await serveHmrFixture(app);

  try {
    await navigateToReadyHmrFixture(page, server.origin, 'kovo:component-render');

    await expect(page.locator('#product-stock')).toHaveText('7');
    await page.locator('#product-note').focus();
    await page.locator('#product-note').fill('keep me');

    stock = 11;
    const refreshRequest = page.waitForRequest((request) =>
      request.url().includes('/@kovo/hmr/refresh/live-targets'),
    );

    await page.evaluate(() => {
      const hot = (
        window as typeof window & {
          __kovoHot?: Record<string, (event?: unknown) => void>;
        }
      ).__kovoHot;
      hot?.['kovo:component-render']?.({ oldFactHash: 'old-query' });
    });
    const request = await refreshRequest;
    const headers = request.headers();
    expect(headers['kovo-live-targets']).toContain('ProductCard%3Ap1#hmr%2FProductCard@');
    expect(headers['kovo-live-targets']).toContain(':{"productId":"p1"}');
    expect(headers['kovo-targets']).toContain(
      'ProductCard%3Ap1=!product!product%3Af10%3Ak2%3Aids2%3Ap1',
    );

    await expect(page.locator('#product-stock')).toHaveText('11');
    await expect(page.locator('#product-note')).toHaveValue('keep me');
    await expect(page.locator('#product-note')).toBeFocused();
    expect(queryLoads).toEqual(['p1:/', 'p1:/']);
    expect(page.url()).toBe(`${server.origin}/`);
  } finally {
    await server.close();
  }
});

test('dev HMR client reloads the canonical document with server diagnostics', async ({ page }) => {
  const failedModule = '/c/src/components/ProductCard.client.js?v=failed';
  const diagnostics = createKovoAppShellDevDiagnosticLedger();
  const app = createApp({
    routes: [
      route('/', {
        modulepreloads: [failedModule],
        page() {
          return '<main><h1>Healthy route</h1></main>';
        },
      }),
    ],
  });
  const server = await serveHmrFixture(app, { devDiagnostics: diagnostics });

  try {
    await navigateToReadyHmrFixture(page, server.origin, 'kovo:diagnostics');
    await expect(page.locator('main')).toContainText('Healthy route');

    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        createRegisteredDiagnostic(
          'KV225',
          { fileName: 'src/components/ProductCard.tsx' },
          { message: 'JSX nesting violates the HTML content model.' },
        ),
      ],
      fileName: 'src/components/ProductCard.tsx',
      moduleHrefs: [failedModule],
      source: 'export const ProductCard = component({ render: () => <p><div /></p> });',
    });
    const documentResponse = page.waitForResponse(
      (response) => response.url() === `${server.origin}/` && response.status() === 500,
    );
    await page.evaluate(() => {
      const hot = (
        window as typeof window & {
          __kovoHot?: Record<string, (event?: unknown) => void>;
        }
      ).__kovoHot;
      hot?.['kovo:diagnostics']?.();
    });
    await documentResponse;

    await expect(page.locator('.kovo-diagnostic-code')).toHaveText('KV225');
    await expect(page.locator('body')).toContainText(
      'JSX nesting violates the HTML content model.',
    );
    await expect(page.locator('main')).not.toContainText('Healthy route');
    expect(page.url()).toBe(`${server.origin}/`);
  } finally {
    await server.close();
  }
});

test('dev HMR client full reloads for route-shell changes', async ({ page }) => {
  let routeVersion = 'before';
  const app = createApp({
    routes: [
      route('/', {
        page() {
          return `<main><h1 id="route-version">${routeVersion}</h1></main>`;
        },
      }),
    ],
  });
  const server = await serveHmrFixture(app);

  try {
    await navigateToReadyHmrFixture(page, server.origin, 'kovo:route-shell');
    await expect(page.locator('#route-version')).toHaveText('before');

    routeVersion = 'after';
    const routeReload = page.waitForResponse(
      (response) =>
        response.url() === `${server.origin}/` &&
        response.request().resourceType() === 'document' &&
        response.status() === 200,
    );
    await page.evaluate(() => {
      const hot = (
        window as typeof window & {
          __kovoHot?: Record<string, (event?: unknown) => void>;
        }
      ).__kovoHot;
      hot?.['kovo:route-shell']?.();
    });
    await routeReload;

    await expect(page.locator('#route-version')).toHaveText('after');
    expect(page.url()).toBe(`${server.origin}/`);
  } finally {
    await server.close();
  }
});

test('Vite source edits refresh rendered text and handler bodies through Kovo HMR', async ({
  page,
}) => {
  const fixture = await serveViteSourceEditFixture({
    card: hmrSourceCard({
      handlerText: 'handler before',
      inputValue: 'server before',
      outputText: 'Version before',
      refreshable: true,
    }),
  });

  try {
    await page.goto(`${fixture.origin}/`);
    await expect(page.locator('#hmr-source-output')).toHaveText('Version before');
    await page.locator('#hmr-source-button').click();
    await expect(page.locator('#hmr-source-button')).toHaveAttribute(
      'data-handler',
      'handler before',
    );
    await page.waitForTimeout(250);

    await page.locator('#hmr-source-input').focus();
    await page.locator('#hmr-source-input').fill('user draft');

    // SPEC.md §9.5.1: observe the injected HMR client's single server-owned refresh. A second
    // test-authored fetch would race the same invalidated Vite graph instead of testing this path.
    const refreshRequest = page.waitForRequest((request) =>
      request.url().includes('/@kovo/hmr/refresh/live-targets'),
    );
    const refreshResponse = page.waitForResponse((response) =>
      response.url().includes('/@kovo/hmr/refresh/live-targets'),
    );
    const events = await fixture.writeCard(
      hmrSourceCard({
        handlerText: 'handler after',
        inputValue: 'server after',
        outputText: 'Version after',
        refreshable: true,
      }),
    );
    const event = expectKovoSourceEditEvent(events, 'kovo:component-render');
    expect(event.oldClientHref).toBeTruthy();
    expect(event.newClientHref).toBeTruthy();
    expect(event.newClientHref).not.toBe(event.oldClientHref);
    const [request, response] = await Promise.all([refreshRequest, refreshResponse]);
    const requestHeaders = request.headers();
    expect(request.method()).toBe('POST');
    expect(new URL(request.url()).searchParams.get('oldBuild')).toBe(requestHeaders['kovo-build']);
    expect(response.status()).toBe(200);
    expect(response.headers()['kovo-hmr-refresh']).toBe('live-targets');
    expect(response.headers()['kovo-previous-build']).toBe(requestHeaders['kovo-build']);
    expect(requestHeaders['kovo-live-targets']).toContain(
      'hmr-source-card#hmr-card%2Fhmr-source-card@',
    );
    expect(requestHeaders['kovo-targets']).toContain('hmr-source-card=hmr');

    await expect(page.locator('#hmr-source-output')).toHaveText('Version after');
    await expect(page.locator('#hmr-source-input')).toHaveValue('user draft');
    await expect(page.locator('#hmr-source-input')).toBeFocused();
    await page.locator('#hmr-source-button').click();
    await expect(page.locator('#hmr-source-button')).toHaveAttribute(
      'data-handler',
      'handler after',
    );
    expect(page.url()).toBe(`${fixture.origin}/`);
  } finally {
    await fixture.close();
  }
});

test('Vite source edits surface and recover from compiler diagnostics', async ({ page }) => {
  const fixture = await serveViteSourceEditFixture({
    card: hmrSourceCard({
      handlerText: 'handler healthy',
      inputValue: 'server healthy',
      outputText: 'Version healthy',
      refreshable: true,
    }),
  });

  try {
    await page.goto(`${fixture.origin}/`);
    await expect(page.locator('#hmr-source-output')).toHaveText('Version healthy');

    const diagnosticEvent = expectKovoSourceEditEvent(
      await fixture.writeCard(hmrInvalidSourceCard()),
      'kovo:diagnostics',
    );
    expect(diagnosticEvent.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV225',
          message: expect.stringContaining('JSX nesting violates the HTML content model'),
        }),
      ]),
    );

    const recoveryEvents = await fixture.writeCard(
      hmrSourceCard({
        handlerText: 'handler recovered',
        inputValue: 'server recovered',
        outputText: 'Version recovered',
        refreshable: true,
      }),
    );
    expectKovoSourceEditEvent(recoveryEvents, 'kovo:component-render');

    await expect(page.locator('#hmr-source-output')).toHaveText('Version recovered');
  } finally {
    await fixture.close();
  }
});

test('Vite route-shell source edits use full reload fallback with fresh server output', async ({
  page,
}) => {
  const fixture = await serveViteSourceEditFixture({
    card: hmrSourceCard({
      handlerText: 'handler route-shell',
      inputValue: 'server route-shell',
      outputText: 'Version route-shell',
      refreshable: true,
    }),
    routeVersion: 'before',
  });

  try {
    await page.goto(`${fixture.origin}/`);
    await expect(page.locator('#hmr-route-version')).toHaveText('before');

    const routeReload = page.waitForResponse(
      (response) =>
        response.url() === `${fixture.origin}/` &&
        response.request().resourceType() === 'document' &&
        response.status() === 200,
    );
    const events = await fixture.writeAppShell({ routeVersion: 'after' });
    const event = expectKovoSourceEditEvent(events, 'kovo:route-shell');
    expect(event).toMatchObject({
      impact: 'routeRefresh',
      reasons: ['route-shell'],
      sourceFile: 'src/app-shell.ts',
    });
    await routeReload;

    await expect(page.locator('#hmr-route-version')).toHaveText('after');
    await expect(page.locator('#hmr-source-input')).toHaveValue('server route-shell');
  } finally {
    await fixture.close();
  }
});

function expectKovoSourceEditEvent(
  events: readonly { data: Record<string, unknown>; event: string }[],
  eventName: string,
): Record<string, unknown> {
  const event = events.find((entry) => entry.event === eventName);
  expect(
    events.map((entry) => ({
      diagnostics: entry.data.diagnostics,
      event: entry.event,
      impact: entry.data.impact,
      reasons: entry.data.reasons,
    })),
  ).toContainEqual(expect.objectContaining({ event: eventName }));
  return event!.data;
}

async function navigateToReadyHmrFixture(
  page: Page,
  origin: string,
  eventName: string,
): Promise<void> {
  // The fixture only needs the Kovo client hooks, not every browser load-tail event. Waiting for
  // `load` can consume the whole test budget when Chromium retains a subresource under CI pressure.
  // Commit the navigation, then poll the exact runtime readiness contract with a bounded deadline.
  await page.goto(`${origin}/`, { waitUntil: 'commit' });
  await page.waitForFunction(
    (event) => {
      const global = window as typeof window & {
        __kovo_a?: unknown;
        __kovoHot?: Record<string, unknown>;
      };
      return (
        typeof global.__kovo_a === 'function' && typeof global.__kovoHot?.[event] === 'function'
      );
    },
    eventName,
    { polling: 25, timeout: 10_000 },
  );
}

async function serveHmrFixture(app: ReturnType<typeof createApp>): Promise<{
  close(): Promise<void>;
  origin: string;
}>;
async function serveHmrFixture(
  app: ReturnType<typeof createApp>,
  pluginOptions: Parameters<typeof kovoAppShellViteDevPlugin>[0],
): Promise<{
  close(): Promise<void>;
  origin: string;
}>;
async function serveHmrFixture(
  app: ReturnType<typeof createApp>,
  pluginOptions: Parameters<typeof kovoAppShellViteDevPlugin>[0] = {},
): Promise<{
  close(): Promise<void>;
  origin: string;
}> {
  let middleware: KovoAppShellViteMiddleware | undefined;
  const plugin = kovoAppShellViteDevPlugin({
    ...pluginOptions,
    moduleId: pluginOptions.moduleId ?? '/src/app-shell.ts',
  });
  const loadModule = async (id: string): Promise<Record<string, unknown>> => {
    if (id === '@kovojs/server/internal/app-shell-vite') {
      return { dispatchKovoAppShellViteDevRequest };
    }
    return { default: app };
  };
  plugin.configureServer({
    environments: {
      ssr: {
        runner: {
          clearCache() {},
          import: loadModule,
        },
      },
    },
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
    ssrLoadModule: loadModule,
  });

  const server: Server = createServer((request, response) => {
    middleware?.(request, response, (error) => {
      if (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : JSON.stringify(error));
        return;
      }
      if (request.url === '/@vite/client') {
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/javascript; charset=utf-8',
        });
        response.end(`export function createHotContext() {
          return {
            on(event, callback) {
              globalThis.__kovoHot = globalThis.__kovoHot || {};
              globalThis.__kovoHot[event] = callback;
            },
          };
        }`);
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
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
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // The Playwright page outlives this test-local server. Close browser-held keep-alive
        // connections after stopping acceptance so teardown cannot consume the 60 s test budget.
        server.closeAllConnections();
      });
    },
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

interface ViteSourceEditFixture {
  close(): Promise<void>;
  origin: string;
  writeAppShell(options: {
    routeVersion?: string;
  }): Promise<readonly { data: Record<string, unknown>; event: string }[]>;
  writeCard(source: string): Promise<readonly { data: Record<string, unknown>; event: string }[]>;
}

async function serveViteSourceEditFixture(options: {
  card: string;
  routeVersion?: string;
}): Promise<ViteSourceEditFixture> {
  const root = await mkdtemp(fileURLToPath(new URL('../.hmr-source-edit-', import.meta.url)));
  const srcDir = join(root, 'src');
  const appShellPath = join(srcDir, 'app-shell.ts');
  const cardPath = join(srcDir, 'hmr-card.tsx');
  const appId = randomUUID();
  const signingSecret = randomBytes(32).toString('base64url');
  await mkdir(srcDir, { recursive: true });
  await writeFile(cardPath, options.card, 'utf8');
  await writeFile(
    appShellPath,
    hmrSourceAppShell({
      appId,
      signingSecret,
      ...(options.routeVersion === undefined ? {} : { routeVersion: options.routeVersion }),
    }),
    'utf8',
  );
  type ViteDevServer = {
    close(): Promise<void>;
    moduleGraph?: { invalidateAll(): void };
    middlewares: ViteMiddleware;
    ws: { send(payload: unknown): void };
  };
  const vitePlus = (await import('vite-plus')) as {
    createServer(options: Record<string, unknown>): Promise<ViteDevServer>;
  };
  const createViteServer = (options: Record<string, unknown>) => vitePlus.createServer(options);
  const integration = createKovoAppShellViteDevIntegration({ moduleId: '/src/app-shell.ts' });
  const onModuleDiagnostics: OnModuleDiagnostics = (diagnostics) =>
    integration.onModuleDiagnostics(diagnostics);
  const hmrPlugin = kovoSourceEditFixturePlugin({
    onModuleDiagnostics,
  });
  const hmrEvents: { event: string; data: Record<string, unknown> }[] = [];
  let vite: ViteDevServer | undefined;
  const server = createServer((request, response) => {
    if (!vite) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('vite dev server not ready');
      return;
    }
    vite.middlewares(request, response, (error?: unknown) => {
      if (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : JSON.stringify(error));
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
    });
  });

  try {
    vite = await createViteServer({
      appType: 'custom',
      configFile: false,
      logLevel: 'error',
      plugins: [hmrPlugin, integration.plugin],
      root,
      server: {
        hmr: { server },
        middlewareMode: true,
      },
      ssr: { noExternal: [/^@kovojs\//] },
    });
    const send = vite.ws.send.bind(vite.ws);
    vite.ws.send = (payload: unknown) => {
      if (isKovoCustomHmrPayload(payload)) {
        const event = { data: payload.data, event: payload.event };
        hmrEvents.push(event);
      }
      send(payload);
    };
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    return {
      async close() {
        await vite?.close();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
        await rm(root, { force: true, recursive: true });
      },
      origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      async writeAppShell(nextOptions) {
        // Capture before the filesystem write: Vite's real watcher may publish
        // the Kovo event before this helper invokes handleHotUpdate directly.
        const startIndex = hmrEvents.length;
        const source = hmrSourceAppShell({ appId, signingSecret, ...nextOptions });
        await writeFile(appShellPath, source, 'utf8');
        vite?.moduleGraph?.invalidateAll();
        await Promise.race([
          integration.plugin.handleHotUpdate?.({
            file: appShellPath,
            modules: [],
            read: () => readFile(appShellPath, 'utf8'),
            server: vite as unknown as Parameters<
              NonNullable<typeof integration.plugin.handleHotUpdate>
            >[0]['server'],
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Timed out waiting for Kovo app-shell handleHotUpdate.')),
              5_000,
            ),
          ),
        ]);
        await waitForKovoSourceEditEvent(hmrEvents, startIndex, 'app-shell');
        return hmrEvents.slice(startIndex);
      },
      async writeCard(source) {
        const startIndex = hmrEvents.length;
        await writeFile(cardPath, source, 'utf8');
        vite?.moduleGraph?.invalidateAll();
        await Promise.race([
          hmrPlugin.handleHotUpdate?.({
            file: cardPath,
            modules: [],
            read: () => readFile(cardPath, 'utf8'),
            server: vite as unknown as Parameters<
              NonNullable<typeof hmrPlugin.handleHotUpdate>
            >[0]['server'],
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Timed out waiting for Kovo handleHotUpdate.')),
              5_000,
            ),
          ),
        ]);
        await waitForKovoSourceEditEvent(hmrEvents, startIndex, 'component');
        return hmrEvents.slice(startIndex);
      },
    };
  } catch (error) {
    await vite?.close();
    await rm(root, { force: true, recursive: true });
    throw error;
  }
}

async function waitForKovoSourceEditEvent(
  events: readonly { event: string }[],
  startIndex: number,
  label: string,
): Promise<void> {
  // The real Vite watcher and the fixture's direct hook invocation intentionally race. When the
  // watcher owns the in-flight update, the direct call can settle before Vite publishes the custom
  // Kovo event. Wait for that observable completion rather than treating hook return as delivery.
  const deadline = Date.now() + 5_000;
  while (events.length === startIndex) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for the Kovo ${label} source-edit event.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function isKovoCustomHmrPayload(
  payload: unknown,
): payload is { data: Record<string, unknown>; event: string; type: 'custom' } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { type?: unknown }).type === 'custom' &&
    typeof (payload as { event?: unknown }).event === 'string' &&
    typeof (payload as { event?: string }).event?.startsWith === 'function' &&
    (payload as { event: string }).event.startsWith('kovo:')
  );
}

function hmrSourceAppShell(options: {
  appId: string;
  routeVersion?: string;
  signingSecret: string;
}): string {
  const routeVersion = options.routeVersion ?? '';
  return `
import { createApp } from '@kovojs/test/internal/integration/fixture-abi';
import { route } from '@kovojs/server';
import { jsx } from '@kovojs/server/jsx-runtime';

import { HmrSourceCard } from './hmr-card';

export default createApp({
  appId: ${JSON.stringify(options.appId)},
  csrf: {
    secret: ${JSON.stringify(options.signingSecret)},
    sessionId() {
      return undefined;
    },
  },
  routes: [
    route('/', {
      page() {
        return jsx('main', {
          children: [
            ${routeVersion ? `jsx('h1', { children: '${routeVersion}', id: 'hmr-route-version' }),` : ''}
            jsx(HmrSourceCard, {}),
          ],
        });
      },
    }),
  ],
});
`;
}

function kovoSourceEditFixturePlugin(options: { onModuleDiagnostics: OnModuleDiagnostics }): {
  configResolved(config: { root: string }): void;
  configureServer?: ReturnType<typeof kovoVitePlugin>['configureServer'];
  enforce?: 'pre';
  handleHotUpdate?: ReturnType<typeof kovoVitePlugin>['handleHotUpdate'];
  name: string;
  transform: KovoVitePlugin['transform'];
} {
  const hmrTransport = kovoVitePlugin(options);
  let root = process.cwd();

  return {
    configureServer: hmrTransport.configureServer,
    // SPEC.md §5.2 / §9.5.1: authored TSX must reach Kovo before Vite lowers JSX, or host
    // event props bypass compiler-owned handler refs and hit the KV236 runtime backstop.
    enforce: hmrTransport.enforce,
    handleHotUpdate: hmrTransport.handleHotUpdate,
    name: 'kovo-source-edit-fixture',
    async transform(source, id) {
      const fileName = fixtureComponentFileName(id, root);
      if (
        fileName.startsWith('../') ||
        isAbsolute(fileName) ||
        !/\.[cm]?tsx?$/.test(fileName) ||
        !source.includes('component(')
      ) {
        return null;
      }

      // Keep the transport's diagnostics and retained HMR state ordered before the fixture's
      // direct compiler inspection of the same authored source.
      await hmrTransport.transform(source, id);
      const result = compileComponentModule({
        fileName,
        packagePrefixDiscoveryRoot: root,
        source,
      });
      const errors = (result.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.severity === 'error',
      );
      if (errors.length > 0) {
        throw new Error(
          errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'),
        );
      }
      return typeof result.loweredSource === 'string'
        ? { code: result.loweredSource, map: null }
        : null;
    },
    configResolved(config: { root: string }) {
      root = config.root;
    },
  };
}

function fixtureComponentFileName(id: string, root: string): string {
  return relative(root, id.split('?')[0]!).replaceAll('\\', '/');
}

function hmrSourceCard(options: {
  css?: string;
  handlerText: string;
  inputValue: string;
  outputText: string;
  refreshable: boolean;
}): string {
  return `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { query } from '@kovojs/server';

const hmrQuery = query('hmr', {
  load() {
    return {};
  },
});

export const HmrSourceCard = component({
  ${options.refreshable ? 'queries: { hmr: hmrQuery },' : ''}
  ${options.css ? `css: ${JSON.stringify(options.css)},` : ''}
  state: () => ({ handler: '' }),
  render: (_queries, state) => (
    <section>
      <label for="hmr-source-input">Draft</label>
      <input id="hmr-source-input" key="input" value=${JSON.stringify(options.inputValue)} />
      <output id="hmr-source-output" key="output">${options.outputText}</output>
      <button
        data-handler={state.handler}
        id="hmr-source-button"
        key="button"
        type="button"
        onClick={() => {
          state.handler = ${JSON.stringify(options.handlerText)};
        }}>
        Run
      </button>
    </section>
  ),
});
`;
}

function hmrInvalidSourceCard(): string {
  return `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

export const HmrSourceCard = component({
  render: () => (
    <p>
      <div>Invalid nesting</div>
    </p>
  ),
});
`;
}
