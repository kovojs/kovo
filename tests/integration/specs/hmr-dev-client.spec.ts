// SPEC.md §9.5.1: dev HMR asks the app shell for server-owned fragment output.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';

import { createApp, kovoAppShellViteDevPlugin, route } from '@kovojs/server';
import type { KovoAppShellViteMiddleware } from '@kovojs/server/internal/app-shell-vite';
import type { LiveTargetRenderer } from '@kovojs/server/internal/wire';

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
      const hot = (window as typeof window & {
        __kovoHot?: Record<string, (event?: unknown) => void>;
      }).__kovoHot;
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

async function serveHmrFixture(app: ReturnType<typeof createApp>): Promise<{
  close(): Promise<void>;
  origin: string;
}> {
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
