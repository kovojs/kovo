import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import type { VersionedClientModuleRegistry } from './client-modules.js';
import type { EgressOptions } from './egress.js';
import type { CsrfValidationOptions } from './csrf.js';
import type { ServerErrorHandler } from './diagnostics.js';
import type { Schema } from './schema.js';
import type { DocumentCspConfig } from './csp.js';
import type { DocumentConfig, DocumentDeclaration } from './document-structured.js';
import type { EndpointDeclaration, EndpointMethod, EndpointMount } from './endpoint.js';
import type { DbProvider, LifecycleRequest, SessionProvider } from './guards.js';
import type { StylesheetAsset } from './hints.js';
import type { MutationFactory, MutationFail, MutationSuccess } from './mutation.js';
import type { FragmentRenderer, LiveTargetRenderer } from './mutation-wire.js';
import type { QueryFactory } from './query.js';
import type { MutationReplayStore } from './replay.js';
import type { RoutePageResponse } from './response.js';
import type { LayoutFactory, RouteDeclaration, RouteFactory } from './route.js';
import type { OpaqueSessionManager } from './opaque-session.js';

type AnyRouteDeclaration = RouteDeclaration<any, any, any, any, any, any>;

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
  /**
   * SF (secure-framework Tier 3, SPEC §6.6 runtime DiD, cross-browser floor — NOT a
   * by-construction proof): app-facing third-party CSP allowlist + Trusted Types opt-in
   * threaded into the auto-attached strict document CSP. The `allowlist` APPENDS origins
   * to the overridable per-fetch directives (`script-src`/`style-src`/`frame-src`/
   * `connect-src`/`img-src`) so analytics/Stripe/Sentry embeds — denied by default since
   * there is no report-only ramp — can be declared. The non-overridable hardening
   * directives (`base-uri`/`object-src`/`form-action`/`frame-ancestors`) stay locked and
   * are unreachable from here (see {@link DocumentCspConfig} / `csp.ts`).
   */
  csp?: DocumentCspConfig;
  structured?: DocumentConfig;
  lang?: string;
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
  /** Maximum distinct keys retained for this budget. Defaults to the request-shell key cap. */
  maxKeys?: number;
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
   * Maximum accepted request body size. The shell rejects an oversized `Content-Length`
   * before dispatch and wraps body readers so chunked/missing-length bodies fail with 413
   * before parse. `false` disables the coarse body-size gate.
   */
  maxBodyBytes?: number | false;
  /**
   * Maximum array length a framework-owned query/list result may ship to the client wire.
   * Defaults to the API4 resource-consumption floor; set a larger integer for an audited
   * large-read surface (SPEC §9.5).
   */
  maxQueryListItems?: number;
  /** Optional IP key extractor used by the coarse per-IP limiter. */
  clientIp?: (request: Request) => string | undefined;
  /**
   * Trust forwarded client IP headers for the default per-IP limiter. Disabled by default;
   * adapter/operator-owned proxy boundaries must opt in (SPEC §9.5).
   */
  trustedProxy?: boolean;
  /** Additional budgets applied to `/_m/<mutation>` requests. */
  mutations?: AppRequestRateLimitOptions;
  /** Additional budgets applied to `/_q/<query>` requests. */
  queries?: AppRequestRateLimitOptions;
}

/** Normalized request-rate budget stored on the app aggregate. */
export interface ResolvedAppRateLimitOptions {
  max: number;
  maxKeys: number;
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
  maxQueryListItems: number;
  mutations: ResolvedAppRequestRateLimitOptions;
  queries: ResolvedAppRequestRateLimitOptions;
  trustedProxy: boolean;
}

/** Audited opt-out from the default-on outbound-egress private-network deny floor. */
export interface AppEgressOptOut {
  enabled: false;
  /** Why this process intentionally serves without the SSRF egress floor (SPEC §6.6). */
  justification: string;
}

/**
 * `createApp({ egress })` posture. Omit it to install the default floor; production uses an
 * empty internal allowlist while development keeps local/private sidecars reachable except
 * metadata. Pass an `EgressOptions` object to exercise exact allowlist semantics in any mode.
 * Disable only through the audited `{ enabled: false, justification }` escape.
 */
export type AppEgressOptions = EgressOptions | AppEgressOptOut | false;

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
  csrf?: CsrfValidationOptions<AppRequest>;
  db?: DbProvider<RawRequest, DbValue, SessionValue>;
  document?: AppDocumentOptions | DocumentDeclaration;
  /**
   * Optional app-declared env schema (any `s.object` validator) validated at the
   * `createApp` boot chokepoint against `envSource` (default `process.env`). In
   * production a failure refuses boot with a typed `CreateAppBootError` carrying every
   * issue at once; in development it warns instead of bricking localhost (SPEC §6.6,
   * §9.5; `plans/secure-framework.md` Tier 1). Apps declare required env once and fail
   * fast at boot rather than at the first request that reads a missing var.
   */
  env?: Schema<unknown>;
  /** Record validated against `env`. Defaults to `process.env`. Test/adapter seam. */
  envSource?: Record<string, unknown>;
  /**
   * Outbound-egress private-network deny floor (SPEC §6.6; `plans/secure-framework.md`
   * Phase 5). DEFAULT-ON fail-closed runtime *defense-in-depth* floor (NOT a by-construction
   * proof) that DENIES outbound connections to private / loopback / link-local /
   * cloud-metadata destinations while leaving all public egress unrestricted. Omit this option
   * to install the floor by default: production uses an empty internal allowlist, while
   * development keeps localhost/private sidecars reachable except cloud metadata. List a
   * specific internal destination by `host:port` in `allowInternal` to use exact allowlist
   * semantics in any mode. Cloud instance-metadata is reachable only from a `kovo` credential
   * factory, never via `allowInternal`. Disable only with an audited `{ enabled: false,
   * justification }` opt-out; production refuses a missing/partial or unaudited-disabled floor.
   */
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
  /**
   * Kovo-owned opaque session lifecycle for the request shell. When present, `createApp()`
   * wires `sessionProvider` from this manager so `req.session` is populated only after
   * store-backed opaque-id validation (SPEC §6.5 / OPP-11). Use `sessionProvider` only for
   * explicit delegated/legacy session ownership.
   */
  session?: OpaqueSessionManager<SessionValue>;
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
  requestLimits: ResolvedAppRequestLimitOptions;
  routes: readonly AppRouteDeclaration<any>[];
  session?: OpaqueSessionManager<any>;
  sessionProviderBoundary?: 'default-owned' | 'delegated' | 'owned';
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
