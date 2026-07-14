import type { Redirect as CoreRedirect } from '@kovojs/core';
import {
  executableGuardAccessDecision,
  snapshotAccessDecision,
  type AccessDecision,
} from './access.js';
import { snapshotAuditText } from './audit-justification.js';
import {
  mergeVaryHeader,
  renderErrorDocument,
  stampGuardFailureDocumentSecurityFloor,
} from './document-core.js';
import { managedDb, type ManagedDbMode } from './managed-db.js';
import { inheritAnonymousCsrfLiveTargetBinding } from './csrf.js';
import {
  authorityMetadataSource,
  pinnedRequestCarrier,
  registerAuthorityNeutralRequestMetadata,
  requestForAuthorityNeutralMetadata,
  snapshotPinnedLifecycleValue,
} from './request-carrier.js';
import type { ManagedSqlWritePolicy } from './sql-safe-handle.js';
import type { ServerErrorHandler } from './diagnostics.js';
import {
  inheritFrameworkPrincipalSnapshot,
  type NonRequestPrincipalPosture,
  principalPostureFromRequest,
  registerFrameworkSessionPrincipalSnapshot,
  requestPrincipalSnapshot,
} from './auth-principal.js';
import { matchRoute, type RouteLike } from './match.js';
import {
  blessRedirectResponse,
  redirectLocationHeader,
  type ResponseHeaders,
  type ServerResponseBase,
} from './response.js';
import type { Schema } from './schema.js';
import {
  requestStateIsSafeInteger,
  requestStateIsSingleLeadingSlashPath,
  requestStateLocationWithQuery,
  requestStateNow,
  requestStatePathname,
  requestStateRequiredRateLimitKey,
  requestStateRetryAfterSeconds,
  requestStateSameOriginPath,
} from './request-state-intrinsics.js';
import {
  createWitnessMap,
  createWitnessSet,
  createWitnessWeakMap,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapDelete,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessMapSize,
  witnessObjectIs,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import {
  securityStringSlice,
  securityStringStartsWith,
  securityStringTrim,
} from './response-security-intrinsics.js';

/**
 * A guard denial that expresses the user-facing *intent* of a rejection, leaving
 * the HTTP status to the framework. SPEC §6.5 fixes the three outcomes: an
 * unauthenticated caller is sent through the app's `onUnauthenticated` handler
 * (default: a 303 redirect to the login route with the original URL as `next`);
 * an authenticated-but-unauthorized caller renders the app's 403 shell; a
 * rate-limited caller gets a 429 carrying `retryAfter` seconds. The wire status
 * is derived from `kind` inside the framework (`renderHttpGuardFailureResponse`),
 * so an author reads the intent, not a transport detail. Return `true` to allow.
 */
export type GuardDenial = UnauthenticatedDenial | ForbiddenDenial | RateLimitedDenial;

/**
 * The caller is not authenticated. SPEC §6.5: the framework runs the app's
 * `onUnauthenticated` handler, whose default is a 303 redirect to the login
 * route with the original URL available as `next`.
 */
export interface UnauthenticatedDenial {
  kind: 'unauthenticated';
  payload?: Record<string, unknown>;
}

/**
 * The caller is authenticated but not permitted. SPEC §6.5: the framework
 * renders the app's 403 shell with status 403.
 */
export interface ForbiddenDenial {
  kind: 'forbidden';
  payload?: Record<string, unknown>;
}

/**
 * The caller exceeded a rate limit. SPEC §6.5: the framework answers 429 and
 * surfaces `retryAfter` (seconds) as a `Retry-After` header.
 */
export interface RateLimitedDenial {
  kind: 'rateLimited';
  payload?: Record<string, unknown>;
  retryAfter?: number;
}

/** What a guard returns: `true` to allow, or a {@link GuardDenial} to reject (SPEC §6.5). */
export type GuardResult = boolean | GuardDenial;

/** An access guard over a request; may refine the request type when it passes. */
export interface Guard<Request, RefinedRequest extends Request = Request> {
  (request: Request): GuardResult | Promise<GuardResult>;
  readonly refines?: (request: Request) => request is RefinedRequest;
}

export type GuardAuditFact =
  | AuthedGuardAuditFact
  | NamedGuardAuditFact
  | OpaqueGuardAuditFact
  | OwnershipGuardAuditFact
  | RateLimitGuardAuditFact
  | RoleGuardAuditFact;

export interface GuardPrincipalKeyAudit {
  expression: string;
  path: string;
  source: 'request' | 'session';
}

export interface GuardResourceKeyAudit {
  expression: string;
  path: string;
  source: 'args' | 'params' | 'request';
}

export interface AuthedGuardAuditFact {
  auth: 'session-user';
  kind: 'authed';
  name: 'authed';
}

export interface NamedGuardAuditFact {
  kind: 'named';
  name: string;
}

export interface OpaqueGuardAuditFact {
  kind: 'opaque';
  name: string;
}

export interface RoleGuardAuditFact {
  auth: 'session-role';
  kind: 'role';
  name: `role:${string}`;
  principal: GuardPrincipalKeyAudit;
  role: string;
}

export interface RateLimitGuardAuditFact {
  kind: 'rateLimit';
  name: 'rateLimit';
  per: 'global' | 'session' | 'ip' | 'custom';
}

export interface OwnershipGuardAuditFact {
  auth: 'session-user';
  kind: 'owns';
  name: string;
  principal: GuardPrincipalKeyAudit;
  resourceKey?: GuardResourceKeyAudit;
  staticProof: 'not-claimed';
}

export interface OwnershipGuardAuditOptions {
  /**
   * Human-readable principal expression the ownership predicate keys on. This is audit metadata
   * only: runtime `ownsRow` still enforces access, and static WHERE-predicate proof is not claimed.
   */
  principal?: GuardPrincipalKeyAudit | string;
  /**
   * Human-readable resource key expression selected by `keyOf`, e.g. `args.id` or `params.id`.
   * Omit when the key selector is intentionally opaque to runtime metadata.
   */
  resourceKey?: GuardResourceKeyAudit | string;
  /** Optional stable label for this ownership guard in explain/audit output. */
  name?: string;
}

const guardAuditFacts = createWitnessWeakMap<Function, readonly GuardAuditFact[]>();

/**
 * @internal Framework-resolved guard failure. The intent-based {@link GuardDenial}
 * an author returns is normalized into this wire-facing shape (auth disposition,
 * error code, sentinel status, retry-after) that the route/query/mutation render
 * paths and `renderHttpGuardFailureResponse` consume to derive the §6.5 HTTP
 * outcome. Not part of the app-facing surface.
 */
export interface ResolvedGuardFailure {
  auth?: 'unauthenticated' | 'unauthorized';
  code: 'RATE_LIMITED' | 'UNAUTHORIZED';
  payload?: Record<string, unknown>;
  retryAfter?: number;
  status: 422 | 429;
}

/** @internal Shared route/query/mutation guard-failure result shape (SPEC §9.2/§9.5). */
export interface GuardFailureResult<Status extends 403 | 422 | 429 = 422 | 429> {
  auth?: ResolvedGuardFailure['auth'];
  error: {
    code: ResolvedGuardFailure['code'];
    payload: Record<string, unknown>;
  };
  ok: false;
  retryAfter?: number;
  status: Status;
}

/** @internal */
export function guardFailureToResult(failure: ResolvedGuardFailure): GuardFailureResult;
export function guardFailureToResult(
  failure: ResolvedGuardFailure,
  options: { authenticatedUnauthorizedStatus: 403 },
): GuardFailureResult<403 | 422 | 429>;
export function guardFailureToResult(
  failure: ResolvedGuardFailure,
  options?: { authenticatedUnauthorizedStatus: 403 },
): GuardFailureResult<403 | 422 | 429> {
  const status =
    options?.authenticatedUnauthorizedStatus === 403 &&
    failure.auth === 'unauthorized' &&
    failure.status === 422
      ? 403
      : failure.status;
  return {
    ...(failure.auth === undefined ? {} : { auth: failure.auth }),
    error: { code: failure.code, payload: failure.payload ?? {} },
    ok: false,
    ...(failure.retryAfter === undefined ? {} : { retryAfter: failure.retryAfter }),
    status,
  };
}

/** The minimal authenticated-user shape guards inspect: `id` and `roles`. */
export interface SessionUserLike {
  id?: string;
  roles?: readonly string[];
}

/** A request carrying an optional session; the constraint for built-in guards. */
export interface SessionRequestLike {
  session?: {
    id?: string;
    user?: SessionUserLike | null;
  } | null;
}

/** A request shape accepted by `guards.role()`: roles must be present on an authenticated user. */
export interface RoleSessionRequestLike extends SessionRequestLike {
  session?: {
    id?: string;
    user?: (SessionUserLike & { roles: readonly string[] }) | null;
  } | null;
}

/**
 * A request carrying the framework-resolved, trustworthy client IP that `guards.rateLimit({ per:
 * 'ip' })` keys on (SPEC §9.5). The request shell attaches `req.clientIp` (via
 * `resolveLifecycleRequest`'s `clientIp` resolver) from the SAME trusted source the coarse
 * pre-dispatch load-shed limiter uses — the app-configured `createApp({ requestLimits: { clientIp }
 * })` extractor, else `X-Forwarded-For`/`X-Real-IP`/`Forwarded` ONLY when `trustedProxy` is set
 * (`app-load-shed.ts` `resolveRequestClientIp`). The guard never reads a raw client-supplied header
 * itself, so a spoofed `X-Forwarded-For` cannot pick the rate-limit bucket on an untrusted edge.
 */
export interface ClientIpRequestLike {
  /** Framework-resolved client IP attached by the request shell before the guard chain (SPEC §9.5). */
  clientIp?: string;
}

/** A request narrowed to one with a present session user, produced by `guards.authed`. */
export type AuthenticatedRequest<Request extends SessionRequestLike> = Request & {
  session: NonNullable<Request['session']> & {
    user: NonNullable<NonNullable<Request['session']>['user']>;
  };
};

/**
 * A guard request carrying the query's/mutation's framework-merged **validated args** an arg-aware
 * guard inspects (SPEC §10.3:1155-1157 "Guards (arg-aware, normative)", §9.4). The query/mutation
 * runners thread the same `s.*`-coerced `args` the loader/handler see onto the request *after*
 * schema parse/coerce and *before* the guard chain, so an ownership guard's `keyOf` can read
 * `req.args` without a cast and discharge the KV414 IDOR obligation for that key. Compose over the
 * app request, e.g. `guards.owns<GuardArgsRequest<AppRequest, { id: string }>, string>(...)`.
 */
export type GuardArgsRequest<Request, Args = unknown> = Request & { args: Args };

/**
 * A guard request carrying the framework-merged **resolved route params** an arg-aware route guard
 * inspects (SPEC §10.3:1155-1157, §6.4). `runRoutePage` threads the route's parsed/coerced `params`
 * onto the request before the layout/route guard chain, so an ownership guard's `keyOf` can read
 * `req.params` without a cast and discharge KV414 for a route-instance key.
 */
export type GuardParamsRequest<Request, Params = Record<string, string>> = Request & {
  params: Params;
};

/** The app's session declaration returned by `session()`: `parse`, `provider`, and `schema`. */
export interface SessionDefinition<Value> {
  parse(request: { session?: unknown }): Value;
  provider<RawRequest>(
    provider: SessionProvider<RawRequest, Value>,
  ): SessionProvider<RawRequest, Value>;
  schema: Schema<Value>;
}

/**
 * The result a {@link SessionProvider} resolves to. Backward-compatibly, a provider may
 * return a plain `SessionValue` (or null/undefined). part-3 I2 (SPEC §6.5, §9.1.1:854):
 * a provider backed by a rolling/refresh session (e.g. Better Auth `updateAge` or
 * `cookieCache`) may instead return `{ value, setCookies }` so the framework forwards the
 * provider's fresh `Set-Cookie` headers onto the resolved GET response — otherwise a
 * continuously-active user is silently hard-logged-out at the original session boundary.
 * The plain-value form remains fully supported; this is purely additive.
 */
export interface SessionProviderResult<SessionValue> {
  /** Raw `Set-Cookie` header strings the provider wants forwarded on the response. */
  setCookies?: readonly string[];
  value: SessionValue | null | undefined;
}

/** A function that resolves the session value from a raw request (or null). */
export type SessionProvider<RawRequest, SessionValue> = (
  request: RawRequest,
) =>
  | Promise<SessionProviderResult<SessionValue> | SessionValue | null | undefined>
  | SessionProviderResult<SessionValue>
  | SessionValue
  | null
  | undefined;

interface SnapshottedSessionProviderEnvelope<SessionValue> {
  readonly setCookies: readonly string[];
  readonly value: SessionValue | null | undefined;
}

const MAX_SESSION_PROVIDER_SET_COOKIES = 256;

/**
 * Reconstruct an untrusted provider envelope from exact own data descriptors (SPEC §6.6 C9).
 * The provider runs in application code in the shared server realm: inherited fields, accessors,
 * sparse arrays, and late Array prototype replacements are not session or response authority.
 */
function snapshotSessionProviderEnvelope<SessionValue>(
  result: SessionProviderResult<SessionValue> | SessionValue | null | undefined,
): SnapshottedSessionProviderEnvelope<SessionValue> | undefined {
  if ((typeof result !== 'object' && typeof result !== 'function') || result === null) {
    return undefined;
  }

  const valueDescriptor = witnessGetOwnPropertyDescriptor(result, 'value');
  const cookiesDescriptor = witnessGetOwnPropertyDescriptor(result, 'setCookies');
  if (cookiesDescriptor === undefined) return undefined;
  if (
    valueDescriptor === undefined ||
    !('value' in valueDescriptor) ||
    !('value' in cookiesDescriptor) ||
    !witnessIsArray(cookiesDescriptor.value)
  ) {
    throw new TypeError(
      'Session provider envelopes require own data properties `value` and dense string `setCookies`.',
    );
  }

  const source = cookiesDescriptor.value;
  const lengthDescriptor = witnessGetOwnPropertyDescriptor(source, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_SESSION_PROVIDER_SET_COOKIES ||
    lengthDescriptor.value % 1 !== 0
  ) {
    throw new TypeError('Session provider `setCookies` must be a bounded dense string array.');
  }

  const setCookies: string[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(source, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError('Session provider `setCookies` must be a bounded dense string array.');
    }
    witnessDefineProperty(setCookies, index, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }

  return witnessFreeze({
    setCookies: witnessFreeze(setCookies),
    value: valueDescriptor.value as SessionValue | null | undefined,
  });
}

/**
 * @internal Type guard distinguishing the additive `{ value, setCookies }` provider result
 * (part-3 I2) from a plain `SessionValue`. A `SessionValue` could itself be an object with a
 * `value` field, so the discriminator requires the result-envelope shape: an object owning a
 * `value` key, and — when present — a `setCookies` array. We only treat a return as an
 * envelope when it carries `setCookies` (the only reason to use the envelope form), keeping
 * a plain `{ value: … }` session object working unchanged.
 */
export function isSessionProviderResult<SessionValue>(
  result: SessionProviderResult<SessionValue> | SessionValue | null | undefined,
): result is SessionProviderResult<SessionValue> {
  try {
    return snapshotSessionProviderEnvelope(result) !== undefined;
  } catch {
    return false;
  }
}

/** A function that resolves the app database/transaction handle for a request. */
export type DbProvider<RawRequest, DbValue, SessionValue = unknown> = (
  request: LifecycleRequest<RawRequest, SessionValue, never>,
) => Promise<DbValue> | DbValue;

/** Request shape after the framework has installed configured lifecycle channels. */
export type LifecycleRequest<RawRequest, SessionValue = never, DbValue = never> = RawRequest &
  ([SessionValue] extends [never] ? {} : { session: SessionValue | null }) &
  ([DbValue] extends [never] ? {} : { db: DbValue });

/** Per-request options shared across the lifecycle: error hook plus session/db providers. */
/** @internal */
export interface RequestLifecycleOptions<RawRequest, SessionValue = unknown, DbValue = unknown> {
  /**
   * @internal SPEC §9.5: optional resolver the request shell uses to attach a trustworthy
   * `req.clientIp` BEFORE the guard chain, so `guards.rateLimit({ per: 'ip' })` keys by IP (see
   * {@link ClientIpRequestLike}). Callers pass the SAME trusted source the coarse pre-dispatch
   * limiter uses (`app-load-shed.ts` `resolveRequestClientIp`: the app-configured `clientIp`
   * extractor, else forwarding headers ONLY behind a trusted proxy). A caller that cannot resolve a
   * trustworthy IP omits it; per-IP guard keying then fails loud rather than collapsing clients.
   */
  clientIp?: (request: RawRequest) => string | undefined;
  db?: DbProvider<RawRequest, DbValue, SessionValue>;
  /** @internal Framework-minted task/webhook/endpoint principal posture for non-request DB work. */
  principalPosture?: NonRequestPrincipalPosture;
  /** @internal Query/list result item ceiling enforced by the query runtime sink (SPEC §9.5). */
  maxListItems?: number;
  /**
   * The managed-handle mode the framework applies to the resolved `request.db` (SPEC §9.4/§10.3).
   * `'read'` installs the KV433 read-only proxy (a `query()` loader's handle); `'write'` (the
   * default) installs only the KV422 SQL-safe handle for explicit write surfaces.
   * @internal
   */
  dbMode?: ManagedDbMode;
  /** @internal SPEC §10.3/§11.2 raw-SQL write table allowlist enforced by mutation DB handles. */
  sqlWritePolicy?: ManagedSqlWritePolicy;
  onError?: ServerErrorHandler;
  /**
   * @internal part-3 I2: optional sink the lifecycle calls with each raw `Set-Cookie`
   * string a {@link SessionProvider} returned via the `{ value, setCookies }` envelope.
   * A caller that can attach cookies to the resolved response (e.g. a rolling/refresh
   * session adapter) passes a sink; callers that cannot are unaffected — the cookies are
   * simply dropped, preserving today's behavior for the plain-value provider form.
   */
  onSessionSetCookie?: (rawSetCookie: string) => void;
  sessionProvider?: SessionProvider<RawRequest, SessionValue>;
}

/**
 * Context passed to an `onUnauthenticated` handler when an `authed` guard fails
 * (SPEC §6.5). `next` is the framework-validated same-origin path to return to after
 * login; `request` is the failing request.
 */
export interface UnauthenticatedContext<Request> {
  next: string;
  request: Request;
}

/**
 * App-supplied handler for unauthenticated guard failures (SPEC §6.5). Returns the
 * `CoreRedirect` to the login route; the default is a 303 to the configured login path
 * carrying `next`. Used to type the `onUnauthenticated` request-shell option.
 */
export type UnauthenticatedHandler<Request> = (
  context: UnauthenticatedContext<Request>,
) => CoreRedirect | Promise<CoreRedirect>;

/**
 * Context passed to a `renderForbidden` renderer when an authenticated-but-unauthorized
 * guard refinement fails (SPEC §6.5). Carries the failing `request`.
 */
export interface ForbiddenContext<Request> {
  request: Request;
}

/**
 * App-supplied renderer for the 403 forbidden shell on authorization failure (SPEC §6.5).
 * Returns the HTML body served with status 403. Used to type the `renderForbidden`
 * request-shell option.
 */
export type ForbiddenRenderer<Request> = (
  context: ForbiddenContext<Request>,
) => string | Promise<string>;

/** @internal */
export interface GuardFailureResponseOptions<
  Request,
  SessionValue = unknown,
  DbValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue, DbValue> {
  currentUrl?: string;
  loginPath?: string;
  onUnauthenticated?: UnauthenticatedHandler<Request>;
  renderForbidden?: ForbiddenRenderer<Request>;
  /**
   * Optional route table for ROUTING-NAV-4 / SPEC §6.5:724: when supplied,
   * `sanitizeNext` additionally validates the `next` pathname against this set of
   * routes and strips it to `/` if no route matches. Pass the app route table when
   * available to prevent post-login redirects to unrecognized in-app paths.
   */
  routes?: readonly RouteLike[];
}

interface HttpGuardFailureResponse extends ServerResponseBase<string, ResponseHeaders, 303 | 403> {}

type InternalForbiddenRenderer<Request> = (
  context: ForbiddenContext<Request>,
) => string | HttpGuardFailureResponse | Promise<string | HttpGuardFailureResponse>;

/**
 * Options for `guards.rateLimit`: window size, max requests, scope, and key function (SPEC
 * §9.5/§10.3). The `per` dimension keys the per-principal budget: `'session'` (default) keys by
 * session id, `'global'` collapses all callers into one bucket, and `'ip'` keys by the
 * framework-resolved client IP (`req.clientIp`, see {@link ClientIpRequestLike}) so an anonymous /
 * per-IP budget can be expressed at the guard layer (SPEC §9.5:935). This per-principal guard
 * combinator composes with — does not replace — the coarse pre-dispatch per-IP/global load-shed
 * limiter (SPEC §9.5; `app-load-shed.ts`).
 */
export interface RateLimitOptions<Request> {
  key?: (request: Request) => string;
  max: number;
  maxKeys?: number;
  per?: 'global' | 'session' | 'ip';
  windowMs?: number;
}

const defaultRateLimitWindowMs = 60_000;
const defaultRateLimitMaxKeys = 10_000;
const passedRoleGuards = createWitnessWeakMap<object, Set<string>>();

/**
 * Construct a self-naming executable guard. SPEC §10 default-deny access decisions
 * require the audited guard to be the guard that runs; this wrapper stores the
 * audit name on the executable function itself instead of accepting a separate
 * hand-written label.
 */
export function guard<Request, RefinedRequest extends Request = Request>(
  name: string,
  fn: Guard<Request, RefinedRequest>,
): Guard<Request, RefinedRequest> {
  const trimmed = securityStringTrim(snapshotAuditText(name, 'guard(name, fn) audit name'));

  const namedGuard: Guard<Request, RefinedRequest> = (request) => fn(request);
  const refinesDescriptor = witnessGetOwnPropertyDescriptor(fn, 'refines');
  if (refinesDescriptor !== undefined && !('value' in refinesDescriptor)) {
    throw new TypeError('guard(name, fn) rejects an accessor-backed refines predicate.');
  }
  const refines = refinesDescriptor?.value;
  if (refines !== undefined) {
    if (typeof refines !== 'function') {
      throw new TypeError('guard(name, fn) requires refines to be a function when present.');
    }
    witnessDefineProperty(namedGuard, 'refines', {
      configurable: false,
      enumerable: false,
      value: refines,
      writable: false,
    });
  }
  const innerFacts = explainGuard(fn);
  const facts: GuardAuditFact[] = [];
  appendGuardAuditFact(facts, { kind: 'named', name: trimmed });
  if (innerFacts.length === 0) {
    appendGuardAuditFact(facts, { kind: 'opaque', name: trimmed });
  } else {
    for (let index = 0; index < innerFacts.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(innerFacts, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('Guard audit facts must be a dense own-data array.');
      }
      appendGuardAuditFact(facts, descriptor.value as GuardAuditFact);
    }
  }
  return stampGuardAudit(namedGuard, facts);
}

/**
 * Built-in guard factories for routes, queries, and mutations. `guards.authed()`
 * requires a logged-in session (and refines the request type), `guards.role(r)`
 * requires a role, `guards.rateLimit(opts)` throttles, and `guards.all(...)`
 * composes guards left-to-right. Attach the result as a `guard` on a route,
 * query, or mutation (SPEC §6.5).
 *
 * @example
 * import { guards, route, type SessionRequestLike } from '@kovojs/server';
 *
 * interface AppRequest extends SessionRequestLike {}
 *
 * export const dashboard = route('/dashboard', {
 *   guard: guards.authed<AppRequest>(),
 *   page: () => <h1>Dashboard</h1>,
 * });
 */
export const guards = witnessFreeze({
  all<Request, RefinedRequest extends Request = Request>(
    ...items: Guard<Request, RefinedRequest>[]
  ): Guard<Request, RefinedRequest> {
    const executable = executableGuardAccessDecision(items) as
      | readonly Guard<Request, RefinedRequest>[]
      | undefined;
    if (executable === undefined) {
      throw new TypeError('guards.all(...) requires one or more dense executable guards.');
    }
    const guard: Guard<Request, RefinedRequest> = async (request: Request) => {
      for (let index = 0; index < executable.length; index += 1) {
        const item = executable[index]!;
        const result = await item(request);
        // Propagate the first denial (intent object) or bare `false` as-is so the
        // §6.5 status mapping stays owned by the render path, not flattened here.
        if (result !== true) return result;
      }

      return true;
    };
    const auditFacts: GuardAuditFact[] = [];
    for (let index = 0; index < executable.length; index += 1) {
      const item = executable[index]!;
      const facts = explainGuard(item);
      if (facts.length === 0) {
        appendGuardAuditFact(auditFacts, {
          kind: 'opaque',
          name: stableGuardFunctionAuditName(item),
        });
        continue;
      }
      for (let factIndex = 0; factIndex < facts.length; factIndex += 1) {
        const descriptor = witnessGetOwnPropertyDescriptor(facts as object, factIndex);
        if (descriptor !== undefined && 'value' in descriptor) {
          appendGuardAuditFact(auditFacts, descriptor.value as GuardAuditFact);
        }
      }
    }
    return stampGuardAudit(guard, auditFacts);
  },
  authed<Request extends SessionRequestLike>(): Guard<Request, AuthenticatedRequest<Request>> {
    return stampGuardAudit(
      (request) =>
        requestPrincipalSnapshot(request).kind === 'proven' ? true : unauthenticatedGuardFailure(),
      [{ auth: 'session-user', kind: 'authed', name: 'authed' }],
    );
  },
  rateLimit<Request extends SessionRequestLike>(
    options: RateLimitOptions<Request>,
  ): Guard<Request> {
    const rateOptions = snapshotRateLimitOptions(options);
    assertRateLimitOptions(rateOptions);
    const counts = createWitnessMap<string, { count: number; resetAt: number }>();

    return stampGuardAudit(
      (request) => {
        const now = requestStateNow();
        evictExpiredRateLimits(counts, now);

        const windowMs = rateOptions.windowMs ?? defaultRateLimitWindowMs;
        if (rateOptions.max <= 0) return rateLimitFailure(now + windowMs, now);

        const key = rateLimitKey(request, rateOptions);
        const existing = witnessMapGet(counts, key);

        if (existing && existing.resetAt > now) {
          if (existing.count >= rateOptions.max) return rateLimitFailure(existing.resetAt, now);

          existing.count += 1;
          return true;
        }

        const maxKeys = rateOptions.maxKeys ?? defaultRateLimitMaxKeys;
        if (witnessMapSize(counts) >= maxKeys) {
          // SPEC §9.5: an over-budget request MUST receive 429. Evicting an active key here
          // reopened that key's window under attacker-controlled key churn. Refuse unseen keys
          // until the earliest active window expires; never trade security truth for admission.
          let earliestResetAt = now + windowMs;
          witnessMapForEach(counts, (record) => {
            if (record.resetAt < earliestResetAt) earliestResetAt = record.resetAt;
          });
          return rateLimitFailure(earliestResetAt, now);
        }

        witnessMapSet(counts, key, {
          count: 1,
          resetAt: now + windowMs,
        });
        return true;
      },
      [
        {
          kind: 'rateLimit',
          name: 'rateLimit',
          per: rateOptions.key ? 'custom' : (rateOptions.per ?? 'session'),
        },
      ],
    );
  },
  role<Request extends RoleSessionRequestLike>(role: string): Guard<Request> {
    const closedRole = snapshotAuditText(role, 'guards.role() role');
    const auditName = snapshotAuditText(`role:${closedRole}`, 'guards.role() audit name');
    return stampGuardAudit(
      (request) => {
        const principal = requestPrincipalSnapshot(request);
        if (principal.kind !== 'proven') {
          return unauthenticatedGuardFailure();
        }
        if (!roleListIncludes(principal.roles, closedRole)) return unauthorizedGuardFailure();
        markPassedRoleGuard(request, closedRole);
        return true;
      },
      [
        {
          auth: 'session-role',
          kind: 'role',
          name: auditName as `role:${string}`,
          principal: normalizePrincipalKeyAudit('session.user.roles'),
          role: closedRole,
        },
      ],
    );
  },
  /**
   * Ownership guard (SPEC §10.3:1155-1157 "Guards (arg-aware, normative)", §9.4): passes only
   * when the authenticated principal owns the row the validated key selects, discharging the
   * KV414 IDOR obligation for that key. `keyOf` reads the owned-row key from the request, which —
   * because guards run *after* schema parse/coerce — carries the query's/mutation's validated
   * `args` (queries/mutations) or the route's resolved `params` (route pages) the framework
   * merges on before the guard chain (the query/mutation/route runners do this; without it
   * `req.args` is `undefined` and a correct predicate would deny every owner — latent IDOR). Type
   * the keyed request with {@link GuardArgsRequest}/{@link GuardParamsRequest} so `req.args`/
   * `req.params` need no cast. The returned guard is a `Guard<Request>` over the *base* (app)
   * request, so it attaches to a query/route/mutation typed on the app request without a
   * contravariant-assignment cast — only `keyOf`/`ownsRow` see the merged `KeyedRequest`. `ownsRow`
   * is the app-provided ownership predicate — the app owns the data layer, so the guard stays
   * decoupled from Drizzle (the SPEC `owns((a) => a.id, table.col)` column-form is the planned
   * compile-time sugar over this runtime contract). Composes with the other guards, e.g.
   * `all(authed, owns((req) => req.args.id, ownsOrder))`.
   */
  owns<Request extends SessionRequestLike, KeyedRequest extends Request = Request, Key = unknown>(
    keyOf: (request: KeyedRequest) => Key,
    ownsRow: (request: KeyedRequest, key: Key) => boolean | Promise<boolean>,
    audit?: OwnershipGuardAuditOptions,
  ): Guard<Request> {
    const closedAudit = snapshotOwnershipGuardAuditOptions(audit);
    return stampGuardAudit(
      async (request) => {
        if (requestPrincipalSnapshot(request).kind !== 'proven') {
          return unauthenticatedGuardFailure();
        }
        // The query/mutation/route runners merge the validated args / resolved params onto `request`
        // BEFORE this guard runs (SPEC §10.3:1155-1157), so the runtime value is a `KeyedRequest`
        // even though the guard's *attachment* type is the base request. View it as such for `keyOf`.
        const keyedRequest = request as unknown as KeyedRequest;
        return (await ownsRow(keyedRequest, keyOf(keyedRequest))) === true
          ? true
          : unauthorizedGuardFailure();
      },
      [
        {
          auth: 'session-user',
          kind: 'owns',
          name: closedAudit.name,
          principal: closedAudit.principal,
          ...(closedAudit.resourceKey === undefined
            ? {}
            : { resourceKey: closedAudit.resourceKey }),
          staticProof: 'not-claimed',
        },
      ],
    );
  },
});

/**
 * Return framework-owned audit metadata stamped on a built-in guard. These facts are intentionally
 * narrower than static proof: an `owns` fact declares the runtime principal/resource-key intent for
 * OPP-28 review, while the app predicate and future static analyzer still own enforcement/proof.
 */
export function explainGuard<Request>(
  guard: Guard<Request> | undefined,
): readonly GuardAuditFact[] {
  return guard === undefined ? [] : (witnessWeakMapGet(guardAuditFacts, guard) ?? []);
}

/** @internal Project the stable audit name attached to an executable guard. */
export function guardAuditName<Request>(guard: Guard<Request>): string {
  const facts = explainGuard(guard);
  let firstName: string | undefined;
  for (let index = 0; index < facts.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(facts, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Guard audit facts must be a dense own-data array.');
    }
    const fact = descriptor.value as GuardAuditFact;
    if (fact.kind === 'named') return fact.name;
    if (firstName === undefined) firstName = fact.name;
  }
  if (firstName !== undefined) return firstName;
  return stableGuardFunctionAuditName(guard);
}

/** @internal SPEC §10.3 DEC-G: runtime evidence that a named role guard passed on this request. */
export function requestPassedRoleGuard(request: unknown, role: string): boolean {
  if (!isObjectLike(request)) return false;
  const roles = witnessWeakMapGet(passedRoleGuards, request);
  return roles !== undefined && witnessSetHas(roles, role);
}

function markPassedRoleGuard(request: unknown, role: string): void {
  if (!isObjectLike(request)) return;
  const metadataSource = authorityMetadataSource(request);
  let roles =
    witnessWeakMapGet(passedRoleGuards, request) ??
    witnessWeakMapGet(passedRoleGuards, metadataSource);
  if (roles === undefined) {
    roles = createWitnessSet();
  }
  witnessWeakMapSet(passedRoleGuards, request, roles);
  witnessWeakMapSet(passedRoleGuards, metadataSource, roles);
  witnessSetAdd(roles, role);
}

function stampGuardAudit<Request, RefinedRequest extends Request = Request>(
  guard: Guard<Request, RefinedRequest>,
  facts: readonly GuardAuditFact[],
): Guard<Request, RefinedRequest> {
  const snapshot: GuardAuditFact[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    witnessDefineProperty(snapshot, index, {
      configurable: true,
      enumerable: true,
      value: freezeGuardAuditFact(facts[index]!),
      writable: true,
    });
  }
  witnessWeakMapSet(guardAuditFacts, guard, witnessFreeze(snapshot));
  return guard;
}

function appendGuardAuditFact(target: GuardAuditFact[], fact: GuardAuditFact): void {
  witnessDefineProperty(target, target.length, {
    configurable: true,
    enumerable: true,
    value: fact,
    writable: true,
  });
}

function freezeGuardAuditFact(fact: GuardAuditFact): GuardAuditFact {
  if (fact.kind === 'owns') {
    return witnessFreeze({
      ...fact,
      principal: witnessFreeze({ ...fact.principal }),
      ...(fact.resourceKey === undefined
        ? {}
        : { resourceKey: witnessFreeze({ ...fact.resourceKey }) }),
    });
  }
  if (fact.kind === 'role') {
    return witnessFreeze({
      ...fact,
      principal: witnessFreeze({ ...fact.principal }),
    });
  }
  return witnessFreeze({ ...fact });
}

function normalizePrincipalKeyAudit(
  value: GuardPrincipalKeyAudit | string,
): GuardPrincipalKeyAudit {
  if (typeof value !== 'string') {
    const expression = snapshotAuditText(
      stableGuardAuditDataValue(value, 'expression', 'ownership principal audit'),
      'ownership principal audit expression',
    );
    const path = snapshotAuditText(
      stableGuardAuditDataValue(value, 'path', 'ownership principal audit'),
      'ownership principal audit path',
    );
    const source = stableGuardAuditDataValue(value, 'source', 'ownership principal audit');
    if (source !== 'request' && source !== 'session') {
      throw new TypeError('ownership principal audit source must be request or session.');
    }
    return { expression, path, source };
  }

  const expression = snapshotAuditText(value, 'ownership principal audit expression');
  const { path, source } = normalizeAuditExpression(expression, ['session']);
  return {
    expression,
    path: snapshotAuditText(path, 'ownership principal audit path'),
    source: source === 'session' ? 'session' : 'request',
  };
}

function normalizeResourceKeyAudit(value: GuardResourceKeyAudit | string): GuardResourceKeyAudit {
  if (typeof value !== 'string') {
    const expression = snapshotAuditText(
      stableGuardAuditDataValue(value, 'expression', 'ownership resource audit'),
      'ownership resource audit expression',
    );
    const path = snapshotAuditText(
      stableGuardAuditDataValue(value, 'path', 'ownership resource audit'),
      'ownership resource audit path',
    );
    const source = stableGuardAuditDataValue(value, 'source', 'ownership resource audit');
    if (source !== 'args' && source !== 'params' && source !== 'request') {
      throw new TypeError('ownership resource audit source must be args, params, or request.');
    }
    return { expression, path, source };
  }

  const expression = snapshotAuditText(value, 'ownership resource audit expression');
  const { path, source } = normalizeAuditExpression(expression, ['args', 'params']);
  return {
    expression,
    path: snapshotAuditText(path, 'ownership resource audit path'),
    source: source === 'args' || source === 'params' ? source : 'request',
  };
}

function snapshotOwnershipGuardAuditOptions(value: OwnershipGuardAuditOptions | undefined): {
  name: string;
  principal: GuardPrincipalKeyAudit;
  resourceKey?: GuardResourceKeyAudit;
} {
  if (value === undefined) {
    return {
      name: 'owns',
      principal: normalizePrincipalKeyAudit('session.user.id'),
    };
  }
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
    throw new TypeError('guards.owns() audit metadata must be a stable own-data record.');
  }
  const name = stableOptionalGuardAuditDataValue(value, 'name', 'guards.owns() audit metadata');
  const principal = stableOptionalGuardAuditDataValue(
    value,
    'principal',
    'guards.owns() audit metadata',
  );
  const resourceKey = stableOptionalGuardAuditDataValue(
    value,
    'resourceKey',
    'guards.owns() audit metadata',
  );
  return {
    name:
      name === undefined ? 'owns' : snapshotAuditText(name, 'guards.owns() audit metadata name'),
    principal: normalizePrincipalKeyAudit(
      principal === undefined ? 'session.user.id' : (principal as GuardPrincipalKeyAudit | string),
    ),
    ...(resourceKey === undefined
      ? {}
      : { resourceKey: normalizeResourceKeyAudit(resourceKey as GuardResourceKeyAudit | string) }),
  };
}

function stableGuardFunctionAuditName(guard: Function): string {
  const before = witnessGetOwnPropertyDescriptor(guard, 'name');
  const after = witnessGetOwnPropertyDescriptor(guard, 'name');
  if (before === undefined && after === undefined) return 'anonymous';
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    typeof before.value !== 'string' ||
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new TypeError('Guard function audit name must be a stable own-data string.');
  }
  if (securityStringTrim(before.value) === '') return 'anonymous';
  return snapshotAuditText(before.value, 'Guard function audit name');
}

function stableGuardAuditDataValue(source: unknown, property: PropertyKey, label: string): unknown {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError(`${label} must be a stable own-data record.`);
  }
  const value = stableOptionalGuardAuditDataValue(source, property, label);
  if (value === undefined) throw new TypeError(`${label} requires ${String(property)}.`);
  return value;
}

function stableOptionalGuardAuditDataValue(
  source: object,
  property: PropertyKey,
  label: string,
): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined && after === undefined) return undefined;
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new TypeError(`${label} ${String(property)} must be a stable own-data property.`);
  }
  return before.value;
}

function normalizeAuditExpression(
  expression: string,
  knownSources: readonly string[],
): { path: string; source: string } {
  for (let index = 0; index < knownSources.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(knownSources, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError('Guard audit sources must be a dense own string array.');
    }
    const source = descriptor.value;
    if (securityStringStartsWith(expression, `${source}.`)) {
      return { path: securityStringSlice(expression, source.length + 1), source };
    }
  }
  return { path: expression, source: 'request' };
}

/**
 * Declare the session schema for the app: how to `parse` the raw session into a
 * typed value, and how to wire a `provider` that resolves the session from a
 * request. The parsed type flows into guards and request types (SPEC §6.5).
 *
 * @param schema - A `Schema` describing the session shape.
 * @returns A `SessionDefinition` with `parse`, `provider`, and the `schema`.
 * @example
 * import { s, session } from '@kovojs/server';
 *
 * export const appSession = session(
 *   s.object({ userId: s.string() }),
 * );
 */
export function session<Value>(schema: Schema<Value>): SessionDefinition<Value> {
  return {
    parse(request) {
      return schema.parse(request.session);
    },
    provider(provider) {
      return provider;
    },
    schema,
  };
}

export async function runGuard<Request>(
  guard: Guard<Request> | undefined,
  request: Request,
): Promise<ResolvedGuardFailure | null> {
  if (!guard) return null;

  const result = await guard(request);
  return result === true ? null : resolveGuardResult(result);
}

/** @internal Run an ordered executable guard chain through the same path as `guard:`. */
export async function runGuardChain<Request>(
  guardChain: readonly Guard<Request>[],
  request: Request,
): Promise<ResolvedGuardFailure | null> {
  const executable = executableGuardAccessDecision(guardChain);
  if (executable === undefined) {
    return {
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
      payload: {},
      status: 422,
    };
  }
  for (let index = 0; index < executable.length; index += 1) {
    const item = executable[index]!;
    const failure = await runGuard(item, request);
    if (failure) return failure;
  }
  return null;
}

/**
 * @internal Run a surface's effective access guard.
 *
 * SPEC §10 requires the audited access decision to be the enforced object. When
 * `access` is an executable guard array, those guards run. `publicAccess` and
 * `verifiedAccess` are explicit no-guard decisions. The legacy top-level
 * `guard:` remains only as a compatibility fallback when `access` is absent.
 */
export async function runAccessDecisionGuards<Request>(
  access: AccessDecision | undefined,
  fallbackGuard: Guard<Request> | undefined,
  request: Request,
): Promise<ResolvedGuardFailure | null> {
  const decision = snapshotAccessDecision(access);
  if (witnessIsArray(decision)) {
    return runGuardChain(decision as readonly Guard<Request>[], request);
  }
  if (decision !== undefined) return null;
  return runGuard(fallbackGuard, request);
}

/**
 * @internal
 * Resolve the per-request lifecycle: run the session provider, attach `req.session`/`req.db`,
 * and (part-3 I2) forward any `SessionProvider` `{ value, setCookies }` envelope cookies to
 * `onSessionSetCookie`. Internal to the request shell; re-exported only on the internal
 * `@kovojs/server/internal/execution` subpath for adapter tests.
 */
export async function resolveLifecycleRequest<Request, SessionValue = unknown, DbValue = unknown>(
  request: Request,
  options: RequestLifecycleOptions<Request, SessionValue, DbValue> = {},
): Promise<LifecycleRequest<Request, SessionValue, DbValue>> {
  let lifecycleRequest: unknown = request;

  if (options.sessionProvider) {
    const resolved = await options.sessionProvider(request);
    // part-3 I2 (SPEC §6.5): unwrap the additive `{ value, setCookies }` envelope so a
    // rolling/refresh provider's fresh Set-Cookie headers reach the response; a plain
    // SessionValue return keeps working unchanged.
    let sessionValue: SessionValue | null;
    const envelope = snapshotSessionProviderEnvelope<SessionValue>(resolved);
    if (envelope !== undefined) {
      sessionValue = snapshotPinnedLifecycleValue(envelope.value ?? null) as SessionValue | null;
      if (options.onSessionSetCookie) {
        for (let index = 0; index < envelope.setCookies.length; index += 1) {
          options.onSessionSetCookie(envelope.setCookies[index]!);
        }
      }
    } else {
      sessionValue = snapshotPinnedLifecycleValue(
        (resolved as SessionValue | null | undefined) ?? null,
      ) as SessionValue | null;
    }
    lifecycleRequest = requestWithProperty(lifecycleRequest, 'session', sessionValue);
  }

  if (options.principalPosture !== undefined) {
    lifecycleRequest = requestWithProperty(
      lifecycleRequest,
      'principalPosture',
      options.principalPosture,
    );
  }

  if (options.db) {
    const dbValue = await options.db(lifecycleRequest as LifecycleRequest<Request, SessionValue>);
    // SPEC §6.6/§9.4/§10.3 (MARQUEE): the framework OWNS the handle threaded onto `request.db`.
    // `managedDb` composes the KV422 SQL-safe wrap with the KV433 read/write mode: a query loader's
    // request carries the read-only handle (write verbs throw), a mutation/write request carries
    // the read-write handle. The mode defaults to 'write' so direct/legacy callers keep read-write
    // `request.db`; `runQuery` passes 'read' so loaders are read-only end to end.
    lifecycleRequest = requestWithProperty(
      lifecycleRequest,
      'db',
      managedDb(
        dbValue,
        options.dbMode ?? 'write',
        options.sqlWritePolicy === undefined ? {} : { sqlWritePolicy: options.sqlWritePolicy },
      ),
    );
  } else if (options.sqlWritePolicy !== undefined) {
    const requestDb = requestOwnDb(lifecycleRequest);
    lifecycleRequest =
      requestDb.present && requestDb.value !== undefined
        ? requestWithProperty(
            lifecycleRequest,
            'db',
            managedDb(requestDb.value, options.dbMode ?? 'write', {
              sqlWritePolicy: options.sqlWritePolicy,
            }),
          )
        : withoutRequestProperty(lifecycleRequest, 'db');
  }

  // SPEC §9.5: attach the framework-resolved trustworthy client IP after providers but before the
  // guard chain. Built-in per-IP rate limiting needs it; app DB providers do not receive an
  // authorization-capable ambient network identity before a csrf:false request is verified.
  if (options.clientIp) {
    const clientIp = options.clientIp(request);
    if (clientIp !== undefined && clientIp !== '') {
      lifecycleRequest = requestWithProperty(lifecycleRequest, 'clientIp', clientIp);
    }
  }

  return lifecycleRequest as LifecycleRequest<Request, SessionValue, DbValue>;
}

function requestOwnDb(value: unknown): { present: false } | { present: true; value: unknown } {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return { present: false };
  }
  const descriptor = witnessGetOwnPropertyDescriptor(value, 'db');
  return descriptor !== undefined && 'value' in descriptor
    ? { present: true, value: descriptor.value }
    : { present: false };
}

export async function renderHttpGuardFailureResponse<Request>(
  result: {
    auth?: ResolvedGuardFailure['auth'];
    error?: { code: string };
    ok: false;
    status: number;
  },
  request: Request,
  options: GuardFailureResponseOptions<Request>,
): Promise<HttpGuardFailureResponse | undefined> {
  if (result.status !== 422 || result.error?.code !== 'UNAUTHORIZED') return undefined;

  if (guardFailureIsUnauthenticated(result, request)) {
    const next = sanitizeNext(options.currentUrl ?? '/', options.routes);
    const context = { next, request };
    const redirectResult = await (options.onUnauthenticated
      ? options.onUnauthenticated(context)
      : defaultOnUnauthenticated(context, options.loginPath, options.routes));

    // SPEC §6.6/§9.5: an auth redirect is a session-dependent outcome even when its body is
    // empty, so it must not be reusable by shared caches across principals.
    return blessRedirectResponse({
      body: '',
      headers: mergeVaryHeader(
        {
          'Cache-Control': 'private, no-store',
          Location: redirectLocationHeader(redirectResult.location),
        },
        'Cookie',
      ),
      status: redirectResult.status,
    });
  }

  const renderForbidden = options.renderForbidden as InternalForbiddenRenderer<Request> | undefined;
  const rendered = renderForbidden
    ? await renderForbidden({ request })
    : renderErrorDocument({ status: 403 });
  const response =
    typeof rendered === 'string'
      ? {
          body: rendered,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 403 as const,
        }
      : { ...rendered, status: 403 as const };
  const stamped = stampGuardFailureDocumentSecurityFloor(response);
  return {
    ...stamped,
    body: typeof stamped.body === 'string' ? stamped.body : '',
    status: 403,
  };
}

/**
 * Map a guard result to the framework's wire-facing {@link ResolvedGuardFailure}
 * (SPEC §6.5). The intent `kind` drives the disposition: `unauthenticated` →
 * 303 login redirect, `forbidden` → 403 shell (both share the internal
 * `UNAUTHORIZED`/422 sentinel, remapped by `renderHttpGuardFailureResponse` via
 * `auth`), `rateLimited` → 429 with retry-after. A bare `false` is an ambiguous
 * denial with no explicit `auth`, so the render path infers unauthenticated vs.
 * forbidden from the request session — preserving the legacy boolean-guard outcome.
 */
function resolveGuardResult(result: Exclude<GuardResult, true>): ResolvedGuardFailure {
  if (result === false) {
    return { code: 'UNAUTHORIZED', payload: {}, status: 422 };
  }

  if (result.kind === 'rateLimited') {
    return {
      code: 'RATE_LIMITED',
      payload: result.payload ?? {},
      ...(result.retryAfter === undefined ? {} : { retryAfter: result.retryAfter }),
      status: 429,
    };
  }

  return {
    auth: result.kind === 'unauthenticated' ? 'unauthenticated' : 'unauthorized',
    code: 'UNAUTHORIZED',
    payload: result.payload ?? {},
    status: 422,
  };
}

function rateLimitFailure(resetAt: number, now: number): RateLimitedDenial {
  return {
    kind: 'rateLimited',
    payload: {},
    retryAfter: requestStateRetryAfterSeconds(resetAt - now),
  };
}

function assertRateLimitOptions<Request>(options: RateLimitOptions<Request>): void {
  if (!requestStateIsSafeInteger(options.max) || options.max < 0) {
    throw new TypeError('guards.rateLimit({ max }) must be a non-negative integer.');
  }
  if (
    options.maxKeys !== undefined &&
    (!requestStateIsSafeInteger(options.maxKeys) || options.maxKeys < 1)
  ) {
    throw new TypeError('guards.rateLimit({ maxKeys }) must be a positive integer.');
  }
  if (
    options.windowMs !== undefined &&
    (!requestStateIsSafeInteger(options.windowMs) || options.windowMs < 1)
  ) {
    throw new TypeError('guards.rateLimit({ windowMs }) must be a positive integer.');
  }
  if (options.key !== undefined && typeof options.key !== 'function') {
    throw new TypeError('guards.rateLimit({ key }) must be a function when provided.');
  }
  if (
    options.per !== undefined &&
    options.per !== 'global' &&
    options.per !== 'session' &&
    options.per !== 'ip'
  ) {
    throw new TypeError("guards.rateLimit({ per }) must be 'global', 'session', or 'ip'.");
  }
}

function snapshotRateLimitOptions<Request>(
  source: RateLimitOptions<Request>,
): RateLimitOptions<Request> {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('guards.rateLimit options must be a stable own-data record.');
  }
  const max = stableRateLimitOption(source, 'max', true);
  const key = stableRateLimitOption(source, 'key', false);
  const maxKeys = stableRateLimitOption(source, 'maxKeys', false);
  const per = stableRateLimitOption(source, 'per', false);
  const windowMs = stableRateLimitOption(source, 'windowMs', false);
  return witnessFreeze({
    ...(key === undefined ? {} : { key: key as NonNullable<RateLimitOptions<Request>['key']> }),
    max: max as number,
    ...(maxKeys === undefined ? {} : { maxKeys: maxKeys as number }),
    ...(per === undefined ? {} : { per: per as NonNullable<RateLimitOptions<Request>['per']> }),
    ...(windowMs === undefined ? {} : { windowMs: windowMs as number }),
  });
}

function stableRateLimitOption(source: object, property: PropertyKey, required: boolean): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined && after === undefined) {
    if (!required) return undefined;
    throw new TypeError(
      `guards.rateLimit option ${String(property)} must be an own data property.`,
    );
  }
  if (before === undefined || after === undefined || !('value' in before) || !('value' in after)) {
    throw new TypeError(
      `guards.rateLimit option ${String(property)} must be an own data property.`,
    );
  }
  if (
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new TypeError(`guards.rateLimit option ${String(property)} changed during validation.`);
  }
  return before.value;
}

function unauthenticatedGuardFailure(): UnauthenticatedDenial {
  return {
    kind: 'unauthenticated',
    payload: {},
  };
}

function unauthorizedGuardFailure(): ForbiddenDenial {
  return {
    kind: 'forbidden',
    payload: {},
  };
}

function evictExpiredRateLimits(
  counts: Map<string, { count: number; resetAt: number }>,
  now: number,
): void {
  witnessMapForEach(counts, (record, key) => {
    if (record.resetAt <= now) witnessMapDelete(counts, key);
  });
}

function roleListIncludes(roles: readonly string[] | undefined, role: string): boolean {
  if (!witnessIsArray(roles)) return false;
  for (let index = 0; index < roles.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(roles, index);
    if (descriptor !== undefined && 'value' in descriptor && descriptor.value === role) return true;
  }
  return false;
}

function requestWithProperty<Request, Key extends string, Value>(
  request: Request,
  key: Key,
  value: Value,
): Request & Record<Key, Value> {
  const carrier = pinnedRequestCarrier(request, [{ key, value }]) as Request & Record<Key, Value>;
  if (isObjectLike(request)) {
    inheritAnonymousCsrfLiveTargetBinding(request, carrier);
  }
  registerAuthorityNeutralRequestMetadata(
    carrier as unknown as globalThis.Request,
    requestForAuthorityNeutralMetadata(request as unknown as globalThis.Request),
  );
  if (key === 'session') registerFrameworkSessionPrincipalSnapshot(carrier, value);
  else if (isObjectLike(request)) {
    const requestObject: object = request;
    inheritFrameworkPrincipalSnapshot(carrier, requestObject);
  }
  return carrier;
}

/** @internal Hide a lifecycle-only property before app handler code receives the request. */
export function withoutRequestProperty<Request, Key extends PropertyKey>(
  request: Request,
  key: Key,
): Request {
  const carrier = pinnedRequestCarrier(request, [], [key]);
  if (isObjectLike(request)) {
    inheritAnonymousCsrfLiveTargetBinding(request, carrier);
  }
  registerAuthorityNeutralRequestMetadata(
    carrier as unknown as globalThis.Request,
    requestForAuthorityNeutralMetadata(request as unknown as globalThis.Request),
  );
  if (isObjectLike(request)) {
    const requestObject: object = request;
    inheritFrameworkPrincipalSnapshot(carrier, requestObject);
  }
  return carrier as Request;
}

/**
 * @internal Merge the query's/mutation's **validated args** onto the lifecycle request BEFORE the
 * guard chain, so an arg-aware guard (`guards.owns` reading `req.args`) sees the same `s.*`-coerced
 * values the loader/handler see (SPEC §10.3:1155-1157 "Guards (arg-aware, normative)", §9.4). The
 * runners call this only on the validated path (after a declared `args`/`input` schema parsed), so
 * it never fabricates an unvalidated `req.args` on the no-args path. Returns a non-mutating Proxy
 * view (the existing {@link requestWithProperty} machinery), so the caller's request is untouched.
 */
export function withGuardArgs<Request, Args>(
  request: Request,
  args: Args,
): GuardArgsRequest<Request, Args> {
  return requestWithProperty(request, 'args', args) as GuardArgsRequest<Request, Args>;
}

/**
 * @internal Merge a route page's **resolved params** onto the lifecycle request BEFORE the
 * layout/route guard chain, so an arg-aware route guard (`guards.owns` reading `req.params`) can
 * authorize a route-instance key (SPEC §10.3:1155-1157, §6.4). `parseRouteRequest` already
 * parsed/coerced the params via the route's `params` schema before this runs.
 */
export function withGuardParams<Request, Params>(
  request: Request,
  params: Params,
): GuardParamsRequest<Request, Params> {
  return requestWithProperty(request, 'params', params) as GuardParamsRequest<Request, Params>;
}

function defaultOnUnauthenticated<Request>(
  context: UnauthenticatedContext<Request>,
  loginPath = '/login',
  routes?: readonly RouteLike[],
): CoreRedirect {
  return {
    location: loginLocationWithNext(loginPath, context.next, routes),
    status: 303,
  };
}

function loginLocationWithNext(
  loginPath: string,
  next: string,
  routes?: readonly RouteLike[],
): string {
  const base = 'https://kovo.local';
  return requestStateLocationWithQuery(loginPath, base, 'next', sanitizeNext(next, routes));
}

/**
 * bugs-1 F2 / SPEC §6.5 / SPEC §6.5:724: `next` MUST be a same-origin, single-leading-slash
 * absolute path (no `//`, no `/\`, no scheme, no host) so a login flow that redirects to it
 * cannot become an open redirect. Anything else is stripped to the safe default `/`.
 *
 * When `routes` is supplied (ROUTING-NAV-4), the candidate pathname is additionally matched
 * against the app route table: a path that passes the origin check but resolves to no route
 * is stripped to `/` per SPEC §6.5:724 ("a `next` that fails to resolve against the route
 * table is stripped to a safe default"). This prevents in-app non-route paths (e.g. internal
 * API stubs or ambiguous paths) from surviving as the post-login destination.
 *
 * The `routes` parameter is optional; when absent, only the origin/slash guards apply. Callers
 * with the route table available (e.g. `GuardFailureResponseOptions`) should pass it.
 *
 * @internal
 */
export function sanitizeNext(next: string, routes?: readonly RouteLike[]): string {
  if (!requestStateIsSingleLeadingSlashPath(next)) return '/';
  const sanitized = sanitizeNextOrigin(next);
  if (sanitized === undefined) return '/';

  // SPEC §6.5:724: if a route table is available, verify the candidate path resolves to
  // a known route. An unrecognized in-app path is stripped to avoid sending users to a
  // dead end (or an internal path that was never meant to be a public destination).
  if (routes !== undefined && routes.length > 0) {
    // Strip query string and hash to get the bare pathname for route matching.
    const pathnameOnly = requestStatePathname(sanitized);
    const match = matchRoute(routes, pathnameOnly);
    if (!match) return '/';
  }

  return sanitized;
}

function sanitizeNextOrigin(next: string): string | undefined {
  // SPEC §6.5 (P1-1, plans/compiler-soundness.md): the intrinsic helper both resolves against
  // the pinned origin and re-applies the scheme-relative guard to the NORMALIZED final scalar.
  return requestStateSameOriginPath(next, 'https://kovo.local');
}

export function guardFailureIsUnauthenticated<Request>(
  result: { auth?: ResolvedGuardFailure['auth'] },
  request: Request,
): boolean {
  if (result.auth === 'unauthenticated') return true;
  if (result.auth === 'unauthorized') return false;

  return principalPostureFromRequest(request).kind !== 'proven';
}

function rateLimitKey<Request extends SessionRequestLike>(
  request: Request,
  options: RateLimitOptions<Request>,
): string {
  if (options.key) {
    return requestStateRequiredRateLimitKey(options.key(request), 'guards.rateLimit({ key })');
  }
  if (options.per === 'global') return 'global';

  if (options.per === 'ip') {
    // SPEC §9.5:935: key by the framework-resolved client IP the request shell attached to
    // `req.clientIp` (see ClientIpRequestLike) from the trusted source the coarse limiter uses —
    // never a raw header read here. Namespace with an `ip:` prefix so an IP can never collide with
    // a session id bucket.
    const clientIpDescriptor = isObjectLike(request)
      ? witnessGetOwnPropertyDescriptor(request, 'clientIp')
      : undefined;
    const clientIp =
      clientIpDescriptor !== undefined && 'value' in clientIpDescriptor
        ? clientIpDescriptor.value
        : undefined;
    if (clientIp !== undefined && clientIp !== '') {
      return `ip:${requestStateRequiredRateLimitKey(clientIp, "guards.rateLimit({ per: 'ip' })")}`;
    }

    // Mirror the M3 protection below: refuse to silently collapse every client whose IP the shell
    // could not resolve into one shared `ip:unknown` bucket (a DoS lever that lets one attacker
    // 429-lock everyone). An absent `req.clientIp` means no trusted client-IP source is configured,
    // so fail loud rather than fake per-IP semantics.
    throw new Error(
      "guards.rateLimit({ per: 'ip' }) cannot derive a client IP: the request shell did not attach " +
        'a trustworthy `req.clientIp`. Configure the trusted client-IP source on ' +
        '`createApp({ requestLimits: { clientIp, trustedProxy } })` (SPEC §9.5), supply an explicit ' +
        "`key`, or use `per:'global'`/`per:'session'`.",
    );
  }

  const sessionKey = sessionRateLimitKey(request);
  if (sessionKey !== undefined) return sessionKey;

  // Security finding M3: with default (`per:'session'`) keying and no session id,
  // collapsing every anonymous client onto a single shared bucket lets one
  // attacker 429-lock out all anonymous users. Q.7 extends that to unresolved
  // session carriers: `anonymous`/`unknown`/blank/trimmed ids are not proven
  // principals, so they also fail closed instead of becoming a shared bucket.
  // Refuse to silently fake per-client semantics — require an explicit key
  // (e.g. framework-resolved client IP) or `per:'global'` for intentionally
  // shared unauthenticated/public rate limiting.
  throw new Error(
    'guards.rateLimit cannot derive a proven per-principal key: the request has no resolved ' +
      "principal and the default `per:'session'` scope would collapse unproven clients into one " +
      'shared bucket. Supply an explicit `key` (for example a framework-resolved client IP) for ' +
      "public endpoints, compose `guards.authed` before `rateLimit`, or set `per:'global'` to " +
      'throttle all clients together.',
  );
}

function sessionRateLimitKey(request: unknown): string | undefined {
  return requestPrincipalSnapshot(request).rateLimitKey;
}

function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}
