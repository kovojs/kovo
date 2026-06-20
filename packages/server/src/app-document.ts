import { reportServerError } from './diagnostics.js';
import { renderErrorDocument, renderRouteDocumentResponse } from './document-core.js';
import type { PageHintOptions } from './hints.js';
import { routeResponseToDocumentResponse, type RoutePageResponse } from './response.js';
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
      ...(app.db === undefined ? {} : { db: app.db }),
      ...(app.onError === undefined ? {} : { onError: app.onError }),
      renderForbidden: async () =>
        appErrorDocumentResponseBody(await renderAppErrorDocumentResponse(app, request, 403)),
      ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
    },
  );

  if (routeResponse.status === 404 && !routeHasBoundary(route, 'notFound')) {
    return renderAppErrorDocumentResponse(app, request, 404);
  }

  if (routeResponse.status === 500 && !routeHasBoundary(route, 'error')) {
    return renderAppErrorDocumentResponse(app, request, 500);
  }

  // Stamp the build-global render-plan version token so the client can detect
  // deploy skew and refetch full rather than applying a delta against a stale
  // base (SPEC §5.1, §9.1.1).
  const buildToken = app.clientModules.buildToken();

  // K3 / SPEC §9.3: derive the broadcast fingerprint from the session identity already resolved on
  // the request (not the whole cookie header), so non-session cookie churn (CSRF rotation, theme)
  // does not produce different fingerprints for the same user across tabs. We do NOT re-resolve via
  // sessionProvider here (it already ran once for the guarded route).
  const sessionFingerprint = sessionFingerprintFromRequest(request);

  return renderRouteDocumentResponse(routeResponseToDocumentResponse(routeResponse), {
    // SPEC §5.2.1 rule 2(b): stamp every full page render; buildToken() is now
    // always non-empty so the carve-out is no longer needed (DEPLOY-3).
    buildToken,
    hints: mergeAppRouteHints(app, route),
    ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
    ...(app.document.template === undefined ? {} : { template: app.document.template }),
    // bugs-1 F34: a guarded route renders session-dependent content; mark its
    // document no-store so a Back/bfcache restore can't show it after logout.
    ...(route.guard === undefined ? {} : { noStore: true }),
    // bugs-1 F13: stamp an opaque per-session fingerprint for the client's
    // cross-principal BroadcastChannel discard (SPEC §9.3).
    ...(sessionFingerprint === undefined ? {} : { sessionFingerprint }),
  });
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

export async function renderAppErrorDocumentResponse(
  app: KovoApp,
  request: Request,
  status: 403 | 404 | 500,
): Promise<RoutePageResponse> {
  const renderer =
    status === 403
      ? app.errorShells.forbidden
      : status === 404
        ? app.errorShells.notFound
        : app.errorShells.serverError;

  if (renderer) {
    try {
      return await renderer({ request, status });
    } catch (error) {
      reportServerError(app.onError, error, {
        operation: 'error-shell',
        request,
        status,
        url: appRequestUrl(new URL(request.url)),
      });
    }
  }

  // SPEC §9.2/§9.5: error shells are app config, but unexpected failures
  // still fall back to a stable no-internals document.
  return renderErrorDocument({
    ...(app.stylesheets.length > 0 ? { hints: { stylesheets: app.stylesheets } } : {}),
    ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
    status,
    ...(app.document.template === undefined ? {} : { template: app.document.template }),
  });
}

export function appRequestUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function renderDefaultRouteValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;

  return JSON.stringify(value);
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
