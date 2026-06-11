import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequestHandler, type JisoApp, type RequestHandler } from './app.js';
import { toNodeHandler } from './node.js';

export interface JisoAppShellVitePlugin {
  configureServer(server: JisoAppShellViteDevServer): void;
  name: 'jiso-app-shell';
}

export interface JisoAppShellViteDevServer {
  middlewares: {
    use(handler: JisoAppShellViteMiddleware): void;
  };
}

export type JisoAppShellViteMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

export type JisoAppShellViteInput = JisoApp | RequestHandler;

export function jisoAppShellVitePlugin(input: JisoAppShellViteInput): JisoAppShellVitePlugin {
  const requestHandler = typeof input === 'function' ? input : createRequestHandler(input);
  const nodeHandler = toNodeHandler(requestHandler);

  return {
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        Promise.resolve(nodeHandler(request, response)).catch(next);
      });
    },
    name: 'jiso-app-shell',
  };
}
