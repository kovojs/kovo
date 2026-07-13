/* oxlint-disable typescript/unbound-method -- Boot-captured Web/string controls are invoked through pinned Reflect.apply. */

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
  isNativeRequest,
  requestForAuthorityNeutralMetadata,
} from './request-carrier.js';
import { assertNoSecretEgressValue } from './secret-egress.js';
import { endpointBrowserStateAuthExecuted } from './endpoint-auth-proof.js';
import { isTrustedSecureRequest } from './request-scheme.js';
import { runtimeEnvironmentValue } from './runtime-environment-authority.js';
import type {
  EndpointDeclaration,
  EndpointMethod,
  EndpointMount,
  EndpointRequest,
  EndpointResponseBody,
  EndpointResponseBodyPosture,
} from './endpoint.js';
import {
  createWitnessSet,
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectKeys,
  witnessReflectApply,
  witnessReflectGet,
  witnessRegExpTest,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';
import { securityStringTrim } from './response-security-intrinsics.js';

const nativeStringIncludes = String.prototype.includes;
const nativeStringStartsWith = String.prototype.startsWith;
const nativeStringToLowerCase = String.prototype.toLowerCase;
const NativeResponse = Response;
const readNativeResponseBody = responseIntrinsicGetter<ReadableStream<Uint8Array> | null>('body');
const readNativeResponseHeaders = responseIntrinsicGetter<Headers>('headers');
const readNativeResponseStatus = responseIntrinsicGetter<number>('status');
const readNativeResponseStatusText = responseIntrinsicGetter<string>('statusText');

export type WireOutputChannel = 'framework-response' | 'raw-endpoint-response';

export interface WireOutputProvenance {
  blessedRedirect?: boolean;
  method: string;
  redirectAllowlist?: readonly RedirectLocationAllowlistEntry[];
  secure?: true;
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
  stripAuthorization?: boolean;
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
      const clientIpRequest = requestMetadataWithoutAmbientAuthority(request);
      const endpointRequest = endpointRequestWithoutSession(request, {
        stripAuthorization: options.stripAuthorization === true,
      });
      if (options.clientIp !== undefined) {
        const clientIp = options.clientIp(clientIpRequest);
        if (clientIp !== undefined && clientIp !== '') {
          witnessDefineProperty(endpointRequest, 'clientIp', {
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
  request: Pick<Request, 'method'> | Request,
  options: { redirectAllowlist?: readonly RedirectLocationAllowlistEntry[] } = {},
): Response {
  const status = readNativeResponseStatus(response);
  return emitToWire(response, 'raw-endpoint-response', {
    method: request.method,
    ...(isTrustedSecureRequest(request) ? { secure: true } : {}),
    ...(options.redirectAllowlist === undefined
      ? {}
      : { redirectAllowlist: options.redirectAllowlist }),
    status,
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
      if (!isNativeResponse(value)) {
        throw new TypeError('emitToWire raw-endpoint-response requires a Web Response.');
      }
      const headers = readNativeResponseHeaders(value);
      const status = readNativeResponseStatus(value);
      const finalizedHeaders = finalizeRawResponseHeaders(value, {
        ...(provenance.redirectAllowlist === undefined
          ? {}
          : { redirectAllowlist: provenance.redirectAllowlist }),
        ...(provenance.secure === true ? { secure: true as const } : {}),
      });
      const suppressBody = provenance.method === 'HEAD' || status === 304;
      if (!suppressBody && finalizedHeaders === headers) return value;

      return new NativeResponse(suppressBody ? null : readNativeResponseBody(value), {
        headers: finalizedHeaders,
        status,
        statusText: readNativeResponseStatusText(value),
      });
    }

    if (isNativeResponse(value)) {
      throw new TypeError('emitToWire framework-response requires a structured response.');
    }

    return new NativeResponse(webResponseBodyToBodyInit(value.body), {
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
const readNativeUrlOrigin = witnessGetOwnPropertyDescriptor(URL.prototype, 'origin')?.get;
const readNativeUrlPathname = witnessGetOwnPropertyDescriptor(URL.prototype, 'pathname')?.get;
const readNativeUrlSearchParams = witnessGetOwnPropertyDescriptor(
  URL.prototype,
  'searchParams',
)?.get;
const nativeHeadersAppend = witnessGetOwnPropertyDescriptor(Headers.prototype, 'append')
  ?.value as unknown;
const nativeHeadersDelete = witnessGetOwnPropertyDescriptor(Headers.prototype, 'delete')
  ?.value as unknown;
const nativeHeadersForEach = witnessGetOwnPropertyDescriptor(Headers.prototype, 'forEach')
  ?.value as unknown;
const nativeHeadersGet = witnessGetOwnPropertyDescriptor(Headers.prototype, 'get')
  ?.value as unknown;
const nativeHeadersHas = witnessGetOwnPropertyDescriptor(Headers.prototype, 'has')
  ?.value as unknown;
const nativeHeadersSet = witnessGetOwnPropertyDescriptor(Headers.prototype, 'set')
  ?.value as unknown;
const nativeHeadersGetSetCookie = witnessGetOwnPropertyDescriptor(Headers.prototype, 'getSetCookie')
  ?.value as unknown;
const nativeUrlSearchParamsForEach = witnessGetOwnPropertyDescriptor(
  URLSearchParams.prototype,
  'forEach',
)?.value as unknown;
if (
  typeof nativeHeadersAppend !== 'function' ||
  typeof nativeHeadersDelete !== 'function' ||
  typeof nativeHeadersForEach !== 'function' ||
  typeof nativeHeadersGet !== 'function' ||
  typeof nativeHeadersHas !== 'function' ||
  typeof nativeHeadersSet !== 'function' ||
  witnessReflectApply(nativeStringToLowerCase, 'SeT-CoOkIe', []) !== 'set-cookie' ||
  witnessReflectApply(nativeStringStartsWith, 'kovo-control', ['kovo-']) !== true ||
  witnessReflectApply(nativeStringStartsWith, 'app-control', ['kovo-']) !== false ||
  witnessReflectApply(nativeStringIncludes, 'private, no-store', ['no-store']) !== true ||
  witnessReflectApply(nativeStringIncludes, 'public', ['no-store']) !== false
) {
  throw new TypeError(
    'Kovo response-posture Web controls were modified before framework initialization.',
  );
}
const responsePostureHeaderControl = createNativeHeaders();
witnessReflectApply(nativeHeadersAppend, responsePostureHeaderControl, ['X-Kovo-Control', 'one']);
witnessReflectApply(nativeHeadersSet, responsePostureHeaderControl, ['X-Kovo-Control', 'two']);
let responsePostureHeaderVisited = false;
witnessReflectApply(nativeHeadersForEach, responsePostureHeaderControl, [
  (value: string, name: string): void => {
    if (name === 'x-kovo-control' && value === 'two') responsePostureHeaderVisited = true;
  },
]);
if (
  !responsePostureHeaderVisited ||
  witnessReflectApply(nativeHeadersHas, responsePostureHeaderControl, ['X-Kovo-Control']) !==
    true ||
  witnessReflectApply(nativeHeadersHas, responsePostureHeaderControl, ['Missing']) !== false ||
  witnessReflectApply(nativeHeadersGet, responsePostureHeaderControl, ['X-Kovo-Control']) !== 'two'
) {
  throw new TypeError('Kovo response-posture Headers controls failed their semantic check.');
}
witnessReflectApply(nativeHeadersDelete, responsePostureHeaderControl, ['X-Kovo-Control']);
if (witnessReflectApply(nativeHeadersHas, responsePostureHeaderControl, ['X-Kovo-Control'])) {
  throw new TypeError('Kovo response-posture Headers delete control failed its semantic check.');
}
const responsePostureResponseControl = new NativeResponse(null, {
  headers: { 'X-Kovo-Control': 'accepted' },
  status: 201,
  statusText: 'Created',
});
if (
  readNativeResponseStatus(responsePostureResponseControl) !== 201 ||
  readNativeResponseStatusText(responsePostureResponseControl) !== 'Created' ||
  witnessReflectApply(nativeHeadersGet, readNativeResponseHeaders(responsePostureResponseControl), [
    'X-Kovo-Control',
  ]) !== 'accepted'
) {
  throw new TypeError('Kovo response-posture Response controls failed their semantic check.');
}
const authorityNeutralRequests = createWitnessWeakSet<Request>();
const browserCredentialNeutralRequests = createWitnessWeakSet<Request>();
const frameworkPeerAddressProperty = '__kovoPeerAddress';

/** A framework-owned request copy carrying no app session or disallowed browser authority. */
export function endpointRequestWithoutSession(
  request: Request,
  options: { stripAuthorization?: boolean } = {},
): EndpointRequest {
  if (
    witnessWeakSetHas(authorityNeutralRequests, request) &&
    (!options.stripAuthorization || witnessWeakSetHas(browserCredentialNeutralRequests, request))
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
    witnessDefineProperty(neutral, frameworkPeerAddressProperty, {
      configurable: true,
      value: peerAddress,
    });
  }
  witnessWeakSetAdd(authorityNeutralRequests, neutral);
  if (options.stripAuthorization) witnessWeakSetAdd(browserCredentialNeutralRequests, neutral);
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
    witnessDefineProperty(neutral, frameworkPeerAddressProperty, {
      configurable: true,
      value: peerAddress,
    });
  }
  witnessWeakSetAdd(authorityNeutralRequests, neutral);
  witnessWeakSetAdd(browserCredentialNeutralRequests, neutral);
  return neutral;
}

function requestIntrinsicGetter<Value>(property: string): (request: Request) => Value {
  const descriptor = witnessGetOwnPropertyDescriptor(Request.prototype, property);
  const getter = descriptor ? witnessReflectGet(descriptor, 'get') : undefined;
  if (typeof getter !== 'function') {
    throw new TypeError(`The Web Request implementation lacks a ${property} getter.`);
  }
  return (request) => witnessReflectApply(getter, request, []);
}

function responseIntrinsicGetter<Value>(property: string): (response: Response) => Value {
  const descriptor = witnessGetOwnPropertyDescriptor(NativeResponse.prototype, property);
  const getter = descriptor ? witnessReflectGet(descriptor, 'get') : undefined;
  if (typeof getter !== 'function') {
    throw new TypeError(`The Web Response implementation lacks a ${property} getter.`);
  }
  return (response) => witnessReflectApply(getter, response, []);
}

function isNativeResponse(value: unknown): value is Response {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  try {
    readNativeResponseHeaders(value as Response);
    return true;
  } catch {
    return false;
  }
}

function frameworkPeerAddress(request: Request): string | undefined {
  const descriptor = witnessGetOwnPropertyDescriptor(request, frameworkPeerAddressProperty);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    descriptor.enumerable === true ||
    descriptor.writable === true ||
    typeof descriptor.value !== 'string'
  ) {
    return undefined;
  }
  const value = securityStringTrim(descriptor.value);
  return value === '' ? undefined : value;
}

/** Enforce an endpoint's declared raw response posture when runtime verification is enabled. */
export function assertEndpointResponsePosture(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  response: Response,
  options: { request?: Request } = {},
): void {
  assertEndpointBrowserStateResponsePosture(definition, response, options.request);
  if (!shouldVerifyEndpointResponsePosture()) {
    return;
  }
  const headers = readNativeResponseHeaders(response);
  const status = readNativeResponseStatus(response);
  const failures: string[] = [];
  const cacheControl = nativeHeaderGet(headers, 'cache-control') ?? '';
  if (
    definition.response.cache === 'no-store' &&
    !witnessRegExpTest(/\bno-store\b/i, cacheControl)
  ) {
    appendResponsePostureValue(
      failures,
      'declared cache=no-store but response lacks Cache-Control: no-store',
    );
  }
  if (definition.response.cache === 'private' && !witnessRegExpTest(/\bprivate\b/i, cacheControl)) {
    appendResponsePostureValue(
      failures,
      'declared cache=private but response lacks Cache-Control: private',
    );
  }
  if (definition.response.cache === 'public' && !witnessRegExpTest(/\bpublic\b/i, cacheControl)) {
    appendResponsePostureValue(
      failures,
      'declared cache=public but response lacks Cache-Control: public',
    );
  }
  const bodyPosture = endpointResponseBodyPostures(definition.response.body);
  if (postureIncludes(bodyPosture, 'redirect') && status >= 300 && status < 400) {
    const location = nativeHeaderGet(headers, 'location');
    if (
      location !== null &&
      redirectLocationHeader(
        location,
        redirectLocationOptions(definition.response.redirectAllowlist),
      ) !== location
    ) {
      appendResponsePostureValue(
        failures,
        'redirect Location must be same-origin or match response.redirectAllowlist with a rationale',
      );
    }
    assertEndpointReservedHeaders(definition, headers, failures);
    if (failures.length === 0) return;
    throw endpointPostureError(definition, failures);
  }
  if (
    bodyPosture.length === 1 &&
    bodyPosture[0] === 'redirect' &&
    (status < 300 || status >= 400)
  ) {
    appendResponsePostureValue(failures, 'declared body=redirect but response status is not 3xx');
  }
  const contentType = nativeHeaderGet(headers, 'content-type') ?? '';
  if (!endpointResponseBodyMatchesContentType(bodyPosture, contentType)) {
    appendResponsePostureValue(
      failures,
      endpointResponseBodyMismatchMessage(definition.response.body),
    );
  }
  assertEndpointReservedHeaders(definition, headers, failures);
  if (failures.length === 0) return;
  throw endpointPostureError(definition, failures);
}

function assertEndpointBrowserStateResponsePosture(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  response: Response,
  request: Request | undefined,
): void {
  if (definition.csrf?.exempt !== true) return;
  const headers = readNativeResponseHeaders(response);
  const browserStateHeaders: string[] = [];
  if (nativeHeaderHas(headers, 'Set-Cookie')) {
    appendResponsePostureValue(browserStateHeaders, 'Set-Cookie');
  }
  if (nativeHeaderHas(headers, 'Clear-Site-Data')) {
    appendResponsePostureValue(browserStateHeaders, 'Clear-Site-Data');
  }
  if (browserStateHeaders.length === 0) return;
  if (endpointBrowserStateAuthExecuted(definition, request)) return;

  throw endpointPostureError(definition, [
    `${joinResponsePostureValues(browserStateHeaders, ' and ')} requires an executable non-ambient verifier or a framework-owned self-verifying handler on a csrf:false endpoint`,
  ]);
}

function shouldVerifyEndpointResponsePosture(): boolean {
  if (runtimeEnvironmentValue('KOVO_VERIFY_ENDPOINT_POSTURE') === '1') return true;
  const nodeEnvironment = runtimeEnvironmentValue('NODE_ENV');
  return nodeEnvironment === 'development' || nodeEnvironment === 'production';
}

function finalizeResponseHeaders(
  headers: ResponseHeaders,
  options: { blessedRedirect: boolean; status: number },
): Headers {
  const webHeaders = createNativeHeaders();
  const names = witnessObjectKeys(headers);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(headers, name);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`Response header ${name} must be a stable own data property.`);
    }
    const value = descriptor.value;
    assertSafeResponseHeaderName(name);
    if (
      isRedirectStatus(options.status) &&
      witnessReflectApply(nativeStringToLowerCase, name, []) === 'location'
    ) {
      const location = redirectLocationHeaderValue(value, options.blessedRedirect);
      assertSafeResponseHeaderValue(name, location);
      nativeHeaderSet(webHeaders, name, location);
      continue;
    }

    if (witnessIsArray(value)) {
      for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
        const entry = value[valueIndex];
        assertNoSecretEgressValue(entry, `response header "${name}"`);
        if (typeof entry !== 'string') {
          throw new TypeError(`Response header ${name} values must be strings.`);
        }
        assertSafeResponseHeaderValue(name, entry);
        nativeHeaderAppend(webHeaders, name, entry);
      }
    } else {
      assertSafeResponseHeaderValue(name, value);
      nativeHeaderSet(webHeaders, name, value);
    }
  }

  return webHeaders;
}

function finalizeRawResponseHeaders(
  response: Response,
  options: { redirectAllowlist?: readonly RedirectLocationAllowlistEntry[]; secure?: true },
): Headers {
  const headers = readNativeResponseHeaders(response);
  const hasRedirectLocation =
    isRedirectStatus(readNativeResponseStatus(response)) && nativeHeaderHas(headers, 'location');
  const setCookies = rawSetCookieHeaders(headers);
  if (!hasRedirectLocation && setCookies.length === 0) return headers;

  const webHeaders = createNativeHeaders();
  witnessReflectApply(nativeHeadersForEach as Function, headers, [
    (value: string, name: string): void => {
      const lowerName = lowerCase(name);
      if (lowerName === 'set-cookie') return;
      if (hasRedirectLocation && lowerName === 'location') {
        nativeHeaderSet(
          webHeaders,
          name,
          redirectLocationHeader(value, redirectLocationOptions(options.redirectAllowlist)),
        );
        return;
      }
      nativeHeaderSet(webHeaders, name, value);
    },
  ]);

  for (let index = 0; index < setCookies.length; index += 1) {
    const cookie = setCookies[index]!;
    nativeHeaderAppend(
      webHeaders,
      'Set-Cookie',
      forwardSetCookie(cookie, {
        class: 'session',
        ...(options.secure === true ? { secure: true } : {}),
        source: 'legacy-normalize',
      }),
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
  const setCookies =
    typeof nativeHeadersGetSetCookie === 'function'
      ? witnessReflectApply<string[]>(nativeHeadersGetSetCookie, headers, [])
      : [];
  if (setCookies.length > 0) return setCookies;

  const value = nativeHeaderGet(headers, 'set-cookie');
  return value === null ? [] : [value];
}

function assertSafeResponseHeaderName(name: string): void {
  if (witnessRegExpTest(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u, name)) return;
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

function appendResponsePostureValue<Value>(values: Value[], value: Value): void {
  witnessDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function joinResponsePostureValues(values: readonly string[], separator: string): string {
  let result = '';
  for (let index = 0; index < values.length; index += 1) {
    result += `${index === 0 ? '' : separator}${values[index]}`;
  }
  return result;
}

function lowerCase(value: string): string {
  return witnessReflectApply(nativeStringToLowerCase, value, []);
}

function nativeHeaderAppend(headers: Headers, name: string, value: string): void {
  witnessReflectApply(nativeHeadersAppend as Function, headers, [name, value]);
}

function nativeHeaderDelete(headers: Headers, name: string): void {
  witnessReflectApply(nativeHeadersDelete as Function, headers, [name]);
}

function nativeHeaderGet(headers: Headers, name: string): string | null {
  return witnessReflectApply(nativeHeadersGet as Function, headers, [name]);
}

function nativeHeaderHas(headers: Headers, name: string): boolean {
  return witnessReflectApply(nativeHeadersHas as Function, headers, [name]);
}

function nativeHeaderSet(headers: Headers, name: string, value: string): void {
  witnessReflectApply(nativeHeadersSet as Function, headers, [name, value]);
}

function postureIncludes(
  postures: readonly EndpointResponseBody[],
  expected: EndpointResponseBody,
): boolean {
  for (let index = 0; index < postures.length; index += 1) {
    if (postures[index] === expected) return true;
  }
  return false;
}

function stringWitnessSet(values: readonly string[]): Set<string> {
  const set = createWitnessSet<string>();
  for (let index = 0; index < values.length; index += 1) witnessSetAdd(set, values[index]!);
  return set;
}

const AMBIENT_BROWSER_AUTHORITY_HEADERS: readonly string[] = ['cookie'];
function endpointHeadersWithoutAmbientAuthority(
  headers: Headers,
  options: { metadataOnly?: boolean; stripAuthorization?: boolean } = {},
): Headers {
  if (options.stripAuthorization !== false) {
    const sanitized = createNativeHeaders();
    if (typeof nativeHeadersAppend !== 'function') {
      throw new TypeError('The Web Headers implementation lacks required intrinsics.');
    }
    if (typeof nativeHeadersForEach !== 'function') {
      throw new TypeError('The Web Headers implementation lacks required traversal intrinsics.');
    }
    witnessReflectApply(nativeHeadersForEach, headers, [
      (value: string, name: string): void => {
        if (
          options.metadataOnly === true
            ? isRequestMetadataHeader(name)
            : isProvablyNonAmbientMachineHeader(name)
        ) {
          witnessReflectApply(nativeHeadersAppend, sanitized, [name, value]);
        }
      },
    ]);
    return sanitized;
  }
  const sanitized = createNativeHeaders(headers);
  for (let index = 0; index < AMBIENT_BROWSER_AUTHORITY_HEADERS.length; index += 1) {
    nativeHeaderDelete(sanitized, AMBIENT_BROWSER_AUTHORITY_HEADERS[index]!);
  }
  return sanitized;
}

function requestMetadataUrl(value: string): string {
  if (
    typeof readNativeUrlOrigin !== 'function' ||
    typeof readNativeUrlPathname !== 'function' ||
    typeof readNativeUrlSearchParams !== 'function'
  ) {
    return 'http://kovo.invalid/';
  }
  try {
    const parsed = new NativeURL(value);
    const origin = witnessReflectApply<string>(readNativeUrlOrigin, parsed, []);
    const pathname = witnessReflectApply<string>(readNativeUrlPathname, parsed, []);
    const searchParams = witnessReflectApply<URLSearchParams>(
      readNativeUrlSearchParams,
      parsed,
      [],
    );
    const keys: string[] = [];
    if (typeof nativeUrlSearchParamsForEach !== 'function') {
      throw new TypeError('The Web URLSearchParams implementation lacks traversal intrinsics.');
    }
    witnessReflectApply(nativeUrlSearchParamsForEach, searchParams, [
      (_value: string, key: string): void => {
        appendResponsePostureValue(keys, encodeURIComponent(key));
      },
    ]);
    return `${origin}${pathname}${keys.length === 0 ? '' : `?${joinResponsePostureValues(keys, '&')}`}`;
  } catch {
    return 'http://kovo.invalid/';
  }
}

function isRequestMetadataHeader(value: string): boolean {
  const header = lowerCase(value);
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
  const header = lowerCase(value);
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
  const header = lowerCase(value);
  return (
    header === 'accept' ||
    header === 'content-length' ||
    header === 'content-type' ||
    header === 'user-agent' ||
    witnessReflectApply<boolean>(nativeStringIncludes, header, ['signature']) ||
    witnessReflectApply<boolean>(nativeStringIncludes, header, ['hmac']) ||
    witnessReflectApply<boolean>(nativeStringStartsWith, header, ['kovo-']) ||
    witnessReflectApply<boolean>(nativeStringStartsWith, header, ['webhook-']) ||
    witnessReflectApply<boolean>(nativeStringStartsWith, header, ['x-kovo-']) ||
    witnessReflectApply<boolean>(nativeStringStartsWith, header, ['x-machine-'])
  );
}

const LIFECYCLE_POLICY_KEYS: Record<RequestLifecycleSurface, ReadonlySet<string>> = {
  document: stringWitnessSet([
    'clientIp',
    'db',
    'onError',
    'onSessionSetCookie',
    'sessionProvider',
    'surface',
  ]),
  endpoint: stringWitnessSet(['clientIp', 'onError', 'stripAuthorization', 'surface']),
  mutation: stringWitnessSet([
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
  query: stringWitnessSet([
    'clientIp',
    'db',
    'onError',
    'principalPosture',
    'sessionProvider',
    'surface',
  ]),
  system: stringWitnessSet(['surface']),
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
  const keys = witnessObjectKeys(options);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!witnessSetHas(allowed as Set<string>, key)) {
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
  if (isNativeRequest(value)) return;
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
    `Endpoint ${definition.method} ${definition.path} response posture mismatch: ${joinResponsePostureValues(failures, '; ')}.`,
  );
}

function endpointResponseBodyPostures(
  body: EndpointResponseBodyPosture,
): readonly EndpointResponseBody[] {
  return typeof body === 'string' ? [body] : body;
}

function endpointResponseBodyPostureLabel(body: EndpointResponseBodyPosture): string {
  return typeof body === 'string' ? body : joinResponsePostureValues(body, '|');
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
  const inspectJson = postureIncludes(bodyPosture, 'json');
  const inspectHtml = postureIncludes(bodyPosture, 'html');
  if (!inspectJson && !inspectHtml) return true;
  if (inspectJson && witnessRegExpTest(/\bjson\b/i, contentType)) return true;
  if (inspectHtml && witnessRegExpTest(/\bhtml\b/i, contentType)) return true;
  if (postureIncludes(bodyPosture, 'text') && witnessRegExpTest(/\btext\//i, contentType)) {
    return true;
  }
  return false;
}

function assertEndpointReservedHeaders(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  headers: Headers,
  failures: string[],
): void {
  const allowed = createWitnessSet<string>();
  const declared = definition.response.reservedHeaders ?? [];
  for (let index = 0; index < declared.length; index += 1) {
    witnessSetAdd(allowed, lowerCase(declared[index]!));
  }
  witnessReflectApply(nativeHeadersForEach as Function, headers, [
    (_value: string, header: string) => {
      const reserved = endpointReservedHeader(header);
      if (reserved === undefined) return;
      if (witnessSetHas(allowed, lowerCase(header)) || witnessSetHas(allowed, lowerCase(reserved)))
        return;
      appendResponsePostureValue(
        failures,
        `reserved response header ${reserved} was written without response.reservedHeaders declaration`,
      );
    },
  ]);
}

function endpointReservedHeader(header: string): string | undefined {
  const lower = lowerCase(header);
  if (witnessReflectApply<boolean>(nativeStringStartsWith, lower, ['kovo-'])) return 'Kovo-*';
  if (lower === 'set-cookie') return 'Set-Cookie';
  if (lower === 'clear-site-data') return 'Clear-Site-Data';
  if (lower === 'location') return 'Location';
  if (witnessSetHas(ENDPOINT_SECURITY_HEADERS, lower)) return header;
  return undefined;
}

const ENDPOINT_SECURITY_HEADERS = stringWitnessSet([
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
