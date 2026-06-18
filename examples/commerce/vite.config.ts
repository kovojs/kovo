import type { IncomingMessage, ServerResponse } from 'node:http';

import { defineConfig } from 'vite-plus';

export const commerceViteConfig = defineConfig({
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
  // otherwise also claim app routes against one shared PGlite (SPEC.md §9.5).
  plugins: process.env.KOVO_DEMO_MULTITENANT ? [] : [commerceSharedAppShellDevPlugin()],
  // The Drizzle/PGlite (WASM) data layer makes the build/dev tests (which spawn
  // real vite builds and a dev server) run well past Vitest's 5s default,
  // especially under the suite's parallelism. Give them room.
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

export default commerceViteConfig;

type DevMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

type DevPostHook = () => void | Promise<void>;

interface CommerceDevServer {
  middlewares: {
    use(handler: DevMiddleware): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

interface CommerceDevPlugin {
  configureServer(server: CommerceDevServer): Promise<void | DevPostHook>;
  name: string;
}

export function commerceSharedAppShellDevPlugin(): CommerceDevPlugin {
  return {
    async configureServer(server) {
      const serverModule = await server.ssrLoadModule('@kovojs/server/app-shell/vite');
      const sharedPluginFactory = serverModule.kovoAppShellViteDevPlugin;
      if (typeof sharedPluginFactory !== 'function') {
        throw new Error('@kovojs/server/app-shell/vite must export kovoAppShellViteDevPlugin.');
      }

      const sharedPlugin = sharedPluginFactory({
        moduleId: '/src/generated/app-shell.kovo-route.tsx',
        name: 'kovo-commerce-app-shell-dev',
        nodeHandlerExportName: 'commerceNodeHandler',
        order: 'post',
      }) as { configureServer(server: CommerceDevServer): void | DevPostHook };

      return sharedPlugin.configureServer(server);
    },
    name: 'kovo-commerce-app-shell-dev-loader',
  };
}
