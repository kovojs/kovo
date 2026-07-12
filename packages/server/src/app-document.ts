import { randomBytes } from 'node:crypto';

import { acceptsEnhancedNavigationDocument } from '@kovojs/core/internal/document-protocol';

import { principalPostureFromRequest } from './auth-principal.js';
import { reportServerError } from './diagnostics.js';
import {
  mergeVaryHeader,
  renderErrorDocument,
  renderRouteDocumentResponse,
  stampCredentialBearingResponseCacheFloor,
} from './document-core.js';
import { forwardSetCookie } from './cookies.js';
import { signingKeyRingFromSecret, type SigningSecret } from './keyring.js';
import {
  createSignUrl,
  storageDownloadEndpointInfo,
  type StorageDownloadEndpointInfo,
} from './capability-route.js';
import { resolveRequestClientIp } from './app-load-shed.js';
import { ensureKovoLoaderRuntimeClientModule } from './loader-runtime-client-module.js';
import type { PageHintOptions } from './hints.js';
import {
  isRenderedHtml,
  renderedHtmlContent,
  renderHtmlValue,
  unwrapCoercedRenderedHtml,
} from './html.js';
import {
  appendResponseHeader,
  routeResponseToDocumentResponse,
  type RoutePageResponse,
} from './response.js';
import type { ForbiddenRenderer } from './guards.js';
import {
  renderRoutePageResponse,
  parseRouteRequest,
  routeHasBoundary,
  type RouteJsxContextOptions,
  type RouteDeclaration,
  type RouteRequestInput,
} from './route.js';
import { queryRuntimeWarningHeaderValue, queryRuntimeWarningsFromRequest } from './query.js';
import type { KovoApp } from './app-types.js';
import { isTrustedSecureRequest } from './request-scheme.js';
import { isNativeRequest, requestForAuthorityNeutralMetadata } from './request-carrier.js';
import {
  requestCreateUrl,
  requestUrl,
  requestUrlSearchParams,
  requestUrlSearchParamsEntries,
  requestUrlSnapshot,
} from './request-body-intrinsics.js';
import { requestMetadataWithoutAmbientAuthority } from './response-posture.js';
import {
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessReflectApply,
  witnessReflectGet,
} from './security-witness-intrinsics.js';

type AnyRouteDeclaration = RouteDeclaration<any, any, any, any, any, any>;
const fallbackBroadcastFingerprintSecret = randomBytes(32);

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
  const search = searchParamsToRecord(requestUrlSearchParams(url));
  // SPEC §6.6 / §9.1: thread `ctx.signUrl` onto the page context when a storage download endpoint
  // is mounted. The route context must mint with the same configured capability signer that the
  // endpoint verify sink uses; otherwise the documented pairing fails closed as an opaque 404.
  const storageDownloadSigner = appStorageDownloadSigner(app, request);
  const signUrlContext =
    storageDownloadSigner.kind === 'absent'
      ? undefined
      : storageDownloadSigner.kind === 'ready'
        ? createSignUrl({
            secret: storageDownloadSigner.secret,
            basePath: storageDownloadSigner.basePath,
            ...(storageDownloadSigner.defaultScope === undefined
              ? {}
              : { defaultScope: storageDownloadSigner.defaultScope }),
            oneTimeReplayStore: storageDownloadSigner.oneTimeReplayStore,
          })
        : createUnavailableSignUrl(storageDownloadSigner.message);
  const signUrl =
    signUrlContext === undefined ? undefined : signUrlContext.signUrl.bind(signUrlContext);
  const routeInput: RouteRequestInput = {
    params,
    search,
    ...(signUrl === undefined ? {} : { signUrl }),
  };
  // part-3 I2 (SPEC §6.5, §9.1.1:854): a rolling/refresh session provider (e.g. Better Auth
  // `updateAge`/`cookieCache`) emits fresh `Set-Cookie` headers on each authenticated GET via the
  // `{ value, setCookies }` provider envelope. The route lifecycle forwards them to this sink; we
  // re-emit them on the document response so a continuously-active user's session actually extends
  // instead of being hard-logged-out at the original boundary.
  const refreshSetCookies: { raw: string; source: 'csrf' | 'session-provider' }[] = [];
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
      maxListItems: app.requestLimits.maxQueryListItems,
      onCsrfSetCookie: (rawSetCookie) =>
        refreshSetCookies.push({ raw: rawSetCookie, source: 'csrf' }),
      ...(app.db === undefined ? {} : { db: app.db }),
      ...(app.onError === undefined ? {} : { onError: app.onError }),
      onSessionSetCookie: (rawSetCookie) =>
        refreshSetCookies.push({ raw: rawSetCookie, source: 'session-provider' }),
      clientIp: (req) => resolveRequestClientIp(app, req),
      renderForbidden: (async () => {
        const forbidden = await renderAppErrorDocumentResponse(app, request, 403);
        return {
          ...forbidden,
          body: typeof forbidden.body === 'string' ? forbidden.body : '',
          status: 403 as const,
        };
      }) as unknown as ForbiddenRenderer<Request>,
      ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
    },
  );
  let metaContext: ReturnType<typeof parseRouteRequest> | undefined;
  try {
    metaContext = parseRouteRequest(route, routeInput);
  } catch {
    metaContext = undefined;
  }

  const withRefreshCookies = (response: RoutePageResponse): RoutePageResponse => {
    // Forwarded session/CSRF Set-Cookie strings are routed through the cookie floor
    // (cookies.ts) so a forwarded credential cookie can never land below the
    // HttpOnly/Secure(prod)/SameSite floor (SPEC §6.6/§9.1).
    for (const cookie of refreshSetCookies)
      appendResponseHeader(
        response.headers,
        'Set-Cookie',
        forwardSetCookie(cookie.raw, { class: 'session', source: cookie.source }),
      );
    return refreshSetCookies.length > 0
      ? stampCredentialBearingResponseCacheFloor(response)
      : response;
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
  const sessionRequest = isNativeRequest(routeResponse.lifecycleRequest)
    ? routeResponse.lifecycleRequest
    : request;
  const principalPosture = principalPostureFromRequest(sessionRequest);
  const sessionFingerprint =
    principalPosture.kind === 'proven'
      ? hmacSessionFingerprint(principalPosture.principal, app.csrf?.secret)
      : undefined;

  // part-4 G1 + bugz-3 L2 (SPEC §9.4:927 caching contract, §9.5:780 bfcache posture): a document
  // that varies by identity MUST never be stored by a shared CDN/proxy cache nor restored from
  // bfcache across the guard; otherwise the cached page replays one principal's private content
  // (and any per-principal `Set-Cookie`) to other visitors (cross-principal leak / takeover). Three
  // independent signals make a document session-dependent:
  //   1. `route.guard !== undefined` — a guarded route renders per-principal content (§9.5:780).
  //   2. `refreshSetCookies.length > 0` — a rolling/refresh session token forwarded by the
  //      sessionProvider via `onSessionSetCookie`/`onCsrfSetCookie` (part-3 I2) rides the response.
  //   3. `sessionFingerprint !== undefined` — the route lifecycle resolved a per-principal session
  //      identity and this document stamps the `kovo-session` fingerprint. bugz-3 L2: a NON-ROLLING
  //      provider (long-lived cookie / JWT, Better Auth without `updateAge`/`cookieCache`, the
  //      opaque-session manager that never rolls on GET) emits no refresh `Set-Cookie`, so signals
  //      1–2 miss an authenticated UNGUARDED route even though it serves per-principal state. Gate
  //      on the RESOLVED session identity, not on whether a refresh cookie happened to be emitted.
  // (We do NOT change the cookie forwarding itself.)
  const noStore =
    route.guard !== undefined ||
    refreshSetCookies.length > 0 ||
    sessionFingerprint !== undefined ||
    principalPosture.kind === 'unresolved';
  const enhancedNavigationDocument = acceptsEnhancedNavigationDocument(
    request.headers.get('accept'),
  );

  // SPEC §6.6: HSTS is attached only when the adapter-proven request scheme is HTTPS.
  // Do not reread spoofable forwarding headers here; trusted proxy configuration is
  // already reflected in Request.url by the adapter.
  const secure = isTrustedSecureRequest(request);

  const documentResponse = renderRouteDocumentResponse(
    routeResponseToDocumentResponse(routeResponse),
    {
      // SPEC §5.2.1 rule 2(b): stamp every full page render; buildToken() is now
      // always non-empty so the carve-out is no longer needed (DEPLOY-3).
      buildToken,
      ...(secure ? { secure: true } : {}),
      // SF (secure-framework Tier 3, SPEC §6.6 runtime DiD): thread the app's third-party
      // CSP allowlist + Trusted Types opt-in (`createApp({ document: { csp } })`) into the
      // auto-attached strict document CSP so declared analytics/Stripe/embed origins are
      // APPENDED to the overridable per-fetch directives. Hardening directives stay locked
      // (the allowlist can never reach them — see csp.ts `renderDefaultDocumentCsp`).
      ...(app.document.csp === undefined ? {} : { csp: app.document.csp }),
      ...(app.document.structured === undefined ? {} : { document: app.document.structured }),
      hints: mergeAppRouteHints(app, route),
      ...(metaContext === undefined ? {} : { metaContext }),
      ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
      loaderRuntimeHref,
      reportingOrigin: requestUrlSnapshot(
        requestCreateUrl(requestUrl(requestForAuthorityNeutralMetadata(request))),
      ).origin,
      // bugs-1 F34: a guarded route renders session-dependent content; mark its
      // document no-store so a Back/bfcache restore can't show it after logout.
      // part-4 G1: also no-store when a per-principal refresh `Set-Cookie` rode this
      // response on an unguarded route (cross-principal shared-cache leak).
      // bugz-3 L2 (SPEC §9.5:780): also no-store when a per-principal session identity
      // resolved (a stamped `kovo-session` fingerprint) even under a non-rolling provider.
      // `renderRouteDocumentResponse` carries this floor onto file/stream outcomes too (M2).
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
  const queryWarningHeader = queryRuntimeWarningHeaderValue(
    queryRuntimeWarningsFromRequest(routeResponse.lifecycleRequest),
  );
  if (queryWarningHeader !== undefined) {
    appendResponseHeader(documentResponse.headers, 'Kovo-Warn', queryWarningHeader);
  }

  return withRefreshCookies(documentResponse);
}

type AppStorageDownloadSigner =
  | {
      kind: 'ready';
      basePath: string;
      defaultScope?: string;
      oneTimeReplayStore: boolean;
      secret: StorageDownloadEndpointInfo['secret'];
    }
  | { kind: 'absent' }
  | { kind: 'unavailable'; message: string };

function appStorageDownloadSigner(app: KovoApp, request: Request): AppStorageDownloadSigner {
  const endpoints = app.endpoints
    .map((definition) => storageDownloadEndpointInfo(definition))
    .filter((info): info is StorageDownloadEndpointInfo => info !== undefined);
  if (endpoints.length === 1) {
    const defaultScope = endpoints[0]!.scope?.(request);
    return {
      kind: 'ready',
      basePath: endpoints[0]!.basePath,
      ...(defaultScope === undefined ? {} : { defaultScope }),
      oneTimeReplayStore: endpoints[0]!.oneTimeReplayStore,
      secret: endpoints[0]!.secret,
    };
  }
  if (endpoints.length === 0) {
    return {
      kind: 'absent',
    };
  }
  return {
    kind: 'unavailable',
    message:
      'ctx.signUrl() is ambiguous because this app declares multiple storage download endpoints: ' +
      `${endpoints.map((endpoint) => endpoint.basePath).join(', ')}. ` +
      'Create an explicit signer for the intended endpoint basePath instead of using route ' +
      'ctx.signUrl (SPEC §6.6).',
  };
}

function createUnavailableSignUrl(message: string): ReturnType<typeof createSignUrl> {
  return {
    async signUrl() {
      throw new Error(message);
    },
  };
}

/**
 * bugs-1 F13 / K3 / SPEC §9.3: HMAC the already-proven principal so raw session/user identifiers
 * stay out of the BroadcastChannel envelope. Principal resolution happens through
 * `principalPostureFromRequest`; unresolved session carriers intentionally do not reach this helper.
 */
function hmacSessionFingerprint(input: string, secret: SigningSecret | undefined): string {
  return signingKeyRingFromSecret(secret ?? fallbackBroadcastFingerprintSecret).sign({
    audience: 'broadcast-channel-session-fingerprint',
    payload: input,
    purpose: 'session-fingerprint',
  }).signature;
}

export async function renderAppErrorDocumentResponse(
  app: KovoApp,
  request: Request,
  status: 403 | 404 | 500,
): Promise<RoutePageResponse> {
  const shellRequest = requestMetadataWithoutAmbientAuthority(request);
  const stableRequestUrl = readErrorShellRequestUrl(shellRequest);
  const stableUrl = requestCreateUrl(stableRequestUrl);
  const stableUrlSnapshot = requestUrlSnapshot(stableUrl);
  const diagnosticUrl = appRequestUrl(stableUrl);
  const reportingOrigin = stableUrlSnapshot.origin;
  const secure = stableUrlSnapshot.protocol === 'https:';
  const renderer =
    status === 403
      ? app.errorShells.forbidden
      : status === 404
        ? app.errorShells.notFound
        : app.errorShells.serverError;

  if (renderer) {
    try {
      const rendered = await renderer({ request: shellRequest, status });
      return renderConfiguredErrorShellDocumentResponse(
        app,
        rendered,
        status,
        reportingOrigin,
        secure,
      );
    } catch (error) {
      reportServerError(app.onError, error, {
        operation: 'error-shell',
        request: shellRequest,
        status,
        url: diagnosticUrl,
      });
    }
  }

  // SPEC §9.2/§9.5: error shells are app config, but unexpected failures
  // still fall back to a stable no-internals document.
  return renderErrorDocument({
    ...(app.stylesheets.length > 0 ? { hints: { stylesheets: app.stylesheets } } : {}),
    ...(app.document.structured === undefined ? {} : { document: app.document.structured }),
    ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
    loaderRuntimeHref: ensureKovoLoaderRuntimeClientModule(app.clientModules),
    reportingOrigin,
    status,
  });
}

function renderConfiguredErrorShellDocumentResponse(
  app: KovoApp,
  rendered: unknown,
  status: 403 | 404 | 500,
  reportingOrigin: string,
  secure: boolean,
): RoutePageResponse {
  const response = normalizeConfiguredErrorShellResponse(rendered, status);
  // SPEC §9.2/§9.5: configured request-shell error bodies are still framework-owned
  // documents. They therefore receive the same document security/header floor as route
  // documents instead of bypassing CSP/XFO/nosniff/cache defaults.
  const documentResponse = renderRouteDocumentResponse(
    {
      ...response,
      body: typeof response.body === 'string' ? response.body : '',
      headers: stripContentTypeHeader(response.headers),
      status,
    },
    {
      ...(app.document.csp === undefined ? {} : { csp: app.document.csp }),
      ...(app.document.structured === undefined ? {} : { document: app.document.structured }),
      ...(app.stylesheets.length > 0 ? { hints: { stylesheets: app.stylesheets } } : {}),
      ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
      loaderRuntimeHref: ensureKovoLoaderRuntimeClientModule(app.clientModules),
      noStore: true,
      reportingOrigin,
      ...(secure ? { secure: true } : {}),
      wrapNonOk: true,
    },
  );

  return {
    ...documentResponse,
    headers: mergeVaryHeader(
      {
        ...documentResponse.headers,
        'Cache-Control': 'private, no-store',
      },
      'Cookie',
    ),
    status,
  };
}

const readNativeErrorShellRequestUrl = (() => {
  const descriptor = witnessGetOwnPropertyDescriptor(Request.prototype, 'url');
  const getter = descriptor ? witnessReflectGet(descriptor, 'get') : undefined;
  if (typeof getter !== 'function') {
    throw new TypeError('The Web Request implementation lacks a url getter.');
  }
  return (request: Request): string => witnessReflectApply(getter, request, []);
})();

function readErrorShellRequestUrl(request: Request): string {
  try {
    return readNativeErrorShellRequestUrl(requestForAuthorityNeutralMetadata(request));
  } catch {
    // Stable error output is preferable to trusting a public accessor or throwing
    // from the fallback path. Genuine framework Request carriers always take the
    // intrinsic branch above.
    return 'http://kovo.invalid/';
  }
}

function normalizeConfiguredErrorShellResponse(
  rendered: unknown,
  status: 403 | 404 | 500,
): RoutePageResponse {
  if (isRoutePageResponseLike(rendered)) {
    return {
      ...rendered,
      body: 'body' in rendered ? renderConfiguredErrorShellBody(rendered.body) : '',
      headers: rendered.headers ?? {},
      status,
    };
  }

  return {
    body: renderConfiguredErrorShellBody(rendered),
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status,
  };
}

function isRoutePageResponseLike(
  value: unknown,
): value is { body?: unknown; headers?: RoutePageResponse['headers']; status?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('body' in value || 'headers' in value || 'status' in value)
  );
}

function renderConfiguredErrorShellBody(value: unknown): string {
  // SPEC §5.2/§9.2/§9.5: configured error shells are still request-shell output
  // sinks. Plain strings are untrusted text; framework-rendered/trusted HTML is
  // the explicit proof that markup may pass through.
  return renderHtmlValue(value);
}

function stripContentTypeHeader(
  headers: RoutePageResponse['headers'],
): RoutePageResponse['headers'] {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'content-type'),
  );
}

export function appRequestUrl(url: URL): string {
  const snapshot = requestUrlSnapshot(url);
  return `${snapshot.pathname}${snapshot.search}${snapshot.hash}`;
}

function renderDefaultRouteValue(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (isRenderedHtml(value)) return renderedHtmlContent(value);
  if (typeof value === 'string') return unwrapCoercedRenderedHtml(value);
  return renderHtmlValue(value);
}

function mergeAppRouteHints(app: KovoApp, route: AnyRouteDeclaration): PageHintOptions<any> {
  const stylesheets = [...app.stylesheets, ...(route.stylesheets ?? [])];
  return {
    ...route,
    ...(stylesheets.length > 0 ? { stylesheets } : {}),
  };
}

function searchParamsToRecord(searchParams: URLSearchParams): Record<string, string | string[]> {
  const record = witnessCreateNullRecord<string | string[]>() as Record<
    string,
    string | string[]
  >;
  const entries = requestUrlSearchParamsEntries(searchParams);
  for (let index = 0; index < entries.length; index += 1) {
    const entryDescriptor = witnessGetOwnPropertyDescriptor(entries, index);
    if (
      entryDescriptor === undefined ||
      !('value' in entryDescriptor) ||
      !witnessIsArray(entryDescriptor.value) ||
      entryDescriptor.value.length !== 2
    ) {
      throw new TypeError('Kovo route search entries must be dense stable pairs.');
    }
    const keyDescriptor = witnessGetOwnPropertyDescriptor(entryDescriptor.value, 0);
    const valueDescriptor = witnessGetOwnPropertyDescriptor(entryDescriptor.value, 1);
    if (
      keyDescriptor === undefined ||
      !('value' in keyDescriptor) ||
      typeof keyDescriptor.value !== 'string' ||
      valueDescriptor === undefined ||
      !('value' in valueDescriptor) ||
      typeof valueDescriptor.value !== 'string'
    ) {
      throw new TypeError('Kovo route search entries must contain stable strings.');
    }
    const key = keyDescriptor.value;
    const value = valueDescriptor.value;
    const existing = witnessGetOwnPropertyDescriptor(record, key);
    if (existing === undefined) {
      witnessDefineProperty(record, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    } else if ('value' in existing && typeof existing.value === 'string') {
      witnessDefineProperty(record, key, {
        configurable: true,
        enumerable: true,
        value: [existing.value, value],
        writable: true,
      });
    } else if ('value' in existing && witnessIsArray(existing.value)) {
      witnessDefineProperty(existing.value, existing.value.length, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    } else {
      throw new TypeError('Kovo route search record contains an invalid repeated value.');
    }
  }

  return record;
}
