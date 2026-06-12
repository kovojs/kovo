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
          if (!isCommerceShellRequest(request)) {
            next();
            return;
          }

          Promise.resolve(loadCommerceNodeHandler(server))
            .then((commerceNodeHandler) => commerceNodeHandler(request, response, next))
            .catch(next);
        });
      };
    },
    name: 'jiso-commerce-app-shell-dev',
  };
}

async function loadCommerceNodeHandler(server: CommerceDevServer): Promise<DevMiddleware> {
  const module = await server.ssrLoadModule('/src/app-shell.ts');
  const commerceNodeHandler = module.commerceNodeHandler;

  if (typeof commerceNodeHandler !== 'function') {
    throw new Error('src/app-shell.ts must export commerceNodeHandler.');
  }

  return commerceNodeHandler as DevMiddleware;
}

function isCommerceShellRequest(request: IncomingMessage): boolean {
  if (!request.url) return false;

  const pathname = new URL(request.url, 'http://jiso.local').pathname;

  if (request.method === 'GET' || request.method === 'HEAD') {
    return (
      pathname === '/cart' ||
      pathname === '/login' ||
      pathname === '/admin' ||
      pathname === '/exports/orders.csv' ||
      pathname.startsWith('/attachments/') ||
      pathname.startsWith('/_q/') ||
      pathname.startsWith('/c/')
    );
  }

  if (request.method === 'POST') {
    return pathname.startsWith('/_m/') || pathname === '/webhooks/stripe';
  }

  return false;
}
