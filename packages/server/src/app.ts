import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { handleAppRequest } from './app-request.js';
import { isJisoApp } from './app-guards.js';
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
  if (!isJisoApp(app)) {
    throw new TypeError(
      'createRequestHandler() requires a Jiso app aggregate. SPEC §9.5 request dispatch must start from createApp(), not a raw request handler or compatibility shell.',
    );
  }

  return (request) => handleAppRequest(app, request);
}
