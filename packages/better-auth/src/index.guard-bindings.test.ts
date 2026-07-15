import { type Guard, guards as serverGuards } from '@kovojs/server';
import { describe, expect, it } from 'vitest';
import { type ActiveOrganizationRequest, activeOrganization, authed, role } from './internal.js';
import { type AppRequest } from './test-fakes.js';

describe('guard bindings', () => {
  it('rejects late server-guard replacement and keeps adapter guards unchanged', async () => {
    const mutableGuards = serverGuards as unknown as {
      authed: typeof serverGuards.authed;
      role: typeof serverGuards.role;
    };
    const originalAuthed = mutableGuards.authed;
    const originalRole = mutableGuards.role;
    expect(Object.isFrozen(serverGuards)).toBe(true);
    expect(() => {
      mutableGuards.authed = (() => async () => true) as typeof serverGuards.authed;
    }).toThrow(TypeError);
    expect(() => {
      mutableGuards.role = (() => async () => true) as typeof serverGuards.role;
    }).toThrow(TypeError);
    expect(serverGuards.authed).toBe(originalAuthed);
    expect(serverGuards.role).toBe(originalRole);

    const authedGuard = authed<AppRequest>();
    const roleGuard = role<AppRequest>('admin');
    expect(await authedGuard({ session: null })).toMatchObject({
      kind: 'unauthenticated',
    });
    expect(await roleGuard({ session: null })).toMatchObject({
      kind: 'unauthenticated',
    });
  });

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

    // SPEC.md §6.5 and §10.3: @kovojs/server does not export guard-failure constants, so this
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
      kind: 'unauthenticated',
      payload: {},
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
      kind: 'forbidden',
      payload: {},
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
      kind: 'forbidden',
      payload: {},
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

  it('does not grant organization authority through inherited or accessor session fields', async () => {
    // SPEC §6.5/§10.3: the active organization is authorization evidence. Only exact own
    // session/user/organization data may grant; prototype and accessor carriers fail closed.
    const scoped = activeOrganization<AppRequest & { session?: AppRequest['session'] | null }>();
    let accessorReads = 0;
    const inheritedSession = Object.create({
      session: {
        activeOrganizationId: 'attacker-org',
        user: { id: 'attacker', roles: ['admin'] },
      },
    }) as AppRequest;
    const inheritedOrganization = {
      session: Object.create(
        { activeOrganizationId: 'attacker-org' },
        {
          user: { configurable: true, enumerable: true, value: { id: 'user-1' } },
        },
      ),
    } as AppRequest;
    const accessorOrganization = {
      session: Object.defineProperties(
        {},
        {
          activeOrganizationId: {
            configurable: true,
            get() {
              accessorReads += 1;
              return 'attacker-org';
            },
          },
          user: { configurable: true, enumerable: true, value: { id: 'user-1' } },
        },
      ),
    } as AppRequest;

    expect(await scoped(inheritedSession)).toMatchObject({ kind: 'unauthenticated' });
    expect(await scoped(inheritedOrganization)).toMatchObject({ kind: 'forbidden' });
    expect(await scoped(accessorOrganization)).toMatchObject({ kind: 'forbidden' });
    expect(accessorReads).toBe(0);
  });

  it('pins the exact session carrier that grants active-organization authority', async () => {
    const scoped = activeOrganization<AppRequest>();
    const trustedSession: NonNullable<AppRequest['session']> = {
      activeOrganizationId: 'org-1',
      id: 'session-1',
      user: { email: 'ada@example.com', id: 'user-1', roles: ['member'] },
    };
    const attackerSession: NonNullable<AppRequest['session']> = {
      activeOrganizationId: 'attacker-org',
      id: 'attacker-session',
      user: { email: 'mallory@example.com', id: 'attacker', roles: ['admin'] },
    };
    const target = { session: trustedSession };
    const request = new Proxy(target, {
      get(current, property, receiver) {
        if (property !== 'session') return Reflect.get(current, property, receiver);
        const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
        return descriptor?.configurable === false && descriptor.writable === false
          ? descriptor.value
          : attackerSession;
      },
    }) as AppRequest;

    expect(await scoped(request)).toBe(true);
    expect(request.session?.activeOrganizationId).toBe('org-1');
    expect(request.session?.user.id).toBe('user-1');
  });

  it('deeply pins organization evidence before narrowing the request', async () => {
    const scoped = activeOrganization<AppRequest>();
    const sessionTarget: NonNullable<AppRequest['session']> = {
      activeOrganizationId: 'org-1',
      id: 'session-1',
      user: { email: 'ada@example.com', id: 'user-1', roles: ['member'] },
    };
    const session = new Proxy(sessionTarget, {
      get(current, property, receiver) {
        if (property !== 'activeOrganizationId') return Reflect.get(current, property, receiver);
        const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
        return descriptor?.configurable === false && descriptor.writable === false
          ? descriptor.value
          : 'attacker-org';
      },
    });
    const request = { session };

    expect(await scoped(request)).toBe(true);
    expect(request.session.activeOrganizationId).toBe('org-1');
    expect(Object.isFrozen(request.session)).toBe(true);
    expect(Object.isFrozen(request.session.user)).toBe(true);
  });
});
