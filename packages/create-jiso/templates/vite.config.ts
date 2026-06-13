import type { IncomingMessage, ServerResponse } from 'node:http';

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [tailwindcss(), starterSharedAppShellDevPlugin()],
  build: {
    manifest: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    semi: true,
    singleQuote: true,
    sortPackageJson: true,
  },
  run: {
    tasks: {
      build: {
        command: 'vp build',
        input: [
          { pattern: 'index.html', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
      export: {
        command: 'node scripts/export-static.mjs',
        input: [
          { pattern: 'index.html', base: 'workspace' },
          { pattern: 'scripts/export-static.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
      'fw-check': {
        command: 'node scripts/emit-graph.mjs && fw check graph.json',
        input: [
          { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
        ],
        output: ['graph.json'],
      },
      'graph-assertions': {
        command: 'node scripts/emit-graph.mjs && node scripts/graph-assertions.mjs',
        input: [
          { pattern: 'graph.json', base: 'workspace' },
          { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
          { pattern: 'scripts/graph-assertions.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
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

interface StarterDevServer {
  middlewares: {
    use(handler: DevMiddleware): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

interface StarterDevPlugin {
  configureServer(server: StarterDevServer): Promise<void | DevPostHook>;
  name: string;
}

function starterSharedAppShellDevPlugin(): StarterDevPlugin {
  return {
    async configureServer(server) {
      const serverModule = await server.ssrLoadModule('@jiso/server');
      const sharedPluginFactory = serverModule.jisoAppShellViteSsrDevPlugin;
      if (typeof sharedPluginFactory !== 'function') {
        throw new Error('@jiso/server must export jisoAppShellViteSsrDevPlugin.');
      }

      const sharedPlugin = sharedPluginFactory({
        earlyHints: false,
        name: 'jiso-starter-app-shell-dev',
      }) as { configureServer(server: StarterDevServer): void | DevPostHook };

      return sharedPlugin.configureServer(server);
    },
    name: 'jiso-starter-app-shell-dev-loader',
  };
}
