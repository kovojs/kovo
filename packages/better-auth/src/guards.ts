import { guards } from '@kovojs/server';
import type { AuthenticatedRequest, Guard, SessionRequestLike } from '@kovojs/server';

import { unauthenticatedGuardFailure, unauthorizedGuardFailure } from './internal.js';

/**
 * Guard that requires an authenticated session, narrowing the request to an
 * `AuthenticatedRequest`. A thin re-export of the framework's `guards.authed` for use on
 * auth-protected mutations and routes; an unauthenticated request denies with a
 * login-redirect intent (SPEC.md §6.5).
 */
export function authed<Request extends SessionRequestLike>(): Guard<
  Request,
  AuthenticatedRequest<Request>
> {
  return guards.authed<Request>();
}

/**
 * Minimal user shape the `role` guard reads: an optional `id` and an optional `roles`
 * list. Apps' own session-user types structurally satisfy this (SPEC.md §6.5).
 */
export interface BetterAuthRoleUser {
  id?: string;
  roles?: readonly string[] | null;
}

/** Minimal session shape the `role` guard reads: an optional `user`. */
export interface BetterAuthRoleSession {
  user?: BetterAuthRoleUser | null;
}

/** Minimal request shape the `role` guard reads: an optional `session`. */
export interface BetterAuthRoleRequest {
  session?: BetterAuthRoleSession | null;
}

type SessionFor<Request extends BetterAuthRoleRequest> = NonNullable<Request['session']>;
type UserFor<Request extends BetterAuthRoleRequest> = NonNullable<SessionFor<Request>['user']>;
type RoleNameFor<Request extends BetterAuthRoleRequest> =
  UserFor<Request> extends {
    roles?: readonly (infer Role)[] | null;
  }
    ? Extract<Role, string>
    : string;

/**
 * Guard that requires the session user to hold a given role. Denies with an
 * unauthenticated (→ login redirect) intent when there is no session user, and with a
 * forbidden (→ 403) intent when the user lacks the role. The role name is type-checked
 * against the request's own `roles` element type when known (SPEC.md §6.5).
 */
export function role<Request extends BetterAuthRoleRequest>(
  requiredRole: RoleNameFor<Request>,
): Guard<Request>;
export function role(requiredRole: string): Guard<BetterAuthRoleRequest>;
export function role(requiredRole: string): Guard<BetterAuthRoleRequest> {
  return (request) => {
    if (!request.session?.user) return unauthenticatedGuardFailure();

    return request.session.user.roles?.includes(requiredRole) === true
      ? true
      : unauthorizedGuardFailure();
  };
}
