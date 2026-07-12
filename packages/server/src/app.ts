import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { handleAppRequest, reportAppStartupError } from './app-request.js';
import { routePrefetchGuardDiagnostics, routeTableDiagnostics } from './app-diagnostics.js';
import { isKovoApp } from './app-guards.js';
import {
  closeKovoAppAggregate,
  createAppDeclarationSnapshotContext,
  snapshotAppEndpoint,
  snapshotAppMutation,
  snapshotAppQuery,
  snapshotAppRegistry,
  snapshotAppRoute,
  snapshotLiveTargetRenderers,
} from './app-snapshot.js';
import { normalizeAppRequestLimits } from './app-load-shed.js';
import { createAppTaskRuntime, registerAppTaskRuntime } from './task-runtime.js';
import { ensureKovoLoaderRuntimeClientModule } from './loader-runtime-client-module.js';
import { registeredGeneratedLiveTargetRenderers } from './live-target-registry.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { layout, route } from './route.js';
import { task } from './task.js';
import { runtimeRegistryFacts } from './registry-facts.js';
import {
  isDocumentConfig,
  resolveDocumentDeclaration,
  snapshotDocumentConfig,
} from './document-structured.js';
import { resolveBootMode, validateAppEnv } from './env.js';
import { EgressFloorBootError, installEgressFloorSync, selfProbe } from './egress-bootstrap.js';
export type {
  AppEgressOptions,
  AppEgressOptOut,
  AppAuthoringContext,
  AppAuthoringDeclarations,
  AppDocumentOptions,
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
  AppTaskDeclaration,
  CreateAppOptions,
  ErrorShellRenderer,
  KovoApp,
  RequestHandler,
  ResolvedAppRateLimitOptions,
  ResolvedAppRequestLimitOptions,
  ResolvedAppRequestRateLimitOptions,
} from './app-types.js';
import type { EgressOptions } from './egress.js';
import type {
  AppEgressOptions,
  AppAuthoringContext,
  AppAuthoringDeclarations,
  AppLifecycleRequest,
  AppMutationDeclaration,
  AppQueryDeclaration,
  AppRouteDeclaration,
  AppTaskDeclaration,
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
  const snapshotContext = createAppDeclarationSnapshotContext();
  const routes = snapshotAppRegistry(
    resolveAppAuthoringDeclarations<AppRouteDeclaration<AppRequest>, AppRequest>(
      options.routes,
      authoringContext,
    ) as readonly AppRouteDeclaration<AppRequest>[],
    'createApp.routes',
    (declaration) => snapshotAppRoute(declaration, snapshotContext),
  );
  const liveTargetRenderers = snapshotLiveTargetRenderers(
    options.liveTargetRenderers ?? registeredGeneratedLiveTargetRenderers(),
    snapshotContext,
  );
  const authoredMutations = assertUniqueMutationKeys(
    snapshotAppRegistry(
      resolveAppAuthoringDeclarations<AppMutationDeclaration<AppRequest>, AppRequest>(
        options.mutations,
        authoringContext,
      ),
      'createApp.mutations',
      (declaration) => snapshotAppMutation(declaration, snapshotContext),
    ),
  );
  const authoredQueries = snapshotAppRegistry(
    resolveAppAuthoringDeclarations<AppQueryDeclaration<AppRequest>, AppRequest>(
      options.queries,
      authoringContext,
    ),
    'createApp.queries',
    (declaration) => snapshotAppQuery(declaration, snapshotContext),
  );
  const endpoints = snapshotAppRegistry(
    options.endpoints ?? [],
    'createApp.endpoints',
    (declaration) => snapshotAppEndpoint(declaration, snapshotContext),
  );
  const runtimeFacts = runtimeRegistryFacts({
    liveTargetRenderers,
    mutations: authoredMutations,
    queries: authoredQueries,
    routes,
  });
  const queries = snapshotAppRegistry(runtimeFacts.queries, 'app.queries', (declaration) =>
    snapshotAppQuery(declaration, snapshotContext),
  );
  const mutations = snapshotAppRegistry(runtimeFacts.mutations, 'app.mutations', (declaration) =>
    snapshotAppMutation(declaration, snapshotContext),
  );
  const tasks = assertUniqueTaskKeys(
    resolveAppAuthoringDeclarations<AppTaskDeclaration<AppRequest>, AppRequest>(
      options.tasks,
      authoringContext,
    ),
  );
  const clientModules = options.clientModules ?? createMemoryVersionedClientModuleRegistry();
  ensureKovoLoaderRuntimeClientModule(clientModules);

  return closeKovoAppAggregate(
    {
      clientModules,
      diagnostics: [...routeTableDiagnostics(routes), ...routePrefetchGuardDiagnostics(routes)],
      document: normalizeAppDocumentOptions(options.document),
      endpoints,
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
      ...(options.sessionProvider === undefined
        ? {}
        : { sessionProvider: options.sessionProvider }),
      tasks,
    } as KovoApp<SessionValue, DbValue, RawRequest, AppRequest>,
    snapshotContext,
  );
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
  if (document === undefined) return Object.freeze({});
  if (isDocumentConfig(document) || typeof document === 'function') {
    const structured = resolveDocumentDeclaration(document);
    if (structured === undefined || !isDocumentConfig(structured)) {
      throw new TypeError(
        'createApp({ document }) structured declarations must return Document(...) (SPEC §9.5).',
      );
    }
    const snapshot = snapshotDocumentConfig(structured);
    return Object.freeze({
      ...(snapshot.lang === undefined ? {} : { lang: snapshot.lang }),
      structured: snapshot,
    });
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new TypeError('createApp({ document }) must be a stable options object (SPEC §9.5).');
  }
  const record = document as unknown as Record<PropertyKey, unknown>;
  if (Object.getOwnPropertyDescriptor(record, 'template') !== undefined) {
    throw new TypeError(
      'createApp({ document.template }) is not supported. Use structured document primitives such as Document, Head, BodyStart, and BodyEnd (SPEC.md §9.5).',
    );
  }
  const lang = appDocumentOwnDataValue(record, 'lang');
  if (lang !== undefined && typeof lang !== 'string') {
    throw new TypeError('createApp({ document.lang }) must be a string (SPEC §9.5).');
  }
  const csp = appDocumentOwnDataValue(record, 'csp');
  const structured = appDocumentOwnDataValue(record, 'structured');
  if (structured !== undefined && !isDocumentConfig(structured)) {
    throw new TypeError(
      'createApp({ document.structured }) requires a genuine Document(...) config (SPEC §9.5).',
    );
  }
  return Object.freeze({
    ...(csp === undefined ? {} : { csp: snapshotAppDocumentCsp(csp) }),
    ...(lang === undefined ? {} : { lang }),
    ...(structured === undefined ? {} : { structured: snapshotDocumentConfig(structured) }),
  });
}

function snapshotAppDocumentCsp(value: unknown): NonNullable<KovoApp['document']['csp']> {
  const record = appDocumentRecord(value, 'document.csp');
  const allowlist = appDocumentOwnDataValue(record, 'allowlist');
  const reporting = appDocumentOwnDataValue(record, 'reporting');
  const trustedTypes = appDocumentOwnDataValue(record, 'trustedTypes');
  if (trustedTypes !== undefined && typeof trustedTypes !== 'boolean') {
    throw new TypeError('createApp document.csp.trustedTypes must be boolean (SPEC §6.6).');
  }
  if (reporting !== undefined && reporting !== false && typeof reporting !== 'object') {
    throw new TypeError('createApp document.csp.reporting must be false or an options object.');
  }
  return Object.freeze({
    ...(allowlist === undefined ? {} : { allowlist: snapshotAppDocumentCspAllowlist(allowlist) }),
    ...(reporting === undefined
      ? {}
      : {
          reporting:
            reporting === false ? false : snapshotAppDocumentCspReporting(reporting as object),
        }),
    ...(trustedTypes === undefined ? {} : { trustedTypes }),
  });
}

function snapshotAppDocumentCspAllowlist(
  value: unknown,
): NonNullable<NonNullable<KovoApp['document']['csp']>['allowlist']> {
  const record = appDocumentRecord(value, 'document.csp.allowlist');
  const snapshot: Record<string, readonly string[]> = {};
  for (const field of ['connectSrc', 'frameSrc', 'imgSrc', 'scriptSrc', 'styleSrc'] as const) {
    const entries = appDocumentOwnDataValue(record, field);
    if (entries !== undefined) {
      snapshot[field] = snapshotAppDocumentStringArray(entries, `document.csp.allowlist.${field}`);
    }
  }
  return Object.freeze(snapshot);
}

function snapshotAppDocumentCspReporting(
  value: object,
): Exclude<NonNullable<KovoApp['document']['csp']>['reporting'], false | undefined> {
  const record = appDocumentRecord(value, 'document.csp.reporting');
  const maxAgeSeconds = appDocumentOwnDataValue(record, 'maxAgeSeconds');
  if (
    maxAgeSeconds !== undefined &&
    (typeof maxAgeSeconds !== 'number' || !Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 0)
  ) {
    throw new TypeError('createApp document.csp.reporting.maxAgeSeconds must be non-negative.');
  }
  return Object.freeze(maxAgeSeconds === undefined ? {} : { maxAgeSeconds });
}

function snapshotAppDocumentStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`createApp ${label} must be a dense string array.`);
  }
  const snapshot: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError(`createApp ${label} must contain stable own strings.`);
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function appDocumentRecord(value: unknown, label: string): Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`createApp ${label} must be a stable own-data object.`);
  }
  return value as Record<PropertyKey, unknown>;
}

function appDocumentOwnDataValue(
  record: Record<PropertyKey, unknown>,
  property: PropertyKey,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(
      `createApp document.${String(property)} must be a stable own data property (SPEC §9.5).`,
    );
  }
  return descriptor.value;
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
    if (typeof mutation.key !== 'string' || mutation.key.length === 0) {
      throw new Error(
        'createApp() received a mutation without a derived key. ' +
          'mutation({ input, handler }) requires compiler-emitted source-derived key metadata; ' +
          'use the compiled artifact or the internal generated key path (SPEC §6.3).',
      );
    }
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

function assertUniqueTaskKeys<Task extends AppTaskDeclaration>(
  tasks: readonly Task[],
): readonly Task[] {
  const seen = new Set<string>();
  for (const taskDeclaration of tasks) {
    if (typeof taskDeclaration.key !== 'string' || taskDeclaration.key.length === 0) {
      throw new Error(
        'createApp() received a task without a derived key. ' +
          'task({ input, run }) requires compiler-emitted source-derived key metadata or an ' +
          'explicit task("key", ...) key (SPEC §9.6).',
      );
    }
    if (seen.has(taskDeclaration.key)) {
      throw new Error(
        `createApp() received two tasks with the same key "${taskDeclaration.key}". ` +
          'Task keys address one durable background handler for request.schedule() and the ' +
          'JobRunner (SPEC §9.6); a duplicate key makes dispatch ambiguous.',
      );
    }
    seen.add(taskDeclaration.key);
  }
  return tasks;
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

  const taskRuntime = createAppTaskRuntime(app);
  registerAppTaskRuntime(app, taskRuntime);

  return async (request) => {
    void taskRuntime?.ensureStarted(request).catch((error: unknown) => {
      reportAppStartupError(app, request, error);
    });
    return handleAppRequest(app, request);
  };
}

function appAuthoringContext<AppRequest>(): AppAuthoringContext<AppRequest> {
  return {
    layout: layout as AppAuthoringContext<AppRequest>['layout'],
    mutation: mutation as unknown as AppAuthoringContext<AppRequest>['mutation'],
    query: query as unknown as AppAuthoringContext<AppRequest>['query'],
    route: route as AppAuthoringContext<AppRequest>['route'],
    task: task as AppAuthoringContext<AppRequest>['task'],
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
