import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { handleAppRequest } from './app-request.js';
import { routeTableDiagnostics } from './app-diagnostics.js';
import { isKovoApp } from './app-guards.js';
import { registeredGeneratedLiveTargetRenderers } from './live-target-registry.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { route } from './route.js';
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
>(options: CreateAppOptions<SessionValue, DbValue, RawRequest, AppRequest> = {}): KovoApp<
  SessionValue,
  DbValue,
  RawRequest,
  AppRequest
> {
  const authoringContext = appAuthoringContext<AppRequest>();
  const routes = resolveAppAuthoringDeclarations(options.routes, authoringContext);
  const queries = resolveAppAuthoringDeclarations(options.queries, authoringContext);
  const mutations = resolveAppAuthoringDeclarations(options.mutations, authoringContext);

  return {
    clientModules: options.clientModules ?? createMemoryVersionedClientModuleRegistry(),
    diagnostics: routeTableDiagnostics(routes),
    document: options.document ?? {},
    endpoints: options.endpoints ?? [],
    errorShells: options.errorShells ?? {},
    liveTargetRenderers: options.liveTargetRenderers ?? registeredGeneratedLiveTargetRenderers(),
    mutations,
    queries,
    routes,
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
