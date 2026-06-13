import { renderVersionedClientModuleResponse } from './client-modules.js';
import { runEndpoint } from './endpoint.js';
import {
  renderQueryRegistryEndpointResponse,
  type QueryEndpointRegistry,
  type QueryEndpointRequest,
} from './query.js';
import { methodNotAllowedWebResponse, routeResponseToWebResponse } from './response.js';
import type { ShellDispatchMatch } from './shell.js';
import type { JisoApp } from './app.js';
import {
  appRequestUrl,
  renderAppErrorDocumentResponse,
  renderAppRouteDocumentResponse,
} from './app-document.js';
import { handleAppMutationRequest } from './app-mutation-request.js';

export interface MatchedAppDispatchOptions {
  app: JisoApp;
  match: ShellDispatchMatch<JisoApp['routes'][number], JisoApp['endpoints'][number]>;
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
    return runEndpoint(match.endpoint, request);
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
