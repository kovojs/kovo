import { acceptsEnhancedNavigationDocument } from '@kovojs/core/internal/document-protocol';

import { recordAppCapability } from './app-capabilities.js';
import { normalizeForwardedSetCookie } from './cookies.js';
import { documentContentSecurityPolicyOptions } from './csp.js';
import { reportServerError, serverErrorHeaders, type ServerErrorReport } from './diagnostics.js';
import {
  mergeVaryHeader,
  renderErrorDocument,
  renderRouteDocumentResponse,
  withDefaultDocumentSecurityHeaders,
} from './document-core.js';
import { ensureKovoLoaderRuntimeClientModule } from './loader-runtime-client-module.js';
import type { PageHintOptions } from './hints.js';
import { isRenderedHtml, renderHtmlValue, unwrapCoercedRenderedHtml } from './html.js';
import {
  appendResponseHeader,
  readHeader,
  routeResponseToDocumentResponse,
  type RoutePageResponse,
} from './response.js';
import {
  renderRoutePageResponse,
  routeHasBoundary,
  type RouteJsxContextOptions,
  type RouteDeclaration,
  type RouteRequestInput,
} from './route.js';
import type { KovoApp } from './app-types.js';

type AnyRouteDeclaration = RouteDeclaration<any, any, any, any, any, any>;

export interface AppRouteDocumentOptions {
  app: KovoApp;
  jsxContext?: RouteJsxContextOptions<Request>;
  params: Record<string, string>;
  request: Request;
  route: AnyRouteDeclaration;
  url: URL;
}

export async function renderAppRouteDocumentResponse({
  app,
  jsxContext,
  params,
  request,
  route,
  url,
}: AppRouteDocumentOptions): Promise<RoutePageResponse> {
  const search = searchParamsToRecord(url.searchParams);
  const routeInput: RouteRequestInput = {
    params,
    search,
  };
  // part-3 I2 (SPEC §6.5, §9.1.1:854): a rolling/refresh session provider (e.g. Better Auth
  // `updateAge`/`cookieCache`) emits fresh `Set-Cookie` headers on each authenticated GET via the
  // `{ value, setCookies }` provider envelope. The route lifecycle forwards them to this sink; we
  // re-emit them on the document response so a continuously-active user's session actually extends
  // instead of being hard-logged-out at the original boundary.
  const refreshSetCookies: string[] = [];
  const routeResponse = await renderRoutePageResponse(
    route,
    routeInput,
    request,
    (value) =>
      app.renderRoute
        ? app.renderRoute(value, {
            params,
            request,
            route,
            search,
          })
        : renderDefaultRouteValue(value),
    {
      currentUrl: appRequestUrl(url),
      ...(app.csrf === undefined ? {} : { csrf: app.csrf }),
      ...(jsxContext?.mutationFailure === undefined
        ? {}
        : { mutationFailure: jsxContext.mutationFailure }),
      onCsrfSetCookie: (rawSetCookie) => refreshSetCookies.push(rawSetCookie),
      ...(app.db === undefined ? {} : { db: app.db }),
      ...(routeCanMintCapabilityUrls(route) && app.capabilityUrls !== undefined
        ? { capabilityUrls: app.capabilityUrls }
        : {}),
      egressFetch: app.egress.fetch,
      onCapabilityUrlMint: (fact) => recordAppCapability(app, fact),
      ...(app.onError === undefined ? {} : { onError: app.onError }),
      onSessionSetCookie: (rawSetCookie) => refreshSetCookies.push(rawSetCookie),
      renderForbidden: async () =>
        appErrorDocumentResponseBody(await renderAppErrorDocumentResponse(app, request, 403)),
      ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
    },
  );

  const withRefreshCookies = (response: RoutePageResponse): RoutePageResponse => {
    for (const cookie of refreshSetCookies) {
      appendResponseHeader(response.headers, 'Set-Cookie', normalizeForwardedSetCookie(cookie));
    }
    return response;
  };

  if (routeResponse.status === 404 && !routeHasBoundary(route, 'notFound')) {
    return withRefreshCookies(await renderAppErrorDocumentResponse(app, request, 404));
  }

  if (routeResponse.status === 500 && !routeHasBoundary(route, 'error')) {
    return withRefreshCookies(await renderAppErrorDocumentResponse(app, request, 500));
  }

  // Stamp the build-global render-plan version token so the client can detect
  // deploy skew and refetch full rather than applying a delta against a stale
  // base (SPEC §5.1, §9.1.1).
  const loaderRuntimeHref = ensureKovoLoaderRuntimeClientModule(app.clientModules);
  const buildToken = app.clientModules.buildToken();

  // K3 / SPEC §9.3: derive the broadcast fingerprint from the session identity already resolved on
  // the request (not the whole cookie header), so non-session cookie churn (CSRF rotation, theme)
  // does not produce different fingerprints for the same user across tabs. We do NOT re-resolve via
  // sessionProvider here (it already ran once for the guarded route).
  const sessionFingerprint = sessionFingerprintFromRequest(
    routeResponse.lifecycleRequest instanceof Request ? routeResponse.lifecycleRequest : request,
  );

  // part-4 G1 (SPEC §9.4:906 caching contract, §9.4:767 bfcache hygiene): a response that carries a
  // per-principal `Set-Cookie` (a rolling/refresh session token forwarded by the sessionProvider via
  // `onSessionSetCookie` — part-3 I2) varies by identity, so it MUST never be stored by a shared
  // CDN/proxy cache; otherwise the cached document replays one user's session cookie to other
  // visitors (cross-principal token leak / takeover). The sessionProvider runs on every route —
  // guarded or not (route.ts) — so an authenticated user loading an UNGUARDED route (the public `/`)
  // also gets a refresh cookie. Force `no-store` whenever any per-principal cookie was emitted,
  // independent of `route.guard`. (We do NOT change the cookie forwarding itself.)
  const noStore = route.guard !== undefined || refreshSetCookies.length > 0;
  const enhancedNavigationDocument = acceptsEnhancedNavigationDocument(
    request.headers.get('accept'),
  );

  const documentResponse = renderRouteDocumentResponse(
    routeResponseToDocumentResponse(routeResponse),
    {
      // SPEC §5.2.1 rule 2(b): stamp every full page render; buildToken() is now
      // always non-empty so the carve-out is no longer needed (DEPLOY-3).
      buildToken,
      cspOptions: documentContentSecurityPolicyOptions(app.document.csp),
      hints: mergeAppRouteHints(app, route),
      ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
      loaderRuntimeHref,
      ...(app.document.template === undefined ? {} : { template: app.document.template }),
      // bugs-1 F34: a guarded route renders session-dependent content; mark its
      // document no-store so a Back/bfcache restore can't show it after logout.
      // part-4 G1: also no-store when a per-principal refresh `Set-Cookie` rode this
      // response on an unguarded route (cross-principal shared-cache leak).
      ...(noStore ? { noStore: true } : {}),
      // SPEC §4.4 / plans/better-js-loader.md: enhanced navigation has already
      // installed the inline loader, so its negotiated document variant omits the
      // stable bootstrap bytes while retaining a complete parseable document.
      ...(enhancedNavigationDocument ? { loader: 'omit' } : {}),
      // bugs-1 F13: stamp an opaque per-session fingerprint for the client's
      // cross-principal BroadcastChannel discard (SPEC §9.3).
      ...(sessionFingerprint === undefined ? {} : { sessionFingerprint }),
    },
  );

  if (enhancedNavigationDocument && documentResponse.status === 200) {
    documentResponse.headers = mergeVaryHeader(documentResponse.headers, 'Accept');
  }

  return withRefreshCookies(documentResponse);
}

/**
 * bugs-1 F13 / K3 / SPEC §9.3: an opaque per-principal fingerprint derived from the
 * resolved session identity so that non-session cookie churn (CSRF rotation, theme,
 * analytics) does not produce different fingerprints for the same user across tabs.
 *
 * Resolution order (most to least session-anchored):
 *   1. `request.session?.id` / `request.sessionId` / `request.session?.user?.id` —
 *      the session the route lifecycle already resolved for this request. We deliberately do NOT
 *      call `app.sessionProvider` again here: the guarded route resolves the session exactly once,
 *      and re-resolving it solely for the broadcast fingerprint would double-run the provider.
 *   2. Cookie fallback: hash the first cookie value only (not the whole header) to
 *      reduce false mismatch on non-session cookie churn when no resolved session is present.
 * Returns `undefined` only when the request is genuinely anonymous (no cookies at all).
 *
 * The id is hashed (FNV-1a) to keep the raw session token out of the BroadcastChannel
 * envelope (SPEC §9.3 "opaque").
 */
function sessionFingerprintFromRequest(request: Request): string | undefined {
  // 1. Pre-resolved session id fields set by the route lifecycle / adapters.
  const req = request as unknown as {
    session?: { id?: string; user?: { id?: string } };
    sessionId?: string;
  };
  const resolvedId =
    (typeof req.session?.id === 'string' && req.session.id !== '' ? req.session.id : undefined) ??
    (typeof req.sessionId === 'string' && req.sessionId !== '' ? req.sessionId : undefined) ??
    (typeof req.session?.user?.id === 'string' && req.session.user.id !== ''
      ? req.session.user.id
      : undefined);

  if (resolvedId !== undefined) return fnv1aHash(resolvedId);

  // 2. Cookie fallback: hash the first cookie value only (not the whole header) to
  //    limit false mismatch from non-session cookie churn (K3 partial mitigation).
  const cookie = request.headers.get('cookie');
  if (!cookie) return undefined;
  const firstValue = firstCookieValue(cookie);
  return firstValue !== undefined ? fnv1aHash(firstValue) : fnv1aHash(cookie);
}

/** FNV-1a 32-bit hash — same algorithm as the previous implementation. */
function fnv1aHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Extract the value portion of the first `name=value` pair in a cookie header. */
function firstCookieValue(cookie: string): string | undefined {
  const eq = cookie.indexOf('=');
  if (eq < 0) return undefined;
  const semi = cookie.indexOf(';', eq);
  return cookie.slice(eq + 1, semi < 0 ? undefined : semi).trim() || undefined;
}

function appErrorDocumentResponseBody(response: RoutePageResponse): string {
  return typeof response.body === 'string' ? response.body : '';
}

function routeCanMintCapabilityUrls(route: AnyRouteDeclaration): boolean {
  // Capability URLs are bearer credentials. Public anonymous documents remain
  // cacheable by default, so only private/no-store route documents receive
  // request.signUrl; endpoints and mutations keep their own audited mint paths.
  return route.guard !== undefined;
}

export async function renderAppErrorDocumentResponse(
  app: KovoApp,
  request: Request,
  status: 403 | 404 | 500,
  errorReport?: ServerErrorReport,
): Promise<RoutePageResponse> {
  let report = errorReport;
  const renderer =
    status === 403
      ? app.errorShells.forbidden
      : status === 404
        ? app.errorShells.notFound
        : app.errorShells.serverError;

  if (renderer) {
    try {
      const response = await renderer({ request, status });
      return withServerErrorReport(
        withDefaultHtmlErrorShellSecurityHeaders(
          response,
          documentContentSecurityPolicyOptions(app.document.csp),
        ),
        status,
        report,
      );
    } catch (error) {
      report = reportServerError(app.onError, error, {
        operation: 'error-shell',
        request,
        status,
        url: appRequestUrl(new URL(request.url)),
      });
    }
  }

  // SPEC §9.2/§9.5: error shells are app config, but unexpected failures
  // still fall back to a stable no-internals document.
  return withServerErrorReport(
    renderErrorDocument({
      ...(app.stylesheets.length > 0 ? { hints: { stylesheets: app.stylesheets } } : {}),
      cspOptions: documentContentSecurityPolicyOptions(app.document.csp),
      ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
      loaderRuntimeHref: ensureKovoLoaderRuntimeClientModule(app.clientModules),
      status,
      ...(app.document.template === undefined ? {} : { template: app.document.template }),
    }),
    status,
    report,
  );
}

function withServerErrorReport(
  response: RoutePageResponse,
  status: 403 | 404 | 500,
  report: ServerErrorReport | undefined,
): RoutePageResponse {
  if (status !== 500 || report === undefined) return response;

  return {
    ...response,
    headers: { ...response.headers, ...serverErrorHeaders(report) },
  };
}

function withDefaultHtmlErrorShellSecurityHeaders(
  response: RoutePageResponse,
  cspOptions = documentContentSecurityPolicyOptions(undefined),
): RoutePageResponse {
  const contentType = readHeader(response.headers, 'Content-Type');
  if (contentType === undefined || !contentType.toLowerCase().includes('text/html')) {
    return response;
  }

  return {
    ...response,
    headers: withDefaultDocumentSecurityHeaders(response.headers, undefined, cspOptions),
  };
}

export function appRequestUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function renderDefaultRouteValue(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (isRenderedHtml(value)) return value.html;
  if (typeof value === 'string') return unwrapCoercedRenderedHtml(value);
  return renderHtmlValue(value);
}

function mergeAppRouteHints(app: KovoApp, route: AnyRouteDeclaration): PageHintOptions {
  const stylesheets = [...app.stylesheets, ...(route.stylesheets ?? [])];
  return {
    ...route,
    ...(stylesheets.length > 0 ? { stylesheets } : {}),
  };
}

function searchParamsToRecord(searchParams: URLSearchParams): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams) {
    const existing = record[key];
    if (existing === undefined) {
      record[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      record[key] = [existing, value];
    }
  }

  return record;
}
