import type { WebhookVerifier } from '@kovojs/core';
import type { AccessDecision } from './access.js';
import { actAsNonRequestPrincipal, type NonRequestPrincipalPosture } from './auth-principal.js';
import type { DbProvider } from './guards.js';
import { managedDb, type Reader, type Writer } from './managed-db.js';
import type { RedirectLocationAllowlistEntry } from './response.js';
import {
  assertEndpointResponsePosture,
  endpointRequestWithoutSession,
  finalizeServerResponse,
} from './response-posture.js';

export type { RedirectLocationAllowlistEntry } from './response.js';

/** HTTP method for an endpoint; arbitrary strings are allowed for custom verbs. */
export type EndpointMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' | (string & {});

/** Whether an endpoint matches an exact path or a path prefix. */
export type EndpointMount = 'exact' | 'prefix';

/** Raw response body posture declared for endpoint audit output (SPEC §9.1). */
export type EndpointResponseBody = 'bytes' | 'html' | 'json' | 'redirect' | 'stream' | 'text';

/**
 * One or more raw response body classes an endpoint may return, used by endpoint audits and
 * runtime posture verification (SPEC §9.1).
 */
export type EndpointResponseBodyPosture =
  | EndpointResponseBody
  | readonly [EndpointResponseBody, ...EndpointResponseBody[]];

/** Raw endpoint cache posture declared for endpoint audit output (SPEC §9.1). */
export type EndpointCachePosture = 'custom' | 'no-store' | 'private' | 'public' | 'revalidated';

/**
 * Audit metadata for the raw `Response` an endpoint returns. `appOwnedSafety`
 * means application code owns body encoding and response-header safety for this
 * raw HTTP escape hatch (SPEC §9.1).
 */
export interface EndpointResponsePosture {
  appOwnedSafety: boolean;
  body: EndpointResponseBodyPosture;
  cache: EndpointCachePosture;
  /**
   * Exact cross-origin redirect origins this raw endpoint may emit in a `Location` header.
   * Same-origin paths need no entry; external origins require an audit-readable reason.
   */
  redirectAllowlist?: readonly RedirectLocationAllowlistEntry[];
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

/** Session-free request shape passed to an endpoint DB provider after `ctx.actAs(id)`. */
export type EndpointDbProviderRequest = EndpointRequest & {
  readonly principalPosture: NonRequestPrincipalPosture;
};

/** Principal-scoped endpoint DB capabilities. */
export interface EndpointDbScope<Db = unknown> {
  readonly db: {
    readonly read: Reader<Db>;
    readonly write: Writer<Db>;
  };
}

/** Context exposed only to `endpoint(..., { db: true, handler(req, ctx) { ... } })`. */
export interface EndpointDbContext<Db = unknown> {
  /**
   * SPEC §10.3 DEC-H: endpoints do not inherit a session principal. App code must derive and
   * validate the owner id from its own endpoint auth before receiving managed DB capabilities.
   */
  actAs(principalId: string): Promise<EndpointDbScope<Db>>;
}

/** An endpoint handler: maps a session-free `Request` to a `Response`. */
export type EndpointHandler = (request: EndpointRequest) => Promise<Response> | Response;

/** An endpoint handler that opted into an explicit principal-scoped DB context. */
export type EndpointDbHandler<Db = unknown> = (
  request: EndpointRequest,
  context: EndpointDbContext<Db>,
) => Promise<Response> | Response;

interface EndpointDefinitionBase<Method extends EndpointMethod> {
  access?: AccessDecision;
  auth?: EndpointAuthDeclaration;
  db?: false;
  handler: EndpointHandler;
  method: Method;
  response: EndpointResponsePosture;
}

/** Endpoint definition branch for handlers that opt into `ctx.actAs(id)` managed DB access. */
export interface EndpointDbDefinitionBase<Method extends EndpointMethod, Db = unknown> {
  access?: AccessDecision;
  auth?: EndpointAuthDeclaration;
  db: true;
  handler: EndpointDbHandler<Db>;
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
  Db = unknown,
> =
  | (EndpointDefinitionBase<Method> &
      EndpointReason &
      EndpointMountDefinition<Mount> &
      (EndpointCsrfDefault | EndpointCsrfExempt))
  | (EndpointDbDefinitionBase<Method, Db> &
      EndpointReason &
      EndpointMountDefinition<Mount> &
      (EndpointCsrfDefault | EndpointCsrfExempt));

/** An endpoint with its path attached, as returned by `endpoint()`. */
export interface EndpointDeclaration<
  Path extends string = string,
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = EndpointMount,
  Db = unknown,
> extends Endpoint<Path, Method, Mount> {
  db?: true;
  handler: EndpointHandler | EndpointDbHandler<Db>;
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
  Db = unknown,
>(
  path: Path,
  definition: EndpointDefinition<Method, Mount, Db>,
): EndpointDeclaration<Path, Method, Mount, Db> {
  const mount = (definition.mount ?? 'exact') as Mount;
  const reason = definition.reason ?? definition.purpose;
  if (reason === undefined) {
    throw new TypeError('endpoint() requires either reason or purpose');
  }

  return {
    ...(definition.access === undefined ? {} : { access: definition.access }),
    ...(definition.auth === undefined ? {} : { auth: definition.auth }),
    ...(definition.csrf === false
      ? { csrf: { exempt: true, justification: definition.csrfJustification } }
      : {}),
    ...(definition.db === true ? { db: true as const } : {}),
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
  options: EndpointRunOptions = {},
): Promise<Response> {
  const endpointRequest = endpointRequestWithoutSession(request);
  const response =
    definition.db === true
      ? await (definition.handler as EndpointDbHandler)(
          endpointRequest,
          createEndpointDbContext(endpointRequest, definition, options),
        )
      : await (definition.handler as EndpointHandler)(endpointRequest);
  assertEndpointResponsePosture(definition, response);
  return response;
}

export interface EndpointRunOptions<Db = unknown> {
  db?: DbProvider<EndpointRequest, Db, never>;
}

function createEndpointDbContext<Db>(
  request: EndpointRequest,
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  options: EndpointRunOptions<Db>,
): EndpointDbContext<Db> {
  return {
    async actAs(principalId) {
      if (options.db === undefined) {
        throw new Error(
          'endpoint({ db: true }) requires createApp({ db }) before ctx.actAs(id) can resolve a managed endpoint DB handle (SPEC §10.3 DEC-H).',
        );
      }
      const principalPosture = actAsNonRequestPrincipal(principalId, {
        ingress: 'endpoint',
        operation: 'read',
        surface: definition.path,
      });
      const dbRequest = requestWithEndpointPrincipalPosture(request, principalPosture);
      const rawDb = await options.db(dbRequest);
      return {
        db: {
          read: managedDb(rawDb, 'read'),
          write: managedDb(rawDb, 'write'),
        },
      };
    },
  };
}

function requestWithEndpointPrincipalPosture(
  request: EndpointRequest,
  principalPosture: NonRequestPrincipalPosture,
): EndpointDbProviderRequest {
  const next = request.clone() as EndpointDbProviderRequest;
  Object.defineProperty(next, 'principalPosture', {
    configurable: true,
    enumerable: false,
    value: principalPosture,
    writable: false,
  });
  return next;
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

export { endpointRequestWithoutSession };

function endpointAuthFailureResponse(): Response {
  return finalizeServerResponse(
    {
      body: 'Unauthorized',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 401,
    },
    { method: 'GET' },
  );
}
