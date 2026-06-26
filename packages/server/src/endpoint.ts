import type { WebhookVerifier } from '@kovojs/core';
import type { AccessDecision } from './access.js';

/** HTTP method for an endpoint; arbitrary strings are allowed for custom verbs. */
export type EndpointMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' | (string & {});

/** Whether an endpoint matches an exact path or a path prefix. */
export type EndpointMount = 'exact' | 'prefix';

/** Raw response body posture declared for endpoint audit output (SPEC §9.1). */
export type EndpointResponseBody = 'bytes' | 'html' | 'json' | 'redirect' | 'stream' | 'text';

/** Raw endpoint cache posture declared for endpoint audit output (SPEC §9.1). */
export type EndpointCachePosture = 'custom' | 'no-store' | 'private' | 'public' | 'revalidated';

/**
 * Audit metadata for the raw `Response` an endpoint returns. `appOwnedSafety`
 * means application code owns body encoding and response-header safety for this
 * raw HTTP escape hatch (SPEC §9.1).
 */
export interface EndpointResponsePosture {
  appOwnedSafety: boolean;
  body: EndpointResponseBody;
  cache: EndpointCachePosture;
  /**
   * Reserved response headers this raw endpoint intentionally writes. Framework protocol,
   * credential, redirect, and security-policy headers are rejected by the dev/CI posture verifier
   * unless named here, because raw endpoints bypass the framework response header sinks.
   */
  reservedHeaders?: readonly string[];
}

/** Records an explicit, justified opt-out of default-on CSRF for an endpoint (SPEC §6.6). */
export interface EndpointCsrfExemption {
  exempt: true;
  justification: string;
}

/** How an endpoint authenticates: a named verifier, a named custom scheme, or a justified `none`. */
export type EndpointAuthDeclaration =
  | { kind: 'custom'; name: string; verify?: WebhookVerifier }
  | { kind: 'none'; justification: string }
  | { kind: 'verifier'; name: string; verify?: WebhookVerifier };

/** A raw HTTP endpoint descriptor: path, method, mount mode, and auth/CSRF declarations. */
export interface Endpoint<
  Path extends string,
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = 'exact',
> {
  access?: AccessDecision;
  auth?: EndpointAuthDeclaration;
  csrf?: EndpointCsrfExemption;
  method: Method;
  mount: Mount;
  mountJustification?: string;
  path: Path;
  reason: string;
  response: EndpointResponsePosture;
}

/** A `Request` guaranteed to carry no session, as endpoint handlers receive. */
export type EndpointRequest = Request & { readonly session?: never };

/** An endpoint handler: maps a session-free `Request` to a `Response`. */
export type EndpointHandler = (request: EndpointRequest) => Promise<Response> | Response;

interface EndpointDefinitionBase<Method extends EndpointMethod> {
  access?: AccessDecision;
  auth?: EndpointAuthDeclaration;
  handler: EndpointHandler;
  method: Method;
  response: EndpointResponsePosture;
}

/** Endpoint-level audit reason; `purpose` is accepted as an app-facing synonym. */
export type EndpointReason =
  | { purpose: string; reason?: never }
  | { purpose?: never; reason: string };

/** Prefix endpoint mounts must justify the wider routed surface (SPEC §9.1). */
export type EndpointMountDefinition<Mount extends EndpointMount> = Mount extends 'prefix'
  ? { mount: Mount; mountJustification: string }
  : { mount?: Mount; mountJustification?: never };

interface EndpointCsrfDefault {
  csrf?: true;
  csrfJustification?: never;
}

interface EndpointCsrfExempt {
  csrf: false;
  csrfJustification: string;
}

/** The body passed to `endpoint()`: handler, method/mount, and the CSRF default-or-exempt choice. */
export type EndpointDefinition<
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = 'exact',
> = EndpointDefinitionBase<Method> &
  EndpointReason &
  EndpointMountDefinition<Mount> &
  (EndpointCsrfDefault | EndpointCsrfExempt);

/** An endpoint with its path attached, as returned by `endpoint()`. */
export interface EndpointDeclaration<
  Path extends string = string,
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = EndpointMount,
> extends Endpoint<Path, Method, Mount> {
  handler: EndpointHandler;
}

/**
 * Declare a raw HTTP endpoint: a `handler` taking a `Request` and returning a
 * `Response`, mounted at an exact path or a path `prefix`. Endpoints are the
 * escape hatch for machine traffic (webhooks, APIs) that bypasses the page/query
 * pipeline, so every declaration carries audit metadata: explicit `method`,
 * endpoint-level `reason`/`purpose`, raw response posture, and a prefix mount
 * justification when `mount: 'prefix'` is used. CSRF is default-on — opt out
 * with `csrf: false` plus a justification (SPEC §6.6 and §9.1).
 *
 * @param path - The path the endpoint mounts at.
 * @param definition - The `handler`, method, audit metadata, optional `mount`, `auth`, and CSRF opt-out.
 * @returns An `EndpointDeclaration`.
 * @example
 * import { endpoint } from '@kovojs/server';
 *
 * export const health = endpoint('/healthz', {
 *   method: 'GET',
 *   reason: 'read-only health probe',
 *   csrf: false,
 *   csrfJustification: 'read-only health probe',
 *   response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
 *   handler: () => new Response('ok'),
 * });
 */
export function endpoint<
  const Path extends string,
  const Method extends EndpointMethod = EndpointMethod,
  const Mount extends EndpointMount = 'exact',
>(
  path: Path,
  definition: EndpointDefinition<Method, Mount>,
): EndpointDeclaration<Path, Method, Mount> {
  const mount = (definition.mount ?? 'exact') as Mount;
  const reason = 'reason' in definition ? definition.reason : definition.purpose;

  return {
    ...(definition.access === undefined ? {} : { access: definition.access }),
    ...(definition.auth === undefined ? {} : { auth: definition.auth }),
    ...(definition.csrf === false
      ? { csrf: { exempt: true, justification: definition.csrfJustification } }
      : {}),
    handler: definition.handler,
    method: definition.method,
    mount,
    ...(definition.mountJustification === undefined
      ? {}
      : { mountJustification: definition.mountJustification }),
    path,
    reason,
    response: definition.response,
  };
}

/**
 * Invoke an endpoint's handler for a request (with the session stripped, since
 * endpoints are session-free by construction).
 *
 * @param definition - The endpoint to run.
 * @param request - The incoming request.
 * @returns The handler's `Response`.
 * @internal
 */
export async function runEndpoint(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  request: Request,
): Promise<Response> {
  const response = await definition.handler(endpointRequestWithoutSession(request));
  assertEndpointResponsePosture(definition, response);
  return response;
}

/**
 * Enforce an endpoint's executable auth verifier before dispatch. Name-only
 * auth declarations remain audit metadata; declarations carrying `verify` are
 * checked fail-closed over cloned raw bytes so the handler still receives the
 * original body (SPEC §9.1).
 *
 * @param definition - The endpoint whose auth declaration should run.
 * @param request - The incoming request.
 * @returns A 401 `Response` when auth fails, otherwise `undefined`.
 * @internal
 */
export async function runEndpointAuth(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  request: Request,
): Promise<Response | undefined> {
  const verifier = definition.auth?.kind === 'none' ? undefined : definition.auth?.verify;
  if (verifier === undefined) return undefined;

  let verified = false;
  try {
    const authRequest = endpointRequestWithoutSession(request.clone());
    verified = await verifier.verify({
      headers: authRequest.headers,
      payload: new Uint8Array(await authRequest.arrayBuffer()),
    });
  } catch {
    verified = false;
  }

  return verified ? undefined : endpointAuthFailureResponse();
}

/**
 * Test whether an endpoint matches a method and pathname, honoring exact vs
 * `prefix` mounting.
 *
 * @param definition - The endpoint to test.
 * @param input - The incoming `pathname` and optional `method`.
 * @returns `true` when the endpoint matches.
 * @internal
 */
export function endpointMatches(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  input: { method?: string; pathname: string },
): boolean {
  if (input.method !== undefined) {
    if (definition.method.toUpperCase() !== input.method.toUpperCase()) return false;
  }

  if (definition.mount === 'prefix') {
    return (
      input.pathname === definition.path ||
      input.pathname.startsWith(`${definition.path.replace(/\/$/, '')}/`)
    );
  }

  return input.pathname === definition.path;
}

/**
 * Inbound header carrying ambient *browser* authority that a cross-site page can make
 * the browser auto-attach with the victim's credentials. Per SPEC.md §9.1 ("cookies are
 * not interpreted ... A CSRF exemption is sound only because endpoint/webhook auth does
 * not ride ambient browser authority") this is the Cookie header. Explicit machine
 * credentials (`Authorization`, API-key headers, webhook signatures) are NOT browser-
 * ambient — a cross-site page cannot force them with the victim's secret — and remain the
 * endpoint's declared auth surface, so they are deliberately preserved.
 */
const AMBIENT_BROWSER_AUTHORITY_HEADERS: readonly string[] = ['cookie'];

function endpointHeadersWithoutAmbientAuthority(headers: Headers): Headers {
  const sanitized = new Headers(headers);
  for (const name of AMBIENT_BROWSER_AUTHORITY_HEADERS) sanitized.delete(name);
  return sanitized;
}

export function endpointRequestWithoutSession(request: Request): EndpointRequest {
  // bugz-3 L16 / SPEC.md §9.1: raw endpoints "do not receive the app session request
  // extension" AND "cookies are not interpreted". A `csrf: false` endpoint (and every
  // webhook()) skips the synchronizer-token check and the Origin floor, so the exemption
  // is sound only if the handler cannot ride ambient browser authority. Stripping the
  // session property alone left the raw Cookie header readable, letting a cookie-trusting
  // exempt handler act as a confused deputy with the caller's browser credentials —
  // exactly the unsoundness mutations reject at compile time with KV418. Neutralize the
  // Cookie header here so the exemption is sound by construction. (The framework's own
  // CSRF cookie is consumed by validateEndpointCsrf on the ORIGINAL request before the
  // handler runs, so this does not affect default-CSRF validation.)
  const sanitizedHeaders = endpointHeadersWithoutAmbientAuthority(request.headers);

  return new Proxy(request, {
    get(target, property) {
      if (property === 'session') return undefined;
      if (property === 'headers') return sanitizedHeaders;
      // A handler could otherwise recover the Cookie header via request.clone(); re-wrap
      // the clone so the neutralization holds across clones too.
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

function endpointAuthFailureResponse(): Response {
  return new Response('Unauthorized', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status: 401,
  });
}

function assertEndpointResponsePosture(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  response: Response,
): void {
  if (process.env.NODE_ENV !== 'development' && process.env.KOVO_VERIFY_ENDPOINT_POSTURE !== '1') {
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
  if (
    definition.response.body === 'redirect' &&
    (response.status < 300 || response.status >= 400)
  ) {
    failures.push('declared body=redirect but response status is not 3xx');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (definition.response.body === 'json' && !/\bjson\b/i.test(contentType)) {
    failures.push('declared body=json but response content type is not JSON');
  }
  if (definition.response.body === 'html' && !/\bhtml\b/i.test(contentType)) {
    failures.push('declared body=html but response content type is not HTML');
  }
  assertEndpointReservedHeaders(definition, response, failures);
  if (failures.length === 0) return;
  throw new Error(
    `Endpoint ${definition.method} ${definition.path} response posture mismatch: ${failures.join(
      '; ',
    )}.`,
  );
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
