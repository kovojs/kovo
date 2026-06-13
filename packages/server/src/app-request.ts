import { renderVersionedClientModuleResponse } from './client-modules.js';
import { reportServerError } from './diagnostics.js';
import { runEndpoint } from './endpoint.js';
import {
  renderQueryRegistryEndpointResponse,
  type QueryEndpointRegistry,
  type QueryEndpointRequest,
} from './query.js';
import { matchShellDispatch } from './shell.js';
import { routeResponseToWebResponse } from './response.js';
import type { JisoApp } from './app.js';
import {
  appRequestUrl,
  renderAppErrorDocumentResponse,
  renderAppRouteDocumentResponse,
} from './app-document.js';
import { handleAppMutationRequest } from './app-mutation-request.js';

export async function handleAppRequest(app: JisoApp, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    method: request.method,
    pathname: url.pathname,
    routes: app.routes,
  });

  if (match.normalization.redirect) {
    url.pathname = match.normalization.redirect.pathname;
    return new Response(null, {
      headers: { Location: `${url.pathname}${url.search}${url.hash}` },
      status: match.normalization.redirect.status,
    });
  }

  try {
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
      return await handleAppMutationRequest(
        app,
        request,
        url,
        decodeURIComponent(match.key),
        methodNotAllowedResponse,
      );
    }

    if (match.kind === 'endpoint') {
      return await runEndpoint(match.endpoint, request);
    }

    if (match.kind === 'route') {
      if (!match.methodAllowed) {
        return methodNotAllowedResponse(request, match.allowedMethods);
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
  } catch (error) {
    reportServerError(app.onError, error, {
      operation: 'app-request',
      request,
      url: appRequestUrl(url),
    });
    return routeResponseToWebResponse(
      await renderAppErrorDocumentResponse(app, request, 500),
      request,
    );
  }
}

function methodNotAllowedResponse(request: Request, allowedMethods: readonly string[]): Response {
  return new Response(request.method === 'HEAD' ? null : 'Method Not Allowed', {
    headers: {
      Allow: allowedMethods.join(', '),
      'Content-Type': 'text/plain; charset=utf-8',
    },
    status: 405,
  });
}
