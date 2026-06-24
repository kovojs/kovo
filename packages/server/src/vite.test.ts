import { publicAccess } from './access.js';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp, createRequestHandler } from './app.js';
import { route } from './route.js';
import { kovo } from './vite.js';
import type { KovoAppShellViteMiddleware } from './vite-dev.js';

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
}

describe('public Kovo Vite plugin', () => {
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
                access: publicAccess('test fixture'),
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
                  access: publicAccess('test fixture'),
                  page: () => trustedHtml('<main>Home</main>'),
                }),
                route('/login', {
                  access: publicAccess('test fixture'),
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
