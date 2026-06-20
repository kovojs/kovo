import type { SessionProvider } from '@kovojs/server';

import type { BetterAuthLike, BetterAuthRequestLike } from './internal.js';

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
 * `auth.api.getSession({ headers })` for each request and projects the result through
 * `map` into the app's session value, returning `null` when there is no session. Wire the
 * returned provider into `session(...)` so guards and pages see the authenticated user
 * (SPEC.md §6.5).
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
  return async (request) => {
    const value = await auth.api.getSession({ headers: request.headers });

    if (!value) return null;

    return map(value);
  };
}
