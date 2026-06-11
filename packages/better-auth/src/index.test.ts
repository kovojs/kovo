import type { Guard, SessionProvider } from '@jiso/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  activeOrganization,
  authed,
  betterAuthSession,
  role,
  type ActiveOrganizationRequest,
  type BetterAuthLike,
} from './index.js';

type AuthSession = {
  activeOrganizationId: null | string;
  id: string;
};

type AuthUser = {
  email: string;
  id: string;
  roles: readonly ('admin' | 'member')[];
};

type AppSession = {
  activeOrganizationId: null | string;
  id: string;
  user: {
    email: string;
    id: string;
    roles: readonly ('admin' | 'member')[];
  };
};

type RequestWithHeaders = {
  headers: Headers;
};

type AppRequest = {
  session?: AppSession | null;
};

class FakeBetterAuth implements BetterAuthLike<AuthSession, AuthUser> {
  readonly api = {
    getSession: (options: { headers: Headers }) => {
      this.lastHeaders = options.headers;

      if (options.headers.get('cookie') !== 'jiso_session=s1') return null;

      return {
        session: {
          activeOrganizationId: 'org-1',
          id: 'session-1',
        },
        user: {
          email: 'ada@example.com',
          id: 'user-1',
          roles: ['admin', 'member'] as const,
        },
      };
    },
  };

  lastHeaders: Headers | undefined;
}

function mapSession(value: { session: AuthSession; user: AuthUser }): AppSession {
  return {
    activeOrganizationId: value.session.activeOrganizationId,
    id: value.session.id,
    user: {
      email: value.user.email,
      id: value.user.id,
      roles: value.user.roles,
    },
  };
}

describe('betterAuthSession', () => {
  it('maps a Better Auth-like session into the app session provider seam', async () => {
    const auth = new FakeBetterAuth();
    const headers = new Headers({ cookie: 'jiso_session=s1' });
    const provider = betterAuthSession(auth, mapSession);

    await expect(provider({ headers })).resolves.toEqual({
      activeOrganizationId: 'org-1',
      id: 'session-1',
      user: {
        email: 'ada@example.com',
        id: 'user-1',
        roles: ['admin', 'member'],
      },
    });
    expect(auth.lastHeaders).toBe(headers);
  });

  it('treats a missing Better Auth session as anonymous', async () => {
    const auth = new FakeBetterAuth();
    const provider = betterAuthSession(auth, mapSession);

    await expect(provider({ headers: new Headers() })).resolves.toBe(null);
  });

  it('keeps the mapper total against the declared app session type', () => {
    const auth = new FakeBetterAuth();
    const provider: SessionProvider<RequestWithHeaders, AppSession> = betterAuthSession(
      auth,
      mapSession,
    );

    expectTypeOf(provider).toEqualTypeOf<SessionProvider<RequestWithHeaders, AppSession>>();

    const incompleteMapper = (value: { session: AuthSession; user: AuthUser }) => ({
      activeOrganizationId: value.session.activeOrganizationId,
      id: value.session.id,
      user: {
        id: value.user.id,
        roles: value.user.roles,
      },
    });

    // @ts-expect-error SPEC.md §6.5: dropped declared session fields make the mapper red.
    const incompleteProvider: SessionProvider<RequestWithHeaders, AppSession> = betterAuthSession(
      auth,
      incompleteMapper,
    );
    expect(incompleteProvider).toBeTypeOf('function');
  });
});

describe('guard bindings', () => {
  it('uses the core authed guard contract over the mapped session', async () => {
    const guard = authed<AppRequest>();

    expect(await guard({ session: null })).toEqual({
      auth: 'unauthenticated',
      code: 'UNAUTHORIZED',
      payload: {},
      status: 422,
    });
    expect(
      await guard({
        session: {
          activeOrganizationId: null,
          id: 'session-1',
          user: {
            email: 'ada@example.com',
            id: 'user-1',
            roles: ['member'],
          },
        },
      }),
    ).toBe(true);
  });

  it('binds role checks to typed session role names', async () => {
    const admin = role<AppRequest>('admin');
    const memberOnly: AppRequest = {
      session: {
        activeOrganizationId: null,
        id: 'session-1',
        user: {
          email: 'ada@example.com',
          id: 'user-1',
          roles: ['member'],
        },
      },
    };

    expect(await admin(memberOnly)).toEqual({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
      payload: {},
      status: 422,
    });
    expect(
      await admin({
        session: {
          activeOrganizationId: null,
          id: 'session-1',
          user: {
            email: 'ada@example.com',
            id: 'user-1',
            roles: ['admin'],
          },
        },
      }),
    ).toBe(true);

    // @ts-expect-error Better Auth admin-plugin role changes make stale guards red.
    const staleGuard = role<AppRequest>('billing');
    expect(staleGuard).toBeTypeOf('function');
  });

  it('guards organization-scoped surfaces with activeOrganizationId', async () => {
    const scoped = activeOrganization<AppRequest>();
    const typedGuard: Guard<AppRequest, ActiveOrganizationRequest<AppRequest>> = scoped;

    expect(
      await typedGuard({
        session: {
          activeOrganizationId: null,
          id: 'session-1',
          user: {
            email: 'ada@example.com',
            id: 'user-1',
            roles: ['member'],
          },
        },
      }),
    ).toEqual({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
      payload: {},
      status: 422,
    });
    expect(
      await typedGuard({
        session: {
          activeOrganizationId: 'org-1',
          id: 'session-1',
          user: {
            email: 'ada@example.com',
            id: 'user-1',
            roles: ['member'],
          },
        },
      }),
    ).toBe(true);
  });
});
