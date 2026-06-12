import type { IncomingMessage, ServerResponse } from 'node:http';

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [tailwindcss(), starterAppShellDevPlugin()],
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

interface StarterDevServer {
  middlewares: {
    use(handler: DevMiddleware): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

interface StarterDevPlugin {
  configureServer(server: StarterDevServer): void;
  name: string;
}

function starterAppShellDevPlugin(): StarterDevPlugin {
  return {
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        Promise.all([
          server.ssrLoadModule('@jiso/server'),
          server.ssrLoadModule('/src/app-shell.ts'),
        ])
          .then(([serverModule, appShellModule]) => {
            if (!shouldHandleAppShellRequest(serverModule, appShellModule, request)) {
              next();
              return;
            }

            return loadStarterNodeHandler(appShellModule)(request, response, next);
          })
          .catch(next);
      });
    },
    name: 'jiso-starter-app-shell-dev',
  };
}

function shouldHandleAppShellRequest(
  serverModule: Record<string, unknown>,
  appShellModule: Record<string, unknown>,
  request: IncomingMessage,
): boolean {
  const shouldHandle = serverModule.shouldHandleJisoAppShellViteSsrRequest;
  if (typeof shouldHandle !== 'function') {
    throw new Error('@jiso/server must export shouldHandleJisoAppShellViteSsrRequest.');
  }

  return shouldHandle(request, appShellModule.default);
}

function loadStarterNodeHandler(module: Record<string, unknown>): DevMiddleware {
  const starterNodeHandler = module.starterNodeHandler;

  if (typeof starterNodeHandler !== 'function') {
    throw new Error('src/app-shell.ts must export starterNodeHandler.');
  }

  return starterNodeHandler as DevMiddleware;
}
