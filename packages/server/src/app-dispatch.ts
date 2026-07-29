import { renderVersionedClientModuleResponse } from './client-modules.js';
import { runWithResponseLifecycleRequest } from './response-lifecycle-context.js';
import {
  anonymousCsrfResponsePersonalizationWitness,
  sealAnonymousCsrfResponseRequestAndSnapshotSetCookies,
  validateCsrfToken,
  type CsrfOptions,
} from './csrf.js';
import {
  runEndpointAccessDecision,
  runEndpointAuth,
  runEndpointForAppDispatch,
} from './endpoint.js';
import {
  endpointBrowserCredentialDelegationPinned,
  endpointBrowserStateAuthExecuted,
} from './endpoint-auth-proof.js';
import {
  renderQueryRegistryEndpointResponse,
  type QueryEndpointRegistry,
  type QueryEndpointRequest,
} from './query.js';
import {
  methodNotAllowedWebResponse,
  routeResponseToWebResponse,
  serverResponseToWebResponse,
} from './response.js';
import type { ShellDispatchMatch } from './shell.js';
import type { KovoApp } from './app-types.js';
import type { EndpointDeclaration, EndpointMethod, EndpointMount } from './endpoint.js';
import {
  appRequestUrl,
  renderAppErrorDocumentResponse,
  renderAppRouteDocumentResponse,
} from './app-document.js';
import { handleAppMutationRequest } from './app-mutation-request.js';
import { resolveRequestClientIp } from './app-load-shed.js';
import {
  assertEndpointResponsePostureAndSnapshot,
  finalizeRawWebResponse,
  resolveKovoLifecycleRequest,
} from './response-posture.js';
import { appTaskScheduler } from './task-runtime.js';
import { readCsrfCarrierFromRequest } from './untrusted-request-body.js';
import { runWebhook, type WebhookDeclaration } from './webhook.js';
import { securityEvent } from './security-event.js';
import { canonicalRequestMethod, isSafeEndpointMethod } from './request-method.js';
import {
  requestDecodeURIComponent,
  requestHeader,
  requestMethod,
  requestUrlSearchParams,
} from './request-body-intrinsics.js';

export interface MatchedAppDispatchOptions {
  app: KovoApp;
  /** Build token snapshotted by the admitted request shell. */
  buildToken?: string;
  match: ShellDispatchMatch<KovoApp['routes'][number], KovoApp['endpoints'][number]>;
  method?: string;
  request: Request;
  reservedKey?: string;
  url: URL;
}

/**
 * Snapshot whether a request uses Kovo's build-bound enhanced transport without consulting any
 * app-owned registry or decoding target/query carriers. The request shell may run this classifier
 * before coarse admission; the actual build comparison stays behind that boundary (SPEC §9.5).
 *
 * @internal
 */
export function isEnhancedBuildBoundRequest(
  request: Request,
  kind: ShellDispatchMatch['kind'],
  method: string,
): boolean {
  const canonicalMethod = canonicalRequestMethod(method);
  if (
    (kind === 'query' && canonicalMethod !== 'GET' && canonicalMethod !== 'HEAD') ||
    (kind === 'mutation' && canonicalMethod !== 'POST')
  ) {
    return false;
  }
  if (kind !== 'query' && kind !== 'mutation') return false;
  // Native forms and native query navigation never emit a Kovo-* request carrier. Treat every
  // reserved enhanced carrier as sufficient classification evidence so stripping all but one
  // cannot downgrade a stale page request into the native decoder/handler path.
  return (
    requestHeader(request, 'kovo-build') !== null ||
    requestHeader(request, 'kovo-current-url') !== null ||
    requestHeader(request, 'kovo-fragment') !== null ||
    requestHeader(request, 'kovo-targets') !== null ||
    requestHeader(request, 'kovo-live-targets') !== null ||
    requestHeader(request, 'kovo-form-target') !== null ||
    requestHeader(request, 'kovo-idem') !== null ||
    requestHeader(request, 'kovo-stream') !== null
  );
}

/**
 * Reject an enhanced request whose immutable document build cannot select this app's decoder.
 * The app request shell calls this before reserved query-key decoding; dispatch repeats the check
 * as a fail-closed boundary for direct internal callers (SPEC §5.2.1/§14).
 *
 * @internal
 */
export function enhancedRequestBuildSkewResponse(
  app: KovoApp,
  request: Request,
  kind: ShellDispatchMatch['kind'],
  method: string,
): Response | undefined {
  if (!isEnhancedBuildBoundRequest(request, kind, method)) return undefined;
  return enhancedRequestBuildSkewResponseForToken(request, method, app.clientModules.buildToken());
}

/** @internal Compare a preclassified enhanced request with an already-admitted build snapshot. */
export function enhancedRequestBuildSkewResponseForToken(
  request: Request,
  method: string,
  buildToken: string,
): Response | undefined {
  if (requestHeader(request, 'kovo-build') === buildToken) return undefined;
  return serverResponseToWebResponse(
    {
      body: '',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': buildToken,
        'Kovo-Build-Skew': 'true',
        Vary: 'Cookie',
      },
      status: 409,
    },
    { method },
  );
}

export async function dispatchMatchedAppRequest({
  app,
  buildToken: admittedBuildToken,
  match,
  method,
  request,
  reservedKey,
  url,
}: MatchedAppDispatchOptions): Promise<Response> {
  const exactMethod = method ?? requestMethod(request);
  if (match.kind === 'client-module') {
    return routeResponseToWebResponse(
      renderVersionedClientModuleResponse(app.clientModules, {
        ...(app.onError === undefined ? {} : { onError: app.onError }),
        url: appRequestUrl(url),
      }),
      { method: exactMethod },
    );
  }

  if (match.kind === 'query') {
    // SPEC §9.4: /_q/ is a credentialed GET endpoint. Reject non-GET/HEAD methods
    // with 405 so state-unsafe verbs (POST, DELETE …) cannot use the query channel
    // as a no-CSRF read path.
    const canonicalMethod = canonicalRequestMethod(exactMethod);
    if (canonicalMethod !== 'GET' && canonicalMethod !== 'HEAD') {
      return methodNotAllowedWebResponse({ method: exactMethod }, ['GET', 'HEAD']);
    }
    const buildToken = admittedBuildToken ?? app.clientModules.buildToken();
    const enhanced = isEnhancedBuildBoundRequest(request, match.kind, exactMethod);
    const buildSkew = enhanced
      ? enhancedRequestBuildSkewResponseForToken(request, exactMethod, buildToken)
      : undefined;
    if (buildSkew !== undefined) return buildSkew;

    // SPEC §5.2.1 rule 2(d): include the build token so `renderQueryEndpointResponse`
    // can stamp it as `Kovo-Build` on the 200 read response.
    const queryRequest: QueryEndpointRequest<Request> = {
      currentUrl: appRequestUrl(url),
      ...(app.onError === undefined ? {} : { onError: app.onError }),
      buildToken,
      ...(enhanced ? { enhanced: true as const } : {}),
      maxListItems: app.requestLimits.maxQueryListItems,
      request,
      search: requestUrlSearchParams(url),
      clientIp: (req) => resolveRequestClientIp(app, req),
      ...(app.db === undefined ? {} : { db: app.db }),
      env: app.env,
      ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
    };

    return routeResponseToWebResponse(
      await renderQueryRegistryEndpointResponse<Request>(
        { queries: app.queries as QueryEndpointRegistry<Request>['queries'] },
        reservedKey ?? requestDecodeURIComponent(match.key),
        queryRequest,
      ),
      { method: exactMethod },
    );
  }

  if (match.kind === 'mutation') {
    const canonicalMethod = canonicalRequestMethod(exactMethod);
    const buildToken =
      canonicalMethod === 'POST'
        ? (admittedBuildToken ?? app.clientModules.buildToken())
        : undefined;
    const buildSkew =
      buildToken !== undefined && isEnhancedBuildBoundRequest(request, match.kind, exactMethod)
        ? enhancedRequestBuildSkewResponseForToken(request, exactMethod, buildToken)
        : undefined;
    if (buildSkew !== undefined) return buildSkew;
    return handleAppMutationRequest(
      app,
      request,
      url,
      reservedKey ?? requestDecodeURIComponent(match.key),
      exactMethod,
      buildToken,
    );
  }

  if (match.kind === 'endpoint') {
    if (!match.methodAllowed) {
      return methodNotAllowedWebResponse({ method: exactMethod }, match.allowedMethods);
    }

    const endpointRequest = await resolveKovoLifecycleRequest(request, {
      clientIp: (req) => resolveRequestClientIp(app, req),
      declaration: match.endpoint,
      env: app.env,
      stripAuthorization: match.endpoint.csrf?.exempt === true,
      surface: 'endpoint',
    });
    const authFailure = await runEndpointAuth(match.endpoint, endpointRequest);
    if (authFailure) {
      return finalizeMatchedEndpointResponse(authFailure, request, endpointRequest, match.endpoint);
    }
    const csrfFailure = await validateEndpointCsrf(
      match.endpoint,
      request,
      app.csrf,
      match.endpoint.method,
    );
    if (csrfFailure) {
      return finalizeMatchedEndpointResponse(csrfFailure, request, endpointRequest, match.endpoint);
    }
    if (isWebhookEndpoint(match.endpoint)) {
      const webhook = match.endpoint;
      const accessFailure = await runEndpointAccessDecision(webhook, endpointRequest);
      if (accessFailure) {
        return finalizeMatchedEndpointResponse(accessFailure, request, endpointRequest, webhook);
      }
      const taskScheduler = appTaskScheduler(app);
      const mutationOptions = {
        clientIp: (req: Request) => resolveRequestClientIp(app, req),
        ...(webhook.webhookDefinition.transaction === undefined && app.db !== undefined
          ? { db: app.db }
          : {}),
        ...(app.onError === undefined ? {} : { onError: app.onError }),
        ...(taskScheduler === undefined ? {} : { taskScheduler }),
      };
      const response = await runWithResponseLifecycleRequest(
        endpointRequest,
        endpointRequest,
        async () => {
          const response = (
            await runWebhook(webhook, endpointRequest, {
              mutationOptions,
            })
          ).response;
          return assertEndpointResponsePostureAndSnapshot(webhook, response, {
            request: endpointRequest,
          });
        },
      );
      return finalizeMatchedEndpointResponse(
        response,
        request,
        endpointRequest,
        webhook,
        webhook.response,
      );
    }
    return finalizeMatchedEndpointResponse(
      await runEndpointForAppDispatch(
        match.endpoint,
        endpointRequest,
        app.db === undefined ? {} : { db: app.db },
      ),
      request,
      endpointRequest,
      match.endpoint,
      match.endpoint.response,
    );
  }

  if (match.kind === 'route') {
    if (!match.methodAllowed) {
      return methodNotAllowedWebResponse({ method: exactMethod }, match.allowedMethods);
    }

    return routeResponseToWebResponse(
      await renderAppRouteDocumentResponse({
        app,
        ...(admittedBuildToken === undefined ? {} : { buildToken: admittedBuildToken }),
        params: match.params,
        request,
        route: match.route,
        url,
      }),
      { method: exactMethod },
    );
  }

  return routeResponseToWebResponse(
    await renderAppErrorDocumentResponse(app, request, 404, admittedBuildToken),
    { method: exactMethod },
  );
}

function finalizeMatchedEndpointResponse(
  response: Response,
  ingressRequest: Request,
  endpointRequest: Request,
  endpoint: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  options: Parameters<typeof finalizeRawWebResponse>[2] = {},
): Response {
  // The endpoint handler receives a framework-neutralized lifecycle Request, while trusted-scheme
  // and method finalization intentionally consume the accepted ingress Request. Carry only the
  // module-private exact-request CSRF witness across that identity split; never copy Cookie or any
  // other browser authority back onto ingress. A credential-delegating adapter is conservatively
  // personalized even before that witness exists: a raw Response can hide lazy body execution, so
  // its handler may first consume Cookie or mint anonymous CSRF authority after headers finalize.
  // Immediate stream/microtask work may already have minted a standalone anonymous binding. Seal
  // and snapshot its private cookie receipt now, before any later lazy-body work can mint authority;
  // final raw reconstruction injects the snapshot without mutating the app Response.
  const frameworkSetCookies =
    sealAnonymousCsrfResponseRequestAndSnapshotSetCookies(endpointRequest);
  if (
    frameworkSetCookies.length > 0 &&
    (isSafeEndpointMethod(endpoint.method) || endpoint.csrf?.exempt === true) &&
    !endpointBrowserStateAuthExecuted(endpoint, endpointRequest)
  ) {
    throw new Error(
      'A safe-method or CSRF-exempt endpoint cannot emit framework-owned browser state without an executed endpoint authentication proof.',
    );
  }
  return finalizeRawWebResponse(response, ingressRequest, options, {
    ...(endpointBrowserCredentialDelegationPinned(endpoint) ||
    anonymousCsrfResponsePersonalizationWitness(endpointRequest)
      ? { cookiePersonalized: true as const }
      : {}),
    setCookies: frameworkSetCookies,
  });
}

function isWebhookEndpoint(
  endpoint: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
): endpoint is WebhookDeclaration<string, string, any, any, any> {
  return (
    'webhook' in endpoint &&
    endpoint.webhook === true &&
    'webhookDefinition' in endpoint &&
    'name' in endpoint &&
    typeof endpoint.name === 'string'
  );
}

async function validateEndpointCsrf(
  endpoint: KovoApp['endpoints'][number],
  request: Request,
  csrf: CsrfOptions<any> | undefined,
  method: string,
): Promise<Response | undefined> {
  if (endpoint.csrf?.exempt) return undefined;
  if (!requiresCsrf(method)) return undefined;

  // SPEC §9.1 / §6.6: endpoint() is default-CSRF for unsafe browser verbs.
  // Exempt endpoints keep raw-body access; protected endpoints validate a cloned
  // body before the raw handler can run.
  if (csrf === undefined) {
    return endpointCsrfFailureResponse(request);
  }

  const rawInput = await readCsrfCarrierFromRequest(request);

  if (validateCsrfToken(rawInput, request, csrf)) return undefined;
  return endpointCsrfFailureResponse(request);
}

function requiresCsrf(method: string): boolean {
  // SPEC §9.1: GET/HEAD/OPTIONS are the complete safe set. An extension method unknown to Kovo
  // is unsafe, never an implicit CSRF bypass.
  return !isSafeEndpointMethod(method);
}

function endpointCsrfFailureResponse(request: Pick<Request, 'method'>): Response {
  securityEvent({ reason: 'invalid-token', type: 'csrf-rejected' });
  // @kovo-security-denial csrf-rejected endpoint-csrf
  return serverResponseToWebResponse(
    {
      body: 'CSRF',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 422,
    },
    request,
  );
}
