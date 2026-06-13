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
  type JisoAppShellVitePluginBuildOptions,
} from './vite-build.js';
import {
  jisoAppShellViteOutputDir,
  writeJisoAppShellViteBuildOutput,
  type JisoAppShellViteOutputOptions,
} from './vite-build-output.js';

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
} from './vite-build.js';
export {
  jisoAppShellViteOutputDir,
  writeJisoAppShellViteBuildOutput,
} from './vite-build-output.js';
export {
  jisoAppShellViteManifestFile,
  jisoAppShellViteBuildStaticExportAssets,
  jisoAppShellViteStaticExportAssetsFromManifestFile,
  jisoAppShellViteStaticExportAssets,
} from './vite-build-assets.js';
export {
  exportJisoAppShellViteBuild,
  exportJisoAppShellViteBuildFromManifestFile,
  staticExportManifestForJisoAppShellViteBuildFromManifestFile,
  staticExportManifestForJisoAppShellViteBuild,
  staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
  staticExportInventoryForJisoAppShellViteBuild,
} from './vite-static-export.js';
export type {
  JisoAppShellBuild,
  JisoAppShellBuildOptions,
  JisoAppShellBuiltClientModule,
  JisoAppShellCompiledClientModule,
  JisoAppShellRouteBuildHints,
  JisoAppShellViteBuildOptions,
  JisoAppShellViteBundleBuildOptions,
  JisoAppShellViteManifestFileBuildOptions,
  JisoAppShellVitePluginBuildOptions,
} from './vite-build.js';
export type {
  JisoAppShellViteBuildOutput,
  JisoAppShellViteBuildOutputOptions,
  JisoAppShellViteBuildOutputStaticExportOptions,
  JisoAppShellViteOutputOptions,
} from './vite-build-output.js';
export type {
  JisoAppShellViteBuildStaticExportAssetOptions,
  JisoAppShellViteManifestFileStaticExportAssetOptions,
  JisoAppShellViteStaticExportAssetOptions,
} from './vite-build-assets.js';
export type {
  JisoAppShellViteBuildStaticExportInventoryOptions,
  JisoAppShellViteBuildStaticExportOptions,
  JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
  JisoAppShellViteManifestFileBuildStaticExportOptions,
  JisoAppShellVitePluginStaticExportOptions,
} from './vite-static-export.js';
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
            const buildOptions = options.build;
            if (!buildOptions) return;

            const outDir = buildOptions.outDir ?? jisoAppShellViteOutputDir(outputOptions);
            const build = createJisoAppShellViteBuildFromBundle({
              app,
              bundle,
              ...(buildOptions.base === undefined ? {} : { base: buildOptions.base }),
              ...(buildOptions.clientModules === undefined
                ? {}
                : { clientModules: buildOptions.clientModules }),
              ...(buildOptions.routeEntryMap === undefined
                ? {}
                : { routeEntryMap: buildOptions.routeEntryMap }),
            });
            const output = await writeJisoAppShellViteBuildOutput(build, {
              outDir,
              ...(buildOptions.staticExport === undefined
                ? {}
                : { staticExport: buildOptions.staticExport }),
            });
            await buildOptions.onBuild?.(build, output);
          },
        }
      : {}),
  };
}
