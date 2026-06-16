import type { Redirect as CoreRedirect } from '@jiso/core';
import type { ServerErrorHandler } from './diagnostics.js';
import type { ServerResponseBase } from './response.js';
import type { Schema } from './schema.js';

/** A guard's failure outcome: the auth/rate-limit reason, status, and optional retry-after. */
export interface GuardFailure {
  auth?: 'unauthenticated' | 'unauthorized';
  code: 'RATE_LIMITED' | 'UNAUTHORIZED';
  payload?: Record<string, unknown>;
  retryAfter?: number;
  status: 422 | 429;
}

/** What a guard returns: `true` to allow, or a `GuardFailure` to reject. */
export type GuardResult = boolean | GuardFailure;

/** An access guard over a request; may refine the request type when it passes. */
export interface Guard<Request, RefinedRequest extends Request = Request> {
  (request: Request): GuardResult | Promise<GuardResult>;
  readonly refines?: (request: Request) => request is RefinedRequest;
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

/** A function that resolves the session value from a raw request (or null). */
export type SessionProvider<RawRequest, SessionValue> = (
  request: RawRequest,
) => Promise<SessionValue | null | undefined> | SessionValue | null | undefined;

/** Per-request options shared across the lifecycle: error hook and session provider. */
export interface RequestLifecycleOptions<RawRequest, SessionValue = unknown> {
  onError?: ServerErrorHandler;
  sessionProvider?: SessionProvider<RawRequest, SessionValue>;
}

export interface UnauthenticatedContext<Request> {
  next: string;
  request: Request;
}

export type UnauthenticatedHandler<Request> = (
  context: UnauthenticatedContext<Request>,
) => CoreRedirect | Promise<CoreRedirect>;

export interface ForbiddenContext<Request> {
  request: Request;
}

export type ForbiddenRenderer<Request> = (
  context: ForbiddenContext<Request>,
) => string | Promise<string>;

export interface GuardFailureResponseOptions<
  Request,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  currentUrl?: string;
  loginPath?: string;
  onUnauthenticated?: UnauthenticatedHandler<Request>;
  renderForbidden?: ForbiddenRenderer<Request>;
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
 * import { guards, route, type SessionRequestLike } from '@jiso/server';
 *
 * interface AppRequest extends SessionRequestLike {}
 *
 * export const dashboard = route('/dashboard', {
 *   guard: guards.authed<AppRequest>(),
 *   page: () => '<h1>Dashboard</h1>',
 * });
 */
export const guards = {
  all<Request, RefinedRequest extends Request = Request>(
    ...items: Guard<Request, RefinedRequest>[]
  ): Guard<Request, RefinedRequest> {
    return async (request: Request) => {
      for (const item of items) {
        const result = await item(request);
        if (result !== true) return guardFailureFromResult(result);
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
};

/**
 * Declare the session schema for the app: how to `parse` the raw session into a
 * typed value, and how to wire a `provider` that resolves the session from a
 * request. The parsed type flows into guards and request types (SPEC §6.5).
 *
 * @param schema - A `Schema` describing the session shape.
 * @returns A `SessionDefinition` with `parse`, `provider`, and the `schema`.
 * @example
 * import { s, session } from '@jiso/server';
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
): Promise<GuardFailure | null> {
  if (!guard) return null;

  const result = await guard(request);
  return result === true ? null : guardFailureFromResult(result);
}

export async function resolveLifecycleRequest<Request, SessionValue>(
  request: Request,
  options: RequestLifecycleOptions<Request, SessionValue> = {},
): Promise<Request> {
  if (!options.sessionProvider) return request;

  const sessionValue = (await options.sessionProvider(request)) ?? null;
  return requestWithSession(request, sessionValue);
}

export async function renderHttpGuardFailureResponse<Request>(
  result: {
    auth?: GuardFailure['auth'];
    error?: { code: string };
    ok: false;
    status: number;
  },
  request: Request,
  options: GuardFailureResponseOptions<Request>,
): Promise<HttpGuardFailureResponse | undefined> {
  if (result.status !== 422 || result.error?.code !== 'UNAUTHORIZED') return undefined;

  if (guardFailureIsUnauthenticated(result, request)) {
    const next = options.currentUrl ?? '/';
    const context = { next, request };
    const redirectResult = await (options.onUnauthenticated
      ? options.onUnauthenticated(context)
      : defaultOnUnauthenticated(context, options.loginPath));

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

function guardFailureFromResult(result: GuardResult): GuardFailure {
  if (typeof result === 'object') return result;

  return {
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
  };
}

function rateLimitFailure(resetAt: number, now: number): GuardFailure {
  return {
    code: 'RATE_LIMITED',
    payload: {},
    retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    status: 429,
  };
}

function unauthenticatedGuardFailure(): GuardFailure {
  return {
    auth: 'unauthenticated',
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
  };
}

function unauthorizedGuardFailure(): GuardFailure {
  return {
    auth: 'unauthorized',
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
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

function requestWithSession<Request, SessionValue>(
  request: Request,
  sessionValue: SessionValue | null,
): Request {
  if ((typeof request !== 'object' && typeof request !== 'function') || request === null) {
    return { session: sessionValue } as Request;
  }

  return new Proxy(request as object, {
    get(target, property) {
      if (property === 'session') return sessionValue;

      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === 'session') {
        return {
          configurable: true,
          enumerable: true,
          value: sessionValue,
          writable: false,
        };
      }

      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    has(target, property) {
      return property === 'session' || property in target;
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      return keys.includes('session') ? keys : [...keys, 'session'];
    },
  }) as Request;
}

function defaultOnUnauthenticated<Request>(
  context: UnauthenticatedContext<Request>,
  loginPath = '/login',
): CoreRedirect {
  return {
    location: loginLocationWithNext(loginPath, context.next),
    status: 303,
  };
}

function loginLocationWithNext(loginPath: string, next: string): string {
  const base = 'https://jiso.local';
  const url = new URL(loginPath, base);
  url.searchParams.set('next', next);

  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

function guardFailureIsUnauthenticated<Request>(
  result: { auth?: GuardFailure['auth'] },
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
