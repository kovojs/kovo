import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { wireEmitter } from '@kovojs/core/internal/security-markers';
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
import {
  authorityNeutralAbortSignal,
  cloneRequestForAuthorityNeutralization,
  createNativeHeaders,
  createNativeRequest,
  requestForAuthorityNeutralMetadata,
} from './request-carrier.js';
import { assertNoSecretEgressValue } from './secret-egress.js';
import type {
  EndpointDeclaration,
  EndpointMethod,
  EndpointMount,
  EndpointRequest,
  EndpointResponseBody,
  EndpointResponseBodyPosture,
} from './endpoint.js';

export type WireOutputChannel = 'framework-response' | 'raw-endpoint-response';

export interface WireOutputProvenance {
  blessedRedirect?: boolean;
  method: string;
  redirectAllowlist?: readonly RedirectLocationAllowlistEntry[];
  status?: number;
}

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
  principalPosture?: RequestLifecycleOptions<RawRequest, SessionValue, DbValue>['principalPosture'];
  surface: 'query';
}

export interface MutationLifecyclePolicy<
  RawRequest,
  SessionValue = unknown,
  DbValue = unknown,
> extends LifecycleCommonOptions<RawRequest, SessionValue, DbValue> {
  csrf: { mode: 'exempt' | 'protected' };
  idempotency: { mode: 'none' | 'replay-store' };
  principalPosture?: RequestLifecycleOptions<RawRequest, SessionValue, DbValue>['principalPosture'];
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
      if (options.principalPosture !== undefined) {
        lifecycleOptions.principalPosture = options.principalPosture;
      }
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
      if (options.principalPosture !== undefined) {
        lifecycleOptions.principalPosture = options.principalPosture;
      }
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
      const endpointRequest = endpointRequestWithoutSession(request);
      if (options.clientIp !== undefined) {
        const clientIp = options.clientIp(endpointRequest);
        if (clientIp !== undefined && clientIp !== '') {
          Object.defineProperty(endpointRequest, 'clientIp', {
            configurable: true,
            enumerable: true,
            value: clientIp,
            writable: false,
          });
        }
      }
      return endpointRequest as unknown as LifecycleRequest<RawRequest, SessionValue, DbValue>;
    }
    case 'system': {
      assertWebRequest(request, options.surface);
      return endpointRequestWithoutSession(request) as unknown as LifecycleRequest<
        RawRequest,
        SessionValue,
        DbValue
      >;
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
  return emitToWire(
    {
      body,
      headers: response.headers,
      status: response.status,
    },
    'framework-response',
    {
      blessedRedirect: isBlessedRedirectResponse(response),
      method: request.method,
      status: response.status,
    },
  );
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
  return emitToWire(response, 'raw-endpoint-response', {
    method: request.method,
    ...(options.redirectAllowlist === undefined
      ? {}
      : { redirectAllowlist: options.redirectAllowlist }),
    status: response.status,
  });
}

/**
 * DEC5 wire-output choke (SPEC §9.1/§9.5): every framework-owned response finalization path
 * reaches the Web `Response` constructor here, after status/body suppression and header safety
 * checks have run for the selected channel.
 */
export const emitToWire = wireEmitter(
  'server.response.emit-to-wire',
  function (
    value: Response | ServerResponseBase<WebResponseBody, ResponseHeaders>,
    channel: WireOutputChannel,
    provenance: WireOutputProvenance,
  ): Response {
    if (channel === 'raw-endpoint-response') {
      if (!(value instanceof Response)) {
        throw new TypeError('emitToWire raw-endpoint-response requires a Web Response.');
      }
      const finalizedHeaders = finalizeRawResponseHeaders(
        value,
        provenance.redirectAllowlist === undefined
          ? {}
          : { redirectAllowlist: provenance.redirectAllowlist },
      );
      const suppressBody = provenance.method === 'HEAD' || value.status === 304;
      if (!suppressBody && finalizedHeaders === value.headers) return value;

      return new Response(suppressBody ? null : value.body, {
        headers: finalizedHeaders,
        status: value.status,
        statusText: value.statusText,
      });
    }

    if (value instanceof Response) {
      throw new TypeError('emitToWire framework-response requires a structured response.');
    }

    return new Response(webResponseBodyToBodyInit(value.body), {
      headers: finalizeResponseHeaders(value.headers, {
        blessedRedirect: provenance.blessedRedirect ?? false,
        status: provenance.status ?? value.status,
      }),
      status: value.status,
    });
  },
);

const readNativeRequestHeaders = requestIntrinsicGetter<Headers>('headers');
const readNativeRequestMethod = requestIntrinsicGetter<string>('method');
const readNativeRequestSignal = requestIntrinsicGetter<AbortSignal>('signal');
const readNativeRequestUrl = requestIntrinsicGetter<string>('url');
const NativeURL = URL;
const readNativeUrlOrigin = Object.getOwnPropertyDescriptor(URL.prototype, 'origin')?.get;
const readNativeUrlPathname = Object.getOwnPropertyDescriptor(URL.prototype, 'pathname')?.get;
const readNativeUrlSearchParams = Object.getOwnPropertyDescriptor(
  URL.prototype,
  'searchParams',
)?.get;
const nativeUrlSearchParamKeys = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'keys')
  ?.value as unknown;
const nativeHeadersEntries = Object.getOwnPropertyDescriptor(Headers.prototype, 'entries')
  ?.value as unknown;
const nativeHeadersAppend = Object.getOwnPropertyDescriptor(Headers.prototype, 'append')
  ?.value as unknown;
const authorityNeutralRequests = new WeakSet<Request>();
const browserCredentialNeutralRequests = new WeakSet<Request>();
const frameworkPeerAddressProperty = '__kovoPeerAddress';

/** A framework-owned request copy carrying no app session or disallowed browser authority. */
export function endpointRequestWithoutSession(
  request: Request,
  options: { stripAuthorization?: boolean } = {},
): EndpointRequest {
  if (
    authorityNeutralRequests.has(request) &&
    (!options.stripAuthorization || browserCredentialNeutralRequests.has(request))
  ) {
    return request as EndpointRequest;
  }

  // Clone through the captured Web intrinsic so an app-authored own `clone`,
  // accessor, prototype, symbol, or method can never retain a reference to the
  // raw carrier. The first clone tees the body, keeping the incoming Request
  // usable by downstream framework gates. Reconstructing with a fresh Headers
  // bag makes Cookie removal effective even on runtimes whose Request header
  // guard forbids mutating `Cookie` in place.
  const peerAddress = frameworkPeerAddress(request);
  const source = cloneRequestForAuthorityNeutralization(request);
  const sourceHeaders = readNativeRequestHeaders(source);
  const sanitizedHeaders = endpointHeadersWithoutAmbientAuthority(sourceHeaders, {
    stripAuthorization: options.stripAuthorization === true,
  });
  const neutral = createNativeRequest(source, {
    headers: sanitizedHeaders,
    signal: authorityNeutralAbortSignal(readNativeRequestSignal(source)),
  });
  if (peerAddress !== undefined) {
    Object.defineProperty(neutral, frameworkPeerAddressProperty, {
      configurable: true,
      value: peerAddress,
    });
  }
  authorityNeutralRequests.add(neutral);
  if (options.stripAuthorization) browserCredentialNeutralRequests.add(neutral);
  return neutral as EndpointRequest;
}

/** Bodyless request metadata for pre-dispatch policy callbacks on neutral surfaces. */
export function requestMetadataWithoutAmbientAuthority(request: Request): Request {
  const source = requestForAuthorityNeutralMetadata(request);
  const headers = readNativeRequestHeaders(source);
  const method = readNativeRequestMethod(source);
  const signal = authorityNeutralAbortSignal(readNativeRequestSignal(source));
  const url = requestMetadataUrl(readNativeRequestUrl(source));
  const neutral = createNativeRequest(url, {
    headers: endpointHeadersWithoutAmbientAuthority(headers, {
      metadataOnly: true,
      stripAuthorization: true,
    }),
    method,
    signal,
  });
  const peerAddress = frameworkPeerAddress(request);
  if (peerAddress !== undefined) {
    Object.defineProperty(neutral, frameworkPeerAddressProperty, {
      configurable: true,
      value: peerAddress,
    });
  }
  authorityNeutralRequests.add(neutral);
  browserCredentialNeutralRequests.add(neutral);
  return neutral;
}

function requestIntrinsicGetter<Value>(property: string): (request: Request) => Value {
  const descriptor = Object.getOwnPropertyDescriptor(Request.prototype, property);
  const getter = descriptor ? (Reflect.get(descriptor, 'get') as unknown) : undefined;
  if (typeof getter !== 'function') {
    throw new TypeError(`The Web Request implementation lacks a ${property} getter.`);
  }
  return (request) => Reflect.apply(getter, request, []) as Value;
}

function frameworkPeerAddress(request: Request): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(request, frameworkPeerAddressProperty);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    descriptor.enumerable === true ||
    descriptor.writable === true ||
    typeof descriptor.value !== 'string'
  ) {
    return undefined;
  }
  const value = descriptor.value.trim();
  return value === '' ? undefined : value;
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
  assertNoSecretEgressValue(value, `response header "${name}"`);
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
function endpointHeadersWithoutAmbientAuthority(
  headers: Headers,
  options: { metadataOnly?: boolean; stripAuthorization?: boolean } = {},
): Headers {
  if (options.stripAuthorization !== false) {
    const sanitized = createNativeHeaders();
    if (typeof nativeHeadersEntries !== 'function' || typeof nativeHeadersAppend !== 'function') {
      throw new TypeError('The Web Headers implementation lacks required intrinsics.');
    }
    const entries = Reflect.apply(nativeHeadersEntries, headers, []) as IterableIterator<
      [string, string]
    >;
    for (const [name, value] of entries) {
      if (
        options.metadataOnly === true
          ? isRequestMetadataHeader(name)
          : isProvablyNonAmbientMachineHeader(name)
      ) {
        Reflect.apply(nativeHeadersAppend, sanitized, [name, value]);
      }
    }
    return sanitized;
  }
  const sanitized = createNativeHeaders(headers);
  for (const name of AMBIENT_BROWSER_AUTHORITY_HEADERS) sanitized.delete(name);
  return sanitized;
}

function requestMetadataUrl(value: string): string {
  if (
    typeof readNativeUrlOrigin !== 'function' ||
    typeof readNativeUrlPathname !== 'function' ||
    typeof readNativeUrlSearchParams !== 'function' ||
    typeof nativeUrlSearchParamKeys !== 'function'
  ) {
    return 'http://kovo.invalid/';
  }
  try {
    const parsed = new NativeURL(value);
    const origin = Reflect.apply(readNativeUrlOrigin, parsed, []) as string;
    const pathname = Reflect.apply(readNativeUrlPathname, parsed, []) as string;
    const searchParams = Reflect.apply(readNativeUrlSearchParams, parsed, []) as URLSearchParams;
    const keys = [
      ...(Reflect.apply(nativeUrlSearchParamKeys, searchParams, []) as IterableIterator<string>),
    ].map(encodeURIComponent);
    return `${origin}${pathname}${keys.length === 0 ? '' : `?${keys.join('&')}`}`;
  } catch {
    return 'http://kovo.invalid/';
  }
}

function isRequestMetadataHeader(value: string): boolean {
  const header = value.toLowerCase();
  return (
    header === 'accept' ||
    header === 'content-length' ||
    header === 'content-type' ||
    header === 'user-agent' ||
    header === 'x-kovo-client-ip' ||
    isNetworkMetadataHeader(header)
  );
}

function isNetworkMetadataHeader(value: string): boolean {
  const header = value.toLowerCase();
  return (
    header === 'cf-connecting-ip' ||
    header === 'fastly-client-ip' ||
    header === 'forwarded' ||
    header === 'true-client-ip' ||
    header === 'x-forwarded-for' ||
    header === 'x-real-ip'
  );
}

function isProvablyNonAmbientMachineHeader(value: string): boolean {
  const header = value.toLowerCase();
  return (
    header === 'accept' ||
    header === 'content-length' ||
    header === 'content-type' ||
    header === 'user-agent' ||
    header.includes('signature') ||
    header.includes('hmac') ||
    header.startsWith('kovo-') ||
    header.startsWith('webhook-') ||
    header.startsWith('x-kovo-') ||
    header.startsWith('x-machine-')
  );
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
    'principalPosture',
    'sessionProvider',
    'sqlWritePolicy',
    'surface',
  ]),
  query: new Set(['clientIp', 'db', 'onError', 'principalPosture', 'sessionProvider', 'surface']),
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
