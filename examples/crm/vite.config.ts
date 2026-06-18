import type { IncomingMessage, ServerResponse } from 'node:http';

import { defineConfig } from 'vite-plus';

export const crmViteConfig = defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        styles: 'src/styles.css',
      },
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  // The multi-tenant demo server installs its own per-session request dispatch.
  plugins: process.env.KOVO_DEMO_MULTITENANT ? [] : [crmSharedAppShellDevPlugin()],
  // PGlite (WASM) makes the build/dev paths slow; give the tests room.
  test: {
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
  run: {
    tasks: {
      serve: {
        command: 'node scripts/serve.mjs',
        input: [
          { pattern: 'package.json', base: 'workspace' },
          { pattern: 'scripts/serve.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
      },
    },
  },
});

export default crmViteConfig;

type DevMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

type DevPostHook = () => void | Promise<void>;

interface CrmDevServer {
  middlewares: {
    use(handler: DevMiddleware): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

interface CrmDevPlugin {
  configureServer(server: CrmDevServer): Promise<void | DevPostHook>;
  name: string;
}

export function crmSharedAppShellDevPlugin(): CrmDevPlugin {
  return {
    async configureServer(server) {
      const serverModule = await server.ssrLoadModule('@kovojs/server');
      const sharedPluginFactory = serverModule.kovoAppShellViteDevPlugin;
      if (typeof sharedPluginFactory !== 'function') {
        throw new Error('@kovojs/server must export kovoAppShellViteDevPlugin.');
      }

      const sharedPlugin = sharedPluginFactory({
        name: 'kovo-crm-app-shell-dev',
        nodeHandlerExportName: 'crmNodeHandler',
        order: 'post',
      }) as { configureServer(server: CrmDevServer): void | DevPostHook };

      return sharedPlugin.configureServer(server);
    },
    name: 'kovo-crm-app-shell-dev-loader',
  };
}
