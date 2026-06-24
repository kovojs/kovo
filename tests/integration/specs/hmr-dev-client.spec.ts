// SPEC.md §9.5.1: dev HMR asks the app shell for server-owned fragment output.
import { component } from '@kovojs/core';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileComponentModule,
  kovoVitePlugin,
  type KovoVitePluginOptions,
} from '@kovojs/compiler';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  createApp,
  createKovoAppShellViteDevIntegration,
  domain,
  kovoAppShellViteDevPlugin,
  query,
  route,
  s,
  publicAccess,
} from '@kovojs/server';
import {
  createKovoAppShellDevDiagnosticLedger,
  type KovoAppShellViteMiddleware,
} from '@kovojs/server/internal/app-shell-vite';
import { componentLiveTargetRenderer, type LiveTargetRenderer } from '@kovojs/server/internal/wire';

type ViteMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;
type OnModuleDiagnostics = Exclude<KovoVitePluginOptions['onModuleDiagnostics'], undefined>;

test('dev HMR client applies server-rendered live-target fragments without reloading', async ({
  page,
}) => {
  let renderVersion = 1;
  const renderCard = () => `<section
      kovo-fragment-target="hmr-card"
      kovo-c="hmr-card"
      kovo-deps="hmr"
      kovo-live-component="hmr/Card"
      kovo-props='{"id":"one"}'>
      <label for="hmr-input">Draft</label>
      <input id="hmr-input" kovo-key="input" value="server ${renderVersion}">
      <output id="hmr-output" kovo-key="output">Version ${renderVersion}</output>
    </section>`;
  const renderer: LiveTargetRenderer<Request> = {
    component: 'hmr/Card',
    render(context) {
      expect(context.props).toEqual({ id: 'one' });
      expect(context.target).toBe('hmr-card');
      return renderCard();
    },
  };
  const app = createApp({
    liveTargetRenderers: [renderer],
    routes: [
      route('/', {
        access: publicAccess('integration test fixture route / has no runtime guard'),
        page() {
          return `<main>${renderCard()}</main>`;
        },
      }),
    ],
  });
  const server = await serveHmrFixture(app);

  try {
    await page.goto(`${server.origin}/`);
    await page.waitForFunction(
      () =>
        typeof (window as typeof window & { __kovoHot?: Record<string, unknown> }).__kovoHot?.[
          'kovo:component-render'
        ] === 'function',
    );

    await expect(page.locator('#hmr-output')).toHaveText('Version 1');
    await page.locator('#hmr-input').focus();
    await page.locator('#hmr-input').fill('user draft');

    renderVersion = 2;
    const refreshRequest = page.waitForRequest((request) => {
      if (!request.url().includes('/@kovo/hmr/refresh/live-targets')) {
        return false;
      }
      const headers = request.headers();
      return (
        headers['kovo-live-targets']?.includes('hmr-card#hmr/Card:{"id":"one"}') === true &&
        headers['kovo-targets']?.includes('hmr-card=hmr') === true
      );
    });
    const refreshResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/@kovo/hmr/refresh/live-targets') && response.status() === 200,
    );

    await page.evaluate(() => {
      const hot = (
        window as typeof window & {
          __kovoHot?: Record<string, (event?: unknown) => void>;
        }
      ).__kovoHot;
      hot?.['kovo:component-render']?.({ oldFactHash: 'old' });
    });
    await refreshRequest;
    await refreshResponse;

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
    access: publicAccess('integration test fixture query product has no runtime guard'),
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
    render({ product, productId }: { product: { id: string; stock: number }; productId: string }) {
      return `<section
        kovo-fragment-target="product-card"
        kovo-c="product-card"
        kovo-deps="product:${product.id}"
        kovo-live-component="hmr/ProductCard"
        kovo-props='{"productId":"${productId}"}'>
        <label for="product-note">Note</label>
        <input id="product-note" kovo-key="note" value="server ${product.stock}">
        <output id="product-stock" kovo-key="stock">${product.stock}</output>
      </section>`;
    },
  });
  const productRenderer = componentLiveTargetRenderer({
    component: ProductCard,
    componentId: 'hmr/ProductCard',
  });
  const app = createApp({
    liveTargetRenderers: [productRenderer],
    routes: [
      route('/', {
        access: publicAccess('integration test fixture route / has no runtime guard'),
        async page(_context, request) {
          const card = await productRenderer.render({
            input: {},
            props: { productId: 'p1' },
            request,
            target: 'product-card',
          });
          return `<main>${card}</main>`;
        },
      }),
    ],
  });
  const server = await serveHmrFixture(app);

  try {
    await page.goto(`${server.origin}/`);
    await page.waitForFunction(
      () =>
        typeof (window as typeof window & { __kovoHot?: Record<string, unknown> }).__kovoHot?.[
          'kovo:component-render'
        ] === 'function',
    );

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
        liveTargets?.includes('product-card#hmr/ProductCard:{"productId":"p1"}') === true &&
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
        access: publicAccess('integration test fixture route / has no runtime guard'),
        modulepreloads: [failedModule],
        page() {
          return '<main><h1>Healthy route</h1></main>';
        },
      }),
    ],
  });
  const server = await serveHmrFixture(app, { devDiagnostics: diagnostics });

  try {
    await page.goto(`${server.origin}/`);
    await page.waitForFunction(
      () =>
        typeof (window as typeof window & { __kovoHot?: Record<string, unknown> }).__kovoHot?.[
          'kovo:diagnostics'
        ] === 'function',
    );
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
        access: publicAccess('integration test fixture route / has no runtime guard'),
        page() {
          return `<main><h1 id="route-version">${routeVersion}</h1></main>`;
        },
      }),
    ],
  });
  const server = await serveHmrFixture(app);

  try {
    await page.goto(`${server.origin}/`);
    await page.waitForFunction(
      () =>
        typeof (window as typeof window & { __kovoHot?: Record<string, unknown> }).__kovoHot?.[
          'kovo:route-shell'
        ] === 'function',
    );
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
    expectKovoSourceEditEvent(recoveryEvents, 'kovo:full-reload');

    await expect(page.locator('#hmr-source-output')).toHaveText('Version recovered');
  } finally {
    await fixture.close();
  }
});

test('Vite route-shell source edits use full reload fallback with fresh server output', async ({
  page,
}) => {
  const fixture = await serveViteSourceEditFixture({
    appShell: hmrSourceAppShell({ routeVersion: 'before' }),
    card: hmrSourceCard({
      handlerText: 'handler route-shell',
      inputValue: 'server route-shell',
      outputText: 'Version route-shell',
      refreshable: true,
    }),
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
    const events = await fixture.writeAppShell(hmrSourceAppShell({ routeVersion: 'after' }));
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch('/@kovo/hmr/refresh/live-targets?url=/', {
      headers: {
        'Kovo-Current-Url': location.href,
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': 'hmr-source-card#hmr/SourceCard:{}',
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
    async ssrLoadModule() {
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
      });
    },
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

interface ViteSourceEditFixture {
  close(): Promise<void>;
  origin: string;
  writeAppShell(
    source: string,
  ): Promise<readonly { data: Record<string, unknown>; event: string }[]>;
  writeCard(source: string): Promise<readonly { data: Record<string, unknown>; event: string }[]>;
}

async function serveViteSourceEditFixture(options: {
  appShell?: string;
  card: string;
}): Promise<ViteSourceEditFixture> {
  const root = await mkdtemp(fileURLToPath(new URL('../.hmr-source-edit-', import.meta.url)));
  const srcDir = join(root, 'src');
  const appShellPath = join(srcDir, 'app-shell.ts');
  const cardPath = join(srcDir, 'hmr-card.tsx');
  await mkdir(srcDir, { recursive: true });
  await writeFile(cardPath, options.card, 'utf8');
  await writeFile(appShellPath, options.appShell ?? hmrSourceAppShell(), 'utf8');
  await writeFile(
    join(srcDir, 'hmr-handler.ts'),
    'export function track(value: string) { return value; }\n',
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
      async writeAppShell(source) {
        await writeFile(appShellPath, source, 'utf8');
        vite?.moduleGraph?.invalidateAll();
        const startIndex = hmrEvents.length;
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
        return hmrEvents.slice(startIndex);
      },
      async writeCard(source) {
        await writeFile(cardPath, source, 'utf8');
        vite?.moduleGraph?.invalidateAll();
        const startIndex = hmrEvents.length;
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
        return hmrEvents.slice(startIndex);
      },
    };
  } catch (error) {
    await vite?.close();
    await rm(root, { force: true, recursive: true });
    throw error;
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

function hmrSourceAppShell(options: { routeVersion?: string } = {}): string {
  const routeVersion = options.routeVersion ?? '';
  return `
	import { createApp, publicAccess, route } from '@kovojs/server';

import { HmrSourceCard } from './hmr-card';

function renderCard() {
  return HmrSourceCard.definition.render();
}

const renderer = {
  component: 'hmr/SourceCard',
  render() {
    return renderCard();
  },
};

export default createApp({
  liveTargetRenderers: [renderer],
	  routes: [
	    route('/', {
	      access: publicAccess('integration test fixture route / has no runtime guard'),
	      page() {
        return \`<main>${
          routeVersion ? `<h1 id="hmr-route-version">${routeVersion}</h1>` : ''
        }\${renderCard()}</main>\`;
      },
    }),
  ],
});
`;
}

function kovoSourceEditFixturePlugin(options: { onModuleDiagnostics: OnModuleDiagnostics }): {
  configResolved(config: { root: string }): void;
  configureServer?: ReturnType<typeof kovoVitePlugin>['configureServer'];
  handleHotUpdate?: ReturnType<typeof kovoVitePlugin>['handleHotUpdate'];
  name: string;
  transform(source: string, id: string): null | { code: string; map: null };
} {
  const hmrTransport = kovoVitePlugin(options);
  let root = process.cwd();

  return {
    configureServer: hmrTransport.configureServer,
    handleHotUpdate: hmrTransport.handleHotUpdate,
    name: 'kovo-source-edit-fixture',
    transform(source, id) {
      if (!/\.[cm]?tsx?$/.test(id) || !source.includes('component(')) return null;

      void hmrTransport.transform(source, id);
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
  const refreshAttributes = options.refreshable
    ? `
      kovo-deps="hmr"
      kovo-live-component="hmr/SourceCard"
      kovo-props="{}"`
    : '';

  return `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { track } from './hmr-handler';

export const HmrSourceCard = component({
  queries: { hmr: {} },
  ${options.css ? `css: ${JSON.stringify(options.css)},` : ''}
  render: () => (
    <section
      kovo-fragment-target="hmr-source-card"
      kovo-c="hmr-source-card"${refreshAttributes}>
      <label for="hmr-source-input">Draft</label>
      <input id="hmr-source-input" kovo-key="input" value=${JSON.stringify(options.inputValue)} />
      <output id="hmr-source-output" kovo-key="output">${options.outputText}</output>
      <button
        id="hmr-source-button"
        kovo-key="button"
        type="button"
        onClick={() => track(${JSON.stringify(options.handlerText)})}>
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
