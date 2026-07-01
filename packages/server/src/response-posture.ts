import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import {
  resolveLifecycleRequest,
  type RequestLifecycleOptions,
  type LifecycleRequest,
} from './guards.js';
import {
  isBlessedRedirectResponse,
  readHeader,
  redirectLocationHeader,
  redirectLocationHeaderValue,
  type RedirectLocationAllowlistEntry,
  type RedirectLocationOptions,
  type ResponseHeaders,
  type ServerResponseBase,
  type WebResponseBody,
} from './response.js';
import { forwardSetCookie } from './cookies.js';
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

export class ResponseHeaderChannelError extends Error {
  readonly code = 'KV415' as const;

  constructor(message: string) {
    super(`KV415 ${message}`);
    this.name = 'ResponseHeaderChannelError';
  }
}

type LifecycleCommonOptions<RawRequest, SessionValue, DbValue> = Pick<
  RequestLifecycleOptions<RawRequest, SessionValue, DbValue>,
  'clientIp' | 'db' | 'onError' | 'sessionProvider'
>;

export interface DocumentLifecyclePolicy<
  RawRequest,
  SessionValue = unknown,
  DbValue = unknown,
> extends LifecycleCommonOptions<RawRequest, SessionValue, DbValue> {
  onSessionSetCookie?: RequestLifecycleOptions<
    RawRequest,
    SessionValue,
    DbValue
  >['onSessionSetCookie'];
  surface: 'document';
}

export interface QueryLifecyclePolicy<
  RawRequest,
  SessionValue = unknown,
  DbValue = unknown,
> extends LifecycleCommonOptions<RawRequest, SessionValue, DbValue> {
  surface: 'query';
}

export interface MutationLifecyclePolicy<
  RawRequest,
  SessionValue = unknown,
  DbValue = unknown,
> extends LifecycleCommonOptions<RawRequest, SessionValue, DbValue> {
  csrf: { mode: 'exempt' | 'protected' };
  idempotency: { mode: 'none' | 'replay-store' };
  sqlWritePolicy?: RequestLifecycleOptions<RawRequest, SessionValue, DbValue>['sqlWritePolicy'];
  surface: 'mutation';
}

export interface EndpointLifecyclePolicy extends Pick<
  RequestLifecycleOptions<Request, never, never>,
  'clientIp' | 'onError'
> {
  surface: 'endpoint';
}

export interface SystemLifecyclePolicy {
  surface: 'system';
}

export type ResolveKovoLifecycleRequestOptions<
  RawRequest,
  SessionValue = unknown,
  DbValue = unknown,
> =
  | DocumentLifecyclePolicy<RawRequest, SessionValue, DbValue>
  | QueryLifecyclePolicy<RawRequest, SessionValue, DbValue>
  | MutationLifecyclePolicy<RawRequest, SessionValue, DbValue>
  | EndpointLifecyclePolicy
  | SystemLifecyclePolicy;

/** Resolve the request lifecycle from one centralized policy entrypoint. */
export async function resolveKovoLifecycleRequest<
  RawRequest,
  SessionValue = unknown,
  DbValue = unknown,
>(
  request: RawRequest,
  options: ResolveKovoLifecycleRequestOptions<RawRequest, SessionValue, DbValue>,
): Promise<LifecycleRequest<RawRequest, SessionValue, DbValue>> {
  assertKnownLifecyclePolicy(options);

  switch (options.surface) {
    case 'document': {
      const lifecycleOptions: RequestLifecycleOptions<RawRequest, SessionValue, DbValue> = {
        dbMode: 'read',
      };
      if (options.clientIp !== undefined) lifecycleOptions.clientIp = options.clientIp;
      if (options.db !== undefined) lifecycleOptions.db = options.db;
      if (options.onError !== undefined) lifecycleOptions.onError = options.onError;
      if (options.onSessionSetCookie !== undefined) {
        lifecycleOptions.onSessionSetCookie = options.onSessionSetCookie;
      }
      if (options.sessionProvider !== undefined) {
        lifecycleOptions.sessionProvider = options.sessionProvider;
      }
      return resolveLifecycleRequest(request, lifecycleOptions);
    }
    case 'query': {
      const lifecycleOptions: RequestLifecycleOptions<RawRequest, SessionValue, DbValue> = {
        dbMode: 'read',
      };
      if (options.clientIp !== undefined) lifecycleOptions.clientIp = options.clientIp;
      if (options.db !== undefined) lifecycleOptions.db = options.db;
      if (options.onError !== undefined) lifecycleOptions.onError = options.onError;
      if (options.sessionProvider !== undefined) {
        lifecycleOptions.sessionProvider = options.sessionProvider;
      }
      return resolveLifecycleRequest(request, lifecycleOptions);
    }
    case 'mutation': {
      const lifecycleOptions: RequestLifecycleOptions<RawRequest, SessionValue, DbValue> = {
        dbMode: 'write',
      };
      if (options.clientIp !== undefined) lifecycleOptions.clientIp = options.clientIp;
      if (options.db !== undefined) lifecycleOptions.db = options.db;
      if (options.onError !== undefined) lifecycleOptions.onError = options.onError;
      if (options.sessionProvider !== undefined) {
        lifecycleOptions.sessionProvider = options.sessionProvider;
      }
      if (options.sqlWritePolicy !== undefined) {
        lifecycleOptions.sqlWritePolicy = options.sqlWritePolicy;
      }
      return resolveLifecycleRequest(request, lifecycleOptions);
    }
    case 'endpoint': {
      assertWebRequest(request, options.surface);
      const lifecycleOptions: RequestLifecycleOptions<Request, never, never> = {};
      if (options.clientIp !== undefined) lifecycleOptions.clientIp = options.clientIp;
      if (options.onError !== undefined) lifecycleOptions.onError = options.onError;
      return resolveLifecycleRequest(
        endpointRequestWithoutSession(request),
        lifecycleOptions,
      ) as unknown as Promise<LifecycleRequest<RawRequest, SessionValue, DbValue>>;
    }
    case 'system': {
      assertWebRequest(request, options.surface);
      return resolveLifecycleRequest(
        endpointRequestWithoutSession(request),
        {},
      ) as unknown as Promise<LifecycleRequest<RawRequest, SessionValue, DbValue>>;
    }
    default:
      return assertNeverLifecyclePolicy(options);
  }
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
  options: { redirectAllowlist?: readonly RedirectLocationAllowlistEntry[] } = {},
): Response {
  const finalizedHeaders = finalizeRawResponseHeaders(response, options);
  const suppressBody = request.method === 'HEAD' || response.status === 304;
  if (!suppressBody && finalizedHeaders === response.headers) return response;

  return new Response(suppressBody ? null : response.body, {
    headers: finalizedHeaders,
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
    const location = response.headers.get('location');
    if (
      location !== null &&
      redirectLocationHeader(
        location,
        redirectLocationOptions(definition.response.redirectAllowlist),
      ) !== location
    ) {
      failures.push(
        'redirect Location must be same-origin or match response.redirectAllowlist with a rationale',
      );
    }
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
    assertSafeResponseHeaderName(name);
    if (isRedirectStatus(options.status) && name.toLowerCase() === 'location') {
      const location = redirectLocationHeaderValue(value, options.blessedRedirect);
      assertSafeResponseHeaderValue(name, location);
      webHeaders.set(name, location);
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        assertSafeResponseHeaderValue(name, entry);
        webHeaders.append(name, entry);
      }
    } else {
      assertSafeResponseHeaderValue(name, value);
      webHeaders.set(name, value);
    }
  }

  return webHeaders;
}

function finalizeRawResponseHeaders(
  response: Response,
  options: { redirectAllowlist?: readonly RedirectLocationAllowlistEntry[] },
): Headers {
  const hasRedirectLocation = isRedirectStatus(response.status) && response.headers.has('location');
  const setCookies = rawSetCookieHeaders(response.headers);
  if (!hasRedirectLocation && setCookies.length === 0) return response.headers;

  const webHeaders = new Headers();
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() === 'set-cookie') return;
    if (hasRedirectLocation && name.toLowerCase() === 'location') {
      webHeaders.set(
        name,
        redirectLocationHeader(value, redirectLocationOptions(options.redirectAllowlist)),
      );
      return;
    }
    webHeaders.set(name, value);
  });

  for (const cookie of setCookies) {
    webHeaders.append(
      'Set-Cookie',
      forwardSetCookie(cookie, { class: 'session', source: 'legacy-normalize' }),
    );
  }

  return webHeaders;
}

function redirectLocationOptions(
  allowlist: readonly RedirectLocationAllowlistEntry[] | undefined,
): RedirectLocationOptions {
  return allowlist === undefined ? {} : { allowlist };
}

function rawSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof withGetSetCookie.getSetCookie === 'function' ? withGetSetCookie.getSetCookie() : [];
  if (setCookies.length > 0) return setCookies;

  const value = headers.get('set-cookie');
  return value === null ? [] : [value];
}

function assertSafeResponseHeaderName(name: string): void {
  if (/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name)) return;
  throw new ResponseHeaderChannelError(diagnosticDefinitions.KV415.message);
}

function assertSafeResponseHeaderValue(name: string, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0x1f && code !== 0x7f) continue;
    throw new ResponseHeaderChannelError(
      `${diagnosticDefinitions.KV415.message} Header ${name} contains a control character.`,
    );
  }
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

const LIFECYCLE_POLICY_KEYS: Record<RequestLifecycleSurface, ReadonlySet<string>> = {
  document: new Set([
    'clientIp',
    'db',
    'onError',
    'onSessionSetCookie',
    'sessionProvider',
    'surface',
  ]),
  endpoint: new Set(['clientIp', 'onError', 'surface']),
  mutation: new Set([
    'clientIp',
    'csrf',
    'db',
    'idempotency',
    'onError',
    'sessionProvider',
    'sqlWritePolicy',
    'surface',
  ]),
  query: new Set(['clientIp', 'db', 'onError', 'sessionProvider', 'surface']),
  system: new Set(['surface']),
};

function assertKnownLifecyclePolicy(options: unknown): void {
  if (typeof options !== 'object' || options === null) {
    throw new Error('Lifecycle policy must be an object.');
  }
  const policy = options as { surface?: unknown };
  if (!isLifecycleSurface(policy.surface)) {
    throw new Error(`Unknown lifecycle surface "${String(policy.surface)}".`);
  }

  const allowed = LIFECYCLE_POLICY_KEYS[policy.surface];
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new Error(`Lifecycle surface "${policy.surface}" does not accept option "${key}".`);
    }
  }
}

function isLifecycleSurface(value: unknown): value is RequestLifecycleSurface {
  return (
    value === 'document' ||
    value === 'endpoint' ||
    value === 'mutation' ||
    value === 'query' ||
    value === 'system'
  );
}

function assertWebRequest(
  value: unknown,
  surface: 'endpoint' | 'system',
): asserts value is Request {
  if (value instanceof Request) return;
  throw new Error(`Lifecycle surface "${surface}" requires a Web Request.`);
}

function assertNeverLifecyclePolicy(value: never): never {
  throw new Error(`Unhandled lifecycle policy ${String(value)}`);
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
