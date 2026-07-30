import { join } from 'node:path';

import type { ViteDevServer } from 'vite-plus';
import { describe, expect, it, vi } from 'vitest';

import type { KovoDevRunnerModuleServer } from './dev-runner-generation.js';
import {
  createKovoDevtoolPlugin,
  inspectKovoDevDatabasePosture,
  type KovoDevtoolPluginOptions,
} from './devtool.js';

const OPTIONS = Object.freeze<KovoDevtoolPluginOptions>({
  appModuleId: 'app',
  appModulePath: '/workspace/src/app.tsx',
  appShellModuleId: 'app-shell',
  debug: false,
  securityProfileModuleId: 'profile',
  serverBuildModuleId: 'server-build',
});

describe('inspectKovoDevDatabasePosture', () => {
  it('loads the app inside the generated live-target registry scope', async () => {
    const app = Object.freeze({ kind: 'test-app' });
    const loads: string[] = [];
    let liveTargetRegistryActive = false;
    const server = {
      ssrLoadModule: vi.fn(async (id: string) => {
        loads.push(id);
        if (id === OPTIONS.serverBuildModuleId) {
          return {
            resolveKovoAppToken: (value: unknown) => {
              if (value !== app) throw new TypeError('wrong app token');
              return app;
            },
          };
        }
        if (id === OPTIONS.appShellModuleId) {
          return {
            runWithGeneratedLiveTargetRegistry: async (load: () => Promise<unknown>) => {
              liveTargetRegistryActive = true;
              try {
                return await load();
              } finally {
                liveTargetRegistryActive = false;
              }
            },
          };
        }
        if (id === OPTIONS.appModuleId) {
          if (!liveTargetRegistryActive) {
            throw new Error('app loaded outside its generated live-target registry');
          }
          return {
            get default() {
              return app;
            },
          };
        }
        if (id === OPTIONS.securityProfileModuleId) {
          return {
            kovoDevDatabasePosture: (value: unknown) => (value === app ? 'none configured' : ''),
          };
        }
        throw new Error(`unexpected SSR module ${id}`);
      }),
    } satisfies Pick<ViteDevServer, 'ssrLoadModule'>;

    await expect(inspectKovoDevDatabasePosture(server, OPTIONS)).resolves.toBe('none configured');
    expect(loads).toEqual(['server-build', 'app-shell', 'app', 'profile']);
  });

  it('fails closed when the app-shell registry control is unavailable', async () => {
    const server = {
      ssrLoadModule: vi.fn(async (id: string) => {
        if (id === OPTIONS.serverBuildModuleId) {
          return { resolveKovoAppToken: (value: unknown) => value };
        }
        if (id === OPTIONS.appShellModuleId) {
          return { runWithGeneratedLiveTargetRegistry: 'not callable' };
        }
        throw new Error(`unexpected SSR module ${id}`);
      }),
    } satisfies Pick<ViteDevServer, 'ssrLoadModule'>;

    await expect(inspectKovoDevDatabasePosture(server, OPTIONS)).rejects.toThrow(
      '@kovojs/server/internal/app-shell-vite must export runWithGeneratedLiveTargetRegistry.',
    );
    expect(server.ssrLoadModule).toHaveBeenCalledTimes(2);
  });
});

describe('Kovo devtool runner generations', () => {
  it('caches bundles by exact active module server instead of leaking the old graph after swap', async () => {
    const generation = (queryKey: string) => {
      let loads = 0;
      const app = Object.freeze({
        liveTargetRenderers: Object.freeze([]),
        mutations: Object.freeze([]),
        queries: Object.freeze([{ key: queryKey, reads: Object.freeze([]) }]),
        routes: Object.freeze([]),
      });
      return {
        get loads() {
          return loads;
        },
        moduleServer: {
          async ssrLoadModule(id: string): Promise<Record<string, unknown>> {
            loads += 1;
            if (id === OPTIONS.serverBuildModuleId) {
              return { resolveKovoAppToken: (value: unknown) => value };
            }
            if (id === OPTIONS.appShellModuleId) {
              return {
                runWithGeneratedLiveTargetRegistry: (load: () => Promise<unknown>) => load(),
              };
            }
            if (id === OPTIONS.appModuleId) return { default: app };
            throw new Error(`unexpected SSR module ${id}`);
          },
        } satisfies KovoDevRunnerModuleServer,
      };
    };
    const first = generation('old/query');
    const second = generation('new/query');
    let active = first.moduleServer;
    const runnerGenerations = {
      withLease<T>(operation: (server: KovoDevRunnerModuleServer) => Promise<T>): Promise<T> {
        return operation(active);
      },
    };
    let middleware:
      | ((request: unknown, response: unknown, next: (error?: unknown) => void) => void)
      | undefined;
    const plugin = createKovoDevtoolPlugin({
      ...OPTIONS,
      appModulePath: join(process.cwd(), 'packages/cli/src/app.tsx'),
      runnerGenerations,
    } as never);
    const configureServer = plugin.configureServer;
    if (typeof configureServer !== 'function') throw new Error('missing configureServer');
    configureServer({
      middlewares: {
        use(handler) {
          middleware = handler as typeof middleware;
        },
      },
      watcher: { on() {} },
    } as never);

    const requestDocument = async (): Promise<string> =>
      await new Promise<string>((resolve, reject) => {
        const response = {
          end(body: string) {
            resolve(body);
          },
          headersSent: false,
          setHeader() {},
          statusCode: 0,
          writableEnded: false,
        };
        middleware?.({ method: 'GET', url: '/__kovo' }, response, reject);
      });

    await expect(requestDocument()).resolves.toContain('old/query');
    active = second.moduleServer;
    await expect(requestDocument()).resolves.toContain('new/query');
    const secondLoads = second.loads;
    await expect(requestDocument()).resolves.toContain('new/query');
    expect(first.loads).toBeGreaterThan(0);
    expect(second.loads).toBe(secondLoads);
  });
});
