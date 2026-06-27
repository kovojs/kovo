import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp, createRequestHandler } from './app.js';
import {
  assignDerivedMutationKey,
  assignDerivedQueryKey,
  assignDerivedWebhookName,
} from './internal/wire.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { route } from './route.js';
import { s } from './schema.js';
import { kovo } from './vite.js';
import type { KovoAppShellViteMiddleware } from './vite-dev.js';
import { webhook } from './webhook.js';

interface KovoViteConfigureServer {
  configResolved?(config: { root: string }): void | Promise<void>;
  configureServer(server: {
    config?: { root?: string };
    middlewares: { use(handler: KovoAppShellViteMiddleware): void };
    ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  }): void | Promise<void>;
  transform?(
    source: string,
    id: string,
  ): null | Promise<null | { code: string; map: null }> | { code: string; map: null };
  enforce?: 'pre';
}

describe('public Kovo Vite plugin', () => {
  it('runs before JSX lowering and serves lowered handler island markers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-dev-lowering-'));
    const source = `
import { component } from '@kovojs/core';

export const CartButton = component({
  render: () => <button onClick={() => null}>Save</button>,
});
`;

    try {
      const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;

      expect(plugin.enforce).toBe('pre');
      await plugin.configResolved?.({ root });
      const transformed = await plugin.transform?.(source, join(root, 'src/cart-button.tsx'));

      expect(transformed).toMatchObject({ map: null });
      expect(transformed?.code).toContain('kovo-c="cart-button"');
      expect(transformed?.code).toMatch(
        /on:click="\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{8}\/src\/cart-button\.client\.js#CartButton\$button_click"/,
      );
      expect(transformed?.code).not.toContain('onClick');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('assigns source-derived registry identities before createApp consumes app modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-derived-registry-'));
    const source = `
import { createApp, mutation, query, s, webhook } from '@kovojs/server';

export const addToCart = mutation({
  csrf: false,
  input: s.object({ productId: s.string() }),
  handler() {
    return 'ok';
  },
});

export const cartQuery = query({
  load: () => ({ count: 1 }),
  reads: [],
});

export const orderPaid = webhook('/webhooks/order-paid', {
  handler: () => undefined,
  input: s.object({ id: s.string() }),
  verify: 'none',
  verifyJustification: 'fixture-only app shell test',
});

export default createApp({
  endpoints: [orderPaid],
  mutations: [addToCart],
  queries: [cartQuery],
});
`;

    try {
      const plugin = kovo({ app: '/src/app-shell.ts' }) as unknown as KovoViteConfigureServer;

      await plugin.configResolved?.({ root });
      const transformed = await plugin.transform?.(source, join(root, 'src/app-shell.ts'));

      expect(transformed).toMatchObject({ map: null });
      expect(transformed?.code).toContain(
        "import { assignDerivedMutationKey as __kovoAssignDerivedMutationKey, assignDerivedQueryKey as __kovoAssignDerivedQueryKey, assignDerivedWebhookName as __kovoAssignDerivedWebhookName } from '@kovojs/server/internal/wire';",
      );
      expect(transformed?.code).toContain(
        'export const addToCart = __kovoAssignDerivedMutationKey(mutation({',
      );
      expect(transformed?.code).toContain('"app-shell/add-to-cart"');
      expect(transformed?.code).toContain(
        'export const cartQuery = __kovoAssignDerivedQueryKey(query({',
      );
      expect(transformed?.code).toContain('"app-shell/cart-query"');
      expect(transformed?.code).toContain(
        "export const orderPaid = __kovoAssignDerivedWebhookName(webhook('/webhooks/order-paid', {",
      );
      expect(transformed?.code).toContain('"app-shell/order-paid"');
      expect(transformed?.code).toContain('export default createApp({');
      const lowered = evaluateLoweredAppShell(transformed?.code ?? '');
      expect(lowered.addToCart.key).toBe('app-shell/add-to-cart');
      expect(lowered.cartQuery.key).toBe('app-shell/cart-query');
      expect(lowered.orderPaid).toMatchObject({
        name: 'app-shell/order-paid',
        path: '/webhooks/order-paid',
        reason: 'webhook:app-shell/order-paid',
      });
      expect(lowered.app.mutations.map((candidate) => candidate.key)).toEqual([
        'app-shell/add-to-cart',
      ]);
      expect(lowered.app.queries.map((candidate) => candidate.key)).toEqual([
        'app-shell/cart-query',
      ]);
      expect(lowered.app.endpoints.map((candidate) => candidate.name)).toEqual([
        'app-shell/order-paid',
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('loads the authored app entry default export', async () => {
    const plugin = kovo({ app: '/src/app.tsx' }) as unknown as KovoViteConfigureServer;
    const middlewares: KovoAppShellViteMiddleware[] = [];

    await plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      async ssrLoadModule(id) {
        if (id === '@kovojs/server/internal/app-shell-vite') {
          return {
            createKovoAppShellViteDevIntegration(options: { moduleId: string }) {
              return {
                plugin: {
                  configureServer(server: {
                    middlewares: { use(handler: KovoAppShellViteMiddleware): void };
                    ssrLoadModule(id: string): Promise<Record<string, unknown>>;
                  }) {
                    server.middlewares.use((request, response, next) => {
                      Promise.resolve(server.ssrLoadModule(options.moduleId))
                        .then((module) => {
                          const handler = createRequestHandler(module.default as never);
                          return handler(
                            new Request(`http://example.test${request.url ?? '/'}`, {
                              method: request.method ?? 'GET',
                            }),
                          );
                        })
                        .then(async (webResponse) => {
                          response.writeHead(webResponse.status, {
                            'Content-Type':
                              webResponse.headers.get('content-type') ?? 'text/html; charset=utf-8',
                          });
                          response.end(await webResponse.text());
                        })
                        .catch(next);
                    });
                  },
                },
              };
            },
          };
        }
        expect(id).toBe('/src/app.tsx');
        return {
          default: createApp({
            routes: [
              route('/cart', {
                page: () => trustedHtml('<main>Cart</main>'),
              }),
            ],
          }),
        };
      },
    });

    const server = createHttpServer((request, response) => {
      runMiddlewareChain(middlewares, request, response, (error) => {
        response.writeHead(error ? 500 : 418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : 'next');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/cart`,
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain('<main>Cart</main>');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('rejects generated app entries', () => {
    expect(() => kovo({ app: '/src/generated/app.kovo-route.tsx' })).toThrow(
      'kovo({ app }) must point at an authored app entry',
    );
  });

  it('threads compiler route CSS chunks into the app-shell dev handler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-css-'));
    const appSource = `
import { createApp, route } from '@kovojs/server';
import { HomeCard } from './components/home-card.js';
import { LoginCard } from './components/login-card.js';

export default createApp({
  routes: [
    route('/', { page: () => <HomeCard /> }),
    route('/login', { page: () => <LoginCard /> }),
  ],
});
`;
    const homeSource = `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({ root: { color: 'teal' } });
export const HomeCard = component({
  render: () => <main {...style.attrs(styles.root)}>Home</main>,
});
`;
    const loginSource = `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({ root: { color: 'purple' } });
export const LoginCard = component({
  render: () => <main {...style.attrs(styles.root)}>Login</main>,
});
`;

    try {
      await mkdir(join(root, 'src/components'), { recursive: true });
      await writeFile(join(root, 'src/app-shell.tsx'), appSource, 'utf8');
      await writeFile(join(root, 'src/components/home-card.tsx'), homeSource, 'utf8');
      await writeFile(join(root, 'src/components/login-card.tsx'), loginSource, 'utf8');

      const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;
      const middlewares: KovoAppShellViteMiddleware[] = [];
      await plugin.configResolved?.({ root });
      await plugin.transform?.(homeSource, join(root, 'src/components/home-card.tsx'));
      await plugin.transform?.(loginSource, join(root, 'src/components/login-card.tsx'));
      await plugin.configureServer({
        config: { root },
        middlewares: {
          use(handler) {
            middlewares.push(handler);
          },
        },
        async ssrLoadModule(id) {
          if (id === '@kovojs/server/internal/app-shell-vite') {
            return await import('@kovojs/server/internal/app-shell-vite');
          }
          expect(id).toBe('/src/app-shell.tsx');
          return {
            default: createApp({
              routes: [
                route('/', {
                  page: () => trustedHtml('<main>Home</main>'),
                }),
                route('/login', {
                  page: () => trustedHtml('<main>Login</main>'),
                }),
              ],
            }),
          };
        },
      });

      const server = createHttpServer((request, response) => {
        runMiddlewareChain(middlewares, request, response, (error) => {
          response.writeHead(error ? 500 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end(error instanceof Error ? error.message : 'vite fallback');
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

      try {
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const homeResponse = await fetch(`${origin}/`);
        const homeBody = await homeResponse.text();
        const homeRouteHref = stylesheetHref(homeBody, /\/assets\/routes\/index-[^"]+\.css/);

        expect(homeResponse.status, homeBody).toBe(200);
        expect(homeBody).toContain(`data-kovo-critical-href="${homeRouteHref}"`);
        expect(homeBody).toContain(homeRouteHref);
        expect(homeBody).toContain('color:teal');
        expect(homeBody).not.toContain('color:purple');
        expect(homeBody).not.toContain('/assets/routes/login');

        const cssResponse = await fetch(`${origin}${homeRouteHref}`);
        const cssBody = await cssResponse.text();

        expect(cssResponse.status, cssBody).toBe(200);
        expect(cssResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
        expect(cssBody).toContain('color:teal');
        expect(cssBody).not.toContain('color:purple');
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function runMiddlewareChain(
  middlewares: readonly KovoAppShellViteMiddleware[],
  request: Parameters<KovoAppShellViteMiddleware>[0],
  response: Parameters<KovoAppShellViteMiddleware>[1],
  done: (error?: unknown) => void,
): void {
  let index = 0;
  const next = (error?: unknown) => {
    if (error || index >= middlewares.length) {
      done(error);
      return;
    }
    const middleware = middlewares[index++];
    if (!middleware) {
      done();
      return;
    }
    middleware(request, response, next);
  };
  next();
}

function evaluateLoweredAppShell(source: string): {
  addToCart: { key: string };
  app: {
    endpoints: Array<{ name?: string }>;
    mutations: Array<{ key: string }>;
    queries: Array<{ key: string }>;
  };
  cartQuery: { key: string };
  orderPaid: { name: string; path: string; reason: string };
} {
  const executable = source
    .replace(/^import .*;\n/gm, '')
    .replace('export const addToCart =', 'const addToCart =')
    .replace('export const cartQuery =', 'const cartQuery =')
    .replace('export const orderPaid =', 'const orderPaid =')
    .replace('export default createApp(', 'const app = createApp(');
  return runInNewContext(
    `${executable}\n;({ app, addToCart, cartQuery, orderPaid });`,
    {
      __kovoAssignDerivedMutationKey: assignDerivedMutationKey,
      __kovoAssignDerivedQueryKey: assignDerivedQueryKey,
      __kovoAssignDerivedWebhookName: assignDerivedWebhookName,
      createApp,
      mutation,
      query,
      s,
      webhook,
    },
    { timeout: 1000 },
  );
}

function stylesheetHref(html: string, pattern: RegExp): string {
  const match = pattern.exec(html);
  if (!match?.[0])
    throw new Error(
      `Expected stylesheet href matching ${pattern}. Asset snippets:\n${assetSnippets(html)}`,
    );
  return match[0];
}

function assetSnippets(html: string): string {
  const snippets: string[] = [];
  const pattern = /\/assets\/[^"'<> )]+/g;
  for (const match of html.matchAll(pattern)) {
    const start = Math.max(0, match.index - 120);
    const end = Math.min(html.length, match.index + match[0].length + 120);
    snippets.push(html.slice(start, end));
  }
  return snippets.join('\n---\n') || html.slice(-2000);
}
