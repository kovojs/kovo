import type { IncomingMessage, ServerResponse } from 'node:http';

import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [referenceAppShellDevPlugin()],
  run: {
    tasks: {
      export: {
        command: 'node scripts/export-static.mjs --public',
        input: [
          { pattern: 'scripts/export-static.mjs', base: 'workspace' },
          { pattern: 'src/**/*.ts', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
    },
  },
});

type DevMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

interface ReferenceDevServer {
  middlewares: {
    use(handler: DevMiddleware): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

interface ReferenceDevPlugin {
  configureServer(server: ReferenceDevServer): () => void;
  name: string;
}

function referenceAppShellDevPlugin(): ReferenceDevPlugin {
  return {
    configureServer(server) {
      return () => {
        server.middlewares.use((request, response, next) => {
          if (!isReferenceShellRequest(request)) {
            next();
            return;
          }

          Promise.resolve(loadReferenceNodeHandler(server))
            .then((referenceNodeHandler) => referenceNodeHandler(request, response, next))
            .catch(next);
        });
      };
    },
    name: 'kovo-reference-app-shell-dev',
  };
}

async function loadReferenceNodeHandler(server: ReferenceDevServer): Promise<DevMiddleware> {
  const module = await server.ssrLoadModule('/src/app-shell.ts');
  const referenceNodeHandler = module.referenceNodeHandler;

  if (typeof referenceNodeHandler !== 'function') {
    throw new Error('src/app-shell.ts must export referenceNodeHandler.');
  }

  return referenceNodeHandler as DevMiddleware;
}

function isReferenceShellRequest(request: IncomingMessage): boolean {
  if (!request.url) return false;

  const pathname = new URL(request.url, 'http://kovo.local').pathname;

  if (request.method === 'GET' || request.method === 'HEAD') {
    return pathname === '/login' || pathname === '/account' || pathname === '/admin';
  }

  if (request.method === 'POST') {
    return pathname.startsWith('/_m/');
  }

  return false;
}
