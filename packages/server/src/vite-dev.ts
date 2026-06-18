import type { IncomingMessage, ServerResponse } from 'node:http';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { isKovoApp } from './app-guards.js';
import { createRequestHandler } from './app.js';
import type { KovoApp } from './app-types.js';
import {
  renderDiagnosticDocument,
  type DiagnosticDocumentDiagnostic,
} from './document-diagnostics.js';
import { toNodeHandler, writeWebResponseToNode, type NodeRequestHandler } from './node.js';
import { readHeader, routeResponseToWebResponse, type RoutePageResponse } from './response.js';
import { matchShellDispatch } from './shell.js';
import { renderFragmentWireHtml } from './wire-html.js';

/**
 * @internal App-shell Vite dev/host internal (SPEC.md §9.5). Minimal Vite dev-server
 * surface the app-shell middleware mounts onto.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteDevServer {
  middlewares: {
    use(handler: KovoAppShellViteMiddleware): void;
  };
}

/**
 * @internal App-shell Vite dev/host internal (SPEC.md §9.5). Dev-server shape extended
 * with the ssrLoadModule hook used to replay the loaded app.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteDevModuleServer extends KovoAppShellViteDevServer {
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

/**
 * @internal App-shell Vite dev/host internal (SPEC.md §9.5). Node connect-style
 * middleware signature used by the dev-server adapter.
 * Exported only for in-repo build/host config, not app authors.
 */
export type KovoAppShellViteMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

/**
 * The Vite dev-server plugin object returned by kovoAppShellViteDevPlugin, ready to be
 * placed in a vite.config.ts plugins array. It wires the app shell into the dev server
 * for the SPEC.md §9.5 dev/build/export replay path.
 */
export interface KovoAppShellViteDevPlugin {
  configureServer(server: KovoAppShellViteDevModuleServer): void | (() => void);
  name: string;
}

/**
 * Options for kovoAppShellViteDevPlugin. Control how the dev-server middleware loads
 * and serves the app shell during SPEC.md §9.5 Vite dev/build/export replay, including
 * which module/export to load, request filtering, and Early Hints relay.
 */
export interface KovoAppShellViteDevPluginOptions {
  appExportName?: string;
  /**
   * Dev diagnostic ledger shared with the compiler Vite plugin. When present,
   * requests depending on failed component modules render the same teaching
   * diagnostic document as direct dev diagnostic requests (SPEC.md §9.5.1).
   */
  devDiagnostics?: KovoAppShellDevDiagnosticLedger;
  /**
   * Defaults to true. Set to false when a dev middleware stack cannot safely
   * relay 103 Early Hints but should still keep the final Link header.
   */
  earlyHints?: boolean;
  moduleId?: string;
  name?: string;
  /**
   * When omitted, dev serving adapts the loaded app through the same
   * Request -> Response shell that SPEC §9.5 uses for build/export replay.
   */
  nodeHandlerExportName?: string;
  order?: 'pre' | 'post';
  shouldHandleRequest?: (request: IncomingMessage, app: KovoApp) => boolean;
}

/**
 * Compiler-compatible module diagnostic report accepted by the app-shell dev integration.
 * It is structural on purpose so `@kovojs/server` does not depend on `@kovojs/compiler`.
 */
export interface KovoAppShellViteCompilerModuleDiagnosticReport {
  diagnostics: readonly DiagnosticDocumentDiagnostic[];
  fileName: string;
  source: string;
}

/** Combined app-shell dev plugin plus compiler-diagnostic callback for Vite dev. */
export interface KovoAppShellViteDevIntegration {
  diagnostics: KovoAppShellDevDiagnosticLedger;
  onModuleDiagnostics(report: KovoAppShellViteCompilerModuleDiagnosticReport): void;
  plugin: KovoAppShellViteDevPlugin;
}

/**
 * @internal App-shell Vite dev/host internal (SPEC.md §9.5). Module diagnostics input
 * recorded into the dev diagnostic ledger.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellDevModuleDiagnostics {
  diagnostics: readonly DiagnosticDocumentDiagnostic[];
  fileName: string;
  moduleHrefs?: readonly string[];
  source?: string;
}

/**
 * @internal App-shell Vite dev/host internal (SPEC.md §9.5). Stored diagnostic record
 * keyed by source file in the dev diagnostic ledger.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellDevDiagnosticRecord {
  diagnostics: readonly DiagnosticDocumentDiagnostic[];
  fileName: string;
  moduleHrefs?: readonly string[];
  source?: string;
}

/**
 * @internal App-shell Vite dev/host internal (SPEC.md §9.5). In-memory ledger mapping
 * failed dev modules to teaching diagnostic documents.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellDevDiagnosticLedger {
  allDiagnosticsForFile(fileName: string): KovoAppShellDevDiagnosticRecord | undefined;
  allDiagnosticsForModuleHref(href: string): KovoAppShellDevDiagnosticRecord | undefined;
  diagnosticsForModuleHref(href: string): KovoAppShellDevDiagnosticRecord | undefined;
  recordModuleDiagnostics(record: KovoAppShellDevModuleDiagnostics): void;
}

/**
 * @internal App-shell Vite dev/host internal (SPEC.md §9.5). Creates the dev diagnostic
 * ledger that maps failed modules to teaching diagnostic responses.
 * Exported only for in-repo build/host config, not app authors.
 */
export function createKovoAppShellDevDiagnosticLedger(): KovoAppShellDevDiagnosticLedger {
  const allModuleRecords = new Map<string, KovoAppShellDevDiagnosticRecord>();
  const allHrefToFileName = new Map<string, string>();
  const moduleRecords = new Map<string, KovoAppShellDevDiagnosticRecord>();
  const hrefToFileName = new Map<string, string>();

  return {
    allDiagnosticsForFile(fileName) {
      return allModuleRecords.get(slashPath(fileName));
    },
    allDiagnosticsForModuleHref(href) {
      const fileName = allHrefToFileName.get(normalizedModuleHref(href));
      return fileName === undefined ? undefined : allModuleRecords.get(fileName);
    },
    diagnosticsForModuleHref(href) {
      const fileName = hrefToFileName.get(normalizedModuleHref(href));
      return fileName === undefined ? undefined : moduleRecords.get(fileName);
    },
    recordModuleDiagnostics(record) {
      const fileName = slashPath(record.fileName);
      clearModuleRecord(fileName, allModuleRecords, allHrefToFileName);
      clearModuleRecord(fileName, moduleRecords, hrefToFileName);

      const nextRecord: KovoAppShellDevDiagnosticRecord = {
        diagnostics: record.diagnostics,
        fileName,
        ...(record.moduleHrefs === undefined ? {} : { moduleHrefs: record.moduleHrefs }),
        ...(record.source === undefined ? {} : { source: record.source }),
      };
      allModuleRecords.set(fileName, nextRecord);
      for (const href of moduleDiagnosticHrefs(nextRecord)) {
        allHrefToFileName.set(normalizedModuleHref(href), fileName);
      }

      if (!record.diagnostics.some(isErrorDiagnostic)) return;

      moduleRecords.set(fileName, nextRecord);

      for (const href of moduleDiagnosticHrefs(nextRecord)) {
        hrefToFileName.set(normalizedModuleHref(href), fileName);
      }
    },
  };
}

/**
 * Create the app-facing dev integration for Kovo's Vite stack. App code can pass
 * `integration.onModuleDiagnostics` to the compiler plugin and
 * `integration.plugin` to Vite, while the request shell owns the diagnostic ledger
 * and rendering behavior (SPEC.md §9.5.1).
 */
export function createKovoAppShellViteDevIntegration(
  options: KovoAppShellViteDevPluginOptions = {},
): KovoAppShellViteDevIntegration {
  const diagnostics = options.devDiagnostics ?? createKovoAppShellDevDiagnosticLedger();

  return {
    diagnostics,
    onModuleDiagnostics(report) {
      diagnostics.recordModuleDiagnostics(report);
    },
    plugin: kovoAppShellViteDevPlugin({
      ...options,
      devDiagnostics: diagnostics,
    }),
  };
}

/**
 * Vite dev-server plugin for a Kovo app shell. App authors add it to the plugins array
 * in their vite.config.ts so the dev server serves the app through the same
 * Request -> Response shell that SPEC.md §9.5 uses for build/export replay. The plugin's
 * configureServer hook mounts middleware that ssrLoadModule-loads the app and dispatches
 * matching requests to it.
 */
export function kovoAppShellViteDevPlugin(
  options: KovoAppShellViteDevPluginOptions = {},
): KovoAppShellViteDevPlugin {
  const moduleId = options.moduleId ?? '/src/app-shell.ts';
  const appExportName = options.appExportName ?? 'default';

  const install = (server: KovoAppShellViteDevModuleServer) => {
    server.middlewares.use((request, response, next) => {
      Promise.resolve(server.ssrLoadModule(moduleId))
        .then((module) => {
          const app = readKovoAppShellViteDevApp(module, appExportName, moduleId);
          const shouldHandle = shouldHandleKovoAppShellViteDevRequest(
            request,
            app,
            options.shouldHandleRequest,
          );
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
            return writeKovoAppShellViteDevRouteResponse(diagnosticResponse, request, response).catch(
              next,
            );
          }

          return readKovoAppShellViteDevNodeHandler(
            module,
            app,
            options,
            options.nodeHandlerExportName,
            moduleId,
          )(request, response, next);
        })
        .catch(next);
    });
  };

  return {
    configureServer(server) {
      if (options.order === 'post') return () => install(server);
      install(server);
    },
    name: options.name ?? 'kovo-app-shell-dev',
  };
}

async function writeKovoAppShellViteDevRouteResponse(
  routeResponse: RoutePageResponse,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await writeWebResponseToNode(
    routeResponseToWebResponse(routeResponse, { method: request.method ?? 'GET' }),
    response,
    request.method ?? 'GET',
  );
}

/**
 * @internal App-shell Vite dev/host internal (SPEC.md §9.5). Default predicate deciding
 * whether a dev request should be claimed by the app shell instead of Vite.
 * Exported only for in-repo build/host config, not app authors.
 */
export function shouldHandleKovoAppShellViteRequest(
  request: IncomingMessage,
  app: KovoApp,
): boolean {
  if (!request.url) return false;

  const url = new URL(request.url, 'http://kovo.local');
  if (isUnversionedKovoAppShellClientModuleRequest(url)) return false;

  const match = matchShellDispatch({
    endpoints: app.endpoints,
    ...(request.method === undefined ? {} : { method: request.method }),
    pathname: url.pathname,
    routes: app.routes,
  });

  if (match.kind === 'not-found') return isHtmlNavigationRequest(request);

  return true;
}

function shouldHandleKovoAppShellViteDevRequest(
  request: IncomingMessage,
  app: KovoApp,
  shouldHandleRequest: KovoAppShellViteDevPluginOptions['shouldHandleRequest'],
): boolean {
  if (!request.url) return false;

  const url = new URL(request.url, 'http://kovo.local');
  if (isUnversionedKovoAppShellClientModuleRequest(url)) return false;

  return shouldHandleRequest?.(request, app) ?? shouldHandleKovoAppShellViteRequest(request, app);
}

function isUnversionedKovoAppShellClientModuleRequest(url: URL): boolean {
  // SPEC §9.5 reserves immutable app-shell client modules as /c/<module>?v=.
  // During Vite dev, unversioned /c/ URLs must keep falling through to Vite's
  // asset/middleware stack instead of being claimed by app replay.
  return url.pathname.startsWith('/c/') && !url.searchParams.has('v');
}

function isHtmlNavigationRequest(request: IncomingMessage): boolean {
  if (request.method !== undefined && request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const accept = readHeader(request.headers, 'accept')?.toLowerCase() ?? '';
  return accept.includes('text/html');
}

/**
 * @internal App-shell Vite dev/host internal (SPEC.md §9.5). Renders the dev teaching
 * diagnostic document/fragment for a request whose module failed to build.
 * Exported only for in-repo build/host config, not app authors.
 */
export function renderKovoAppShellViteDevDiagnosticResponse(
  app: KovoApp,
  request: IncomingMessage,
  diagnostics: KovoAppShellDevDiagnosticLedger | undefined,
): RoutePageResponse | undefined {
  if (!diagnostics) return undefined;

  const url = new URL(request.url ?? '/', 'http://kovo.local');
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
    if (readHeader(request.headers, 'Kovo-Fragment')?.toLowerCase() !== 'true') return document;

    return {
      body: renderFragmentWireHtml({
        html: document.body,
        target: firstMutationDiagnosticTarget(request.headers),
      }),
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
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
  record: KovoAppShellDevDiagnosticRecord,
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
    (readHeader(headers, 'Kovo-Targets') ?? '')
      .split(/[;,]/)
      .map((target) => target.trim())
      .map((target) => target.split('=')[0]?.trim() ?? '')
      .find(Boolean) ?? 'error'
  );
}

function clearModuleRecord(
  fileName: string,
  moduleRecords: Map<string, KovoAppShellDevDiagnosticRecord>,
  hrefToFileName: Map<string, string>,
): void {
  const existing = moduleRecords.get(fileName);
  moduleRecords.delete(fileName);
  if (!existing) return;

  for (const href of moduleDiagnosticHrefs(existing)) {
    hrefToFileName.delete(normalizedModuleHref(href));
  }
}

function moduleDiagnosticHrefs(record: KovoAppShellDevDiagnosticRecord): string[] {
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
  const url = new URL(href, 'http://kovo.local');
  return slashPath(url.pathname);
}

function isErrorDiagnostic(diagnostic: DiagnosticDocumentDiagnostic): boolean {
  return diagnosticDefinitions[diagnostic.code].severity === 'error';
}

function readKovoAppShellViteDevApp(
  module: Record<string, unknown>,
  exportName: string,
  moduleId: string,
): KovoApp {
  const app = module[exportName];
  if (isKovoApp(app)) return app;

  throw new Error(`${moduleId} must export ${exportName} as a Kovo app for Vite dev.`);
}

function readKovoAppShellViteDevNodeHandler(
  module: Record<string, unknown>,
  app: KovoApp,
  options: KovoAppShellViteDevPluginOptions,
  exportName: string | undefined,
  moduleId: string,
): KovoAppShellViteMiddleware {
  if (exportName !== undefined) {
    const handler = module[exportName];
    if (isKovoAppShellViteDevNodeHandler(handler)) {
      return (request, response, next) => {
        Promise.resolve(handler(request, response)).catch(next);
      };
    }

    throw new Error(
      `${moduleId} must export ${exportName} as a Node app-shell handler with (request, response).`,
    );
  }

  const nodeOptions =
    options.earlyHints === undefined ? undefined : { earlyHints: options.earlyHints };
  const nodeHandler = toNodeHandler(createRequestHandler(app), nodeOptions);
  return (request, response) => nodeHandler(request, response);
}

function isKovoAppShellViteDevNodeHandler(value: unknown): value is NodeRequestHandler {
  // SPEC §9.5 keeps the public handler currency as Request -> Response; this
  // optional dev hook is only for the adapter edge and must be a Node handler.
  return typeof value === 'function' && value.length >= 2;
}

function slashPath(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}
