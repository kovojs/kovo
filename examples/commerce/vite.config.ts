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
  plugins: [tailwindcss(), commerceAppShellDevPlugin()],
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

interface CommerceDevServer {
  middlewares: {
    use(handler: DevMiddleware): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

interface CommerceDevPlugin {
  configureServer(server: CommerceDevServer): () => void;
  name: string;
}

function commerceAppShellDevPlugin(): CommerceDevPlugin {
  return {
    configureServer(server) {
      return () => {
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

              return loadCommerceNodeHandler(appShellModule)(request, response, next);
            })
            .catch(next);
        });
      };
    },
    name: 'jiso-commerce-app-shell-dev',
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

function loadCommerceNodeHandler(module: Record<string, unknown>): DevMiddleware {
  const commerceNodeHandler = module.commerceNodeHandler;

  if (typeof commerceNodeHandler !== 'function') {
    throw new Error('src/app-shell.ts must export commerceNodeHandler.');
  }

  return commerceNodeHandler as DevMiddleware;
}
