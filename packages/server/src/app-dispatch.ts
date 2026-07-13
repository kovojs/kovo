import { renderVersionedClientModuleResponse } from './client-modules.js';
import { validateCsrfToken, type CsrfOptions } from './csrf.js';
import { runEndpoint, runEndpointAccessDecision, runEndpointAuth } from './endpoint.js';
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
  assertEndpointResponsePosture,
  finalizeRawWebResponse,
  resolveKovoLifecycleRequest,
} from './response-posture.js';
import { appTaskScheduler } from './task-runtime.js';
import { readCsrfCarrierFromRequest } from './untrusted-request-body.js';
import { runWebhook, type WebhookDeclaration } from './webhook.js';
import { canonicalRequestMethod } from './request-method.js';
import { requestMethod, requestUrlSearchParams } from './request-body-intrinsics.js';

export interface MatchedAppDispatchOptions {
  app: KovoApp;
  match: ShellDispatchMatch<KovoApp['routes'][number], KovoApp['endpoints'][number]>;
  method?: string;
  request: Request;
  reservedKey?: string;
  url: URL;
}

export async function dispatchMatchedAppRequest({
  app,
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

    // SPEC §5.2.1 rule 2(d): include the build token so `renderQueryEndpointResponse`
    // can stamp it as `Kovo-Build` on the 200 read response.
    const buildToken = app.clientModules.buildToken();
    const queryRequest: QueryEndpointRequest<Request> = {
      currentUrl: appRequestUrl(url),
      ...(app.onError === undefined ? {} : { onError: app.onError }),
      buildToken,
      maxListItems: app.requestLimits.maxQueryListItems,
      request,
      search: requestUrlSearchParams(url),
      clientIp: (req) => resolveRequestClientIp(app, req),
      ...(app.db === undefined ? {} : { db: app.db }),
      ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
    };

    return routeResponseToWebResponse(
      await renderQueryRegistryEndpointResponse<Request>(
        { queries: app.queries as QueryEndpointRegistry<Request>['queries'] },
        reservedKey ?? decodeURIComponent(match.key),
        queryRequest,
      ),
      { method: exactMethod },
    );
  }

  if (match.kind === 'mutation') {
    return handleAppMutationRequest(
      app,
      request,
      url,
      reservedKey ?? decodeURIComponent(match.key),
      exactMethod,
    );
  }

  if (match.kind === 'endpoint') {
    if (!match.methodAllowed) {
      return methodNotAllowedWebResponse({ method: exactMethod }, match.allowedMethods);
    }

    const endpointRequest = await resolveKovoLifecycleRequest(request, {
      clientIp: (req) => resolveRequestClientIp(app, req),
      stripAuthorization: match.endpoint.csrf?.exempt === true,
      surface: 'endpoint',
    });
    const authFailure = await runEndpointAuth(match.endpoint, endpointRequest);
    if (authFailure) return finalizeRawWebResponse(authFailure, request);
    const csrfFailure = await validateEndpointCsrf(
      match.endpoint,
      request,
      app.csrf,
      exactMethod,
    );
    if (csrfFailure) return finalizeRawWebResponse(csrfFailure, request);
    if (isWebhookEndpoint(match.endpoint)) {
      const accessFailure = await runEndpointAccessDecision(match.endpoint, endpointRequest);
      if (accessFailure) return finalizeRawWebResponse(accessFailure, request);
      const taskScheduler = appTaskScheduler(app);
      const mutationOptions = {
        clientIp: (req: Request) => resolveRequestClientIp(app, req),
        ...(match.endpoint.webhookDefinition.transaction === undefined && app.db !== undefined
          ? { db: app.db }
          : {}),
        ...(app.onError === undefined ? {} : { onError: app.onError }),
        ...(taskScheduler === undefined ? {} : { taskScheduler }),
      };
      const response = (
        await runWebhook(match.endpoint, endpointRequest, {
          mutationOptions,
        })
      ).response;
      assertEndpointResponsePosture(match.endpoint, response, { request: endpointRequest });
      return finalizeRawWebResponse(response, request, match.endpoint.response);
    }
    return finalizeRawWebResponse(
      await runEndpoint(
        match.endpoint,
        endpointRequest,
        app.db === undefined ? {} : { db: app.db },
      ),
      request,
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
        params: match.params,
        request,
        route: match.route,
        url,
      }),
      { method: exactMethod },
    );
  }

  return routeResponseToWebResponse(
    await renderAppErrorDocumentResponse(app, request, 404),
    { method: exactMethod },
  );
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
  if (csrf === undefined) return endpointCsrfFailureResponse(request);

  const rawInput = await readCsrfCarrierFromRequest(request);

  return validateCsrfToken(rawInput, request, csrf)
    ? undefined
    : endpointCsrfFailureResponse(request);
}

function requiresCsrf(method: string): boolean {
  const upper = canonicalRequestMethod(method);
  return upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE';
}

function endpointCsrfFailureResponse(request: Pick<Request, 'method'>): Response {
  return serverResponseToWebResponse(
    {
      body: 'CSRF',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 422,
    },
    request,
  );
}
