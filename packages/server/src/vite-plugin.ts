import type { IncomingMessage } from 'node:http';
import { createRequestHandler } from './app.js';
import type { JisoApp } from './app-types.js';
import { toNodeHandler, writeWebResponseToNode } from './node.js';
import { routeResponseToWebResponse } from './response.js';
import {
  renderJisoAppShellViteDevDiagnosticResponse,
  shouldHandleJisoAppShellViteRequest,
  type JisoAppShellDevDiagnosticLedger,
  type JisoAppShellViteDevServer,
} from './vite-dev.js';
import type { JisoAppShellViteOutputBundle } from './vite-manifest.js';
import type { JisoAppShellVitePluginBuildOptions } from './vite-build.js';
import type { JisoAppShellViteOutputOptions } from './vite-build-output.js';
import { writeJisoAppShellVitePluginBuild } from './vite-plugin-build.js';

export interface JisoAppShellVitePlugin {
  configureServer(server: JisoAppShellViteDevServer): void;
  name: 'jiso-app-shell';
  writeBundle?(
    options: JisoAppShellViteOutputOptions,
    bundle: JisoAppShellViteOutputBundle,
  ): Promise<void>;
}

export interface JisoAppShellVitePluginOptions {
  build?: JisoAppShellVitePluginBuildOptions;
  devDiagnostics?: JisoAppShellDevDiagnosticLedger;
  shouldHandleRequest?: (request: IncomingMessage, app: JisoApp) => boolean;
}

export function jisoAppShellVitePlugin(
  app: JisoApp,
  options: JisoAppShellVitePluginOptions = {},
): JisoAppShellVitePlugin {
  const requestHandler = createRequestHandler(app);
  const nodeHandler = toNodeHandler(requestHandler);

  return {
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const shouldHandle =
          options.shouldHandleRequest?.(request, app) ??
          shouldHandleJisoAppShellViteRequest(request, app);
        if (!shouldHandle) {
          next();
          return;
        }

        const diagnosticResponse = renderJisoAppShellViteDevDiagnosticResponse(
          app,
          request,
          options.devDiagnostics,
        );
        if (diagnosticResponse) {
          Promise.resolve(
            writeWebResponseToNode(
              routeResponseToWebResponse(diagnosticResponse, { method: request.method ?? 'GET' }),
              response,
              request.method ?? 'GET',
            ),
          ).catch(next);
          return;
        }

        Promise.resolve(nodeHandler(request, response)).catch(next);
      });
    },
    name: 'jiso-app-shell',
    ...(options.build
      ? {
          async writeBundle(outputOptions, bundle) {
            const buildOptions = options.build;
            if (!buildOptions) return;

            await writeJisoAppShellVitePluginBuild({
              app,
              buildOptions,
              bundle,
              outputOptions,
            });
          },
        }
      : {}),
  };
}
