export type ResponseHeaderValue = string | string[];

export type ResponseHeaders = Record<string, ResponseHeaderValue>;

export type MutationResponseHeaderValue = ResponseHeaderValue;

export type MutationResponseHeaders = ResponseHeaders;

export interface ServerResponseBase<
  Body,
  Headers extends ResponseHeaders = ResponseHeaders,
  Status extends number = number,
> {
  body: Body;
  headers: Headers;
  status: Status;
}

export type RouteResponseBody = ArrayBuffer | ReadableStream<Uint8Array> | Uint8Array | string;

export type RouteResponseStatus = 200 | 303 | 304 | 403 | 404 | 422 | 429 | 500;

export type DocumentRouteResponseBody = Exclude<RouteResponseBody, ArrayBuffer>;

export interface NotFound {
  notFound: true;
  status: 404;
}

export interface RouteResponseOutcome {
  body: RouteResponseBody;
  contentDisposition: string;
  contentType: string;
  etag?: string;
  headers?: Record<string, string>;
  routeResponse: true;
}

export interface RouteFileOptions {
  contentType: string;
  etag?: string;
  filename?: string;
  headers?: Record<string, string>;
}

export interface RouteStreamOptions extends RouteFileOptions {
  disposition?: 'attachment' | 'inline';
}

export interface RoutePageResponse extends ServerResponseBase<
  RouteResponseBody,
  Record<string, string>,
  RouteResponseStatus
> {}

export interface DocumentRouteResponseBase extends ServerResponseBase<
  DocumentRouteResponseBody,
  Record<string, string>,
  RouteResponseStatus
> {}

export type HeaderSource =
  | Iterable<readonly [string, string]>
  | Record<string, readonly string[] | string | undefined>
  | {
      get(name: string): null | string;
    };

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

export const respond = {
  file(body: Exclude<RouteResponseBody, ReadableStream<Uint8Array>>, options: RouteFileOptions) {
    return routeResponseOutcome(body, {
      ...options,
      disposition: 'attachment',
    });
  },
  stream(body: RouteResponseBody, options: RouteStreamOptions) {
    return routeResponseOutcome(body, {
      ...options,
      disposition: options.disposition ?? 'attachment',
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

  return {
    body: outcome.body,
    headers,
    status: 200,
  };
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
  response: ServerResponseBase<RouteResponseBody, Record<string, string>>,
  request: Pick<Request, 'method'>,
): Response {
  return new Response(
    request.method === 'HEAD' ? null : routeResponseBodyToBodyInit(response.body),
    {
      headers: response.headers,
      status: response.status,
    },
  );
}

export function routeResponseToDocumentResponse(
  response: RoutePageResponse,
): DocumentRouteResponseBase {
  return {
    ...response,
    body: response.body instanceof ArrayBuffer ? new Uint8Array(response.body) : response.body,
  };
}

function routeResponseOutcome(
  body: RouteResponseBody,
  options: RouteFileOptions & { disposition: 'attachment' | 'inline' },
): RouteResponseOutcome {
  const contentDisposition = options.filename
    ? `${options.disposition}; filename="${escapeHeaderValue(options.filename)}"`
    : options.disposition;
  return {
    body,
    contentDisposition,
    contentType: options.contentType,
    ...(options.etag === undefined ? {} : { etag: options.etag }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    routeResponse: true,
  };
}

function routeOutcomeHeaders(outcome: RouteResponseOutcome): Record<string, string> {
  return {
    'Content-Disposition': outcome.contentDisposition,
    'Content-Type': outcome.contentType,
    ...(outcome.etag === undefined ? {} : { ETag: outcome.etag }),
    ...outcome.headers,
  };
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

function routeResponseBodyToBodyInit(body: RouteResponseBody): BodyInit | null {
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
