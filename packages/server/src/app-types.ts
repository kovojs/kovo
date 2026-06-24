import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import type { VersionedClientModuleRegistry } from './client-modules.js';
import type { AppCapabilityUrlOptions } from './capability-url.js';
import type { CsrfValidationOptions } from './csrf.js';
import type { ServerErrorHandler } from './diagnostics.js';
import type { DocumentTemplate } from './document-core.js';
import type { AppEgressOptions, ResolvedAppEgressOptions } from './egress.js';
import type { EndpointDeclaration, EndpointMethod, EndpointMount } from './endpoint.js';
import type { DbProvider, LifecycleRequest, SessionProvider } from './guards.js';
import type { StylesheetAsset } from './hints.js';
import type { MutationFactory, MutationFail, MutationSuccess } from './mutation.js';
import type { FragmentRenderer, LiveTargetRenderer } from './mutation-wire.js';
import type { QueryFactory } from './query.js';
import type { MutationReplayStore } from './replay.js';
import type { RoutePageResponse } from './response.js';
import type { LayoutFactory, RouteDeclaration, RouteFactory } from './route.js';

type AnyRouteDeclaration = RouteDeclaration<any, any, any, any, any, any>;

export type { AppEgressOptions, ResolvedAppEgressOptions } from './egress.js';

export type AppLifecycleRequest<
  RawRequest extends globalThis.Request = globalThis.Request,
  SessionValue = never,
  DbValue = never,
> = LifecycleRequest<RawRequest, SessionValue, DbValue>;

export interface AppQueryDeclaration<_AppRequest = unknown> {
  key: string;
  [field: string]: any;
}

export type AppRouteDeclaration<_AppRequest = unknown> = RouteDeclaration<
  any,
  any,
  any,
  any,
  any,
  any
>;

/**
 * App-scoped declaration helpers. When `createApp()` receives provider options, these helpers
 * contextually type query loaders, mutation handlers, and route guards/pages with the provider
 * request shape (SPEC §9.5/§10.2/§10.3).
 */
export interface AppAuthoringContext<AppRequest> {
  /** Define a layout whose guards, queries, and render slots see the app lifecycle request. */
  layout: LayoutFactory<AppRequest>;
  /** Define a query whose `load`/`guard` callbacks see the app lifecycle request. */
  query: QueryFactory<AppRequest>;
  /** Define a mutation whose `handler`/`guard`/`transaction` callbacks see the app lifecycle request. */
  mutation: MutationFactory<AppRequest>;
  /** Define a route whose `guard`/`page` callbacks see the app lifecycle request. */
  route: RouteFactory<AppRequest>;
}

export type AppAuthoringDeclarations<Declaration, AppRequest> =
  | readonly Declaration[]
  | ((context: AppAuthoringContext<AppRequest>) => readonly unknown[]);

/**
 * Optional shell renderers for framework-owned error pages in the request shell
 * (SPEC §9.5).
 */
export interface AppErrorShellOptions {
  forbidden?: ErrorShellRenderer;
  notFound?: ErrorShellRenderer;
  serverError?: ErrorShellRenderer;
}

/**
 * Render an app-provided 403, 404, or 500 shell response for request-shell errors
 * (SPEC §9.5).
 */
export type ErrorShellRenderer = (context: {
  request: Request;
  status: 403 | 404 | 500;
}) => RoutePageResponse | Promise<RoutePageResponse>;

/** Document-level options applied by `createApp()` when rendering route documents. */
export interface AppDocumentOptions {
  lang?: string;
  template?: DocumentTemplate;
}

/** Request-shell context passed to a custom `renderRoute` hook (SPEC §9.5). */
export interface AppRouteRenderContext<Route extends AnyRouteDeclaration = AnyRouteDeclaration> {
  params: Record<string, string>;
  request: Request;
  route: Route;
  search: Record<string, string | string[]>;
}

/** Coarse request-rate budget enforced by the request shell before dispatch (SPEC §9.5). */
export interface AppRateLimitOptions {
  /** Maximum accepted requests within `windowMs`. */
  max: number;
  /** Sliding bucket duration in milliseconds. Defaults to the request-shell default window. */
  windowMs?: number;
}

/** Per-surface request-rate budgets enforced before dispatch (SPEC §9.5). */
export interface AppRequestRateLimitOptions {
  global?: AppRateLimitOptions | false;
  perIp?: AppRateLimitOptions | false;
}

/**
 * Request-shell load-shedding configuration. Defaults are filled in by
 * `createApp()` so every app has a printable/enforceable posture (SPEC §9.5).
 */
export interface AppRequestLimitOptions extends AppRequestRateLimitOptions {
  /**
   * Maximum accepted request body size, checked from Content-Length before the body
   * is read. `false` disables the coarse body-size gate.
   */
  maxBodyBytes?: number | false;
  /** Optional IP key extractor used by the coarse per-IP limiter. */
  clientIp?: (request: Request) => string | undefined;
  /** Additional budgets applied to `/_m/<mutation>` requests. */
  mutations?: AppRequestRateLimitOptions;
  /** Additional budgets applied to `/_q/<query>` requests. */
  queries?: AppRequestRateLimitOptions;
}

/** Normalized request-rate budget stored on the app aggregate. */
export interface ResolvedAppRateLimitOptions {
  max: number;
  windowMs: number;
}

/** Normalized per-surface request-rate budgets stored on the app aggregate. */
export interface ResolvedAppRequestRateLimitOptions {
  global: ResolvedAppRateLimitOptions | false;
  perIp: ResolvedAppRateLimitOptions | false;
}

/** Normalized request-shell load-shedding posture stored on `KovoApp`. */
export interface ResolvedAppRequestLimitOptions extends ResolvedAppRequestRateLimitOptions {
  clientIp?: (request: Request) => string | undefined;
  maxBodyBytes: number | false;
  mutations: ResolvedAppRequestRateLimitOptions;
  queries: ResolvedAppRequestRateLimitOptions;
}

/** Options for `createApp`: the routes, queries, mutations, endpoints, document, CSRF, and request providers. */
export interface CreateAppOptions<
  SessionValue = never,
  DbValue = never,
  RawRequest extends globalThis.Request = globalThis.Request,
  AppRequest = AppLifecycleRequest<RawRequest, SessionValue, DbValue>,
> {
  /**
   * Versioned client-module registry to inject (SPEC §9.5). Apps that emit
   * interactive client modules pass their own registry here (e.g. via
   * `createMemoryVersionedClientModuleRegistry`); when omitted, `createApp`
   * provisions a fresh in-memory registry.
   */
  clientModules?: VersionedClientModuleRegistry;
  capabilityUrls?: AppCapabilityUrlOptions | false;
  csrf?: CsrfValidationOptions<AppRequest>;
  db?: DbProvider<RawRequest, DbValue, SessionValue>;
  document?: AppDocumentOptions;
  egress?: AppEgressOptions;
  endpoints?: readonly EndpointDeclaration<string, EndpointMethod, EndpointMount>[];
  errorShells?: AppErrorShellOptions;
  liveTargetRenderers?: readonly LiveTargetRenderer<AppRequest>[];
  mutationResponses?: AppMutationResponses;
  mutations?: AppAuthoringDeclarations<AppMutationDeclaration<AppRequest>, AppRequest>;
  // SPEC §9.1/§10.3: apps inject a replay store so duplicate Kovo-Idem mutation
  // requests replay the stored response without re-executing the handler.
  mutationReplayStore?: MutationReplayStore;
  onError?: ServerErrorHandler;
  queries?: AppAuthoringDeclarations<AppQueryDeclaration<AppRequest>, AppRequest>;
  renderRoute?: (value: unknown, context: AppRouteRenderContext) => Promise<string> | string;
  requestLimits?: AppRequestLimitOptions | false;
  routes?: AppAuthoringDeclarations<AppRouteDeclaration<AppRequest>, AppRequest>;
  sessionProvider?: SessionProvider<RawRequest, SessionValue>;
  /** App-wide stylesheets inherited by route documents (SPEC §13.1). */
  stylesheets?: readonly (string | StylesheetAsset)[];
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
  _SessionValue = unknown,
  _DbValue = unknown,
  _RawRequest extends globalThis.Request = globalThis.Request,
  _AppRequest = any,
> {
  clientModules: VersionedClientModuleRegistry;
  capabilityUrls?: AppCapabilityUrlOptions;
  csrf?: CsrfValidationOptions<any>;
  db?: DbProvider<any, any, any>;
  diagnostics: readonly AppDiagnostic[];
  document: AppDocumentOptions;
  egress: ResolvedAppEgressOptions;
  endpoints: readonly EndpointDeclaration<string, EndpointMethod, EndpointMount>[];
  errorShells: AppErrorShellOptions;
  liveTargetRenderers: readonly LiveTargetRenderer<any>[];
  mutationResponses: AppMutationResponses;
  mutations: readonly AppMutationDeclaration<any>[];
  mutationReplayStore?: MutationReplayStore;
  onError?: ServerErrorHandler;
  queries: readonly AppQueryDeclaration<any>[];
  renderRoute?: (value: unknown, context: AppRouteRenderContext) => Promise<string> | string;
  requestLimits: ResolvedAppRequestLimitOptions;
  routes: readonly AppRouteDeclaration<any>[];
  sessionProvider?: SessionProvider<any, any>;
  /** App-wide stylesheets inherited by route documents (SPEC §13.1). */
  stylesheets: readonly (string | StylesheetAsset)[];
}

/** Web-standard request handler returned by `createRequestHandler()` (SPEC §9.5). */
export type RequestHandler = (request: Request) => Promise<Response>;

export interface AppMutationDeclaration<_AppRequest = unknown> {
  key: string;
  [field: string]: any;
}

/**
 * Runtime context passed to mutation response resolvers when the request shell
 * builds redirect, fragment, or failure responses (SPEC §9.5).
 */
export interface AppMutationResponseContext {
  currentUrl: string;
  key: string;
  mutation: AppMutationDeclaration;
  rawInput: unknown;
  request: Request;
  url: URL;
}

/**
 * Per-mutation response policy used by the request shell after a mutation handler
 * succeeds or fails (SPEC §9.5).
 */
export interface AppMutationResponseOptions {
  csrf?: CsrfValidationOptions<Request>;
  failureTarget?: string;
  failureStylesheets?: readonly (string | StylesheetAsset)[];
  fragmentRenderers?: readonly FragmentRenderer[];
  redirectTo?: string | ((result: MutationSuccess<unknown>) => string);
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
}

export type AppMutationResponsePolicy = AppMutationResponseOptions | AppMutationResponseResolver;

export type AppMutationResponses = Readonly<Record<string, AppMutationResponsePolicy>>;

/**
 * Resolve mutation response policy from the current mutation request instead of
 * declaring static options up front (SPEC §9.5).
 */
export type AppMutationResponseResolver = (
  context: AppMutationResponseContext,
) => AppMutationResponseOptions | Promise<AppMutationResponseOptions | undefined> | undefined;
