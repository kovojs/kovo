// SPEC.md §9.5.1: dev HMR asks the app shell for server-owned fragment output.
import { component } from '@kovojs/core';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileComponentModule,
  kovoVitePlugin,
  type KovoVitePlugin,
  type KovoVitePluginOptions,
} from '@kovojs/compiler';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { createApp, domain, query, route, s } from '@kovojs/server';
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
  componentLiveTargetRenderer,
  createLiveTargetAttestation as createAppLiveTargetAttestation,
  registerGeneratedLiveTargetRenderer,
  type LiveTargetRenderer,
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

function liveTargetToken(
  app: Parameters<typeof createAppLiveTargetAttestation>[0],
  request: Request,
  target: string,
  component: string,
  props: Record<string, unknown> = {},
): string {
  return createAppLiveTargetAttestation(app, { component, props, target }, request);
}

test('dev HMR client applies server-rendered live-target fragments without reloading', async ({
  page,
}) => {
  let renderVersion = 1;
  let app!: ReturnType<typeof createApp>;
  const renderCard = (request: Request) => `<section
      kovo-fragment-target="hmr-card"
      kovo-c="hmr-card"
      kovo-deps="hmr"
      kovo-live-component="hmr/Card"
      kovo-live-token="${liveTargetToken(app, request, 'hmr-card', 'hmr/Card', { id: 'one' })}"
      kovo-props='{"id":"one"}'>
      <label for="hmr-input">Draft</label>
      <input id="hmr-input" kovo-key="input" value="server ${renderVersion}">
      <output id="hmr-output" kovo-key="output">Version ${renderVersion}</output>
    </section>`;
  const renderer: LiveTargetRenderer<Request> = {
    component: 'hmr/Card',
    mutationKeys: [],
    render(context) {
      expect(context.props).toEqual({ id: 'one' });
      expect(context.target).toBe('hmr-card');
      return renderCard(context.request);
    },
  };
  app = runWithGeneratedLiveTargetRegistry(() => {
    registerGeneratedLiveTargetRenderer(renderer);
    return createApp({
      routes: [
        route('/', {
          page(_context, request) {
            return `<main>${renderCard(request)}</main>`;
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
      (request) => {
        if (!request.url().includes('/@kovo/hmr/refresh/live-targets')) {
          return false;
        }
        const headers = request.headers();
        return (
          headers['kovo-live-targets']?.includes('hmr-card#hmr/Card@') === true &&
          headers['kovo-live-targets']?.includes(':{"id":"one"}') === true &&
          headers['kovo-targets']?.includes('hmr-card=hmr') === true
        );
      },
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
    await Promise.all([refreshRequest, refreshResponse]);
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
  let app!: ReturnType<typeof createApp>;
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
  const ProductCard = component({
    queries: {
      product: productQuery.args((props: { productId: string }) => ({ id: props.productId })),
    },
    render(
      { product, productId }: { product: { id: string; stock: number }; productId: string },
      _state: unknown,
      { request }: { request: Request },
    ) {
      return jsx('section', {
        'kovo-c': 'product-card',
        'kovo-deps': `product:${product.id}`,
        'kovo-fragment-target': 'product-card',
        'kovo-live-component': 'hmr/ProductCard',
        'kovo-live-token': liveTargetToken(app, request, 'product-card', 'hmr/ProductCard', {
          productId,
        }),
        'kovo-props': JSON.stringify({ productId }),
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
  });
  const productRenderer = componentLiveTargetRenderer({
    component: ProductCard,
    componentId: 'hmr/ProductCard',
  });
  app = runWithGeneratedLiveTargetRegistry(() => {
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
    const refreshRequest = page.waitForRequest((request) => {
      if (!request.url().includes('/@kovo/hmr/refresh/live-targets')) {
        return false;
      }
      const headers = request.headers();
      const liveTargets = headers['kovo-live-targets'];
      const targets = headers['kovo-targets'];
      return (
        liveTargets?.includes('product-card#hmr/ProductCard@') === true &&
        liveTargets?.includes(':{"productId":"p1"}') === true &&
        targets?.includes('product-card=product:p1') === true
      );
    });

    await page.evaluate(() => {
      const hot = (
        window as typeof window & {
          __kovoHot?: Record<string, (event?: unknown) => void>;
        }
      ).__kovoHot;
      hot?.['kovo:component-render']?.({ oldFactHash: 'old-query' });
    });
    await refreshRequest;

    await expect(page.locator('#product-stock')).toHaveText('11');
    await expect(page.locator('#product-note')).toHaveValue('keep me');
    await expect(page.locator('#product-note')).toBeFocused();
    expect(queryLoads).toEqual(['p1:/', 'p1:/']);
    expect(page.url()).toBe(`${server.origin}/`);
  } finally {
    await server.close();
  }
});

test('dev HMR client replaces the document with server diagnostics', async ({ page }) => {
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
        {
          code: 'KV225',
          fileName: 'src/components/ProductCard.tsx',
          message: 'JSX nesting violates the HTML content model.',
        },
      ],
      fileName: 'src/components/ProductCard.tsx',
      moduleHrefs: [failedModule],
      source: 'export const ProductCard = component({ render: () => <p><div /></p> });',
    });
    const refreshResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/@kovo/hmr/refresh/route') && response.status() === 500,
    );
    await page.evaluate(() => {
      const hot = (
        window as typeof window & {
          __kovoHot?: Record<string, (event?: unknown) => void>;
        }
      ).__kovoHot;
      hot?.['kovo:diagnostics']?.();
    });
    await refreshResponse;

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
    await refreshSourceEditLiveTarget(page);

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

async function refreshSourceEditLiveTarget(page: Page): Promise<void> {
  const body = await page.evaluate(async () => {
    const sourceCard = document.querySelector('[kovo-fragment-target="hmr-source-card"]');
    const target =
      sourceCard?.getAttribute('kovo-fragment-target') ??
      sourceCard?.getAttribute('id') ??
      sourceCard?.getAttribute('kovo-c');
    const component =
      sourceCard?.getAttribute('kovo-live-component') ??
      sourceCard?.getAttribute('kovo-c') ??
      target;
    const token = sourceCard?.getAttribute('kovo-live-token');
    const props = sourceCard?.getAttribute('kovo-props') ?? '{}';
    if (!target || !component || !token) {
      throw new Error('HMR source card is missing live-target attestation attributes.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch('/@kovo/hmr/refresh/live-targets?url=/', {
      headers: {
        'Kovo-Current-Url': location.href,
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': `${target}#${component}@${token}:${props}`,
        'Kovo-Targets': 'hmr-source-card=hmr',
      },
      method: 'POST',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HMR refresh failed with ${response.status}`);
    return response.text();
  });
  await page.evaluate((fragmentBody) => {
    const apply = (window as typeof window & { __kovo_a?: (body: string) => void }).__kovo_a;
    if (typeof apply !== 'function') throw new Error('Kovo fragment apply hook is missing.');
    apply(fragmentBody);
  }, body);
}

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
      return { default: app };
    },
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
import { createApp, route } from '@kovojs/server';
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
      if (!/\.[cm]?tsx?$/.test(id) || !source.includes('component(')) return null;

      // Keep the transport's diagnostics and retained HMR state ordered before the fixture's
      // direct compiler inspection of the same authored source.
      await hmrTransport.transform(source, id);
      const result = compileComponentModule({
        fileName: fixtureComponentFileName(id, root),
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
  const path = id.split('?')[0]!.replaceAll('\\', '/');
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/$/, '');
  return path.startsWith(`${normalizedRoot}/`) ? path.slice(normalizedRoot.length + 1) : path;
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
      <input id="hmr-source-input" kovo-key="input" value=${JSON.stringify(options.inputValue)} />
      <output id="hmr-source-output" kovo-key="output">${options.outputText}</output>
      <button
        data-handler={state.handler}
        id="hmr-source-button"
        kovo-key="button"
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
