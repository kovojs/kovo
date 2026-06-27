import type { Redirect as CoreRedirect } from '@kovojs/core';
import { managedDb, type ManagedDbMode } from './managed-db.js';
import type { ServerErrorHandler } from './diagnostics.js';
import { matchRoute, type RouteLike } from './match.js';
import {
  blessRedirectResponse,
  redirectLocationHeader,
  type ServerResponseBase,
} from './response.js';
import type { Schema } from './schema.js';

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

/**
 * Back-compat alias for {@link GuardDenial}: the type a guard returns to reject a
 * request (SPEC §6.5).
 *
 * @deprecated Use {@link GuardDenial}. Retained as a documented alias so external
 * code that imported the previous denial type keeps compiling; the intent-based
 * `kind` discriminant (SPEC §6.5) replaces the old `code`/`status` fields, which
 * advertised an internal sentinel status (422) the browser never received on the
 * documented auth paths.
 */
export type GuardFailure = GuardDenial;

/** What a guard returns: `true` to allow, or a {@link GuardDenial} to reject (SPEC §6.5). */
export type GuardResult = boolean | GuardDenial;

/** An access guard over a request; may refine the request type when it passes. */
export interface Guard<Request, RefinedRequest extends Request = Request> {
  (request: Request): GuardResult | Promise<GuardResult>;
  readonly refines?: (request: Request) => request is RefinedRequest;
}

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
  return (
    typeof result === 'object' &&
    result !== null &&
    'value' in result &&
    'setCookies' in result &&
    Array.isArray((result as { setCookies?: unknown }).setCookies)
  );
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
  /** @internal Query/list result item ceiling enforced by the query runtime sink (SPEC §9.5). */
  maxListItems?: number;
  /**
   * The managed-handle mode the framework applies to the resolved `request.db` (SPEC §9.4/§10.3).
   * `'read'` installs the KV433 read-only proxy (a `query()` loader's handle); `'write'` (the
   * default) installs only the KV422 SQL-safe handle (a `mutation()`/`query.elevated` handle).
   * @internal
   */
  dbMode?: ManagedDbMode;
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

interface HttpGuardFailureResponse extends ServerResponseBase<
  string,
  Record<string, string>,
  303 | 403
> {}

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
export const guards = {
  all<Request, RefinedRequest extends Request = Request>(
    ...items: Guard<Request, RefinedRequest>[]
  ): Guard<Request, RefinedRequest> {
    return async (request: Request) => {
      for (const item of items) {
        const result = await item(request);
        // Propagate the first denial (intent object) or bare `false` as-is so the
        // §6.5 status mapping stays owned by the render path, not flattened here.
        if (result !== true) return result;
      }

      return true;
    };
  },
  authed<Request extends SessionRequestLike>(): Guard<Request, AuthenticatedRequest<Request>> {
    return (request) => (request.session?.user ? true : unauthenticatedGuardFailure());
  },
  rateLimit<Request extends SessionRequestLike>(
    options: RateLimitOptions<Request>,
  ): Guard<Request> {
    const counts = new Map<string, { count: number; resetAt: number }>();

    return (request) => {
      const now = Date.now();
      evictExpiredRateLimits(counts, now);

      const windowMs = options.windowMs ?? defaultRateLimitWindowMs;
      if (options.max <= 0) return rateLimitFailure(now + windowMs, now);

      const key = rateLimitKey(request, options);
      const existing = counts.get(key);

      if (existing && existing.resetAt > now) {
        if (existing.count >= options.max) return rateLimitFailure(existing.resetAt, now);

        existing.count += 1;
        return true;
      }

      const maxKeys = options.maxKeys ?? defaultRateLimitMaxKeys;
      while (counts.size >= maxKeys) {
        const oldest = counts.keys().next().value;
        if (oldest === undefined) break;
        counts.delete(oldest);
      }

      counts.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return true;
    };
  },
  role<Request extends SessionRequestLike>(role: string): Guard<Request> {
    return (request) => {
      if (!request.session?.user) return unauthenticatedGuardFailure();
      return request.session.user.roles?.includes(role) ? true : unauthorizedGuardFailure();
    };
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
  ): Guard<Request> {
    return async (request) => {
      if (!request.session?.user) return unauthenticatedGuardFailure();
      // The query/mutation/route runners merge the validated args / resolved params onto `request`
      // BEFORE this guard runs (SPEC §10.3:1155-1157), so the runtime value is a `KeyedRequest`
      // even though the guard's *attachment* type is the base request. View it as such for `keyOf`.
      const keyedRequest = request as unknown as KeyedRequest;
      return (await ownsRow(keyedRequest, keyOf(keyedRequest))) ? true : unauthorizedGuardFailure();
    };
  },
};

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
    if (isSessionProviderResult<SessionValue>(resolved)) {
      sessionValue = resolved.value ?? null;
      if (options.onSessionSetCookie) {
        for (const cookie of resolved.setCookies ?? []) options.onSessionSetCookie(cookie);
      }
    } else {
      sessionValue = resolved ?? null;
    }
    lifecycleRequest = requestWithProperty(lifecycleRequest, 'session', sessionValue);
  }

  // SPEC §9.5: attach the framework-resolved trustworthy client IP onto the request BEFORE the guard
  // chain so `guards.rateLimit({ per: 'ip' })` (and any arg-aware guard) can read `req.clientIp`. The
  // resolver is the SAME trusted source the coarse limiter uses (app-configured extractor / trusted
  // proxy headers only); an empty/undefined result is not attached, so per-IP keying fails loud.
  if (options.clientIp) {
    const clientIp = options.clientIp(request);
    if (clientIp !== undefined && clientIp !== '') {
      lifecycleRequest = requestWithProperty(lifecycleRequest, 'clientIp', clientIp);
    }
  }

  if (options.db) {
    const dbValue = await options.db(lifecycleRequest as LifecycleRequest<Request, SessionValue>);
    // SPEC §6.6/§9.4/§10.3 (MARQUEE): the framework OWNS the handle threaded onto `request.db`.
    // `managedDb` composes the KV422 SQL-safe wrap with the KV433 read/write mode: a query loader's
    // request carries the read-only handle (write verbs throw), a mutation/elevated request carries
    // the read-write handle. The mode defaults to 'write' so direct/legacy callers keep read-write
    // `request.db`; `runQuery` passes 'read' so loaders are read-only end to end.
    lifecycleRequest = requestWithProperty(
      lifecycleRequest,
      'db',
      managedDb(dbValue, options.dbMode ?? 'write'),
    );
  }

  return lifecycleRequest as LifecycleRequest<Request, SessionValue, DbValue>;
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

    return blessRedirectResponse({
      body: '',
      headers: { Location: redirectLocationHeader(redirectResult.location) },
      status: redirectResult.status,
    });
  }

  return {
    body: options.renderForbidden ? await options.renderForbidden({ request }) : 'Forbidden',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
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
    retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
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
  for (const [key, record] of counts) {
    if (record.resetAt <= now) counts.delete(key);
  }
}

function requestWithProperty<Request, Key extends string, Value>(
  request: Request,
  key: Key,
  value: Value,
): Request & Record<Key, Value> {
  if ((typeof request !== 'object' && typeof request !== 'function') || request === null) {
    return { [key]: value } as Request & Record<Key, Value>;
  }

  return new Proxy(request as object, {
    get(target, property) {
      if (property === key) return value;

      const targetValue = Reflect.get(target, property, target) as unknown;
      return typeof targetValue === 'function' ? targetValue.bind(target) : targetValue;
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === key) {
        return {
          configurable: true,
          enumerable: true,
          value,
          writable: false,
        };
      }

      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    has(target, property) {
      return property === key || property in target;
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      return keys.includes(key) ? keys : [...keys, key];
    },
  }) as Request & Record<Key, Value>;
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
  const url = new URL(loginPath, base);
  url.searchParams.set('next', sanitizeNext(next, routes));

  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : url.toString();
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
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  const sanitized = sanitizeNextOrigin(next);
  if (sanitized === undefined) return '/';

  // SPEC §6.5:724: if a route table is available, verify the candidate path resolves to
  // a known route. An unrecognized in-app path is stripped to avoid sending users to a
  // dead end (or an internal path that was never meant to be a public destination).
  if (routes !== undefined && routes.length > 0) {
    // Strip query string and hash to get the bare pathname for route matching.
    const pathnameOnly = sanitized.replace(/[?#].*$/, '');
    const match = matchRoute(routes, pathnameOnly);
    if (!match) return '/';
  }

  return sanitized;
}

function sanitizeNextOrigin(next: string): string | undefined {
  try {
    const base = 'https://kovo.local';
    const resolved = new URL(next, base);
    if (resolved.origin !== base) return undefined;
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    // SPEC §6.5 (P1-1, plans/compiler-soundness.md): re-apply the scheme-relative guard to the
    // NORMALIZED path. WHATWG URL-with-base normalization can collapse e.g. `/..//evil.com` (or its
    // percent-encoded `/%2e%2e//evil.com`) to pathname `//evil.com` while the origin stays the base,
    // so the raw-input prefix check at the call site never saw the synthesized leading `//`. A
    // base-less `Location: //evil.com` header is protocol-relative and resolves cross-origin, so fail
    // closed unless the final string the header will carry is a strict single-leading-slash path.
    if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return undefined;
    return path;
  } catch {
    return undefined;
  }
}

export function guardFailureIsUnauthenticated<Request>(
  result: { auth?: ResolvedGuardFailure['auth'] },
  request: Request,
): boolean {
  if (result.auth === 'unauthenticated') return true;
  if (result.auth === 'unauthorized') return false;

  return requestSession(request) == null;
}

function requestSession(request: unknown): unknown {
  if (
    (typeof request === 'object' || typeof request === 'function') &&
    request !== null &&
    'session' in request
  ) {
    return (request as { session?: unknown }).session;
  }

  return undefined;
}

function rateLimitKey<Request extends SessionRequestLike>(
  request: Request,
  options: RateLimitOptions<Request>,
): string {
  if (options.key) return options.key(request);
  if (options.per === 'global') return 'global';

  if (options.per === 'ip') {
    // SPEC §9.5:935: key by the framework-resolved client IP the request shell attached to
    // `req.clientIp` (see ClientIpRequestLike) from the trusted source the coarse limiter uses —
    // never a raw header read here. Namespace with an `ip:` prefix so an IP can never collide with
    // a session id bucket.
    const clientIp = (request as ClientIpRequestLike).clientIp;
    if (clientIp !== undefined && clientIp !== '') return `ip:${clientIp}`;

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

  const sessionKey = request.session?.id ?? request.session?.user?.id;
  if (sessionKey !== undefined) return sessionKey;

  // Security finding M3: with default (`per:'session'`) keying and no session id,
  // collapsing every anonymous client onto a single shared bucket lets one
  // attacker 429-lock out all anonymous users. Refuse to silently fake per-client
  // semantics — require an explicit key (e.g. client IP/fingerprint) or
  // `per:'global'` for unauthenticated/public rate limiting.
  throw new Error(
    'guards.rateLimit cannot derive a per-client key: the request has no session id and ' +
      "the default `per:'session'` scope would collapse all unauthenticated clients into one " +
      'shared bucket. Supply an explicit `key` (for example the client IP) for public endpoints, ' +
      "compose `guards.authed` before `rateLimit`, or set `per:'global'` to throttle all clients together.",
  );
}
