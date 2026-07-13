import {
  renderMutationEndpointResponse,
  mutationResponseWithoutBrowserState,
  type MutationDefinition,
  type MutationFail,
} from './mutation.js';
import type { LiveTargetRenderer } from './mutation-wire.js';
import { mutationCsrfOptions } from './csrf.js';
import { frameworkMutationFailurePageRenderer } from './mutation-failure-renderer-authority.js';
import { methodNotAllowedWebResponse, serverResponseToWebResponse } from './response.js';
import type { Schema } from './schema.js';
import type { AppMutationDeclaration, KovoApp } from './app-types.js';
import {
  appLiveTargetAttestationAudience,
  appLiveTargetAttestationAuthority,
} from './live-target-app-identity.js';
import {
  appRequestUrl,
  renderAppErrorDocumentResponse,
  renderAppRouteDocumentResponse,
  searchParamsToRecord,
} from './app-document.js';
import { matchShellDispatch } from './shell.js';
import {
  copyRequestServerBindings,
  pinRequestIngressSurface,
  resolveRequestClientIp,
} from './app-load-shed.js';
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
  requestHeaders,
  requestCreateUrl,
  requestHeader,
  requestMethod,
  requestUrlSnapshot,
  requestUrlSearchParams,
} from './request-body-intrinsics.js';
import {
  createSecurityHeaders,
  securityHeadersForEach,
  securityHeadersSet,
  securityStringIncludes,
  securityStringStartsWith,
  securityStringTrim,
} from './response-security-intrinsics.js';
import { witnessGetOwnPropertyDescriptor } from './security-witness-intrinsics.js';
import { createNativeRequest } from './request-carrier.js';
import { authorizeRouteRequest } from './route.js';
import {
  frameworkMutationRenderRequestResolver,
  type MutationRenderRequestResolver,
} from './mutation-render-request-authority.js';
import { sourceDocumentHeaderIsRetained } from './source-document-headers.js';

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
  const sourceUrl = mutationSourceUrl(request, url);
  const sourceRequest = mutationSourceDocumentRequest(authorityNeutralRequest, request, sourceUrl);

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
        sourceRequest,
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
  const inheritedStylesheets = sourceRouteStylesheets(app, sourceUrl);
  const defaultFailurePageRenderer = defaultAppMutationFailurePageRenderer(
    app,
    sourceRequest,
    sourceUrl,
    mutation.key,
    responseRawInput,
    csrfExempt,
  );
  const resolveRenderRequest = mutationRenderRequestResolver(
    app,
    sourceRequest,
    sourceUrl,
    mutationDb,
    csrfExempt,
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
  const failureStylesheets = mergedStylesheets(inheritedStylesheets, undefined);

  const endpointResponse = await renderMutationEndpointResponse(requestMutation, {
    buildToken,
    liveTargetAttestationAuthority,
    liveTargetAudience,
    liveTargetSourceUrl: requestUrlSnapshot(sourceUrl).href,
    ...(app.csrf === undefined ? {} : { csrf: app.csrf }),
    currentUrl: appRequestUrl(sourceUrl),
    ...(app.mutationReplayStore === undefined ? {} : { replayStore: app.mutationReplayStore }),
    ...(app.onError === undefined ? {} : { onError: app.onError }),
    maxListItems: app.requestLimits.maxQueryListItems,
    redirectTo: fallbackRedirectTo,
    ...(failureStylesheets === undefined ? {} : { failureStylesheets }),
    ...(defaultFailurePageRenderer === undefined
      ? {}
      : { renderFailurePage: defaultFailurePageRenderer }),
    headers: mutationRequest.headers,
    liveTargetRenderers: inheritLiveTargetRendererStylesheets(
      app.liveTargetRenderers,
      inheritedStylesheets,
    ),
    rawInput,
    resolveRenderRequest,
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
  sourceRequest: Request,
  url: URL,
  sourceUrl: URL,
  ingressMethod: string,
): Promise<Response> {
  const inheritedStylesheets = sourceRouteStylesheets(app, sourceUrl);
  const defaultFailurePageRenderer = defaultAppMutationFailurePageRenderer(
    app,
    sourceRequest,
    sourceUrl,
    mutation.key,
    {},
    false,
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
    liveTargetSourceUrl: requestUrlSnapshot(sourceUrl).href,
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
  const match = canonicalMutationSourceRoute(app, sourceUrl);
  const routeStylesheets = match === undefined ? [] : (match.route.stylesheets ?? []);
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
  const source = requestHeader(request, 'kovo-current-url') ?? requestHeader(request, 'referer');
  if (!source) return mutationUrl;
  try {
    const mutationSnapshot = requestUrlSnapshot(mutationUrl);
    const url = requestCreateUrl(source, mutationSnapshot.href);
    return requestUrlSnapshot(url).origin === mutationSnapshot.origin ? url : mutationUrl;
  } catch {
    return mutationUrl;
  }
}

function defaultAppMutationFailurePageRenderer(
  app: KovoApp,
  sourceRequest: Request,
  sourceUrl: URL,
  mutationKey: string,
  rawInput: unknown,
  csrfExempt: boolean,
): ((failure: MutationFail) => Promise<string>) | undefined {
  const match = canonicalMutationSourceRoute(app, sourceUrl);
  if (match === undefined) return undefined;

  return frameworkMutationFailurePageRenderer(async (failure) => {
    const response = await renderAppRouteDocumentResponse({
      app,
      jsxContext: { mutationFailure: { failure, input: rawInput, mutationKey } },
      params: match.params,
      request: sourceRequest,
      route: match.route,
      ...(csrfExempt ? { sessionProvider: false as const } : {}),
      url: sourceUrl,
    });

    return typeof response.body === 'string' ? response.body : '';
  });
}

function mutationRenderRequestResolver(
  app: KovoApp,
  sourceRequest: Request,
  sourceUrl: URL,
  db: KovoApp['db'],
  csrfExempt: boolean,
): MutationRenderRequestResolver<Request> {
  let resolution: Promise<Request | undefined> | undefined;
  return frameworkMutationRenderRequestResolver(() => {
    if (resolution === undefined) {
      resolution = resolveAuthorizedMutationSourceRequest(
        app,
        sourceRequest,
        sourceUrl,
        db,
        csrfExempt,
      );
    }
    return resolution;
  });
}

async function resolveAuthorizedMutationSourceRequest(
  app: KovoApp,
  sourceRequest: Request,
  sourceUrl: URL,
  db: KovoApp['db'],
  csrfExempt: boolean,
): Promise<Request | undefined> {
  const match = canonicalMutationSourceRoute(app, sourceUrl);
  if (match === undefined) return undefined;
  const authorization = await authorizeRouteRequest(
    match.route,
    {
      params: match.params,
      search: searchParamsToRecord(requestUrlSearchParams(sourceUrl)),
    },
    sourceRequest,
    {
      // The source route is authorized against a fresh GET carrier. In particular, csrf:false
      // mutations must not re-expose the ingress Cookie/Authorization headers through an
      // app-configured clientIp resolver while preparing response-side query/render authority.
      // Adapter-owned peer bindings were copied onto sourceRequest above, so trusted IP metadata
      // remains available without reopening ambient credentials (SPEC §6.6/§9.1/§9.5).
      clientIp: () => resolveRequestClientIp(app, sourceRequest),
      ...(db === undefined ? {} : { db }),
      ...(app.onError === undefined ? {} : { onError: app.onError }),
      ...(app.sessionProvider === undefined || csrfExempt
        ? {}
        : { sessionProvider: app.sessionProvider }),
    },
  );
  return authorization.ok ? authorization.request : undefined;
}

function canonicalMutationSourceRoute(app: KovoApp, sourceUrl: URL) {
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    method: 'GET',
    pathname: requestUrlSnapshot(sourceUrl).pathname,
    routes: app.routes,
  });
  return match.kind === 'route' && match.methodAllowed && match.normalization.redirect === undefined
    ? match
    : undefined;
}

function mutationSourceDocumentRequest(
  template: Request,
  ingressRequest: Request,
  sourceUrl: URL,
): Request {
  const headers = createSecurityHeaders();
  securityHeadersForEach(requestHeaders(template), (value, name) => {
    if (sourceDocumentHeaderIsRetained(name)) securityHeadersSet(headers, name, value);
  });
  securityHeadersSet(headers, 'Accept', 'text/html');
  const sourceRequest = createNativeRequest(requestUrlSnapshot(sourceUrl).href, {
    headers,
    method: 'GET',
  });
  copyRequestServerBindings(ingressRequest, sourceRequest);
  pinRequestIngressSurface(sourceRequest);
  return sourceRequest;
}
