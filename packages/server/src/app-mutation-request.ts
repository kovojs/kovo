import type { SessionProvider } from './guards.js';
import { renderMutationEndpointResponse, type MutationDefinition } from './mutation.js';
import { serverResponseToWebResponse } from './response.js';
import type { Schema } from './schema.js';
import type { JisoApp } from './app.js';
import { appRequestUrl, renderAppErrorDocumentResponse } from './app-document.js';

export async function handleAppMutationRequest(
  app: JisoApp,
  request: Request,
  url: URL,
  mutationKey: string,
  methodNotAllowedResponse: (request: Request, allowedMethods: readonly string[]) => Response,
): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') {
    return methodNotAllowedResponse(request, ['POST']);
  }

  const mutation = app.mutations.find((candidate) => candidate.key === mutationKey);
  if (!mutation) {
    return serverResponseToWebResponse(
      await renderAppErrorDocumentResponse(app, request, 404),
      request,
    );
  }

  const mutationRequest = await requestWithResolvedSession(app.sessionProvider, request);
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
  const requestMutation = mutation as unknown as MutationDefinition<
    string,
    Schema<unknown>,
    Record<string, Schema<unknown>>,
    Request
  >;
  const mutationResponse = await renderMutationEndpointResponse(requestMutation, {
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

async function readMutationRequestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) return request.json();
  return request.formData();
}

async function requestWithResolvedSession(
  sessionProvider: SessionProvider<Request, unknown> | undefined,
  request: Request,
): Promise<Request> {
  if (!sessionProvider) return request;

  const session = await sessionProvider(request);
  Object.defineProperty(request, 'session', {
    configurable: true,
    enumerable: true,
    value: session ?? null,
  });
  return request;
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
