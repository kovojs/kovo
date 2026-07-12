import {
  renderMutationEndpointResponse,
  mutationResponseWithoutBrowserState,
  type MutationDefinition,
  type MutationFail,
} from './mutation.js';
import type {
  FragmentRenderer,
  LiveTargetRenderer,
  MutationPostLifecycleOutcome,
  MutationPostLifecycleResponseOptions,
} from './mutation-wire.js';
import { mutationCsrfOptions } from './csrf.js';
import { methodNotAllowedWebResponse, serverResponseToWebResponse } from './response.js';
import type { Schema } from './schema.js';
import type {
  AppMutationResponseContext,
  AppMutationResponseOptions,
  AppMutationDeclaration,
  KovoApp,
} from './app-types.js';
import { normalizeAppMutationResponseOptions } from './app-mutation-responses.js';
import {
  appRequestUrl,
  renderAppErrorDocumentResponse,
  renderAppRouteDocumentResponse,
} from './app-document.js';
import { matchShellDispatch } from './shell.js';
import { resolveRequestClientIp } from './app-load-shed.js';
import {
  endpointRequestWithoutSession,
  requestMetadataWithoutAmbientAuthority,
  resolveKovoLifecycleRequest,
} from './response-posture.js';
import { appTaskScheduler } from './task-runtime.js';
import { readUntrustedRequestBody, revealUntrustedRequestValue } from './untrusted-request-body.js';
import { denseOwnRegistryEntryByExactKey } from './registry-lookup.js';
import { canonicalRequestMethod } from './request-method.js';

export async function handleAppMutationRequest(
  app: KovoApp,
  request: Request,
  url: URL,
  mutationKey: string,
): Promise<Response> {
  if (canonicalRequestMethod(request.method) !== 'POST') {
    return methodNotAllowedWebResponse(request, ['POST']);
  }

  const mutation = denseOwnRegistryEntryByExactKey(
    app.mutations,
    mutationKey,
    'App mutation registry',
  );
  if (!mutation) {
    const errorShellRequest = requestMetadataWithoutAmbientAuthority(request);
    return serverResponseToWebResponse(
      mutationResponseWithoutBrowserState(
        await renderAppErrorDocumentResponse(app, errorShellRequest, 404),
      ),
      errorShellRequest,
    );
  }

  // SPEC §6.6/§9.1 (defense-in-depth for KV418): a `csrf: false` mutation skips the synchronizer
  // token, so it MUST be served with no ambient session — cookies are not interpreted, mirroring
  // the §9.1 endpoint() guarantee (endpoints likewise never resolve `sessionProvider`, see
  // app-dispatch.ts). The static KV418 gate already makes a session-referencing `csrf: false`
  // mutation a compile error; this runtime floor makes the exemption sound even if a graph fact
  // is stale or missing, so `req.session` is genuinely absent rather than the victim's cookie.
  const csrfExempt = !mutationRequiresPreBodyCsrf(mutation, app);
  // Neutralize the Web Request itself before body parsing or lifecycle providers can observe it.
  // Omitting sessionProvider alone is insufficient: handlers and DB providers can read the raw
  // Cookie header directly. The proxy also re-wraps every usable clone (SPEC §6.6 / KV418).
  const authorityNeutralRequest = csrfExempt
    ? endpointRequestWithoutSession(request, { stripAuthorization: true })
    : request;
  const mutationRequest = await resolveKovoLifecycleRequest(authorityNeutralRequest, {
    // SPEC §9.5: attach the trustworthy client IP so a `guards.rateLimit({ per: 'ip' })` on this
    // mutation (e.g. a credential mutation) keys by IP. Reuses the coarse limiter's trusted source
    // (`resolveRequestClientIp`), never a raw header read in the guard.
    clientIp: (req) => resolveRequestClientIp(app, req),
    ...(app.db === undefined ? {} : { db: app.db }),
    ...(app.sessionProvider === undefined || csrfExempt
      ? {}
      : { sessionProvider: app.sessionProvider }),
    csrf: { mode: csrfExempt ? 'exempt' : 'protected' },
    idempotency: { mode: app.mutationReplayStore === undefined ? 'none' : 'replay-store' },
    surface: 'mutation',
  });
  const currentUrl = appRequestUrl(url);
  const sourceUrl = mutationSourceUrl(request, url);

  const bodyResult = await readUntrustedRequestBody(mutationRequest);
  if (!bodyResult.ok) {
    // SPEC §6.6/§10.3: CSRF is the first mutation lifecycle gate. If the body cannot
    // be safely decoded to read the submitted token, a CSRF-protected mutation fails
    // closed as CSRF instead of leaking body/schema diagnostics ahead of CSRF.
    if (mutationRequiresPreBodyCsrf(mutation, app)) {
      return renderPreBodyCsrfFailure(app, mutation, mutationRequest, url, sourceUrl);
    }

    return serverResponseToWebResponse(
      {
        body: JSON.stringify({ code: 'VALIDATION', payload: { reason: bodyResult.reason } }),
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'application/json; charset=utf-8',
          Vary: 'Cookie',
        },
        status: 422,
      },
      mutationRequest,
    );
  }
  const rawInput = bodyResult.value;
  const responseRawInput = revealUntrustedRequestValue(
    rawInput,
    'validated app mutation response raw input',
  );
  const mutationResponsePolicy = app.mutationResponses[mutation.key];
  const mutationResponseOptions =
    typeof mutationResponsePolicy === 'function' ? undefined : mutationResponsePolicy;
  const inheritedStylesheets = sourceRouteStylesheets(app, sourceUrl);
  const defaultFailurePageRenderer = defaultAppMutationFailurePageRenderer(
    app,
    mutationRequest,
    sourceUrl,
    mutation.key,
    responseRawInput,
  );
  const requestMutation = mutation as unknown as MutationDefinition<
    string,
    Schema<unknown>,
    Record<string, Schema<unknown>>,
    Request
  >;
  // Derive the build token from the app's client-module registry so it is
  // identical for the page render and this mutation response (SPEC §5.1, §9.1.1).
  const buildToken = app.clientModules.buildToken();
  const taskScheduler = appTaskScheduler(app);
  const fallbackRedirectTo =
    mutation.redirectTo ??
    mutation.defaultRedirectTo ??
    defaultMutationRedirectTo(mutationRequest, appRequestUrl(sourceUrl));
  const responseOptions = appMutationEndpointResponseOptions(
    mutationResponseOptions,
    inheritedStylesheets,
    defaultFailurePageRenderer,
    fallbackRedirectTo,
  );
  const resolvePostLifecycleResponse =
    typeof mutationResponsePolicy !== 'function'
      ? undefined
      : async (
          outcome: MutationPostLifecycleOutcome,
        ): Promise<MutationPostLifecycleResponseOptions | undefined> => {
          const resolved = await mutationResponsePolicy({
            currentUrl,
            key: mutation.key,
            mutation,
            outcome: appMutationResponseOutcome(outcome),
            rawInput: responseRawInput,
            request: mutationRequest,
            url: new URL(url),
          });
          if (resolved === undefined) return undefined;
          return appMutationEndpointResponseOptions(
            normalizeAppMutationResponseOptions(
              resolved,
              `mutationResponses.${mutation.key} post-lifecycle result`,
            ),
            inheritedStylesheets,
            defaultFailurePageRenderer,
            fallbackRedirectTo,
          );
        };

  const endpointResponse = await renderMutationEndpointResponse(requestMutation, {
    buildToken,
    ...(app.csrf === undefined ? {} : { csrf: app.csrf }),
    currentUrl: appRequestUrl(sourceUrl),
    ...(app.mutationReplayStore === undefined ? {} : { replayStore: app.mutationReplayStore }),
    ...(app.onError === undefined ? {} : { onError: app.onError }),
    maxListItems: app.requestLimits.maxQueryListItems,
    ...responseOptions,
    headers: mutationRequest.headers,
    liveTargetRenderers: inheritLiveTargetRendererStylesheets(
      app.liveTargetRenderers,
      inheritedStylesheets,
    ),
    rawInput,
    ...(resolvePostLifecycleResponse === undefined ? {} : { resolvePostLifecycleResponse }),
    request: mutationRequest,
    ...(taskScheduler === undefined ? {} : { taskScheduler }),
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
  const requestMutation = mutation as unknown as MutationDefinition<
    string,
    Schema<unknown>,
    Record<string, Schema<unknown>>,
    Request
  >;
  const buildToken = app.clientModules.buildToken();
  const taskScheduler = appTaskScheduler(app);

  const endpointResponse = await renderMutationEndpointResponse(requestMutation, {
    buildToken,
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
    ...(taskScheduler === undefined ? {} : { taskScheduler }),
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

type ResolvedAppMutationEndpointOptions = MutationPostLifecycleResponseOptions & {
  redirectTo: NonNullable<AppMutationResponseOptions['redirectTo']>;
};

function appMutationResponseOutcome(
  outcome: MutationPostLifecycleOutcome,
): AppMutationResponseContext['outcome'] {
  return outcome.kind === 'success'
    ? Object.freeze({ kind: 'success' })
    : Object.freeze({
        code: String(outcome.result.error.code),
        kind: 'failure',
        status: outcome.result.status,
      });
}

function appMutationEndpointResponseOptions(
  options: AppMutationResponseOptions | undefined,
  inheritedStylesheets: readonly KovoApp['stylesheets'][number][],
  defaultFailurePageRenderer: ((failure: MutationFail) => Promise<string>) | undefined,
  fallbackRedirectTo: NonNullable<AppMutationResponseOptions['redirectTo']>,
): ResolvedAppMutationEndpointOptions {
  const failureStylesheets = mergedStylesheets(inheritedStylesheets, options?.failureStylesheets);
  return {
    redirectTo: options?.redirectTo ?? fallbackRedirectTo,
    ...(options?.failureTarget === undefined ? {} : { failureTarget: options.failureTarget }),
    ...(failureStylesheets === undefined ? {} : { failureStylesheets }),
    ...(options?.fragmentRenderers === undefined
      ? {}
      : {
          fragmentRenderers: inheritFragmentRendererStylesheets(
            options.fragmentRenderers,
            inheritedStylesheets,
          ),
        }),
    ...(options?.renderFailureFragment === undefined
      ? {}
      : { renderFailureFragment: options.renderFailureFragment }),
    ...(options?.renderFailurePage !== undefined
      ? { renderFailurePage: options.renderFailurePage }
      : defaultFailurePageRenderer === undefined
        ? {}
        : { renderFailurePage: defaultFailurePageRenderer }),
  };
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
