import { blockingAppDiagnostics } from './app-diagnostics.js';
import { reportServerError } from './diagnostics.js';
import { renderDiagnosticDocument } from './document-diagnostics.js';
import { matchShellDispatch, type ShellDispatchMatch } from './shell.js';
import {
  redirectLocationHeader,
  routeResponseToWebResponse,
  serverResponseToWebResponse,
} from './response.js';
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
  pinRequestIngressSurface,
  preDispatchLoadShedResponse,
  requestWithBodyLimit,
  RequestBodyLimitExceededError,
  requestWithVerifiedBodyLimit,
  type LoadShedSurface,
} from './app-load-shed.js';
import { dispatchMatchedAppRequest } from './app-dispatch.js';
import { appRequestUrl, renderAppErrorDocumentResponse } from './app-document.js';
import { requestMetadataWithoutAmbientAuthority } from './response-posture.js';
import { schemaMaxUploadBytes, type Schema } from './schema.js';
import { mutationResponseWithoutBrowserState } from './mutation.js';
import { denseOwnRegistryEntryByExactKey } from './registry-lookup.js';
import {
  requestCreateUrl,
  requestMethod,
  requestUrl,
  requestUrlSnapshot,
} from './request-body-intrinsics.js';

const FILE_MUTATION_BODY_OVERHEAD_BYTES = 1_048_576;

export async function handleAppRequest(app: KovoApp, request: Request): Promise<Response> {
  const appDiagnostics = blockingAppDiagnostics(app);
  if (appDiagnostics.length > 0) {
    return routeResponseToWebResponse(renderDiagnosticDocument(appDiagnostics), request);
  }

  pinRequestIngressSurface(request);
  const method = requestMethod(request);
  const url = requestCreateUrl(requestUrl(request));
  const urlSnapshot = requestUrlSnapshot(url);
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    method,
    pathname: urlSnapshot.pathname,
    routes: app.routes,
  });
  const surface = loadShedSurface(match.kind);
  const buildToken = systemResponseBuildToken(app, surface);

  if (match.normalization.redirect) {
    return appSystemResponse(null, {
      buildToken,
      headers: {
        Location: redirectLocationHeader(
          `${match.normalization.redirect.pathname}${urlSnapshot.search}${urlSnapshot.hash}`,
        ),
      },
      method,
      status: match.normalization.redirect.status,
      surface,
    });
  }

  const reservedKey = resolveReservedDispatchKey(match);
  if ((match.kind === 'mutation' || match.kind === 'query') && reservedKey === undefined) {
    return appSystemResponse('Not Found', {
      buildToken,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      method,
      status: 404,
      surface,
    });
  }

  let limitedRequest = request;
  try {
    const maxBodyBytes = requestBodyLimitForMatch(app, match, reservedKey);
    // Pre-dispatch policy callbacks need only method/URL/client-IP metadata. Give
    // every surface the same bodyless, credential-neutral carrier so a custom
    // limiter cannot accidentally become an ambient-authority consumer.
    const loadShedRequest = requestMetadataWithoutAmbientAuthority(request);
    const loadShed = preDispatchLoadShedResponse(
      app,
      loadShedRequest,
      surface,
      buildToken,
      maxBodyBytes,
    );
    if (loadShed) return loadShed;

    if (urlSnapshot.pathname === KOVO_CSP_REPORT_ENDPOINT) {
      return kovoSecurityReportResponse(app, request);
    }

    const dispatchRequest =
      match.kind === 'endpoint' || match.kind === 'mutation'
        ? await requestWithVerifiedBodyLimit(request, maxBodyBytes)
        : request;
    limitedRequest = requestWithBodyLimit(dispatchRequest, maxBodyBytes);
    return await dispatchMatchedAppRequest({
      app,
      match,
      method,
      request: limitedRequest,
      ...(reservedKey === undefined ? {} : { reservedKey }),
      url,
    });
  } catch (error) {
    if (error instanceof RequestBodyLimitExceededError) {
      return appSystemResponse('Payload Too Large', {
        buildToken,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        method,
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
    if (match.kind === 'query') {
      return appSystemResponse(JSON.stringify({ code: 'SERVER_ERROR', payload: {} }), {
        buildToken,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        method,
        status: 500,
        surface,
      });
    }
    const errorShellRequest =
      match.kind === 'mutation' ? requestMetadataWithoutAmbientAuthority(request) : request;
    const errorShellResponse = await renderAppErrorDocumentResponse(app, errorShellRequest, 500);
    return routeResponseToWebResponse(
      match.kind === 'mutation'
        ? mutationResponseWithoutBrowserState(errorShellResponse)
        : errorShellResponse,
      errorShellRequest,
    );
  }
}

export async function handleAppStartupErrorResponse(
  app: KovoApp,
  request: Request,
  error: unknown,
): Promise<Response> {
  const method = requestMethod(request);
  const url = requestCreateUrl(requestUrl(request));
  const urlSnapshot = requestUrlSnapshot(url);
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    method,
    pathname: urlSnapshot.pathname,
    routes: app.routes,
  });
  reportAppStartupError(app, request, error);
  if (match.kind === 'endpoint') {
    return endpointServerErrorResponse(match.endpoint.response);
  }
  const errorShellRequest =
    match.kind === 'mutation' ? requestMetadataWithoutAmbientAuthority(request) : request;
  return routeResponseToWebResponse(
    match.kind === 'mutation'
      ? mutationResponseWithoutBrowserState(
          await renderAppErrorDocumentResponse(app, errorShellRequest, 500),
        )
      : await renderAppErrorDocumentResponse(app, errorShellRequest, 500),
    errorShellRequest,
  );
}

export function reportAppStartupError(app: KovoApp, request: Request, error: unknown): void {
  const url = requestCreateUrl(requestUrl(request));
  reportServerError(app.onError, error, {
    operation: 'task-runtime-startup',
    request,
    url: appRequestUrl(url),
  });
}

function requestBodyLimitForMatch(
  app: KovoApp,
  match: ShellDispatchMatch<KovoApp['routes'][number], KovoApp['endpoints'][number]>,
  reservedKey: string | undefined,
): number | false {
  const baseLimit = app.requestLimits.maxBodyBytes;
  if (baseLimit === false || match.kind !== 'mutation') return baseLimit;

  const mutation = denseOwnRegistryEntryByExactKey(
    app.mutations,
    reservedKey ?? '',
    'App mutation registry',
  );
  if (mutation === undefined) return baseLimit;
  const uploadBytes = schemaMaxUploadBytes(mutation.input as Schema<unknown>);
  if (uploadBytes === undefined) return baseLimit;

  // SPEC §6.3/§9.1: a declared file limit is the field-level validation contract. Keep the global
  // pre-dispatch floor, but raise it enough for multipart envelope bytes so the schema can return
  // the typed 422 field error instead of a misleading bare 413 for ordinary bounded uploads.
  const uploadBodyLimit = uploadBytes + FILE_MUTATION_BODY_OVERHEAD_BYTES;
  return baseLimit >= uploadBodyLimit ? baseLimit : uploadBodyLimit;
}

function resolveReservedDispatchKey(
  match: ShellDispatchMatch<KovoApp['routes'][number], KovoApp['endpoints'][number]>,
): string | undefined {
  if (match.kind === 'mutation') {
    // Mutation form actions are emitted directly from the canonical registry key.
    // Reject percent-encoded aliases before any policy callback so a protected key
    // cannot be classified under one spelling and dispatched under another.
    return requestPathContainsPercent(match.key) ? undefined : match.key;
  }
  if (match.kind !== 'query') return undefined;
  try {
    return decodeURIComponent(match.key);
  } catch {
    return undefined;
  }
}

function requestPathContainsPercent(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '%') return true;
  }
  return false;
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
    return serverResponseToWebResponse(
      {
        body: JSON.stringify({ code: 'SERVER_ERROR', payload: {} }),
        headers: { ...headers, 'Content-Type': 'application/json' },
        status: 500,
      },
      { method: 'GET' },
    );
  }
  return serverResponseToWebResponse(
    {
      body: 'Server Error',
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
      status: 500,
    },
    { method: 'GET' },
  );
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
