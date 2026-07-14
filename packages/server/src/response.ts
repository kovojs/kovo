import type { StorageReadCapability } from '@kovojs/core';
import {
  createBoundedRuntimeAuditCollector,
  wireEmitter,
} from '@kovojs/core/internal/security-markers';
import {
  blessSink,
  drainRuntimeSinkSecurityEvent,
  isBlessedSink,
} from '@kovojs/core/internal/sink-policy';

import { snapshotAuditJustification, snapshotAuditReason } from './audit-justification.js';
import { createContentDispositionWithFilename } from './content-disposition.js';
import { InlineUnverifiedUploadError, sniffUploadBytes } from './upload-sniff.js';
import { finalizeServerResponse } from './response-posture.js';
import { assertNoSecretEgressValue } from './secret-egress.js';
import {
  createSecurityNullRecord,
  createSecuritySet,
  securityArrayIsArray,
  securityArrayBufferSlice,
  securityArrayJoin,
  securityArrayPush,
  securityEncodeURIComponent,
  securityHeadersGet,
  securityIsArrayBuffer,
  securityIsHeaders,
  securityIsMap,
  securityIsUint8Array,
  securityMapForEach,
  securityNumberIsInteger,
  securityObjectKeys,
  securitySetHas,
  securitySetAdd,
  securityString,
  securityStringCharCodeAt,
  securityStringIncludes,
  securityStringSlice,
  securityStringStartsWith,
  securityStringToLowerCase,
  securityStringTrim,
  securityTextEncode,
  securityUint8ArrayFromArrayBuffer,
  securityUint8ArraySlice,
  securityUrlSnapshot,
} from './response-security-intrinsics.js';
import {
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessObjectIs,
  witnessReflectApply,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';
import { runtimeEnvironmentValue } from '@kovojs/server/internal/runtime-environment';

/** A single header value: one string or a list of strings. */
export type ResponseHeaderValue = string | string[];

/** A header bag mapping header names to values. */
export type ResponseHeaders = Record<string, ResponseHeaderValue>;

const SERVER_REDIRECT_LOCATION_SINK = 'server:redirect-location';

/** An explicit, audit-readable cross-origin redirect target allowance. */
export interface RedirectLocationAllowlistEntry {
  /** Exact origin, e.g. `https://accounts.example.com`. */
  origin: string;
  /** Human-readable reason the app may navigate users to this origin. */
  reason: string;
}

/** Options for the framework-owned redirect Location choke. */
export interface RedirectLocationOptions {
  allowlist?: readonly RedirectLocationAllowlistEntry[];
}

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

declare const frameworkWireBodyBrand: unique symbol;

/**
 * Framework-owned response/wire body currency for generated mutation/query output.
 * The brand symbol is module-private, so structural `{ body: string }` objects cannot
 * satisfy framework wire response types without going through this choke or an audited
 * endpoint/raw-Response escape path (SPEC §9.1/§9.4).
 */
export type FrameworkWireBody = string & {
  readonly [frameworkWireBodyBrand]: true;
};

/** @internal Sole constructor for framework-owned query/mutation wire bodies. */
export function frameworkWireBody(body: string): FrameworkWireBody {
  return body as FrameworkWireBody;
}

/** Options for rehydrating a persisted framework mutation replay body. */
export interface ReplayMutationWireBodyOptions {
  /** Audit-readable reason this stored body is being reintroduced to the framework wire. */
  reason: string;
}

/**
 * Rehydrate a persisted mutation replay body through an explicit audited escape path.
 *
 * Normal query/mutation responses are minted by framework renderers. Apps that implement a durable
 * `MutationReplayStore` may need to deserialize a previously stored framework response; this
 * constructor keeps that escape visible and reason-bearing instead of allowing plain strings to
 * satisfy the mutation wire body type.
 */
export function replayMutationWireBody(
  body: string,
  options: ReplayMutationWireBodyOptions,
): FrameworkWireBody {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('replayMutationWireBody() options must be an object.');
  }
  snapshotAuditReason(stableRequiredOwnDataValue(options, 'reason'), 'replayMutationWireBody()');
  return frameworkWireBody(body);
}

/** A renderable route body: a string, bytes, an ArrayBuffer, or a byte stream. */
export type RouteResponseBody = ArrayBuffer | ReadableStream<Uint8Array> | Uint8Array | string;

export type WebResponseBody = RouteResponseBody | null;

/** HTTP statuses Kovo route page responses may emit after route lifecycle resolution. */
export type RouteResponseStatus = 200 | 303 | 304 | 403 | 404 | 422 | 429 | 500;

export type DocumentRouteResponseBody = Exclude<RouteResponseBody, ArrayBuffer>;

/** The 404 marker returned by `notFound()`. */
export interface NotFound {
  notFound: true;
  status: 404;
}

declare const routeResponseOutcomeBrand: unique symbol;

/**
 * An opaque non-document route outcome (file/stream) produced only by {@link respond}.
 *
 * SPEC §2 / §6.6 / §9.1: the private type brand is author-time ergonomics only. Runtime route and
 * document dispatch re-check a module-private witness and consume an inaccessible pinned snapshot,
 * so a structural object, cast, or post-construction mutation cannot acquire response authority.
 */
export interface RouteResponseOutcome {
  readonly body: RouteResponseBody;
  readonly contentDisposition: string;
  readonly contentType: string;
  readonly etag?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly routeResponse: true;
  readonly [routeResponseOutcomeBrand]: true;
}

interface RouteResponseOutcomeSnapshot {
  readonly body: RouteResponseBody;
  readonly contentDisposition: string;
  readonly contentType: string;
  readonly etag?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

const routeResponseOutcomeSnapshots = createWitnessWeakMap<object, RouteResponseOutcomeSnapshot>();
const routePageResponseOutcomes = createWitnessWeakSet<object>();
const frameworkDocumentResponseBuildTokens = createWitnessWeakMap<object, string>();

/** @internal Mark a framework-assembled document response with its trusted build proof. */
export function markFrameworkDocumentResponse<Response extends object>(
  response: Response,
  buildToken: string,
): Response {
  witnessWeakMapSet(frameworkDocumentResponseBuildTokens, response, buildToken);
  return response;
}

/** @internal Read framework document provenance without trusting structural fields or headers. */
export function frameworkDocumentResponseBuildToken(response: unknown): string | undefined {
  return typeof response === 'object' && response !== null
    ? witnessWeakMapGet(frameworkDocumentResponseBuildTokens, response)
    : undefined;
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

declare const unsafeInlineAcceptanceBrand: unique symbol;

/**
 * Opaque audited receipt for rendering bytes inline without Kovo deep-sniffing them (SPEC
 * §6.6/§9.1). Construct only with {@link unsafeInline}; structural lookalikes fail closed.
 */
export interface UnsafeInlineAcceptance {
  readonly [unsafeInlineAcceptanceBrand]: { readonly kind: 'unsafe-inline-response' };
  readonly justification: string;
}

/** A runtime observation of an {@link unsafeInline} escape. */
export interface UnsafeInlineFact {
  readonly justification: string;
}

const unsafeInlineAcceptanceSnapshots = createWitnessWeakMap<object, UnsafeInlineAcceptance>();
const unsafeInlineFacts = createBoundedRuntimeAuditCollector<UnsafeInlineFact>();

/**
 * Accept the risk of bypassing Kovo's inline-body byte sniffer for bytes independently re-encoded
 * or rasterized by the application (SPEC §6.6/§9.1). The required printable justification is
 * surfaced by `kovo explain --capabilities`; the returned receipt is opaque and runtime-authenticated.
 */
export function unsafeInline(justification: string): UnsafeInlineAcceptance {
  const closedJustification = snapshotAuditJustification(justification, 'unsafeInline()');
  const receipt = witnessFreeze({ justification: closedJustification }) as UnsafeInlineAcceptance;
  witnessWeakMapSet(unsafeInlineAcceptanceSnapshots, receipt, receipt);
  unsafeInlineFacts.record(witnessFreeze({ justification: closedJustification }));
  return receipt;
}

/** @internal Drain recent runtime observations; static call sites remain authoritative. */
export function drainUnsafeInlineFacts(): readonly UnsafeInlineFact[] {
  return unsafeInlineFacts.drain();
}

function unsafeInlineAcceptanceSnapshot(value: unknown): UnsafeInlineAcceptance {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError(
      'respond.stream() unsafeInline must be a receipt minted by unsafeInline().',
    );
  }
  const snapshot = witnessWeakMapGet(unsafeInlineAcceptanceSnapshots, value);
  if (snapshot === undefined) {
    throw new TypeError(
      'respond.stream() unsafeInline must be a receipt minted by unsafeInline().',
    );
  }
  return snapshot;
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
  unsafeInline?: UnsafeInlineAcceptance;
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
  /** @internal The request after the route lifecycle resolved session/db (SPEC §6.5). */
  lifecycleRequest?: unknown;
}

function defineRouteResponseMarker<Response extends object>(
  response: Response,
): Response & { routeResponse: true } {
  witnessDefineProperty(response, 'routeResponse', {
    configurable: false,
    enumerable: false,
    value: true,
  });
  return response as Response & { routeResponse: true };
}

function markRoutePageResponseOutcome<Response extends object>(
  response: Response,
): Response & { routeResponse: true } {
  const marked = defineRouteResponseMarker(response);
  witnessWeakSetAdd(routePageResponseOutcomes, marked);
  return marked;
}

/** @internal True only for a non-document route outcome genuinely minted by `respond`. */
export function isRouteResponseOutcome(value: unknown): value is RouteResponseOutcome {
  return (
    typeof value === 'object' &&
    value !== null &&
    witnessWeakMapGet(routeResponseOutcomeSnapshots, value) !== undefined
  );
}

/** @internal True only for a final route page response marked inside this module. */
export function isRoutePageResponseOutcome(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    witnessWeakSetHas(routePageResponseOutcomes, value)
  );
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
  if (securityIsHeaders(value)) return true;
  if (securityIsMap(value)) {
    let valid = true;
    securityMapForEach(value, (header, name) => {
      if (typeof name !== 'string' || typeof header !== 'string') valid = false;
    });
    return valid;
  }
  if (securityArrayIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!isHeaderTuple(stableOwnDataValue(value, index))) return false;
    }
    return value.length > 0;
  }
  const get = stableOwnDataValue(value, 'get');
  if (typeof get === 'function') return true;
  const names = securityObjectKeys(value);
  if (names.length === 0) return false;
  for (let index = 0; index < names.length; index += 1) {
    if (!isHeaderRecordValue(stableOwnDataValue(value, names[index]!))) return false;
  }
  return true;
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
  if (securityIsHeaders(headers)) {
    return securityHeadersGet(headers, name) ?? undefined;
  }
  if (securityIsMap(headers)) {
    const wanted = securityStringToLowerCase(name);
    let found: string | undefined;
    securityMapForEach(headers, (value, key) => {
      if (
        found === undefined &&
        typeof key === 'string' &&
        typeof value === 'string' &&
        securityStringToLowerCase(key) === wanted
      ) {
        found = value;
      }
    });
    return found;
  }
  const get = stableOwnDataValue(headers, 'get');
  if (typeof get === 'function') {
    const value = witnessReflectApply<unknown>(get, headers, [name]);
    return typeof value === 'string' ? value : undefined;
  }

  const existingName = findHeaderName(headers, name);
  if (existingName === undefined) return undefined;

  if (securityArrayIsArray(headers)) return existingName;

  const recordHeaders = headers as Record<string, readonly string[] | string | undefined>;
  const value = stableOwnDataValue(recordHeaders, existingName);
  if (securityArrayIsArray(value)) return securityArrayJoin(snapshotStringArray(value), ', ');
  return typeof value === 'string' ? value : undefined;
}

export function appendResponseHeader(
  headers: ResponseHeaders,
  name: string,
  value: ResponseHeaderValue,
): void {
  const existingName = findHeaderName(headers, name);
  const targetName = existingName ?? name;
  if (securityStringToLowerCase(name) !== 'set-cookie') {
    commitResponseHeader(
      headers,
      targetName,
      securityArrayIsArray(value) ? snapshotStringArray(value) : value,
    );
    return;
  }

  const nextValues = securityArrayIsArray(value) ? snapshotStringArray(value) : [value];
  const existing =
    existingName === undefined ? undefined : stableOwnDataValue(headers, existingName);
  if (existing === undefined) {
    commitResponseHeader(headers, targetName, snapshotStringArray(nextValues));
    return;
  }

  const merged: string[] = [];
  const existingValues = securityArrayIsArray(existing) ? existing : [existing];
  for (let index = 0; index < existingValues.length; index += 1) {
    securityArrayPush(merged, existingValues[index]!);
  }
  for (let index = 0; index < nextValues.length; index += 1) {
    securityArrayPush(merged, nextValues[index]!);
  }
  commitResponseHeader(headers, targetName, merged);
}

function commitResponseHeader(
  headers: ResponseHeaders,
  name: string,
  value: ResponseHeaderValue,
): void {
  witnessDefineProperty(headers, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

export function cloneResponseHeaders<Headers extends ResponseHeaders>(headers: Headers): Headers {
  const clone: ResponseHeaders = createSecurityNullRecord<ResponseHeaderValue>();
  const names = securityObjectKeys(headers);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const value = stableOwnDataValue(headers, name);
    if (typeof value !== 'string' && !securityArrayIsArray(value)) {
      throw new TypeError(`Kovo response header ${name} must be a string or string array.`);
    }
    clone[name] = securityArrayIsArray(value) ? snapshotStringArray(value) : value;
  }
  return clone as Headers;
}

export function mergeResponseHeaders(
  ...sources: readonly (ResponseHeaders | undefined)[]
): ResponseHeaders {
  const headers: ResponseHeaders = createSecurityNullRecord<ResponseHeaderValue>();

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex];
    if (!source) continue;

    const names = securityObjectKeys(source);
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index]!;
      const value = stableOwnDataValue(source, name);
      if (typeof value !== 'string' && !securityArrayIsArray(value)) {
        throw new TypeError(`Kovo response header ${name} must be a string or string array.`);
      }
      appendResponseHeader(
        headers,
        name,
        typeof value === 'string' ? value : snapshotStringArray(value),
      );
    }
  }

  return headers;
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
export const DOCUMENT_ISOLATION_HEADERS: Readonly<Record<string, string>> = witnessFreeze({
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Origin-Agent-Cluster': '?1',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
});

/**
 * SPEC §6.6 (runtime defense-in-depth): the HSTS value applied to document responses
 * ONLY when the request was served over HTTPS in production. Two years with
 * `includeSubDomains` is the conservative widely-deployed baseline (no `preload`,
 * which is an irreversible registry opt-in the framework must not assume).
 */
export const DOCUMENT_HSTS_VALUE = 'max-age=63072000; includeSubDomains';

/**
 * Decide whether `Strict-Transport-Security` may be attached to a document response.
 * Gated on BOTH production (bootstrap-pinned operator `NODE_ENV` detection, matching
 * `guards.ts`) AND an HTTPS request/response, so a non-HTTPS deploy or any
 * `localhost`/dev request never receives an HSTS header that would otherwise pin the
 * browser to https for two years and brick plain-http local development.
 *
 * @param secureRequest - `true` when the originating request was served over HTTPS.
 * @internal
 */
export function shouldEmitDocumentHsts(secureRequest: boolean): boolean {
  return secureRequest && runtimeEnvironmentValue('NODE_ENV') === 'production';
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
export const respond = witnessFreeze({
  file(body: Exclude<RouteResponseBody, ReadableStream<Uint8Array>>, options: RouteFileOptions) {
    return routeResponseOutcome(body, options, 'attachment');
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
  async storedFile(
    storage: StorageReadCapability,
    key: string,
    options: RouteStoredFileOptions = {},
  ) {
    const storedDisposition = stableOwnDataValue(options, 'disposition');
    const storedFilename = stableOwnDataValue(options, 'filename');
    if (
      storedDisposition !== undefined &&
      storedDisposition !== 'attachment' &&
      storedDisposition !== 'inline'
    ) {
      throw new TypeError('respond.storedFile() disposition must be attachment or inline.');
    }
    if (storedFilename !== undefined && typeof storedFilename !== 'string') {
      throw new TypeError('respond.storedFile() filename must be a string.');
    }
    if ((typeof storage !== 'object' && typeof storage !== 'function') || storage === null) {
      throw new TypeError('respond.storedFile() storage must be a stable read capability.');
    }
    const get = stableRequiredOwnDataValue(storage, 'get');
    if (typeof get !== 'function') {
      throw new TypeError('respond.storedFile() storage.get must be an own data function.');
    }
    const object = await witnessReflectApply<unknown>(get, storage, [key]);
    if (object === undefined) return undefined;
    if (typeof object !== 'object' || object === null || securityArrayIsArray(object)) {
      throw new TypeError('respond.storedFile() storage.get returned an invalid object.');
    }
    const body = stableRequiredOwnDataValue(object, 'body');
    const etag = stableOwnDataValue(object, 'etag');
    const metadata = stableOwnDataValue(object, 'metadata');
    if (!securityIsUint8Array(body)) {
      throw new TypeError('respond.storedFile() storage.get body must be Uint8Array bytes.');
    }
    if (etag !== undefined && typeof etag !== 'string') {
      throw new TypeError('respond.storedFile() storage.get etag must be a string.');
    }
    if (
      metadata !== undefined &&
      (typeof metadata !== 'object' || metadata === null || securityArrayIsArray(metadata))
    ) {
      throw new TypeError('respond.storedFile() storage.get metadata must be a stable record.');
    }
    const metadataFilename =
      metadata === undefined ? undefined : stableOwnDataValue(metadata, 'filename');
    if (metadataFilename !== undefined && typeof metadataFilename !== 'string') {
      throw new TypeError('respond.storedFile() storage filename metadata must be a string.');
    }
    const disposition = storedDisposition ?? 'attachment';
    const bodySnapshot = securityUint8ArraySlice(body);
    const sniffed = sniffUploadBytes(bodySnapshot);
    if (disposition === 'inline' && !sniffed.inlineSafe) {
      throw new InlineUnverifiedUploadError(
        `Refusing to serve stored object "${key}" inline: its sniffed content type is not a ` +
          'known-passive type. Serve as an attachment, or rasterize/re-encode the bytes.',
      );
    }
    const filename = storedFilename ?? metadataFilename;
    return routeResponseOutcome(bodySnapshot, {
      // Server truth: the served type is the SNIFFED type, never the stored (possibly-client) type.
      contentType: sniffed.contentType,
      disposition,
      ...(filename === undefined ? {} : { filename }),
      ...(etag === undefined ? {} : { etag }),
    });
  },
  stream(body: RouteResponseBody, options: RouteStreamOptions) {
    const rawDisposition = stableOwnDataValue(options, 'disposition');
    const declaredContentType = stableOwnDataValue(options, 'contentType');
    const unsafeInlineReceipt = stableOwnDataValue(options, 'unsafeInline');
    if (
      rawDisposition !== undefined &&
      rawDisposition !== 'attachment' &&
      rawDisposition !== 'inline'
    ) {
      throw new TypeError('respond.stream() disposition must be attachment or inline.');
    }
    if (typeof declaredContentType !== 'string') {
      throw new TypeError('respond.stream() contentType must be a string.');
    }
    const unsafeInlineAccepted =
      unsafeInlineReceipt === undefined
        ? false
        : unsafeInlineAcceptanceSnapshot(unsafeInlineReceipt) === unsafeInlineReceipt;
    const disposition = rawDisposition ?? 'attachment';
    // KV428 (SPEC §6.6/§9.1): inline rendering is a branded opt-in over verified-safe bytes. For an
    // in-memory body we deep-sniff and refuse unless the bytes are a known-passive type; an
    // un-bufferable stream cannot be sniffed, so it requires the explicit `unsafeInline` receipt
    // (the framework re-encode/rasterize attestation). This is the fail-closed runtime floor — the
    // honest ceiling is "attacker bytes never render inline as active content", not an unspoofable
    // type. Authors override the sniffed contentType via `unsafeInline(...)` (audited risk).
    const bodySnapshot = snapshotRouteResponseBody(body);
    const contentType =
      disposition === 'inline'
        ? assertInlineBody(bodySnapshot, declaredContentType, unsafeInlineAccepted)
        : declaredContentType;
    return routeResponseOutcome(
      bodySnapshot,
      {
        contentType,
        etag: stableOwnDataValue(options, 'etag'),
        filename: stableOwnDataValue(options, 'filename'),
        headers: stableOwnDataValue(options, 'headers'),
      },
      disposition,
    );
  },
});

export const routeOutcomeResponse = wireEmitter(
  'server.wire.route-outcome-response',
  function (outcome: RouteResponseOutcome, request: unknown): RoutePageResponse {
    const snapshot = snapshotRouteResponseOutcome(outcome);
    const headers = routeOutcomeHeaders(snapshot);
    if (snapshot.etag && requestHeader(request, 'if-none-match') === snapshot.etag) {
      return markRoutePageResponseOutcome({
        body: '',
        headers,
        status: 304,
      });
    }

    const response: RoutePageResponse = {
      // Reconstruct a distinct final carrier for copyable bodies so the private classified bytes
      // remain inaccessible even to callers of this package-internal adapter (SPEC §6.6 / §10.6
      // C15). ReadableStream bodies are intentionally live and retain their one-shot identity;
      // their attachment posture (or explicit unsafeInline receipt) is pinned in the snapshot.
      body: snapshotRouteResponseBody(snapshot.body),
      headers,
      status: 200,
    };
    return markRoutePageResponseOutcome(response);
  },
);

export const htmlServerErrorResponse = wireEmitter(
  'server.wire.html-server-error',
  function (): RoutePageResponse {
    return {
      body: 'Internal Server Error',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 500,
    };
  },
);

export function retryAfterHeaders(result: { retryAfter?: number }): ResponseHeaders {
  return result.retryAfter === undefined ? {} : { 'Retry-After': String(result.retryAfter) };
}

export const routeResponseToWebResponse = wireEmitter(
  'server.wire.route-to-web-response',
  function (
    response: ServerResponseBase<RouteResponseBody, ResponseHeaders>,
    request: Pick<Request, 'method'>,
  ): Response {
    return serverResponseToWebResponse(response, request);
  },
);

export const serverResponseToWebResponse = wireEmitter(
  'server.wire.server-to-web-response',
  function (
    response: ServerResponseBase<WebResponseBody, ResponseHeaders>,
    request: Pick<Request, 'method'>,
  ): Response {
    const buildToken = frameworkDocumentResponseBuildToken(response);
    const finalized = finalizeServerResponse(response, request);
    return buildToken === undefined
      ? finalized
      : markFrameworkDocumentResponse(finalized, buildToken);
  },
);

/**
 * @internal Sanitize a framework-owned Location target for redirects (SPEC §6.6).
 */
export const redirectLocationHeader = wireEmitter(
  'server.wire.redirect-location-header',
  function (target: string, options: RedirectLocationOptions = {}): string {
    assertNoSecretEgressValue(target, 'redirect Location header');
    return sanitizeRedirectLocation(target, options);
  },
);

/** @internal Mark a framework-owned 3xx response whose Location header was sanitized. */
export const blessRedirectResponse = wireEmitter('server.wire.bless-redirect-response', function <
  Response extends ServerResponseBase<unknown, ResponseHeaders>,
>(response: Response): Response {
  const locationName = findHeaderName(response.headers, 'Location');
  if (locationName !== undefined) {
    const location = response.headers[locationName];
    response.headers[locationName] = redirectLocationHeader(
      typeof location === 'string' ? location : (location?.[0] ?? '/'),
    );
  }
  return blessSink(SERVER_REDIRECT_LOCATION_SINK, response);
});

/** @internal Unwrap a redirect Location sink value or fail closed to `/` with a KV236 event. */
export const redirectLocationHeaderValue = wireEmitter(
  'server.wire.redirect-location-header-value',
  function (value: ResponseHeaderValue, blessed: boolean): string {
    assertNoSecretEgressValue(value, 'redirect Location header');
    if (blessed) {
      const location = securityArrayIsArray(value) ? (value[0] ?? '/') : value;
      return redirectLocationHeader(location);
    }
    const text = securityArrayIsArray(value)
      ? securityArrayJoin(snapshotStringArray(value), ', ')
      : securityString(value);
    drainRuntimeSinkSecurityEvent({
      action: 'neutralize',
      code: 'KV236',
      family: 'header',
      message: 'Blocked unblessed redirect Location header at the server response boundary',
      reason: '3xx Location headers must be minted by the framework redirect-location sink',
      sink: 'Location',
      value: {
        length: text.length,
        preview: securityStringSlice(text, 0, 80),
        redacted: true,
      },
    });
    return '/';
  },
);

/** @internal Check whether a 3xx response object owns a sanitized Location header. */
export function isBlessedRedirectResponse(value: unknown): boolean {
  return isBlessedSink(SERVER_REDIRECT_LOCATION_SINK, value);
}

export function methodNotAllowedWebResponse(
  request: Pick<Request, 'method'>,
  allowedMethods: readonly string[],
): Response {
  return finalizeServerResponse(
    {
      body: 'Method Not Allowed',
      headers: {
        Allow: securityArrayJoin(snapshotStringArray(allowedMethods), ', '),
        'Content-Type': 'text/plain; charset=utf-8',
      },
      status: 405,
    },
    request,
  );
}

export const routeResponseToDocumentResponse = wireEmitter(
  'server.wire.route-to-document-response',
  function (response: RoutePageResponse): DocumentRouteResponseBase {
    const documentResponse = {
      ...response,
      body: securityIsArrayBuffer(response.body)
        ? securityUint8ArrayFromArrayBuffer(response.body)
        : response.body,
    };
    const clonedResponse = isRoutePageResponseOutcome(response)
      ? markRoutePageResponseOutcome(documentResponse)
      : documentResponse;
    return isBlessedRedirectResponse(response)
      ? blessRedirectResponse(clonedResponse)
      : clonedResponse;
  },
);

/**
 * KV428 (SPEC §6.6/§9.1): assert an in-memory body is safe to render inline, returning the
 * server-minted (sniffed) content type. Throws {@link InlineUnverifiedUploadError} for
 * HTML/SVG/XML/ambiguous bytes. An un-bufferable `ReadableStream` cannot be sniffed, so inline
 * serving requires the explicit `unsafeInline(...)` receipt — without it, the runtime refuses
 * (fail-closed floor). When that receipt is present, the author's declared content type is trusted
 * (audited risk).
 */
function assertInlineBody(
  body: RouteResponseBody,
  declaredContentType: string,
  unsafeInlineAccepted: boolean,
): string {
  if (unsafeInlineAccepted) return declaredContentType;

  const bytes = inlineBodyBytes(body);
  if (bytes === undefined) {
    throw new InlineUnverifiedUploadError(
      'Refusing to serve a streamed (un-bufferable) body inline without `unsafeInline(...)`. ' +
        'Buffer the bytes so the runtime can deep-sniff them, serve as an attachment, or pass ' +
        '`unsafeInline(justification)` only for bytes the application re-encoded/rasterized.',
    );
  }

  const sniffed = sniffUploadBytes(bytes);
  if (!sniffed.inlineSafe) {
    throw new InlineUnverifiedUploadError(
      'Refusing to serve unverified bytes inline: the sniffed content type is not a known-passive ' +
        'type (HTML/SVG/XML/ambiguous bytes are attachment-only — SVG is XML+script). Serve as an ' +
        'attachment, or rasterize/re-encode and pass `unsafeInline(justification)`.',
    );
  }
  // Server truth: the served Content-Type comes from the sniffed bytes, not the client/author lie.
  return sniffed.contentType;
}

/** Buffer an in-memory body to bytes for sniffing; `undefined` for an un-bufferable stream. */
function inlineBodyBytes(body: RouteResponseBody): Uint8Array | undefined {
  if (typeof body === 'string') return securityTextEncode(body);
  if (securityIsArrayBuffer(body)) return securityUint8ArrayFromArrayBuffer(body);
  if (securityIsUint8Array(body)) return body;
  return undefined; // ReadableStream — not bufferable without consuming it.
}

function snapshotRouteResponseBody(body: RouteResponseBody): RouteResponseBody {
  if (securityIsArrayBuffer(body)) return securityArrayBufferSlice(body);
  if (securityIsUint8Array(body)) return securityUint8ArraySlice(body);
  return body;
}

function routeResponseOutcome(
  body: RouteResponseBody,
  options: object,
  forcedDisposition?: 'attachment' | 'inline',
): RouteResponseOutcome {
  const bodySnapshot = snapshotRouteResponseBody(body);
  const contentType = stableOwnDataValue(options, 'contentType');
  const disposition = forcedDisposition ?? stableOwnDataValue(options, 'disposition');
  const filename = stableOwnDataValue(options, 'filename');
  const etag = stableOwnDataValue(options, 'etag');
  const rawHeaders = stableOwnDataValue(options, 'headers');
  if (typeof contentType !== 'string') {
    throw new TypeError('respond.file()/stream() requires a string contentType.');
  }
  if (disposition !== 'attachment' && disposition !== 'inline') {
    throw new TypeError('respond.file()/stream() requires attachment or inline disposition.');
  }
  if (filename !== undefined && typeof filename !== 'string') {
    throw new TypeError('respond.file()/stream() filename must be a string.');
  }
  if (etag !== undefined && typeof etag !== 'string') {
    throw new TypeError('respond.file()/stream() etag must be a string.');
  }
  const headers =
    rawHeaders === undefined
      ? undefined
      : witnessFreeze(snapshotStringHeaderRecord(rawHeaders, 'respond.file()/stream() headers'));
  const contentDisposition = filename
    ? contentDispositionWithFilename(disposition, filename)
    : disposition;
  // SPEC §6.6 / §10.6 C15: private response authority must not inherit optional security
  // fields from the shared app realm. Keep every field exact-own (including explicit undefined)
  // on a null-prototype record so late Object.prototype.etag/headers pollution cannot mint a 304
  // or inject cache/header policy into the final sink.
  const snapshotRecord = createSecurityNullRecord<unknown>();
  snapshotRecord.body = bodySnapshot;
  snapshotRecord.contentDisposition = contentDisposition;
  snapshotRecord.contentType = contentType;
  snapshotRecord.etag = etag;
  snapshotRecord.headers = headers;
  const snapshot = witnessFreeze(snapshotRecord) as unknown as RouteResponseOutcomeSnapshot;
  return mintRouteResponseOutcome(snapshot);
}

function mintRouteResponseOutcome(snapshot: RouteResponseOutcomeSnapshot): RouteResponseOutcome {
  // SPEC §6.6 / §10.6 C15: the public view is deliberately distinct from the private snapshot.
  // In particular, mutable byte buffers and header records exposed for inspection cannot mutate
  // the exact carrier later consumed by the HTTP sink. ReadableStream is the intentional exception:
  // it is a live one-shot carrier, so the private snapshot pins its identity and response posture.
  const exposedHeaders =
    snapshot.headers === undefined
      ? undefined
      : witnessFreeze(
          snapshotStringHeaderRecord(snapshot.headers, 'Kovo route response outcome headers'),
        );
  const outcome = defineRouteResponseMarker({
    body: snapshotRouteResponseBody(snapshot.body),
    contentDisposition: snapshot.contentDisposition,
    contentType: snapshot.contentType,
    // These inspection fields are not runtime authority, but exact-own undefined values prevent
    // adjacent internal consumers from accidentally observing inherited app-realm policy.
    etag: snapshot.etag,
    headers: exposedHeaders,
  });
  witnessWeakMapSet(routeResponseOutcomeSnapshots, outcome, snapshot);
  return witnessFreeze(outcome) as RouteResponseOutcome;
}

const routeOutcomeHeaders = wireEmitter(
  'server.wire.route-outcome-headers',
  function (outcome: RouteResponseOutcomeSnapshot): Record<string, string> {
    return {
      ...safeRouteOutcomeHeaders(outcome.headers),
      'Content-Disposition': outcome.contentDisposition,
      'Content-Type': outcome.contentType,
      'X-Content-Type-Options': 'nosniff',
      ...(outcome.etag === undefined ? {} : { ETag: outcome.etag }),
    };
  },
);

const RESERVED_ROUTE_RESPONSE_HEADERS = reservedRouteResponseHeaders();

function reservedRouteResponseHeaders(): Set<string> {
  const reserved = createSecuritySet<string>();
  securitySetAdd(reserved, 'content-disposition');
  securitySetAdd(reserved, 'content-type');
  securitySetAdd(reserved, 'etag');
  securitySetAdd(reserved, 'set-cookie');
  securitySetAdd(reserved, 'x-content-type-options');
  return reserved;
}

function safeRouteOutcomeHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (headers === undefined) return {};
  const safeHeaders: Record<string, string> = createSecurityNullRecord<string>();
  const names = securityObjectKeys(headers);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const value = stableOwnDataValue(headers, name);
    if (typeof value !== 'string') {
      throw new TypeError(`Kovo route outcome header ${name} must be a string.`);
    }
    if (securitySetHas(RESERVED_ROUTE_RESPONSE_HEADERS, securityStringToLowerCase(name))) {
      continue;
    }
    safeHeaders[name] = value;
  }
  return safeHeaders;
}

const contentDispositionWithFilename = createContentDispositionWithFilename({
  charCodeAt: securityStringCharCodeAt,
  encodeURIComponent: securityEncodeURIComponent,
  slice: securityStringSlice,
  trim: securityStringTrim,
});

function requestHeader(request: unknown, name: string): string | undefined {
  if (request && typeof request === 'object' && 'headers' in request) {
    const headers = (request as { headers?: unknown }).headers;
    if (isHeaderSource(headers)) return readHeader(headers, name);
  }

  if (isHeaderSource(request)) return readHeader(request, name);
  return undefined;
}

function sanitizeRedirectLocation(target: string, options: RedirectLocationOptions): string {
  if (hasHeaderControlCharacter(target)) return '/';
  if (securityStringIncludes(target, '\\')) return '/';
  if (
    securityStringStartsWith(target, '/') &&
    !securityStringStartsWith(target, '//') &&
    !securityStringStartsWith(target, '/\\')
  ) {
    return target;
  }

  const origin = absoluteRedirectOrigin(target);
  if (origin === undefined) return '/';
  const rawAllowlist = stableOwnDataValue(options, 'allowlist');
  if (rawAllowlist !== undefined && !securityArrayIsArray(rawAllowlist)) {
    throw new TypeError('Redirect Location allowlist must be an array.');
  }
  const allowlist =
    rawAllowlist === undefined ? undefined : snapshotRedirectAllowlist(rawAllowlist);
  if (!redirectOriginAllowed(origin, allowlist)) return '/';
  return target;
}

function absoluteRedirectOrigin(target: string): string | undefined {
  try {
    const url = securityUrlSnapshot(target);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function redirectOriginAllowed(
  origin: string,
  allowlist: readonly RedirectLocationAllowlistEntry[] | undefined,
): boolean {
  if (allowlist === undefined) return false;
  let allowed = false;
  for (let index = 0; index < allowlist.length; index += 1) {
    const entry = allowlist[index]!;
    if (typeof entry !== 'object' || entry === null) {
      throw new TypeError('Redirect Location allowlist entries must be objects.');
    }
    if (normalizedRedirectAllowlistOrigin(entry) === origin) allowed = true;
  }
  return allowed;
}

function normalizedRedirectAllowlistOrigin(entry: RedirectLocationAllowlistEntry): string {
  const reason = stableOwnDataValue(entry, 'reason');
  const origin = stableOwnDataValue(entry, 'origin');
  if (typeof origin !== 'string') {
    throw new TypeError('Redirect Location allowlist entries require string origin and reason.');
  }
  snapshotAuditReason(reason, 'Redirect Location allowlist entry (SPEC §9.1)');
  if (hasHeaderControlCharacter(origin)) {
    throw new TypeError('Redirect Location allowlist origins must not contain control characters.');
  }
  let url: ReturnType<typeof securityUrlSnapshot>;
  try {
    url = securityUrlSnapshot(origin);
  } catch {
    throw new TypeError(`Invalid Redirect Location allowlist origin: ${origin}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Redirect Location allowlist origins must use http: or https:.');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new TypeError('Redirect Location allowlist entries must be exact origins.');
  }
  return url.origin;
}

function hasHeaderControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function findHeaderName(headers: HeaderSource, name: string): string | undefined {
  const wanted = securityStringToLowerCase(name);
  if (securityIsHeaders(headers)) {
    return securityHeadersGet(headers, name) === null ? undefined : name;
  }
  if (securityIsMap(headers)) {
    let found: string | undefined;
    securityMapForEach(headers, (value, key) => {
      if (
        found === undefined &&
        typeof key === 'string' &&
        typeof value === 'string' &&
        securityStringToLowerCase(key) === wanted
      ) {
        found = value;
      }
    });
    return found;
  }
  if (securityArrayIsArray(headers)) {
    for (let index = 0; index < headers.length; index += 1) {
      const tuple = stableOwnDataValue(headers, index);
      if (isHeaderTuple(tuple)) {
        const key = stableOwnDataValue(tuple, 0);
        const value = stableOwnDataValue(tuple, 1);
        if (
          typeof key === 'string' &&
          typeof value === 'string' &&
          securityStringToLowerCase(key) === wanted
        ) {
          return value;
        }
      }
    }
    return undefined;
  }
  const names = securityObjectKeys(headers);
  for (let index = 0; index < names.length; index += 1) {
    const candidate = names[index]!;
    if (securityStringToLowerCase(candidate) === wanted) return candidate;
  }
  return undefined;
}

function isHeaderRecordValue(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === 'string' ||
    (securityArrayIsArray(value) && isStringArray(value))
  );
}

function isHeaderTuple(value: unknown): value is readonly [string, string] {
  if (!securityArrayIsArray(value) || value.length !== 2) return false;
  return (
    typeof stableOwnDataValue(value, 0) === 'string' &&
    typeof stableOwnDataValue(value, 1) === 'string'
  );
}

function stableOwnDataValue(value: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(value, property);
  const after = witnessGetOwnPropertyDescriptor(value, property);
  if ((before === undefined) !== (after === undefined)) {
    throw new TypeError(`Kovo response input ${String(property)} must be stable.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || after === undefined || !('value' in after)) {
    throw new TypeError(`Kovo response input ${String(property)} must be an own data property.`);
  }
  if (!witnessObjectIs(before.value, after.value)) {
    throw new TypeError(`Kovo response input ${String(property)} changed during validation.`);
  }
  return before.value;
}

function stableRequiredOwnDataValue(value: object, property: PropertyKey): unknown {
  const result = stableOwnDataValue(value, property);
  if (witnessGetOwnPropertyDescriptor(value, property) === undefined) {
    throw new TypeError(`Kovo response input ${String(property)} must be an own data property.`);
  }
  return result;
}

function snapshotDenseArray<Value>(values: readonly Value[], label: string): Value[] {
  if (!securityArrayIsArray(values)) throw new TypeError(`${label} must be an array.`);
  const length = stableOwnDataValue(values, 'length');
  if (typeof length !== 'number' || !securityNumberIsInteger(length) || length < 0) {
    throw new TypeError(`${label} length must be a non-negative integer.`);
  }
  const snapshot: Value[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(values, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} must be a dense own-data array.`);
    }
    securityArrayPush(snapshot, descriptor.value as Value);
  }
  return snapshot;
}

function isStringArray(value: readonly unknown[]): value is readonly string[] {
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      return false;
    }
  }
  return true;
}

function snapshotStringArray(values: readonly unknown[]): string[] {
  const snapshot = snapshotDenseArray(values, 'Kovo response header values');
  const strings: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const value = snapshot[index];
    if (typeof value !== 'string') {
      throw new TypeError('Kovo response header values must contain only strings.');
    }
    securityArrayPush(strings, value);
  }
  return strings;
}

function snapshotRedirectAllowlist(values: readonly unknown[]): RedirectLocationAllowlistEntry[] {
  const snapshot = snapshotDenseArray(values, 'Redirect Location allowlist');
  const entries: RedirectLocationAllowlistEntry[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const value = snapshot[index];
    if (typeof value !== 'object' || value === null) {
      throw new TypeError('Redirect Location allowlist entries must be objects.');
    }
    const reason = stableOwnDataValue(value, 'reason');
    const origin = stableOwnDataValue(value, 'origin');
    if (typeof origin !== 'string') {
      throw new TypeError('Redirect Location allowlist entries require string origin and reason.');
    }
    securityArrayPush(entries, {
      origin,
      reason: snapshotAuditReason(reason, 'Redirect Location allowlist entry (SPEC §9.1)'),
    });
  }
  return entries;
}

function snapshotStringHeaderRecord(value: unknown, label: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || securityArrayIsArray(value)) {
    throw new TypeError(`${label} must be a plain header record.`);
  }
  const snapshot: Record<string, string> = createSecurityNullRecord<string>();
  const names = securityObjectKeys(value);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const header = stableOwnDataValue(value, name);
    if (typeof header !== 'string') {
      throw new TypeError(`${label}.${name} must be a string.`);
    }
    snapshot[name] = header;
  }
  return snapshot;
}

function snapshotRouteResponseOutcome(outcome: RouteResponseOutcome): RouteResponseOutcomeSnapshot {
  if (typeof outcome !== 'object' || outcome === null) {
    throw new TypeError('Kovo route response outcome must be an object minted by respond.');
  }
  const snapshot = witnessWeakMapGet(routeResponseOutcomeSnapshots, outcome);
  if (snapshot === undefined) {
    throw new TypeError('Kovo route response outcome must be minted by respond.');
  }
  return snapshot;
}
