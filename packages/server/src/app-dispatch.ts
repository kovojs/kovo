import { renderVersionedClientModuleResponse } from './client-modules.js';
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
      buildToken,
      maxListItems: app.requestLimits.maxQueryListItems,
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
    const endpointRequest =
      app.db === undefined ? request : await resolveLifecycleRequest(request, { db: app.db });
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
  // body before the raw handler can run.
  if (csrf === undefined) return endpointCsrfFailureResponse();

  // bugz-3 L15: read the synchronizer token from the parsed body regardless of
  // content-type, mirroring readMutationRequestBody. SPEC.md §9.1 (line 45) puts
  // ad-hoc JSON/REST APIs behind endpoint(), so a JSON-body `kovo-csrf` token MUST
  // be honored — previously the token was read only via formData(), which throws on
  // an application/json body, so a legitimate JSON endpoint POST always 422'd.
  const rawInput = await readEndpointCsrfInput(request);

  return validateCsrfToken(rawInput, request, csrf) ? undefined : endpointCsrfFailureResponse();
}

/**
 * Extract the CSRF synchronizer-token carrier from a cloned request body so the
 * raw handler still receives the original body. JSON for `application/json`,
 * form-data otherwise (mirrors `readMutationRequestBody`). Any parse failure — or
 * a JSON body that is not a record (array/string/number/null) and therefore cannot
 * carry a named token field — falls back to `{}`, so the Origin floor inside
 * `validateCsrfToken` still runs and the missing token fails closed with 422.
 */
async function readEndpointCsrfInput(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  const clone = request.clone();
  try {
    if (contentType.includes('application/json')) {
      const value: unknown = await clone.json();
      return typeof value === 'object' && value !== null ? value : {};
    }
    return await clone.formData();
  } catch {
    return {};
  }
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
