import type { IncomingMessage, ServerResponse } from 'node:http';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { isKovoApp } from './app-guards.js';
import { createRequestHandler } from './app.js';
import type { KovoApp } from './app-types.js';
import {
  renderDiagnosticDocument,
  type DiagnosticDocumentDiagnostic,
} from './document-diagnostics.js';
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
import { renderFragmentWireHtml } from './wire-html.js';

const kovoHmrClientPath = '/@kovo/hmr-client';
const kovoHmrRouteRefreshPath = '/@kovo/hmr/refresh/route';
const kovoHmrLiveTargetRefreshPath = '/@kovo/hmr/refresh/live-targets';
const kovoHmrClientScript = `<script type="module" src="${kovoHmrClientPath}"></script>`;

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

          const hmrResponse = renderKovoAppShellViteDevHmrResponse(
            app,
            request,
            options.devDiagnostics,
          );
          if (hmrResponse) {
            return hmrResponse
              .then((webResponse) =>
                writeWebResponseToNode(webResponse, response, request.method ?? 'GET'),
              )
              .catch(next);
          }

          const diagnosticResponse = renderKovoAppShellViteDevDiagnosticResponse(
            app,
            request,
            options.devDiagnostics,
          );
          if (diagnosticResponse) {
            return writeKovoAppShellViteDevRouteResponse(
              injectKovoHmrScriptIntoRouteResponse(diagnosticResponse),
              request,
              response,
            ).catch(next);
          }

          const devResponse = injectKovoHmrScriptIntoNodeResponse(response, request);
          return readKovoAppShellViteDevNodeHandler(
            module,
            app,
            options,
            options.nodeHandlerExportName,
            moduleId,
          )(request, devResponse, next);
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
  return new Response(kovoHmrClientSource(), {
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
  if (targetUrl instanceof Response) return targetUrl;

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
  if (targetUrl instanceof Response) return targetUrl;

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

  return new Response(chunks.join('\n'), {
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
  return {
    ...request,
    method: 'GET',
    url: `${targetUrl.pathname}${targetUrl.search}`,
  } as IncomingMessage;
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
  return new Response(response.body, {
    headers: hmrRefreshHeaders(app, refreshKind, response.headers, previousBuildToken),
    status: response.status,
    statusText: response.statusText,
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
  if (options.fallback) headers.set('Kovo-HMR-Fallback', options.fallback);

  return new Response(message, { headers, status });
}

function hmrRefreshHeaders(
  app: KovoApp | undefined,
  refreshKind: 'live-targets' | 'route' | undefined,
  initialHeaders: HeadersInit = {},
  previousBuildToken?: string,
): Headers {
  const headers = new Headers(initialHeaders);
  const buildToken = app?.clientModules.buildToken() ?? '';

  if (refreshKind) headers.set('Kovo-HMR-Refresh', refreshKind);
  if (buildToken !== '') headers.set('Kovo-Build', buildToken);
  if (previousBuildToken) headers.set('Kovo-Previous-Build', previousBuildToken);

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
  if (!shouldInjectKovoHmrScript(response.status, response.headers['Content-Type'], response.body)) {
    return response;
  }

  return {
    ...response,
    body: injectKovoHmrScript(String(response.body)),
  };
}

async function injectKovoHmrScriptIntoWebResponse(response: Response): Promise<Response> {
  const contentType = response.headers.get('Content-Type') ?? response.headers.get('content-type');
  if (!shouldInjectKovoHmrScript(response.status, contentType, null)) return response;

  const headers = new Headers(response.headers);
  headers.delete('content-length');

  return new Response(injectKovoHmrScript(await response.text()), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function injectKovoHmrScriptIntoNodeResponse(
  response: ServerResponse,
  request: IncomingMessage,
): ServerResponse {
  if (request.method === 'HEAD') return response;

  const chunks: Buffer[] = [];
  const write = response.write;
  const writeHead = response.writeHead;
  const end = response.end;

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
  chunks.push(
    Buffer.from(String(chunk), typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8'),
  );
}

function shouldInjectKovoHmrScript(
  status: number,
  contentType: string | null | undefined,
  body: unknown,
): boolean {
  if (status < 200 || status >= 600) return false;
  if (typeof body === 'string' && body.includes(kovoHmrClientPath)) return false;
  return (contentType ?? '').toLowerCase().includes('text/html');
}

function injectKovoHmrScript(html: string): string {
  if (html.includes(kovoHmrClientPath)) return html;
  if (html.includes('</head>')) return html.replace('</head>', `${kovoHmrClientScript}</head>`);
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
    if (!target || seen.has(target)) continue;
    seen.add(target);
    targets.push(target + "#" + liveTargetIdentity(el) + ":" + JSON.stringify(liveProps(el)));
  }
  return targets;
};
const dependencyTargets = () => [
  ...new Set(
    qa(document, "[kovo-deps]")
      .map((el) => {
        const target = targetIdentity(el);
        const deps = rd(el.getAttribute("kovo-deps"));
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
