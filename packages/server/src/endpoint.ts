import type { WebhookVerifier } from '@kovojs/core';
import { isFrameworkHmacSignatureVerifier } from '@kovojs/core/internal/verifier';
import { accessDecisionFor, pinAccessDecision, type AccessDecision } from './access.js';
import {
  snapshotAuditJustification,
  snapshotAuditReason,
  snapshotAuditText,
} from './audit-justification.js';
import { actAsNonRequestPrincipal, type NonRequestPrincipalPosture } from './auth-principal.js';
import {
  resolveDbProvider,
  runAccessDecisionGuards,
  type DbProvider,
  type ResolvedGuardFailure,
} from './guards.js';
import { managedDb, type Reader, type Writer } from './managed-db.js';
import {
  markEndpointBrowserCredentialDelegation,
  markEndpointSelfVerifying,
  markEndpointVerifierExecuted,
} from './endpoint-auth-proof.js';
import { pinRequestIngressSurface, requestVerifierInput } from './app-load-shed.js';
import { requestClone } from './request-body-intrinsics.js';
import { canonicalRequestMethod, isSafeEndpointMethod } from './request-method.js';
import { securityNumberIsInteger } from './response-security-intrinsics.js';
import type { RedirectLocationAllowlistEntry } from './response.js';
import {
  assertEndpointResponsePosture,
  endpointRequestWithoutSession,
  finalizeServerResponse,
} from './response-posture.js';
import {
  createWitnessWeakMap,
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
  witnessReflectApply,
  witnessReflectGet,
  witnessWeakMapGet,
  witnessWeakMapHas,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

export type { RedirectLocationAllowlistEntry } from './response.js';

/** Canonical uppercase HTTP method for an endpoint; custom verbs are allowed. */
export type EndpointMethod =
  | 'DELETE'
  | 'GET'
  | 'HEAD'
  | 'OPTIONS'
  | 'PATCH'
  | 'POST'
  | 'PUT'
  | (string & {});

/** Closed safe-method set whose framework-owned endpoint capabilities are read-only (SPEC §9.1). */
export type EndpointSafeMethod = 'GET' | 'HEAD' | 'OPTIONS';

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

/** Records an explicit, justified opt-out of default-on CSRF for an unsafe endpoint (SPEC §6.6). */
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
  browserCredentialDelegation?: true;
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

/**
 * Principal-scoped endpoint DB capabilities. Safe methods receive only `read`; a statically known
 * unsafe method receives `write` too. The runtime independently enforces the same split (SPEC
 * §9.1), so this conditional type is defense-in-depth rather than the security proof.
 */
export type EndpointDbScope<Db = unknown, Method extends EndpointMethod = EndpointSafeMethod> = {
  readonly db: {
    readonly read: Reader<Db>;
  } & (string extends Method
    ? object
    : Uppercase<Method> extends EndpointSafeMethod
      ? object
      : { readonly write: Writer<Db> });
};

/** Context exposed only to `endpoint(..., { db: true, handler(req, ctx) { ... } })`. */
export interface EndpointDbContext<
  Db = unknown,
  Method extends EndpointMethod = EndpointSafeMethod,
> {
  /**
   * SPEC §10.3 DEC-H: endpoints do not inherit a session principal. App code must derive and
   * validate the owner id from its own endpoint auth before receiving managed DB capabilities.
   */
  actAs(principalId: string): Promise<EndpointDbScope<Db, Method>>;
}

/** An endpoint handler: maps a session-free `Request` to a `Response`. */
export type EndpointHandler = (request: EndpointRequest) => Promise<Response> | Response;

/** An endpoint handler that opted into an explicit principal-scoped DB context. */
export type EndpointDbHandler<Db = unknown, Method extends EndpointMethod = EndpointSafeMethod> = (
  request: EndpointRequest,
  context: EndpointDbContext<Db, Method>,
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
  handler: EndpointDbHandler<Db, Method>;
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

/** The body passed to `endpoint()`: handler, method/mount, and the unsafe-method CSRF choice. */
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
  handler: EndpointHandler | EndpointDbHandler<Db, EndpointMethod>;
}

/**
 * Declare a raw HTTP endpoint: a `handler` taking a `Request` and returning a
 * `Response`, mounted at an exact path or a path `prefix`. Endpoints are the
 * escape hatch for machine traffic (webhooks, APIs) that bypasses the page/query
 * pipeline, so every declaration carries audit metadata: explicit `method`,
 * endpoint-level `reason`, raw response posture, and a prefix mount
 * justification when `mount: 'prefix'` is used. Unsafe methods are CSRF-default-on; the closed
 * GET/HEAD/OPTIONS set is reader-only and browser-state-effect-free. Opt an unsafe method out with
 * `csrf: false` plus a justification (SPEC §6.6 and §9.1).
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
  return witnessFreeze(constructEndpointDeclaration(path, definition)) as EndpointDeclaration<
    Path,
    Method,
    Mount,
    Db
  >;
}

/**
 * Construct a framework-owned endpoint, synchronously attach private framework metadata, then
 * close the declaration before it becomes caller-visible. This is deliberately absent from the
 * public routing API: app-authored endpoints must use {@link endpoint}, whose authority is closed
 * immediately (SPEC §6.6/§9.1).
 *
 * @internal
 */
export function frameworkEndpoint<
  const Path extends string,
  const Method extends EndpointMethod = EndpointMethod,
  const Mount extends EndpointMount = 'exact',
  Db = unknown,
>(
  path: Path,
  definition: EndpointDefinition<Method, Mount, Db>,
  decorate: (declaration: EndpointDeclaration<Path, Method, Mount, Db>) => void,
): EndpointDeclaration<Path, Method, Mount, Db> {
  const declaration = constructEndpointDeclaration(path, definition);
  const result = decorate(declaration);
  if (result !== undefined) {
    throw new TypeError('Framework endpoint decoration must complete synchronously.');
  }
  return witnessFreeze(declaration) as EndpointDeclaration<Path, Method, Mount, Db>;
}

function constructEndpointDeclaration<
  const Path extends string,
  const Method extends EndpointMethod = EndpointMethod,
  const Mount extends EndpointMount = 'exact',
  Db = unknown,
>(
  path: Path,
  definition: EndpointDefinition<Method, Mount, Db>,
): EndpointDeclaration<Path, Method, Mount, Db> {
  if (typeof definition !== 'object' || definition === null || witnessIsArray(definition)) {
    throw new TypeError('endpoint() requires a stable own-data definition record.');
  }
  const access = stableEndpointValue(definition, 'access');
  const auth = stableEndpointValue(definition, 'auth');
  const csrf = stableEndpointValue(definition, 'csrf');
  const csrfJustification = stableEndpointValue(definition, 'csrfJustification');
  const db = stableEndpointValue(definition, 'db');
  const handler = stableRequiredEndpointValue(definition, 'handler');
  const method = stableRequiredEndpointValue(definition, 'method');
  const mountValue = stableEndpointValue(definition, 'mount');
  const mountJustification = stableEndpointValue(definition, 'mountJustification');
  const reason = stableRequiredEndpointValue(definition, 'reason');
  const responseValue = stableRequiredEndpointValue(definition, 'response');
  const mount = (mountValue ?? 'exact') as Mount;

  if (typeof method !== 'string' || method === '') {
    throw new TypeError('endpoint() requires a non-empty method');
  }
  if (canonicalRequestMethod(method) !== method) {
    throw new TypeError('endpoint() method must use its canonical uppercase spelling');
  }
  if (typeof handler !== 'function') {
    throw new TypeError('endpoint() requires an own data handler function');
  }
  const closedReason = snapshotAuditReason(reason, 'endpoint() (SPEC §6.6/§9.1)');
  if (mount !== 'exact' && mount !== 'prefix') {
    throw new TypeError('endpoint() mount must be exact or prefix');
  }
  const closedMountJustification =
    mountJustification === undefined
      ? undefined
      : snapshotAuditJustification(mountJustification, 'endpoint() mountJustification (SPEC §9.1)');
  if (mount === 'prefix' && closedMountJustification === undefined) {
    throw new TypeError('endpoint() prefix mounts require a non-empty mountJustification');
  }
  if (csrf !== undefined && csrf !== true && csrf !== false) {
    throw new TypeError('endpoint() csrf must be true or false');
  }
  const closedCsrfJustification =
    csrf === false
      ? snapshotAuditJustification(csrfJustification, 'endpoint() csrf:false (SPEC §6.6/§9.1)')
      : undefined;
  if (db !== undefined && db !== true && db !== false) {
    throw new TypeError('endpoint() db must be true or false');
  }
  const response = snapshotEndpointResponsePosture(responseValue);
  const declarationRecord = witnessCreateNullRecord<unknown>();
  if (csrf === false) {
    declarationRecord.csrf = witnessFreeze({
      exempt: true as const,
      justification: closedCsrfJustification as string,
    });
  }
  if (db === true) declarationRecord.db = true;
  declarationRecord.handler = handler;
  declarationRecord.method = method;
  declarationRecord.mount = mount;
  if (closedMountJustification !== undefined) {
    declarationRecord.mountJustification = closedMountJustification;
  }
  declarationRecord.path = path;
  declarationRecord.reason = closedReason;
  declarationRecord.response = response;
  const declaration = pinAccessDecision(
    declarationRecord as unknown as EndpointDeclaration<Path, Method, Mount, Db>,
    access as AccessDecision | undefined,
  );
  pinEndpointAuth(declaration, auth as EndpointAuthDeclaration | undefined);
  return declaration;
}

function snapshotEndpointResponsePosture(source: unknown): EndpointResponsePosture {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('endpoint().response must be a stable own-data record.');
  }
  const appOwnedSafety = stableRequiredEndpointValue(source, 'appOwnedSafety');
  const bodySource = stableRequiredEndpointValue(source, 'body');
  const cache = stableRequiredEndpointValue(source, 'cache');
  const redirectAllowlistSource = stableEndpointValue(source, 'redirectAllowlist');
  const reservedHeadersSource = stableEndpointValue(source, 'reservedHeaders');
  if (typeof appOwnedSafety !== 'boolean') {
    throw new TypeError('endpoint().response.appOwnedSafety must be a boolean.');
  }
  if (!isEndpointCachePosture(cache)) {
    throw new TypeError('endpoint().response.cache has an invalid posture.');
  }
  const body = snapshotEndpointResponseBody(bodySource);
  const redirectAllowlist =
    redirectAllowlistSource === undefined
      ? undefined
      : snapshotEndpointRedirectAllowlist(redirectAllowlistSource);
  const reservedHeaders =
    reservedHeadersSource === undefined
      ? undefined
      : snapshotEndpointStringArray(reservedHeadersSource, 'endpoint().response.reservedHeaders');
  const snapshot = witnessCreateNullRecord<unknown>();
  snapshot.appOwnedSafety = appOwnedSafety;
  snapshot.body = body;
  snapshot.cache = cache;
  snapshot.redirectAllowlist = redirectAllowlist;
  snapshot.reservedHeaders = reservedHeaders;
  return witnessFreeze(snapshot) as unknown as EndpointResponsePosture;
}

function snapshotEndpointResponseBody(source: unknown): EndpointResponseBodyPosture {
  if (typeof source === 'string') {
    if (!isEndpointResponseBody(source)) {
      throw new TypeError('endpoint().response.body has an invalid posture.');
    }
    return source;
  }
  const values = snapshotEndpointArray(source, 'endpoint().response.body');
  if (values.length === 0) {
    throw new TypeError('endpoint().response.body must not be empty.');
  }
  const bodies: EndpointResponseBody[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!isEndpointResponseBody(value)) {
      throw new TypeError('endpoint().response.body has an invalid posture.');
    }
    witnessArrayAppend(bodies, value, 'Endpoint response body posture');
  }
  return witnessFreeze(bodies) as unknown as EndpointResponseBodyPosture;
}

function snapshotEndpointRedirectAllowlist(
  source: unknown,
): readonly RedirectLocationAllowlistEntry[] {
  const values = snapshotEndpointArray(source, 'endpoint().response.redirectAllowlist');
  const snapshot: RedirectLocationAllowlistEntry[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
      throw new TypeError('endpoint redirect allowlist entries must be stable records.');
    }
    const origin = stableRequiredEndpointValue(value, 'origin');
    const reason = stableRequiredEndpointValue(value, 'reason');
    if (typeof origin !== 'string') {
      throw new TypeError('endpoint redirect allowlist entries require string origin and reason.');
    }
    witnessArrayAppend(
      snapshot,
      witnessFreeze({
        origin,
        reason: snapshotAuditReason(reason, 'endpoint redirect allowlist entry (SPEC §9.1)'),
      }),
      'Endpoint redirect allowlist',
    );
  }
  return witnessFreeze(snapshot);
}

function snapshotEndpointStringArray(source: unknown, label: string): readonly string[] {
  const values = snapshotEndpointArray(source, label);
  const snapshot: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== 'string') throw new TypeError(`${label} must contain strings.`);
    witnessArrayAppend(snapshot, value, label);
  }
  return witnessFreeze(snapshot);
}

function snapshotEndpointArray(source: unknown, label: string): unknown[] {
  if (!witnessIsArray(source)) throw new TypeError(`${label} must be an array.`);
  const length = stableRequiredEndpointValue(source, 'length');
  if (
    typeof length !== 'number' ||
    !securityNumberIsInteger(length) ||
    length < 0 ||
    length > 100_000
  ) {
    throw new TypeError(`${label} must be a bounded dense array.`);
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = stableEndpointDescriptor(source, index);
    if (descriptor === undefined) throw new TypeError(`${label} must be a bounded dense array.`);
    witnessArrayAppend(snapshot, descriptor.value, label);
  }
  return snapshot;
}

function stableRequiredEndpointValue(source: object, property: PropertyKey): unknown {
  const descriptor = stableEndpointDescriptor(source, property);
  if (descriptor === undefined) {
    throw new TypeError(`endpoint() ${String(property)} must be an own data property.`);
  }
  return descriptor.value;
}

function stableEndpointValue(source: object, property: PropertyKey): unknown {
  return stableEndpointDescriptor(source, property)?.value;
}

function stableEndpointDescriptor(
  source: object,
  property: PropertyKey,
): { value: unknown } | undefined {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if ((before === undefined) !== (after === undefined)) {
    throw new TypeError(`endpoint() ${String(property)} must be stable.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || after === undefined || !('value' in after)) {
    throw new TypeError(`endpoint() ${String(property)} must be an own data property.`);
  }
  if (!witnessObjectIs(before.value, after.value)) {
    throw new TypeError(`endpoint() ${String(property)} changed during validation.`);
  }
  return { value: before.value };
}

function isEndpointResponseBody(value: unknown): value is EndpointResponseBody {
  return (
    value === 'bytes' ||
    value === 'html' ||
    value === 'json' ||
    value === 'redirect' ||
    value === 'stream' ||
    value === 'text'
  );
}

function isEndpointCachePosture(value: unknown): value is EndpointCachePosture {
  return (
    value === 'custom' ||
    value === 'no-store' ||
    value === 'private' ||
    value === 'public' ||
    value === 'revalidated'
  );
}

/** @internal Pin endpoint machine-auth metadata and its executable verifier with the access fact. */
export function pinEndpointAuth<Declaration extends object>(
  declaration: Declaration,
  auth: EndpointAuthDeclaration | undefined,
): Declaration {
  if (witnessWeakMapHas(pinnedEndpointAuth, declaration)) return declaration;
  const snapshot = snapshotEndpointAuth(auth);
  witnessDefineProperty(declaration, 'auth', {
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

/**
 * Mark a framework-owned self-verifying protocol adapter that authenticates through the inbound
 * browser Cookie/Authorization carrier it delegates to a closed handler. The private witness is
 * consumed by the request-neutralization boundary; app-authored endpoint metadata and structural
 * clones cannot request this exception (SPEC §6.6/§9.1).
 *
 * @internal
 */
export function pinEndpointBrowserCredentialDelegation<
  Declaration extends object & { auth?: EndpointAuthDeclaration },
>(declaration: Declaration): Declaration {
  pinEndpointSelfVerifyingAuth(declaration);
  const snapshot = endpointAuthSnapshotFor(declaration);
  witnessWeakMapSet(pinnedEndpointAuth, declaration, {
    ...snapshot,
    browserCredentialDelegation: true,
  });
  markEndpointBrowserCredentialDelegation(declaration);
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
  witnessDefineProperty(target, 'auth', {
    configurable: false,
    enumerable: snapshot.auth !== undefined,
    value: snapshot.auth,
    writable: false,
  });
  witnessWeakMapSet(pinnedEndpointAuth, target, snapshot);
  if (snapshot.selfVerifying === true) markEndpointSelfVerifying(target);
  if (snapshot.browserCredentialDelegation === true) {
    markEndpointBrowserCredentialDelegation(target);
  }
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
    witnessDefineProperty(declaration, 'auth', {
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
        auth: witnessFreeze({
          kind: 'none',
          justification: snapshotAuditJustification(
            justification.value,
            'endpoint() auth:none (SPEC §9.1)',
          ),
        }),
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
    const authKind = kind.value === 'custom' ? 'custom' : 'verifier';
    const closedName = snapshotAuditText(name.value, `endpoint() auth:${authKind} name`);
    if (
      verifier !== undefined &&
      (executable === undefined ||
        (kind.value === 'custom' &&
          (executable.kind !== 'custom' || executable.auditName !== closedName)) ||
        (kind.value === 'verifier' &&
          (executable.kind !== 'hmac' || executable.auditName !== closedName)))
    ) {
      return { auth: undefined, valid: false };
    }
    return {
      auth: witnessFreeze({
        kind: authKind,
        name: closedName,
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
      verify: async (request) => (await witnessReflectApply(verify, value, [request])) === true,
    };
  }
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) return undefined;

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
      return (await witnessReflectApply(verify, canonical, [request])) === true;
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
    declaration: definition,
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
    declaration: definition,
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
): EndpointDbContext<Db, EndpointMethod> {
  return {
    async actAs(principalId) {
      if (options.db === undefined) {
        throw new Error(
          'endpoint({ db: true }) requires createApp({ db }) before ctx.actAs(id) can resolve a managed endpoint DB handle (SPEC §10.3 DEC-H).',
        );
      }
      const safeMethod = isSafeEndpointMethod(definition.method);
      const principalPosture = actAsNonRequestPrincipal(principalId, {
        ingress: 'endpoint',
        operation: safeMethod ? 'read' : 'write',
        surface: definition.path,
      });
      const dbRequest = requestWithEndpointPrincipalPosture(request, principalPosture);
      const rawDb = await resolveDbProvider(options.db, dbRequest);
      const db = witnessCreateNullRecord<unknown>();
      db.read = managedDb(rawDb, 'read');
      if (!safeMethod) db.write = managedDb(rawDb, 'write');
      return { db } as EndpointDbScope<Db, EndpointMethod>;
    },
  };
}

function requestWithEndpointPrincipalPosture(
  request: EndpointRequest,
  principalPosture: NonRequestPrincipalPosture,
): EndpointDbProviderRequest {
  const next = requestClone(request) as EndpointDbProviderRequest;
  pinRequestIngressSurface(next);
  witnessDefineProperty(next, 'principalPosture', {
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
    const authRequest = endpointRequestWithoutSession(request, {
      declaration: definition,
      stripAuthorization: definition.csrf?.exempt === true,
    });
    verified = await auth.verify(await requestVerifierInput(authRequest));
  } catch {
    verified = false;
  }

  if (verified !== true) return endpointAuthFailureResponse();
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
    const declaredMethod = canonicalRequestMethod(definition.method);
    const requestMethod = canonicalRequestMethod(input.method);
    if (
      requestMethod !== declaredMethod &&
      !(declaredMethod === 'GET' && requestMethod === 'HEAD')
    ) {
      return false;
    }
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
