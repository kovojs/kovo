import type { IncomingMessage } from 'node:http';
import { createRequestHandler, type JisoApp, type RequestHandler } from './app.js';
import { toNodeHandler, writeWebResponseToNode } from './node.js';
import { routeResponseToWebResponse } from './response.js';
import {
  renderJisoAppShellViteDevDiagnosticResponse,
  shouldHandleJisoAppShellViteRequest,
  type JisoAppShellDevDiagnosticLedger,
  type JisoAppShellViteDevServer,
} from './vite-dev.js';
import type { JisoAppShellViteOutputBundle } from './vite-manifest.js';
import {
  createJisoAppShellViteBuildFromBundle,
  jisoAppShellViteOutputDir,
  writeJisoAppShellViteBuildOutput,
  type JisoAppShellViteOutputOptions,
  type JisoAppShellVitePluginBuildOptions,
} from './vite-build.js';

export {
  jisoAppShellViteManifestAssets,
  jisoAppShellViteManifestAssetsFromFile,
  jisoAppShellViteManifestFromBundle,
  jisoAppShellViteManifestFromFile,
  jisoAppShellViteManifestHints,
  jisoAppShellViteManifestStylesheetHref,
  jisoAppShellViteManifestStylesheetHrefFromFile,
  jisoAppShellViteManifestStylesheetHrefs,
  jisoAppShellViteManifestStylesheetHrefsFromFile,
  jisoAppShellViteRouteEntries,
} from './vite-manifest.js';
export type {
  JisoAppShellBuildAsset,
  JisoAppShellRouteBuildEntry,
  JisoAppShellRouteEntryMap,
  JisoAppShellViteManifest,
  JisoAppShellViteManifestChunk,
  JisoAppShellViteManifestHintOptions,
  JisoAppShellViteOutputAsset,
  JisoAppShellViteOutputBundle,
  JisoAppShellViteOutputChunk,
  JisoAppShellViteRouteEntryOptions,
} from './vite-manifest.js';
export {
  createJisoAppShellBuild,
  createJisoAppShellViteBuild,
  createJisoAppShellViteBuildFromBundle,
  createJisoAppShellViteBuildFromManifestFile,
  exportJisoAppShellViteBuild,
  exportJisoAppShellViteBuildFromManifestFile,
  jisoAppShellViteManifestFile,
  jisoAppShellViteStaticExportAssetsFromManifestFile,
  jisoAppShellViteStaticExportAssets,
  staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
  staticExportInventoryForJisoAppShellViteBuild,
  writeJisoAppShellViteBuildOutput,
} from './vite-build.js';
export type {
  JisoAppShellBuild,
  JisoAppShellBuildOptions,
  JisoAppShellBuiltClientModule,
  JisoAppShellCompiledClientModule,
  JisoAppShellRouteBuildHints,
  JisoAppShellViteBuildOptions,
  JisoAppShellViteBundleBuildOptions,
  JisoAppShellViteBuildOutput,
  JisoAppShellViteBuildOutputOptions,
  JisoAppShellViteBuildStaticExportInventoryOptions,
  JisoAppShellViteBuildStaticExportOptions,
  JisoAppShellViteManifestFileBuildOptions,
  JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
  JisoAppShellViteManifestFileBuildStaticExportOptions,
  JisoAppShellViteManifestFileStaticExportAssetOptions,
  JisoAppShellViteOutputOptions,
  JisoAppShellVitePluginBuildOptions,
  JisoAppShellViteStaticExportAssetOptions,
} from './vite-build.js';
export {
  createJisoAppShellDevDiagnosticLedger,
  jisoAppShellViteSsrDevPlugin,
  renderJisoAppShellViteDevDiagnosticResponse,
  shouldHandleJisoAppShellViteRequest,
  shouldHandleJisoAppShellViteSsrRequest,
} from './vite-dev.js';
export type {
  JisoAppShellDevDiagnosticLedger,
  JisoAppShellDevDiagnosticRecord,
  JisoAppShellDevModuleDiagnostics,
  JisoAppShellViteDevServer,
  JisoAppShellViteMiddleware,
  JisoAppShellViteSsrDevPlugin,
  JisoAppShellViteSsrDevPluginOptions,
  JisoAppShellViteSsrDevServer,
} from './vite-dev.js';

export interface JisoAppShellVitePlugin {
  configureServer(server: JisoAppShellViteDevServer): void;
  name: 'jiso-app-shell';
  writeBundle?(
    options: JisoAppShellViteOutputOptions,
    bundle: JisoAppShellViteOutputBundle,
  ): Promise<void>;
}

export type JisoAppShellViteInput = JisoApp | RequestHandler;

export interface JisoAppShellVitePluginOptions {
  build?: JisoAppShellVitePluginBuildOptions;
  devDiagnostics?: JisoAppShellDevDiagnosticLedger;
  shouldHandleRequest?: (request: IncomingMessage, app: JisoApp) => boolean;
}

export function jisoAppShellVitePlugin(
  input: JisoAppShellViteInput,
  options: JisoAppShellVitePluginOptions = {},
): JisoAppShellVitePlugin {
  const requestHandler = typeof input === 'function' ? input : createRequestHandler(input);
  const nodeHandler = toNodeHandler(requestHandler);
  const app = typeof input === 'function' ? undefined : input;

  return {
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (app) {
          const shouldHandle =
            options.shouldHandleRequest?.(request, app) ??
            shouldHandleJisoAppShellViteRequest(request, app);
          if (!shouldHandle) {
            next();
            return;
          }
        }

        const diagnosticResponse = app
          ? renderJisoAppShellViteDevDiagnosticResponse(app, request, options.devDiagnostics)
          : undefined;
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
    ...(app && options.build
      ? {
          async writeBundle(outputOptions, bundle) {
            const build = createJisoAppShellViteBuildFromBundle({
              app,
              bundle,
              ...(options.build?.base === undefined ? {} : { base: options.build.base }),
              ...(options.build?.clientModules === undefined
                ? {}
                : { clientModules: options.build.clientModules }),
              ...(options.build?.routeEntryMap === undefined
                ? {}
                : { routeEntryMap: options.build.routeEntryMap }),
            });
            const output = await writeJisoAppShellViteBuildOutput(build, {
              outDir: options.build?.outDir ?? jisoAppShellViteOutputDir(outputOptions),
            });
            await options.build?.onBuild?.(build, output);
          },
        }
      : {}),
  };
}
