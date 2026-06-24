import { renderVersionedClientModuleResponse } from './client-modules.js';
import { recordAppCapability } from './app-capabilities.js';
import { renderCapabilityStorageResponse } from './capability-url.js';
import { validateCsrfToken, type CsrfValidationOptions } from './csrf.js';
import { runEndpoint, runEndpointAuth } from './endpoint.js';
import {
  renderQueryRegistryEndpointResponse,
  type QueryEndpointRegistry,
  type QueryEndpointRequest,
} from './query.js';
import { methodNotAllowedWebResponse, routeResponseToWebResponse } from './response.js';
import type { ShellDispatchMatch } from './shell.js';
import type { KovoApp } from './app-types.js';
import {
  appRequestUrl,
  renderAppErrorDocumentResponse,
  renderAppRouteDocumentResponse,
} from './app-document.js';
import { handleAppMutationRequest } from './app-mutation-request.js';
import { resolveLifecycleRequest } from './guards.js';

export interface MatchedAppDispatchOptions {
  app: KovoApp;
  match: ShellDispatchMatch<KovoApp['routes'][number], KovoApp['endpoints'][number]>;
  request: Request;
  url: URL;
}

export async function dispatchMatchedAppRequest({
  app,
  match,
  request,
  url,
}: MatchedAppDispatchOptions): Promise<Response> {
  if (match.kind === 'client-module') {
    return routeResponseToWebResponse(
      renderVersionedClientModuleResponse(app.clientModules, {
        ...(app.onError === undefined ? {} : { onError: app.onError }),
        url: appRequestUrl(url),
      }),
      request,
    );
  }

  if (match.kind === 'capability') {
    return renderCapabilityStorageResponse(request, app.capabilityUrls);
  }

  if (match.kind === 'query') {
    // SPEC §9.4: /_q/ is a credentialed GET endpoint. Reject non-GET/HEAD methods
    // with 405 so state-unsafe verbs (POST, DELETE …) cannot use the query channel
    // as a no-CSRF read path.
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return methodNotAllowedWebResponse(request, ['GET', 'HEAD']);
    }

    // SPEC §5.2.1 rule 2(d): include the build token so `renderQueryEndpointResponse`
    // can stamp it as `Kovo-Build` on the 200 read response.
    const buildToken = app.clientModules.buildToken();
    const queryRequest: QueryEndpointRequest<Request> = {
      currentUrl: appRequestUrl(url),
      ...(app.onError === undefined ? {} : { onError: app.onError }),
      ...(buildToken !== '' ? { buildToken } : {}),
      egressFetch: app.egress.fetch,
      request,
      search: url.searchParams,
      ...(app.db === undefined ? {} : { db: app.db }),
      ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
    };

    return routeResponseToWebResponse(
      await renderQueryRegistryEndpointResponse<Request>(
        { queries: app.queries as QueryEndpointRegistry<Request>['queries'] },
        decodeURIComponent(match.key),
        queryRequest,
      ),
      request,
    );
  }

  if (match.kind === 'mutation') {
    return handleAppMutationRequest(app, request, url, decodeURIComponent(match.key));
  }

  if (match.kind === 'endpoint') {
    const endpointRequest = await resolveLifecycleRequest(request, {
      ...(app.db === undefined ? {} : { db: app.db }),
      ...(app.capabilityUrls === undefined ? {} : { capabilityUrls: app.capabilityUrls }),
      egressFetch: app.egress.fetch,
      onCapabilityUrlMint: (fact) => recordAppCapability(app, fact),
    });
    const authFailure = await runEndpointAuth(match.endpoint, endpointRequest);
    if (authFailure) return authFailure;
    const csrfFailure = await validateEndpointCsrf(match.endpoint, endpointRequest, app.csrf);
    if (csrfFailure) return csrfFailure;
    return runEndpoint(match.endpoint, endpointRequest);
  }

  if (match.kind === 'route') {
    if (!match.methodAllowed) {
      return methodNotAllowedWebResponse(request, match.allowedMethods);
    }

    return routeResponseToWebResponse(
      await renderAppRouteDocumentResponse({
        app,
        params: match.params,
        request,
        route: match.route,
        url,
      }),
      request,
    );
  }

  return routeResponseToWebResponse(
    await renderAppErrorDocumentResponse(app, request, 404),
    request,
  );
}

async function validateEndpointCsrf(
  endpoint: KovoApp['endpoints'][number],
  request: Request,
  csrf: CsrfValidationOptions<any> | undefined,
): Promise<Response | undefined> {
  if (endpoint.csrf?.exempt) return undefined;
  if (!requiresCsrf(request.method)) return undefined;

  // SPEC §9.1 / §6.6: endpoint() is default-CSRF for unsafe browser verbs.
  // Exempt endpoints keep raw-body access; protected endpoints validate a cloned
  // form body before the raw handler can run.
  if (csrf === undefined) return endpointCsrfFailureResponse();

  let rawInput: unknown;
  try {
    rawInput = await request.clone().formData();
  } catch {
    rawInput = {};
  }

  return validateCsrfToken(rawInput, request, csrf) ? undefined : endpointCsrfFailureResponse();
}

function requiresCsrf(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE';
}

function endpointCsrfFailureResponse(): Response {
  return new Response('CSRF', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status: 422,
  });
}
