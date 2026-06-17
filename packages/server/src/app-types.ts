import type {
  DiagnosticCode,
  DiagnosticSeverity,
  EndpointMethod,
  EndpointMount,
} from '@kovojs/core';
import type { VersionedClientModuleRegistry } from './client-modules.js';
import type { CsrfValidationOptions } from './csrf.js';
import type { ServerErrorHandler } from './diagnostics.js';
import type { DocumentTemplate } from './document-core.js';
import type { EndpointDeclaration } from './endpoint.js';
import type { DbProvider, LifecycleRequest, SessionProvider } from './guards.js';
import type { Guard } from './guards.js';
import type { StylesheetAsset } from './hints.js';
import type { MutationContext, MutationFail, MutationSuccess } from './mutation.js';
import type { LiveTargetRenderer } from './mutation-wire.js';
import type { QueryLoadContext, RegisteredQueryDefinition } from './query.js';
import type { MutationReplayStore } from './replay.js';
import type { RoutePageResponse } from './response.js';
import type { RouteDeclaration } from './route.js';
import type { Schema } from './schema.js';

type AnyRouteDeclaration = RouteDeclaration<any, any, any, any, any, any>;

export type AppLifecycleRequest<
  RawRequest extends globalThis.Request = globalThis.Request,
  SessionValue = never,
  DbValue = never,
> = LifecycleRequest<RawRequest, SessionValue, DbValue>;

export type AppQueryDeclaration<AppRequest = unknown> = Omit<
  RegisteredQueryDefinition,
  'guard' | 'load'
> & {
  guard?: Guard<AppRequest>;
  load?: (input: any, context?: QueryLoadContext<AppRequest>) => unknown;
};

export type AppRouteDeclaration<AppRequest = unknown> = RouteDeclaration<
  any,
  any,
  any,
  AppRequest,
  any,
  any
>;

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

/** Options for `createApp`: the routes, queries, mutations, endpoints, document, CSRF, and request providers. */
export interface CreateAppOptions<
  SessionValue = never,
  DbValue = never,
  RawRequest extends globalThis.Request = globalThis.Request,
  AppRequest = AppLifecycleRequest<RawRequest, SessionValue, DbValue>,
> {
  clientModules?: VersionedClientModuleRegistry;
  csrf?: CsrfValidationOptions<AppRequest>;
  db?: DbProvider<RawRequest, DbValue, SessionValue>;
  document?: AppDocumentOptions;
  endpoints?: readonly EndpointDeclaration<string, EndpointMethod, EndpointMount>[];
  errorShells?: AppErrorShellOptions;
  liveTargetRenderers?: readonly LiveTargetRenderer<AppRequest>[];
  mutationResponses?: AppMutationResponses;
  mutations?: readonly AppMutationDeclaration<AppRequest>[];
  mutationReplayStore?: MutationReplayStore;
  onError?: ServerErrorHandler;
  queries?: readonly AppQueryDeclaration<AppRequest>[];
  renderRoute?: (value: unknown, context: AppRouteRenderContext) => Promise<string> | string;
  routes?: readonly AppRouteDeclaration<AppRequest>[];
  sessionProvider?: SessionProvider<RawRequest, SessionValue>;
}

/**
 * A compile/route-table diagnostic surfaced on a `KovoApp` (the `diagnostics` array
 * returned by `createApp`). Carries the diagnostic code, message, source file, and
 * optional severity/position so app tooling can report it (SPEC §9.5).
 */
export interface AppDiagnostic {
  code: DiagnosticCode;
  fileName: string;
  help?: string;
  length?: number;
  message: string;
  severity?: DiagnosticSeverity;
  start?: { column: number; line: number };
}

/** The assembled app aggregate returned by `createApp`; request dispatch starts here. */
export interface KovoApp<
  SessionValue = unknown,
  DbValue = unknown,
  RawRequest extends globalThis.Request = globalThis.Request,
  AppRequest = any,
> {
  clientModules: VersionedClientModuleRegistry;
  csrf?: CsrfValidationOptions<any>;
  db?: DbProvider<any, any, any>;
  diagnostics: readonly AppDiagnostic[];
  document: AppDocumentOptions;
  endpoints: readonly EndpointDeclaration<string, EndpointMethod, EndpointMount>[];
  errorShells: AppErrorShellOptions;
  liveTargetRenderers: readonly LiveTargetRenderer<any>[];
  mutationResponses: AppMutationResponses;
  mutations: readonly AppMutationDeclaration<any>[];
  mutationReplayStore?: MutationReplayStore;
  onError?: ServerErrorHandler;
  queries: readonly AppQueryDeclaration<any>[];
  renderRoute?: (value: unknown, context: AppRouteRenderContext) => Promise<string> | string;
  routes: readonly AppRouteDeclaration<any>[];
  sessionProvider?: SessionProvider<any, any>;
}

export type RequestHandler = (request: Request) => Promise<Response>;

export interface AppMutationDeclaration<AppRequest = unknown> {
  csrf?: CsrfValidationOptions<any> | false;
  guard?: Guard<any, any>;
  handler?: (
    input: any,
    request: AppRequest,
    context: MutationContext<Record<string, Schema<unknown>>>,
  ) => unknown;
  input?: Schema<unknown>;
  key: string;
  registry?: unknown;
  transaction?: <Result>(request: any, run: (transactionRequest: any) => Promise<Result>) => Promise<Result>;
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
  failureStylesheets?: readonly (string | StylesheetAsset)[];
  redirectTo?: string | ((result: MutationSuccess<unknown>) => string);
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
}

export type AppMutationResponsePolicy =
  | AppMutationResponseOptions
  | AppMutationResponseResolver;

export type AppMutationResponses = Readonly<Record<string, AppMutationResponsePolicy>>;

export type AppMutationResponseResolver = (
  context: AppMutationResponseContext,
) => AppMutationResponseOptions | Promise<AppMutationResponseOptions | undefined> | undefined;
