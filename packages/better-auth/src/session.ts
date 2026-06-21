import type { SessionProvider, SessionProviderResult } from '@kovojs/server';

import {
  getBetterAuthSetCookie,
  type BetterAuthGetSessionWithHeadersResult,
  type BetterAuthLike,
  type BetterAuthRequestLike,
} from './internal.js';

/**
 * The `{ session, user }` pair Better Auth returns for an authenticated request. The
 * adapter maps this into the app's own session value via a `BetterAuthSessionMapper`;
 * see SPEC.md §6.5 for how sessions flow into the request.
 */
export interface BetterAuthSessionPayload<Session, User> {
  session: Session;
  user: User;
}

/**
 * Function the app supplies to `betterAuthSession` to project Better Auth's
 * `{ session, user }` payload into the app's own session value. Called once per
 * authenticated request (SPEC.md §6.5).
 */
export type BetterAuthSessionMapper<AuthSession, AuthUser, SessionValue> = (
  value: BetterAuthSessionPayload<AuthSession, AuthUser>,
) => SessionValue;

/**
 * Builds a Kovo `SessionProvider` backed by Better Auth: it calls
 * `auth.api.getSession({ headers, returnHeaders: true })` for each request and projects the
 * result through `map` into the app's session value, returning `null` when there is no
 * session. Wire the returned provider into `session(...)` so guards and pages see the
 * authenticated user (SPEC.md §6.5).
 *
 * part-3 I2 (SPEC.md §6.5, §9.1.1:854): Better Auth writes fresh session-refresh /
 * cookie-cache `Set-Cookie` headers on every authenticated request once rolling sessions
 * (`updateAge`) or `cookieCache` are enabled (the default for the former). Reading only the
 * payload — as the prior implementation did — silently dropped those headers, so a
 * continuously-active user was hard-logged-out at the original session boundary and the
 * cookie cache never populated. The provider now requests the response headers
 * (`returnHeaders: true`) and forwards every refresh `Set-Cookie` through the additive
 * `SessionProviderResult.setCookies` channel so the framework re-emits them on the GET
 * response. The provider still resolves to a plain mapped value when there are no refresh
 * cookies, so the contract stays backward compatible.
 */
export function betterAuthSession<
  AuthSession,
  AuthUser,
  SessionValue,
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
>(
  auth: BetterAuthLike<AuthSession, AuthUser>,
  map: BetterAuthSessionMapper<AuthSession, AuthUser, SessionValue>,
): SessionProvider<Request, SessionValue> {
  return async (request): Promise<SessionProviderResult<SessionValue> | SessionValue | null> => {
    const result = await auth.api.getSession({
      headers: request.headers,
      returnHeaders: true,
    });

    // BACKWARD-COMPAT shape detection: an instance that honors `returnHeaders` returns the
    // `{ response, headers }` envelope; one that ignores it (the example apps, a
    // non-overloaded instance) returns the bare session payload. A session payload never
    // carries both `response` and `headers`, so their joint presence identifies the envelope.
    const isEnvelope =
      result !== null &&
      typeof result === 'object' &&
      'response' in result &&
      'headers' in result;
    const payload = isEnvelope
      ? (result as BetterAuthGetSessionWithHeadersResult<AuthSession, AuthUser>).response
      : (result as BetterAuthSessionPayload<AuthSession, AuthUser> | null | undefined);
    const value = payload ? map(payload) : null;

    const headers = isEnvelope
      ? (result as BetterAuthGetSessionWithHeadersResult<AuthSession, AuthUser>).headers
      : undefined;
    const setCookies = getBetterAuthSetCookie(headers);

    // Forward refresh/cookie-cache Set-Cookie headers only when the instance actually
    // produced them; otherwise resolve to the plain mapped value so the contract is fully
    // backward compatible (no envelope unless there is something to forward).
    return setCookies.length > 0 ? { setCookies, value } : value;
  };
}
