import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { route } from './route.js';
import { kovo } from './vite.js';
import type { KovoAppShellViteMiddleware } from './vite-dev.js';

interface KovoViteConfigureServer {
  configureServer(server: {
    middlewares: { use(handler: KovoAppShellViteMiddleware): void };
    ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  }): void | Promise<void>;
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
});
