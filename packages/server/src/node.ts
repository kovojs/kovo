import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliCompress, createGzip } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { RequestHandler } from './app-types.js';
import { trustedNodeRequestScheme } from './request-scheme.js';
import {
  createWitnessSet,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessReflectApply,
  witnessSetAdd,
  witnessSetHas,
} from './security-witness-intrinsics.js';

/** Options for adapting a Web `RequestHandler` to a Node `http` listener. */
export interface NodeHandlerOptions {
  /** Compress eligible text responses by default; set `false` to opt out. */
  compression?: boolean;
  earlyHints?: boolean;
  origin?: string | ((request: IncomingMessage) => string);
  /** Trust forwarded scheme headers when constructing Request URLs. Disabled by default. */
  trustedProxy?: boolean;
}

export interface WriteWebResponseToNodeOptions {
  acceptEncoding?: string;
  /** Compress eligible text responses by default; set `false` to opt out. */
  compression?: boolean;
  earlyHints?: boolean;
  /**
   * L16-2 (RFC 8297): the originating request's HTTP version. 103 Early Hints is an
   * HTTP/1.1+ interim response; an HTTP/1.0 client cannot parse 1xx responses, so a 103
   * desynchronizes the connection. When this is `'1.0'`, `writeEarlyHints` is suppressed.
   */
  httpVersion?: string;
}

/** Node `http`/`https` listener shape returned by `toNodeHandler()`. */
export type NodeRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void> | void;

const NativeHeaders = globalThis.Headers;
const NativeRequest = globalThis.Request;
const NativeURL = globalThis.URL;
const nativeHeadersGlobalDescriptor = witnessGetOwnPropertyDescriptor(globalThis, 'Headers');
const nativeRequestGlobalDescriptor = witnessGetOwnPropertyDescriptor(globalThis, 'Request');
const nativeUrlGlobalDescriptor = witnessGetOwnPropertyDescriptor(globalThis, 'URL');
if (
  nativeHeadersGlobalDescriptor === undefined ||
  nativeRequestGlobalDescriptor === undefined ||
  nativeUrlGlobalDescriptor === undefined
) {
  throw new TypeError('Kovo Node adapter requires intact web platform constructors.');
}
const nativeHeadersAppend = NativeHeaders.prototype.append;
const nativeHeadersDelete = NativeHeaders.prototype.delete;
const nativeHeadersForEach = NativeHeaders.prototype.forEach;
const nativeHeadersGet = NativeHeaders.prototype.get;
const nativeHeadersGetSetCookie = NativeHeaders.prototype.getSetCookie;
const nativeHeadersHas = NativeHeaders.prototype.has;
const nativeHeadersSet = NativeHeaders.prototype.set;
const nativeUrlHashGetter = witnessGetOwnPropertyDescriptor(NativeURL.prototype, 'hash')?.get;
const nativeUrlHrefGetter = witnessGetOwnPropertyDescriptor(NativeURL.prototype, 'href')?.get;
const nativeUrlOriginGetter = witnessGetOwnPropertyDescriptor(NativeURL.prototype, 'origin')?.get;
const nativeUrlPathnameGetter = witnessGetOwnPropertyDescriptor(
  NativeURL.prototype,
  'pathname',
)?.get;
const nativeUrlSearchGetter = witnessGetOwnPropertyDescriptor(NativeURL.prototype, 'search')?.get;
if (
  nativeUrlHashGetter === undefined ||
  nativeUrlHrefGetter === undefined ||
  nativeUrlOriginGetter === undefined ||
  nativeUrlPathnameGetter === undefined ||
  nativeUrlSearchGetter === undefined
) {
  throw new TypeError('Kovo Node adapter requires intact URL intrinsic accessors.');
}

const bodylessMethods = createWitnessSet<string>();
witnessSetAdd(bodylessMethods, 'GET');
witnessSetAdd(bodylessMethods, 'HEAD');
const requestPeerAddressProperty = '__kovoPeerAddress';
const requestTargetAnalysisOrigin = 'https://kovo.invalid';

/**
 * Adapt a Web-standard `RequestHandler` (from `createRequestHandler`) to a Node
 * `http`/`https` `(req, res)` listener, translating between Node and Web
 * request/response objects.
 *
 * @param handler - The Web request handler to adapt.
 * @param options - Node adapter options (e.g. base URL resolution).
 * @returns A Node request listener.
 */
export function toNodeHandler(
  handler: RequestHandler,
  options: NodeHandlerOptions = {},
): NodeRequestHandler {
  return async (nodeRequest, nodeResponse) => {
    try {
      if (rejectUnsafeNodeMutationTarget(nodeRequest, nodeResponse)) return;
      const request = nodeRequestToWebRequest(nodeRequest, options, nodeResponse);
      const response = await handler(request);
      armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
      // L16-2 (RFC 8297): thread the request's HTTP version so 103 Early Hints is gated to
      // HTTP/1.1+ clients (an HTTP/1.0 peer cannot parse interim 1xx responses).
      const acceptEncoding = firstHeaderValue(nodeRequest.headers['accept-encoding']);
      const writeOptions: WriteWebResponseToNodeOptions = {
        ...(acceptEncoding === undefined ? {} : { acceptEncoding }),
        ...(options.compression === undefined ? {} : { compression: options.compression }),
        ...(options.earlyHints === undefined ? {} : { earlyHints: options.earlyHints }),
        httpVersion: nodeRequest.httpVersion,
      };

      await writeWebResponseToNode(response, nodeResponse, request.method, writeOptions);
    } catch {
      // E1 (SPEC §9.5/§9.2): once the response head is committed (`headersSent`), a 200's
      // status/body are already on the wire. Appending "Internal Server Error" here would
      // corrupt that committed body (a mid-stream render error yielding HTTP 200
      // "partial-Internal Server Error"). Tear the socket instead so the client observes a
      // truncated/aborted transfer rather than a clean 200 carrying injected error text.
      if (nodeResponse.headersSent) {
        nodeResponse.destroy();
        return;
      }
      armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
      nodeResponse.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      nodeResponse.end('Internal Server Error');
    }
  };
}

export function nodeRequestToWebRequest(
  nodeRequest: IncomingMessage,
  options: NodeHandlerOptions = {},
  nodeResponse?: ServerResponse,
): Request {
  if (unsafeReservedMutationRequestTarget(nodeRequest.url ?? '/')) {
    throw new TypeError('Reserved mutation request targets must use their canonical raw path.');
  }
  const method = nodeRequest.method ?? 'GET';
  const headers = nodeHeadersToWebHeaders(nodeRequest);
  // E3 (SPEC §9.5): bridge a client disconnect into the Web `Request.signal` so handlers,
  // queries, webhooks, and any downstream `fetch(url, { signal: request.signal })` abort
  // instead of running against a dead socket (a cheap resource-exhaustion amplifier under an
  // anonymous flood). `'aborted'`/an early `'close'` on the request stream and a `'close'`
  // on the response before it finished all mean the peer went away — abort the controller.
  const controller = new AbortController();
  const abort = (): void => {
    if (!controller.signal.aborted) controller.abort();
  };
  const socket = nodeRequest.socket;
  nodeRequest.once('aborted', abort);
  nodeRequest.once('close', abort);
  socket?.once('close', abort);
  // K1 (SPEC §9.5): the socket is reused across requests on a keep-alive connection, so a
  // never-removed `socket.once('close', abort)` accumulates one listener + AbortController
  // (closing over this Request) per request — an unbounded leak culminating in
  // MaxListenersExceededWarning. The `'aborted'`/`'close'` listeners live on the per-request
  // `nodeRequest` (discarded each request), but the socket-level listener must be removed once
  // this request's response is done so it never outlives the request that registered it. Drive
  // cleanup off the response's own 'close'/'finish' (the response is per-request too), which
  // fires after the head+body are flushed and cannot prematurely cancel a still-running handler.
  if (nodeResponse) {
    const cleanup = (): void => {
      nodeRequest.off('aborted', abort);
      nodeRequest.off('close', abort);
      socket?.off('close', abort);
    };
    nodeResponse.once('close', cleanup);
  }
  const init: RequestInit = {
    headers,
    method,
    signal: controller.signal,
    ...(witnessSetHas(bodylessMethods, method)
      ? {}
      : {
          body: Readable.toWeb(nodeRequest) as ReadableStream<Uint8Array>,
          duplex: 'half',
        }),
  };

  const request = constructNativeRequest(nodeRequestUrl(nodeRequest, options), init);
  const peerAddress = nodeRequest.socket?.remoteAddress?.trim();
  if (peerAddress) {
    witnessDefineProperty(request, requestPeerAddressProperty, {
      configurable: true,
      value: peerAddress,
    });
  }
  return request;
}

function constructNativeRequest(input: string, init: RequestInit): Request {
  const currentHeaders = witnessGetOwnPropertyDescriptor(globalThis, 'Headers');
  const currentRequest = witnessGetOwnPropertyDescriptor(globalThis, 'Request');
  const currentUrl = witnessGetOwnPropertyDescriptor(globalThis, 'URL');
  if (currentHeaders === undefined || currentRequest === undefined || currentUrl === undefined) {
    throw new TypeError('Kovo Node adapter web platform constructors are unavailable.');
  }
  try {
    // Node's Request constructor consults the realm URL binding internally. Restore the captured
    // trio only for this synchronous construction step, then put evaluated app globals back.
    witnessDefineProperty(globalThis, 'Headers', nativeHeadersGlobalDescriptor);
    witnessDefineProperty(globalThis, 'Request', nativeRequestGlobalDescriptor);
    witnessDefineProperty(globalThis, 'URL', nativeUrlGlobalDescriptor);
    return new NativeRequest(input, init);
  } finally {
    witnessDefineProperty(globalThis, 'Headers', currentHeaders);
    witnessDefineProperty(globalThis, 'Request', currentRequest);
    witnessDefineProperty(globalThis, 'URL', currentUrl);
  }
}

export async function writeWebResponseToNode(
  response: Response,
  nodeResponse: ServerResponse,
  method = 'GET',
  options: WriteWebResponseToNodeOptions = {},
): Promise<void> {
  const compression = responseCompression(response, options, method);
  const responseHeaders = new NativeHeaders(response.headers);
  if (nodeResponse.shouldKeepAlive === false && options.httpVersion !== '2.0') {
    setHeader(responseHeaders, 'Connection', 'close');
  }
  if (compression) {
    setHeader(responseHeaders, 'Content-Encoding', compression);
    deleteHeader(responseHeaders, 'Content-Length');
    appendVary(responseHeaders, 'Accept-Encoding');
  }
  const headers = responseHeadersToNodeHeaders(responseHeaders);
  const earlyHints = getHeader(response.headers, 'Link');

  if (
    options.earlyHints !== false &&
    earlyHints &&
    typeof nodeResponse.writeEarlyHints === 'function' &&
    // L16-2 (RFC 8297): 103 Early Hints is HTTP/1.1+; an HTTP/1.0 client cannot parse a 1xx
    // interim response, so emitting one desynchronizes the connection. Suppress for '1.0'.
    options.httpVersion !== '1.0'
  ) {
    nodeResponse.writeEarlyHints({ link: nodeEarlyHintsLinkValue(earlyHints) });
  }

  nodeResponse.writeHead(response.status, response.statusText, headers);
  if (method === 'HEAD' || response.body === null) {
    nodeResponse.end();
    return;
  }
  const responseBody = response.body;

  const source = Readable.fromWeb(responseBody as NodeReadableStream<Uint8Array>);
  // E1 (SPEC §9.5/§9.2): the head is already committed (writeHead above). A source-stream
  // error mid-body must not let the caller append error text onto the partial response —
  // tear the socket so the client sees a truncated/aborted transfer, then reject so the
  // caller's catch knows the write failed (its `headersSent` guard short-circuits).
  if (compression === 'br') await pipeline(source, createBrotliCompress(), nodeResponse);
  else if (compression === 'gzip') await pipeline(source, createGzip(), nodeResponse);
  else await pipeline(source, nodeResponse);
}

/**
 * SPEC §9.5: a response that finishes before Node has received the complete request body
 * cannot leave the HTTP/1 connection reusable. An oversized declared/chunked body can otherwise
 * collect a 413 while retaining the socket until a much later transport timeout. Mark the response
 * non-persistent before its head is written, then tear down only after the response has flushed.
 */
function armIncompleteNodeRequestClose(
  nodeRequest: IncomingMessage,
  nodeResponse: ServerResponse,
): void {
  if (nodeRequest.complete || nodeRequest.destroyed || nodeResponse.destroyed) return;

  nodeResponse.shouldKeepAlive = false;
  const closeIncompleteRequest = (): void => {
    if (!nodeRequest.complete && !nodeRequest.destroyed) nodeRequest.destroy();
  };
  nodeResponse.once('finish', closeIncompleteRequest);
  nodeResponse.once('close', closeIncompleteRequest);
}

/**
 * SPEC §6.6/§9.2: WHATWG URL construction normalizes encoded dot segments before the app
 * dispatcher can compare the raw mutation identity. Reject ambiguous reserved mutation targets at
 * the Node request-target boundary so an alias cannot inherit another mutation's policy/handler.
 */
function rejectUnsafeNodeMutationTarget(
  nodeRequest: IncomingMessage,
  nodeResponse: ServerResponse,
): boolean {
  if (!unsafeReservedMutationRequestTarget(nodeRequest.url ?? '/')) return false;

  armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
  nodeResponse.writeHead(404, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  nodeResponse.end('Not Found');
  return true;
}

function unsafeReservedMutationRequestTarget(rawTarget: string): boolean {
  if (typeof rawTarget !== 'string') return true;
  const absoluteForm = rawRequestTargetHasScheme(rawTarget);
  const pathname = rawNodeRequestTargetPathname(rawTarget);
  const comparablePathname = rawRequestTargetSlashPath(pathname);
  const rootedPathname = rootedRawRequestTargetPath(comparablePathname);
  let normalizedPathname: string;
  try {
    normalizedPathname = urlPathname(new NativeURL(rootedPathname, requestTargetAnalysisOrigin));
  } catch {
    return false;
  }
  if (!isReservedMutationPath(normalizedPathname)) return false;

  // Canonical mutation identities are already exactly what the URL parser will expose. Any raw
  // spelling that reaches the same reserved path only after slash, backslash, percent-dot, or dot
  // segment processing is an alias and must die before app policy/dispatch sees it.
  return (
    absoluteForm ||
    pathname !== normalizedPathname ||
    rawRequestTargetHasBackslash(pathname) ||
    rawRequestTargetHasEncodedPathControl(pathname)
  );
}

function rawNodeRequestTargetPathname(rawTarget: string): string {
  let end = rawTarget.length;
  for (let index = 0; index < rawTarget.length; index += 1) {
    const character = rawTarget[index];
    if (character === '?' || character === '#') {
      end = index;
      break;
    }
  }

  let scheme = -1;
  for (let index = 0; index + 2 < end; index += 1) {
    if (rawTarget[index] === ':' && rawTarget[index + 1] === '/' && rawTarget[index + 2] === '/') {
      scheme = index;
      break;
    }
  }
  if (scheme < 0) return rawRequestTargetRange(rawTarget, 0, end);

  let path = -1;
  for (let index = scheme + 3; index < end; index += 1) {
    if (rawTarget[index] === '/' || rawTarget[index] === '\\') {
      path = index;
      break;
    }
  }
  return path < 0 ? '/' : rawRequestTargetRange(rawTarget, path, end);
}

function rawRequestTargetRange(value: string, start: number, end: number): string {
  let result = '';
  for (let index = start; index < end; index += 1) result += value[index];
  return result;
}

function rawRequestTargetHasScheme(value: string): boolean {
  if (value.length < 2 || !isAsciiAlpha(value[0])) return false;
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (character === ':') return true;
    if (
      !isAsciiAlpha(character) &&
      !(character >= '0' && character <= '9') &&
      character !== '+' &&
      character !== '-' &&
      character !== '.'
    ) {
      return false;
    }
  }
  return false;
}

function isAsciiAlpha(character: string | undefined): boolean {
  return (
    character !== undefined &&
    ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z'))
  );
}

function rawRequestTargetSlashPath(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    result += value[index] === '\\' ? '/' : value[index];
  }
  return result;
}

function rootedRawRequestTargetPath(value: string): string {
  let first = 0;
  while (first < value.length && value[first] === '/') first += 1;
  return `/${rawRequestTargetRange(value, first, value.length)}`;
}

function isReservedMutationPath(value: string): boolean {
  if (value === '/_m') return true;
  return (
    value.length >= 4 &&
    value[0] === '/' &&
    value[1] === '_' &&
    value[2] === 'm' &&
    value[3] === '/'
  );
}

function rawRequestTargetHasBackslash(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\') return true;
  }
  return false;
}

function rawRequestTargetHasEncodedPathControl(value: string): boolean {
  for (let index = 0; index + 2 < value.length; index += 1) {
    if (value[index] !== '%') continue;
    const first = value[index + 1];
    const second = value[index + 2];
    if (first === '2' && (second === 'e' || second === 'E' || second === 'f' || second === 'F')) {
      return true;
    }
    if (first === '5' && (second === 'c' || second === 'C')) return true;
  }
  return false;
}

function urlHash(url: URL): string {
  return witnessReflectApply(nativeUrlHashGetter, url, []);
}

function urlHref(url: URL): string {
  return witnessReflectApply(nativeUrlHrefGetter, url, []);
}

function urlOrigin(url: URL): string {
  return witnessReflectApply(nativeUrlOriginGetter, url, []);
}

function urlPathname(url: URL): string {
  return witnessReflectApply(nativeUrlPathnameGetter, url, []);
}

function urlSearch(url: URL): string {
  return witnessReflectApply(nativeUrlSearchGetter, url, []);
}

function responseCompression(
  response: Response,
  options: WriteWebResponseToNodeOptions,
  method: string,
): 'br' | 'gzip' | undefined {
  if (options.compression === false) return undefined;
  if (method === 'HEAD' || response.body === null) return undefined;
  if (response.status === 204 || response.status === 304) return undefined;
  if (hasHeader(response.headers, 'Content-Encoding')) return undefined;
  if (isSensitiveResponse(response.headers)) return undefined;
  if (!isCompressibleContentType(getHeader(response.headers, 'Content-Type') ?? '')) {
    return undefined;
  }
  return preferredCompression(options.acceptEncoding ?? '');
}

function isSensitiveResponse(headers: Headers): boolean {
  const cacheControl = getHeader(headers, 'Cache-Control') ?? '';
  if (/\b(no-transform|no-store|private)\b/i.test(cacheControl)) return true;
  if (hasHeader(headers, 'Set-Cookie')) return true;
  const vary = getHeader(headers, 'Vary') ?? '';
  return vary
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .includes('cookie');
}

function preferredCompression(acceptEncoding: string): 'br' | 'gzip' | undefined {
  const encodings = parseAcceptEncoding(acceptEncoding);
  const wildcard = encodings.get('*') ?? 0;
  const br = encodings.get('br') ?? wildcard;
  const gzip = encodings.get('gzip') ?? wildcard;
  if (br <= 0 && gzip <= 0) return undefined;
  return br >= gzip && br > 0 ? 'br' : 'gzip';
}

function parseAcceptEncoding(value: string): Map<string, number> {
  const encodings = new Map<string, number>();
  for (const rawEntry of value.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const [rawName, ...params] = entry.split(';');
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const param of params) {
      const [rawKey, rawValue] = param.trim().split('=');
      if (rawKey?.toLowerCase() !== 'q') continue;
      const parsed = Number(rawValue);
      q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
    }
    encodings.set(name, q);
  }
  return encodings;
}

function isCompressibleContentType(contentType: string): boolean {
  const type = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return (
    type.startsWith('text/') ||
    type === 'application/javascript' ||
    type === 'application/json' ||
    type === 'application/ld+json' ||
    type === 'application/manifest+json' ||
    type === 'application/x-javascript' ||
    type === 'application/xhtml+xml' ||
    type === 'application/xml' ||
    type === 'image/svg+xml' ||
    type.endsWith('+json') ||
    type.endsWith('+xml')
  );
}

function appendVary(headers: Headers, token: string): void {
  const existing = getHeader(headers, 'Vary');
  if (!existing) {
    setHeader(headers, 'Vary', token);
    return;
  }
  const tokens = existing.split(',').map((entry) => entry.trim().toLowerCase());
  if (!tokens.includes(token.toLowerCase())) setHeader(headers, 'Vary', `${existing}, ${token}`);
}

function nodeEarlyHintsLinkValue(header: string): string | string[] {
  const entries = splitLinkHeaderEntries(header);
  return entries.length > 1 ? entries : header;
}

function splitLinkHeaderEntries(header: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let inAngle = false;
  let inQuote = false;
  let escaped = false;

  for (let index = 0; index < header.length; index += 1) {
    const char = header[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inQuote) {
      escaped = true;
      continue;
    }
    if (char === '"' && !inAngle) {
      inQuote = !inQuote;
      continue;
    }
    if (char === '<' && !inQuote) {
      inAngle = true;
      continue;
    }
    if (char === '>' && !inQuote) {
      inAngle = false;
      continue;
    }
    if (char === ',' && !inAngle && !inQuote) {
      const entry = header.slice(start, index).trim();
      if (entry) entries.push(entry);
      start = index + 1;
    }
  }

  const tail = header.slice(start).trim();
  if (tail) entries.push(tail);
  return entries;
}

function nodeRequestUrl(request: IncomingMessage, options: NodeHandlerOptions): string {
  const rawUrl = request.url ?? '/';
  const origin =
    typeof options.origin === 'function'
      ? options.origin(request)
      : (options.origin ?? defaultOrigin(request, options));

  const originUrl = new NativeURL(origin);
  const pinnedOrigin = urlOrigin(originUrl);
  if (pinnedOrigin === 'null') throw new TypeError('Node adapter origin must be hierarchical.');

  const absolute = rawRequestTargetHasScheme(rawUrl);
  const pathTarget = absolute
    ? new NativeURL(rawUrl)
    : new NativeURL(canonicalRelativeRequestTarget(rawUrl), requestTargetAnalysisOrigin);
  const pathname = urlPathname(pathTarget);
  const assembled = new NativeURL(
    `${pinnedOrigin}${pathname[0] === '/' ? '' : '/'}${pathname}${urlSearch(pathTarget)}${urlHash(pathTarget)}`,
  );
  return urlHref(assembled);
}

function canonicalRelativeRequestTarget(rawTarget: string): string {
  if (rawTarget[0] !== '/' && rawTarget[0] !== '\\') return rawTarget;
  let first = 0;
  while (first < rawTarget.length && (rawTarget[first] === '/' || rawTarget[first] === '\\')) {
    first += 1;
  }
  return `/${rawRequestTargetRange(rawTarget, first, rawTarget.length)}`;
}

function defaultOrigin(request: IncomingMessage, options: NodeHandlerOptions): string {
  // E2 (SPEC §9.5): under HTTP/2 the `Host` header is often absent — the authority lives in
  // the `:authority` pseudo-header instead. Fall back to it (then `:scheme`) so URL resolution
  // works for HTTP/2 requests, not just HTTP/1.1.
  const pseudoHeaders = request.headers as Record<string, string | string[] | undefined>;
  const host = request.headers.host ?? firstHeaderValue(pseudoHeaders[':authority']) ?? '127.0.0.1';
  const schemeOptions: { trustedProxy?: boolean } = {};
  if (options.trustedProxy !== undefined) schemeOptions.trustedProxy = options.trustedProxy;
  const proto = trustedNodeRequestScheme(request, schemeOptions);

  return `${proto}://${host}`;
}

function nodeHeadersToWebHeaders(request: IncomingMessage): Headers {
  const headers = new NativeHeaders();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    // E2 (SPEC §9.5): under Node's HTTP/2 compat API `request.headers` carries pseudo-headers
    // (`:path`/`:method`/`:authority`/`:scheme`). The web `Headers` constructor throws on any
    // name starting with `:`, so copying them unfiltered 500'd every HTTP/2 request. Skip them
    // — they are addressed via `request.method`/`request.url`/the `:authority` URL fallback.
    if (name.startsWith(':')) continue;
    if (Array.isArray(value)) {
      for (const entry of value) appendHeader(headers, name, entry);
    } else {
      setHeader(headers, name, value);
    }
  }

  return headers;
}

function responseHeadersToNodeHeaders(headers: Headers): Record<string, string | string[]> {
  // SPEC §9.4/§9.1.1: Node's writeHead accepts string[] for multi-value headers.
  // Headers.forEach combines set-cookie into one entry (comma-joined), so handle
  // it separately via getSetCookie() which preserves each cookie as a distinct value.
  const nodeHeaders: Record<string, string | string[]> = {};
  const setCookies = getSetCookieHeaders(headers);
  if (setCookies.length > 0) nodeHeaders['set-cookie'] = setCookies;
  forEachHeader(headers, (value, name) => {
    if (name === 'set-cookie') return; // already handled above
    nodeHeaders[name] = value;
  });
  return nodeHeaders;
}

function appendHeader(headers: Headers, name: string, value: string): void {
  witnessReflectApply(nativeHeadersAppend, headers, [name, value]);
}

function deleteHeader(headers: Headers, name: string): void {
  witnessReflectApply(nativeHeadersDelete, headers, [name]);
}

function forEachHeader(headers: Headers, callback: (value: string, name: string) => void): void {
  witnessReflectApply(nativeHeadersForEach, headers, [callback]);
}

function getHeader(headers: Headers, name: string): string | null {
  return witnessReflectApply(nativeHeadersGet, headers, [name]);
}

function getSetCookieHeaders(headers: Headers): string[] {
  return witnessReflectApply(nativeHeadersGetSetCookie, headers, []);
}

function hasHeader(headers: Headers, name: string): boolean {
  return witnessReflectApply(nativeHeadersHas, headers, [name]);
}

function setHeader(headers: Headers, name: string, value: string): void {
  witnessReflectApply(nativeHeadersSet, headers, [name, value]);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
