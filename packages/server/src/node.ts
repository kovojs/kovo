import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { RequestHandler } from './app-types.js';

export interface NodeHandlerOptions {
  earlyHints?: boolean;
  origin?: string | ((request: IncomingMessage) => string);
}

export interface WriteWebResponseToNodeOptions {
  earlyHints?: boolean;
}

export type NodeRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void> | void;

const bodylessMethods = new Set(['GET', 'HEAD']);

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
      if (!nodeResponse.headersSent) {
        nodeResponse.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
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
  const init: RequestInit = {
    headers,
    method,
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
    Readable.fromWeb(responseBody as NodeReadableStream<Uint8Array>)
      .once('error', reject)
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
  const host = request.headers.host ?? '127.0.0.1';
  const forwardedProto = firstHeaderValue(request.headers['x-forwarded-proto']);
  const proto =
    forwardedProto ?? ((request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');

  return `${proto}://${host}`;
}

function nodeHeadersToWebHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }

  return headers;
}

function responseHeadersToNodeHeaders(headers: Headers): Record<string, string> {
  const nodeHeaders: Record<string, string> = {};
  headers.forEach((value, name) => {
    nodeHeaders[name] = value;
  });
  return nodeHeaders;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
