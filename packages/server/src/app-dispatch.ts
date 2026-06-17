import { renderVersionedClientModuleResponse } from './client-modules.js';
import { runEndpoint } from './endpoint.js';
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
    const queryRequest: QueryEndpointRequest<Request> = {
      currentUrl: appRequestUrl(url),
      ...(app.onError === undefined ? {} : { onError: app.onError }),
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
