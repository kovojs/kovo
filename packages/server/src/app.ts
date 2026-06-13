import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { handleAppRequest } from './app-request.js';
export type {
  AppDocumentOptions,
  AppErrorShellOptions,
  AppMutationDeclaration,
  AppMutationResponseContext,
  AppMutationResponseOptions,
  AppMutationResponseResolver,
  AppRouteRenderContext,
  CreateAppOptions,
  ErrorShellRenderer,
  JisoApp,
  RequestHandler,
} from './app-types.js';
import type { CreateAppOptions, JisoApp, RequestHandler } from './app-types.js';

export function createApp<SessionValue = unknown>(
  options: CreateAppOptions<SessionValue> = {},
): JisoApp<SessionValue> {
  return {
    clientModules: options.clientModules ?? createMemoryVersionedClientModuleRegistry(),
    document: options.document ?? {},
    endpoints: options.endpoints ?? [],
    errorShells: options.errorShells ?? {},
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

export function createRequestHandler(app: JisoApp): RequestHandler {
  return (request) => handleAppRequest(app, request);
}
