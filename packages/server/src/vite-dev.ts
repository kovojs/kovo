import type { IncomingMessage, ServerResponse } from 'node:http';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { isKovoApp } from './app-guards.js';
import { deriveClosedKovoApp } from './app-snapshot.js';
import { createRequestHandler } from './app.js';
import type { KovoApp } from './app-types.js';
import {
  renderDiagnosticDocument,
  type DiagnosticDocumentDiagnostic,
} from './document-diagnostics.js';
import type { StylesheetAsset } from './hints.js';
import {
  nodeRequestToWebRequest,
  toNodeHandler,
  writeWebResponseToNode,
  type NodeRequestHandler,
} from './node.js';
import { renderLiveTargetChunks } from './mutation.js';
import { readMutationWireHeaders } from './mutation-wire.js';
import { readHeader, routeResponseToWebResponse, type RoutePageResponse } from './response.js';
import { matchShellDispatch } from './shell.js';
import { generatedFragmentHtml } from './html.js';
import { renderFragmentWireHtml } from './wire-html.js';
import type { ServerErrorDiagnosticContext } from './diagnostics.js';
import { scrubConsoleArgs } from './logging.js';
import {
  createSecurityHeaders,
  createSecurityResponse,
  securityArrayJoin,
  securityHeadersDelete,
  securityHeadersGet,
  securityHeadersSet,
  securityIsResponse,
  securityResponseBody,
  securityResponseHeaders,
  securityResponseStatus,
  securityResponseStatusText,
  securityResponseText,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringSlice,
  securityStringStartsWith,
  securityStringToLowerCase,
} from './response-security-intrinsics.js';

const kovoHmrClientPath = '/@kovo/hmr-client';
const kovoHmrRouteRefreshPath = '/@kovo/hmr/refresh/route';
const kovoHmrLiveTargetRefreshPath = '/@kovo/hmr/refresh/live-targets';
const kovoHmrClientScript = `<script type="module" src="${kovoHmrClientPath}"></script>`;
const kovoAppShellViteDevModuleId = '@kovojs/server/internal/app-shell-vite';
const kovoServerRootModuleId = '@kovojs/server';

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
  config?: {
    root?: string;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  ws?: KovoAppShellViteWebSocket;
}

/** @internal Minimal Vite websocket surface used for app-shell route HMR events. */
export interface KovoAppShellViteWebSocket {
  send(payload: KovoAppShellViteWebSocketPayload): void;
}

/** Websocket payloads emitted by the app-shell dev plugin during dev HMR. */
export type KovoAppShellViteWebSocketPayload =
  | {
      data: {
        impact: 'routeRefresh';
        reasons: readonly ['route-shell'];
        sourceFile: string;
      };
      event: 'kovo:route-shell';
      type: 'custom';
    }
  | {
      type: 'full-reload';
    };

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
 * for the SPEC.md §9.5 dev/build/export replay path. App authors add the plugin to the
 * `plugins` array of their vite.config.ts (see the create-kovo starter template).
 */
export interface KovoAppShellViteDevPlugin {
  configureServer(server: KovoAppShellViteDevModuleServer): void | (() => void);
  handleHotUpdate?(context: KovoAppShellViteHotUpdateContext): Promise<readonly unknown[]>;
  name: string;
}

/** @internal Minimal structural Vite handleHotUpdate context for app-shell dev HMR. */
export interface KovoAppShellViteHotUpdateContext {
  file: string;
  modules?: readonly unknown[];
  read(): Promise<string>;
  server: KovoAppShellViteDevModuleServer;
}

/**
 * Options for kovoAppShellViteDevPlugin. Control how the dev-server middleware loads
 * and serves the app shell during SPEC.md §9.5 Vite dev/build/export replay, including
 * which module/export to load, request filtering, and Early Hints relay. App authors
 * pass these when wiring the dev plugin into their vite.config.ts.
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
  /**
   * Build-owned stylesheet assets supplied by the compiler Vite plugin during dev.
   * Structural on purpose: server dev stays independent of @kovojs/compiler while
   * serving the same base/route/fragment stylesheet lists as build/export.
   */
  stylesheetAssets?:
    | KovoAppShellViteDevStylesheetAssets
    | (() => KovoAppShellViteDevStylesheetAssets | undefined);
}

/** @internal Structural CSS chunk assets accepted by app-shell Vite dev. */
export interface KovoAppShellViteDevStylesheetAssets {
  app?: readonly (string | StylesheetAsset)[];
  fragments?: Readonly<Record<string, readonly (string | StylesheetAsset)[]>>;
  routes?: Readonly<Record<string, readonly (string | StylesheetAsset)[]>>;
}

/**
 * Compiler-compatible module diagnostic report accepted by the app-shell dev integration.
 * It is structural on purpose so `@kovojs/server` does not depend on `@kovojs/compiler`.
 * App authors relay these reports from the compiler Vite plugin into
 * `integration.onModuleDiagnostics` (SPEC.md §9.5.1).
 */
export interface KovoAppShellViteCompilerModuleDiagnosticReport {
  diagnostics: readonly DiagnosticDocumentDiagnostic[];
  fileName: string;
  source: string;
}

/**
 * Combined app-shell dev plugin plus compiler-diagnostic callback for Vite dev.
 * Returned by createKovoAppShellViteDevIntegration for use in an app's vite.config.ts.
 */
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

interface KovoAppShellDevRequestDiagnostics {
  diagnostics: readonly DiagnosticDocumentDiagnostic[];
  href: string;
  source?: string;
}

interface KovoAppShellDevRequestDiagnosticStore {
  requestRecords: Map<string, KovoAppShellDevDiagnosticRecord>;
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

const requestDiagnosticStores = new WeakMap<
  KovoAppShellDevDiagnosticLedger,
  KovoAppShellDevRequestDiagnosticStore
>();

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
  const requestRecords = new Map<string, KovoAppShellDevDiagnosticRecord>();

  const ledger: KovoAppShellDevDiagnosticLedger = {
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
  registerRequestDiagnosticStore(ledger, requestRecords);
  return ledger;
}

/**
 * Create the app-facing dev integration for Kovo's Vite stack. App code can pass
 * `integration.onModuleDiagnostics` to the compiler plugin and
 * `integration.plugin` to Vite, while the request shell owns the diagnostic ledger
 * and rendering behavior (SPEC.md §9.5.1). Used by the create-kovo starter
 * template's vite.config.ts.
 */
export function createKovoAppShellViteDevIntegration(
  options: KovoAppShellViteDevPluginOptions = {},
): KovoAppShellViteDevIntegration {
  const diagnostics = options.devDiagnostics ?? createKovoAppShellDevDiagnosticLedger();
  // A caller may have created this structural ledger in the Vite-config module instance. Register
  // it in every server module instance that consumes it so request-local diagnostics remain owned
  // by the same graph-local middleware as app validation.
  registerRequestDiagnosticStore(diagnostics);
  const pluginOptions = {
    ...options,
    devDiagnostics: diagnostics,
  };

  return {
    diagnostics,
    onModuleDiagnostics(report) {
      diagnostics.recordModuleDiagnostics(report);
    },
    plugin: kovoAppShellViteDevPlugin(pluginOptions),
  };
}

function registerRequestDiagnosticStore(
  diagnostics: KovoAppShellDevDiagnosticLedger,
  requestRecords = new Map<string, KovoAppShellDevDiagnosticRecord>(),
): void {
  if (!requestDiagnosticStores.has(diagnostics)) {
    requestDiagnosticStores.set(diagnostics, { requestRecords });
  }
}

/**
 * Dispatch one dev request from the current Vite SSR module graph.
 *
 * @internal The installed Vite middleware reloads this function through ssrLoadModule for every
 * request. That keeps createApp()'s module-private closed-app proof, access metadata, and request
 * sinks in the same graph even after an app-shell HMR invalidation replaces framework modules.
 */
export async function dispatchKovoAppShellViteDevRequest(
  server: KovoAppShellViteDevModuleServer,
  options: KovoAppShellViteDevPluginOptions,
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
): Promise<void> {
  const moduleId = options.moduleId ?? '/src/app-shell.ts';
  const appExportName = options.appExportName ?? 'default';
  if (options.devDiagnostics) registerRequestDiagnosticStore(options.devDiagnostics);

  // SPEC §6.6 rule 6: preload the complete server root in this exact SSR graph before the app
  // graph. Runtime-specific controls such as command execution remain tree-shakeable in production
  // bundles, but an authored dependency cannot run first and influence their dev-time capture.
  await server.ssrLoadModule(kovoServerRootModuleId);
  const module = await server.ssrLoadModule(moduleId);
  const stylesheetAssets = readKovoAppShellViteDevStylesheetAssets(options.stylesheetAssets);
  const stylesheetResponse = renderKovoAppShellViteDevStylesheetAsset(request, stylesheetAssets);
  if (stylesheetResponse) {
    await writeWebResponseToNode(stylesheetResponse, response, request.method ?? 'GET');
    return;
  }

  const app = appWithDevDiagnostics(
    appWithDevStylesheetAssets(
      readKovoAppShellViteDevApp(module, appExportName, moduleId),
      stylesheetAssets,
    ),
    options.devDiagnostics,
  );
  const shouldHandle = shouldHandleKovoAppShellViteDevRequest(
    request,
    app,
    options.shouldHandleRequest,
  );
  if (!shouldHandle) {
    next();
    return;
  }

  const hmrResponse = renderKovoAppShellViteDevHmrResponse(app, request, options.devDiagnostics);
  if (hmrResponse) {
    await writeWebResponseToNode(await hmrResponse, response, request.method ?? 'GET');
    return;
  }

  const diagnosticResponse = renderKovoAppShellViteDevDiagnosticResponse(
    app,
    request,
    options.devDiagnostics,
  );
  if (diagnosticResponse) {
    await writeKovoAppShellViteDevRouteResponse(
      injectKovoHmrScriptIntoRouteResponse(diagnosticResponse),
      request,
      response,
    );
    return;
  }

  const devResponse = injectKovoHmrScriptIntoNodeResponse(response, request);
  readKovoAppShellViteDevNodeHandler(
    module,
    app,
    options,
    options.nodeHandlerExportName,
    moduleId,
  )(request, devResponse, next);
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
  let root = process.cwd();

  const install = (server: KovoAppShellViteDevModuleServer) => {
    root = server.config?.root ?? root;
    // The supported CLI installs this middleware before authored configureServer hooks. Pin the
    // exact SSR loader and expose only that fixed carrier to per-request dispatch: a later caller
    // hook may decorate its own server view, but cannot redirect framework/app loads to a second
    // module graph after the trust profile was established (SPEC §6.6 rule 6).
    const ssrLoadModule = server.ssrLoadModule.bind(server);
    const dispatchServer: KovoAppShellViteDevModuleServer = Object.freeze({
      ...(server.config === undefined ? {} : { config: server.config }),
      middlewares: server.middlewares,
      ssrLoadModule,
      ...(server.ws === undefined ? {} : { ws: server.ws }),
    });
    server.middlewares.use((request, response, next) => {
      Promise.resolve(ssrLoadModule(kovoAppShellViteDevModuleId))
        .then((serverModule) => {
          const dispatch = serverModule.dispatchKovoAppShellViteDevRequest;
          if (typeof dispatch !== 'function') {
            throw new TypeError(
              `${kovoAppShellViteDevModuleId} must export dispatchKovoAppShellViteDevRequest().`,
            );
          }
          return dispatch(dispatchServer, options, request, response, next);
        })
        .catch(next);
    });
  };

  return {
    configureServer(server) {
      root = server.config?.root ?? root;
      if (options.order === 'post') return () => install(server);
      install(server);
    },
    async handleHotUpdate(context) {
      const sourceFile = viteDevSourceFileName(context.file, root);
      if (sourceFile !== viteDevSourceFileName(moduleId, '')) return context.modules ?? [];
      context.server.ws?.send({
        data: {
          impact: 'routeRefresh',
          reasons: ['route-shell'],
          sourceFile,
        },
        event: 'kovo:route-shell',
        type: 'custom',
      });
      context.server.ws?.send({ type: 'full-reload' });
      return [];
    },
    name: options.name ?? 'kovo-app-shell-dev',
  };
}

function viteDevSourceFileName(file: string, root: string): string {
  const normalizedFile = file.split('?')[0]!.replaceAll('\\', '/').replace(/^\//, '');
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/$/, '').replace(/^\//, '');
  return normalizedRoot.length > 0 && normalizedFile.startsWith(`${normalizedRoot}/`)
    ? normalizedFile.slice(normalizedRoot.length + 1)
    : normalizedFile;
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

function renderKovoAppShellViteDevHmrResponse(
  app: KovoApp,
  request: IncomingMessage,
  diagnostics: KovoAppShellDevDiagnosticLedger | undefined,
): Promise<Response> | undefined {
  if (!request.url) return undefined;

  const url = new URL(request.url, 'http://kovo.local');
  if (url.pathname === kovoHmrClientPath) return Promise.resolve(renderKovoHmrClientResponse());
  if (url.pathname === kovoHmrRouteRefreshPath) {
    return renderKovoHmrRouteRefreshResponse(app, request, url, diagnostics);
  }
  if (url.pathname === kovoHmrLiveTargetRefreshPath) {
    return renderKovoHmrLiveTargetRefreshResponse(app, request, url);
  }

  return undefined;
}

function renderKovoHmrClientResponse(): Response {
  return createSecurityResponse(kovoHmrClientSource(), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/javascript; charset=utf-8',
    },
    status: 200,
  });
}

async function renderKovoHmrRouteRefreshResponse(
  app: KovoApp,
  request: IncomingMessage,
  endpointUrl: URL,
  diagnostics: KovoAppShellDevDiagnosticLedger | undefined,
): Promise<Response> {
  if (!requestMethodIs(request, 'GET', 'HEAD')) {
    return hmrRefreshTextResponse('Kovo HMR route refresh only accepts GET or HEAD.', 405, app, {
      refreshKind: 'route',
    });
  }

  const webRequest = nodeRequestToWebRequest(request);
  const targetUrl = hmrRefreshTargetUrl(endpointUrl, webRequest, request);
  if (securityIsResponse(targetUrl)) return targetUrl;

  const diagnosticResponse = renderKovoAppShellViteDevDiagnosticResponse(
    app,
    hmrTargetNodeRequest(request, targetUrl),
    diagnostics,
  );
  if (diagnosticResponse) {
    return withKovoHmrRefreshHeaders(
      routeResponseToWebResponse(injectKovoHmrScriptIntoRouteResponse(diagnosticResponse), {
        method: request.method ?? 'GET',
      }),
      app,
      'route',
      previousHmrBuildToken(endpointUrl, request),
    );
  }

  const routeResponse = await createRequestHandler(app)(
    new Request(targetUrl, { headers: webRequest.headers, method: 'GET' }),
  );

  return withKovoHmrRefreshHeaders(
    await injectKovoHmrScriptIntoWebResponse(routeResponse),
    app,
    'route',
    previousHmrBuildToken(endpointUrl, request),
  );
}

async function renderKovoHmrLiveTargetRefreshResponse(
  app: KovoApp,
  request: IncomingMessage,
  endpointUrl: URL,
): Promise<Response> {
  if (!requestMethodIs(request, 'GET', 'HEAD', 'POST')) {
    return hmrRefreshTextResponse(
      'Kovo HMR live-target refresh only accepts GET, HEAD, or POST.',
      405,
      app,
      {
        refreshKind: 'live-targets',
      },
    );
  }

  const wireHeaders = readMutationWireHeaders(request.headers);
  if (wireHeaders.liveTargetDescriptors.length === 0) {
    return hmrRefreshTextResponse(
      'Kovo HMR live-target refresh requires Kovo-Live-Targets.',
      400,
      app,
      {
        fallback: 'full-reload',
        refreshKind: 'live-targets',
      },
    );
  }

  const webRequest = nodeRequestToWebRequest(request);
  const targetUrl = hmrRefreshTargetUrl(endpointUrl, webRequest, request);
  if (securityIsResponse(targetUrl)) return targetUrl;

  const chunks = await renderLiveTargetChunks(
    app.liveTargetRenderers,
    wireHeaders.liveTargetDescriptors,
    {},
    new Request(targetUrl, { headers: webRequest.headers, method: 'GET' }),
    undefined,
  );

  if (chunks.length === 0) {
    return hmrRefreshTextResponse(
      'Kovo HMR live-target refresh found no matching renderers.',
      409,
      app,
      {
        fallback: 'full-reload',
        refreshKind: 'live-targets',
      },
    );
  }

  return createSecurityResponse(securityArrayJoin(chunks, '\n'), {
    headers: hmrRefreshHeaders(
      app,
      'live-targets',
      {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
      },
      previousHmrBuildToken(endpointUrl, request),
    ),
    status: 200,
  });
}

function hmrRefreshTargetUrl(
  endpointUrl: URL,
  request: Request,
  nodeRequest: IncomingMessage,
): URL | Response {
  const target =
    endpointUrl.searchParams.get('url') ??
    readHeader(nodeRequest.headers, 'Kovo-Current-Url') ??
    readHeader(nodeRequest.headers, 'Referer');
  if (!target) {
    return hmrRefreshTextResponse(
      'Kovo HMR refresh requires a current document URL.',
      400,
      undefined,
      {
        fallback: 'full-reload',
        refreshKind: 'route',
      },
    );
  }

  const targetUrl = new URL(target, request.url);
  if (targetUrl.origin !== new URL(request.url).origin || isKovoHmrRequest(targetUrl)) {
    return hmrRefreshTextResponse(
      'Kovo HMR refresh current document URL is not refreshable.',
      400,
      undefined,
      {
        fallback: 'full-reload',
        refreshKind: 'route',
      },
    );
  }

  return targetUrl;
}

function hmrTargetNodeRequest(request: IncomingMessage, targetUrl: URL): IncomingMessage {
  const targetRequest = Object.assign(
    Object.create(Object.getPrototypeOf(request)) as IncomingMessage,
    request,
  );
  targetRequest.method = 'GET';
  targetRequest.url = `${targetUrl.pathname}${targetUrl.search}`;
  return targetRequest;
}

function requestMethodIs(request: IncomingMessage, ...methods: readonly string[]): boolean {
  return methods.includes(request.method ?? 'GET');
}

function withKovoHmrRefreshHeaders(
  response: Response,
  app: KovoApp,
  refreshKind: 'live-targets' | 'route',
  previousBuildToken: string | undefined,
): Response {
  return createSecurityResponse(securityResponseBody(response), {
    headers: hmrRefreshHeaders(
      app,
      refreshKind,
      securityResponseHeaders(response),
      previousBuildToken,
    ),
    status: securityResponseStatus(response),
    statusText: securityResponseStatusText(response),
  });
}

function hmrRefreshTextResponse(
  message: string,
  status: 400 | 405 | 409,
  app: KovoApp | undefined,
  options: {
    fallback?: 'full-reload';
    refreshKind: 'live-targets' | 'route';
  },
): Response {
  const headers = hmrRefreshHeaders(app, options.refreshKind, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  if (options.fallback) securityHeadersSet(headers, 'Kovo-HMR-Fallback', options.fallback);

  return createSecurityResponse(message, { headers, status });
}

function hmrRefreshHeaders(
  app: KovoApp | undefined,
  refreshKind: 'live-targets' | 'route' | undefined,
  initialHeaders: HeadersInit = {},
  previousBuildToken?: string,
): Headers {
  const headers = createSecurityHeaders(initialHeaders);
  const buildToken = app?.clientModules.buildToken() ?? '';

  if (refreshKind) securityHeadersSet(headers, 'Kovo-HMR-Refresh', refreshKind);
  if (buildToken !== '') securityHeadersSet(headers, 'Kovo-Build', buildToken);
  if (previousBuildToken) securityHeadersSet(headers, 'Kovo-Previous-Build', previousBuildToken);

  return headers;
}

function previousHmrBuildToken(endpointUrl: URL, request: IncomingMessage): string | undefined {
  return (
    endpointUrl.searchParams.get('oldBuild') ??
    endpointUrl.searchParams.get('build') ??
    readHeader(request.headers, 'Kovo-Build')
  );
}

function injectKovoHmrScriptIntoRouteResponse(response: RoutePageResponse): RoutePageResponse {
  if (
    typeof response.body !== 'string' ||
    !shouldInjectKovoHmrScript(
      response.status,
      readHeader(response.headers, 'Content-Type'),
      response.body,
    )
  ) {
    return response;
  }

  return {
    ...response,
    body: injectKovoHmrScript(response.body),
  };
}

async function injectKovoHmrScriptIntoWebResponse(response: Response): Promise<Response> {
  const responseHeaders = securityResponseHeaders(response);
  const contentType = securityHeadersGet(responseHeaders, 'Content-Type');
  const status = securityResponseStatus(response);
  if (!shouldInjectKovoHmrScript(status, contentType, null)) return response;

  const headers = createSecurityHeaders(responseHeaders);
  securityHeadersDelete(headers, 'content-length');

  return createSecurityResponse(injectKovoHmrScript(await securityResponseText(response)), {
    headers,
    status,
    statusText: securityResponseStatusText(response),
  });
}

function injectKovoHmrScriptIntoNodeResponse(
  response: ServerResponse,
  request: IncomingMessage,
): ServerResponse {
  if (request.method === 'HEAD') return response;
  if (isKovoFragmentOrQueryReadRequest(request)) return response;

  const chunks: Buffer[] = [];
  const write = Reflect.get(response, 'write') as ServerResponse['write'];
  const writeHead = Reflect.get(response, 'writeHead') as ServerResponse['writeHead'];
  const end = Reflect.get(response, 'end') as ServerResponse['end'];

  response.writeHead = function writeHeadPatched(
    statusCode: number,
    statusMessageOrHeaders?: string | Record<string, number | readonly string[] | string>,
    headers?: Record<string, number | readonly string[] | string>,
  ): ServerResponse {
    response.statusCode = statusCode;
    if (typeof statusMessageOrHeaders === 'string') {
      response.statusMessage = statusMessageOrHeaders;
      setNodeResponseHeaders(response, headers);
    } else {
      setNodeResponseHeaders(response, statusMessageOrHeaders);
    }
    return response;
  } as ServerResponse['writeHead'];

  response.write = function writePatched(
    chunk: unknown,
    encodingOrCallback?: BufferEncoding | ((error?: Error) => void),
    callback?: (error?: Error) => void,
  ): boolean {
    appendNodeResponseChunk(chunks, chunk, encodingOrCallback);
    if (typeof encodingOrCallback === 'function') encodingOrCallback();
    else callback?.();
    return true;
  } as ServerResponse['write'];

  response.end = function endPatched(
    chunk?: unknown,
    encodingOrCallback?: BufferEncoding | (() => void),
    callback?: () => void,
  ): ServerResponse {
    appendNodeResponseChunk(chunks, chunk, encodingOrCallback);
    response.write = write;
    response.writeHead = writeHead;
    response.end = end;

    const contentType = String(response.getHeader('Content-Type') ?? '');
    const status = response.statusCode;
    const body = Buffer.concat(chunks).toString('utf8');
    const nextBody = shouldInjectKovoHmrScript(status, contentType, body)
      ? injectKovoHmrScript(body)
      : body;
    if (nextBody !== body) response.removeHeader('Content-Length');

    const writeEnd = end as unknown as (
      this: ServerResponse,
      chunk: string,
      encodingOrCallback?: BufferEncoding | (() => void),
      callback?: () => void,
    ) => ServerResponse;
    if (typeof encodingOrCallback === 'function') {
      return writeEnd.call(response, nextBody, encodingOrCallback);
    }
    return writeEnd.call(response, nextBody, encodingOrCallback, callback);
  } as ServerResponse['end'];

  return response;
}

function setNodeResponseHeaders(
  response: ServerResponse,
  headers: Record<string, number | readonly string[] | string> | undefined,
): void {
  for (const [name, value] of Object.entries(headers ?? {})) response.setHeader(name, value);
}

function appendNodeResponseChunk(
  chunks: Buffer[],
  chunk: unknown,
  encodingOrCallback: BufferEncoding | ((error?: Error) => void) | (() => void) | undefined,
): void {
  if (chunk === undefined || chunk === null) return;
  if (Buffer.isBuffer(chunk)) {
    chunks.push(chunk);
    return;
  }
  if (chunk instanceof Uint8Array) {
    chunks.push(Buffer.from(chunk));
    return;
  }
  if (typeof chunk !== 'string') return;
  chunks.push(
    Buffer.from(chunk, typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8'),
  );
}

function shouldInjectKovoHmrScript(
  status: number,
  contentType: string | null | undefined,
  body: unknown,
): boolean {
  if (status < 200 || status >= 600) return false;
  if (typeof body === 'string' && securityStringIncludes(body, kovoHmrClientPath)) return false;
  return securityStringIncludes(securityStringToLowerCase(contentType ?? ''), 'text/html');
}

function isKovoFragmentOrQueryReadRequest(request: IncomingMessage): boolean {
  // SPEC §9.4 / §9.5.1: dev HMR injection is for full documents; fragment and typed-read
  // HTML chunks are app-shell wire responses and must stay inspectable as emitted.
  const fragment = readHeader(request.headers, 'Kovo-Fragment');
  if (fragment !== undefined && securityStringToLowerCase(fragment) === 'true') return true;
  if (!request.url) return false;
  return securityStringStartsWith(new URL(request.url, 'http://kovo.local').pathname, '/_q/');
}

function injectKovoHmrScript(html: string): string {
  if (securityStringIncludes(html, kovoHmrClientPath)) return html;
  const closingHead = '</head>';
  const closingHeadIndex = securityStringIndexOf(html, closingHead);
  if (closingHeadIndex >= 0) {
    return `${securityStringSlice(html, 0, closingHeadIndex)}${kovoHmrClientScript}${securityStringSlice(html, closingHeadIndex)}`;
  }
  return `${kovoHmrClientScript}${html}`;
}

function kovoHmrClientSource(): string {
  return String.raw`
import { createHotContext } from "/@vite/client";

const hot = createHotContext("${kovoHmrClientPath}");
const reload = () => location.reload();
const qa = (root, selector) => root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
const rd = (value) => (value || "").split(/[\s,]+/).map((dep) => dep.trim()).filter(Boolean);
const targetIdentity = (el) => el.getAttribute("kovo-fragment-target") || el.id || el.getAttribute("kovo-c") || "";
const liveTargetIdentity = (el) => el.getAttribute("kovo-live-component") || el.getAttribute("kovo-c") || targetIdentity(el);
const safeHeaderToken = (value) => value && !/[\x00-\x1f\x7f\s;,#=]/.test(value);
const safeComponent = (value) => safeHeaderToken(value) && !value.includes(":");
const liveProps = (el) => {
  try {
    const props = JSON.parse(el.getAttribute("kovo-props") || "{}");
    return props && typeof props === "object" && !Array.isArray(props) ? props : {};
  } catch {
    return {};
  }
};
const currentBuild = () => document.querySelector('meta[name="kovo-build"]')?.getAttribute("content") || "";
const liveTargets = () => {
  const seen = new Set();
  const targets = [];
  for (const el of qa(document, "[kovo-deps]")) {
    const target = targetIdentity(el);
    const component = liveTargetIdentity(el);
    const token = el.getAttribute("kovo-live-token");
    if (!safeHeaderToken(target) || !safeComponent(component) || !safeHeaderToken(token)) continue;
    if (!target || seen.has(target)) continue;
    seen.add(target);
    targets.push(target + "#" + component + "@" + token + ":" + JSON.stringify(liveProps(el)));
  }
  return targets;
};
const dependencyTargets = () => [
  ...new Set(
    qa(document, "[kovo-deps]")
      .map((el) => {
        const target = targetIdentity(el);
        const deps = rd(el.getAttribute("kovo-deps"));
        if (!safeHeaderToken(target) || !deps.every(safeHeaderToken)) return "";
        return target && (deps.length ? target + "=" + deps.join(" ") : target);
      })
      .filter(Boolean),
  ),
];

async function refreshLiveTargets(event) {
  const apply = globalThis.__kovo_a;
  const live = liveTargets();
  if (typeof apply !== "function" || live.length === 0) return reload();

  const url = new URL("${kovoHmrLiveTargetRefreshPath}", location.href);
  url.searchParams.set("url", location.href);
  const build = currentBuild();
  if (build) url.searchParams.set("oldBuild", build);
  if (event?.oldFactHash) url.searchParams.set("oldFactHash", event.oldFactHash);

  const response = await fetch(url, {
    headers: {
      "Kovo-Current-Url": location.href,
      "Kovo-Fragment": "true",
      "Kovo-Live-Targets": live.join(","),
      "Kovo-Targets": dependencyTargets().join(";"),
    },
    method: "POST",
  });

  const previousBuild = response.headers.get("Kovo-Previous-Build") || "";
  const nextBuild = response.headers.get("Kovo-Build") || "";
  if (!response.ok || (previousBuild && currentBuild() && previousBuild !== currentBuild())) {
    return reload();
  }

  apply(await response.text());
  if (nextBuild) {
    const meta = document.querySelector('meta[name="kovo-build"]');
    meta?.setAttribute("content", nextBuild);
  }
}

hot.on("kovo:component-render", (event) => {
  refreshLiveTargets(event).catch(reload);
});
async function refreshRoute() {
  const url = new URL("${kovoHmrRouteRefreshPath}", location.href);
  url.searchParams.set("url", location.href);
  const build = currentBuild();
  if (build) url.searchParams.set("oldBuild", build);
  const response = await fetch(url, {
    headers: {
      Accept: "text/html",
      "Kovo-Current-Url": location.href,
    },
  });
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("text/html")) return reload();
  document.open();
  document.write(await response.text());
  document.close();
}
hot.on("kovo:diagnostics", () => {
  refreshRoute().catch(reload);
});
hot.on("kovo:route-shell", reload);
hot.on("kovo:full-reload", reload);
`;
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
  if (isKovoHmrRequest(url)) return true;
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
  if (isKovoHmrRequest(url)) return true;
  if (isUnversionedKovoAppShellClientModuleRequest(url)) return false;

  return shouldHandleRequest?.(request, app) ?? shouldHandleKovoAppShellViteRequest(request, app);
}

function isKovoHmrRequest(url: URL): boolean {
  return (
    url.pathname === kovoHmrClientPath ||
    url.pathname === kovoHmrRouteRefreshPath ||
    url.pathname === kovoHmrLiveTargetRefreshPath
  );
}

function isUnversionedKovoAppShellClientModuleRequest(url: URL): boolean {
  // SPEC §9.5 reserves immutable app-shell client modules as versioned /c/ URLs.
  // During Vite dev, unversioned /c/ URLs must keep falling through to Vite's
  // asset/middleware stack instead of being claimed by app replay.
  return (
    url.pathname.startsWith('/c/') &&
    !url.pathname.startsWith('/c/__v/') &&
    !url.searchParams.has('v')
  );
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
  const requestRecord = requestDiagnosticForHref(diagnostics, url.pathname + url.search);
  if (requestRecord) return renderDiagnosticDocumentForRecord(requestRecord);

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
        html: generatedFragmentHtml(document.body),
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

function normalizedRequestHref(href: string): string {
  const url = new URL(href, 'http://kovo.local');
  return `${slashPath(url.pathname)}${url.search}`;
}

function requestDiagnosticForHref(
  diagnostics: KovoAppShellDevDiagnosticLedger,
  href: string,
): KovoAppShellDevDiagnosticRecord | undefined {
  return requestDiagnosticStores.get(diagnostics)?.requestRecords.get(normalizedRequestHref(href));
}

function recordRequestDiagnostic(
  diagnostics: KovoAppShellDevDiagnosticLedger,
  record: KovoAppShellDevRequestDiagnostics,
): void {
  const store = requestDiagnosticStores.get(diagnostics);
  if (!store || !record.diagnostics.some(isErrorDiagnostic)) return;

  const href = normalizedRequestHref(record.href);
  store.requestRecords.set(href, {
    diagnostics: record.diagnostics,
    fileName: href,
    ...(record.source === undefined ? {} : { source: record.source }),
  });
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

  // SPEC.md §9.5 dev HMR injection buffers the Node response as text before writing it.
  // Keep this path unencoded; the production/default Node adapter still compresses by default.
  const nodeOptions = {
    compression: false,
    ...(options.earlyHints === undefined ? {} : { earlyHints: options.earlyHints }),
  };
  const nodeHandler = toNodeHandler(createRequestHandler(app), nodeOptions);
  return (request, response) => nodeHandler(request, response);
}

function appWithDevDiagnostics(
  app: KovoApp,
  diagnostics: KovoAppShellDevDiagnosticLedger | undefined,
): KovoApp {
  return deriveClosedKovoApp(app, {
    onError(error, context) {
      const requestDiagnostic = endpointPostureRequestDiagnostic(error, context);
      if (requestDiagnostic && diagnostics) recordRequestDiagnostic(diagnostics, requestDiagnostic);
      if (!requestDiagnostic) reportDevServerError(error, context);

      const result = app.onError?.(error, context);
      if (result && typeof result === 'object' && 'then' in result) {
        void result.catch((_error) => undefined);
      }
    },
  });
}

function reportDevServerError(error: unknown, context: ServerErrorDiagnosticContext): void {
  const details = [
    `[kovo dev] ${context.operation} failed`,
    context.routePath ? `route=${context.routePath}` : undefined,
    context.mutationKey ? `mutation=${context.mutationKey}` : undefined,
    context.queryKey ? `query=${context.queryKey}` : undefined,
    context.url ? `url=${context.url}` : undefined,
    context.status ? `status=${context.status}` : undefined,
  ].filter((detail): detail is string => detail !== undefined);
  console.error(...scrubConsoleArgs([details.join(' '), error]));
}

function endpointPostureRequestDiagnostic(
  error: unknown,
  context: ServerErrorDiagnosticContext,
): KovoAppShellDevRequestDiagnostics | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes('response posture mismatch')) return undefined;

  const href = context.url ?? requestHrefFromContext(context.request) ?? '/';
  return {
    diagnostics: [
      {
        code: 'KV423',
        help:
          'Raw endpoint response posture is executable audit metadata in development. ' +
          'Make the declared response cache/body posture match the returned Response headers, ' +
          'or update the endpoint declaration when the drift is intentional.',
        message,
      },
    ],
    href,
  };
}

function requestHrefFromContext(request: unknown): string | undefined {
  if (!(request instanceof Request)) return undefined;
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function readKovoAppShellViteDevStylesheetAssets(
  value: KovoAppShellViteDevPluginOptions['stylesheetAssets'],
): KovoAppShellViteDevStylesheetAssets | undefined {
  return typeof value === 'function' ? value() : value;
}

function renderKovoAppShellViteDevStylesheetAsset(
  request: IncomingMessage,
  assets: KovoAppShellViteDevStylesheetAssets | undefined,
): Response | undefined {
  if (!assets) return undefined;
  if ((request.method ?? 'GET') !== 'GET' && request.method !== 'HEAD') return undefined;

  const href = request.url ? new URL(request.url, 'http://kovo.local').pathname : undefined;
  if (!href) return undefined;
  const asset = devStylesheetAssets(assets).find((candidate) => candidate.href === href);
  if (!asset?.criticalCss) return undefined;

  return createSecurityResponse(asset.criticalCss, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/css; charset=utf-8',
    },
    status: 200,
  });
}

function devStylesheetAssets(
  assets: KovoAppShellViteDevStylesheetAssets,
): readonly StylesheetAsset[] {
  return [
    ...(assets.app ?? []),
    ...Object.values(assets.routes ?? {}).flat(),
    ...Object.values(assets.fragments ?? {}).flat(),
  ].filter((asset): asset is StylesheetAsset => typeof asset !== 'string');
}

function appWithDevStylesheetAssets(
  app: KovoApp,
  assets: KovoAppShellViteDevStylesheetAssets | undefined,
): KovoApp {
  if (!assets) return app;
  const appAssets = assets.app ?? [];
  const routeAssets = assets.routes ?? {};
  const fragmentAssets = assets.fragments ?? {};

  if (
    appAssets.length === 0 &&
    Object.keys(routeAssets).length === 0 &&
    Object.keys(fragmentAssets).length === 0
  ) {
    return app;
  }

  return deriveClosedKovoApp(app, {
    liveTargetRenderers: app.liveTargetRenderers.map((renderer) => {
      const stylesheets = fragmentAssets[renderer.component] ?? [];
      if (stylesheets.length === 0) return renderer;

      return {
        ...renderer,
        stylesheets: mergeDevStylesheetAssets([...(renderer.stylesheets ?? []), ...stylesheets]),
      };
    }),
    routes: app.routes.map((route) => {
      const stylesheets = routeAssets[route.path] ?? [];
      if (stylesheets.length === 0) return route;

      return {
        ...route,
        stylesheets: mergeDevStylesheetAssets([...(route.stylesheets ?? []), ...stylesheets]),
      };
    }),
    stylesheets: mergeDevStylesheetAssets([...app.stylesheets, ...appAssets]),
  });
}

function mergeDevStylesheetAssets(
  assets: readonly (string | StylesheetAsset)[],
): (string | StylesheetAsset)[] {
  const byHref = new Map<string, string[]>();
  const hrefOrder: string[] = [];
  for (const asset of assets) {
    const href = typeof asset === 'string' ? asset : asset.href;
    if (!byHref.has(href)) hrefOrder.push(href);
    const chunks = byHref.get(href) ?? [];
    if (typeof asset !== 'string' && asset.criticalCss) chunks.push(asset.criticalCss);
    byHref.set(href, chunks);
  }

  return hrefOrder.map((href) => {
    const criticalCss = (byHref.get(href) ?? [])
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .join('\n');
    return {
      ...(criticalCss ? { criticalCss } : {}),
      href,
    };
  });
}

function isKovoAppShellViteDevNodeHandler(value: unknown): value is NodeRequestHandler {
  // SPEC §9.5 keeps the public handler currency as Request -> Response; this
  // optional dev hook is only for the adapter edge and must be a Node handler.
  return typeof value === 'function' && value.length >= 2;
}

function slashPath(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}
