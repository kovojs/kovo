import {
  ServerResponse as NativeServerResponse,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { isKovoApp } from './app-guards.js';
import { deriveClosedKovoApp } from './app-snapshot.js';
import { runWithGeneratedLiveTargetRegistry } from './live-target-registry.js';
import { createRequestHandler } from './app.js';
import type { KovoApp } from './app-types.js';
import {
  copyRequestServerBindings,
  pinRequestIngressSurface,
  resolveRequestClientIp,
} from './app-load-shed.js';
import { searchParamsToRecord } from './app-document.js';
import {
  appLiveTargetAttestationAudience,
  appLiveTargetAttestationAuthority,
} from './live-target-app-identity.js';
import {
  renderDiagnosticDocument,
  type DiagnosticDocumentDiagnostic,
} from './document-diagnostics.js';
import { snapshotStylesheetAsset, type StylesheetAsset } from './hints.js';
import {
  nodeRequestToWebRequest,
  toNodeHandler,
  writeWebResponseToNode,
  type NodeRequestHandler,
} from './node.js';
import { renderLiveTargetChunks } from './mutation.js';
import { mutationWireRequestFromHeaders } from './mutation-wire.js';
import { readHeader, routeResponseToWebResponse, type RoutePageResponse } from './response.js';
import { authorizeRouteRequest } from './route.js';
import { matchShellDispatch } from './shell.js';
import { generatedFragmentHtml } from './html.js';
import { renderFragmentWireHtml } from './wire-html.js';
import type { ServerErrorDiagnosticContext } from './diagnostics.js';
import { scrubConsoleArgs } from './logging.js';
import {
  requestCreateUrl,
  requestHeaders,
  requestIsRequest,
  requestUrl,
  requestUrlSearchParamsEntries,
  requestUrlSnapshot,
  type RequestUrlSnapshot,
} from './request-body-intrinsics.js';
import {
  createSecurityMap,
  createSecurityNullRecord,
  createSecurityObject,
  createSecuritySet,
  createSecurityHeaders,
  createSecurityResponse,
  securityArrayIsArray,
  securityArrayJoin,
  securityArrayPush,
  securityBufferConcat,
  securityBufferFrom,
  securityBufferToString,
  securityHeadersDelete,
  securityHeadersForEach,
  securityHeadersGet,
  securityHeadersSet,
  securityIsResponse,
  securityIsUint8Array,
  securityMapDelete,
  securityMapGet,
  securityMapHas,
  securityMapSet,
  securityNumberIsInteger,
  securityPromiseResolve,
  securityPromiseThen,
  securityRegExpReplace,
  securityResponseBody,
  securityResponseHeaders,
  securityResponseStatus,
  securityResponseStatusText,
  securityResponseText,
  securitySetAdd,
  securitySetHas,
  securityString,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringReplaceAll,
  securityStringSlice,
  securityStringStartsWith,
  securityStringToLowerCase,
  securityStringTrim,
} from './response-security-intrinsics.js';
import {
  createWitnessWeakMap,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessObjectIs,
  witnessOwnKeys,
  witnessReflectApply,
  witnessReflectGet,
  witnessWeakMapGet,
  witnessWeakMapHas,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import { createNativeRequest } from './request-carrier.js';
import { sourceDocumentHeaderIsRetained } from './source-document-headers.js';

const kovoHmrClientPath = '/@kovo/hmr-client';
const kovoHmrRouteRefreshPath = '/@kovo/hmr/refresh/route';
const kovoHmrLiveTargetRefreshPath = '/@kovo/hmr/refresh/live-targets';
const kovoHmrClientScript = `<script type="module" src="${kovoHmrClientPath}"></script>`;
const kovoAppShellViteDevModuleId = '@kovojs/server/internal/app-shell-vite';
const kovoServerRootModuleId = '@kovojs/server';
const viteDevNodeResponseEnd = captureViteDevNodeResponseMethod('end');
const viteDevNodeResponseGetHeader = captureViteDevNodeResponseMethod('getHeader');
const viteDevNodeResponseRemoveHeader = captureViteDevNodeResponseMethod('removeHeader');
const viteDevNodeResponseSetHeader = captureViteDevNodeResponseMethod('setHeader');
const viteDevNodeResponseWrite = captureViteDevNodeResponseMethod('write');
const viteDevNodeResponseWriteHead = captureViteDevNodeResponseMethod('writeHead');

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

const requestDiagnosticStores = createWitnessWeakMap<
  KovoAppShellDevDiagnosticLedger,
  KovoAppShellDevRequestDiagnosticStore
>();

/**
 * @internal App-shell Vite dev/host internal (SPEC.md §9.5). Creates the dev diagnostic
 * ledger that maps failed modules to teaching diagnostic responses.
 * Exported only for in-repo build/host config, not app authors.
 */
export function createKovoAppShellDevDiagnosticLedger(): KovoAppShellDevDiagnosticLedger {
  const allModuleRecords = createSecurityMap<string, KovoAppShellDevDiagnosticRecord>();
  const allHrefToFileName = createSecurityMap<string, string>();
  const moduleRecords = createSecurityMap<string, KovoAppShellDevDiagnosticRecord>();
  const hrefToFileName = createSecurityMap<string, string>();
  const requestRecords = createSecurityMap<string, KovoAppShellDevDiagnosticRecord>();

  const ledger: KovoAppShellDevDiagnosticLedger = {
    allDiagnosticsForFile(fileName) {
      return securityMapGet(allModuleRecords, slashPath(fileName));
    },
    allDiagnosticsForModuleHref(href) {
      const fileName = securityMapGet(allHrefToFileName, normalizedModuleHref(href));
      return fileName === undefined ? undefined : securityMapGet(allModuleRecords, fileName);
    },
    diagnosticsForModuleHref(href) {
      const fileName = securityMapGet(hrefToFileName, normalizedModuleHref(href));
      return fileName === undefined ? undefined : securityMapGet(moduleRecords, fileName);
    },
    recordModuleDiagnostics(record) {
      const fileName = slashPath(record.fileName);
      clearModuleRecord(fileName, allModuleRecords, allHrefToFileName);
      clearModuleRecord(fileName, moduleRecords, hrefToFileName);

      const diagnostics = viteDevDenseArrayValues<DiagnosticDocumentDiagnostic>(
        record.diagnostics,
        'Vite dev module diagnostics',
      );
      const moduleHrefs =
        record.moduleHrefs === undefined
          ? undefined
          : viteDevDenseArrayValues<string>(record.moduleHrefs, 'Vite dev module diagnostic hrefs');
      const nextRecord: KovoAppShellDevDiagnosticRecord = witnessFreeze({
        diagnostics: witnessFreeze(diagnostics),
        fileName,
        ...(moduleHrefs === undefined ? {} : { moduleHrefs: witnessFreeze(moduleHrefs) }),
        ...(record.source === undefined ? {} : { source: record.source }),
      });
      securityMapSet(allModuleRecords, fileName, nextRecord);
      const allHrefs = moduleDiagnosticHrefs(nextRecord);
      for (let index = 0; index < allHrefs.length; index += 1) {
        securityMapSet(allHrefToFileName, normalizedModuleHref(allHrefs[index]!), fileName);
      }

      if (!hasErrorDiagnostic(diagnostics)) return;

      securityMapSet(moduleRecords, fileName, nextRecord);

      for (let index = 0; index < allHrefs.length; index += 1) {
        securityMapSet(hrefToFileName, normalizedModuleHref(allHrefs[index]!), fileName);
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
  requestRecords = createSecurityMap<string, KovoAppShellDevDiagnosticRecord>(),
): void {
  if (!witnessWeakMapHas(requestDiagnosticStores, diagnostics)) {
    witnessWeakMapSet(requestDiagnosticStores, diagnostics, { requestRecords });
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
  const module = await runWithGeneratedLiveTargetRegistry(() => server.ssrLoadModule(moduleId));
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
    const ssrLoadModuleSource = viteDevStableCallable(
      server,
      'ssrLoadModule',
      'Vite dev server.ssrLoadModule',
    );
    const ssrLoadModule = (id: string): Promise<Record<string, unknown>> =>
      witnessReflectApply(ssrLoadModuleSource, server, [id]);
    const dispatchServer: KovoAppShellViteDevModuleServer = witnessFreeze({
      ...(server.config === undefined ? {} : { config: server.config }),
      middlewares: server.middlewares,
      ssrLoadModule,
      ...(server.ws === undefined ? {} : { ws: server.ws }),
    });
    server.middlewares.use((request, response, next) => {
      const loaded = securityPromiseResolve(ssrLoadModule(kovoAppShellViteDevModuleId));
      const dispatched = securityPromiseThen(loaded, (serverModule) => {
        const dispatch = viteDevModuleExportValue(
          serverModule,
          'dispatchKovoAppShellViteDevRequest',
          `${kovoAppShellViteDevModuleId} dispatch export`,
        );
        if (typeof dispatch !== 'function') {
          throw new TypeError(
            `${kovoAppShellViteDevModuleId} must export dispatchKovoAppShellViteDevRequest().`,
          );
        }
        return witnessReflectApply(dispatch, undefined, [
          dispatchServer,
          options,
          request,
          response,
          next,
        ]);
      });
      void securityPromiseThen(dispatched, () => undefined, next);
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
  const queryIndex = securityStringIndexOf(file, '?');
  const fileWithoutQuery = queryIndex === -1 ? file : securityStringSlice(file, 0, queryIndex);
  const normalizedFile = securityRegExpReplace(
    securityStringReplaceAll(fileWithoutQuery, '\\', '/'),
    /^\//,
    '',
  );
  const normalizedRoot = securityRegExpReplace(
    securityRegExpReplace(securityStringReplaceAll(root, '\\', '/'), /\/$/, ''),
    /^\//,
    '',
  );
  return normalizedRoot.length > 0 && securityStringStartsWith(normalizedFile, `${normalizedRoot}/`)
    ? securityStringSlice(normalizedFile, normalizedRoot.length + 1)
    : normalizedFile;
}

function viteDevUrlSnapshot(value: string, base?: string): RequestUrlSnapshot {
  return requestUrlSnapshot(requestCreateUrl(value, base));
}

function viteDevUrlSearchParam(url: RequestUrlSnapshot, name: string): string | null {
  const entries = requestUrlSearchParamsEntries(url.searchParams);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry[0] === name) return entry[1];
  }
  return null;
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

  const url = viteDevUrlSnapshot(request.url, 'http://kovo.local');
  if (url.pathname === kovoHmrClientPath) {
    return securityPromiseResolve(renderKovoHmrClientResponse());
  }
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
  endpointUrl: RequestUrlSnapshot,
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

  const routeResponse = await createRequestHandler(app)(hmrTargetWebRequest(webRequest, targetUrl));

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
  endpointUrl: RequestUrlSnapshot,
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

  const webRequest = nodeRequestToWebRequest(request);
  const targetUrl = hmrRefreshTargetUrl(endpointUrl, webRequest, request);
  if (securityIsResponse(targetUrl)) return targetUrl;
  const routeMatch = matchShellDispatch({
    endpoints: app.endpoints,
    method: 'GET',
    pathname: targetUrl.pathname,
    routes: app.routes,
  });
  if (
    routeMatch.kind !== 'route' ||
    !routeMatch.methodAllowed ||
    routeMatch.normalization.redirect !== undefined
  ) {
    return hmrRefreshTextResponse(
      'Kovo HMR live-target refresh requires a canonical app route.',
      409,
      app,
      {
        fallback: 'full-reload',
        refreshKind: 'live-targets',
      },
    );
  }

  const targetRequest = hmrTargetWebRequest(webRequest, targetUrl);
  const authorization = await authorizeRouteRequest(
    routeMatch.route,
    {
      params: routeMatch.params,
      search: searchParamsToRecord(targetUrl.searchParams),
    },
    targetRequest,
    {
      clientIp: (candidate) => resolveRequestClientIp(app, candidate),
      ...(app.db === undefined ? {} : { db: app.db }),
      ...(app.onError === undefined ? {} : { onError: app.onError }),
      ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
    },
  );
  if (!authorization.ok) {
    return hmrRefreshTextResponse(
      authorization.failure.error?.code === 'UNAUTHORIZED'
        ? 'Kovo HMR live-target refresh was forbidden by the target route.'
        : 'Kovo HMR live-target refresh could not authorize the target route.',
      authorization.failure.error?.code === 'UNAUTHORIZED' ? 403 : 409,
      app,
      {
        fallback: 'full-reload',
        refreshKind: 'live-targets',
      },
    );
  }

  const buildToken = app.clientModules.buildToken();
  const liveTargetAudience = appLiveTargetAttestationAudience(app, buildToken);
  const liveTargetAttestationAuthority = appLiveTargetAttestationAuthority(app, buildToken);
  // Dev HMR is still an HTTP authority boundary. Verify the browser descriptor against the exact
  // app/build, source route, and authorized principal before any generated renderer can run a
  // query (SPEC §§6.6, 8, 9.3, 9.5.1).
  const wireRequest = mutationWireRequestFromHeaders({
    buildToken,
    liveTargetAttestationAuthority,
    liveTargetAudience,
    liveTargetSourceUrl: targetUrl.href,
    ...(app.csrf === undefined ? {} : { csrf: app.csrf }),
    headers: request.headers,
    liveTargetRenderers: app.liveTargetRenderers,
    rawInput: {},
    request: authorization.request,
  });
  const liveTargetDescriptors = wireRequest.liveTargetDescriptors ?? [];
  if (liveTargetDescriptors.length === 0) {
    return hmrRefreshTextResponse(
      'Kovo HMR live-target refresh requires an attested Kovo-Live-Targets descriptor.',
      400,
      app,
      {
        fallback: 'full-reload',
        refreshKind: 'live-targets',
      },
    );
  }

  const chunks = await renderLiveTargetChunks(
    app.liveTargetRenderers,
    liveTargetDescriptors,
    liveTargetAudience,
    liveTargetAttestationAuthority,
    {},
    authorization.request,
    app.csrf,
    app.requestLimits.maxQueryListItems,
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
  endpointUrl: RequestUrlSnapshot,
  request: Request,
  nodeRequest: IncomingMessage,
): RequestUrlSnapshot | Response {
  const target =
    viteDevUrlSearchParam(endpointUrl, 'url') ??
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

  const requestHref = requestUrl(request);
  const targetUrl = viteDevUrlSnapshot(target, requestHref);
  if (targetUrl.origin !== viteDevUrlSnapshot(requestHref).origin || isKovoHmrRequest(targetUrl)) {
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

function hmrTargetNodeRequest(
  request: IncomingMessage,
  targetUrl: RequestUrlSnapshot,
): IncomingMessage {
  const targetRequest = createSecurityObject<IncomingMessage>(witnessGetPrototypeOf(request));
  const keys = witnessOwnKeys(request);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(request, key);
    if (descriptor === undefined || descriptor.enumerable !== true) continue;
    if (!('value' in descriptor)) {
      throw new TypeError('Vite dev HMR node request must expose own data fields.');
    }
    witnessDefineProperty(targetRequest, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  witnessDefineProperty(targetRequest, 'method', {
    configurable: true,
    enumerable: true,
    value: 'GET',
    writable: true,
  });
  witnessDefineProperty(targetRequest, 'url', {
    configurable: true,
    enumerable: true,
    value: `${targetUrl.pathname}${targetUrl.search}`,
    writable: true,
  });
  return targetRequest;
}

function hmrTargetWebRequest(request: Request, targetUrl: RequestUrlSnapshot): Request {
  const headers = createSecurityHeaders();
  securityHeadersForEach(requestHeaders(request), (value, name) => {
    if (sourceDocumentHeaderIsRetained(name)) securityHeadersSet(headers, name, value);
  });
  securityHeadersSet(headers, 'Accept', 'text/html');
  const targetRequest = createNativeRequest(targetUrl.href, { headers, method: 'GET' });
  // Preserve only adapter-installed peer/DB bindings. The source document owns its URL, method,
  // and header authority; HMR control headers must never reach guards, queries, or renderers.
  copyRequestServerBindings(request, targetRequest);
  pinRequestIngressSurface(targetRequest);
  return targetRequest;
}

function requestMethodIs(request: IncomingMessage, ...methods: readonly string[]): boolean {
  const method = request.method ?? 'GET';
  for (let index = 0; index < methods.length; index += 1) {
    if (methods[index] === method) return true;
  }
  return false;
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
  status: 400 | 403 | 405 | 409,
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

function previousHmrBuildToken(
  endpointUrl: RequestUrlSnapshot,
  request: IncomingMessage,
): string | undefined {
  return (
    viteDevUrlSearchParam(endpointUrl, 'oldBuild') ??
    viteDevUrlSearchParam(endpointUrl, 'build') ??
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
  witnessDefineProperty(response, 'writeHead', {
    configurable: true,
    enumerable: false,
    value: function writeHeadPatched(
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
    } as ServerResponse['writeHead'],
    writable: true,
  });

  witnessDefineProperty(response, 'write', {
    configurable: true,
    enumerable: false,
    value: function writePatched(
      chunk: unknown,
      encodingOrCallback?: BufferEncoding | ((error?: Error) => void),
      callback?: (error?: Error) => void,
    ): boolean {
      appendNodeResponseChunk(chunks, chunk, encodingOrCallback);
      if (typeof encodingOrCallback === 'function') {
        witnessReflectApply(encodingOrCallback, undefined, []);
      } else if (callback !== undefined) {
        witnessReflectApply(callback, undefined, []);
      }
      return true;
    } as ServerResponse['write'],
    writable: true,
  });

  witnessDefineProperty(response, 'end', {
    configurable: true,
    enumerable: false,
    value: function endPatched(
      chunk?: unknown,
      encodingOrCallback?: BufferEncoding | (() => void),
      callback?: () => void,
    ): ServerResponse {
      appendNodeResponseChunk(chunks, chunk, encodingOrCallback);
      witnessDefineProperty(response, 'write', {
        configurable: true,
        enumerable: false,
        value: viteDevNodeResponseWrite,
        writable: true,
      });
      witnessDefineProperty(response, 'writeHead', {
        configurable: true,
        enumerable: false,
        value: viteDevNodeResponseWriteHead,
        writable: true,
      });
      witnessDefineProperty(response, 'end', {
        configurable: true,
        enumerable: false,
        value: viteDevNodeResponseEnd,
        writable: true,
      });

      const contentType = securityString(
        witnessReflectApply(viteDevNodeResponseGetHeader, response, ['Content-Type']) ?? '',
      );
      const status = response.statusCode;
      const body = securityBufferToString(securityBufferConcat(chunks), 'utf8');
      const nextBody = shouldInjectKovoHmrScript(status, contentType, body)
        ? injectKovoHmrScript(body)
        : body;
      if (nextBody !== body) {
        witnessReflectApply(viteDevNodeResponseRemoveHeader, response, ['Content-Length']);
      }

      if (typeof encodingOrCallback === 'function') {
        return witnessReflectApply(viteDevNodeResponseEnd, response, [
          nextBody,
          encodingOrCallback,
        ]);
      }
      return witnessReflectApply(viteDevNodeResponseEnd, response, [
        nextBody,
        encodingOrCallback,
        callback,
      ]);
    } as ServerResponse['end'],
    writable: true,
  });

  return response;
}

function setNodeResponseHeaders(
  response: ServerResponse,
  headers: Record<string, number | readonly string[] | string> | undefined,
): void {
  if (headers === undefined) return;
  const keys = witnessOwnKeys(headers);
  for (let index = 0; index < keys.length; index += 1) {
    const name = keys[index]!;
    if (typeof name !== 'string') throw new TypeError('Vite dev response headers are invalid.');
    const value = viteDevOwnDataValue(headers, name, `Vite dev response header ${name}`);
    witnessReflectApply(viteDevNodeResponseSetHeader, response, [name, value]);
  }
}

function appendNodeResponseChunk(
  chunks: Buffer[],
  chunk: unknown,
  encodingOrCallback: BufferEncoding | ((error?: Error) => void) | (() => void) | undefined,
): void {
  if (chunk === undefined || chunk === null) return;
  if (securityIsUint8Array(chunk)) {
    securityArrayPush(chunks, securityBufferFrom(chunk));
    return;
  }
  if (typeof chunk !== 'string') return;
  securityArrayPush(
    chunks,
    securityBufferFrom(chunk, typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8'),
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
  return securityStringStartsWith(
    viteDevUrlSnapshot(request.url, 'http://kovo.local').pathname,
    '/_q/',
  );
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
      "Kovo-Live-Targets": live.join("; "),
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

  const url = viteDevUrlSnapshot(request.url, 'http://kovo.local');
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

  const url = viteDevUrlSnapshot(request.url, 'http://kovo.local');
  if (isKovoHmrRequest(url)) return true;
  if (isUnversionedKovoAppShellClientModuleRequest(url)) return false;

  return shouldHandleRequest?.(request, app) ?? shouldHandleKovoAppShellViteRequest(request, app);
}

function isKovoHmrRequest(url: Pick<RequestUrlSnapshot, 'pathname'>): boolean {
  return (
    url.pathname === kovoHmrClientPath ||
    url.pathname === kovoHmrRouteRefreshPath ||
    url.pathname === kovoHmrLiveTargetRefreshPath
  );
}

function isUnversionedKovoAppShellClientModuleRequest(url: RequestUrlSnapshot): boolean {
  // SPEC §9.5 reserves immutable app-shell client modules as versioned /c/ URLs.
  // During Vite dev, unversioned /c/ URLs must keep falling through to Vite's
  // asset/middleware stack instead of being claimed by app replay.
  return (
    securityStringStartsWith(url.pathname, '/c/') &&
    !securityStringStartsWith(url.pathname, '/c/__v/') &&
    viteDevUrlSearchParam(url, 'v') === null
  );
}

function isHtmlNavigationRequest(request: IncomingMessage): boolean {
  if (request.method !== undefined && request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const accept = securityStringToLowerCase(readHeader(request.headers, 'accept') ?? '');
  return securityStringIncludes(accept, 'text/html');
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

  const url = viteDevUrlSnapshot(request.url ?? '/', 'http://kovo.local');
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
    if (securityStringToLowerCase(readHeader(request.headers, 'Kovo-Fragment') ?? '') !== 'true') {
      return document;
    }

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

  const modulepreloads = viteDevDenseArrayValues<string>(
    match.route.modulepreloads ?? [],
    'Vite dev route module preloads',
  );
  for (let index = 0; index < modulepreloads.length; index += 1) {
    const record = diagnostics.diagnosticsForModuleHref(modulepreloads[index]!);
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
  const source = readHeader(headers, 'Kovo-Targets') ?? '';
  let start = 0;
  while (start <= source.length) {
    const comma = securityStringIndexOf(source, ',', start);
    const semicolon = securityStringIndexOf(source, ';', start);
    const end =
      comma === -1
        ? semicolon === -1
          ? source.length
          : semicolon
        : semicolon === -1
          ? comma
          : comma < semicolon
            ? comma
            : semicolon;
    const candidate = securityStringTrim(securityStringSlice(source, start, end));
    const equals = securityStringIndexOf(candidate, '=');
    const target = securityStringTrim(
      equals === -1 ? candidate : securityStringSlice(candidate, 0, equals),
    );
    if (target !== '') return target;
    if (end === source.length) break;
    start = end + 1;
  }
  return 'error';
}

function clearModuleRecord(
  fileName: string,
  moduleRecords: Map<string, KovoAppShellDevDiagnosticRecord>,
  hrefToFileName: Map<string, string>,
): void {
  const existing = securityMapGet(moduleRecords, fileName);
  securityMapDelete(moduleRecords, fileName);
  if (!existing) return;

  const hrefs = moduleDiagnosticHrefs(existing);
  for (let index = 0; index < hrefs.length; index += 1) {
    securityMapDelete(hrefToFileName, normalizedModuleHref(hrefs[index]!));
  }
}

function moduleDiagnosticHrefs(record: KovoAppShellDevDiagnosticRecord): string[] {
  const result: string[] = [];
  const seen = createSecuritySet<string>();
  const generated = clientModuleHrefsForSourceFile(record.fileName);
  appendUniqueViteDevStrings(result, seen, generated);
  appendUniqueViteDevStrings(result, seen, record.moduleHrefs ?? []);
  return result;
}

function clientModuleHrefsForSourceFile(fileName: string): string[] {
  const normalized = securityRegExpReplace(slashPath(fileName), /^\/+/, '');
  const clientModule = securityRegExpReplace(normalized, /\.[cm]?[jt]sx?$/, '.client.js');

  return clientModule === normalized ? [] : [`/c/${clientModule}`];
}

function normalizedModuleHref(href: string): string {
  const url = viteDevUrlSnapshot(href, 'http://kovo.local');
  return slashPath(url.pathname);
}

function normalizedRequestHref(href: string): string {
  const url = viteDevUrlSnapshot(href, 'http://kovo.local');
  return `${slashPath(url.pathname)}${url.search}`;
}

function requestDiagnosticForHref(
  diagnostics: KovoAppShellDevDiagnosticLedger,
  href: string,
): KovoAppShellDevDiagnosticRecord | undefined {
  const store = witnessWeakMapGet(requestDiagnosticStores, diagnostics);
  return store === undefined
    ? undefined
    : securityMapGet(store.requestRecords, normalizedRequestHref(href));
}

function recordRequestDiagnostic(
  diagnostics: KovoAppShellDevDiagnosticLedger,
  record: KovoAppShellDevRequestDiagnostics,
): void {
  const store = witnessWeakMapGet(requestDiagnosticStores, diagnostics);
  const diagnosticValues = viteDevDenseArrayValues<DiagnosticDocumentDiagnostic>(
    record.diagnostics,
    'Vite dev request diagnostics',
  );
  if (!store || !hasErrorDiagnostic(diagnosticValues)) return;

  const href = normalizedRequestHref(record.href);
  securityMapSet(
    store.requestRecords,
    href,
    witnessFreeze({
      diagnostics: witnessFreeze(diagnosticValues),
      fileName: href,
      ...(record.source === undefined ? {} : { source: record.source }),
    }),
  );
}

function hasErrorDiagnostic(diagnostics: readonly DiagnosticDocumentDiagnostic[]): boolean {
  const values = viteDevDenseArrayValues<DiagnosticDocumentDiagnostic>(
    diagnostics,
    'Vite dev diagnostics',
  );
  for (let index = 0; index < values.length; index += 1) {
    if (isErrorDiagnostic(values[index]!)) return true;
  }
  return false;
}

function appendUniqueViteDevStrings(
  target: string[],
  seen: Set<string>,
  source: readonly string[],
): void {
  const values = viteDevDenseArrayValues<string>(source, 'Vite dev module hrefs');
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (typeof value !== 'string') throw new TypeError('Vite dev module href must be a string.');
    if (securitySetHas(seen, value)) continue;
    securitySetAdd(seen, value);
    securityArrayPush(target, value);
  }
}

function isErrorDiagnostic(diagnostic: DiagnosticDocumentDiagnostic): boolean {
  return diagnosticDefinitions[diagnostic.code].severity === 'error';
}

function readKovoAppShellViteDevApp(
  module: Record<string, unknown>,
  exportName: string,
  moduleId: string,
): KovoApp {
  const app = viteDevModuleExportValue(module, exportName, `${moduleId} ${exportName} export`);
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
    const handler = viteDevModuleExportValue(
      module,
      exportName,
      `${moduleId} ${exportName} export`,
    );
    if (isKovoAppShellViteDevNodeHandler(handler)) {
      return (request, response, next) => {
        const result = securityPromiseResolve(
          witnessReflectApply(handler, undefined, [request, response]),
        );
        void securityPromiseThen(result, () => undefined, next);
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
        void securityPromiseThen(
          securityPromiseResolve(result as PromiseLike<void>),
          () => undefined,
          () => undefined,
        );
      }
    },
  });
}

function reportDevServerError(error: unknown, context: ServerErrorDiagnosticContext): void {
  const details: string[] = [`[kovo dev] ${context.operation} failed`];
  if (context.routePath) securityArrayPush(details, `route=${context.routePath}`);
  if (context.mutationKey) securityArrayPush(details, `mutation=${context.mutationKey}`);
  if (context.queryKey) securityArrayPush(details, `query=${context.queryKey}`);
  if (context.url) securityArrayPush(details, `url=${context.url}`);
  if (context.status) securityArrayPush(details, `status=${context.status}`);
  console.error(...scrubConsoleArgs([securityArrayJoin(details, ' '), error]));
}

function endpointPostureRequestDiagnostic(
  error: unknown,
  context: ServerErrorDiagnosticContext,
): KovoAppShellDevRequestDiagnostics | undefined {
  const message = error instanceof Error ? error.message : securityString(error);
  if (!securityStringIncludes(message, 'response posture mismatch')) return undefined;

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
  if (!requestIsRequest(request)) return undefined;
  const url = viteDevUrlSnapshot(requestUrl(request));
  return `${url.pathname}${url.search}`;
}

function readKovoAppShellViteDevStylesheetAssets(
  value: KovoAppShellViteDevPluginOptions['stylesheetAssets'],
): KovoAppShellViteDevStylesheetAssets | undefined {
  const source =
    typeof value === 'function'
      ? witnessReflectApply<KovoAppShellViteDevStylesheetAssets | undefined>(value, undefined, [])
      : value;
  if (source === undefined) return undefined;
  if (typeof source !== 'object' || source === null || securityArrayIsArray(source)) {
    throw new TypeError('Vite dev stylesheet assets must be a stable own-data object.');
  }

  const app = snapshotViteDevStylesheetArrayProperty(source, 'app');
  const routes = snapshotViteDevStylesheetRecordProperty(source, 'routes');
  const fragments = snapshotViteDevStylesheetRecordProperty(source, 'fragments');
  return witnessFreeze({
    ...(app === undefined ? {} : { app }),
    ...(fragments === undefined ? {} : { fragments }),
    ...(routes === undefined ? {} : { routes }),
  });
}

function renderKovoAppShellViteDevStylesheetAsset(
  request: IncomingMessage,
  assets: KovoAppShellViteDevStylesheetAssets | undefined,
): Response | undefined {
  if (!assets) return undefined;
  if ((request.method ?? 'GET') !== 'GET' && request.method !== 'HEAD') return undefined;

  const href = request.url
    ? viteDevUrlSnapshot(request.url, 'http://kovo.local').pathname
    : undefined;
  if (!href) return undefined;
  const candidates = devStylesheetAssets(assets);
  let asset: StylesheetAsset | undefined;
  for (let index = 0; index < candidates.length; index += 1) {
    if (candidates[index]!.href === href) {
      asset = candidates[index];
      break;
    }
  }
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
  const result: StylesheetAsset[] = [];
  appendViteDevStylesheetObjects(result, assets.app ?? []);
  appendViteDevStylesheetRecordObjects(result, assets.routes);
  appendViteDevStylesheetRecordObjects(result, assets.fragments);
  return result;
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
    witnessOwnKeys(routeAssets).length === 0 &&
    witnessOwnKeys(fragmentAssets).length === 0
  ) {
    return app;
  }

  const liveTargetRenderers = [] as KovoApp['liveTargetRenderers'][number][];
  for (let index = 0; index < app.liveTargetRenderers.length; index += 1) {
    const renderer = app.liveTargetRenderers[index]!;
    const stylesheets = viteDevRecordArrayValue(
      fragmentAssets,
      renderer.component,
      'Vite dev fragment stylesheet assets',
    );
    if (stylesheets.length === 0) {
      securityArrayPush(liveTargetRenderers, renderer);
      continue;
    }
    const merged: (string | StylesheetAsset)[] = [];
    appendViteDevDenseValues(merged, renderer.stylesheets ?? []);
    appendViteDevDenseValues(merged, stylesheets);
    securityArrayPush(liveTargetRenderers, {
      ...renderer,
      stylesheets: mergeDevStylesheetAssets(merged),
    });
  }

  const routes = [] as KovoApp['routes'][number][];
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index]!;
    const stylesheets = viteDevRecordArrayValue(
      routeAssets,
      route.path,
      'Vite dev route stylesheet assets',
    );
    if (stylesheets.length === 0) {
      securityArrayPush(routes, route);
      continue;
    }
    const merged: (string | StylesheetAsset)[] = [];
    appendViteDevDenseValues(merged, route.stylesheets ?? []);
    appendViteDevDenseValues(merged, stylesheets);
    securityArrayPush(routes, {
      ...route,
      stylesheets: mergeDevStylesheetAssets(merged),
    });
  }

  const stylesheets: (string | StylesheetAsset)[] = [];
  appendViteDevDenseValues(stylesheets, app.stylesheets);
  appendViteDevDenseValues(stylesheets, appAssets);

  return deriveClosedKovoApp(app, {
    liveTargetRenderers,
    routes,
    stylesheets: mergeDevStylesheetAssets(stylesheets),
  });
}

function mergeDevStylesheetAssets(
  assets: readonly (string | StylesheetAsset)[],
): (string | StylesheetAsset)[] {
  const byHref = createSecurityMap<string, string[]>();
  const hrefOrder: string[] = [];
  const values = viteDevDenseArrayValues<string | StylesheetAsset>(
    assets,
    'Vite dev stylesheet merge assets',
  );
  for (let index = 0; index < values.length; index += 1) {
    const asset = values[index]!;
    const href = typeof asset === 'string' ? asset : asset.href;
    if (!securityMapHas(byHref, href)) securityArrayPush(hrefOrder, href);
    const chunks = securityMapGet(byHref, href) ?? [];
    if (typeof asset !== 'string' && asset.criticalCss) {
      securityArrayPush(chunks, asset.criticalCss);
    }
    securityMapSet(byHref, href, chunks);
  }

  const result: (string | StylesheetAsset)[] = [];
  for (let index = 0; index < hrefOrder.length; index += 1) {
    const href = hrefOrder[index]!;
    const chunks = securityMapGet(byHref, href) ?? [];
    const nonEmpty: string[] = [];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = securityStringTrim(chunks[chunkIndex]!);
      if (chunk !== '') securityArrayPush(nonEmpty, chunk);
    }
    const criticalCss = securityArrayJoin(nonEmpty, '\n');
    securityArrayPush(result, {
      ...(criticalCss ? { criticalCss } : {}),
      href,
    });
  }
  return result;
}

const MAX_VITE_DEV_COLLECTION_LENGTH = 100_000;

function snapshotViteDevStylesheetArrayProperty(
  source: object,
  property: 'app',
): readonly (string | StylesheetAsset)[] | undefined {
  const value = viteDevOwnDataValue(source, property, `Vite dev stylesheet assets.${property}`);
  if (value === undefined) return undefined;
  return witnessFreeze(
    snapshotViteDevStylesheetArray(value, `Vite dev stylesheet assets.${property}`),
  );
}

function snapshotViteDevStylesheetRecordProperty(
  source: object,
  property: 'fragments' | 'routes',
): Readonly<Record<string, readonly (string | StylesheetAsset)[]>> | undefined {
  const value = viteDevOwnDataValue(source, property, `Vite dev stylesheet assets.${property}`);
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || securityArrayIsArray(value)) {
    throw new TypeError(`Vite dev stylesheet assets.${property} must be an own-data record.`);
  }
  const record = createSecurityNullRecord<readonly (string | StylesheetAsset)[]>();
  const keys = witnessOwnKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string') {
      throw new TypeError(`Vite dev stylesheet assets.${property} must not use symbol keys.`);
    }
    const items = viteDevOwnDataValue(value, key, `Vite dev stylesheet assets.${property}.${key}`);
    witnessDefineProperty(record, key, {
      configurable: false,
      enumerable: true,
      value: witnessFreeze(
        snapshotViteDevStylesheetArray(items, `Vite dev stylesheet assets.${property}.${key}`),
      ),
      writable: false,
    });
  }
  return witnessFreeze(record);
}

function snapshotViteDevStylesheetArray(
  source: unknown,
  label: string,
): (string | StylesheetAsset)[] {
  const values = viteDevDenseArrayValues<unknown>(source, label);
  const result: (string | StylesheetAsset)[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value === 'string') securityArrayPush(result, value);
    else securityArrayPush(result, snapshotStylesheetAsset(value as StylesheetAsset));
  }
  return result;
}

function appendViteDevStylesheetObjects(
  target: StylesheetAsset[],
  source: readonly (string | StylesheetAsset)[],
): void {
  const values = viteDevDenseArrayValues(source, 'Vite dev stylesheet assets');
  for (let index = 0; index < values.length; index += 1) {
    if (typeof values[index] !== 'string')
      securityArrayPush(target, values[index] as StylesheetAsset);
  }
}

function appendViteDevStylesheetRecordObjects(
  target: StylesheetAsset[],
  record: Readonly<Record<string, readonly (string | StylesheetAsset)[]>> | undefined,
): void {
  if (record === undefined) return;
  const keys = witnessOwnKeys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string') throw new TypeError('Vite dev stylesheet record is invalid.');
    appendViteDevStylesheetObjects(
      target,
      viteDevRecordArrayValue(record, key, 'Vite dev stylesheet assets'),
    );
  }
}

function viteDevRecordArrayValue<Value>(
  record: Readonly<Record<string, readonly Value[]>>,
  key: string,
  label: string,
): readonly Value[] {
  const value = viteDevOwnDataValue(record, key, `${label}.${key}`);
  if (value === undefined) return [];
  if (!securityArrayIsArray(value)) throw new TypeError(`${label}.${key} must be an array.`);
  return value as readonly Value[];
}

function appendViteDevDenseValues<Value>(target: Value[], source: readonly Value[]): void {
  const values = viteDevDenseArrayValues<Value>(source, 'Vite dev collection');
  for (let index = 0; index < values.length; index += 1) {
    securityArrayPush(target, values[index]!);
  }
}

function viteDevDenseArrayValues<Value>(source: unknown, label: string): Value[] {
  if (!securityArrayIsArray(source)) throw new TypeError(`${label} must be a dense array.`);
  const length = witnessGetOwnPropertyDescriptor(source, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    !securityNumberIsInteger(length.value) ||
    length.value < 0 ||
    length.value > MAX_VITE_DEV_COLLECTION_LENGTH
  ) {
    throw new TypeError(`${label} must have a bounded own-data length.`);
  }
  const values: Value[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(source, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label}[${index}] must be an own data property.`);
    }
    securityArrayPush(values, descriptor.value as Value);
  }
  return values;
}

function viteDevOwnDataValue(source: unknown, property: PropertyKey, label: string): unknown {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError(`${label} owner must be an object.`);
  }
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined || after === undefined) {
    if (before === after) return undefined;
    throw new TypeError(`${label} changed while read.`);
  }
  if (!('value' in before) || !('value' in after) || !witnessObjectIs(before.value, after.value)) {
    throw new TypeError(`${label} must be a stable own data property.`);
  }
  return before.value;
}

function viteDevModuleExportValue(source: unknown, property: PropertyKey, label: string): unknown {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError(`${label} owner must be an object.`);
  }
  // Vite owns SSR namespace proxies and may materialize a fresh descriptor/value wrapper on each
  // inspection. Supported CLI loads are kept outside authored resolve/load/transform hooks, so one
  // fixed-name read from an own namespace export is the honest trust boundary (SPEC §6.6 rule 6).
  if (witnessGetOwnPropertyDescriptor(source, property) === undefined) return undefined;
  return witnessReflectGet(source, property);
}

function viteDevStableCallable(source: unknown, property: PropertyKey, label: string): Function {
  const value = viteDevOwnDataValue(source, property, label);
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

function captureViteDevNodeResponseMethod(property: PropertyKey): Function {
  let owner: object | null = NativeServerResponse.prototype;
  while (owner !== null) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`Vite dev ServerResponse.${String(property)} is unavailable.`);
      }
      return descriptor.value;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  throw new TypeError(`Vite dev ServerResponse.${String(property)} is unavailable.`);
}

function isKovoAppShellViteDevNodeHandler(value: unknown): value is NodeRequestHandler {
  // SPEC §9.5 keeps the public handler currency as Request -> Response; this
  // optional dev hook is only for the adapter edge and must be a Node handler.
  return typeof value === 'function' && value.length >= 2;
}

function slashPath(fileName: string): string {
  return securityStringReplaceAll(fileName, '\\', '/');
}
