import type { DeferredStreamChunk } from './deferred-stream.js';
import type { StorageCapability } from '@kovojs/core';
import {
  blessSink,
  drainRuntimeSinkSecurityEvent,
  isBlessedSink,
} from '@kovojs/core/internal/sink-policy';

import { InlineUnverifiedUploadError, sniffUploadBytes } from './upload-sniff.js';

/** A single header value: one string or a list of strings. */
export type ResponseHeaderValue = string | string[];

/** A header bag mapping header names to values. */
export type ResponseHeaders = Record<string, ResponseHeaderValue>;

/** A single mutation-response header value (alias of `ResponseHeaderValue`). */
export type MutationResponseHeaderValue = ResponseHeaderValue;

/** A mutation-response header bag (alias of `ResponseHeaders`). */
export type MutationResponseHeaders = ResponseHeaders;

const SERVER_REDIRECT_LOCATION_SINK = 'server:redirect-location';

/** The common shape of every server response: `body`, `headers`, and `status`. */
export interface ServerResponseBase<
  Body,
  Headers extends ResponseHeaders = ResponseHeaders,
  Status extends number = number,
> {
  body: Body;
  headers: Headers;
  status: Status;
}

/** A renderable route body: a string, bytes, an ArrayBuffer, or a byte stream. */
export type RouteResponseBody = ArrayBuffer | ReadableStream<Uint8Array> | Uint8Array | string;

export type WebResponseBody = RouteResponseBody | null;

export type RouteResponseStatus = 200 | 303 | 304 | 403 | 404 | 422 | 429 | 500;

export type DocumentRouteResponseBody = Exclude<RouteResponseBody, ArrayBuffer>;

/** The 404 marker returned by `notFound()`. */
export interface NotFound {
  notFound: true;
  status: 404;
}

/** A non-document route outcome (file/stream) produced by `respond`. */
export interface RouteResponseOutcome {
  body: RouteResponseBody;
  contentDisposition: string;
  contentType: string;
  etag?: string;
  headers?: Record<string, string>;
  routeResponse: true;
}

/** Options for `respond.file`: content type and optional filename/etag/headers. */
export interface RouteFileOptions {
  contentType: string;
  etag?: string;
  filename?: string;
  headers?: Record<string, string>;
}

/**
 * Options for `respond.storedFile`: optional download `filename` and inline/attachment disposition.
 * The content type is always the SERVER-SNIFFED type of the stored bytes (KV428), never supplied by
 * the caller.
 */
export interface RouteStoredFileOptions {
  disposition?: 'attachment' | 'inline';
  filename?: string;
}

/** Options for `respond.stream`: `RouteFileOptions` plus inline/attachment disposition. */
export interface RouteStreamOptions extends RouteFileOptions {
  disposition?: 'attachment' | 'inline';
  /**
   * KV428 inline opt-in (SPEC §6.6/§9.1): set ONLY when the body bytes have been proven safe to
   * render inline — the framework re-encoded/rasterized them, or they came through a deep-sniff
   * `inlineSafe` pass. Required for `disposition: 'inline'` on an un-bufferable stream body; for an
   * in-memory body (string/bytes/ArrayBuffer) the runtime deep-sniffs instead and this brand is the
   * explicit override of that check. Setting it on attacker-controlled active content (HTML/SVG) is
   * the audited risk the brand records.
   */
  verifiedSafe?: boolean;
}

/**
 * A fully rendered route HTTP response (status, headers, body). Headers use
 * {@link ResponseHeaders} so the document path can carry multiple `Set-Cookie`
 * values (e.g. a rolling-session refresh + cookie-cache cookie, part-3 I2),
 * matching the mutation response channel.
 */
export interface RoutePageResponse extends ServerResponseBase<
  RouteResponseBody,
  ResponseHeaders,
  RouteResponseStatus
> {
  /** @internal Deferred route-region chunks streamed after the initial document shell. */
  deferredChunks?: readonly DeferredStreamChunk[];
  /** @internal The request after the route lifecycle resolved session/db (SPEC §6.5). */
  lifecycleRequest?: unknown;
}

function markRouteResponseOutcome<Response extends object>(
  response: Response,
): Response & { routeResponse: true } {
  Object.defineProperty(response, 'routeResponse', {
    configurable: false,
    enumerable: false,
    value: true,
  });
  return response as Response & RouteResponseOutcome;
}

export interface DocumentRouteResponseBase extends ServerResponseBase<
  DocumentRouteResponseBody,
  ResponseHeaders,
  RouteResponseStatus
> {}

export type HeaderSource =
  | Iterable<readonly [string, string]>
  | Record<string, readonly string[] | string | undefined>
  | {
      get(name: string): null | string;
    };

/**
 * Type guard for anything `readHeader` accepts: a `Headers`, an entries
 * iterable, or a plain header record.
 *
 * @param value - The value to test.
 * @returns `true` when `value` is a usable header source.
 */
export function isHeaderSource(value: unknown): value is HeaderSource {
  if (typeof value !== 'object' || value === null) return false;

  if ('get' in value) return typeof value.get === 'function';

  const iterator = (value as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (typeof iterator === 'function') {
    return !Array.isArray(value) || value.every(isHeaderTuple);
  }

  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([, header]) => isHeaderRecordValue(header));
}

/**
 * Read a single header value by name from any `HeaderSource`, case-insensitively,
 * joining multi-valued headers with `, `.
 *
 * @param headers - The header source to read from.
 * @param name - The header name (case-insensitive).
 * @returns The header value, or `undefined` if absent.
 */
/**
 * Read a response/request header from any framework-supported header source.
 *
 * @internal
 */
export function readHeader(headers: HeaderSource, name: string): string | undefined {
  if ('get' in headers && typeof headers.get === 'function') {
    return headers.get(name) ?? undefined;
  }

  const existingName = findHeaderName(headers, name);
  if (existingName === undefined || Symbol.iterator in headers) return existingName;

  const recordHeaders = headers as Record<string, readonly string[] | string | undefined>;
  const value = recordHeaders[existingName];
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : undefined;
}

export function appendResponseHeader(
  headers: ResponseHeaders,
  name: string,
  value: ResponseHeaderValue,
): void {
  const existingName = findHeaderName(headers, name);
  const targetName = existingName ?? name;
  if (name.toLowerCase() !== 'set-cookie') {
    headers[targetName] = Array.isArray(value) ? [...value] : value;
    return;
  }

  const nextValues = Array.isArray(value) ? value : [value];
  const existing = existingName === undefined ? undefined : headers[existingName];
  if (existing === undefined) {
    headers[targetName] = [...nextValues];
    return;
  }

  headers[targetName] = [...(Array.isArray(existing) ? existing : [existing]), ...nextValues];
}

export function cloneResponseHeaders<Headers extends ResponseHeaders>(headers: Headers): Headers {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? [...value] : value,
    ]),
  ) as Headers;
}

/**
 * SPEC §6.6 (runtime defense-in-depth, NOT a by-construction proof): the
 * conservative, LOW-false-positive isolation/hardening header baseline carried
 * on every framework-rendered DOCUMENT response. These are fail-closed runtime
 * floors layered on top of (and independent of) the opt-in Content-Security-Policy
 * channel; they harden the document against clickjacking, cross-window scripting
 * (COOP), and ambient-capability abuse without breaking ordinary same-origin apps.
 *
 * Companion to `routeOutcomeHeaders` above (`X-Content-Type-Options: nosniff`,
 * which file/stream responses already carry). Each header is chosen for a near-zero
 * false-positive rate on a typical SSR app:
 *
 * - `X-Frame-Options: DENY` — clickjacking defense and pre-CSP3 companion to CSP
 *   `frame-ancestors`. Django ships this by default; Kovo otherwise has ZERO
 *   clickjacking defense because CSP is opt-in. Apps that intentionally embed their
 *   own pages in frames override this on the route response.
 * - `Cross-Origin-Opener-Policy: same-origin-allow-popups` — severs the
 *   `window.opener` reference for cross-origin navigations (cross-window scripting /
 *   tabnabbing) while still allowing same-origin OAuth/payment popups to talk back.
 *   Deliberately NOT the stricter `same-origin` (which breaks popup-based flows) and
 *   NOT paired with `Cross-Origin-Embedder-Policy: require-corp` (breaks cross-origin
 *   subresources — explicitly out of scope). Document assembly appends the browser's
 *   supported `report-to` parameter only when it also owns the matching Reporting API
 *   endpoint headers.
 * - `Permissions-Policy` — deny-by-default for the high-risk ambient capabilities a
 *   content app virtually never needs. A conservative deny-all baseline; an app that
 *   uses one of these overrides the header on the route response. Permissions Policy
 *   reporting is per-feature (`feature=();report-to=<group>`), so document assembly
 *   adds only those per-feature hooks when the Reporting API group is present.
 * - `Origin-Agent-Cluster: ?1` — asks the browser to isolate the origin into its own
 *   agent cluster so same-site but cross-origin documents do not share process-global
 *   JS state. OPP-15 labels this runtime defense-in-depth, not a construction proof.
 * - `Referrer-Policy: strict-origin-when-cross-origin` — limits cross-origin referrer
 *   leakage (also present on the non-document/error paths; included here so this helper
 *   is the single source of the document baseline).
 *
 * `Strict-Transport-Security` (HSTS) and `Cross-Origin-Resource-Policy` (CORP) are
 * NOT included here: HSTS is gated on prod+HTTPS at the document call site (it would
 * brick localhost/non-HTTPS dev), and CORP belongs on the immutable client-module
 * asset responses (see the `SF-WIRE` note below), not on documents.
 *
 * Every header is applied only when the route response did not already set it
 * (case-insensitively), so an author opt-out is always preserved.
 */
export const DOCUMENT_ISOLATION_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Origin-Agent-Cluster': '?1',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

/**
 * SPEC §6.6 (runtime defense-in-depth): the HSTS value applied to document responses
 * ONLY when the request was served over HTTPS in production. Two years with
 * `includeSubDomains` is the conservative widely-deployed baseline (no `preload`,
 * which is an irreversible registry opt-in the framework must not assume).
 */
export const DOCUMENT_HSTS_VALUE = 'max-age=63072000; includeSubDomains';

/**
 * Decide whether `Strict-Transport-Security` may be attached to a document response.
 * Gated on BOTH production (existing `NODE_ENV` prod detection, matching
 * `guards.ts`) AND an HTTPS request/response, so a non-HTTPS deploy or any
 * `localhost`/dev request never receives an HSTS header that would otherwise pin the
 * browser to https for two years and brick plain-http local development.
 *
 * @param secureRequest - `true` when the originating request was served over HTTPS.
 * @internal
 */
export function shouldEmitDocumentHsts(secureRequest: boolean): boolean {
  return secureRequest && process.env.NODE_ENV === 'production';
}

// SF-WIRE (SPEC §6.6, Cross-Origin-Resource-Policy): immutable client-module asset
// responses are served by `client-modules.ts` (`createVersionedClientModuleRegistry`'s
// `resolve(...)`, the `/c/__v/<version>/<module>` 200 with
// `Cache-Control: public, max-age=31536000, immutable`), which is NOT owned by this
// slice. Add `'Cross-Origin-Resource-Policy': 'same-origin'` to that response's
// `headers` object so a cross-origin page cannot pull the app's immutable JS as a
// no-cors subresource. Documents intentionally do NOT carry CORP (it would block
// legitimate cross-origin embedding of the page where an app opts into that).

/**
 * Build a non-document route response from a route `page` handler: `respond.file`
 * for an attachment download, `respond.stream` for a streamed body. Both set the
 * content type and disposition; return the result instead of a page value
 * (SPEC §6.4).
 *
 * @example
 * import { respond, route } from '@kovojs/server';
 *
 * export const exportRoute = route('/download/report.txt', {
 *   page: () =>
 *     respond.file('plain report\n', {
 *       contentType: 'text/plain; charset=utf-8',
 *       filename: 'report.txt',
 *     }),
 * });
 */
export const respond = {
  file(body: Exclude<RouteResponseBody, ReadableStream<Uint8Array>>, options: RouteFileOptions) {
    return routeResponseOutcome(body, {
      ...options,
      disposition: 'attachment',
    });
  },
  /**
   * Serve a stored upload by its (server-generated, opaque) storage key. KV428 (SPEC §6.6/§9.1):
   * this path takes a BARE STRING key, so there is no compile-visible verification that the bytes
   * are inline-safe — the static brand degrades to a RUNTIME SIDECAR-MARKER, fail-closed:
   *
   *  - Defaults to `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`.
   *  - The served `Content-Type` is minted from the SNIFFED stored bytes (server truth), NOT the
   *    stored `contentType` (which a prior `accept.unverified()` may have set to a client lie).
   *  - `disposition: 'inline'` deep-sniffs and REFUSES to serve unless the bytes are known-passive
   *    (the runtime sidecar-marker refuse-to-serve-inline-if-unverified floor).
   *
   * @param storage - The storage capability to read from.
   * @param key - The opaque stored object key (from `s.file().store(...)`).
   */
  async storedFile(storage: StorageCapability, key: string, options: RouteStoredFileOptions = {}) {
    const object = await storage.get(key);
    if (object === undefined) return undefined;
    const disposition = options.disposition ?? 'attachment';
    const sniffed = sniffUploadBytes(object.body);
    if (disposition === 'inline' && !sniffed.inlineSafe) {
      throw new InlineUnverifiedUploadError(
        `Refusing to serve stored object "${key}" inline: its sniffed content type is not a ` +
          'known-passive type. Serve as an attachment, or rasterize/re-encode the bytes.',
      );
    }
    return routeResponseOutcome(object.body, {
      // Server truth: the served type is the SNIFFED type, never the stored (possibly-client) type.
      contentType: sniffed.contentType,
      disposition,
      ...(options.filename === undefined ? {} : { filename: options.filename }),
      ...(object.etag === undefined ? {} : { etag: object.etag }),
    });
  },
  stream(body: RouteResponseBody, options: RouteStreamOptions) {
    const disposition = options.disposition ?? 'attachment';
    // KV428 (SPEC §6.6/§9.1): inline rendering is a branded opt-in over verified-safe bytes. For an
    // in-memory body we deep-sniff and refuse unless the bytes are a known-passive type; an
    // un-bufferable stream cannot be sniffed, so it requires the explicit `verifiedSafe` brand
    // (the framework re-encode/rasterize attestation). This is the fail-closed runtime floor — the
    // honest ceiling is "attacker bytes never render inline as active content", not an unspoofable
    // type. Authors override the sniffed contentType via `verifiedSafe: true` (audited risk).
    const contentType =
      disposition === 'inline'
        ? assertInlineBody(body, options.contentType, options.verifiedSafe ?? false)
        : options.contentType;
    return routeResponseOutcome(body, {
      ...options,
      contentType,
      disposition,
    });
  },
};

export function routeOutcomeResponse(
  outcome: RouteResponseOutcome,
  request: unknown,
): RoutePageResponse {
  const headers = routeOutcomeHeaders(outcome);
  if (outcome.etag && requestHeader(request, 'if-none-match') === outcome.etag) {
    return {
      body: '',
      headers: { ETag: outcome.etag },
      status: 304,
    };
  }

  const response: RoutePageResponse = {
    body: outcome.body,
    headers,
    status: 200,
  };
  return markRouteResponseOutcome(response);
}

export function htmlServerErrorResponse(): RoutePageResponse {
  return {
    body: 'Internal Server Error',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 500,
  };
}

export function retryAfterHeaders(result: { retryAfter?: number }): Record<string, string> {
  return result.retryAfter === undefined ? {} : { 'Retry-After': String(result.retryAfter) };
}

export function routeResponseToWebResponse(
  response: ServerResponseBase<RouteResponseBody, ResponseHeaders>,
  request: Pick<Request, 'method'>,
): Response {
  return serverResponseToWebResponse(response, request);
}

export function serverResponseToWebResponse(
  response: ServerResponseBase<WebResponseBody, ResponseHeaders>,
  request: Pick<Request, 'method'>,
): Response {
  const body = request.method === 'HEAD' || response.status === 304 ? null : response.body;
  return new Response(webResponseBodyToBodyInit(body), {
    headers: webResponseHeaders(
      response.headers,
      response.status,
      isBlessedRedirectResponse(response),
    ),
    status: response.status,
  });
}

/**
 * @internal Sanitize a framework-owned Location target for redirects (SPEC §6.6).
 */
export function redirectLocationHeader(target: string): string {
  return sanitizeRedirectLocation(target);
}

/** @internal Mark a framework-owned 3xx response whose Location header was sanitized. */
export function blessRedirectResponse<
  Response extends ServerResponseBase<unknown, ResponseHeaders>,
>(response: Response): Response {
  const locationName = findHeaderName(response.headers, 'Location');
  if (locationName !== undefined) {
    const location = response.headers[locationName];
    response.headers[locationName] = sanitizeRedirectLocation(
      typeof location === 'string' ? location : (location?.[0] ?? '/'),
    );
  }
  return blessSink(SERVER_REDIRECT_LOCATION_SINK, response);
}

/** @internal Unwrap a redirect Location sink value or fail closed to `/` with a KV236 event. */
export function redirectLocationHeaderValue(value: ResponseHeaderValue, blessed: boolean): string {
  if (blessed) return Array.isArray(value) ? (value[0] ?? '/') : value;
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  drainRuntimeSinkSecurityEvent({
    action: 'neutralize',
    code: 'KV236',
    family: 'header',
    message: 'Blocked unblessed redirect Location header at the server response boundary',
    reason: '3xx Location headers must be minted by the framework redirect-location sink',
    sink: 'Location',
    value: {
      length: text.length,
      preview: text.slice(0, 80),
      redacted: true,
    },
  });
  return '/';
}

/** @internal Check whether a 3xx response object owns a sanitized Location header. */
export function isBlessedRedirectResponse(value: unknown): boolean {
  return isBlessedSink(SERVER_REDIRECT_LOCATION_SINK, value);
}

export function methodNotAllowedWebResponse(
  request: Pick<Request, 'method'>,
  allowedMethods: readonly string[],
): Response {
  return new Response(request.method === 'HEAD' ? null : 'Method Not Allowed', {
    headers: {
      Allow: allowedMethods.join(', '),
      'Content-Type': 'text/plain; charset=utf-8',
    },
    status: 405,
  });
}

export function routeResponseToDocumentResponse(
  response: RoutePageResponse,
): DocumentRouteResponseBase {
  const documentResponse = {
    ...response,
    body: response.body instanceof ArrayBuffer ? new Uint8Array(response.body) : response.body,
  };
  const clonedResponse =
    (response as { routeResponse?: unknown }).routeResponse === true
      ? markRouteResponseOutcome(documentResponse)
      : documentResponse;
  return isBlessedRedirectResponse(response)
    ? blessRedirectResponse(clonedResponse)
    : clonedResponse;
}

/**
 * KV428 (SPEC §6.6/§9.1): assert an in-memory body is safe to render inline, returning the
 * server-minted (sniffed) content type. Throws {@link InlineUnverifiedUploadError} for
 * HTML/SVG/XML/ambiguous bytes. An un-bufferable `ReadableStream` cannot be sniffed, so inline
 * serving requires the explicit `verifiedSafe` brand — without it, the runtime refuses (fail-closed
 * floor). When `verifiedSafe` is set, the author's declared content type is trusted (audited risk).
 */
function assertInlineBody(
  body: RouteResponseBody,
  declaredContentType: string,
  verifiedSafe: boolean,
): string {
  if (verifiedSafe) return declaredContentType;

  const bytes = inlineBodyBytes(body);
  if (bytes === undefined) {
    throw new InlineUnverifiedUploadError(
      'Refusing to serve a streamed (un-bufferable) body inline without `verifiedSafe: true`. ' +
        'Buffer the bytes so the runtime can deep-sniff them, serve as an attachment, or pass ' +
        '`verifiedSafe: true` only for bytes the framework re-encoded/rasterized.',
    );
  }

  const sniffed = sniffUploadBytes(bytes);
  if (!sniffed.inlineSafe) {
    throw new InlineUnverifiedUploadError(
      'Refusing to serve unverified bytes inline: the sniffed content type is not a known-passive ' +
        'type (HTML/SVG/XML/ambiguous bytes are attachment-only — SVG is XML+script). Serve as an ' +
        'attachment, or rasterize/re-encode and pass `verifiedSafe: true`.',
    );
  }
  // Server truth: the served Content-Type comes from the sniffed bytes, not the client/author lie.
  return sniffed.contentType;
}

/** Buffer an in-memory body to bytes for sniffing; `undefined` for an un-bufferable stream. */
function inlineBodyBytes(body: RouteResponseBody): Uint8Array | undefined {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Uint8Array) return body;
  return undefined; // ReadableStream — not bufferable without consuming it.
}

function routeResponseOutcome(
  body: RouteResponseBody,
  options: RouteFileOptions & { disposition: 'attachment' | 'inline' },
): RouteResponseOutcome {
  const contentDisposition = options.filename
    ? `${options.disposition}; filename="${escapeHeaderValue(options.filename)}"`
    : options.disposition;
  return markRouteResponseOutcome({
    body,
    contentDisposition,
    contentType: options.contentType,
    ...(options.etag === undefined ? {} : { etag: options.etag }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
}

function routeOutcomeHeaders(outcome: RouteResponseOutcome): Record<string, string> {
  return {
    ...safeRouteOutcomeHeaders(outcome.headers),
    'Content-Disposition': outcome.contentDisposition,
    'Content-Type': outcome.contentType,
    'X-Content-Type-Options': 'nosniff',
    ...(outcome.etag === undefined ? {} : { ETag: outcome.etag }),
  };
}

const RESERVED_ROUTE_RESPONSE_HEADERS = new Set([
  'content-disposition',
  'content-type',
  'etag',
  'set-cookie',
  'x-content-type-options',
]);

function safeRouteOutcomeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (headers === undefined) return {};
  const safeHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (RESERVED_ROUTE_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    safeHeaders[name] = value;
  }
  return safeHeaders;
}

function escapeHeaderValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function requestHeader(request: unknown, name: string): string | undefined {
  if (request && typeof request === 'object' && 'headers' in request) {
    const headers = (request as { headers?: unknown }).headers;
    if (isHeaderSource(headers)) return readHeader(headers, name);
  }

  if (isHeaderSource(request)) return readHeader(request, name);
  return undefined;
}

function webResponseBodyToBodyInit(body: WebResponseBody): BodyInit | null {
  if (body === null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof ReadableStream) return body;
  if (body instanceof ArrayBuffer) return body;

  if (body.buffer instanceof ArrayBuffer) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  }

  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy.buffer;
}

function webResponseHeaders(
  headers: ResponseHeaders,
  status: number,
  blessedRedirect: boolean,
): Headers {
  const webHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (isRedirectStatus(status) && name.toLowerCase() === 'location') {
      webHeaders.set(name, redirectLocationHeaderValue(value, blessedRedirect));
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) webHeaders.append(name, entry);
    } else {
      webHeaders.set(name, value);
    }
  }

  return webHeaders;
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function sanitizeRedirectLocation(target: string): string {
  if (hasHeaderControlCharacter(target)) return '/';
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '/';
  if (target.includes('\\')) return '/';
  return target;
}

function hasHeaderControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function findHeaderName(headers: HeaderSource, name: string): string | undefined {
  const wanted = name.toLowerCase();
  if (Symbol.iterator in headers) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() === wanted) return value;
    }

    return undefined;
  }

  return Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
}

function isHeaderRecordValue(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
  );
}

function isHeaderTuple(value: unknown): value is readonly [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string'
  );
}
