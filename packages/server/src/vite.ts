import type { IncomingMessage, ServerResponse } from 'node:http';

export interface KovoVitePluginOptions {
  app: string;
}

export interface KovoViteDevServer {
  middlewares: {
    use(handler: KovoViteMiddleware): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

export type KovoViteMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

export type KovoVitePostHook = () => void | Promise<void>;

export interface KovoVitePlugin {
  configureServer(server: KovoViteDevServer): Promise<void | KovoVitePostHook>;
  name: 'kovo';
}

export interface KovoViteIntegration {
  plugin: KovoVitePlugin;
}

/**
 * Public Vite integration for authored Kovo apps (SPEC.md §9.5). The app entry
 * must default-export a KovoApp; generated route artifacts stay compiler-owned.
 */
export function kovo(options: KovoVitePluginOptions): KovoVitePlugin {
  return createKovoViteIntegration(options).plugin;
}

export function createKovoViteIntegration(options: KovoVitePluginOptions): KovoViteIntegration {
  const app = authoredAppEntry(options.app);
  return {
    plugin: {
      async configureServer(server) {
        const serverModule = await server.ssrLoadModule('@kovojs/server');
        const createDevIntegration = serverModule.createKovoAppShellViteDevIntegration;
        if (typeof createDevIntegration !== 'function') {
          throw new Error('@kovojs/server must export createKovoAppShellViteDevIntegration.');
        }

        const integration = createDevIntegration({
          moduleId: app,
        }) as { plugin: { configureServer(server: KovoViteDevServer): void | KovoVitePostHook } };

        return integration.plugin.configureServer(server);
      },
      name: 'kovo',
    },
  };
}

function authoredAppEntry(app: string): string {
  if (typeof app !== 'string' || app.trim() === '') {
    throw new TypeError('kovo({ app }) requires an authored app entry module.');
  }
  const normalized = app.trim().split('?')[0]?.replaceAll('\\', '/') ?? '';
  if (normalized.includes('/generated/')) {
    throw new TypeError(
      'kovo({ app }) must point at an authored app entry, not an app-local generated artifact (SPEC.md §9.5).',
    );
  }
  return app.trim();
}
