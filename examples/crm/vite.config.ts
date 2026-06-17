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
  // KOVO_DEMO_MULTITENANT (scripts/demo-serve.mjs) mounts its own per-session
  // request dispatch, so drop the singleton app-shell dev plugin that would
  // otherwise claim app routes against one shared PGlite (SPEC.md §9.5).
  plugins: [
    ...(process.env.KOVO_DEMO_MULTITENANT ? [] : [crmSharedAppShellDevPlugin()]),
  ],
  // PGlite (WASM) makes the build/dev/export paths slow; give the tests room.
  test: {
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
  run: {
    tasks: {
      export: {
        command: 'node scripts/export-static.mjs',
        input: [
          { pattern: 'package.json', base: 'workspace' },
          { pattern: 'scripts/export-static.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
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
      const serverModule = await server.ssrLoadModule('@kovojs/server/app-shell/vite');
      const sharedPluginFactory = serverModule.kovoAppShellViteDevPlugin;
      if (typeof sharedPluginFactory !== 'function') {
        throw new Error('@kovojs/server/app-shell/vite must export kovoAppShellViteDevPlugin.');
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
