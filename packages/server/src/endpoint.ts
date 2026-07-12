import type { WebhookVerifier } from '@kovojs/core';
import { isFrameworkHmacSignatureVerifier } from '@kovojs/core/internal/verifier';
import { accessDecisionFor, pinAccessDecision, type AccessDecision } from './access.js';
import { actAsNonRequestPrincipal, type NonRequestPrincipalPosture } from './auth-principal.js';
import { runAccessDecisionGuards, type DbProvider, type ResolvedGuardFailure } from './guards.js';
import { managedDb, type Reader, type Writer } from './managed-db.js';
import { markEndpointSelfVerifying, markEndpointVerifierExecuted } from './endpoint-auth-proof.js';
import type { RedirectLocationAllowlistEntry } from './response.js';
import {
  assertEndpointResponsePosture,
  endpointRequestWithoutSession,
  finalizeServerResponse,
} from './response-posture.js';
import {
  createWitnessWeakMap,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessReflectApply,
  witnessReflectGet,
  witnessWeakMapGet,
  witnessWeakMapHas,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

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

type EndpointVerifierRequest = Parameters<WebhookVerifier['verify']>[0];

interface PinnedEndpointAuth {
  auth: EndpointAuthDeclaration | undefined;
  selfVerifying?: true;
  valid: boolean;
  verify?: (request: EndpointVerifierRequest) => Promise<boolean>;
}

interface PinnedExecutableVerifier {
  auditName: string;
  kind: WebhookVerifier['kind'];
  verifier: WebhookVerifier;
  verify: (request: EndpointVerifierRequest) => Promise<boolean>;
}

const pinnedEndpointAuth = createWitnessWeakMap<object, PinnedEndpointAuth>();

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
  | (EndpointDefinitionBase<Method> & { reason: string } & EndpointMountDefinition<Mount> &
      (EndpointCsrfDefault | EndpointCsrfExempt))
  | (EndpointDbDefinitionBase<Method, Db> & { reason: string } & EndpointMountDefinition<Mount> &
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
 * endpoint-level `reason`, raw response posture, and a prefix mount
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
  if (definition.reason.trim() === '') {
    throw new TypeError('endpoint() requires a non-empty reason');
  }
  const declaration = pinAccessDecision(
    {
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
      reason: definition.reason,
      response: definition.response,
    } as EndpointDeclaration<Path, Method, Mount, Db>,
    definition.access,
  );
  pinEndpointAuth(declaration, definition.auth);
  return declaration;
}

/** @internal Pin endpoint machine-auth metadata and its executable verifier with the access fact. */
export function pinEndpointAuth<Declaration extends object>(
  declaration: Declaration,
  auth: EndpointAuthDeclaration | undefined,
): Declaration {
  if (witnessWeakMapHas(pinnedEndpointAuth, declaration)) return declaration;
  const snapshot = snapshotEndpointAuth(auth);
  Object.defineProperty(declaration, 'auth', {
    configurable: false,
    enumerable: auth !== undefined,
    value: snapshot.auth,
    writable: false,
  });
  witnessWeakMapSet(pinnedEndpointAuth, declaration, snapshot);
  return declaration;
}

/** @internal Resolve one endpoint's immutable machine-auth declaration. */
export function endpointAuthFor(
  declaration: object & { auth?: EndpointAuthDeclaration },
): EndpointAuthDeclaration | undefined {
  return endpointAuthSnapshotFor(declaration).auth;
}

/** @internal Whether the endpoint has an executable verifier pinned at declaration/assembly. */
export function endpointHasExecutableVerifier(
  declaration: object & { auth?: EndpointAuthDeclaration },
): boolean {
  return endpointAuthSnapshotFor(declaration).verify !== undefined;
}

/**
 * Mark a framework-owned endpoint whose handler contains its own fail-closed verifier sink.
 *
 * The witness stays in the module-private endpoint-auth WeakMap and is copied only by the app
 * snapshot path. App-authored names, symbols, or structural clones cannot mint it (SPEC §6.6/§9.1).
 *
 * @internal
 */
export function pinEndpointSelfVerifyingAuth<
  Declaration extends object & { auth?: EndpointAuthDeclaration },
>(declaration: Declaration): Declaration {
  const snapshot = endpointAuthSnapshotFor(declaration);
  if (
    !snapshot.valid ||
    snapshot.auth === undefined ||
    snapshot.auth.kind === 'none' ||
    snapshot.verify !== undefined
  ) {
    throw new TypeError(
      'Framework self-verifying endpoint identity requires valid named auth without a separate verifier.',
    );
  }
  witnessWeakMapSet(pinnedEndpointAuth, declaration, { ...snapshot, selfVerifying: true });
  markEndpointSelfVerifying(declaration);
  return declaration;
}

/** @internal Whether a canonical endpoint carries the private self-verifying handler witness. */
export function endpointHasSelfVerifyingAuth(
  declaration: object & { auth?: EndpointAuthDeclaration },
): boolean {
  return endpointAuthSnapshotFor(declaration).selfVerifying === true;
}

/**
 * @internal Copy the already-pinned auth/verifier snapshot onto a canonical app declaration.
 *
 * Re-snapshotting `source.auth` would reopen a validation/use gap: the verifier object is
 * app-owned and its `.verify` method may have changed since endpoint() captured it. The app
 * aggregate must carry the exact verifier closure that audit and request dispatch already share.
 */
export function copyEndpointAuthSnapshot<Declaration extends object>(
  source: object & { auth?: EndpointAuthDeclaration },
  target: Declaration,
): Declaration {
  if (witnessWeakMapHas(pinnedEndpointAuth, target)) return target;
  const snapshot = endpointAuthSnapshotFor(source);
  Object.defineProperty(target, 'auth', {
    configurable: false,
    enumerable: snapshot.auth !== undefined,
    value: snapshot.auth,
    writable: false,
  });
  witnessWeakMapSet(pinnedEndpointAuth, target, snapshot);
  if (snapshot.selfVerifying === true) markEndpointSelfVerifying(target);
  return target;
}

function endpointAuthSnapshotFor(
  declaration: object & { auth?: EndpointAuthDeclaration },
): PinnedEndpointAuth {
  const pinned = witnessWeakMapGet(pinnedEndpointAuth, declaration);
  if (pinned !== undefined) return pinned;

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = witnessGetOwnPropertyDescriptor(declaration, 'auth');
  } catch {
    throw new TypeError('Endpoint auth declaration must expose a stable own data property.');
  }
  const auth =
    descriptor !== undefined && 'value' in descriptor
      ? (descriptor.value as EndpointAuthDeclaration | undefined)
      : undefined;
  const snapshot =
    descriptor !== undefined && !('value' in descriptor)
      ? ({ auth: undefined, valid: false } satisfies PinnedEndpointAuth)
      : snapshotEndpointAuth(auth);
  try {
    Object.defineProperty(declaration, 'auth', {
      configurable: false,
      enumerable: descriptor?.enumerable ?? auth !== undefined,
      value: snapshot.auth,
      writable: false,
    });
  } catch {
    // Frozen structural declarations still consume the private authoritative snapshot.
  }
  witnessWeakMapSet(pinnedEndpointAuth, declaration, snapshot);
  return snapshot;
}

function snapshotEndpointAuth(auth: EndpointAuthDeclaration | undefined): PinnedEndpointAuth {
  if (auth === undefined) return { auth: undefined, valid: true };

  try {
    const kind = witnessGetOwnPropertyDescriptor(auth, 'kind');
    if (kind === undefined || !('value' in kind)) return { auth: undefined, valid: false };
    if (kind.value === 'none') {
      const justification = witnessGetOwnPropertyDescriptor(auth, 'justification');
      if (
        justification === undefined ||
        !('value' in justification) ||
        typeof justification.value !== 'string'
      ) {
        return { auth: undefined, valid: false };
      }
      return {
        auth: witnessFreeze({ kind: 'none', justification: justification.value }),
        valid: true,
      };
    }
    if (kind.value !== 'custom' && kind.value !== 'verifier') {
      return { auth: undefined, valid: false };
    }
    const name = witnessGetOwnPropertyDescriptor(auth, 'name');
    if (name === undefined || !('value' in name) || typeof name.value !== 'string') {
      return { auth: undefined, valid: false };
    }
    const verifierDescriptor = witnessGetOwnPropertyDescriptor(auth, 'verify');
    const verifier =
      verifierDescriptor !== undefined && 'value' in verifierDescriptor
        ? verifierDescriptor.value
        : undefined;
    const executable = verifier === undefined ? undefined : snapshotExecutableVerifier(verifier);
    if (
      verifier !== undefined &&
      (executable === undefined ||
        (kind.value === 'custom' &&
          (executable.kind !== 'custom' || executable.auditName !== name.value)) ||
        (kind.value === 'verifier' &&
          (executable.kind !== 'hmac' || executable.auditName !== name.value)))
    ) {
      return { auth: undefined, valid: false };
    }
    return {
      auth: witnessFreeze({
        kind: kind.value,
        name: name.value,
        ...(executable === undefined ? {} : { verify: executable.verifier }),
      }),
      valid: true,
      ...(executable === undefined
        ? {}
        : { verify: (request: EndpointVerifierRequest) => executable.verify(request) }),
    };
  } catch {
    return { auth: undefined, valid: false };
  }
}

function snapshotExecutableVerifier(value: unknown): PinnedExecutableVerifier | undefined {
  if (isFrameworkHmacSignatureVerifier(value)) {
    const verify = witnessGetOwnPropertyDescriptor(value, 'verify')?.value as
      | WebhookVerifier['verify']
      | undefined;
    if (typeof verify !== 'function') return undefined;
    return {
      auditName: value.resolved.scheme,
      kind: 'hmac',
      verifier: value,
      verify: async (request) => Boolean(await witnessReflectApply(verify, value, [request])),
    };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  const kind = stableVerifierValue(value, 'kind');
  const name = stableVerifierValue(value, 'name');
  const scheme = stableVerifierValue(value, 'scheme');
  const verify = stableVerifierValue(value, 'verify');
  if (
    kind !== 'custom' ||
    typeof name !== 'string' ||
    typeof scheme !== 'string' ||
    typeof verify !== 'function'
  ) {
    return undefined;
  }

  let canonical: WebhookVerifier;
  canonical = witnessFreeze({
    kind: 'custom',
    name,
    scheme,
    async verify(request: EndpointVerifierRequest): Promise<boolean> {
      return Boolean(await witnessReflectApply(verify, canonical, [request]));
    },
  });
  return {
    auditName: name,
    kind: 'custom',
    verifier: canonical,
    verify: (request) => canonical.verify(request),
  };
}

function stableVerifierValue(source: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined || !('value' in before)) return undefined;
  const observed = witnessReflectGet(source, property, source);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (!sameVerifierDescriptor(before, after) || !Object.is(observed, before.value)) {
    throw new TypeError('Endpoint verifier fields must be stable own data properties.');
  }
  return before.value;
}

function sameVerifierDescriptor(left: PropertyDescriptor, right: PropertyDescriptor | undefined) {
  return (
    right !== undefined &&
    'value' in right &&
    Object.is(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
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
  const endpointRequest = endpointRequestWithoutSession(request, {
    stripAuthorization: definition.csrf?.exempt === true,
  });
  const accessFailure = await runEndpointAccessDecision(definition, endpointRequest);
  if (accessFailure) return accessFailure;

  const response =
    definition.db === true
      ? await (definition.handler as EndpointDbHandler)(
          endpointRequest,
          createEndpointDbContext(endpointRequest, definition, options),
        )
      : await (definition.handler as EndpointHandler)(endpointRequest);
  assertEndpointResponsePosture(definition, response, { request });
  return response;
}

/**
 * @internal Run the endpoint/webhook access decision through the shared fail-closed gate.
 *
 * Webhook dispatch needs this separately because it threads app DB/task options into runWebhook()
 * instead of invoking the generic endpoint handler. Keeping the gate here prevents that special
 * branch from bypassing the exact guard chain recorded by the access graph (SPEC §9.5/§10.2).
 */
export async function runEndpointAccessDecision(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  request: Request,
): Promise<Response | undefined> {
  const endpointRequest = endpointRequestWithoutSession(request, {
    stripAuthorization: definition.csrf?.exempt === true,
  });
  const guardFailure = await runAccessDecisionGuards(
    accessDecisionFor(definition),
    undefined,
    endpointRequest,
  );
  return guardFailure === null ? undefined : endpointAccessGuardFailureResponse(guardFailure);
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
  const auth = endpointAuthSnapshotFor(definition);
  if (!auth.valid) return endpointAuthFailureResponse();
  if (auth.verify === undefined) {
    if (auth.auth === undefined || auth.auth.kind === 'none' || auth.selfVerifying === true) {
      return undefined;
    }
    return endpointAuthFailureResponse();
  }

  let verified = false;
  try {
    const authRequest = endpointRequestWithoutSession(request.clone(), {
      stripAuthorization: definition.csrf?.exempt === true,
    });
    verified = await auth.verify({
      headers: authRequest.headers,
      payload: new Uint8Array(await authRequest.arrayBuffer()),
    });
  } catch {
    verified = false;
  }

  if (!verified) return endpointAuthFailureResponse();
  markEndpointVerifierExecuted(definition, request);
  return undefined;
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

function endpointAccessGuardFailureResponse(failure: ResolvedGuardFailure): Response {
  const status = failure.status === 429 ? 429 : failure.auth === 'unauthenticated' ? 401 : 403;
  return finalizeServerResponse(
    {
      body: status === 429 ? 'Rate Limited' : status === 401 ? 'Unauthorized' : 'Forbidden',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(failure.retryAfter === undefined ? {} : { 'Retry-After': String(failure.retryAfter) }),
      },
      status,
    },
    { method: 'GET' },
  );
}
