import {
  createMemoryVersionedClientModuleRegistry,
  renderVersionedClientModuleResponse,
  type VersionedClientModuleRegistry,
} from './client-modules.js';
import { reportServerError, type ServerErrorHandler } from './diagnostics.js';
import {
  renderErrorDocument,
  renderRouteDocumentResponse,
  type DocumentTemplate,
} from './document.js';
import { matchShellDispatch } from './shell.js';
import {
  routeResponseToDocumentResponse,
  routeResponseToWebResponse,
  type RoutePageResponse,
} from './response.js';
import {
  renderQueryRegistryEndpointResponse,
  renderRoutePageResponse,
  runEndpoint,
  type CsrfValidationOptions,
  type EndpointDeclaration,
  type EndpointMethod,
  type EndpointMount,
  type MutationDefinition,
  type MutationReplayStore,
  type QueryEndpointRequest,
  type QueryEndpointRegistry,
  type RegisteredQueryDefinition,
  type RouteDeclaration,
  type RouteRequestInput,
  type SessionProvider,
} from './index.js';

type AnyRouteDeclaration = RouteDeclaration<any, any, any, any, any, any>;

export interface AppErrorShellOptions {
  forbidden?: ErrorShellRenderer;
  notFound?: ErrorShellRenderer;
  serverError?: ErrorShellRenderer;
}

export type ErrorShellRenderer = (context: {
  request: Request;
  status: 403 | 404 | 500;
}) => RoutePageResponse | Promise<RoutePageResponse>;

export interface AppDocumentOptions {
  lang?: string;
  template?: DocumentTemplate;
}

export interface AppRouteRenderContext<Route extends AnyRouteDeclaration = AnyRouteDeclaration> {
  params: Record<string, string>;
  request: Request;
  route: Route;
  search: Record<string, string | string[]>;
}

export interface CreateAppOptions<SessionValue = unknown> {
  clientModules?: VersionedClientModuleRegistry;
  csrf?: CsrfValidationOptions<Request>;
  document?: AppDocumentOptions;
  endpoints?: readonly EndpointDeclaration<string, EndpointMethod, EndpointMount>[];
  errorShells?: AppErrorShellOptions;
  mutations?: readonly MutationDefinition[];
  mutationReplayStore?: MutationReplayStore;
  onError?: ServerErrorHandler;
  queries?: readonly RegisteredQueryDefinition[];
  renderRoute?: (value: unknown, context: AppRouteRenderContext) => Promise<string> | string;
  routes?: readonly AnyRouteDeclaration[];
  sessionProvider?: SessionProvider<Request, SessionValue>;
}

export interface JisoApp<SessionValue = unknown> {
  clientModules: VersionedClientModuleRegistry;
  csrf?: CsrfValidationOptions<Request>;
  document: AppDocumentOptions;
  endpoints: readonly EndpointDeclaration<string, EndpointMethod, EndpointMount>[];
  errorShells: AppErrorShellOptions;
  mutations: readonly MutationDefinition[];
  mutationReplayStore?: MutationReplayStore;
  onError?: ServerErrorHandler;
  queries: readonly RegisteredQueryDefinition[];
  renderRoute?: (value: unknown, context: AppRouteRenderContext) => Promise<string> | string;
  routes: readonly AnyRouteDeclaration[];
  sessionProvider?: SessionProvider<Request, SessionValue>;
}

export type RequestHandler = (request: Request) => Promise<Response>;

export function createApp<SessionValue = unknown>(
  options: CreateAppOptions<SessionValue> = {},
): JisoApp<SessionValue> {
  return {
    clientModules: options.clientModules ?? createMemoryVersionedClientModuleRegistry(),
    document: options.document ?? {},
    endpoints: options.endpoints ?? [],
    errorShells: options.errorShells ?? {},
    mutations: options.mutations ?? [],
    queries: options.queries ?? [],
    routes: options.routes ?? [],
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(options.mutationReplayStore === undefined
      ? {}
      : { mutationReplayStore: options.mutationReplayStore }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.renderRoute === undefined ? {} : { renderRoute: options.renderRoute }),
    ...(options.sessionProvider === undefined ? {} : { sessionProvider: options.sessionProvider }),
  };
}

export function createRequestHandler(app: JisoApp): RequestHandler {
  return async (request) => {
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

      if (match.kind === 'endpoint') {
        return await runEndpoint(match.endpoint, request);
      }

      if (match.kind === 'route') {
        if (!match.methodAllowed) {
          return new Response(request.method === 'HEAD' ? null : 'Method Not Allowed', {
            headers: {
              Allow: match.allowedMethods.join(', '),
              'Content-Type': 'text/plain; charset=utf-8',
            },
            status: 405,
          });
        }

        const routeInput: RouteRequestInput = {
          params: match.params,
          search: searchParamsToRecord(url.searchParams),
        };
        const routeResponse = await renderRoutePageResponse(
          match.route,
          routeInput,
          request,
          (value) =>
            app.renderRoute
              ? app.renderRoute(value, {
                  params: match.params,
                  request,
                  route: match.route,
                  search: searchParamsToRecord(url.searchParams),
                })
              : renderDefaultRouteValue(value),
          {
            currentUrl: `${url.pathname}${url.search}${url.hash}`,
            ...(app.onError === undefined ? {} : { onError: app.onError }),
            ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
          },
        );
        const documentResponse = renderRouteDocumentResponse(
          routeResponseToDocumentResponse(routeResponse),
          {
            hints: match.route,
            ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
            ...(app.document.template === undefined ? {} : { template: app.document.template }),
          },
        );

        return routeResponseToWebResponse(documentResponse, request);
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
  };
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
