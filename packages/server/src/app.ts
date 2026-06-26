import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { handleAppRequest } from './app-request.js';
import { routePrefetchGuardDiagnostics, routeTableDiagnostics } from './app-diagnostics.js';
import { isKovoApp } from './app-guards.js';
import { normalizeAppRequestLimits } from './app-load-shed.js';
import { registeredGeneratedMutationTouches } from './generated-mutation-registry.js';
import { queryWithGeneratedReads } from './generated-query-registry.js';
import { ensureKovoLoaderRuntimeClientModule } from './loader-runtime-client-module.js';
import { registeredGeneratedLiveTargetRenderers } from './live-target-registry.js';
import { mutation } from './mutation.js';
import {
  createMemoryOpaqueSessionStore,
  createOpaqueSessionManager,
  isOpaqueSessionProvider,
  type OpaqueSessionManager,
} from './opaque-session.js';
import { query } from './query.js';
import { layout, route } from './route.js';
import { isDocumentConfig, resolveDocumentDeclaration } from './document-structured.js';
import { resolveBootMode, validateAppEnv } from './env.js';
import { EgressFloorBootError, installEgressFloorSync, selfProbe } from './egress-bootstrap.js';
export type {
  AppEgressOptions,
  AppEgressOptOut,
  AppAuthoringContext,
  AppAuthoringDeclarations,
  AppDocumentOptions,
  DelegatedSessionProvider,
  AppErrorShellOptions,
  AppDiagnostic,
  AppLifecycleRequest,
  AppMutationDeclaration,
  AppMutationResponseContext,
  AppMutationResponseOptions,
  AppMutationResponsePolicy,
  AppMutationResponseResolver,
  AppMutationResponses,
  AppQueryDeclaration,
  AppRateLimitOptions,
  AppRequestLimitOptions,
  AppRequestRateLimitOptions,
  AppRouteDeclaration,
  AppRouteRenderContext,
  CreateAppOptions,
  DelegatedSessionLifecycleAssertions,
  ErrorShellRenderer,
  KovoApp,
  RequestHandler,
  ResolvedAppRateLimitOptions,
  ResolvedAppRequestLimitOptions,
  ResolvedAppRequestRateLimitOptions,
} from './app-types.js';
import type { SessionProvider } from './guards.js';
import {
  markNormalizedSessionProvider,
  type SessionProviderBoundary,
} from './session-provider-boundary.js';
import type { EgressOptions } from './egress.js';
import type { LiveTargetRenderer } from './mutation-wire.js';
import type { QueryDefinition } from './query.js';
import type { LayoutDeclaration } from './route.js';
import type {
  AppEgressOptions,
  AppAuthoringContext,
  AppAuthoringDeclarations,
  DelegatedSessionProvider,
  DelegatedSessionLifecycleAssertions,
  AppLifecycleRequest,
  AppMutationDeclaration,
  CreateAppOptions,
  KovoApp,
  RequestHandler,
} from './app-types.js';

/**
 * Assemble the app aggregate: the routes, queries, mutations, endpoints,
 * document options, and session provider that make up a Kovo application. The
 * returned `KovoApp` is the single object request dispatch starts from; pass it
 * to `createRequestHandler` or a platform adapter like `toNodeHandler`
 * (SPEC §9.5).
 *
 * @param options - Routes, queries, mutations, endpoints, document, CSRF, and session config.
 * @returns A `KovoApp` aggregate with defaults filled in.
 * @example
 * import { createApp, createRequestHandler, route } from '@kovojs/server';
 *
 * const app = createApp({
 *   routes: [route('/', { page: () => <h1>Home</h1> })],
 * });
 *
 * export const handler = createRequestHandler(app);
 */
export function createApp<
  SessionValue = never,
  DbValue = never,
  RawRequest extends globalThis.Request = globalThis.Request,
  AppRequest = AppLifecycleRequest<RawRequest, SessionValue, DbValue>,
>(
  options: CreateAppOptions<SessionValue, DbValue, RawRequest, AppRequest> = {},
): KovoApp<SessionValue, DbValue, RawRequest, AppRequest> {
  // Refuse to boot — by-construction at the bootstrap chokepoint (SPEC §6.6,
  // §9.5; plans/secure-framework.md Tier 1). In production a missing/empty/short
  // framework signing secret (today the CSRF/anonymous-CSRF HMAC secret) or an
  // app-declared `env` schema failure throws CreateAppBootError before the app is
  // assembled. Dev stays lenient (warns, never bricks localhost).
  validateAppEnv(
    { csrfSecret: options.csrf?.secret },
    {
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.envSource === undefined ? {} : { envSource: options.envSource }),
    },
  );

  bootstrapEgressFloor(options.egress);

  const authoringContext = appAuthoringContext<AppRequest>();
  const routes = resolveAppAuthoringDeclarations(options.routes, authoringContext);
  const liveTargetRenderers =
    options.liveTargetRenderers ?? registeredGeneratedLiveTargetRenderers();
  const queries = appQueryRegistry(
    resolveAppAuthoringDeclarations(options.queries, authoringContext) as readonly QueryDefinition<
      string,
      unknown,
      unknown,
      AppRequest
    >[],
    liveTargetRendererQueries(liveTargetRenderers),
    routeLayoutQueries(routes),
  );
  const mutations = assertUniqueMutationKeys(
    resolveAppAuthoringDeclarations(options.mutations, authoringContext).map(
      withGeneratedMutationTouches,
    ),
  );
  const clientModules = options.clientModules ?? createMemoryVersionedClientModuleRegistry();
  ensureKovoLoaderRuntimeClientModule(clientModules);
  const session = resolveAppSession(options);
  const delegatedSessionProvider =
    options.sessionProvider === undefined
      ? undefined
      : resolveDelegatedSessionProvider(options.sessionProvider);
  const rawSessionProvider =
    session === undefined ? delegatedSessionProvider : resolveAppSessionProvider(session);
  const sessionProviderBoundary = appSessionProviderBoundary(options, rawSessionProvider);
  const sessionProvider =
    rawSessionProvider === undefined || sessionProviderBoundary === undefined
      ? undefined
      : markNormalizedSessionProvider(rawSessionProvider, sessionProviderBoundary);

  return {
    clientModules,
    diagnostics: [...routeTableDiagnostics(routes), ...routePrefetchGuardDiagnostics(routes)],
    document: normalizeAppDocumentOptions(options.document),
    endpoints: options.endpoints ?? [],
    errorShells: options.errorShells ?? {},
    liveTargetRenderers,
    mutations,
    queries,
    requestLimits: normalizeAppRequestLimits(options.requestLimits),
    routes,
    stylesheets: options.stylesheets ?? [],
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(options.db === undefined ? {} : { db: options.db }),
    mutationResponses: options.mutationResponses ?? {},
    ...(options.mutationReplayStore === undefined
      ? {}
      : { mutationReplayStore: options.mutationReplayStore }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.renderRoute === undefined ? {} : { renderRoute: options.renderRoute }),
    ...(session === undefined ? {} : { session }),
    ...(sessionProviderBoundary === undefined ? {} : { sessionProviderBoundary }),
    ...(sessionProvider === undefined ? {} : { sessionProvider }),
  };
}

function appSessionProviderBoundary<
  SessionValue,
  DbValue,
  RawRequest extends globalThis.Request,
  AppRequest,
>(
  options: CreateAppOptions<SessionValue, DbValue, RawRequest, AppRequest>,
  sessionProvider: unknown,
): SessionProviderBoundary | undefined {
  if (sessionProvider === undefined) return undefined;
  if (options.sessionProvider !== undefined) return 'delegated';
  if (options.session !== undefined) return 'owned';
  return 'default-owned';
}

function resolveAppSession<
  SessionValue,
  DbValue,
  RawRequest extends globalThis.Request,
  AppRequest,
>(
  options: CreateAppOptions<SessionValue, DbValue, RawRequest, AppRequest>,
): OpaqueSessionManager<SessionValue> | undefined {
  if (options.session !== undefined && options.sessionProvider !== undefined) {
    throw new Error(
      'createApp() received both `session` and `sessionProvider`. `session` gives the request ' +
        'shell Kovo-owned opaque session lifecycle control (SPEC §6.5 / OPP-11); use ' +
        '`sessionProvider` only for an explicit delegated session boundary.',
    );
  }
  if (options.sessionProvider !== undefined) {
    resolveDelegatedSessionProvider(options.sessionProvider);
    return undefined;
  }
  if (options.session !== undefined) return options.session;

  // OPP-11 default posture: when the app does not explicitly delegate session provenance,
  // the request shell owns an opaque, store-validated lifecycle instead of having no
  // session boundary at all. SPEC §6.5 still permits explicit delegated providers.
  return createOpaqueSessionManager<SessionValue>({
    store: createMemoryOpaqueSessionStore<SessionValue>(),
  });
}

function resolveDelegatedSessionProvider<SessionValue, RawRequest extends globalThis.Request>(
  declaration: DelegatedSessionProvider<RawRequest, SessionValue>,
): SessionProvider<RawRequest, SessionValue> {
  const value = declaration as unknown;
  if (typeof value === 'function') {
    throw new Error(
      'createApp({ sessionProvider }) now requires an explicit delegated lifecycle declaration: ' +
        "{ lifecycle: 'delegated', provider, justification, lifecycleAssertions }. Kovo owns " +
        'opaque sessions by ' +
        'default; use `session` for Kovo-owned opaque lifecycle or declare why a delegated ' +
        'provider owns validation, rotation, expiry, and revocation (SPEC §6.5 / OPP-11).',
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'createApp({ sessionProvider }) must be a delegated lifecycle declaration with ' +
        "`lifecycle: 'delegated'`, `provider`, and `justification` (SPEC §6.5 / OPP-11).",
    );
  }
  const record = value as {
    justification?: unknown;
    lifecycle?: unknown;
    lifecycleAssertions?: unknown;
    provider?: unknown;
  };
  if (record.lifecycle !== 'delegated') {
    throw new Error(
      "createApp({ sessionProvider }) requires `lifecycle: 'delegated'` for non-opaque " +
        'session ownership (SPEC §6.5 / OPP-11).',
    );
  }
  if (typeof record.provider !== 'function') {
    throw new Error(
      'createApp({ sessionProvider }) requires a callable delegated `provider` ' +
        '(SPEC §6.5 / OPP-11).',
    );
  }
  if (typeof record.justification !== 'string' || record.justification.trim() === '') {
    throw new Error(
      'createApp({ sessionProvider }) requires a non-empty delegated session justification ' +
        'covering validation, rotation, expiry, and revocation ownership (SPEC §6.5 / OPP-11).',
    );
  }
  assertDelegatedLifecycleAssertions(record.lifecycleAssertions);
  if (isOpaqueSessionProvider(record.provider)) {
    throw new Error(
      'createApp() received a Kovo-owned opaque session provider through `sessionProvider`. ' +
        'Pass the manager as `session` so the request shell records an owned opaque session ' +
        'boundary; reserve `sessionProvider` for explicitly justified delegated session ' +
        'ownership (SPEC §6.5 / OPP-11).',
    );
  }
  return record.provider as SessionProvider<RawRequest, SessionValue>;
}

function assertDelegatedLifecycleAssertions(
  value: unknown,
): asserts value is DelegatedSessionLifecycleAssertions {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'createApp({ sessionProvider }) requires delegated `lifecycleAssertions` with ' +
        'non-empty validation, rotation, expiry, and revocation ownership fields ' +
        '(SPEC §6.5 / OPP-11).',
    );
  }
  for (const field of ['validation', 'rotation', 'expiry', 'revocation'] as const) {
    const assertion = (value as Record<string, unknown>)[field];
    if (typeof assertion !== 'string' || assertion.trim() === '') {
      throw new Error(
        `createApp({ sessionProvider }) requires a non-empty delegated lifecycleAssertions.${field} ` +
          'ownership assertion (SPEC §6.5 / OPP-11).',
      );
    }
  }
}

function resolveAppSessionProvider<SessionValue, RawRequest extends globalThis.Request>(
  session: OpaqueSessionManager<SessionValue>,
): SessionProvider<RawRequest, SessionValue> {
  return session.provider as SessionProvider<RawRequest, SessionValue>;
}

function bootstrapEgressFloor(egress: AppEgressOptions | undefined): void {
  const mode = resolveBootMode();
  const warn = (message: string): void => console.warn(`[kovo egress] ${message}`);

  if (isEgressOptOut(egress)) {
    if (egress.justification.trim() === '') {
      refuseOrWarnUnauditedDisabledEgress(mode, warn);
      return;
    }
    if (mode !== 'production') {
      warn(
        `createApp({ egress: { enabled: false } }) disables the default SSRF egress floor ` +
          `in development (${egress.justification}; SPEC §6.6 runtime defense-in-depth).`,
      );
    }
    return;
  }

  if (egress === false) {
    refuseOrWarnUnauditedDisabledEgress(mode, warn);
    return;
  }

  const devDefault = mode !== 'production' && egress === undefined;
  // SPEC §6.6 outbound egress: default-on runtime defense-in-depth floor. Production and
  // explicit operator config preserve empty-allowlist deny semantics. The omitted development
  // default keeps the floor installed and metadata blocked, but permits localhost/private
  // sidecars so development boot does not brick ordinary DB/Redis/OTel/Ollama setups.
  installEgressFloorSync(egress as EgressOptions | undefined, warn, {
    allowPrivateNetwork: devDefault,
  });
  if (devDefault) {
    warn(
      'createApp() installed the default outbound-egress floor in development with local ' +
        'private-network destinations permitted; cloud metadata remains blocked. Pass ' +
        '`egress: { allowInternal: [] }` to exercise production empty-allowlist semantics.',
    );
  }
  if (mode === 'production') {
    try {
      selfProbe(() => {}, { failure: 'throw' });
    } catch (error) {
      throw new EgressFloorBootError(
        `createApp() refused to boot: the default-on outbound-egress floor is missing, ` +
          `partial, or tampered in production (SPEC §6.6). ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }
}

function isEgressOptOut(value: AppEgressOptions | undefined): value is {
  enabled: false;
  justification: string;
} {
  return (
    typeof value === 'object' && value !== null && 'enabled' in value && value.enabled === false
  );
}

function refuseOrWarnUnauditedDisabledEgress(
  mode: 'production' | 'development',
  warn: (message: string) => void,
): void {
  const message =
    'createApp() has the default-on outbound-egress private-network deny floor disabled ' +
    'without an audited non-empty justification. Use ' +
    '`createApp({ egress: { enabled: false, justification: "..." } })` only when this ' +
    'process is intentionally protected by an external SSRF/metadata-control boundary ' +
    '(SPEC §6.6 runtime defense-in-depth).';
  if (mode === 'production') {
    throw new EgressFloorBootError(`createApp() refused to boot: ${message}`);
  }
  warn(`${message} Development stays lenient; production refuses to boot.`);
}

function normalizeAppDocumentOptions(
  document: CreateAppOptions['document'] | undefined,
): KovoApp['document'] {
  if (document === undefined) return {};
  if (isDocumentConfig(document) || typeof document === 'function') {
    const structured = resolveDocumentDeclaration(document);
    return {
      ...(structured?.lang === undefined ? {} : { lang: structured.lang }),
      ...(structured === undefined ? {} : { structured }),
    };
  }
  if ('template' in document) {
    throw new TypeError(
      'createApp({ document.template }) is not supported. Use structured document primitives such as Document, Head, BodyStart, and BodyEnd (SPEC.md §9.5).',
    );
  }
  return document;
}

/**
 * Fail closed on duplicate `app.mutations[].key` at handler-build time. SPEC §6.1 makes the
 * mutation registry key-addressed and SPEC §9.5 dispatches a POST to exactly one keyed handler;
 * `app-mutation-request.ts` resolves the handler with `.find(c => c.key === key)` (first-match),
 * so a second same-key mutation would be unreachable dead code while the compile-time invalidation
 * registry silently last-write-wins the *other* declaration — the two layers would disagree and
 * the wrong handler (with the wrong input schema and guards) could run. We reject here rather than
 * silently first-match-winning so the ambiguity surfaces at build, mirroring KV421.
 */
function assertUniqueMutationKeys<Mutation extends AppMutationDeclaration<any>>(
  mutations: readonly Mutation[],
): readonly Mutation[] {
  const seen = new Set<string>();
  for (const mutation of mutations) {
    if (seen.has(mutation.key)) {
      throw new Error(
        `createApp() received two mutations with the same key "${mutation.key}". ` +
          'Mutation keys address one handler for request dispatch (SPEC §6.1, §9.5); a duplicate ' +
          'key makes the second handler unreachable and the invalidation registry ambiguous. ' +
          'Rename one mutation so its key is unique (compile diagnostic KV421).',
      );
    }
    seen.add(mutation.key);
  }
  return mutations;
}

function withGeneratedMutationTouches<Mutation extends AppMutationDeclaration<any>>(
  definition: Mutation,
): Mutation {
  const inferredTouches = registeredGeneratedMutationTouches(definition.key);
  if (inferredTouches.length === 0) return definition;

  return {
    ...definition,
    registry: {
      ...definition.registry,
      inferredTouches,
    },
  };
}

/**
 * Turn a `KovoApp` into a `(request: Request) => Response` handler that dispatches
 * to routes, queries, mutations, and endpoints. Requires an app built by
 * `createApp` (SPEC §9.5).
 *
 * @param app - An app aggregate from `createApp`.
 * @returns A request handler suitable for the platform's server.
 */
export function createRequestHandler(app: KovoApp): RequestHandler {
  if (!isKovoApp(app)) {
    throw new TypeError(
      'createRequestHandler() requires a Kovo app aggregate. SPEC §9.5 request dispatch must start from createApp(), not a raw request handler or compatibility shell.',
    );
  }

  return (request) => handleAppRequest(app, request);
}

function appAuthoringContext<AppRequest>(): AppAuthoringContext<AppRequest> {
  return {
    layout: layout as AppAuthoringContext<AppRequest>['layout'],
    mutation: mutation as AppAuthoringContext<AppRequest>['mutation'],
    query: query as AppAuthoringContext<AppRequest>['query'],
    route: route as AppAuthoringContext<AppRequest>['route'],
  };
}

function resolveAppAuthoringDeclarations<Declaration, AppRequest>(
  declarations: AppAuthoringDeclarations<Declaration, AppRequest> | undefined,
  context: AppAuthoringContext<AppRequest>,
): readonly Declaration[] {
  if (declarations === undefined) return [];
  return typeof declarations === 'function'
    ? (declarations(context) as readonly Declaration[])
    : declarations;
}

function appQueryRegistry<Request>(
  ...groups: readonly (readonly QueryDefinition<string, unknown, unknown, Request>[])[]
): readonly QueryDefinition<string, unknown, unknown, Request>[] {
  const queries = new Map<string, QueryDefinition<string, unknown, unknown, Request>>();

  for (const group of groups) {
    for (const queryDefinition of group) {
      const generatedQueryDefinition = queryWithGeneratedReads(queryDefinition);
      if (!queries.has(generatedQueryDefinition.key)) {
        queries.set(generatedQueryDefinition.key, generatedQueryDefinition);
      }
    }
  }

  return [...queries.values()];
}

function liveTargetRendererQueries<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
): readonly QueryDefinition<string, unknown, unknown, Request>[] {
  return renderers.flatMap((renderer) => renderer.queryDefinitions ?? []);
}

function routeLayoutQueries<Request>(
  routes: readonly { layout?: LayoutDeclaration<any, any, any> }[],
): readonly QueryDefinition<string, unknown, unknown, Request>[] {
  const queries: QueryDefinition<string, unknown, unknown, Request>[] = [];

  for (const routeDeclaration of routes) {
    for (const layoutDeclaration of layoutChain(routeDeclaration.layout)) {
      queries.push(
        ...Object.values(layoutDeclaration.queries ?? {}).map(
          (queryDefinition) =>
            queryDefinition as QueryDefinition<string, unknown, unknown, Request>,
        ),
      );
    }
  }

  return queries;
}

function layoutChain(
  layoutDeclaration: LayoutDeclaration<any, any, any> | undefined,
): LayoutDeclaration<any, any, any>[] {
  const chain: LayoutDeclaration<any, any, any>[] = [];
  const seen = new Set<LayoutDeclaration<any, any, any>>();
  let current = layoutDeclaration;

  while (current) {
    if (seen.has(current)) {
      throw new Error('Cyclic route layout parent chain.');
    }
    seen.add(current);
    chain.unshift(current);
    current = current.parent;
  }

  return chain;
}
