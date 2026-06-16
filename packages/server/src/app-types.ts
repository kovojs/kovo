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
import type { SessionProvider } from './guards.js';
import type { StylesheetAsset } from './hints.js';
import type { MutationFail, MutationSuccess } from './mutation.js';
import type { FragmentRenderer } from './mutation-wire.js';
import type { RegisteredQueryDefinition } from './query.js';
import type { MutationReplayStore } from './replay.js';
import type { RoutePageResponse } from './response.js';
import type { RouteDeclaration } from './route.js';

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

/** Options for `createApp`: the routes, queries, mutations, endpoints, document, CSRF, and session config. */
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
export interface KovoApp<SessionValue = unknown> {
  clientModules: VersionedClientModuleRegistry;
  csrf?: CsrfValidationOptions<Request>;
  diagnostics: readonly AppDiagnostic[];
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
  failureStylesheets?: readonly (string | StylesheetAsset)[];
  fragmentRenderers?: readonly FragmentRenderer[];
  redirectTo?: string | ((result: MutationSuccess<unknown>) => string);
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
}

export type AppMutationResponseResolver = (
  context: AppMutationResponseContext,
) => AppMutationResponseOptions | Promise<AppMutationResponseOptions | undefined> | undefined;
