import {
  resolveLifecycleRequest,
  type RequestLifecycleOptions,
  type LifecycleRequest,
} from './guards.js';
import {
  isBlessedRedirectResponse,
  readHeader,
  redirectLocationHeaderValue,
  type ResponseHeaders,
  type ServerResponseBase,
  type WebResponseBody,
} from './response.js';
import type {
  EndpointDeclaration,
  EndpointMethod,
  EndpointMount,
  EndpointRequest,
  EndpointResponseBody,
  EndpointResponseBodyPosture,
} from './endpoint.js';

/**
 * Internal request/response lifecycle policy shared by document/query/mutation/endpoint/system
 * surfaces. SPEC §§5.2.1, 6.6, 9.1, 9.4, 9.5, and 10.3 keep these floors at the request shell:
 * lifecycle request enrichment, ambient-authority stripping, endpoint posture checks, redirect
 * header blessing, and HEAD/304 body suppression are framework-owned response finalization.
 *
 * @internal
 */

export type RequestLifecycleSurface = 'document' | 'endpoint' | 'mutation' | 'query' | 'system';

export interface ResolveKovoLifecycleRequestOptions<
  Request,
  SessionValue = unknown,
  DbValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue, DbValue> {
  surface: RequestLifecycleSurface;
}

/** Resolve the request lifecycle from one centralized policy entrypoint. */
export async function resolveKovoLifecycleRequest<
  Request,
  SessionValue = unknown,
  DbValue = unknown,
>(
  request: Request,
  options: ResolveKovoLifecycleRequestOptions<Request, SessionValue, DbValue>,
): Promise<LifecycleRequest<Request, SessionValue, DbValue>> {
  const { surface: _surface, ...lifecycleOptions } = options;
  return resolveLifecycleRequest(request, lifecycleOptions);
}

/** Finalize a framework structured response into a Web Response. */
export function finalizeServerResponse(
  response: ServerResponseBase<WebResponseBody, ResponseHeaders>,
  request: Pick<Request, 'method'>,
): Response {
  const body = request.method === 'HEAD' || response.status === 304 ? null : response.body;
  return new Response(webResponseBodyToBodyInit(body), {
    headers: finalizeResponseHeaders(response.headers, {
      blessedRedirect: isBlessedRedirectResponse(response),
      status: response.status,
    }),
    status: response.status,
  });
}

/**
 * Finalize an already-raw Web Response returned by an app-owned endpoint. The body is not copied
 * except for HEAD/304, preserving streaming protocols while enforcing HTTP body suppression.
 */
export function finalizeRawWebResponse(
  response: Response,
  request: Pick<Request, 'method'>,
): Response {
  if (request.method !== 'HEAD' && response.status !== 304) return response;
  return new Response(null, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/** A request view that carries no app session and no ambient browser Cookie header. */
export function endpointRequestWithoutSession(request: Request): EndpointRequest {
  const sanitizedHeaders = endpointHeadersWithoutAmbientAuthority(request.headers);

  return new Proxy(request, {
    get(target, property) {
      if (property === 'session') return undefined;
      if (property === 'headers') return sanitizedHeaders;
      if (property === 'clone') {
        return () => endpointRequestWithoutSession(target.clone());
      }

      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(target, property) {
      if (property === 'session') return false;
      return property in target;
    },
  }) as EndpointRequest;
}

/** Enforce an endpoint's declared raw response posture when runtime verification is enabled. */
export function assertEndpointResponsePosture(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  response: Response,
): void {
  if (!shouldVerifyEndpointResponsePosture()) {
    return;
  }
  const failures: string[] = [];
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (definition.response.cache === 'no-store' && !/\bno-store\b/i.test(cacheControl)) {
    failures.push('declared cache=no-store but response lacks Cache-Control: no-store');
  }
  if (definition.response.cache === 'private' && !/\bprivate\b/i.test(cacheControl)) {
    failures.push('declared cache=private but response lacks Cache-Control: private');
  }
  if (definition.response.cache === 'public' && !/\bpublic\b/i.test(cacheControl)) {
    failures.push('declared cache=public but response lacks Cache-Control: public');
  }
  const bodyPosture = endpointResponseBodyPostures(definition.response.body);
  if (bodyPosture.includes('redirect') && response.status >= 300 && response.status < 400) {
    assertEndpointReservedHeaders(definition, response, failures);
    if (failures.length === 0) return;
    throw endpointPostureError(definition, failures);
  }
  if (
    bodyPosture.length === 1 &&
    bodyPosture[0] === 'redirect' &&
    (response.status < 300 || response.status >= 400)
  ) {
    failures.push('declared body=redirect but response status is not 3xx');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!endpointResponseBodyMatchesContentType(bodyPosture, contentType)) {
    failures.push(endpointResponseBodyMismatchMessage(definition.response.body));
  }
  assertEndpointReservedHeaders(definition, response, failures);
  if (failures.length === 0) return;
  throw endpointPostureError(definition, failures);
}

function shouldVerifyEndpointResponsePosture(): boolean {
  if (process.env.KOVO_VERIFY_ENDPOINT_POSTURE === '1') return true;
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'production';
}

function finalizeResponseHeaders(
  headers: ResponseHeaders,
  options: { blessedRedirect: boolean; status: number },
): Headers {
  const webHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (isRedirectStatus(options.status) && name.toLowerCase() === 'location') {
      webHeaders.set(name, redirectLocationHeaderValue(value, options.blessedRedirect));
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

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

const AMBIENT_BROWSER_AUTHORITY_HEADERS: readonly string[] = ['cookie'];

function endpointHeadersWithoutAmbientAuthority(headers: Headers): Headers {
  const sanitized = new Headers(headers);
  for (const name of AMBIENT_BROWSER_AUTHORITY_HEADERS) sanitized.delete(name);
  return sanitized;
}

function endpointPostureError(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  failures: readonly string[],
): Error {
  return new Error(
    `Endpoint ${definition.method} ${definition.path} response posture mismatch: ${failures.join(
      '; ',
    )}.`,
  );
}

function endpointResponseBodyPostures(
  body: EndpointResponseBodyPosture,
): readonly EndpointResponseBody[] {
  return typeof body === 'string' ? [body] : body;
}

function endpointResponseBodyPostureLabel(body: EndpointResponseBodyPosture): string {
  return typeof body === 'string' ? body : body.join('|');
}

function endpointResponseBodyMismatchMessage(body: EndpointResponseBodyPosture): string {
  if (body === 'json') return 'declared body=json but response content type is not JSON';
  if (body === 'html') return 'declared body=html but response content type is not HTML';
  return `declared body=${endpointResponseBodyPostureLabel(
    body,
  )} but response content type does not match`;
}

function endpointResponseBodyMatchesContentType(
  bodyPosture: readonly EndpointResponseBody[],
  contentType: string,
): boolean {
  const inspected = bodyPosture.filter((body) => body === 'json' || body === 'html');
  if (inspected.length === 0) return true;
  if (inspected.includes('json') && /\bjson\b/i.test(contentType)) return true;
  if (inspected.includes('html') && /\bhtml\b/i.test(contentType)) return true;
  if (bodyPosture.includes('text') && /\btext\//i.test(contentType)) return true;
  return false;
}

function assertEndpointReservedHeaders(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  response: Response,
  failures: string[],
): void {
  const allowed = new Set(
    (definition.response.reservedHeaders ?? []).map((header) => header.toLowerCase()),
  );
  for (const [header] of response.headers) {
    const reserved = endpointReservedHeader(header);
    if (reserved === undefined) continue;
    if (allowed.has(header.toLowerCase()) || allowed.has(reserved.toLowerCase())) continue;
    failures.push(
      `reserved response header ${reserved} was written without response.reservedHeaders declaration`,
    );
  }
}

function endpointReservedHeader(header: string): string | undefined {
  const lower = header.toLowerCase();
  if (lower.startsWith('kovo-')) return 'Kovo-*';
  if (lower === 'set-cookie') return 'Set-Cookie';
  if (lower === 'location') return 'Location';
  if (ENDPOINT_SECURITY_HEADERS.has(lower)) return header;
  return undefined;
}

const ENDPOINT_SECURITY_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
]);

/** Shared header reader for finalizers that need a redirect presence check. */
export function responsePostureHeader(headers: ResponseHeaders, name: string): string | undefined {
  return readHeader(headers, name);
}
