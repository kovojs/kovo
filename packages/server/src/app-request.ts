import { renderVersionedClientModuleResponse } from './client-modules.js';
import { reportServerError } from './diagnostics.js';
import { renderErrorDocument, renderRouteDocumentResponse } from './document.js';
import { runEndpoint } from './endpoint.js';
import type { SessionProvider } from './guards.js';
import { renderMutationEndpointResponse, type MutationDefinition } from './mutation.js';
import {
  renderQueryRegistryEndpointResponse,
  type QueryEndpointRegistry,
  type QueryEndpointRequest,
} from './query.js';
import type { Schema } from './schema.js';
import { matchShellDispatch } from './shell.js';
import {
  routeResponseToDocumentResponse,
  routeResponseToWebResponse,
  serverResponseToWebResponse,
  type RoutePageResponse,
} from './response.js';
import { renderRoutePageResponse, type RouteDeclaration, type RouteRequestInput } from './route.js';
import type { JisoApp } from './app.js';

type AnyRouteDeclaration = RouteDeclaration<any, any, any, any, any, any>;

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
          url: `${url.pathname}${url.search}${url.hash}`,
        }),
        request,
      );
    }

    if (match.kind === 'query') {
      const queryRequest: QueryEndpointRequest<Request> = {
        currentUrl: `${url.pathname}${url.search}${url.hash}`,
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
      return await handleMutationRequest(app, request, url, decodeURIComponent(match.key));
    }

    if (match.kind === 'endpoint') {
      return await runEndpoint(match.endpoint, request);
    }

    if (match.kind === 'route') {
      if (!match.methodAllowed) {
        return methodNotAllowedResponse(request, match.allowedMethods);
      }

      return routeResponseToWebResponse(
        await renderMatchedRouteDocument(app, request, url, match.route, match.params),
        request,
      );
    }

    return routeResponseToWebResponse(await renderConfiguredError(app, request, 404), request);
  } catch (error) {
    reportServerError(app.onError, error, {
      operation: 'app-request',
      request,
      url: `${url.pathname}${url.search}${url.hash}`,
    });
    return routeResponseToWebResponse(await renderConfiguredError(app, request, 500), request);
  }
}

async function handleMutationRequest(
  app: JisoApp,
  request: Request,
  url: URL,
  mutationKey: string,
): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') {
    return methodNotAllowedResponse(request, ['POST']);
  }

  const mutation = app.mutations.find((candidate) => candidate.key === mutationKey);
  if (!mutation) {
    return routeResponseToWebResponse(await renderConfiguredError(app, request, 404), request);
  }

  const mutationRequest = await requestWithResolvedSession(app.sessionProvider, request);
  const rawInput = await readMutationRequestBody(mutationRequest);
  const currentUrl = `${url.pathname}${url.search}${url.hash}`;
  const mutationResponseOptions = await app.mutationResponse?.({
    currentUrl,
    key: mutation.key,
    mutation,
    rawInput,
    request: mutationRequest,
    url: new URL(url),
  });
  const requestMutation = mutation as unknown as MutationDefinition<
    string,
    Schema<unknown>,
    Record<string, Schema<unknown>>,
    Request
  >;
  const mutationResponse = await renderMutationEndpointResponse(requestMutation, {
    ...(app.csrf === undefined ? {} : { csrf: app.csrf }),
    ...(app.mutationReplayStore === undefined ? {} : { replayStore: app.mutationReplayStore }),
    ...(app.onError === undefined ? {} : { onError: app.onError }),
    ...(mutationResponseOptions?.csrf === undefined ? {} : { csrf: mutationResponseOptions.csrf }),
    ...(mutationResponseOptions?.failureTarget === undefined
      ? {}
      : { failureTarget: mutationResponseOptions.failureTarget }),
    ...(mutationResponseOptions?.failureStylesheets === undefined
      ? {}
      : { failureStylesheets: mutationResponseOptions.failureStylesheets }),
    ...(mutationResponseOptions?.fragmentRenderers === undefined
      ? {}
      : { fragmentRenderers: mutationResponseOptions.fragmentRenderers }),
    headers: request.headers,
    rawInput,
    redirectTo:
      mutationResponseOptions?.redirectTo ?? defaultMutationRedirectTo(mutationRequest, currentUrl),
    ...(mutationResponseOptions?.renderFailureFragment === undefined
      ? {}
      : { renderFailureFragment: mutationResponseOptions.renderFailureFragment }),
    ...(mutationResponseOptions?.renderFailurePage === undefined
      ? {}
      : { renderFailurePage: mutationResponseOptions.renderFailurePage }),
    request: mutationRequest,
  });

  return serverResponseToWebResponse(mutationResponse, mutationRequest);
}

async function renderMatchedRouteDocument(
  app: JisoApp,
  request: Request,
  url: URL,
  route: AnyRouteDeclaration,
  params: Record<string, string>,
): Promise<RoutePageResponse> {
  const search = searchParamsToRecord(url.searchParams);
  const routeInput: RouteRequestInput = {
    params,
    search,
  };
  const routeResponse = await renderRoutePageResponse(
    route,
    routeInput,
    request,
    (value) =>
      app.renderRoute
        ? app.renderRoute(value, {
            params,
            request,
            route,
            search,
          })
        : renderDefaultRouteValue(value),
    {
      currentUrl: `${url.pathname}${url.search}${url.hash}`,
      ...(app.onError === undefined ? {} : { onError: app.onError }),
      ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
    },
  );

  return renderRouteDocumentResponse(routeResponseToDocumentResponse(routeResponse), {
    hints: route,
    ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
    ...(app.document.template === undefined ? {} : { template: app.document.template }),
  });
}

async function renderConfiguredError(
  app: JisoApp,
  request: Request,
  status: 403 | 404 | 500,
): Promise<RoutePageResponse> {
  const renderer =
    status === 403
      ? app.errorShells.forbidden
      : status === 404
        ? app.errorShells.notFound
        : app.errorShells.serverError;

  if (renderer) return renderer({ request, status });

  return renderErrorDocument({
    ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
    status,
    ...(app.document.template === undefined ? {} : { template: app.document.template }),
  });
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

function renderDefaultRouteValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;

  return JSON.stringify(value);
}

function searchParamsToRecord(searchParams: URLSearchParams): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams) {
    const existing = record[key];
    if (existing === undefined) {
      record[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      record[key] = [existing, value];
    }
  }

  return record;
}

async function readMutationRequestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) return request.json();
  return request.formData();
}

async function requestWithResolvedSession(
  sessionProvider: SessionProvider<Request, unknown> | undefined,
  request: Request,
): Promise<Request> {
  if (!sessionProvider) return request;

  const session = await sessionProvider(request);
  Object.defineProperty(request, 'session', {
    configurable: true,
    enumerable: true,
    value: session ?? null,
  });
  return request;
}

function defaultMutationRedirectTo(request: Request, currentUrl: string): string {
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return referer;
    }
  }

  return currentUrl.startsWith('/_m/') ? '/' : currentUrl;
}
