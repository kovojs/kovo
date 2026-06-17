import { resolveLifecycleRequest } from './guards.js';
import {
  renderMutationEndpointResponse,
  type MutationDefinition,
  type MutationRegistry,
} from './mutation.js';
import type { RegisteredQueryDefinition } from './query.js';
import { methodNotAllowedWebResponse, serverResponseToWebResponse } from './response.js';
import type { Schema } from './schema.js';
import type { KovoApp } from './app-types.js';
import { appRequestUrl, renderAppErrorDocumentResponse } from './app-document.js';

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

  const mutationRequest = await resolveLifecycleRequest(
    request,
    app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider },
  );
  const rawInput = await readMutationRequestBody(mutationRequest);
  const currentUrl = appRequestUrl(url);
  const mutationResponseOptions = await app.mutationResponse?.({
    currentUrl,
    key: mutation.key,
    mutation,
    rawInput,
    request: mutationRequest,
    url: new URL(url),
  });
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

  const mutationResponse = await renderMutationEndpointResponse(requestMutation, {
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
    ...(mutationResponseOptions?.fragmentRenderers === undefined
      ? {}
      : { fragmentRenderers: mutationResponseOptions.fragmentRenderers }),
    headers: request.headers,
    liveTargetRenderers: app.liveTargetRenderers,
    rawInput,
    redirectTo:
      mutationResponseOptions?.redirectTo ?? defaultMutationRedirectTo(mutationRequest, currentUrl),
    ...(mutationResponseOptions?.renderFailureFragment === undefined
      ? {}
      : { renderFailureFragment: mutationResponseOptions.renderFailureFragment }),
    ...(mutationResponseOptions?.renderFailurePage === undefined
      ? {}
      : { renderFailurePage: mutationResponseOptions.renderFailurePage }),
    request: mutationRequest,
  });

  return serverResponseToWebResponse(mutationResponse, mutationRequest);
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
    ...(registry ?? {}),
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
