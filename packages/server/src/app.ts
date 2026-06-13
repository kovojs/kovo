import type { EndpointMethod, EndpointMount } from '@jiso/core';
import {
  createMemoryVersionedClientModuleRegistry,
  type VersionedClientModuleRegistry,
} from './client-modules.js';
import type { CsrfValidationOptions } from './csrf.js';
import type { ServerErrorHandler } from './diagnostics.js';
import type { DocumentTemplate } from './document-core.js';
import { handleAppRequest } from './app-request.js';
import type { RoutePageResponse } from './response.js';
import type { RouteDeclaration } from './route.js';
import type { RegisteredQueryDefinition } from './query.js';
import type { EndpointDeclaration } from './endpoint.js';
import type { MutationFail, MutationSuccess } from './mutation.js';
import type { FragmentRenderer } from './mutation-wire.js';
import type { MutationReplayStore } from './replay.js';
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
  return (request) => handleAppRequest(app, request);
}
