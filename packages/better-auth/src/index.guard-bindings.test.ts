import { type Guard, guards as serverGuards } from '@jiso/server';
import { describe, expect, it } from 'vitest';
import { type ActiveOrganizationRequest, activeOrganization, authed, role } from './index.js';
import { type AppRequest } from './test-fakes.js';

describe('guard bindings', () => {
  it('keeps adapter guard failures aligned with the server guard contract', async () => {
    type ServerSessionRequest = {
      session?: {
        user?: {
          roles?: readonly string[];
        } | null;
      } | null;
    };

    const anonymous = { session: null } satisfies AppRequest;
    const memberOnly = {
      session: {
        activeOrganizationId: null,
        id: 'session-1',
        user: {
          email: 'ada@example.com',
          id: 'user-1',
          roles: ['member'],
        },
      },
    } satisfies AppRequest;

    // SPEC.md §6.5 and §10.3: @jiso/server does not export guard-failure constants, so this
    // package pins the adapter literals against the canonical server guards instead.
    expect(await role<AppRequest>('admin')(anonymous)).toEqual(
      await serverGuards.role<ServerSessionRequest>('admin')(anonymous),
    );
    expect(await role<AppRequest>('admin')(memberOnly)).toEqual(
      await serverGuards.role<ServerSessionRequest>('admin')(memberOnly),
    );
    expect(await activeOrganization<AppRequest>()(memberOnly)).toEqual(
      await serverGuards.role<ServerSessionRequest>('admin')(memberOnly),
    );
  });

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
