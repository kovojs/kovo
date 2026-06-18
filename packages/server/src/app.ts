import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { handleAppRequest } from './app-request.js';
import { routeTableDiagnostics } from './app-diagnostics.js';
import { isKovoApp } from './app-guards.js';
import { registeredGeneratedLiveTargetRenderers } from './live-target-registry.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { layout, route } from './route.js';
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
  AppRouteDeclaration,
  AppRouteRenderContext,
  CreateAppOptions,
  ErrorShellRenderer,
  KovoApp,
  RequestHandler,
} from './app-types.js';
import type { LiveTargetRenderer } from './mutation-wire.js';
import type { QueryDefinition } from './query.js';
import type { LayoutDeclaration } from './route.js';
import type {
  AppAuthoringContext,
  AppAuthoringDeclarations,
  AppLifecycleRequest,
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
 *   routes: [route('/', { page: () => '<h1>Home</h1>' })],
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
  const mutations = resolveAppAuthoringDeclarations(options.mutations, authoringContext);

  return {
    clientModules: options.clientModules ?? createMemoryVersionedClientModuleRegistry(),
    diagnostics: routeTableDiagnostics(routes),
    document: options.document ?? {},
    endpoints: options.endpoints ?? [],
    errorShells: options.errorShells ?? {},
    liveTargetRenderers,
    mutations,
    queries,
    routes,
    stylesheets: options.stylesheets ?? [],
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(options.db === undefined ? {} : { db: options.db }),
    ...(options.mutationReplayStore === undefined
      ? {}
      : { mutationReplayStore: options.mutationReplayStore }),
    mutationResponses: options.mutationResponses ?? {},
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.renderRoute === undefined ? {} : { renderRoute: options.renderRoute }),
    ...(options.sessionProvider === undefined ? {} : { sessionProvider: options.sessionProvider }),
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
      if (!queries.has(queryDefinition.key)) {
        queries.set(queryDefinition.key, queryDefinition);
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
