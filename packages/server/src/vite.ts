import type { IncomingMessage, ServerResponse } from 'node:http';
import { diagnosticDefinitions } from '@jiso/core';
import { createRequestHandler, type JisoApp, type RequestHandler } from './app.js';
import { renderDiagnosticDocument, type DiagnosticDocumentDiagnostic } from './document.js';
import { toNodeHandler, writeWebResponseToNode } from './node.js';
import { readHeader, routeResponseToWebResponse, type RoutePageResponse } from './response.js';
import { matchShellDispatch } from './shell.js';
import { renderFragmentWireHtml } from './wire-html.js';
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
  jisoAppShellViteStaticExportAssets,
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
  JisoAppShellViteBuildStaticExportOptions,
  JisoAppShellViteManifestFileBuildOptions,
  JisoAppShellViteManifestFileBuildStaticExportOptions,
  JisoAppShellViteOutputOptions,
  JisoAppShellVitePluginBuildOptions,
  JisoAppShellViteStaticExportAssetOptions,
} from './vite-build.js';

export interface JisoAppShellVitePlugin {
  configureServer(server: JisoAppShellViteDevServer): void;
  name: 'jiso-app-shell';
  writeBundle?(
    options: JisoAppShellViteOutputOptions,
    bundle: JisoAppShellViteOutputBundle,
  ): Promise<void>;
}

export interface JisoAppShellViteDevServer {
  middlewares: {
    use(handler: JisoAppShellViteMiddleware): void;
  };
}

export interface JisoAppShellViteSsrDevServer extends JisoAppShellViteDevServer {
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

export type JisoAppShellViteMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

export type JisoAppShellViteInput = JisoApp | RequestHandler;

export interface JisoAppShellVitePluginOptions {
  build?: JisoAppShellVitePluginBuildOptions;
  devDiagnostics?: JisoAppShellDevDiagnosticLedger;
  shouldHandleRequest?: (request: IncomingMessage, app: JisoApp) => boolean;
}

export interface JisoAppShellViteSsrDevPlugin {
  configureServer(server: JisoAppShellViteSsrDevServer): void | (() => void);
  name: string;
}

export interface JisoAppShellViteSsrDevPluginOptions {
  appExportName?: string;
  moduleId?: string;
  name?: string;
  nodeHandlerExportName?: string;
  order?: 'pre' | 'post';
  shouldHandleRequest?: (request: IncomingMessage, app: JisoApp) => boolean;
}

export interface JisoAppShellDevModuleDiagnostics {
  diagnostics: readonly DiagnosticDocumentDiagnostic[];
  fileName: string;
  moduleHrefs?: readonly string[];
  source?: string;
}

export interface JisoAppShellDevDiagnosticRecord {
  diagnostics: readonly DiagnosticDocumentDiagnostic[];
  fileName: string;
  moduleHrefs?: readonly string[];
  source?: string;
}

export interface JisoAppShellDevDiagnosticLedger {
  diagnosticsForModuleHref(href: string): JisoAppShellDevDiagnosticRecord | undefined;
  recordModuleDiagnostics(record: JisoAppShellDevModuleDiagnostics): void;
}

export function createJisoAppShellDevDiagnosticLedger(): JisoAppShellDevDiagnosticLedger {
  const moduleRecords = new Map<string, JisoAppShellDevDiagnosticRecord>();
  const hrefToFileName = new Map<string, string>();

  return {
    diagnosticsForModuleHref(href) {
      const fileName = hrefToFileName.get(normalizedModuleHref(href));
      return fileName === undefined ? undefined : moduleRecords.get(fileName);
    },
    recordModuleDiagnostics(record) {
      const fileName = slashPath(record.fileName);
      clearModuleRecord(fileName, moduleRecords, hrefToFileName);

      if (!record.diagnostics.some(isErrorDiagnostic)) return;

      const nextRecord: JisoAppShellDevDiagnosticRecord = {
        diagnostics: record.diagnostics,
        fileName,
        ...(record.moduleHrefs === undefined ? {} : { moduleHrefs: record.moduleHrefs }),
        ...(record.source === undefined ? {} : { source: record.source }),
      };
      moduleRecords.set(fileName, nextRecord);

      for (const href of moduleDiagnosticHrefs(nextRecord)) {
        hrefToFileName.set(normalizedModuleHref(href), fileName);
      }
    },
  };
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
          ? devDiagnosticResponse(app, request, options.devDiagnostics)
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

export function jisoAppShellViteSsrDevPlugin(
  options: JisoAppShellViteSsrDevPluginOptions = {},
): JisoAppShellViteSsrDevPlugin {
  const moduleId = options.moduleId ?? '/src/app-shell.ts';
  const appExportName = options.appExportName ?? 'default';
  const nodeHandlerExportName = options.nodeHandlerExportName ?? 'nodeHandler';

  const install = (server: JisoAppShellViteSsrDevServer) => {
    server.middlewares.use((request, response, next) => {
      Promise.resolve(server.ssrLoadModule(moduleId))
        .then((module) => {
          const app = readJisoAppShellViteSsrApp(module, appExportName, moduleId);
          const shouldHandle =
            options.shouldHandleRequest?.(request, app) ??
            shouldHandleJisoAppShellViteRequest(request, app);
          if (!shouldHandle) {
            next();
            return;
          }

          return readJisoAppShellViteSsrNodeHandler(module, nodeHandlerExportName, moduleId)(
            request,
            response,
            next,
          );
        })
        .catch(next);
    });
  };

  return {
    configureServer(server) {
      if (options.order === 'post') return () => install(server);
      install(server);
    },
    name: options.name ?? 'jiso-app-shell-ssr-dev',
  };
}

export function shouldHandleJisoAppShellViteSsrRequest(
  request: IncomingMessage,
  app: JisoApp,
): boolean {
  return shouldHandleJisoAppShellViteRequest(request, app);
}

export function shouldHandleJisoAppShellViteRequest(
  request: IncomingMessage,
  app: JisoApp,
): boolean {
  if (!request.url) return false;

  const url = new URL(request.url, 'http://jiso.local');
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    ...(request.method === undefined ? {} : { method: request.method }),
    pathname: url.pathname,
    routes: app.routes,
  });

  if (match.kind === 'not-found') return false;
  if (match.kind === 'route') return match.methodAllowed;

  return true;
}

function devDiagnosticResponse(
  app: JisoApp,
  request: IncomingMessage,
  diagnostics: JisoAppShellDevDiagnosticLedger | undefined,
): RoutePageResponse | undefined {
  if (!diagnostics) return undefined;

  const url = new URL(request.url ?? '/', 'http://jiso.local');
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    ...(request.method === undefined ? {} : { method: request.method }),
    pathname: url.pathname,
    routes: app.routes,
  });
  if (match.kind === 'mutation') {
    const record = diagnostics.diagnosticsForModuleHref(url.pathname);
    if (!record) return undefined;

    const document = renderDiagnosticDocumentForRecord(record);
    if (readHeader(request.headers, 'FW-Fragment')?.toLowerCase() !== 'true') return document;

    return {
      body: renderFragmentWireHtml({
        html: document.body,
        target: firstMutationDiagnosticTarget(request.headers),
      }),
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 500,
    };
  }

  if (match.kind !== 'route' || !match.methodAllowed) return undefined;

  for (const href of match.route.modulepreloads ?? []) {
    const record = diagnostics.diagnosticsForModuleHref(href);
    if (!record) continue;

    // SPEC §11.3: dev page requests depending on a failed module answer with
    // the same server-rendered teaching diagnostic document, never a local policy.
    return renderDiagnosticDocumentForRecord(record);
  }

  return undefined;
}

function renderDiagnosticDocumentForRecord(
  record: JisoAppShellDevDiagnosticRecord,
): RoutePageResponse & { body: string } {
  return renderDiagnosticDocument({
    diagnostics: record.diagnostics,
    ...(record.source === undefined
      ? {}
      : { source: { fileName: record.fileName, source: record.source } }),
  }) as RoutePageResponse & { body: string };
}

function firstMutationDiagnosticTarget(headers: IncomingMessage['headers']): string {
  return (
    (readHeader(headers, 'FW-Targets') ?? '')
      .split(/[;,]/)
      .map((target) => target.trim())
      .map((target) => target.split('=')[0]?.trim() ?? '')
      .find(Boolean) ?? 'error'
  );
}

function clearModuleRecord(
  fileName: string,
  moduleRecords: Map<string, JisoAppShellDevDiagnosticRecord>,
  hrefToFileName: Map<string, string>,
): void {
  const existing = moduleRecords.get(fileName);
  moduleRecords.delete(fileName);
  if (!existing) return;

  for (const href of moduleDiagnosticHrefs(existing)) {
    hrefToFileName.delete(normalizedModuleHref(href));
  }
}

function moduleDiagnosticHrefs(record: JisoAppShellDevDiagnosticRecord): string[] {
  return [
    ...new Set([...clientModuleHrefsForSourceFile(record.fileName), ...(record.moduleHrefs ?? [])]),
  ];
}

function clientModuleHrefsForSourceFile(fileName: string): string[] {
  const normalized = slashPath(fileName).replace(/^\/+/, '');
  const clientModule = normalized.replace(/\.[cm]?[jt]sx?$/, '.client.js');

  return clientModule === normalized ? [] : [`/c/${clientModule}`];
}

function normalizedModuleHref(href: string): string {
  const url = new URL(href, 'http://jiso.local');
  return slashPath(url.pathname);
}

function isErrorDiagnostic(diagnostic: DiagnosticDocumentDiagnostic): boolean {
  return diagnosticDefinitions[diagnostic.code].severity === 'error';
}

function readJisoAppShellViteSsrApp(
  module: Record<string, unknown>,
  exportName: string,
  moduleId: string,
): JisoApp {
  const app = module[exportName];
  if (isJisoApp(app)) return app;

  throw new Error(`${moduleId} must export ${exportName} as a Jiso app for Vite dev.`);
}

function readJisoAppShellViteSsrNodeHandler(
  module: Record<string, unknown>,
  exportName: string,
  moduleId: string,
): JisoAppShellViteMiddleware {
  const handler = module[exportName];
  if (typeof handler === 'function') return handler as JisoAppShellViteMiddleware;

  throw new Error(`${moduleId} must export ${exportName} as a Node app-shell handler.`);
}

function isJisoApp(value: unknown): value is JisoApp {
  return (
    isRecord(value) &&
    Array.isArray(value.endpoints) &&
    Array.isArray(value.mutations) &&
    Array.isArray(value.queries) &&
    Array.isArray(value.routes) &&
    isRecord(value.clientModules)
  );
}

function slashPath(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
