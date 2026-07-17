import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import type { VersionedClientModuleRegistry } from './client-modules.js';
import type { EgressOptions } from './egress.js';
import type { CsrfOptions } from './csrf.js';
import type { ServerErrorHandler } from './diagnostics.js';
import type { Schema } from './schema.js';
import type { DocumentCspConfig } from './csp.js';
import type { DocumentConfig, DocumentDeclaration } from './document-structured.js';
import type { EndpointDeclaration, EndpointMethod, EndpointMount } from './endpoint.js';
import type { DbProvider, LifecycleRequest, SessionProvider } from './guards.js';
import type { StylesheetAsset } from './hints.js';
import type { MutationFactory } from './mutation.js';
import type { LiveTargetRenderer } from './mutation-wire.js';
import type { QueryFactory } from './query.js';
import type { ServerRenderable } from './deferred-region.js';
import type { MutationReplayStore } from './replay.js';
import type { AppResponseHeaders } from './response.js';
import type { LayoutFactory, RouteDeclaration, RouteFactory } from './route.js';
import type { TaskDefinition, TaskFactory, TaskSchedulingRequest } from './task.js';
import type { Reader } from './managed-db.js';

type AnyRouteDeclaration = RouteDeclaration<any, any, any, any, any, any>;

/**
 * Read-surface variant of an app lifecycle request. Query, layout, and route callbacks receive this
 * shape from app-scoped `createApp()` authoring helpers: if a DB provider exists, `request.db` is a
 * branded {@link Reader} whose write verbs are absent at author time and rejected by the runtime
 * proxy (SPEC §6.6 / §10.2 / §10.3).
 */
export type AppReadRequest<Request> = Request extends { db: infer DbValue }
  ? Omit<Request, 'db'> & { db: Reader<DbValue> }
  : Request;

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
  /**
   * Define a layout whose guards, queries, and render slots see the read-surface lifecycle request.
   * When the app has a DB provider, `request.db` is a branded `Reader<Db>`: write verbs are absent
   * at author time and throw at runtime (SPEC §6.6 / §10.2 / §10.3).
   */
  layout: LayoutFactory<AppReadRequest<AppRequest>>;
  /**
   * Define a query whose `load`/`guard` callbacks see the read-surface lifecycle request. Prefer
   * `context.db`/`context.request.db` over importing a module-level write handle; both are branded
   * `Reader<Db>` capabilities on the normal path (SPEC §10.2 / KV433).
   */
  query: QueryFactory<AppReadRequest<AppRequest>>;
  /** Define a mutation whose `handler`/`guard`/`transaction` callbacks see the app lifecycle request. */
  mutation: MutationFactory<AppRequest & TaskSchedulingRequest>;
  /**
   * Define a route whose `guard`/`page` callbacks see the read-surface lifecycle request. Document
   * rendering runs with a read-only managed DB handle; writes belong in `mutation()` or an audited
   * webhook/endpoint channel (SPEC §6.6 / §10.3).
   */
  route: RouteFactory<AppReadRequest<AppRequest>>;
  /** Define a durable task registry entry (SPEC §9.6). */
  task: TaskFactory;
}

export type AppAuthoringDeclarations<Declaration, AppRequest> =
  | readonly NoInfer<Declaration>[]
  | ((context: AppAuthoringContext<AppRequest>) => readonly NoInfer<Declaration>[]);

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
export type ErrorShellRenderer = (context: { request: Request; status: 403 | 404 | 500 }) =>
  | Exclude<ServerRenderable, Promise<unknown>>
  | {
      body: Exclude<ServerRenderable, Promise<unknown>>;
      headers?: AppResponseHeaders;
      status?: 403 | 404 | 500;
    }
  | Promise<
      | Exclude<ServerRenderable, Promise<unknown>>
      | {
          body: Exclude<ServerRenderable, Promise<unknown>>;
          headers?: AppResponseHeaders;
          status?: 403 | 404 | 500;
        }
    >;

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
  /** Maximum accepted requests within `windowMs` (1..1,000,000). */
  max: number;
  /** Maximum distinct keys retained for this budget (1..100,000). */
  maxKeys?: number;
  /** Sliding bucket duration in milliseconds (1..86,400,000). */
  windowMs?: number;
}

/** Per-surface request-rate budgets enforced before dispatch (SPEC §9.5). */
export interface AppRequestRateLimitOptions {
  global?: AppRateLimitOptions;
  perIp?: AppRateLimitOptions;
}

/**
 * Request-shell load-shedding configuration. Defaults are filled in by
 * `createApp()` so every app has a printable/enforceable posture (SPEC §9.5).
 */
export interface AppRequestLimitOptions extends AppRequestRateLimitOptions {
  /**
   * Maximum accepted request body size. The shell rejects an oversized `Content-Length`
   * before dispatch and wraps body readers so chunked/missing-length bodies fail with 413
   * before parse. Must be between 0 and 67,108,864 bytes; the gate cannot be disabled.
   */
  maxBodyBytes?: number;
  /**
   * Maximum array length a framework-owned query/list result may ship to the client wire.
   * Defaults to the API4 resource-consumption floor; an audited large-read surface may raise it
   * up to 100,000 (SPEC §9.5).
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
  global: ResolvedAppRateLimitOptions;
  perIp: ResolvedAppRateLimitOptions;
}

/** Normalized request-shell load-shedding posture stored on `KovoApp`. */
export interface ResolvedAppRequestLimitOptions extends ResolvedAppRequestRateLimitOptions {
  clientIp?: (request: Request) => string | undefined;
  maxBodyBytes: number;
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
   * Replica-stable canonical UUIDv4 for live-target descriptor authority. Production apps with
   * live-target renderers must declare one, and distinct apps must use distinct generated ids even
   * when they ship identical client/render plans (SPEC §6.6/§9.3).
   */
  appId?: string;
  /**
   * Versioned client-module registry to inject (SPEC §9.5). Apps that emit
   * interactive client modules pass their own registry here (e.g. via
   * `createMemoryVersionedClientModuleRegistry`); when omitted, `createApp`
   * provisions a fresh in-memory registry.
   */
  clientModules?: VersionedClientModuleRegistry;
  csrf?: CsrfOptions<AppRequest>;
  db?: DbProvider<RawRequest, DbValue, SessionValue>;
  document?: AppDocumentOptions | DocumentDeclaration;
  /**
   * Optional app-declared env schema (any `s.object` validator) validated at the
   * `createApp` boot chokepoint against `envSource` (default: the bootstrap-pinned operator
   * `process.env` snapshot). In
   * production a failure refuses boot with a typed `CreateAppBootError` carrying every
   * issue at once; in development it warns instead of bricking localhost (SPEC §6.6,
   * §9.5; `plans/secure-framework.md` Tier 1). Apps declare required env once and fail
   * fast at boot rather than at the first request that reads a missing var.
   */
  env?: Schema<unknown>;
  /** Record validated against `env`. Defaults to boot-pinned operator env. Test/adapter seam. */
  envSource?: Record<string, unknown>;
  /**
   * Outbound-egress private-network deny floor (SPEC §6.6; `plans/secure-framework.md`
   * Phase 5). DEFAULT-ON fail-closed runtime *defense-in-depth* floor (NOT a by-construction
   * proof) that DENIES outbound connections to private / loopback / link-local /
   * cloud-metadata destinations at the process transport floor. Framework-owned runtime egress
   * surfaces such as durable task `ctx.fetch` additionally require an exact origin in
   * `allowDestinations`; public destinations are not implicitly trusted on those paths. Omit
   * this option to install the floor by default: production uses an empty internal allowlist,
   * while development keeps localhost/private sidecars reachable except cloud metadata. List a
   * specific internal destination by `host:port` in `allowInternal` to use exact allowlist
   * semantics in any mode. Cloud instance-metadata is reachable only from a `kovo` credential
   * factory, never via `allowInternal`. Disable only with an audited `{ enabled: false,
   * justification }` opt-out; production refuses a missing/partial or unaudited-disabled floor.
   */
  egress?: AppEgressOptions;
  /**
   * Endpoint declarations registered by the app. The endpoint DB parameter is intentionally
   * erased to `never` at this SPEC §9.1/§10.3 storage boundary: registration snapshots
   * declarations but never invokes a handler with an invented DB context. Using the bottom type
   * preserves assignability for an endpoint's concrete `EndpointDbContext<Db>` without widening
   * that context to `any`.
   */
  endpoints?: readonly EndpointDeclaration<string, EndpointMethod, EndpointMount, never>[];
  errorShells?: AppErrorShellOptions;
  mutations?: AppAuthoringDeclarations<AppMutationDeclaration<AppRequest>, AppRequest>;
  // SPEC §9.1/§10.3: apps inject a replay store so duplicate Kovo-Idem mutation requests
  // replay the stored response without re-executing the handler. Production mutation declarations
  // require createPostgresAppRuntimeDb().mutationReplayStore.
  mutationReplayStore?: MutationReplayStore;
  onError?: ServerErrorHandler;
  queries?: AppAuthoringDeclarations<AppQueryDeclaration<AppRequest>, AppRequest>;
  renderRoute?: (value: unknown, context: AppRouteRenderContext) => Promise<string> | string;
  requestLimits?: AppRequestLimitOptions;
  routes?: AppAuthoringDeclarations<AppRouteDeclaration<AppRequest>, AppRequest>;
  sessionProvider?: SessionProvider<RawRequest, SessionValue>;
  /** App-wide stylesheets inherited by route documents (SPEC §13.1). */
  stylesheets?: readonly (string | StylesheetAsset)[];
  /** Durable task declarations available to `request.schedule(...)` (SPEC §9.6). */
  tasks?: AppAuthoringDeclarations<AppTaskDeclaration, AppRequest>;
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
  readonly clientModules: VersionedClientModuleRegistry;
  readonly csrf?: CsrfOptions<any>;
  readonly db?: DbProvider<any, any, any>;
  readonly diagnostics: readonly AppDiagnostic[];
  readonly document: AppDocumentOptions;
  readonly endpoints: readonly EndpointDeclaration<string, EndpointMethod, EndpointMount>[];
  readonly errorShells: AppErrorShellOptions;
  readonly liveTargetRenderers: readonly LiveTargetRenderer<any>[];
  readonly mutations: readonly AppMutationDeclaration<any>[];
  readonly mutationReplayStore?: MutationReplayStore;
  readonly onError?: ServerErrorHandler;
  readonly queries: readonly AppQueryDeclaration<any>[];
  readonly renderRoute?: (
    value: unknown,
    context: AppRouteRenderContext,
  ) => Promise<string> | string;
  readonly requestLimits: ResolvedAppRequestLimitOptions;
  readonly routes: readonly AppRouteDeclaration<any>[];
  readonly sessionProvider?: SessionProvider<any, any>;
  /** App-wide stylesheets inherited by route documents (SPEC §13.1). */
  readonly stylesheets: readonly (string | StylesheetAsset)[];
  /** Durable task registry drained by the node JobRunner (SPEC §9.6). */
  readonly tasks: readonly AppTaskDeclaration[];
}

/** Web-standard request handler returned by `createRequestHandler()` (SPEC §9.5). */
export type RequestHandler = (request: Request) => Promise<Response>;

export interface AppMutationDeclaration<_AppRequest = unknown> {
  key: string;
  [field: string]: any;
}

/** Task declaration shape accepted by `createApp({ tasks })` and stored on `KovoApp` (SPEC §9.6). */
export type AppTaskDeclaration<_AppRequest = unknown> = TaskDefinition<string, any, any>;
