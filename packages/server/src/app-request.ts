import { blockingAppDiagnostics } from './app-diagnostics.js';
import { reportServerError } from './diagnostics.js';
import { renderDiagnosticDocument } from './document-diagnostics.js';
import { matchShellDispatch, type ShellDispatchMatch } from './shell.js';
import { redirectLocationHeader, routeResponseToWebResponse } from './response.js';
import { KOVO_CSP_REPORT_ENDPOINT } from './csp.js';
import { kovoSecurityReportResponse } from './reporting.js';
import type { KovoApp } from './app-types.js';
import type {
  EndpointCachePosture,
  EndpointResponseBodyPosture,
  EndpointResponsePosture,
} from './endpoint.js';
import { appSystemResponse } from './app-system-response.js';
import {
  preDispatchLoadShedResponse,
  requestWithBodyLimit,
  RequestBodyLimitExceededError,
  requestWithVerifiedBodyLimit,
  type LoadShedSurface,
} from './app-load-shed.js';
import { dispatchMatchedAppRequest } from './app-dispatch.js';
import { appRequestUrl, renderAppErrorDocumentResponse } from './app-document.js';
import { schemaMaxUploadBytes, type Schema } from './schema.js';

const FILE_MUTATION_BODY_OVERHEAD_BYTES = 1_048_576;

export async function handleAppRequest(app: KovoApp, request: Request): Promise<Response> {
  const appDiagnostics = blockingAppDiagnostics(app);
  if (appDiagnostics.length > 0) {
    return routeResponseToWebResponse(renderDiagnosticDocument(appDiagnostics), request);
  }

  const url = new URL(request.url);
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    method: request.method,
    pathname: url.pathname,
    routes: app.routes,
  });
  const surface = loadShedSurface(match.kind);
  const buildToken = systemResponseBuildToken(app, surface);

  if (match.normalization.redirect) {
    url.pathname = match.normalization.redirect.pathname;
    return appSystemResponse(null, {
      buildToken,
      headers: { Location: redirectLocationHeader(`${url.pathname}${url.search}${url.hash}`) },
      method: request.method,
      status: match.normalization.redirect.status,
      surface,
    });
  }

  const maxBodyBytes = requestBodyLimitForMatch(app, match);
  const loadShed = preDispatchLoadShedResponse(app, request, surface, buildToken, maxBodyBytes);
  if (loadShed) return loadShed;

  if (url.pathname === KOVO_CSP_REPORT_ENDPOINT) {
    return kovoSecurityReportResponse(app, request);
  }

  let limitedRequest = request;
  try {
    const dispatchRequest =
      match.kind === 'endpoint'
        ? await requestWithVerifiedBodyLimit(request, maxBodyBytes)
        : request;
    limitedRequest = requestWithBodyLimit(dispatchRequest, maxBodyBytes);
    return await dispatchMatchedAppRequest({ app, match, request: limitedRequest, url });
  } catch (error) {
    if (error instanceof RequestBodyLimitExceededError) {
      return appSystemResponse('Payload Too Large', {
        buildToken,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        method: request.method,
        status: 413,
        surface,
      });
    }
    reportServerError(app.onError, error, {
      operation: 'app-request',
      request: limitedRequest,
      url: appRequestUrl(url),
    });
    if (match.kind === 'endpoint') {
      return endpointServerErrorResponse(match.endpoint.response);
    }
    return routeResponseToWebResponse(
      await renderAppErrorDocumentResponse(app, request, 500),
      request,
    );
  }
}

export async function handleAppStartupErrorResponse(
  app: KovoApp,
  request: Request,
  error: unknown,
): Promise<Response> {
  const url = new URL(request.url);
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    method: request.method,
    pathname: url.pathname,
    routes: app.routes,
  });
  reportServerError(app.onError, error, {
    operation: 'task-runtime-startup',
    request,
    url: appRequestUrl(url),
  });
  if (match.kind === 'endpoint') {
    return endpointServerErrorResponse(match.endpoint.response);
  }
  return routeResponseToWebResponse(
    await renderAppErrorDocumentResponse(app, request, 500),
    request,
  );
}

function requestBodyLimitForMatch(
  app: KovoApp,
  match: ShellDispatchMatch<KovoApp['routes'][number], KovoApp['endpoints'][number]>,
): number | false {
  const baseLimit = app.requestLimits.maxBodyBytes;
  if (baseLimit === false || match.kind !== 'mutation') return baseLimit;

  const mutation = app.mutations.find(
    (candidate) => candidate.key === decodeURIComponent(match.key),
  );
  if (mutation === undefined) return baseLimit;
  const uploadBytes = schemaMaxUploadBytes(mutation.input as Schema<unknown>);
  if (uploadBytes === undefined) return baseLimit;

  // SPEC §6.3/§9.1: a declared file limit is the field-level validation contract. Keep the global
  // pre-dispatch floor, but raise it enough for multipart envelope bytes so the schema can return
  // the typed 422 field error instead of a misleading bare 413 for ordinary bounded uploads.
  return Math.max(baseLimit, uploadBytes + FILE_MUTATION_BODY_OVERHEAD_BYTES);
}

function loadShedSurface(kind: string): LoadShedSurface {
  if (kind === 'mutation') return 'mutation';
  if (kind === 'query') return 'query';
  return 'other';
}

function systemResponseBuildToken(app: KovoApp, surface: LoadShedSurface): string | undefined {
  return surface === 'mutation' || surface === 'query' ? app.clientModules.buildToken() : undefined;
}

function endpointServerErrorResponse(posture: EndpointResponsePosture): Response {
  const headers = endpointErrorHeaders(posture.cache);
  const body = posture.body;
  if (endpointBodyIncludes(body, 'json')) {
    return Response.json({ code: 'SERVER_ERROR', payload: {} }, { headers, status: 500 });
  }
  return new Response('Server Error', {
    headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    status: 500,
  });
}

function endpointErrorHeaders(cache: EndpointCachePosture): Record<string, string> {
  if (cache === 'no-store') return { 'Cache-Control': 'no-store' };
  if (cache === 'private') return { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  if (cache === 'public') return { 'Cache-Control': 'public' };
  if (cache === 'revalidated') return { 'Cache-Control': 'no-cache' };
  return {};
}

function endpointBodyIncludes(body: EndpointResponseBodyPosture, expected: 'json'): boolean {
  return Array.isArray(body) ? body.includes(expected) : body === expected;
}
