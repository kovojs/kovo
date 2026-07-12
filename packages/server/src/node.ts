import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliCompress, createGzip } from 'node:zlib';
import {
  ServerResponse as NativeServerResponse,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { Http2ServerResponse as NativeHttp2ServerResponse } from 'node:http2';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { RequestHandler } from './app-types.js';
import { trustedNodeRequestScheme } from './request-scheme.js';
import {
  createWitnessWeakMap,
  createWitnessSet,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessReflectApply,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
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
const NativeResponse = globalThis.Response;
const NativeString = globalThis.String;
const NativeURL = globalThis.URL;
const nativeHeadersGlobalDescriptor = requiredPropertyDescriptor(globalThis, 'Headers');
const nativeRequestGlobalDescriptor = requiredPropertyDescriptor(globalThis, 'Request');
const nativeUrlGlobalDescriptor = requiredPropertyDescriptor(globalThis, 'URL');
const nativeHeadersAppend = NativeHeaders.prototype.append;
const nativeHeadersDelete = NativeHeaders.prototype.delete;
const nativeHeadersForEach = NativeHeaders.prototype.forEach;
const nativeHeadersGet = NativeHeaders.prototype.get;
const nativeHeadersGetSetCookie = NativeHeaders.prototype.getSetCookie;
const nativeHeadersHas = NativeHeaders.prototype.has;
const nativeHeadersSet = NativeHeaders.prototype.set;
const nativeResponseBodyGetter = requiredGetter(NativeResponse.prototype, 'body');
const nativeResponseHeadersGetter = requiredGetter(NativeResponse.prototype, 'headers');
const nativeResponseStatusGetter = requiredGetter(NativeResponse.prototype, 'status');
const nativeResponseStatusTextGetter = requiredGetter(NativeResponse.prototype, 'statusText');
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringFromCharCode = NativeString.fromCharCode;
const nativeRequestMethodGetter = requiredGetter(NativeRequest.prototype, 'method');
const nativeServerResponseDestroy = stablePrototypeFunction(
  NativeServerResponse.prototype,
  'destroy',
);
const nativeServerResponseEnd = stablePrototypeFunction(NativeServerResponse.prototype, 'end');
const nativeServerResponseHeadersSent = stablePrototypeGetter(
  NativeServerResponse.prototype,
  'headersSent',
);
const nativeServerResponseWriteEarlyHints = stablePrototypeFunction(
  NativeServerResponse.prototype,
  'writeEarlyHints',
);
const nativeServerResponseWriteHead = stablePrototypeFunction(
  NativeServerResponse.prototype,
  'writeHead',
);
const nativeServerResponseWrite = stablePrototypeFunction(NativeServerResponse.prototype, 'write');
const nativeHttp2ServerResponseDestroy = stablePrototypeFunction(
  NativeHttp2ServerResponse.prototype,
  'destroy',
);
const nativeHttp2ServerResponseEnd = stablePrototypeFunction(
  NativeHttp2ServerResponse.prototype,
  'end',
);
const nativeHttp2ServerResponseHeadersSent = stablePrototypeGetter(
  NativeHttp2ServerResponse.prototype,
  'headersSent',
);
const nativeHttp2ServerResponseWrite = stablePrototypeFunction(
  NativeHttp2ServerResponse.prototype,
  'write',
);
const nativeHttp2ServerResponseWriteEarlyHints = stablePrototypeFunction(
  NativeHttp2ServerResponse.prototype,
  'writeEarlyHints',
);
const nativeHttp2ServerResponseWriteHead = stablePrototypeFunction(
  NativeHttp2ServerResponse.prototype,
  'writeHead',
);
const nativeReadableFromWeb = Readable.fromWeb;
const nativePipeline = pipeline;
const nativeCreateBrotliCompress = createBrotliCompress;
const nativeCreateGzip = createGzip;
const nativeUrlHashGetter = requiredGetter(NativeURL.prototype, 'hash');
const nativeUrlHrefGetter = requiredGetter(NativeURL.prototype, 'href');
const nativeUrlOriginGetter = requiredGetter(NativeURL.prototype, 'origin');
const nativeUrlPathnameGetter = requiredGetter(NativeURL.prototype, 'pathname');
const nativeUrlSearchGetter = requiredGetter(NativeURL.prototype, 'search');

const bodylessMethods = createWitnessSet<string>();
witnessSetAdd(bodylessMethods, 'GET');
witnessSetAdd(bodylessMethods, 'HEAD');
const requestPeerAddressProperty = '__kovoPeerAddress';
const requestTargetAnalysisOrigin = 'https://kovo.invalid';
const nodeResponseTransports = createWitnessWeakMap<ServerResponse, NodeResponseTransport>();

function requiredPropertyDescriptor(value: object, property: PropertyKey): PropertyDescriptor {
  const propertyDescriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (propertyDescriptor === undefined) {
    throw new TypeError('Kovo Node adapter requires intact web platform constructors.');
  }
  return propertyDescriptor;
}

function requiredGetter(value: object, property: PropertyKey): () => unknown {
  const intrinsicGetter = witnessGetOwnPropertyDescriptor(value, property)?.get;
  if (intrinsicGetter === undefined) {
    throw new TypeError('Kovo Node adapter requires intact URL intrinsic accessors.');
  }
  return intrinsicGetter;
}

function stablePrototypeFunction(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError('Kovo Node response transport control is unavailable.');
      }
      return descriptor.value;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  throw new TypeError('Kovo Node response transport control is unavailable.');
}

function stablePrototypeGetter(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (typeof descriptor.get !== 'function') {
        throw new TypeError('Kovo Node response transport getter is unavailable.');
      }
      return descriptor.get;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  throw new TypeError('Kovo Node response transport getter is unavailable.');
}

interface NodeResponseTransport {
  readonly destroy?: Function;
  readonly end: Function;
  readonly headersSent: Function;
  readonly writeEarlyHints?: Function;
  readonly writeHead: Function;
  readonly write?: Function;
}

const nativeHttp1ResponseTransport: NodeResponseTransport = {
  destroy: nativeServerResponseDestroy,
  end: nativeServerResponseEnd,
  headersSent: nativeServerResponseHeadersSent,
  write: nativeServerResponseWrite,
  writeEarlyHints: nativeServerResponseWriteEarlyHints,
  writeHead: nativeServerResponseWriteHead,
};
const nativeHttp2ResponseTransport: NodeResponseTransport = {
  destroy: nativeHttp2ServerResponseDestroy,
  end: nativeHttp2ServerResponseEnd,
  headersSent: nativeHttp2ServerResponseHeadersSent,
  write: nativeHttp2ServerResponseWrite,
  writeEarlyHints: nativeHttp2ServerResponseWriteEarlyHints,
  writeHead: nativeHttp2ServerResponseWriteHead,
};

function pinNodeResponseTransport(response: ServerResponse): NodeResponseTransport {
  const existing = witnessWeakMapGet(nodeResponseTransports, response);
  if (existing !== undefined) return existing;
  const nativeTransport = nativeResponseTransport(response);
  const destroy = selectNodeResponseFunction(response, 'destroy', nativeTransport?.destroy);
  const write = selectNodeResponseFunction(response, 'write', nativeTransport?.write);
  const writeEarlyHints = selectNodeResponseFunction(
    response,
    'writeEarlyHints',
    nativeTransport?.writeEarlyHints,
  );
  const transport: NodeResponseTransport = {
    ...(destroy === undefined ? {} : { destroy }),
    end: requiredNodeResponseFunction(response, 'end', nativeTransport?.end),
    headersSent:
      nativeTransport?.headersSent ??
      function ownHeadersSent(this: ServerResponse): boolean {
        return witnessGetOwnPropertyDescriptor(this, 'headersSent')?.value === true;
      },
    ...(writeEarlyHints === undefined ? {} : { writeEarlyHints }),
    writeHead: requiredNodeResponseFunction(response, 'writeHead', nativeTransport?.writeHead),
    ...(write === undefined ? {} : { write }),
  };
  if (nativeTransport !== undefined) pinNativeNodeResponseMethods(response, transport);
  witnessWeakMapSet(nodeResponseTransports, response, transport);
  return transport;
}

function nativeResponseTransport(response: ServerResponse): NodeResponseTransport | undefined {
  let current: object | null = response;
  for (let depth = 0; current !== null && depth < 16; depth += 1) {
    if (current === NativeServerResponse.prototype) return nativeHttp1ResponseTransport;
    if (current === NativeHttp2ServerResponse.prototype) return nativeHttp2ResponseTransport;
    current = witnessGetPrototypeOf(current);
  }
  return undefined;
}

function pinNativeNodeResponseMethods(
  response: ServerResponse,
  transport: NodeResponseTransport,
): void {
  pinNativeNodeResponseMethod(response, 'destroy', transport.destroy);
  pinNativeNodeResponseMethod(response, 'end', transport.end);
  pinNativeNodeResponseMethod(response, 'write', transport.write);
  pinNativeNodeResponseMethod(response, 'writeEarlyHints', transport.writeEarlyHints);
  pinNativeNodeResponseMethod(response, 'writeHead', transport.writeHead);
}

function pinNativeNodeResponseMethod(
  response: ServerResponse,
  property: PropertyKey,
  value: Function | undefined,
): void {
  if (value === undefined || witnessGetOwnPropertyDescriptor(response, property) !== undefined)
    return;
  witnessDefineProperty(response, property, {
    configurable: true,
    value,
    writable: false,
  });
}

function selectNodeResponseFunction(
  response: ServerResponse,
  property: PropertyKey,
  nativeFunction: Function | undefined,
): Function | undefined {
  const own = witnessGetOwnPropertyDescriptor(response, property);
  if (own !== undefined && 'value' in own && typeof own.value === 'function') return own.value;
  return nativeFunction;
}

function requiredNodeResponseFunction(
  response: ServerResponse,
  property: PropertyKey,
  nativeFunction: Function | undefined,
): Function {
  const selected = selectNodeResponseFunction(response, property, nativeFunction);
  if (selected === undefined) {
    throw new TypeError(`Kovo Node response transport ${String(property)} is unavailable.`);
  }
  return selected;
}

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
    const responseTransport = pinNodeResponseTransport(nodeResponse);
    try {
      if (rejectUnsafeNodeMutationTarget(nodeRequest, nodeResponse)) return;
      const request = nodeRequestToWebRequest(nodeRequest, options, nodeResponse);
      const requestMethod = witnessReflectApply<string>(nativeRequestMethodGetter, request, []);
      // L16-2 (RFC 8297): thread the request's HTTP version so 103 Early Hints is gated to
      // HTTP/1.1+ clients (an HTTP/1.0 peer cannot parse interim 1xx responses).
      const acceptEncoding = firstHeaderValue(nodeRequest.headers['accept-encoding']);
      const writeOptions: WriteWebResponseToNodeOptions = {
        ...(acceptEncoding === undefined ? {} : { acceptEncoding }),
        ...(options.compression === undefined ? {} : { compression: options.compression }),
        ...(options.earlyHints === undefined ? {} : { earlyHints: options.earlyHints }),
        httpVersion: nodeRequest.httpVersion,
      };

      const response = await handler(request);
      armIncompleteNodeRequestClose(nodeRequest, nodeResponse);

      await writeWebResponseToNode(response, nodeResponse, requestMethod, writeOptions);
    } catch {
      // E1 (SPEC §9.5/§9.2): once the response head is committed (`headersSent`), a 200's
      // status/body are already on the wire. Appending "Internal Server Error" here would
      // corrupt that committed body (a mid-stream render error yielding HTTP 200
      // "partial-Internal Server Error"). Tear the socket instead so the client observes a
      // truncated/aborted transfer rather than a clean 200 carrying injected error text.
      if (witnessReflectApply<boolean>(responseTransport.headersSent, nodeResponse, [])) {
        if (responseTransport.destroy !== undefined) {
          witnessReflectApply(responseTransport.destroy, nodeResponse, []);
        }
        return;
      }
      armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
      witnessReflectApply(responseTransport.writeHead, nodeResponse, [
        500,
        { 'Content-Type': 'text/plain; charset=utf-8' },
      ]);
      witnessReflectApply(responseTransport.end, nodeResponse, ['Internal Server Error']);
    }
  };
}

export function nodeRequestToWebRequest(
  nodeRequest: IncomingMessage,
  options: NodeHandlerOptions = {},
  nodeResponse?: ServerResponse,
): Request {
  if (nodeResponse !== undefined) pinNodeResponseTransport(nodeResponse);
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
  const responseTransport = pinNodeResponseTransport(nodeResponse);
  // SPEC §6.6 rule 5: the final transport pins the complete Response once. Authored code may
  // share this realm, so no status/header/body getter is re-read after this boundary decision.
  const pinnedResponse = snapshotWebResponse(response);
  const compression = responseCompression(pinnedResponse, options, method);
  const responseHeaders = pinnedResponse.headers;
  if (nodeResponse.shouldKeepAlive === false && options.httpVersion !== '2.0') {
    setHeader(responseHeaders, 'Connection', 'close');
  }
  if (compression) {
    setHeader(responseHeaders, 'Content-Encoding', compression);
    deleteHeader(responseHeaders, 'Content-Length');
    appendVary(responseHeaders, 'Accept-Encoding');
  }
  const headers = responseHeadersToNodeHeaders(responseHeaders);
  const earlyHints = getHeader(responseHeaders, 'Link');

  if (
    options.earlyHints !== false &&
    earlyHints &&
    responseTransport.writeEarlyHints !== undefined &&
    // L16-2 (RFC 8297): 103 Early Hints is HTTP/1.1+; an HTTP/1.0 client cannot parse a 1xx
    // interim response, so emitting one desynchronizes the connection. Suppress for '1.0'.
    options.httpVersion !== '1.0'
  ) {
    witnessReflectApply(responseTransport.writeEarlyHints, nodeResponse, [
      { link: nodeEarlyHintsLinkValue(earlyHints) },
    ]);
  }

  witnessReflectApply(responseTransport.writeHead, nodeResponse, [
    pinnedResponse.status,
    pinnedResponse.statusText,
    headers,
  ]);
  if (method === 'HEAD' || pinnedResponse.body === null) {
    witnessReflectApply(responseTransport.end, nodeResponse, []);
    return;
  }
  const source = witnessReflectApply<Readable>(nativeReadableFromWeb, Readable, [
    pinnedResponse.body as NodeReadableStream<Uint8Array>,
  ]);
  // E1 (SPEC §9.5/§9.2): the head is already committed (writeHead above). A source-stream
  // error mid-body must not let the caller append error text onto the partial response —
  // tear the socket so the client sees a truncated/aborted transfer, then reject so the
  // caller's catch knows the write failed (its `headersSent` guard short-circuits).
  if (compression === 'br') {
    await nativePipeline(source, nativeCreateBrotliCompress(), nodeResponse);
  } else if (compression === 'gzip') {
    await nativePipeline(source, nativeCreateGzip(), nodeResponse);
  } else {
    await nativePipeline(source, nodeResponse);
  }
}

interface PinnedWebResponse {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly headers: Headers;
  readonly status: number;
  readonly statusText: string;
}

function snapshotWebResponse(response: Response): PinnedWebResponse {
  const sourceHeaders = witnessReflectApply<Headers>(nativeResponseHeadersGetter, response, []);
  const headers = new NativeHeaders();
  forEachHeader(sourceHeaders, (value, name) => {
    if (name !== 'set-cookie') setHeader(headers, name, value);
  });
  const setCookies = getSetCookieHeaders(sourceHeaders);
  for (let index = 0; index < setCookies.length; index += 1) {
    appendHeader(headers, 'set-cookie', setCookies[index]!);
  }
  return {
    body: witnessReflectApply<ReadableStream<Uint8Array> | null>(
      nativeResponseBodyGetter,
      response,
      [],
    ),
    headers,
    status: witnessReflectApply<number>(nativeResponseStatusGetter, response, []),
    statusText: witnessReflectApply<string>(nativeResponseStatusTextGetter, response, []),
  };
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

  const responseTransport = pinNodeResponseTransport(nodeResponse);
  armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
  witnessReflectApply(responseTransport.writeHead, nodeResponse, [
    404,
    {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  ]);
  witnessReflectApply(responseTransport.end, nodeResponse, ['Not Found']);
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
    if (character === undefined) return false;
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
  response: PinnedWebResponse,
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
  if (
    cacheControlHasDirective(cacheControl, 'no-transform') ||
    cacheControlHasDirective(cacheControl, 'no-store') ||
    cacheControlHasDirective(cacheControl, 'private')
  ) {
    return true;
  }
  if (hasHeader(headers, 'Set-Cookie')) return true;
  const vary = getHeader(headers, 'Vary') ?? '';
  return commaSeparatedTokenContains(vary, 'cookie');
}

function preferredCompression(acceptEncoding: string): 'br' | 'gzip' | undefined {
  const encodings = parseAcceptEncoding(acceptEncoding);
  const wildcard = encodings.wildcard ?? 0;
  const br = encodings.br ?? wildcard;
  const gzip = encodings.gzip ?? wildcard;
  if (br <= 0 && gzip <= 0) return undefined;
  return br >= gzip && br > 0 ? 'br' : 'gzip';
}

interface ParsedAcceptEncoding {
  br?: number;
  gzip?: number;
  wildcard?: number;
}

function parseAcceptEncoding(value: string): ParsedAcceptEncoding {
  const encodings: ParsedAcceptEncoding = {
    br: undefined,
    gzip: undefined,
    wildcard: undefined,
  };
  let entryStart = 0;
  while (entryStart <= value.length) {
    const entryEnd = findAscii(value, ',', entryStart);
    const boundedEnd = entryEnd < 0 ? value.length : entryEnd;
    const semicolon = findAscii(value, ';', entryStart, boundedEnd);
    const nameEnd = semicolon < 0 ? boundedEnd : semicolon;
    const name = asciiLower(trimAsciiRange(value, entryStart, nameEnd));
    let quality = 1000;
    let parameterStart = semicolon < 0 ? boundedEnd : semicolon + 1;
    while (parameterStart < boundedEnd) {
      const nextSemicolon = findAscii(value, ';', parameterStart, boundedEnd);
      const parameterEnd = nextSemicolon < 0 ? boundedEnd : nextSemicolon;
      const equals = findAscii(value, '=', parameterStart, parameterEnd);
      if (equals >= 0) {
        const key = asciiLower(trimAsciiRange(value, parameterStart, equals));
        if (key === 'q')
          quality = parseEncodingQuality(trimAsciiRange(value, equals + 1, parameterEnd));
      }
      parameterStart = parameterEnd + 1;
    }
    if (name === 'br') encodings.br = quality;
    else if (name === 'gzip') encodings.gzip = quality;
    else if (name === '*') encodings.wildcard = quality;
    if (entryEnd < 0) break;
    entryStart = entryEnd + 1;
  }
  return encodings;
}

function parseEncodingQuality(value: string): number {
  if (value === '0' || value === '0.') return 0;
  if (value === '1' || value === '1.') return 1000;
  if (value.length < 3 || value[1] !== '.' || value.length > 5) return 0;
  if (value[0] === '1') {
    for (let index = 2; index < value.length; index += 1) {
      if (value[index] !== '0') return 0;
    }
    return 1000;
  }
  if (value[0] !== '0') return 0;
  let quality = 0;
  let scale = 100;
  for (let index = 2; index < value.length; index += 1) {
    const character = value[index];
    if (character === undefined || character < '0' || character > '9') return 0;
    quality += (stringCharCodeAt(character, 0) - 48) * scale;
    scale /= 10;
  }
  return quality;
}

function cacheControlHasDirective(value: string, directive: string): boolean {
  let start = 0;
  while (start <= value.length) {
    const comma = findAscii(value, ',', start);
    const end = comma < 0 ? value.length : comma;
    let nameStart = start;
    while (nameStart < end && asciiWhitespace(value[nameStart])) nameStart += 1;
    let nameEnd = nameStart;
    while (nameEnd < end) {
      const character = value[nameEnd];
      if (character === '=' || character === ';' || character === ' ' || character === '\t') {
        break;
      }
      nameEnd += 1;
    }
    if (asciiLower(trimAsciiRange(value, nameStart, nameEnd)) === directive) return true;
    if (comma < 0) return false;
    start = comma + 1;
  }
  return false;
}

function commaSeparatedTokenContains(value: string, expected: string): boolean {
  let start = 0;
  while (start <= value.length) {
    const comma = findAscii(value, ',', start);
    const end = comma < 0 ? value.length : comma;
    if (asciiLower(trimAsciiRange(value, start, end)) === expected) return true;
    if (comma < 0) return false;
    start = comma + 1;
  }
  return false;
}

function findAscii(value: string, expected: string, start: number, limit = value.length): number {
  for (let index = start; index < limit; index += 1) {
    if (value[index] === expected) return index;
  }
  return -1;
}

function trimAsciiRange(value: string, start: number, end: number): string {
  while (start < end && asciiWhitespace(value[start])) start += 1;
  while (end > start && asciiWhitespace(value[end - 1])) end -= 1;
  let result = '';
  for (let index = start; index < end; index += 1) result += value[index];
  return result;
}

function asciiWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\t' || value === '\r' || value === '\n';
}

function asciiLower(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    result +=
      character >= 'A' && character <= 'Z'
        ? witnessReflectApply<string>(nativeStringFromCharCode, NativeString, [
            stringCharCodeAt(character, 0) + 32,
          ])
        : character;
  }
  return result;
}

function stringCharCodeAt(value: string, index: number): number {
  return witnessReflectApply(nativeStringCharCodeAt, value, [index]);
}

function stringStartsWith(value: string, prefix: string): boolean {
  if (prefix.length > value.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (value[index] !== prefix[index]) return false;
  }
  return true;
}

function stringEndsWith(value: string, suffix: string): boolean {
  if (suffix.length > value.length) return false;
  const offset = value.length - suffix.length;
  for (let index = 0; index < suffix.length; index += 1) {
    if (value[offset + index] !== suffix[index]) return false;
  }
  return true;
}

function isCompressibleContentType(contentType: string): boolean {
  const semicolon = findAscii(contentType, ';', 0);
  const type = asciiLower(
    trimAsciiRange(contentType, 0, semicolon < 0 ? contentType.length : semicolon),
  );
  return (
    stringStartsWith(type, 'text/') ||
    type === 'application/javascript' ||
    type === 'application/json' ||
    type === 'application/ld+json' ||
    type === 'application/manifest+json' ||
    type === 'application/x-javascript' ||
    type === 'application/xhtml+xml' ||
    type === 'application/xml' ||
    type === 'image/svg+xml' ||
    stringEndsWith(type, '+json') ||
    stringEndsWith(type, '+xml')
  );
}

function appendVary(headers: Headers, token: string): void {
  const existing = getHeader(headers, 'Vary');
  if (!existing) {
    setHeader(headers, 'Vary', token);
    return;
  }
  if (!commaSeparatedTokenContains(existing, asciiLower(token))) {
    setHeader(headers, 'Vary', `${existing}, ${token}`);
  }
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
  return witnessIsArray(value) ? value[0] : value;
}
