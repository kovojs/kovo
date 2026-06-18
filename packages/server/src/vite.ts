import type { IncomingMessage, ServerResponse } from 'node:http';

/** Options for the public Kovo Vite plugin (SPEC.md §9.5). */
export interface KovoVitePluginOptions {
  /** Authored app module id to load in Vite dev; it must default-export a KovoApp. */
  app: string;
}

/** Minimal Vite dev-server surface used by the Kovo plugin adapter. */
export interface KovoViteDevServer {
  /** Connect-compatible middleware stack owned by Vite. */
  middlewares: {
    use(handler: KovoViteMiddleware): void;
  };
  /** Load an SSR module through Vite's transform pipeline. */
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

/** Connect-compatible middleware installed by the Kovo Vite plugin. */
export type KovoViteMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

/** Optional post-configuration hook returned by a Vite plugin. */
export type KovoVitePostHook = () => void | Promise<void>;

/** Vite plugin object returned by {@link kovo}. */
export interface KovoVitePlugin {
  /** Install the Kovo request-shell middleware into the Vite dev server. */
  configureServer(server: KovoViteDevServer): Promise<void | KovoVitePostHook>;
  /** Stable plugin name used by Vite diagnostics. */
  name: 'kovo';
}

/** Public Kovo Vite integration bundle. */
export interface KovoViteIntegration {
  /** Vite plugin that serves the authored app during local development. */
  plugin: KovoVitePlugin;
}

/**
 * Public Vite integration for authored Kovo apps (SPEC.md §9.5). The app entry
 * must default-export a KovoApp; generated route artifacts stay compiler-owned.
 */
export function kovo(options: KovoVitePluginOptions): KovoVitePlugin {
  return createKovoViteIntegration(options).plugin;
}

/** Create the public Vite integration without adding options beyond the authored app entry. */
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
