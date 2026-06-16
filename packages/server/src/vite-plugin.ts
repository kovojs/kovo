import type { IncomingMessage } from 'node:http';
import { isKovoApp } from './app-guards.js';
import { createRequestHandler } from './app.js';
import type { KovoApp } from './app-types.js';
import { toNodeHandler, writeWebResponseToNode } from './node.js';
import { routeResponseToWebResponse } from './response.js';
import {
  renderKovoAppShellViteDevDiagnosticResponse,
  shouldHandleKovoAppShellViteRequest,
  type KovoAppShellDevDiagnosticLedger,
  type KovoAppShellViteDevServer,
} from './vite-dev.js';
import type { KovoAppShellViteOutputBundle } from './vite-manifest.js';
import type { KovoAppShellVitePluginBuildOptions } from './vite-build.js';
import type { KovoAppShellViteOutputOptions } from './vite-build-output.js';
import { writeKovoAppShellVitePluginBuild } from './vite-plugin-build.js';

/**
 * @internal App-shell Vite dev/build internal (SPEC.md §9.5). Combined dev-server plus
 * writeBundle plugin object returned by the raw kovoAppShellVitePlugin.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellVitePlugin {
  configureServer(server: KovoAppShellViteDevServer): void;
  name: 'kovo-app-shell';
  writeBundle?(
    options: KovoAppShellViteOutputOptions,
    bundle: KovoAppShellViteOutputBundle,
  ): Promise<void>;
}

/**
 * @internal App-shell Vite dev/build internal (SPEC.md §9.5). Options for the raw
 * kovoAppShellVitePlugin (dev diagnostics, build wiring, request filter).
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellVitePluginOptions {
  build?: KovoAppShellVitePluginBuildOptions;
  devDiagnostics?: KovoAppShellDevDiagnosticLedger;
  shouldHandleRequest?: (request: IncomingMessage, app: KovoApp) => boolean;
}

/**
 * @internal App-shell Vite dev/build internal (SPEC.md §9.5). Raw combined dev + build
 * plugin; app authors use kovoAppShellViteDevPlugin and the export helpers instead.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellVitePlugin(
  app: KovoApp,
  options: KovoAppShellVitePluginOptions = {},
): KovoAppShellVitePlugin {
  assertKovoAppShellVitePluginApp(app);
  const requestHandler = createRequestHandler(app);
  const nodeHandler = toNodeHandler(requestHandler);

  return {
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const shouldHandle =
          options.shouldHandleRequest?.(request, app) ??
          shouldHandleKovoAppShellViteRequest(request, app);
        if (!shouldHandle) {
          next();
          return;
        }

        const diagnosticResponse = renderKovoAppShellViteDevDiagnosticResponse(
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
    name: 'kovo-app-shell',
    ...(options.build
      ? {
          async writeBundle(outputOptions, bundle) {
            const buildOptions = options.build;
            if (!buildOptions) return;

            await writeKovoAppShellVitePluginBuild({
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

function assertKovoAppShellVitePluginApp(app: KovoApp): void {
  if (isKovoApp(app)) return;

  throw new TypeError(
    'kovoAppShellVitePlugin() requires a Kovo app aggregate. SPEC §9.5 Vite dev/build/export replay must start from createApp(), not a raw request handler or compatibility shell.',
  );
}
