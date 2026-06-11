import { guards } from '@jiso/server';
import type {
  AuthenticatedRequest,
  Guard,
  GuardFailure,
  MaybePromise,
  SessionProvider,
  SessionRequestLike,
} from '@jiso/server';

export interface BetterAuthGetSessionOptions {
  headers: Headers;
}

export interface BetterAuthSessionPayload<Session, User> {
  session: Session;
  user: User;
}

export interface BetterAuthApi<Session, User> {
  getSession(
    options: BetterAuthGetSessionOptions,
  ): MaybePromise<BetterAuthSessionPayload<Session, User> | null | undefined>;
}

export interface BetterAuthLike<Session, User> {
  api: BetterAuthApi<Session, User>;
}

export interface BetterAuthRequestLike {
  headers: Headers;
}

export type BetterAuthSessionMapper<AuthSession, AuthUser, SessionValue> = (
  value: BetterAuthSessionPayload<AuthSession, AuthUser>,
) => SessionValue;

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

export function authed<Request extends SessionRequestLike>(): Guard<
  Request,
  AuthenticatedRequest<Request>
> {
  return guards.authed<Request>();
}

export interface BetterAuthRoleUser {
  id?: string;
  roles?: readonly string[] | null;
}

export interface BetterAuthRoleSession {
  user?: BetterAuthRoleUser | null;
}

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

export interface BetterAuthOrganizationSession extends BetterAuthRoleSession {
  activeOrganizationId?: string | null;
}

export interface BetterAuthOrganizationRequest {
  session?: BetterAuthOrganizationSession | null;
}

export type ActiveOrganizationRequest<Request extends BetterAuthOrganizationRequest> = Request & {
  session: NonNullable<Request['session']> & {
    activeOrganizationId: string;
    user: NonNullable<NonNullable<Request['session']>['user']>;
  };
};

export function activeOrganization<Request extends BetterAuthOrganizationRequest>(): Guard<
  Request,
  ActiveOrganizationRequest<Request>
> {
  return (request) => {
    if (!request.session?.user) return unauthenticatedGuardFailure();

    return request.session.activeOrganizationId ? true : unauthorizedGuardFailure();
  };
}

// SPEC.md §6.5 and §10.3: adapter guards preserve anonymous vs unauthorized failures.
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
