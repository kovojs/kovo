/** A single header value: one string or a list of strings. */
export type ResponseHeaderValue = string | string[];

/** A header bag mapping header names to values. */
export type ResponseHeaders = Record<string, ResponseHeaderValue>;

/** A single mutation-response header value (alias of `ResponseHeaderValue`). */
export type MutationResponseHeaderValue = ResponseHeaderValue;

/** A mutation-response header bag (alias of `ResponseHeaders`). */
export type MutationResponseHeaders = ResponseHeaders;

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

/** Options for `respond.stream`: `RouteFileOptions` plus inline/attachment disposition. */
export interface RouteStreamOptions extends RouteFileOptions {
  disposition?: 'attachment' | 'inline';
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
> {}

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
 * Build a non-document route response from a route `page` handler: `respond.file`
 * for an attachment download, `respond.stream` for a streamed body. Both set the
 * content type and disposition; return the result instead of a page value
 * (SPEC §6.4).
 *
 * @example
 * import { respond, route } from '@kovojs/server';
 *
 * export const exportRoute = route('/export.csv', {
 *   page: () =>
 *     respond.file('id,name\n1,Kettle\n', {
 *       contentType: 'text/csv',
 *       filename: 'products.csv',
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
    headers: webResponseHeaders(response.headers),
    status: response.status,
  });
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
  // Security finding M1: file/stream bodies can carry a sniffable/scriptable
  // content type (e.g. SVG-with-script served `inline`). Default to
  // `X-Content-Type-Options: nosniff` so the browser honors the declared type
  // instead of sniffing. Authors may override by setting the header explicitly
  // (matched case-insensitively below).
  const authorSetNosniff = outcome.headers
    ? Object.keys(outcome.headers).some((name) => name.toLowerCase() === 'x-content-type-options')
    : false;

  return {
    'Content-Disposition': outcome.contentDisposition,
    'Content-Type': outcome.contentType,
    ...(authorSetNosniff ? {} : { 'X-Content-Type-Options': 'nosniff' }),
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

function webResponseHeaders(headers: ResponseHeaders): Headers {
  const webHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) webHeaders.append(name, entry);
    } else {
      webHeaders.set(name, value);
    }
  }

  return webHeaders;
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
