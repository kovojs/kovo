import type { IncomingMessage, ServerResponse } from 'node:http';

import { defineConfig } from 'vite-plus';

export const soViteConfig = defineConfig({
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
  // KOVO_DEMO_MULTITENANT (scripts/demo-serve.mjs) mounts its own per-session
  // request dispatch, so drop the singleton app-shell dev plugin that would
  // otherwise claim app routes against one shared PGlite (SPEC.md §9.5).
  plugins: process.env.KOVO_DEMO_MULTITENANT ? [] : [soSharedAppShellDevPlugin()],
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

export default soViteConfig;

type DevMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

type DevPostHook = () => void | Promise<void>;

interface SoDevServer {
  middlewares: {
    use(handler: DevMiddleware): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

interface SoDevPlugin {
  configureServer(server: SoDevServer): Promise<void | DevPostHook>;
  name: string;
}

export function soSharedAppShellDevPlugin(): SoDevPlugin {
  return {
    async configureServer(server) {
      const serverModule = await server.ssrLoadModule('@kovojs/server/app-shell/vite');
      const sharedPluginFactory = serverModule.kovoAppShellViteDevPlugin;
      if (typeof sharedPluginFactory !== 'function') {
        throw new Error('@kovojs/server/app-shell/vite must export kovoAppShellViteDevPlugin.');
      }

      const sharedPlugin = sharedPluginFactory({
        name: 'kovo-so-app-shell-dev',
        nodeHandlerExportName: 'soNodeHandler',
        order: 'post',
      }) as { configureServer(server: SoDevServer): void | DevPostHook };

      return sharedPlugin.configureServer(server);
    },
    name: 'kovo-so-app-shell-dev-loader',
  };
}
