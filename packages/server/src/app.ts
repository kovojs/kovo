import type { EndpointMethod, EndpointMount } from '@jiso/core';
import {
  createMemoryVersionedClientModuleRegistry,
  renderVersionedClientModuleResponse,
  type VersionedClientModuleRegistry,
} from './client-modules.js';
import type { CsrfValidationOptions } from './csrf.js';
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
import { renderRoutePageResponse, type RouteDeclaration, type RouteRequestInput } from './route.js';
import {
  renderQueryRegistryEndpointResponse,
  type QueryEndpointRequest,
  type QueryEndpointRegistry,
  type RegisteredQueryDefinition,
} from './query.js';
import { runEndpoint, type EndpointDeclaration } from './endpoint.js';
import {
  renderMutationEndpointResponse,
  type MutationFail,
  type MutationDefinition,
  type MutationSuccess,
} from './mutation.js';
import type { FragmentRenderer } from './mutation-wire.js';
import type { MutationReplayStore } from './replay.js';
import type { MutationResponseHeaders } from './response.js';
import type { Schema } from './schema.js';
import type { SessionProvider } from './guards.js';

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
  mutationResponse?: AppMutationResponseResolver;
  mutations?: readonly AppMutationDeclaration[];
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
  mutationResponse?: AppMutationResponseResolver;
  mutations: readonly AppMutationDeclaration[];
  mutationReplayStore?: MutationReplayStore;
  onError?: ServerErrorHandler;
  queries: readonly RegisteredQueryDefinition[];
  renderRoute?: (value: unknown, context: AppRouteRenderContext) => Promise<string> | string;
  routes: readonly AnyRouteDeclaration[];
  sessionProvider?: SessionProvider<Request, SessionValue>;
}

export type RequestHandler = (request: Request) => Promise<Response>;

export interface AppMutationDeclaration {
  key: string;
}

export interface AppMutationResponseContext {
  currentUrl: string;
  key: string;
  mutation: AppMutationDeclaration;
  rawInput: unknown;
  request: Request;
  url: URL;
}

export interface AppMutationResponseOptions {
  csrf?: CsrfValidationOptions<Request>;
  failureTarget?: string;
  failureStylesheets?: readonly (string | import('./hints.js').StylesheetAsset)[];
  fragmentRenderers?: readonly FragmentRenderer[];
  redirectTo?: string | ((result: MutationSuccess<unknown>) => string);
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
}

export type AppMutationResponseResolver = (
  context: AppMutationResponseContext,
) => AppMutationResponseOptions | Promise<AppMutationResponseOptions | undefined> | undefined;

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
    ...(options.mutationResponse === undefined
      ? {}
      : { mutationResponse: options.mutationResponse }),
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

      if (match.kind === 'mutation') {
        if (request.method.toUpperCase() !== 'POST') {
          return new Response(request.method === 'HEAD' ? null : 'Method Not Allowed', {
            headers: {
              Allow: 'POST',
              'Content-Type': 'text/plain; charset=utf-8',
            },
            status: 405,
          });
        }

        const mutation = app.mutations.find(
          (candidate) => candidate.key === decodeURIComponent(match.key),
        );
        if (!mutation) {
          return routeResponseToWebResponse(
            await renderConfiguredError(app, request, 404),
            request,
          );
        }

        const mutationRequest = await requestWithResolvedSession(app, request);
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
          ...(app.mutationReplayStore === undefined
            ? {}
            : { replayStore: app.mutationReplayStore }),
          ...(app.onError === undefined ? {} : { onError: app.onError }),
          ...(mutationResponseOptions?.csrf === undefined
            ? {}
            : { csrf: mutationResponseOptions.csrf }),
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
            mutationResponseOptions?.redirectTo ??
            defaultMutationRedirectTo(mutationRequest, currentUrl),
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

async function readMutationRequestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) return request.json();
  return request.formData();
}

async function requestWithResolvedSession(app: JisoApp, request: Request): Promise<Request> {
  if (!app.sessionProvider) return request;

  const session = await app.sessionProvider(request);
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

function serverResponseToWebResponse(
  response: {
    body: BodyInit | null;
    headers: MutationResponseHeaders | Record<string, string>;
    status: number;
  },
  request: Pick<Request, 'method'>,
): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }

  return new Response(request.method === 'HEAD' ? null : response.body, {
    headers,
    status: response.status,
  });
}
