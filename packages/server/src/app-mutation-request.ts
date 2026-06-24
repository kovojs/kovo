import { resolveLifecycleRequest } from './guards.js';
import { recordAppCapability } from './app-capabilities.js';
import {
  renderMutationEndpointResponse,
  type MutationDefinition,
  type MutationFail,
  type MutationRegistry,
} from './mutation.js';
import type { FragmentRenderer, LiveTargetRenderer } from './mutation-wire.js';
import { mutationCsrfOptions } from './csrf.js';
import type { RegisteredQueryDefinition } from './query.js';
import { methodNotAllowedWebResponse, serverResponseToWebResponse } from './response.js';
import type { Schema } from './schema.js';
import type {
  AppMutationResponseContext,
  AppMutationResponseOptions,
  AppMutationResponsePolicy,
  AppMutationDeclaration,
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
    ...(app.capabilityUrls === undefined ? {} : { capabilityUrls: app.capabilityUrls }),
    egressFetch: app.egress.fetch,
    onCapabilityUrlMint: (fact) => recordAppCapability(app, fact),
    ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
  });
  const currentUrl = appRequestUrl(url);
  const sourceUrl = mutationSourceUrl(request, url);

  const bodyResult = await readMutationRequestBody(mutationRequest);
  if (!bodyResult.ok) {
    // SPEC §6.6/§10.3: CSRF is the first mutation lifecycle gate. If the body cannot
    // be safely decoded to read the submitted token, a CSRF-protected mutation fails
    // closed as CSRF instead of leaking body/schema diagnostics ahead of CSRF.
    if (mutationRequiresPreBodyCsrf(mutation, app)) {
      return renderPreBodyCsrfFailure(app, mutation, mutationRequest, url, sourceUrl);
    }

    return new Response(
      JSON.stringify({ code: 'VALIDATION', payload: { reason: bodyResult.reason } }),
      {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        status: 422,
      },
    );
  }
  const rawInput = bodyResult.value;
  const mutationResponseOptions = await resolveAppMutationResponsePolicy(app, {
    currentUrl,
    key: mutation.key,
    mutation,
    rawInput,
    request: mutationRequest,
    url: new URL(url),
  });
  const inheritedStylesheets = sourceRouteStylesheets(app, sourceUrl);
  const failureStylesheets = mergedStylesheets(
    inheritedStylesheets,
    mutationResponseOptions?.failureStylesheets,
  );
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
    app.queries as readonly RegisteredQueryDefinition[],
  );
  // Derive the build token from the app's client-module registry so it is
  // identical for the page render and this mutation response (SPEC §5.1, §9.1.1).
  const buildToken = app.clientModules.buildToken();

  const endpointResponse = await renderMutationEndpointResponse(requestMutation, {
    ...(buildToken !== '' ? { buildToken } : {}),
    ...(app.csrf === undefined ? {} : { csrf: app.csrf }),
    ...(app.capabilityUrls === undefined ? {} : { capabilityUrls: app.capabilityUrls }),
    onCapabilityUrlMint: (fact) => recordAppCapability(app, fact),
    currentUrl: appRequestUrl(sourceUrl),
    ...(app.mutationReplayStore === undefined ? {} : { replayStore: app.mutationReplayStore }),
    ...(app.onError === undefined ? {} : { onError: app.onError }),
    ...(mutationResponseOptions?.csrf === undefined ? {} : { csrf: mutationResponseOptions.csrf }),
    ...(mutationResponseOptions?.failureTarget === undefined
      ? {}
      : { failureTarget: mutationResponseOptions.failureTarget }),
    ...(failureStylesheets === undefined ? {} : { failureStylesheets }),
    ...(mutationResponseOptions?.fragmentRenderers === undefined
      ? {}
      : {
          fragmentRenderers: inheritFragmentRendererStylesheets(
            mutationResponseOptions.fragmentRenderers,
            inheritedStylesheets,
          ),
        }),
    headers: request.headers,
    liveTargetRenderers: inheritLiveTargetRendererStylesheets(
      app.liveTargetRenderers,
      inheritedStylesheets,
    ),
    rawInput,
    redirectTo:
      mutationResponseOptions?.redirectTo ??
      mutation.redirectTo ??
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

async function renderPreBodyCsrfFailure(
  app: KovoApp,
  mutation: AppMutationDeclaration,
  request: Request,
  url: URL,
  sourceUrl: URL,
): Promise<Response> {
  const inheritedStylesheets = sourceRouteStylesheets(app, sourceUrl);
  const defaultFailurePageRenderer = defaultAppMutationFailurePageRenderer(
    app,
    request,
    sourceUrl,
    mutation.key,
    {},
  );
  const requestMutation = mutationWithAppQueries(
    mutation as unknown as MutationDefinition<
      string,
      Schema<unknown>,
      Record<string, Schema<unknown>>,
      Request
    >,
    app.queries as readonly RegisteredQueryDefinition[],
  );
  const buildToken = app.clientModules.buildToken();

  const endpointResponse = await renderMutationEndpointResponse(requestMutation, {
    ...(buildToken !== '' ? { buildToken } : {}),
    ...(app.csrf === undefined ? {} : { csrf: app.csrf }),
    currentUrl: appRequestUrl(sourceUrl),
    headers: request.headers,
    rawInput: {},
    redirectTo:
      mutation.redirectTo ??
      mutation.defaultRedirectTo ??
      defaultMutationRedirectTo(request, appRequestUrl(url)),
    ...(inheritedStylesheets.length === 0 ? {} : { failureStylesheets: inheritedStylesheets }),
    ...(defaultFailurePageRenderer === undefined
      ? {}
      : { renderFailurePage: defaultFailurePageRenderer }),
    request,
  });

  return serverResponseToWebResponse(endpointResponse, request);
}

function mutationRequiresPreBodyCsrf(appMutation: AppMutationDeclaration, app: KovoApp): boolean {
  const csrf = mutationCsrfOptions(
    appMutation as unknown as { csrf?: KovoApp['csrf'] | false },
    app.csrf,
  );
  return csrf !== false;
}

function sourceRouteStylesheets(
  app: KovoApp,
  sourceUrl: URL,
): readonly KovoApp['stylesheets'][number][] {
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    method: 'GET',
    pathname: sourceUrl.pathname,
    routes: app.routes,
  });
  const routeStylesheets =
    match.kind === 'route' && match.methodAllowed ? (match.route.stylesheets ?? []) : [];
  return [...app.stylesheets, ...routeStylesheets];
}

function inheritFragmentRendererStylesheets(
  renderers: readonly FragmentRenderer[],
  inheritedStylesheets: readonly KovoApp['stylesheets'][number][],
): readonly FragmentRenderer[] {
  if (inheritedStylesheets.length === 0) return renderers;

  return renderers.map((renderer) => {
    const stylesheets = mergedStylesheets(inheritedStylesheets, renderer.stylesheets);
    return {
      ...renderer,
      ...(stylesheets === undefined ? {} : { stylesheets }),
    };
  });
}

function inheritLiveTargetRendererStylesheets<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
  inheritedStylesheets: readonly KovoApp['stylesheets'][number][],
): readonly LiveTargetRenderer<Request>[] {
  if (inheritedStylesheets.length === 0) return renderers;

  return renderers.map((renderer) => {
    const stylesheets = mergedStylesheets(inheritedStylesheets, renderer.stylesheets);
    return {
      ...renderer,
      ...(stylesheets === undefined ? {} : { stylesheets }),
    };
  });
}

function mergedStylesheets<Stylesheet extends KovoApp['stylesheets'][number]>(
  inheritedStylesheets: readonly Stylesheet[],
  ownStylesheets: readonly Stylesheet[] | undefined,
): readonly Stylesheet[] | undefined {
  const inheritedCriticalCss = inheritedStylesheets.flatMap((stylesheet) =>
    typeof stylesheet !== 'string' && stylesheet.criticalCss ? [stylesheet.criticalCss] : [],
  );
  const merged = [
    ...inheritedStylesheets,
    ...(ownStylesheets ?? []).filter(
      (stylesheet) => !stylesheetCriticalCssIsAlreadyLoaded(stylesheet, inheritedCriticalCss),
    ),
  ];
  return merged.length === 0 ? undefined : merged;
}

function stylesheetCriticalCssIsAlreadyLoaded(
  stylesheet: KovoApp['stylesheets'][number],
  inheritedCriticalCss: readonly string[],
): boolean {
  if (typeof stylesheet === 'string') return false;
  const criticalCss = stylesheet.criticalCss?.trim();
  if (!criticalCss) return false;
  return inheritedCriticalCss.some((candidate) => candidate.includes(criticalCss));
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

type MutationRequestBodyResult = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Parse the mutation request body from JSON or form data.
 *
 * SPEC §9.2: a body that is neither `application/json` nor a multipart/url-encoded
 * form, or that fails to parse as the declared content type, is a client-side
 * validation error (422) — not an unexpected server exception. We therefore return
 * a discriminated result instead of throwing so the caller can short-circuit with
 * a typed 422 BEFORE the CSRF check runs (attacker-controllable bad bodies must
 * not drive `onError`).
 */
async function readMutationRequestBody(request: Request): Promise<MutationRequestBodyResult> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';

  if (contentType.includes('application/json')) {
    try {
      const value = await request.json();
      return { ok: true, value };
    } catch {
      return { ok: false, reason: 'invalid-json' };
    }
  }

  if (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType === ''
  ) {
    try {
      const value = await request.formData();
      return { ok: true, value };
    } catch {
      return { ok: false, reason: 'invalid-form' };
    }
  }

  // Unsupported Content-Type (e.g. text/plain, application/xml …).
  return { ok: false, reason: 'unsupported-content-type' };
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
