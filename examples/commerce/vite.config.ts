import type { IncomingMessage, ServerResponse } from 'node:http';

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        tailwind: 'src/styles.css',
      },
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [tailwindcss(), commerceSharedAppShellDevPlugin()],
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

function commerceSharedAppShellDevPlugin(): CommerceDevPlugin {
  return {
    async configureServer(server) {
      const serverModule = await server.ssrLoadModule('@jiso/server');
      const sharedPluginFactory = serverModule.jisoAppShellViteSsrDevPlugin;
      if (typeof sharedPluginFactory !== 'function') {
        throw new Error('@jiso/server must export jisoAppShellViteSsrDevPlugin.');
      }

      const sharedPlugin = sharedPluginFactory({
        name: 'jiso-commerce-app-shell-dev',
        nodeHandlerExportName: 'commerceNodeHandler',
        order: 'post',
      }) as { configureServer(server: CommerceDevServer): void | DevPostHook };

      return sharedPlugin.configureServer(server);
    },
    name: 'jiso-commerce-app-shell-dev-loader',
  };
}
