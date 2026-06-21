import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { RequestHandler } from './app-types.js';

/** Options for adapting a Web `RequestHandler` to a Node `http` listener. */
export interface NodeHandlerOptions {
  earlyHints?: boolean;
  origin?: string | ((request: IncomingMessage) => string);
}

export interface WriteWebResponseToNodeOptions {
  earlyHints?: boolean;
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
      const request = nodeRequestToWebRequest(nodeRequest, options);
      const response = await handler(request);
      const writeOptions =
        options.earlyHints === undefined ? undefined : { earlyHints: options.earlyHints };

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
  nodeRequest.once('aborted', abort);
  nodeRequest.once('close', abort);
  nodeRequest.socket?.once('close', abort);
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
  const headers = responseHeadersToNodeHeaders(response.headers);
  const earlyHints = response.headers.get('Link');

  if (
    options.earlyHints !== false &&
    earlyHints &&
    typeof nodeResponse.writeEarlyHints === 'function'
  ) {
    nodeResponse.writeEarlyHints({ link: earlyHints });
  }

  nodeResponse.writeHead(response.status, response.statusText, headers);
  if (method === 'HEAD' || response.body === null) {
    nodeResponse.end();
    return;
  }
  const responseBody = response.body;

  await new Promise<void>((resolve, reject) => {
    const source = Readable.fromWeb(responseBody as NodeReadableStream<Uint8Array>);
    // E1 (SPEC §9.5/§9.2): the head is already committed (writeHead above). A source-stream
    // error mid-body must not let the caller append error text onto the partial response —
    // tear the socket so the client sees a truncated/aborted transfer, then reject so the
    // caller's catch knows the write failed (its `headersSent` guard short-circuits).
    source
      .once('error', (error) => {
        nodeResponse.destroy(error instanceof Error ? error : undefined);
        reject(error);
      })
      .pipe(nodeResponse)
      .once('error', reject)
      .once('finish', resolve);
  });
}

function nodeRequestUrl(request: IncomingMessage, options: NodeHandlerOptions): string {
  const rawUrl = request.url ?? '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl)) return rawUrl;

  const origin =
    typeof options.origin === 'function'
      ? options.origin(request)
      : (options.origin ?? defaultOrigin(request));

  return new URL(rawUrl, origin).href;
}

function defaultOrigin(request: IncomingMessage): string {
  // E2 (SPEC §9.5): under HTTP/2 the `Host` header is often absent — the authority lives in
  // the `:authority` pseudo-header instead. Fall back to it (then `:scheme`) so URL resolution
  // works for HTTP/2 requests, not just HTTP/1.1.
  const pseudoHeaders = request.headers as Record<string, string | string[] | undefined>;
  const host =
    request.headers.host ?? firstHeaderValue(pseudoHeaders[':authority']) ?? '127.0.0.1';
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
