import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliCompress, createGzip } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { RequestHandler } from './app-types.js';

/** Options for adapting a Web `RequestHandler` to a Node `http` listener. */
export interface NodeHandlerOptions {
  /** Compress eligible text responses by default; set `false` to opt out. */
  compression?: boolean;
  earlyHints?: boolean;
  origin?: string | ((request: IncomingMessage) => string);
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

const bodylessMethods = new Set(['GET', 'HEAD']);

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
      const request = nodeRequestToWebRequest(nodeRequest, options, nodeResponse);
      const response = await handler(request);
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
    ...(bodylessMethods.has(method)
      ? {}
      : {
          body: Readable.toWeb(nodeRequest) as ReadableStream<Uint8Array>,
          duplex: 'half',
        }),
  };

  return new Request(nodeRequestUrl(nodeRequest, options), init);
}

export async function writeWebResponseToNode(
  response: Response,
  nodeResponse: ServerResponse,
  method = 'GET',
  options: WriteWebResponseToNodeOptions = {},
): Promise<void> {
  const compression = responseCompression(response, options, method);
  const responseHeaders = new Headers(response.headers);
  if (compression) {
    responseHeaders.set('Content-Encoding', compression);
    responseHeaders.delete('Content-Length');
    appendVary(responseHeaders, 'Accept-Encoding');
  }
  const headers = responseHeadersToNodeHeaders(responseHeaders);
  const earlyHints = response.headers.get('Link');

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

function responseCompression(
  response: Response,
  options: WriteWebResponseToNodeOptions,
  method: string,
): 'br' | 'gzip' | undefined {
  if (options.compression === false) return undefined;
  if (method === 'HEAD' || response.body === null) return undefined;
  if (response.status === 204 || response.status === 304) return undefined;
  if (response.headers.has('Content-Encoding')) return undefined;
  if (/\bno-transform\b/i.test(response.headers.get('Cache-Control') ?? '')) return undefined;
  if (!isCompressibleContentType(response.headers.get('Content-Type') ?? '')) return undefined;
  return preferredCompression(options.acceptEncoding ?? '');
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
  const existing = headers.get('Vary');
  if (!existing) {
    headers.set('Vary', token);
    return;
  }
  const tokens = existing.split(',').map((entry) => entry.trim().toLowerCase());
  if (!tokens.includes(token.toLowerCase())) headers.set('Vary', `${existing}, ${token}`);
}

function nodeRequestUrl(request: IncomingMessage, options: NodeHandlerOptions): string {
  const rawUrl = request.url ?? '/';
  const origin =
    typeof options.origin === 'function'
      ? options.origin(request)
      : (options.origin ?? defaultOrigin(request));

  if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl)) {
    const absolute = new URL(rawUrl);
    return new URL(`${absolute.pathname}${absolute.search}${absolute.hash}`, origin).href;
  }

  const pathOnly = rawUrl.startsWith('//') ? `/${rawUrl.replace(/^\/+/, '')}` : rawUrl;
  return new URL(pathOnly, origin).href;
}

function defaultOrigin(request: IncomingMessage): string {
  // E2 (SPEC §9.5): under HTTP/2 the `Host` header is often absent — the authority lives in
  // the `:authority` pseudo-header instead. Fall back to it (then `:scheme`) so URL resolution
  // works for HTTP/2 requests, not just HTTP/1.1.
  const pseudoHeaders = request.headers as Record<string, string | string[] | undefined>;
  const host = request.headers.host ?? firstHeaderValue(pseudoHeaders[':authority']) ?? '127.0.0.1';
  const forwardedProto = firstHeaderValue(request.headers['x-forwarded-proto']);
  const pseudoScheme = firstHeaderValue(pseudoHeaders[':scheme']);
  const proto =
    forwardedProto ??
    pseudoScheme ??
    ((request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');

  return `${proto}://${host}`;
}

function nodeHeadersToWebHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    // E2 (SPEC §9.5): under Node's HTTP/2 compat API `request.headers` carries pseudo-headers
    // (`:path`/`:method`/`:authority`/`:scheme`). The web `Headers` constructor throws on any
    // name starting with `:`, so copying them unfiltered 500'd every HTTP/2 request. Skip them
    // — they are addressed via `request.method`/`request.url`/the `:authority` URL fallback.
    if (name.startsWith(':')) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }

  return headers;
}

function responseHeadersToNodeHeaders(headers: Headers): Record<string, string | string[]> {
  // SPEC §9.4/§9.1.1: Node's writeHead accepts string[] for multi-value headers.
  // Headers.forEach combines set-cookie into one entry (comma-joined), so handle
  // it separately via getSetCookie() which preserves each cookie as a distinct value.
  const nodeHeaders: Record<string, string | string[]> = {};
  const setCookies = headers.getSetCookie();
  if (setCookies.length > 0) nodeHeaders['set-cookie'] = setCookies;
  headers.forEach((value, name) => {
    if (name === 'set-cookie') return; // already handled above
    nodeHeaders[name] = value;
  });
  return nodeHeaders;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function nodeEarlyHintsLinkValue(header: string): string | string[] {
  const entries = splitLinkHeaderEntries(header);
  return entries.length > 1 ? entries : header;
}

function splitLinkHeaderEntries(header: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let inQuote = false;
  let escaped = false;

  for (let index = 0; index < header.length; index += 1) {
    const char = header[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inQuote && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (char !== ',' || inQuote) continue;

    const entry = header.slice(start, index).trim();
    if (entry) entries.push(entry);
    start = index + 1;
  }

  const tail = header.slice(start).trim();
  if (tail) entries.push(tail);
  return entries;
}
