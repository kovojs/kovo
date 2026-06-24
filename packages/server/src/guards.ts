import type { Redirect as CoreRedirect } from '@kovojs/core';
import {
  createAppCapabilityUrlSigner,
  type AppCapabilityUrlOptions,
  type AppCapabilityUrlSigner,
} from './capability-url.js';
import {
  isDbAdapterLike,
  isPreparedStatementExecutionMethod,
  isSqlHandleLike,
  isSqlHandleProperty,
  validateManagedSqlStatement,
  type SqlSafetyMode,
} from '@kovojs/core/internal/sql-safety';
import type { ServerErrorHandler } from './diagnostics.js';
import { matchRoute, type RouteLike } from './match.js';
import type { ServerResponseBase } from './response.js';
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

/** A request narrowed to one with a present session user, produced by `guards.authed`. */
export type AuthenticatedRequest<Request extends SessionRequestLike> = Request & {
  session: NonNullable<Request['session']> & {
    user: NonNullable<NonNullable<Request['session']>['user']>;
  };
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
export type LifecycleRequest<RawRequest, SessionValue = never, DbValue = never> = RawRequest & {
  fetch: typeof fetch;
  signUrl?: AppCapabilityUrlSigner;
} & ([SessionValue] extends [never] ? {} : { session: SessionValue | null }) &
  ([DbValue] extends [never] ? {} : { db: DbValue });

/** Per-request options shared across the lifecycle: error hook plus session/db providers. */
/** @internal */
export interface RequestLifecycleOptions<RawRequest, SessionValue = unknown, DbValue = unknown> {
  db?: DbProvider<RawRequest, DbValue, SessionValue>;
  capabilityUrls?: AppCapabilityUrlOptions;
  /**
   * KV433 / SPEC §10.2: query loaders receive a managed DB handle in read mode by default.
   * Other lifecycle callers keep write-capable handles unless they opt into the same floor.
   */
  dbAccess?: 'read' | 'write';
  egressFetch?: typeof fetch;
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

/** Options for `guards.rateLimit`: window size, max requests, scope, and key function. */
export interface RateLimitOptions<Request> {
  key?: (request: Request) => string;
  max: number;
  maxKeys?: number;
  per?: 'global' | 'session';
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
   * Ownership guard (SPEC §10.3): passes only when the authenticated principal
   * owns the row the validated key selects, discharging the KV414 IDOR obligation
   * for that key. `keyOf` reads the owned-row key from the request (which carries
   * the validated args / resolved instance key, §10.3); `ownsRow` is the
   * app-provided ownership predicate — the app owns the data layer, so the guard
   * stays decoupled from Drizzle (the SPEC `owns((a) => a.id, table.col)`
   * column-form is compile-time sugar over this runtime contract). Composes with
   * the other guards, e.g. `all(authed, owns((req) => req.args.id, ownsOrder))`.
   */
  owns<Request extends SessionRequestLike, Key>(
    keyOf: (request: Request) => Key,
    ownsRow: (request: Request, key: Key) => boolean | Promise<boolean>,
  ): Guard<Request> {
    return async (request) => {
      if (!request.session?.user) return unauthenticatedGuardFailure();
      return (await ownsRow(request, keyOf(request))) ? true : unauthorizedGuardFailure();
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
  if (options.egressFetch !== undefined) {
    lifecycleRequest = requestWithProperty(lifecycleRequest, 'fetch', options.egressFetch);
  }

  if (options.capabilityUrls !== undefined) {
    lifecycleRequest = requestWithProperty(
      lifecycleRequest,
      'signUrl',
      createAppCapabilityUrlSigner(requestUrlForCapabilityMinting(request), options.capabilityUrls),
    );
  }

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

  if (options.db) {
    const dbValue = await options.db(lifecycleRequest as LifecycleRequest<Request, SessionValue>);
    const sqlSafeDb = wrapManagedDbForSqlSafety(dbValue, managedSqlSafetyMode());
    lifecycleRequest = requestWithProperty(
      lifecycleRequest,
      'db',
      options.dbAccess === 'read' ? wrapManagedDbForReadOnly(sqlSafeDb) : sqlSafeDb,
    );
  }

  return lifecycleRequest as LifecycleRequest<Request, SessionValue, DbValue>;
}

function requestUrlForCapabilityMinting(request: unknown): string {
  if (request && typeof request === 'object' && 'url' in request) {
    const url = (request as { url?: unknown }).url;
    if (typeof url === 'string') return url;
  }
  return 'http://localhost/';
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

    return {
      body: '',
      headers: { Location: redirectResult.location },
      status: redirectResult.status,
    };
  }

  return {
    body: options.renderForbidden ? await options.renderForbidden({ request }) : 'Forbidden',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 403,
  };
}

function managedSqlSafetyMode(): SqlSafetyMode {
  const configured =
    typeof process === 'object' && process !== null ? process.env.KOVO_SQL_GUARD : undefined;
  if (configured === 'enforce' || configured === 'off' || configured === 'warn') return configured;
  return process.env.NODE_ENV === 'production' ? 'warn' : 'enforce';
}

function wrapManagedDbForSqlSafety<DbValue>(db: DbValue, mode: SqlSafetyMode): DbValue {
  if (mode === 'off' || !isDbAdapterLike(db)) return db;

  const proxyCache = new WeakMap<object, object>();
  const methodCache = new WeakMap<object, Map<PropertyKey, Function>>();
  return wrapDbAdapter(db, mode, proxyCache, methodCache) as DbValue;
}

const readOnlyDbWriteMethods = new Set<PropertyKey>([
  'delete',
  'execute',
  'insert',
  'update',
  'write',
]);

function wrapManagedDbForReadOnly<DbValue>(db: DbValue): DbValue {
  if ((typeof db !== 'object' && typeof db !== 'function') || db === null) return db;

  return wrapReadOnlyDbObject(db, new WeakMap(), new WeakMap()) as DbValue;
}

function wrapReadOnlyDbObject(
  db: object,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): object {
  const cached = proxyCache.get(db);
  if (cached) return cached;

  const proxy = new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof value === 'function') {
        if (readOnlyDbWriteMethods.has(prop)) {
          return cachedSqlSafetyMethod(target, prop, value, methodCache, () => () => {
            throw new Error(
              `KV433 read-only query DB handle blocked write method "${String(prop)}"`,
            );
          });
        }

        if (prop === 'transaction') {
          return cachedSqlSafetyMethod(
            target,
            prop,
            value,
            methodCache,
            () =>
              (callback: (tx: object) => unknown, ...args: unknown[]) =>
                value.call(
                  target,
                  (tx: object) => callback(wrapReadOnlyDbObject(tx, proxyCache, methodCache)),
                  ...args,
                ),
          );
        }

        return cachedSqlSafetyMethod(target, prop, value, methodCache, () => value.bind(target));
      }

      if ((typeof value === 'object' || typeof value === 'function') && value !== null) {
        return wrapReadOnlyDbObject(value, proxyCache, methodCache);
      }

      return value;
    },
  });

  proxyCache.set(db, proxy);
  return proxy;
}

function wrapDbAdapter(
  db: object,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): object {
  const cached = proxyCache.get(db);
  if (cached) return cached;

  const proxy = new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (isSqlHandleProperty(prop) && isSqlHandleLike(value)) {
        return wrapSqlHandle(value, mode, proxyCache, methodCache);
      }

      if (prop === 'sql' && typeof value === 'function' && isDbAdapterLike(target)) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode),
        );
      }

      if (
        (prop === 'query' || prop === 'exec' || prop === 'execute') &&
        typeof value === 'function' &&
        (isDbAdapterLike(target) || isSqlHandleLike(target))
      ) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode),
        );
      }

      if (prop === 'prepare' && typeof value === 'function' && isSqlHandleLike(target)) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedPrepareMethod(target, value, mode, proxyCache, methodCache),
        );
      }

      return typeof value === 'function'
        ? cachedSqlSafetyMethod(target, prop, value, methodCache, () => value.bind(target))
        : value;
    },
  });

  proxyCache.set(db, proxy);
  return proxy;
}

function wrapSqlHandle(
  handle: object,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): object {
  const cached = proxyCache.get(handle);
  if (cached) return cached;

  const proxy = new Proxy(handle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'transaction' && typeof value === 'function') {
        return cachedSqlSafetyMethod(
          target,
          prop,
          value,
          methodCache,
          () =>
            (callback: (tx: object) => unknown, ...args: unknown[]) =>
              value.call(
                target,
                (tx: object) => callback(wrapSqlHandle(tx, mode, proxyCache, methodCache)),
                ...args,
              ),
        );
      }

      if (
        (prop === 'query' || prop === 'exec' || prop === 'execute') &&
        typeof value === 'function'
      ) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode),
        );
      }

      if (prop === 'prepare' && typeof value === 'function') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedPrepareMethod(target, value, mode, proxyCache, methodCache),
        );
      }

      return typeof value === 'function'
        ? cachedSqlSafetyMethod(target, prop, value, methodCache, () => value.bind(target))
        : value;
    },
  });

  proxyCache.set(handle, proxy);
  return proxy;
}

function guardedSqlMethod(target: object, value: Function, mode: SqlSafetyMode): Function {
  return (statement: unknown, ...args: unknown[]) => {
    assertManagedSqlStatement(statement, mode);
    return value.call(target, statement, ...args);
  };
}

function guardedPrepareMethod(
  target: object,
  value: Function,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): Function {
  return (statement: unknown, ...args: unknown[]) => {
    assertManagedSqlStatement(statement, mode);
    const prepared = value.call(target, statement, ...args);
    return typeof prepared === 'object' && prepared !== null
      ? wrapPreparedSqlStatement(prepared, mode, proxyCache, methodCache)
      : prepared;
  };
}

function wrapPreparedSqlStatement(
  statementHandle: object,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): object {
  const cached = proxyCache.get(statementHandle);
  if (cached) return cached;

  const proxy = new Proxy(statementHandle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (isPreparedStatementExecutionMethod(prop) && typeof value === 'function') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () => value.bind(target));
      }

      return typeof value === 'function'
        ? cachedSqlSafetyMethod(target, prop, value, methodCache, () => value.bind(target))
        : value;
    },
  });

  proxyCache.set(statementHandle, proxy);
  return proxy;
}

function assertManagedSqlStatement(statement: unknown, mode: SqlSafetyMode): void {
  const validation = validateManagedSqlStatement(statement);
  if (validation.ok) return;
  if (mode === 'warn') {
    console.warn(validation.message);
    return;
  }
  throw new Error(validation.message);
}

function cachedSqlSafetyMethod(
  target: object,
  prop: PropertyKey,
  value: Function,
  cache: WeakMap<object, Map<PropertyKey, Function>>,
  factory: () => Function,
): Function {
  let targetCache = cache.get(target);
  if (!targetCache) {
    targetCache = new Map();
    cache.set(target, targetCache);
  }
  const cached = targetCache.get(prop);
  if (cached) return cached;

  const next = factory();
  targetCache.set(prop, next);
  return next;
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
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
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
