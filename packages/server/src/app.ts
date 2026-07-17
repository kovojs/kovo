import {
  createMemoryVersionedClientModuleRegistry,
  snapshotVersionedClientModuleRegistry,
} from './client-modules.js';
import { snapshotAuditJustification } from './audit-justification.js';
import {
  appRequestUrlLimitResponse,
  handleAppRequest,
  reportAppStartupError,
} from './app-request.js';
import { routePrefetchGuardDiagnostics, routeTableDiagnostics } from './app-diagnostics.js';
import { isKovoApp } from './app-guards.js';
import {
  closeKovoAppAggregate,
  createAppDeclarationSnapshotContext,
  snapshotAppEndpoint,
  snapshotAppErrorShells,
  snapshotAppCsrfOptions,
  snapshotAppMutation,
  snapshotAppQuery,
  snapshotAppRegistry,
  snapshotAppRoute,
  snapshotLiveTargetRenderers,
} from './app-snapshot.js';
import { normalizeAppRequestLimits } from './app-load-shed.js';
import { createAppTaskRuntime, registerAppTaskRuntime } from './task-runtime.js';
import { ensureKovoLoaderRuntimeClientModule } from './loader-runtime-client-module.js';
import { takeRegisteredGeneratedLiveTargetRenderers } from './live-target-registry.js';
import {
  appLiveTargetAttestationAudience,
  appLiveTargetDeclaredId,
  registerAppLiveTargetIdentity,
} from './live-target-app-identity.js';
import { mutation } from './mutation.js';
import type { LiveTargetRenderer } from './mutation-wire.js';
import { query } from './query.js';
import { layout, route, routeLayoutLiveTargetRenderers } from './route.js';
import { task } from './task.js';
import {
  createWitnessSet,
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessSetAdd,
  witnessSetHas,
} from './security-witness-intrinsics.js';
import { denseOwnArrayForEach } from './registry-lookup.js';
import { securityStringTrim } from './response-security-intrinsics.js';
import { runtimeRegistryFacts } from './registry-facts.js';
import {
  isDocumentConfig,
  resolveDocumentDeclaration,
  snapshotDocumentConfig,
} from './document-structured.js';
import { resolveBootMode, validateAppEnv } from './env.js';
import { EgressFloorBootError, installEgressFloorSync, selfProbe } from './egress-bootstrap.js';
import { isDurableMutationReplayStore } from './replay.js';
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

const nativeArrayIsArray = Array.isArray;
const nativeNumberIsFinite = Number.isFinite;
if (!nativeArrayIsArray([]) || nativeArrayIsArray({}) || !nativeNumberIsFinite(1)) {
  throw new TypeError('Kovo app snapshot controls were modified before framework initialization.');
}

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
 * import '@kovojs/server/runtime-bootstrap';
 *
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
  type AppOptions = CreateAppOptions<SessionValue, DbValue, RawRequest, AppRequest>;
  rejectRemovedLiveTargetRenderersOption(options);
  rejectRemovedMutationResponsesOption(options);
  // Read every top-level option exactly once through an own-data descriptor before any authored
  // declaration callback executes. A route/query/mutation factory must not be able to replace the
  // session, DB, request-policy, or response authority that the surrounding createApp() call
  // declared (SPEC §6.6/§9.5 C9).
  const appId = appLiveTargetDeclaredId(appOptionOwnDataValue(options, 'appId'));
  const mutationReplayStore = appOptionOwnDataValue(
    options,
    'mutationReplayStore',
  ) as KovoApp['mutationReplayStore'];
  const configuredClientModules = appOptionOwnDataValue(options, 'clientModules') as
    | KovoApp['clientModules']
    | undefined;
  const clientModules = snapshotVersionedClientModuleRegistry(
    configuredClientModules ?? createMemoryVersionedClientModuleRegistry(),
  );
  const csrfSource = appOptionOwnDataValue(options, 'csrf') as AppOptions['csrf'];
  const db = appOptionOwnDataValue(options, 'db') as KovoApp['db'];
  const documentSource = appOptionOwnDataValue(options, 'document') as AppOptions['document'];
  const env = appOptionOwnDataValue(options, 'env') as AppOptions['env'];
  const envSource = appOptionOwnDataValue(options, 'envSource') as AppOptions['envSource'];
  const egressSource = appOptionOwnDataValue(options, 'egress') as AppOptions['egress'];
  const endpointsSource = appOptionOwnDataValue(options, 'endpoints') as AppOptions['endpoints'];
  const errorShellsSource = appOptionOwnDataValue(
    options,
    'errorShells',
  ) as AppOptions['errorShells'];
  const mutationsSource = appOptionOwnDataValue(options, 'mutations') as AppOptions['mutations'];
  const onError = appOptionOwnDataValue(options, 'onError') as KovoApp['onError'];
  const queriesSource = appOptionOwnDataValue(options, 'queries') as AppOptions['queries'];
  const renderRoute = appOptionOwnDataValue(options, 'renderRoute') as KovoApp['renderRoute'];
  const requestLimitsSource = appOptionOwnDataValue(
    options,
    'requestLimits',
  ) as AppOptions['requestLimits'];
  const routesSource = appOptionOwnDataValue(options, 'routes') as AppOptions['routes'];
  const sessionProvider = appOptionOwnDataValue(
    options,
    'sessionProvider',
  ) as KovoApp['sessionProvider'];
  const stylesheetsSource = appOptionOwnDataValue(
    options,
    'stylesheets',
  ) as AppOptions['stylesheets'];
  const tasksSource = appOptionOwnDataValue(options, 'tasks') as AppOptions['tasks'];
  // Generated component modules register immediately before their app module evaluates. Transfer
  // that pending inventory once even when explicit wiring wins, so it cannot leak into the next
  // app aggregate in this process (SPEC §6.6/§9.1/§9.5).
  const generatedLiveTargetRenderers = takeRegisteredGeneratedLiveTargetRenderers<AppRequest>();

  const csrf = csrfSource === undefined ? undefined : snapshotAppCsrfOptions(csrfSource);
  const egress = snapshotAppEgressOptions(egressSource);
  const document = normalizeAppDocumentOptions(documentSource);
  const errorShells = snapshotAppErrorShells(errorShellsSource ?? {});
  const requestLimits = normalizeAppRequestLimits(requestLimitsSource);
  // Refuse to boot — by-construction at the bootstrap chokepoint (SPEC §6.6,
  // §9.5; plans/secure-framework.md Tier 1). In production a missing/empty/short
  // framework signing secret (today the CSRF/anonymous-CSRF HMAC secret) or an
  // app-declared `env` schema failure throws CreateAppBootError before the app is
  // assembled. Dev stays lenient (warns, never bricks localhost).
  validateAppEnv(
    { csrfSecret: csrf?.secret },
    {
      ...(env === undefined ? {} : { env }),
      ...(envSource === undefined ? {} : { envSource }),
    },
  );

  bootstrapEgressFloor(egress);
  ensureKovoLoaderRuntimeClientModule(clientModules);

  const authoringContext = appAuthoringContext<AppRequest>();
  const snapshotContext = createAppDeclarationSnapshotContext();
  const routes = snapshotAppRegistry(
    resolveAppAuthoringDeclarations<AppRouteDeclaration<AppRequest>, AppRequest>(
      routesSource,
      authoringContext,
    ) as readonly AppRouteDeclaration<AppRequest>[],
    'createApp.routes',
    (declaration) => snapshotAppRoute(declaration, snapshotContext),
  );
  const liveTargetRendererSources: LiveTargetRenderer<AppRequest>[] = [];
  denseOwnArrayForEach(
    generatedLiveTargetRenderers,
    (renderer) =>
      witnessArrayAppend(
        liveTargetRendererSources,
        renderer,
        'createApp generated live-target registry',
      ),
    'createApp generated live-target registry',
  );
  denseOwnArrayForEach(
    routeLayoutLiveTargetRenderers(routes),
    (renderer) =>
      witnessArrayAppend(
        liveTargetRendererSources,
        renderer,
        'createApp layout live-target registry',
      ),
    'createApp layout live-target registry',
  );
  const liveTargetRenderers = assertUniqueLiveTargetRendererComponents(
    snapshotLiveTargetRenderers(liveTargetRendererSources, snapshotContext),
  );
  const authoredMutations = assertUniqueMutationKeys(
    snapshotAppRegistry(
      resolveAppAuthoringDeclarations<AppMutationDeclaration<AppRequest>, AppRequest>(
        mutationsSource,
        authoringContext,
      ),
      'createApp.mutations',
      (declaration) => snapshotAppMutation(declaration, snapshotContext),
    ),
  );
  const authoredQueries = snapshotAppRegistry(
    resolveAppAuthoringDeclarations<AppQueryDeclaration<AppRequest>, AppRequest>(
      queriesSource,
      authoringContext,
    ),
    'createApp.queries',
    (declaration) => snapshotAppQuery(declaration, snapshotContext),
  );
  const endpoints = snapshotAppRegistry(
    endpointsSource ?? [],
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
  if (
    resolveBootMode() === 'production' &&
    (mutationReplayStore !== undefined || mutations.length > 0) &&
    !isDurableMutationReplayStore(mutationReplayStore)
  ) {
    throw new Error(
      'KV436: createApp() refused a missing, custom, or volatile memory mutationReplayStore in production; declared mutations require createPostgresAppRuntimeDb().mutationReplayStore so idempotency truth survives restart and replicas (SPEC §10.3).',
    );
  }
  const tasks = assertUniqueTaskKeys(
    resolveAppAuthoringDeclarations<AppTaskDeclaration<AppRequest>, AppRequest>(
      tasksSource,
      authoringContext,
    ),
  );
  const app = closeKovoAppAggregate(
    {
      clientModules,
      diagnostics: collectAppDiagnostics(routes),
      document,
      endpoints,
      errorShells,
      liveTargetRenderers,
      mutations,
      queries,
      requestLimits,
      routes,
      stylesheets: stylesheetsSource ?? [],
      ...(csrf === undefined ? {} : { csrf }),
      ...(db === undefined ? {} : { db }),
      ...(mutationReplayStore === undefined ? {} : { mutationReplayStore }),
      ...(onError === undefined ? {} : { onError }),
      ...(renderRoute === undefined ? {} : { renderRoute }),
      ...(sessionProvider === undefined ? {} : { sessionProvider }),
      tasks,
    } as KovoApp<SessionValue, DbValue, RawRequest, AppRequest>,
    snapshotContext,
  );
  registerAppLiveTargetIdentity(app, appId);
  // Validate the registry token before the app can escape. A late empty token would otherwise let a
  // mutation commit and fail only while rendering its response, so retries could duplicate writes.
  appLiveTargetAttestationAudience(app);
  return app;
}

function rejectRemovedLiveTargetRenderersOption(source: object): void {
  if (witnessGetOwnPropertyDescriptor(source, 'liveTargetRenderers') === undefined) return;
  throw new TypeError(
    'createApp({ liveTargetRenderers }) is forbidden: SPEC §9.1/§9.5 makes the live-target registry compiler-owned.',
  );
}

function rejectRemovedMutationResponsesOption(source: object): void {
  if (witnessGetOwnPropertyDescriptor(source, 'mutationResponses') === undefined) return;
  throw new TypeError(
    'createApp({ mutationResponses }) is forbidden: SPEC §9.1 makes mutation success selection generated and failure rendering framework-owned.',
  );
}

function appOptionOwnDataValue(source: object, property: PropertyKey): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(source, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`createApp option ${String(property)} must be a stable own data property.`);
  }
  return descriptor.value;
}

function bootstrapEgressFloor(egress: AppEgressOptions | undefined): void {
  const mode = resolveBootMode();
  const warn = (message: string): void => console.warn(`[kovo egress] ${message}`);

  if (isEgressOptOut(egress)) {
    if (securityStringTrim(egress.justification) === '') {
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
    preserveExistingAppPolicy: true,
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
  if (typeof value !== 'object' || value === null) return false;
  const enabled = witnessGetOwnPropertyDescriptor(value, 'enabled');
  return enabled !== undefined && 'value' in enabled && enabled.value === false;
}

/**
 * Snapshot the operator's egress posture before transport installation (SPEC §6.6/§9.5 C9).
 * App dependencies share the server realm and caller records may retain getters/mutable arrays;
 * neither can become authority for disabling or widening the process egress floor.
 */
function snapshotAppEgressOptions(
  value: AppEgressOptions | undefined,
): AppEgressOptions | undefined {
  if (value === undefined || value === false) return value;
  if (typeof value !== 'object' || value === null || nativeArrayIsArray(value)) {
    throw new TypeError('createApp({ egress }) must be false or a stable own-data object.');
  }

  const enabled = appEgressOwnDataValue(value, 'enabled');
  if (enabled !== undefined) {
    if (enabled !== false) {
      throw new TypeError('createApp({ egress.enabled }) may only be false.');
    }
    let justification: string;
    try {
      justification = snapshotAuditJustification(
        appEgressOwnDataValue(value, 'justification'),
        'createApp({ egress: { enabled: false } }) (SPEC §6.6)',
      );
    } catch (error) {
      if (resolveBootMode() === 'production') {
        throw new EgressFloorBootError(
          `createApp() refused to boot: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      throw error;
    }
    return witnessFreeze({ enabled: false as const, justification });
  }

  const allowDestinations = appEgressOwnDataValue(value, 'allowDestinations');
  const allowInternal = appEgressOwnDataValue(value, 'allowInternal');
  const hardening = appEgressOwnDataValue(value, 'hardening');
  if (
    hardening !== undefined &&
    hardening !== 'off' &&
    hardening !== 'warn' &&
    hardening !== 'freeze'
  ) {
    throw new TypeError('createApp({ egress.hardening }) must be off, warn, or freeze.');
  }
  const snapshottedHardening = hardening as EgressOptions['hardening'];
  return witnessFreeze({
    ...(allowDestinations === undefined
      ? {}
      : {
          allowDestinations: snapshotAppDocumentStringArray(
            allowDestinations,
            'egress.allowDestinations',
          ),
        }),
    ...(allowInternal === undefined
      ? {}
      : {
          allowInternal: snapshotAppDocumentStringArray(allowInternal, 'egress.allowInternal'),
        }),
    ...(snapshottedHardening === undefined ? {} : { hardening: snapshottedHardening }),
  });
}

function appEgressOwnDataValue(value: object, property: PropertyKey): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError('createApp egress options must use stable own data properties.');
  }
  return descriptor.value;
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
  if (document === undefined) return witnessFreeze({});
  if (isDocumentConfig(document) || typeof document === 'function') {
    const structured = resolveDocumentDeclaration(document);
    if (structured === undefined || !isDocumentConfig(structured)) {
      throw new TypeError(
        'createApp({ document }) structured declarations must return Document(...) (SPEC §9.5).',
      );
    }
    const snapshot = snapshotDocumentConfig(structured);
    return witnessFreeze({
      ...(snapshot.lang === undefined ? {} : { lang: snapshot.lang }),
      structured: snapshot,
    });
  }
  if (typeof document !== 'object' || document === null || nativeArrayIsArray(document)) {
    throw new TypeError('createApp({ document }) must be a stable options object (SPEC §9.5).');
  }
  const record = document as unknown as Record<PropertyKey, unknown>;
  if (witnessGetOwnPropertyDescriptor(record, 'template') !== undefined) {
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
  return witnessFreeze({
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
  return witnessFreeze({
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
  const snapshot = witnessCreateNullRecord<readonly string[]>() as Record<
    string,
    readonly string[]
  >;
  for (const field of ['connectSrc', 'frameSrc', 'imgSrc', 'scriptSrc', 'styleSrc'] as const) {
    const entries = appDocumentOwnDataValue(record, field);
    if (entries !== undefined) {
      snapshot[field] = snapshotAppDocumentStringArray(entries, `document.csp.allowlist.${field}`);
    }
  }
  return witnessFreeze(snapshot);
}

function snapshotAppDocumentCspReporting(
  value: object,
): Exclude<NonNullable<KovoApp['document']['csp']>['reporting'], false | undefined> {
  const record = appDocumentRecord(value, 'document.csp.reporting');
  const maxAgeSeconds = appDocumentOwnDataValue(record, 'maxAgeSeconds');
  if (
    maxAgeSeconds !== undefined &&
    (typeof maxAgeSeconds !== 'number' || !nativeNumberIsFinite(maxAgeSeconds) || maxAgeSeconds < 0)
  ) {
    throw new TypeError('createApp document.csp.reporting.maxAgeSeconds must be non-negative.');
  }
  return witnessFreeze(maxAgeSeconds === undefined ? {} : { maxAgeSeconds });
}

function snapshotAppDocumentStringArray(value: unknown, label: string): readonly string[] {
  if (!nativeArrayIsArray(value)) {
    throw new TypeError(`createApp ${label} must be a dense string array.`);
  }
  const snapshot: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError(`createApp ${label} must contain stable own strings.`);
    }
    witnessDefineProperty(snapshot, index, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return witnessFreeze(snapshot);
}

function appDocumentRecord(value: unknown, label: string): Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null || nativeArrayIsArray(value)) {
    throw new TypeError(`createApp ${label} must be a stable own-data object.`);
  }
  return value as Record<PropertyKey, unknown>;
}

function appDocumentOwnDataValue(
  record: Record<PropertyKey, unknown>,
  property: PropertyKey,
): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(record, property);
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
  const seen = createWitnessSet<string>();
  denseOwnArrayForEach(
    mutations,
    (mutation) => {
      const key = appDeclarationKey(mutation, 'mutation');
      if (key.length === 0) {
        throw new Error(
          'createApp() received a mutation without a derived key. ' +
            'mutation({ input, handler }) requires compiler-emitted source-derived key metadata; ' +
            'use the compiled artifact or the internal generated key path (SPEC §6.3).',
        );
      }
      if (witnessSetHas(seen, key)) {
        throw new Error(
          `createApp() received two mutations with the same key "${key}". ` +
            'Mutation keys address one handler for request dispatch (SPEC §6.1, §9.5); a duplicate ' +
            'key makes the second handler unreachable and the invalidation registry ambiguous. ' +
            'Rename one mutation so its key is unique (compile diagnostic KV421).',
        );
      }
      witnessSetAdd(seen, key);
    },
    'createApp mutation registry',
  );
  return mutations;
}

function assertUniqueLiveTargetRendererComponents<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
): readonly LiveTargetRenderer<Request>[] {
  const seen = createWitnessSet<string>();
  denseOwnArrayForEach(
    renderers,
    (renderer) => {
      if (witnessSetHas(seen, renderer.component)) {
        throw new Error(
          `createApp() received two generated live-target renderers for component "${renderer.component}". ` +
            'Compiler-owned component and layout-plan identities must be globally unique.',
        );
      }
      witnessSetAdd(seen, renderer.component);
    },
    'createApp live-target renderer registry',
  );
  return renderers;
}

function assertUniqueTaskKeys<Task extends AppTaskDeclaration>(
  tasks: readonly Task[],
): readonly Task[] {
  const seen = createWitnessSet<string>();
  denseOwnArrayForEach(
    tasks,
    (taskDeclaration) => {
      const key = appDeclarationKey(taskDeclaration, 'task');
      if (key.length === 0) {
        throw new Error(
          'createApp() received a task without a derived key. ' +
            'task({ input, run }) requires compiler-emitted source-derived key metadata or an ' +
            'explicit task("key", ...) key (SPEC §9.6).',
        );
      }
      if (witnessSetHas(seen, key)) {
        throw new Error(
          `createApp() received two tasks with the same key "${key}". ` +
            'Task keys address one durable background handler for request.schedule() and the ' +
            'JobRunner (SPEC §9.6); a duplicate key makes dispatch ambiguous.',
        );
      }
      witnessSetAdd(seen, key);
    },
    'createApp task registry',
  );
  return tasks;
}

function appDeclarationKey(value: object, kind: 'mutation' | 'task'): string {
  const descriptor = witnessGetOwnPropertyDescriptor(value, 'key');
  if (descriptor === undefined) return '';
  if (!('value' in descriptor)) {
    throw new Error(`createApp() received a ${kind} with an accessor-backed key.`);
  }
  return typeof descriptor.value === 'string' ? descriptor.value : '';
}

function collectAppDiagnostics(
  routes: readonly AppRouteDeclaration<any>[],
): KovoApp['diagnostics'] {
  const diagnostics: KovoApp['diagnostics'][number][] = [];
  appendAppDiagnosticGroup(diagnostics, routeTableDiagnostics(routes));
  appendAppDiagnosticGroup(diagnostics, routePrefetchGuardDiagnostics(routes));
  return witnessFreeze(diagnostics);
}

function appendAppDiagnosticGroup(
  diagnostics: KovoApp['diagnostics'][number][],
  group: KovoApp['diagnostics'],
): void {
  denseOwnArrayForEach(
    group,
    (diagnostic) => witnessArrayAppend(diagnostics, diagnostic, 'createApp diagnostics'),
    'createApp diagnostic group',
  );
}

/**
 * Turn a `KovoApp` into a `(request: Request) => Response` handler that dispatches
 * to routes, queries, mutations, and endpoints. Requires an app built by
 * `createApp` (SPEC §9.5).
 *
 * @param app - An app aggregate from `createApp`.
 * @returns A request handler suitable for the platform's server.
 * @internal Use the root `@kovojs/server` wrapper, which enforces runtime bootstrap ordering.
 */
export function createRequestHandler(app: KovoApp): RequestHandler {
  if (!isKovoApp(app)) {
    throw new TypeError(
      'createRequestHandler() requires a Kovo app aggregate. SPEC §9.5 request dispatch must start from createApp(), not a raw request handler or compatibility shell.',
    );
  }

  appLiveTargetAttestationAudience(app);

  const taskRuntime = createAppTaskRuntime(app);
  registerAppTaskRuntime(app, taskRuntime);

  return async (request) => {
    const urlLimitResponse = appRequestUrlLimitResponse(request);
    if (urlLimitResponse) return urlLimitResponse;
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
