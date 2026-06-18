import { resolveLifecycleRequest } from './guards.js';
import {
  renderMutationEndpointResponse,
  type MutationDefinition,
  type MutationFail,
  type MutationRegistry,
} from './mutation.js';
import type { RegisteredQueryDefinition } from './query.js';
import { methodNotAllowedWebResponse, serverResponseToWebResponse } from './response.js';
import type { Schema } from './schema.js';
import type {
  AppMutationResponseContext,
  AppMutationResponseOptions,
  AppMutationResponsePolicy,
  KovoApp,
} from './app-types.js';
import {
  appRequestUrl,
  renderAppErrorDocumentResponse,
  renderAppRouteDocumentResponse,
} from './app-document.js';
import { matchShellDispatch } from './shell.js';

export async function handleAppMutationRequest(
  app: KovoApp,
  request: Request,
  url: URL,
  mutationKey: string,
): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') {
    return methodNotAllowedWebResponse(request, ['POST']);
  }

  const mutation = app.mutations.find((candidate) => candidate.key === mutationKey);
  if (!mutation) {
    return serverResponseToWebResponse(
      await renderAppErrorDocumentResponse(app, request, 404),
      request,
    );
  }

  const mutationRequest = await resolveLifecycleRequest(request, {
    ...(app.db === undefined ? {} : { db: app.db }),
    ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
  });
  const rawInput = await readMutationRequestBody(mutationRequest);
  const currentUrl = appRequestUrl(url);
  const sourceUrl = mutationSourceUrl(request, url);
  const mutationResponseOptions = await resolveAppMutationResponsePolicy(app, {
    currentUrl,
    key: mutation.key,
    mutation,
    rawInput,
    request: mutationRequest,
    url: new URL(url),
  });
  const defaultFailurePageRenderer = defaultAppMutationFailurePageRenderer(
    app,
    mutationRequest,
    sourceUrl,
    mutation.key,
    rawInput,
  );
  const requestMutation = mutationWithAppQueries(
    mutation as unknown as MutationDefinition<
      string,
      Schema<unknown>,
      Record<string, Schema<unknown>>,
      Request
    >,
    app.queries,
  );
  // Derive the build token from the app's client-module registry so it is
  // identical for the page render and this mutation response (SPEC §5.1, §9.1.1).
  const buildToken = app.clientModules.buildToken();

  const endpointResponse = await renderMutationEndpointResponse(requestMutation, {
    ...(buildToken !== '' ? { buildToken } : {}),
    ...(app.csrf === undefined ? {} : { csrf: app.csrf }),
    ...(app.mutationReplayStore === undefined ? {} : { replayStore: app.mutationReplayStore }),
    ...(app.onError === undefined ? {} : { onError: app.onError }),
    ...(mutationResponseOptions?.csrf === undefined ? {} : { csrf: mutationResponseOptions.csrf }),
    ...(mutationResponseOptions?.failureTarget === undefined
      ? {}
      : { failureTarget: mutationResponseOptions.failureTarget }),
    ...(mutationResponseOptions?.failureStylesheets === undefined
      ? {}
      : { failureStylesheets: mutationResponseOptions.failureStylesheets }),
    headers: request.headers,
    liveTargetRenderers: app.liveTargetRenderers,
    rawInput,
    redirectTo:
      mutationResponseOptions?.redirectTo ??
      mutation.defaultRedirectTo ??
      defaultMutationRedirectTo(mutationRequest, appRequestUrl(sourceUrl)),
    ...(mutationResponseOptions?.renderFailureFragment === undefined
      ? {}
      : { renderFailureFragment: mutationResponseOptions.renderFailureFragment }),
    ...(mutationResponseOptions?.renderFailurePage !== undefined
      ? { renderFailurePage: mutationResponseOptions.renderFailurePage }
      : defaultFailurePageRenderer === undefined
        ? {}
        : { renderFailurePage: defaultFailurePageRenderer }),
    request: mutationRequest,
  });

  return serverResponseToWebResponse(endpointResponse, mutationRequest);
}

async function resolveAppMutationResponsePolicy(
  app: KovoApp,
  context: AppMutationResponseContext,
): Promise<AppMutationResponseOptions | undefined> {
  return resolveMutationResponsePolicy(app.mutationResponses[context.key], context);
}

async function resolveMutationResponsePolicy(
  policy: AppMutationResponsePolicy | undefined,
  context: AppMutationResponseContext,
): Promise<AppMutationResponseOptions | undefined> {
  if (policy === undefined) return undefined;
  return typeof policy === 'function' ? policy(context) : policy;
}

function mutationWithAppQueries<Request>(
  mutation: MutationDefinition<string, Schema<unknown>, Record<string, Schema<unknown>>, Request>,
  queries: readonly RegisteredQueryDefinition[],
): MutationDefinition<string, Schema<unknown>, Record<string, Schema<unknown>>, Request> {
  if (queries.length === 0) return mutation;

  return {
    ...mutation,
    registry: mergeMutationRegistryQueries(mutation.registry, queries),
  };
}

function mergeMutationRegistryQueries(
  registry: MutationRegistry | undefined,
  appQueries: readonly RegisteredQueryDefinition[],
): MutationRegistry {
  const queriesByKey = new Map<string, RegisteredQueryDefinition>();

  for (const query of registry?.queries ?? []) {
    queriesByKey.set(query.key, query);
  }
  for (const query of appQueries) {
    if (!queriesByKey.has(query.key)) queriesByKey.set(query.key, query);
  }

  return {
    ...registry,
    queries: [...queriesByKey.values()],
  };
}

async function readMutationRequestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) return request.json();
  return request.formData();
}

function defaultMutationRedirectTo(request: Request, currentUrl: string): string {
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      return appRequestUrl(url);
    } catch {
      return referer;
    }
  }

  return currentUrl.startsWith('/_m/') ? '/' : currentUrl;
}

function mutationSourceUrl(request: Request, mutationUrl: URL): URL {
  const referer = request.headers.get('referer');
  if (!referer) return mutationUrl;
  try {
    const url = new URL(referer, mutationUrl);
    return url.origin === mutationUrl.origin ? url : mutationUrl;
  } catch {
    return mutationUrl;
  }
}

function defaultAppMutationFailurePageRenderer(
  app: KovoApp,
  request: Request,
  sourceUrl: URL,
  mutationKey: string,
  rawInput: unknown,
): ((failure: MutationFail) => Promise<string>) | undefined {
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    method: 'GET',
    pathname: sourceUrl.pathname,
    routes: app.routes,
  });

  if (match.kind !== 'route' || !match.methodAllowed) {
    return undefined;
  }

  return async (failure) => {
    const response = await renderAppRouteDocumentResponse({
      app,
      jsxContext: { mutationFailure: { failure, input: rawInput, mutationKey } },
      params: match.params,
      request,
      route: match.route,
      url: sourceUrl,
    });

    return typeof response.body === 'string' ? response.body : '';
  };
}
