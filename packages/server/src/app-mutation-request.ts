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
import {
  appLiveTargetAttestationAudience,
  appLiveTargetAttestationAuthority,
} from './live-target-app-identity.js';
import { normalizeAppMutationResponseOptions } from './app-mutation-responses.js';
import {
  appRequestUrl,
  renderAppErrorDocumentResponse,
  renderAppRouteDocumentResponse,
} from './app-document.js';
import { matchShellDispatch } from './shell.js';
import { pinRequestIngressSurface, resolveRequestClientIp } from './app-load-shed.js';
import {
  endpointRequestWithoutSession,
  requestMetadataWithoutAmbientAuthority,
  resolveKovoLifecycleRequest,
} from './response-posture.js';
import { appTaskScheduler } from './task-runtime.js';
import { readUntrustedRequestBody, revealUntrustedRequestValue } from './untrusted-request-body.js';
import {
  appendDenseOwnArrayValue,
  denseOwnArrayFind,
  denseOwnArrayForEach,
  denseOwnRegistryEntryByExactKey,
} from './registry-lookup.js';
import { canonicalRequestMethod } from './request-method.js';
import {
  requestCreateUrl,
  requestHeader,
  requestMethod,
  requestUrlSnapshot,
} from './request-body-intrinsics.js';
import {
  securityStringIncludes,
  securityStringStartsWith,
  securityStringTrim,
} from './response-security-intrinsics.js';
import { witnessFreeze, witnessGetOwnPropertyDescriptor } from './security-witness-intrinsics.js';

export async function handleAppMutationRequest(
  app: KovoApp,
  request: Request,
  url: URL,
  mutationKey: string,
  ingressMethod: string = requestMethod(request),
): Promise<Response> {
  pinRequestIngressSurface(request);
  if (canonicalRequestMethod(ingressMethod) !== 'POST') {
    return methodNotAllowedWebResponse({ method: ingressMethod }, ['POST']);
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
      { method: ingressMethod },
    );
  }

  // SPEC §6.6/§9.1 (defense-in-depth for KV418): a `csrf: false` mutation skips the synchronizer
  // token, so it MUST be served with no ambient session — cookies are not interpreted, mirroring
  // the §9.1 endpoint() guarantee (endpoints likewise never resolve `sessionProvider`, see
  // app-dispatch.ts). The static KV418 gate already makes a session-referencing `csrf: false`
  // mutation a compile error; this runtime floor makes the exemption sound even if a graph fact
  // is stale or missing, so `req.session` is genuinely absent rather than the victim's cookie.
  const csrfExempt = !mutationRequiresPreBodyCsrf(mutation, app);
  const mutationDb = csrfExempt ? mutationDbProvider(app, request) : app.db;
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
    ...(mutationDb === undefined ? {} : { db: mutationDb }),
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
      return renderPreBodyCsrfFailure(
        app,
        mutation,
        mutationRequest,
        url,
        sourceUrl,
        ingressMethod,
      );
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
      { method: ingressMethod },
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
  const liveTargetAudience = appLiveTargetAttestationAudience(app, buildToken);
  const liveTargetAttestationAuthority = appLiveTargetAttestationAuthority(app, buildToken);
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
            url: requestCreateUrl(requestUrlSnapshot(url).href),
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
    liveTargetAttestationAuthority,
    liveTargetAudience,
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

  return serverResponseToWebResponse(endpointResponse, { method: ingressMethod });
}

function mutationDbProvider(app: KovoApp, request: Request): KovoApp['db'] {
  // SPEC §6.6/§9.5/§11.2: an explicit app provider is the primary DB authority. Do not even
  // inspect a caller-added request property when that framework configuration exists.
  if (app.db !== undefined) return app.db;

  // Adapters may bind a request-scoped DB/verifier capability as an own data property before
  // dispatch (the integration harness and app shells use this contract). A csrf:false mutation
  // reconstructs a fresh credential-neutral Web Request, so capture that one explicit server
  // capability before cloning and reinstall it through the normal managed-db lifecycle provider.
  // Accessors and inherited values remain outside the authority boundary and are never invoked.
  const descriptor = witnessGetOwnPropertyDescriptor(request, 'db');
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError('A request-scoped mutation db must be an own data property.');
  }
  const requestDb = descriptor.value;
  return requestDb === undefined ? undefined : () => requestDb;
}

async function renderPreBodyCsrfFailure(
  app: KovoApp,
  mutation: AppMutationDeclaration,
  request: Request,
  url: URL,
  sourceUrl: URL,
  ingressMethod: string,
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
  const liveTargetAudience = appLiveTargetAttestationAudience(app, buildToken);
  const liveTargetAttestationAuthority = appLiveTargetAttestationAuthority(app, buildToken);
  const taskScheduler = appTaskScheduler(app);

  const endpointResponse = await renderMutationEndpointResponse(requestMutation, {
    buildToken,
    liveTargetAttestationAuthority,
    liveTargetAudience,
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

  return serverResponseToWebResponse(endpointResponse, { method: ingressMethod });
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
    pathname: requestUrlSnapshot(sourceUrl).pathname,
    routes: app.routes,
  });
  const routeStylesheets =
    match.kind === 'route' && match.methodAllowed ? (match.route.stylesheets ?? []) : [];
  const stylesheets: KovoApp['stylesheets'][number][] = [];
  denseOwnArrayForEach(
    app.stylesheets,
    (stylesheet) => appendDenseOwnArrayValue(stylesheets, stylesheet),
    'App stylesheet snapshot',
  );
  denseOwnArrayForEach(
    routeStylesheets,
    (stylesheet) => appendDenseOwnArrayValue(stylesheets, stylesheet),
    'Route stylesheet snapshot',
  );
  return stylesheets;
}

function inheritFragmentRendererStylesheets(
  renderers: readonly FragmentRenderer[],
  inheritedStylesheets: readonly KovoApp['stylesheets'][number][],
): readonly FragmentRenderer[] {
  if (inheritedStylesheets.length === 0) return renderers;

  const inherited: FragmentRenderer[] = [];
  denseOwnArrayForEach(
    renderers,
    (renderer) => {
      const stylesheets = mergedStylesheets(inheritedStylesheets, renderer.stylesheets);
      appendDenseOwnArrayValue(inherited, {
        ...renderer,
        ...(stylesheets === undefined ? {} : { stylesheets }),
      });
    },
    'Mutation fragment renderer snapshot',
  );
  return inherited;
}

function inheritLiveTargetRendererStylesheets<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
  inheritedStylesheets: readonly KovoApp['stylesheets'][number][],
): readonly LiveTargetRenderer<Request>[] {
  if (inheritedStylesheets.length === 0) return renderers;

  const inherited: LiveTargetRenderer<Request>[] = [];
  denseOwnArrayForEach(
    renderers,
    (renderer) => {
      const stylesheets = mergedStylesheets(inheritedStylesheets, renderer.stylesheets);
      appendDenseOwnArrayValue(inherited, {
        ...renderer,
        ...(stylesheets === undefined ? {} : { stylesheets }),
      });
    },
    'Mutation live-target renderer snapshot',
  );
  return inherited;
}

function mergedStylesheets<Stylesheet extends KovoApp['stylesheets'][number]>(
  inheritedStylesheets: readonly Stylesheet[],
  ownStylesheets: readonly Stylesheet[] | undefined,
): readonly Stylesheet[] | undefined {
  const inheritedCriticalCss: string[] = [];
  denseOwnArrayForEach(
    inheritedStylesheets,
    (stylesheet) => {
      if (typeof stylesheet !== 'string' && stylesheet.criticalCss) {
        appendDenseOwnArrayValue(inheritedCriticalCss, stylesheet.criticalCss);
      }
    },
    'Inherited mutation stylesheet snapshot',
  );
  const merged: Stylesheet[] = [];
  denseOwnArrayForEach(
    inheritedStylesheets,
    (stylesheet) => appendDenseOwnArrayValue(merged, stylesheet),
    'Inherited mutation stylesheet snapshot',
  );
  if (ownStylesheets !== undefined) {
    denseOwnArrayForEach(
      ownStylesheets,
      (stylesheet) => {
        if (!stylesheetCriticalCssIsAlreadyLoaded(stylesheet, inheritedCriticalCss)) {
          appendDenseOwnArrayValue(merged, stylesheet);
        }
      },
      'Mutation renderer stylesheet snapshot',
    );
  }
  return merged.length === 0 ? undefined : merged;
}

function stylesheetCriticalCssIsAlreadyLoaded(
  stylesheet: KovoApp['stylesheets'][number],
  inheritedCriticalCss: readonly string[],
): boolean {
  if (typeof stylesheet === 'string') return false;
  const criticalCss =
    stylesheet.criticalCss === undefined ? undefined : securityStringTrim(stylesheet.criticalCss);
  if (!criticalCss) return false;
  return (
    denseOwnArrayFind(
      inheritedCriticalCss,
      (candidate) => securityStringIncludes(candidate, criticalCss),
      'Inherited mutation critical CSS snapshot',
    ) !== undefined
  );
}

type ResolvedAppMutationEndpointOptions = MutationPostLifecycleResponseOptions & {
  redirectTo: NonNullable<AppMutationResponseOptions['redirectTo']>;
};

function appMutationResponseOutcome(
  outcome: MutationPostLifecycleOutcome,
): AppMutationResponseContext['outcome'] {
  return outcome.kind === 'success'
    ? witnessFreeze({ kind: 'success' })
    : witnessFreeze({
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
  const referer = requestHeader(request, 'referer');
  if (referer) {
    try {
      const url = requestCreateUrl(referer);
      return appRequestUrl(url);
    } catch {
      return referer;
    }
  }

  return securityStringStartsWith(currentUrl, '/_m/') ? '/' : currentUrl;
}

function mutationSourceUrl(request: Request, mutationUrl: URL): URL {
  const referer = requestHeader(request, 'referer');
  if (!referer) return mutationUrl;
  try {
    const mutationSnapshot = requestUrlSnapshot(mutationUrl);
    const url = requestCreateUrl(referer, mutationSnapshot.href);
    return requestUrlSnapshot(url).origin === mutationSnapshot.origin ? url : mutationUrl;
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
    pathname: requestUrlSnapshot(sourceUrl).pathname,
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
