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
import { query } from './query.js';
import { layout, route } from './route.js';
import { isDocumentConfig, resolveDocumentDeclaration } from './document-structured.js';
export type {
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
  CreateAppOptions,
  ErrorShellRenderer,
  KovoApp,
  RequestHandler,
  ResolvedAppRateLimitOptions,
  ResolvedAppRequestLimitOptions,
  ResolvedAppRequestRateLimitOptions,
} from './app-types.js';
import type { LiveTargetRenderer } from './mutation-wire.js';
import type { QueryDefinition } from './query.js';
import type { LayoutDeclaration } from './route.js';
import type {
  AppAuthoringContext,
  AppAuthoringDeclarations,
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
    ...(options.sessionProvider === undefined ? {} : { sessionProvider: options.sessionProvider }),
  };
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
