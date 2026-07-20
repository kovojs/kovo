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
  completeAppRequestDeadline,
  pinRequestIngressSurface,
  frameworkLoadShedErrorResponse,
  MAX_APP_REQUEST_BODY_BYTES,
  preDispatchLoadShedResponse,
  requestWithDeadlineCapability,
  requestWithBodyLimit,
  RequestBodyLimitExceededError,
  requestWithVerifiedBodyLimit,
  runWithAppRequestDeadline,
  type LoadShedSurface,
} from './app-load-shed.js';
import { dispatchMatchedAppRequest } from './app-dispatch.js';
import { appRequestUrl, renderAppErrorDocumentResponse } from './app-document.js';
import { requestMetadataWithoutAmbientAuthority } from './response-posture.js';
import { schemaMaxUploadBytes, type Schema } from './schema.js';
import { mutationResponseWithoutBrowserState } from './mutation.js';
import {
  KOVO_RUNTIME_ATTESTATION_ENDPOINT,
  runtimePostureAttestationResponse,
} from './generated-runtime-posture-registry.js';
import { denseOwnRegistryEntryByExactKey } from './registry-lookup.js';
import { admitFrameworkManagedDbProvider } from './guards.js';
import {
  requestCreateUrl,
  requestDecodeURIComponent,
  requestMethod,
  requestUrl,
  requestUrlSnapshot,
} from './request-body-intrinsics.js';
import { requestStateIsSafeInteger } from './request-state-intrinsics.js';
import { requestUrlLimitFailure } from './request-url-limits.js';
import { securityEvent } from './security-event.js';

const FILE_MUTATION_BODY_OVERHEAD_BYTES = 1_048_576;

interface AppRequestAdmissionHooks {
  /**
   * Framework-owned hook invoked only after coarse request admission and any ordinary streamed
   * body ceiling have completed. This is a request-free signal, not an app middleware surface
   * or a carrier for remote metadata (SPEC §9.5/§9.6).
   */
  readonly admitted?: () => void;
}

export async function handleAppRequest(
  app: KovoApp,
  request: Request,
  hooks: AppRequestAdmissionHooks = {},
): Promise<Response> {
  pinRequestIngressSurface(request);
  const urlLimitResponse = appRequestUrlLimitResponse(request);
  if (urlLimitResponse) return urlLimitResponse;
  const appDiagnostics = blockingAppDiagnostics(app);
  if (appDiagnostics.length > 0) {
    securityEvent({ reason: 'runtime-registry', type: 'capability-closed' });
    // @kovo-security-denial capability-closed runtime-registry
    return routeResponseToWebResponse(renderDiagnosticDocument(appDiagnostics), request);
  }

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
    const maxBodyBytes =
      urlSnapshot.pathname === KOVO_RUNTIME_ATTESTATION_ENDPOINT
        ? 4_096
        : requestBodyLimitForMatch(app, match, reservedKey);
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
      request,
      urlSnapshot.pathname === KOVO_RUNTIME_ATTESTATION_ENDPOINT
        ? app.requestLimits.deadlineMs
        : requestDeadlineMsForMatch(app, match),
    );
    if (loadShed) return loadShed;
    const deadlineRequest = requestWithDeadlineCapability(request);
    limitedRequest = deadlineRequest;
    return await runWithAppRequestDeadline(
      deadlineRequest,
      {
        ...(buildToken === undefined ? {} : { buildToken }),
        method,
        surface,
      },
      async () => {
        if (urlSnapshot.pathname === KOVO_RUNTIME_ATTESTATION_ENDPOINT) {
          const attestationRequest = await requestWithVerifiedBodyLimit(
            deadlineRequest,
            maxBodyBytes,
          );
          return runtimePostureAttestationResponse(attestationRequest, {
            ...(buildToken === undefined ? {} : { buildToken }),
            method,
            surface,
          });
        }

        // SPEC §9.2/§9.5: the streamed byte ceiling is an ingress admission gate, not work the
        // database posture path may run ahead of. Content-Length is only a hint, so fully verify
        // endpoint/mutation bodies before lease renewal, catalog probes, or provider acquisition.
        // Reserved reporting keeps its independently bounded body reader below; attestation has
        // already returned through its dedicated 4 KiB branch above.
        const dispatchRequest =
          match.kind === 'endpoint' || match.kind === 'mutation'
            ? await requestWithVerifiedBodyLimit(deadlineRequest, maxBodyBytes)
            : deadlineRequest;
        if (match.kind === 'endpoint' || match.kind === 'mutation') {
          limitedRequest = requestWithBodyLimit(dispatchRequest, maxBodyBytes);
        }

        if (urlSnapshot.pathname === KOVO_CSP_REPORT_ENDPOINT) {
          return kovoSecurityReportResponse(app, deadlineRequest);
        }

        // Durable-task startup may resolve/provision its own database. Keep that background work
        // behind the same pre-dispatch admission boundary as the app database: a rejected streamed
        // request must not be able to trigger either provider (SPEC §9.5/§9.6).
        let admittedRequest = dispatchRequest;
        if (
          hooks.admitted !== undefined &&
          match.kind !== 'endpoint' &&
          match.kind !== 'mutation'
        ) {
          admittedRequest = await requestWithVerifiedBodyLimit(deadlineRequest, maxBodyBytes);
        }
        if (app.db !== undefined) await admitFrameworkManagedDbProvider(app.db);
        hooks.admitted?.();

        if (match.kind !== 'endpoint' && match.kind !== 'mutation') {
          limitedRequest = requestWithBodyLimit(admittedRequest, maxBodyBytes);
        }
        return dispatchMatchedAppRequest({
          app,
          match,
          method,
          request: limitedRequest,
          ...(reservedKey === undefined ? {} : { reservedKey }),
          url,
        });
      },
    );
  } catch (error) {
    // @kovo-response-observation-candidate server.unexpected-failure
    // SPEC §9.2: every unexpected cause crosses one of the stable sanitized bodies below.
    completeAppRequestDeadline(limitedRequest);
    if (error instanceof RequestBodyLimitExceededError) {
      securityEvent({ reason: 'request-body', type: 'budget-exhausted' });
      // @kovo-security-denial budget-exhausted streamed-body
      return appSystemResponse('Payload Too Large', {
        buildToken,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        method,
        status: 413,
        surface,
      });
    }
    const frameworkLoadShed = frameworkLoadShedErrorResponse(error, {
      ...(buildToken === undefined ? {} : { buildToken }),
      method,
      surface,
    });
    if (frameworkLoadShed !== undefined) return frameworkLoadShed;
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

function requestDeadlineMsForMatch(
  app: KovoApp,
  match: ShellDispatchMatch<KovoApp['routes'][number], KovoApp['endpoints'][number]>,
): number {
  return match.kind === 'endpoint'
    ? (match.endpoint.response.longLived?.deadlineMs ?? app.requestLimits.deadlineMs)
    : app.requestLimits.deadlineMs;
}

export async function handleAppStartupErrorResponse(
  app: KovoApp,
  request: Request,
  error: unknown,
): Promise<Response> {
  pinRequestIngressSurface(request);
  const urlLimitResponse = appRequestUrlLimitResponse(request);
  if (urlLimitResponse) return urlLimitResponse;
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

/** @internal Reject oversized serialized request URLs before URL/URLSearchParams construction. */
export function appRequestUrlLimitResponse(request: Request): Response | undefined {
  const method = requestMethod(request);
  if (requestUrlLimitFailure(requestUrl(request)) === undefined) return undefined;
  securityEvent({ reason: 'request-url', type: 'budget-exhausted' });
  // @kovo-security-denial budget-exhausted request-url
  return appSystemResponse('URI Too Long', {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
    method,
    status: 414,
    surface: 'other',
  });
}

function requestBodyLimitForMatch(
  app: KovoApp,
  match: ShellDispatchMatch<KovoApp['routes'][number], KovoApp['endpoints'][number]>,
  reservedKey: string | undefined,
): number {
  const baseLimit = app.requestLimits.maxBodyBytes;
  if (match.kind !== 'mutation') return baseLimit;

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
  if (
    !requestStateIsSafeInteger(uploadBytes) ||
    uploadBytes < 0 ||
    uploadBytes > MAX_APP_REQUEST_BODY_BYTES - FILE_MUTATION_BODY_OVERHEAD_BYTES
  ) {
    return MAX_APP_REQUEST_BODY_BYTES;
  }
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
    return requestDecodeURIComponent(match.key);
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
