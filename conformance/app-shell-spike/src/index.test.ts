import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { Buffer } from 'node:buffer';

import { afterEach, describe, expect, it } from 'vitest';

const fixtureDirectory = new URL('../../../fixtures/wire/', import.meta.url);
const requestMarker = '>>> REQUEST';
const responseMarker = '<<< RESPONSE';
const moduleBody = 'export function Cart$removeItem(event, ctx) { ctx.signal.throwIfAborted(); }\n';

type FixtureExchange = {
  request: FixtureRequest;
  response: FixtureResponse;
};

type FixtureRequest = {
  body: string;
  headers: Array<readonly [string, string]>;
  method: string;
  path: string;
};

type FixtureResponse = {
  body: string;
  headers: Array<readonly [string, string]>;
  status: number;
  statusLine: string;
  statusText: string;
};

type LiveResponse = {
  body: string;
  chunks: string[];
  headers: Map<string, string>;
  rawBody: Buffer;
  statusLine: string;
};

type PrototypeDispatch = {
  key: string;
  request: Request;
};

type RequestInitWithDuplex = RequestInit & {
  duplex?: 'half';
};

const openServers: Array<{ close: () => void }> = [];

afterEach(async () => {
  while (openServers.length > 0) {
    const server = openServers.pop();
    if (!server) {
      continue;
    }

    server.close();
  }
});

describe('app shell S8 request-shell spike', () => {
  it.each([
    'enhanced-mutation.http',
    'no-js-post-redirect-get.http',
    'typed-read.http',
    'validation-422-fragment.http',
  ])('serves %s over real HTTP with fixture parity', async (fixtureName) => {
    const exchanges = await readFixtureExchanges(fixtureName);
    const server = await startPrototypeServer();

    for (const exchange of exchanges) {
      const live = await requestOverSocket(server.origin, exchange.request);

      expect(live.statusLine).toBe(exchange.response.statusLine);
      expectHeaderSubset(live.headers, exchange.response.headers);
      expect(live.body).toBe(exchange.response.body);
    }
  });

  it('streams the deferred fixture over HTTP/1.1 without collapsing chunk boundaries', async () => {
    const [exchange] = await readFixtureExchanges('defer-stream.http');
    if (!exchange) {
      throw new Error('defer-stream.http must contain one exchange');
    }
    const server = await startPrototypeServer();
    const live = await requestOverSocket(server.origin, exchange.request);
    const [shellChunk, lateChunk] = deferredFixtureChunks(exchange.response.body);

    expect(live.statusLine).toBe(exchange.response.statusLine);
    expectHeaderSubset(live.headers, exchange.response.headers);
    expect(live.body).toBe(exchange.response.body);
    expect(live.headers.get('transfer-encoding')).toBe('chunked');
    expect(live.chunks).toEqual([shellChunk, lateChunk]);
  });

  it('loads a versioned /c/ module over the same closed dispatch path', async () => {
    const server = await startPrototypeServer();
    const response = await fetch(`${server.origin}/c/cart.client.js?v=s8`, {
      headers: {
        Accept: 'text/javascript',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');

    const source = await response.text();
    expect(source).toBe(moduleBody);

    const encodedModule = Buffer.from(source).toString('base64url');
    const loaded = (await import(`data:text/javascript;base64,${encodedModule}`)) as {
      Cart$removeItem?: unknown;
    };

    expect(typeof loaded.Cart$removeItem).toBe('function');
  });
});

async function startPrototypeServer(): Promise<{ origin: string }> {
  const server = createServer(async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    outgoing.sendDate = false;

    try {
      const dispatch = await toDispatch(incoming);
      const response = await dispatchPrototype(dispatch);

      await writeNodeResponse(outgoing, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown S8 spike error';
      outgoing.writeHead(500, 'Internal Server Error', {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      outgoing.end(message);
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  openServers.push(server);

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected an IPv4 loopback test server address');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function toDispatch(incoming: IncomingMessage): Promise<PrototypeDispatch> {
  const host = incoming.headers.host;
  if (!host) {
    throw new Error('Missing Host header');
  }

  const method = incoming.method ?? 'GET';
  const url = new URL(incoming.url ?? '/', `http://${host}`);
  const body: ArrayBuffer | undefined =
    method === 'GET' || method === 'HEAD' ? undefined : await readIncomingBody(incoming);
  const requestInit: RequestInitWithDuplex = {
    headers: nodeHeadersToWebHeaders(incoming),
    method,
  };
  if (body) {
    requestInit.body = body;
    requestInit.duplex = 'half';
  }
  const request = new Request(url, requestInit);

  return {
    key: dispatchKey(method, url),
    request,
  };
}

async function dispatchPrototype(dispatch: PrototypeDispatch): Promise<Response> {
  if (dispatch.key === 'GET /c/cart.client.js') {
    return new Response(moduleBody, {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': 'text/javascript; charset=utf-8',
      },
      status: 200,
      statusText: 'OK',
    });
  }

  if (dispatch.key === 'GET /products/p1') {
    const body = responseBody(await readFixtureExchanges('defer-stream.http'), dispatch.key);
    const [shellChunk, lateChunk] = deferredFixtureChunks(body);

    return new Response(chunksToStream([shellChunk, lateChunk]), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
      status: 200,
      statusText: 'OK',
    });
  }

  if (dispatch.key === 'GET /_q/product?id=p1') {
    return fixtureResponse('typed-read.http', dispatch.key);
  }

  if (dispatch.key === 'POST /_m/cart/add') {
    const formBody = await dispatch.request.text();
    const fixtureName = formBody.includes('quantity=99')
      ? 'validation-422-fragment.http'
      : 'enhanced-mutation.http';

    return fixtureResponse(fixtureName, dispatch.key);
  }

  if (dispatch.key === 'POST /cart/add') {
    return fixtureResponse('no-js-post-redirect-get.http', dispatch.key);
  }

  if (dispatch.key === 'GET /cart') {
    return fixtureResponse('no-js-post-redirect-get.http', dispatch.key);
  }

  return new Response('Not Found', {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
    status: 404,
    statusText: 'Not Found',
  });
}

function dispatchKey(method: string, url: URL): string {
  if (url.pathname === '/_q/product') {
    return `${method} ${url.pathname}${url.search}`;
  }

  return `${method} ${url.pathname}`;
}

async function fixtureResponse(fixtureName: string, key: string): Promise<Response> {
  const exchanges = await readFixtureExchanges(fixtureName);
  const fixture = exchanges.find((exchange) => dispatchKeyForFixture(exchange.request) === key);

  if (!fixture) {
    throw new Error(`No fixture exchange for ${key} in ${fixtureName}`);
  }

  return new Response(fixture.response.body, {
    headers: Object.fromEntries(fixture.response.headers),
    status: fixture.response.status,
    statusText: fixture.response.statusText,
  });
}

function responseBody(exchanges: FixtureExchange[], key: string): string {
  const exchange = exchanges.find((entry) => dispatchKeyForFixture(entry.request) === key);
  if (!exchange) {
    throw new Error(`No fixture exchange for ${key}`);
  }

  return exchange.response.body;
}

async function writeNodeResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.statusCode = response.status;
  outgoing.statusMessage = response.statusText;

  for (const [name, value] of response.headers) {
    outgoing.setHeader(name, value);
  }

  if (!response.body) {
    outgoing.end();
    return;
  }

  for await (const chunk of response.body) {
    outgoing.write(chunk);
  }

  outgoing.end();
}

async function requestOverSocket(origin: string, request: FixtureRequest): Promise<LiveResponse> {
  const url = new URL(origin);
  const port = Number(url.port);
  const socket = net.createConnection({ host: url.hostname, port });
  const chunks: Buffer[] = [];

  socket.write(serializeRequest(url.host, request));

  socket.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.from(chunk));
  });

  await once(socket, 'close');

  return parseLiveResponse(Buffer.concat(chunks));
}

function serializeRequest(host: string, request: FixtureRequest): string {
  const headers = fixtureHeadersToHeaders(request.headers);
  headers.set('Host', host);
  headers.set('Connection', 'close');

  if (request.body.length > 0) {
    headers.set('Content-Length', Buffer.byteLength(request.body).toString());
  }

  const lines = [`${request.method} ${request.path} HTTP/1.1`];
  for (const [name, value] of headers) {
    lines.push(`${name}: ${value}`);
  }

  return `${lines.join('\r\n')}\r\n\r\n${request.body}`;
}

function nodeHeadersToWebHeaders(incoming: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  return headers;
}

async function readIncomingBody(incoming: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of incoming) {
    chunks.push(Buffer.from(chunk));
  }

  const buffer = Buffer.concat(chunks);

  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function fixtureHeadersToHeaders(headerEntries: Array<readonly [string, string]>): Headers {
  const headers = new Headers();

  for (const [name, value] of headerEntries) {
    headers.set(name, value);
  }

  return headers;
}

function parseLiveResponse(raw: Buffer): LiveResponse {
  const headerEnd = raw.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    throw new Error('Raw HTTP response is missing header terminator');
  }

  const headerText = raw.subarray(0, headerEnd).toString('utf8');
  const rawBody = raw.subarray(headerEnd + 4);
  const [statusLine, ...headerLines] = headerText.split('\r\n');
  if (!statusLine) {
    throw new Error('Raw HTTP response is missing status line');
  }

  const headers = new Map<string, string>();
  for (const line of headerLines) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      throw new Error(`Malformed response header: ${line}`);
    }
    headers.set(line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim());
  }

  const transferEncoding = headers.get('transfer-encoding');
  const chunks =
    transferEncoding === 'chunked' ? decodeChunkedBody(rawBody) : [rawBody.toString('utf8')];

  return {
    body: chunks.join(''),
    chunks,
    headers,
    rawBody,
    statusLine,
  };
}

function decodeChunkedBody(rawBody: Buffer): string[] {
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < rawBody.length) {
    const lineEnd = rawBody.indexOf('\r\n', cursor);
    if (lineEnd === -1) {
      throw new Error('Malformed chunked body: missing size line terminator');
    }

    const size = Number.parseInt(rawBody.subarray(cursor, lineEnd).toString('ascii'), 16);
    if (Number.isNaN(size)) {
      throw new Error('Malformed chunked body: invalid chunk size');
    }

    cursor = lineEnd + 2;

    if (size === 0) {
      return chunks;
    }

    chunks.push(rawBody.subarray(cursor, cursor + size).toString('utf8'));
    cursor += size + 2;
  }

  throw new Error('Malformed chunked body: missing terminal chunk');
}

function chunksToStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function deferredFixtureChunks(body: string): [string, string] {
  const boundaryIndex = body.indexOf('--jiso-boundary');
  if (boundaryIndex === -1) {
    throw new Error('Deferred fixture is missing the jiso boundary');
  }

  return [body.slice(0, boundaryIndex), body.slice(boundaryIndex)];
}

async function readFixtureExchanges(fixtureName: string): Promise<FixtureExchange[]> {
  const fixture = await readFile(new URL(fixtureName, fixtureDirectory), 'utf8');
  const exchanges: FixtureExchange[] = [];
  let cursor = 0;

  while (true) {
    const requestStart = fixture.indexOf(requestMarker, cursor);
    if (requestStart === -1) {
      return exchanges;
    }

    const requestBodyStart = fixture.indexOf('\n', requestStart);
    const responseStart = fixture.indexOf(responseMarker, requestBodyStart);
    if (requestBodyStart === -1 || responseStart === -1) {
      throw new Error(`${fixtureName} contains an incomplete request/response pair`);
    }

    const responseBodyStart = fixture.indexOf('\n', responseStart);
    const nextRequestStart = fixture.indexOf(`\n${requestMarker}`, responseBodyStart);
    if (responseBodyStart === -1) {
      throw new Error(`${fixtureName} response marker is missing a status line`);
    }

    const requestBlock = fixture.slice(requestBodyStart + 1, responseStart).trimEnd();
    const responseBlock =
      nextRequestStart === -1
        ? fixture.slice(responseBodyStart + 1)
        : fixture.slice(responseBodyStart + 1, nextRequestStart);

    exchanges.push({
      request: parseFixtureRequest(requestBlock),
      response: parseFixtureResponse(responseBlock),
    });

    cursor = nextRequestStart === -1 ? fixture.length : nextRequestStart + 1;
  }
}

function parseFixtureRequest(block: string): FixtureRequest {
  const separator = block.indexOf('\n\n');
  const head = separator === -1 ? block : block.slice(0, separator);
  const body = separator === -1 ? '' : block.slice(separator + 2);
  const [requestLine, ...headerLines] = head.split('\n');
  if (!requestLine) {
    throw new Error('Fixture request is missing request line');
  }

  const [method, path] = requestLine.split(' ');
  if (!method || !path) {
    throw new Error(`Malformed fixture request line: ${requestLine}`);
  }

  return {
    body,
    headers: parseHeaderLines(headerLines),
    method,
    path,
  };
}

function parseFixtureResponse(block: string): FixtureResponse {
  const separator = block.indexOf('\n\n');
  const head = separator === -1 ? block.trimEnd() : block.slice(0, separator);
  const body = separator === -1 ? '' : block.slice(separator + 2);
  const [statusLine, ...headerLines] = head.split('\n');
  if (!statusLine) {
    throw new Error('Fixture response is missing status line');
  }

  const statusMatch = /^HTTP\/1\.1 (?<status>\d{3}) (?<statusText>.+)$/.exec(statusLine);
  if (!statusMatch?.groups) {
    throw new Error(`Malformed fixture status line: ${statusLine}`);
  }
  const status = statusMatch.groups.status;
  const statusText = statusMatch.groups.statusText;
  if (!status || !statusText) {
    throw new Error(`Malformed fixture status line: ${statusLine}`);
  }

  return {
    body,
    headers: parseHeaderLines(headerLines),
    status: Number(status),
    statusLine,
    statusText,
  };
}

function parseHeaderLines(lines: string[]): Array<readonly [string, string]> {
  return lines
    .filter((line) => line.length > 0)
    .map((line) => {
      const separator = line.indexOf(':');
      if (separator === -1) {
        throw new Error(`Malformed fixture header: ${line}`);
      }

      return [line.slice(0, separator), line.slice(separator + 1).trim()] as const;
    });
}

function dispatchKeyForFixture(request: FixtureRequest): string {
  return dispatchKey(request.method, new URL(request.path, 'http://fixture.local'));
}

function expectHeaderSubset(
  liveHeaders: Map<string, string>,
  fixtureHeaders: Array<readonly [string, string]>,
): void {
  for (const [name, value] of fixtureHeaders) {
    expect(liveHeaders.get(name.toLowerCase())).toBe(value);
  }
}
