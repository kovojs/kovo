import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { handleAppRequest } from './app-request.js';
import { routeTableDiagnostics } from './app-diagnostics.js';
import { isKovoApp } from './app-guards.js';
export type {
  AppDocumentOptions,
  AppErrorShellOptions,
  AppDiagnostic,
  AppMutationDeclaration,
  AppMutationResponseContext,
  AppMutationResponseOptions,
  AppMutationResponseResolver,
  AppRouteRenderContext,
  CreateAppOptions,
  ErrorShellRenderer,
  KovoApp,
  RequestHandler,
} from './app-types.js';
import type { CreateAppOptions, KovoApp, RequestHandler } from './app-types.js';

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
export function createApp<SessionValue = unknown>(
  options: CreateAppOptions<SessionValue> = {},
): KovoApp<SessionValue> {
  return {
    clientModules: options.clientModules ?? createMemoryVersionedClientModuleRegistry(),
    diagnostics: routeTableDiagnostics(options.routes ?? []),
    document: options.document ?? {},
    endpoints: options.endpoints ?? [],
    errorShells: options.errorShells ?? {},
    liveTargetRenderers: options.liveTargetRenderers ?? [],
    mutations: options.mutations ?? [],
    queries: options.queries ?? [],
    routes: options.routes ?? [],
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(options.mutationReplayStore === undefined
      ? {}
      : { mutationReplayStore: options.mutationReplayStore }),
    ...(options.mutationResponse === undefined
      ? {}
      : { mutationResponse: options.mutationResponse }),
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
