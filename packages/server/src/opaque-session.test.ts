import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { renderAppRouteDocumentResponse } from './app-document.js';
import { guards, type RequestWithSession } from './guards.js';
import { renderedHtml } from './html.js';
import {
  createMemoryOpaqueSessionStore,
  createOpaqueSessionManager,
  type OpaqueSessionStore,
} from './opaque-session.js';
import { route } from './route.js';

describe('opaque session primitive (SPEC §6.5 / OPP-11)', () => {
  it('mints opaque ids that are not JWT-shaped or payload-readable', async () => {
    const manager = createOpaqueSessionManager({
      store: createMemoryOpaqueSessionStore<{ user: { id: string } }>(),
    });

    const established = await manager.establish({ user: { id: 'u1' } });

    expect(established.session.id).toMatch(/^kos_[A-Za-z0-9_-]+$/);
    expect(established.session.id.split('.')).toHaveLength(1);
    expect(established.session.id).not.toContain('u1');
    expect(() =>
      JSON.parse(Buffer.from(established.session.id, 'base64url').toString('utf8')),
    ).toThrow();
  });

  it('rotates on establish and invalidates the prior session immediately', async () => {
    const store = createMemoryOpaqueSessionStore<{ user: { id: string } | null }>();
    const manager = createOpaqueSessionManager({ store });
    const anonymous = await manager.establish({ user: null });

    const authenticated = await manager.establish(
      { user: { id: 'u1' } },
      { priorId: anonymous.session.id },
    );

    expect(authenticated.session.id).not.toBe(anonymous.session.id);
    await expect(manager.validate(anonymous.session.id)).resolves.toEqual({
      ok: false,
      reason: 'revoked',
    });
    await expect(manager.validate(authenticated.session.id)).resolves.toMatchObject({
      ok: true,
      session: { value: { user: { id: 'u1' } } },
    });
  });

  it('refuses to rotate from a missing, malformed, or expired prior session', async () => {
    let now = Date.now();
    const manager = createOpaqueSessionManager({
      store: createMemoryOpaqueSessionStore<{ user: { id: string } }>({
        now: () => now,
        ttlMs: 100,
      }),
    });
    const established = await manager.establish({ user: { id: 'u1' } });

    await expect(
      manager.establish({ user: { id: 'u2' } }, { priorId: 'not-an-opaque-session-id' }),
    ).rejects.toThrow(
      'Opaque session rotation requires a live prior session; validation rejected it as malformed',
    );
    await expect(manager.establish({ user: { id: 'u2' } }, { priorId: '' })).rejects.toThrow(
      'Opaque session rotation requires a live prior session; validation rejected it as missing',
    );

    now += 100;

    await expect(
      manager.establish({ user: { id: 'u2' } }, { priorId: established.session.id }),
    ).rejects.toThrow(
      'Opaque session rotation requires a live prior session; validation rejected it as expired',
    );
  });

  it('refuses to set a rotated browser cookie when a custom store leaves the prior id live', async () => {
    const baseStore = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const manager = createOpaqueSessionManager({
      store: {
        ...baseStore,
        rotate: (_priorId, value, options) => baseStore.create(value, options),
      },
    });
    const established = await manager.establish({ user: { id: 'u1' } });

    await expect(
      manager.establish({ user: { id: 'u2' } }, { priorId: established.session.id }),
    ).rejects.toThrow(
      'Opaque session store did not immediately revoke the prior id during rotation; refusing to set a browser session cookie',
    );
  });

  it('refuses to set a rotated browser cookie when a custom store reuses the prior id', async () => {
    const baseStore = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const manager = createOpaqueSessionManager({
      store: {
        ...baseStore,
        rotate: async (priorId, value) => {
          const prior = await baseStore.validate(priorId);
          if (!prior.ok) throw new Error('test setup expected a live prior session');
          return {
            ...prior.session,
            value,
          };
        },
      },
    });
    const established = await manager.establish({ user: { id: 'u1' } });

    await expect(
      manager.establish({ user: { id: 'u2' } }, { priorId: established.session.id }),
    ).rejects.toThrow(
      'Opaque session store returned the prior id during rotation; refusing to set a browser session cookie',
    );
  });

  it('validates revoked sessions as anonymous immediately', async () => {
    const manager = createOpaqueSessionManager({
      store: createMemoryOpaqueSessionStore<{ user: { id: string } }>(),
    });
    const established = await manager.establish({ user: { id: 'u1' } });
    const cookie = established.setCookie.split(';')[0]!;

    await manager.revoke(established.session.id);

    await expect(
      manager.provider(new Request('https://app.test/account', { headers: { cookie } })),
    ).resolves.toBeNull();
    await expect(manager.validate(established.session.id)).resolves.toEqual({
      ok: false,
      reason: 'revoked',
    });
  });

  it('distinguishes expired stored sessions from unknown ids on first validation', async () => {
    let now = Date.now();
    const manager = createOpaqueSessionManager({
      store: createMemoryOpaqueSessionStore<{ user: { id: string } }>({
        now: () => now,
        ttlMs: 100,
      }),
    });
    const established = await manager.establish({ user: { id: 'u1' } });

    now += 100;

    await expect(manager.validate(established.session.id)).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('does not accept cookie/header material as a delegated payload without store validation', async () => {
    const manager = createOpaqueSessionManager({
      acceptAuthorizationHeader: true,
      store: createMemoryOpaqueSessionStore<{ user: { id: string } }>(),
    });
    const delegatedJwt = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ user: { id: 'attacker' } })).toString('base64url'),
      '',
    ].join('.');

    await expect(
      manager.provider(
        new Request('https://app.test/account', {
          headers: { cookie: `kovo_session=${delegatedJwt}` },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      manager.provider(
        new Request('https://app.test/account', {
          headers: { authorization: `Bearer ${delegatedJwt}` },
        }),
      ),
    ).resolves.toBeNull();

    const established = await manager.establish({ user: { id: 'u1' } });

    await expect(
      manager.provider(
        new Request('https://app.test/account', {
          headers: { authorization: `Bearer ${established.session.id}` },
        }),
      ),
    ).resolves.toEqual({ user: { id: 'u1' } });
  });

  it('fails closed instead of choosing among ambiguous owned-session credentials', async () => {
    const manager = createOpaqueSessionManager({
      acceptAuthorizationHeader: true,
      store: createMemoryOpaqueSessionStore<{ user: { id: string } }>(),
    });
    const first = await manager.establish({ user: { id: 'u1' } });
    const second = await manager.establish({ user: { id: 'u2' } });

    await expect(
      manager.validateRequest(
        new Request('https://app.test/account', {
          headers: {
            cookie: `kovo_session=${first.session.id}; __Host-kovo_session=${second.session.id}`,
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: 'malformed' });
    await expect(
      manager.provider(
        new Request('https://app.test/account', {
          headers: {
            cookie: `kovo_session=${first.session.id}; __Host-kovo_session=${second.session.id}`,
          },
        }),
      ),
    ).resolves.toBeNull();

    await expect(
      manager.provider(
        new Request('https://app.test/account', {
          headers: {
            authorization: `Bearer ${second.session.id}`,
            cookie: `kovo_session=${first.session.id}`,
          },
        }),
      ),
    ).resolves.toBeNull();
  });

  it('rejects malformed or prefix-ambiguous owned-session configuration at manager creation', () => {
    const store = createMemoryOpaqueSessionStore<{ user: { id: string } }>();

    expect(() => createOpaqueSessionManager({ store, cookieName: 'kovo session' })).toThrow(
      'Opaque session cookieName must be an HTTP token',
    );
    expect(() => createOpaqueSessionManager({ store, cookieName: '__Host-kovo_session' })).toThrow(
      'Opaque session cookieName must be the unprefixed base name',
    );
    expect(() =>
      createOpaqueSessionManager({
        store: {
          create: store.create,
          validate: store.validate,
          rotate: store.rotate,
        } as unknown as OpaqueSessionStore<{ user: { id: string } }>,
      }),
    ).toThrow('createOpaqueSessionManager requires an opaque session store');
  });

  it('accepts Kovo-managed secure cookie aliases for a valid custom base name', async () => {
    const manager = createOpaqueSessionManager({
      cookieName: 'app_session',
      cookie: { productionSecure: true },
      store: createMemoryOpaqueSessionStore<{ user: { id: string } }>(),
    });
    const established = await manager.establish({ user: { id: 'u1' } });

    expect(established.setCookie).toMatch(/^__Host-app_session=/);
    await expect(
      manager.provider(
        new Request('https://app.test/account', {
          headers: { cookie: established.setCookie.split(';')[0]! },
        }),
      ),
    ).resolves.toEqual({ user: { id: 'u1' } });
  });

  it('fails closed when a custom store validates a different opaque id than the one presented', async () => {
    const baseStore = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const manager = createOpaqueSessionManager({
      store: {
        ...baseStore,
        validate: async () => ({
          ok: true,
          session: await baseStore.create({ user: { id: 'u2' } }),
        }),
      },
    });
    const established = await manager.establish({ user: { id: 'u1' } });
    const cookie = established.setCookie.split(';')[0]!;

    await expect(manager.validate(established.session.id)).resolves.toEqual({
      ok: false,
      reason: 'malformed',
    });
    await expect(
      manager.provider(new Request('https://app.test/account', { headers: { cookie } })),
    ).resolves.toBeNull();
  });

  it('fails closed when a custom store returns an incoherent validated lifecycle', async () => {
    const baseStore = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const manager = createOpaqueSessionManager({
      store: {
        ...baseStore,
        async validate(id: string) {
          const result = await baseStore.validate(id);
          if (!result.ok) return result;
          return {
            ok: true,
            session: { ...result.session, expiresAt: result.session.createdAt },
          };
        },
      },
    });
    const established = await manager.establish({ user: { id: 'u1' } });

    await expect(manager.validate(established.session.id)).resolves.toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it.each([
    ['NaN createdAt', { createdAt: Number.NaN }],
    ['Infinity createdAt', { createdAt: Number.POSITIVE_INFINITY }],
    ['fractional createdAt', { createdAt: 1.5 }],
    ['NaN expiresAt', { expiresAt: Number.NaN }],
    ['Infinity expiresAt', { expiresAt: Number.POSITIVE_INFINITY }],
    ['fractional expiresAt', { expiresAt: 2.5 }],
  ])('fails closed when a custom store validates %s', async (_label, timestampPatch) => {
    const baseStore = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const manager = createOpaqueSessionManager({
      store: {
        ...baseStore,
        async validate(id: string) {
          const result = await baseStore.validate(id);
          if (!result.ok) return result;
          return {
            ok: true,
            session: { ...result.session, ...timestampPatch },
          };
        },
      },
    });
    const established = await manager.establish({ user: { id: 'u1' } });
    const cookie = established.setCookie.split(';')[0]!;

    await expect(manager.validate(established.session.id)).resolves.toEqual({
      ok: false,
      reason: 'malformed',
    });
    await expect(
      manager.provider(new Request('https://app.test/account', { headers: { cookie } })),
    ).resolves.toBeNull();
  });

  it('accepts valid integer lifecycle timestamps from a custom store', async () => {
    const baseStore = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const manager = createOpaqueSessionManager({
      store: {
        ...baseStore,
        async validate(id: string) {
          const result = await baseStore.validate(id);
          if (!result.ok) return result;
          return {
            ok: true,
            session: {
              ...result.session,
              createdAt: Math.trunc(result.session.createdAt),
              expiresAt: Math.trunc(result.session.expiresAt),
            },
          };
        },
      },
    });
    const established = await manager.establish({ user: { id: 'u1' } });

    await expect(manager.validate(established.session.id)).resolves.toMatchObject({
      ok: true,
      session: { value: { user: { id: 'u1' } } },
    });
  });

  it('fails closed when a custom store returns a malformed validation result', async () => {
    const baseStore = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const manager = createOpaqueSessionManager({
      store: {
        ...baseStore,
        validate: async () => undefined as never,
      },
    });
    const established = await manager.establish({ user: { id: 'u1' } });
    const cookie = established.setCookie.split(';')[0]!;

    await expect(manager.validate(established.session.id)).resolves.toEqual({
      ok: false,
      reason: 'malformed',
    });
    await expect(
      manager.provider(new Request('https://app.test/account', { headers: { cookie } })),
    ).resolves.toBeNull();
  });

  it('fails closed when a custom store throws during request validation', async () => {
    const baseStore = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const manager = createOpaqueSessionManager({
      store: {
        ...baseStore,
        validate: async () => {
          throw new Error('store unavailable');
        },
      },
    });
    const established = await manager.establish({ user: { id: 'u1' } });
    const cookie = established.setCookie.split(';')[0]!;

    await expect(manager.validate(established.session.id)).resolves.toEqual({
      ok: false,
      reason: 'malformed',
    });
    await expect(
      manager.provider(new Request('https://app.test/account', { headers: { cookie } })),
    ).resolves.toBeNull();
  });

  it('fails closed when a custom store returns an unknown validation rejection reason', async () => {
    const baseStore = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const manager = createOpaqueSessionManager({
      store: {
        ...baseStore,
        validate: async () => ({ ok: false, reason: 'active' }) as never,
      },
    });
    const established = await manager.establish({ user: { id: 'u1' } });

    await expect(manager.validate(established.session.id)).resolves.toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('snapshots custom-store records so post-validation mutation cannot change the request session', async () => {
    type Session = { user: { id: string } };
    const baseStore = createMemoryOpaqueSessionStore<Session>();
    let validatedRecord:
      | { id: string; createdAt: number; expiresAt: number; value: Session }
      | undefined;
    const manager = createOpaqueSessionManager({
      store: {
        ...baseStore,
        async validate(id: string) {
          const result = await baseStore.validate(id);
          if (!result.ok) return result;
          validatedRecord = {
            ...result.session,
            value: structuredClone(result.session.value),
          };
          return { ok: true, session: validatedRecord };
        },
      },
    });
    const established = await manager.establish({ user: { id: 'u1' } });
    const cookie = established.setCookie.split(';')[0]!;

    const validation = await manager.validate(established.session.id);

    if (!validation.ok || validatedRecord === undefined) {
      throw new Error('test setup expected a live validated session');
    }
    validatedRecord.value.user.id = 'attacker';
    expect(validation.session.value.user.id).toBe('u1');

    const requestSession = await manager.provider(
      new Request('https://app.test/account', { headers: { cookie } }),
    );

    if (requestSession === null || validatedRecord === undefined) {
      throw new Error('test setup expected a live request session');
    }
    validatedRecord.value.user.id = 'mutated-again';
    expect(requestSession.user.id).toBe('u1');
  });

  it('refuses to set a browser cookie when a custom store creates a malformed session record', async () => {
    const baseStore = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const malformedStore: OpaqueSessionStore<{ user: { id: string } }> = {
      ...baseStore,
      create: async () => ({
        id: 'header.payload.signature',
        createdAt: 1,
        expiresAt: 2,
        value: { user: { id: 'u1' } },
      }),
    };
    const manager = createOpaqueSessionManager({ store: malformedStore });

    await expect(manager.establish({ user: { id: 'u1' } })).rejects.toThrow(
      'Opaque session store returned a malformed session record; refusing to set a browser session cookie',
    );
  });

  it.each([
    ['NaN createdAt', { createdAt: Number.NaN }],
    ['Infinity createdAt', { createdAt: Number.POSITIVE_INFINITY }],
    ['fractional createdAt', { createdAt: 1.5 }],
    ['NaN expiresAt', { expiresAt: Number.NaN }],
    ['Infinity expiresAt', { expiresAt: Number.POSITIVE_INFINITY }],
    ['fractional expiresAt', { expiresAt: 2.5 }],
  ])(
    'refuses to set a browser cookie when a custom store creates %s',
    async (_label, timestampPatch) => {
      const baseStore = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
      const validSession = baseStore.create({ user: { id: 'u1' } });
      const malformedStore: OpaqueSessionStore<{ user: { id: string } }> = {
        ...baseStore,
        create: async () => ({
          ...validSession,
          ...timestampPatch,
        }),
      };
      const manager = createOpaqueSessionManager({ store: malformedStore });

      await expect(manager.establish({ user: { id: 'u1' } })).rejects.toThrow(
        'Opaque session store returned a malformed session record; refusing to set a browser session cookie',
      );
    },
  );

  it('rejects incoherent Kovo memory-store clock timestamps before creating a session record', () => {
    const store = createMemoryOpaqueSessionStore<{ user: { id: string } }>({
      now: () => Number.NaN,
    });

    expect(() => store.create({ user: { id: 'u1' } })).toThrow(
      'Opaque session clock must return a non-negative safe integer epoch millisecond',
    );
    expect(store.size()).toBe(0);
  });

  it('does not serialize a browser cookie beyond the store-backed absolute expiry', async () => {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const store = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const manager = createOpaqueSessionManager({
      cookie: { expires: new Date(now + 60_000) },
      store: {
        ...store,
        create: async (_value) => ({
          id: (await store.create({ user: { id: 'u1' } })).id,
          createdAt: now - 60 * 60 * 1000,
          expiresAt: now + 5_000,
          value: { user: { id: 'u1' } },
        }),
      },
    });

    const established = await manager.establish({ user: { id: 'u1' } });
    const maxAge = Number(/(?:^|; )Max-Age=(\d+)(?:;|$)/.exec(established.setCookie)?.[1]);
    const expires = /(?:^|; )Expires=([^;]+)(?:;|$)/.exec(established.setCookie)?.[1];

    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(5);
    expect(Date.parse(expires ?? '')).toBe(established.session.expiresAt);
  });

  it('refuses to set a browser cookie for an already-expired custom-store record', async () => {
    const store = createMemoryOpaqueSessionStore<{ user: { id: string } }>();
    const manager = createOpaqueSessionManager({
      store: {
        ...store,
        create: async (_value) => ({
          id: (await store.create({ user: { id: 'u1' } })).id,
          createdAt: 1,
          expiresAt: 2,
          value: { user: { id: 'u1' } },
        }),
      },
    });

    await expect(manager.establish({ user: { id: 'u1' } })).rejects.toThrow(
      'Opaque session store returned an expired session record; refusing to set a browser session cookie',
    );
  });

  it('binds Kovo-owned opaque sessions to one validated request lifecycle', async () => {
    type Session = { user: { id: string } | null };
    type SessionRequest = RequestWithSession<Request, Session>;
    const baseStore = createMemoryOpaqueSessionStore<Session>();
    let validateCalls = 0;
    const store = {
      ...baseStore,
      validate(id: string) {
        validateCalls += 1;
        return baseStore.validate(id);
      },
    };
    const manager = createOpaqueSessionManager({ store });
    const anonymous = await manager.establish({ user: null });
    const authenticated = await manager.establish(
      { user: { id: 'u1' } },
      { priorId: anonymous.session.id },
    );
    validateCalls = 0;
    const anonymousCookie = anonymous.setCookie.split(';')[0]!;
    const authenticatedCookie = authenticated.setCookie.split(';')[0]!;
    const guardSessions: string[] = [];
    const pageSessions: string[] = [];
    const authed = guards.authed<SessionRequest>();
    const account = route('/account', {
      async guard(request: SessionRequest) {
        guardSessions.push(request.session?.user?.id ?? 'anonymous');
        return authed(request);
      },
      page(_context, request: SessionRequest) {
        pageSessions.push(request.session?.user?.id ?? 'anonymous');
        return renderedHtml(`account:${request.session?.user?.id ?? 'anonymous'}`);
      },
    });
    const app = createApp({
      routes: [account],
      session: manager,
    });
    const renderAccount = (cookie: string) =>
      renderAppRouteDocumentResponse({
        app,
        params: {},
        request: new Request('https://app.test/account', { headers: { cookie } }),
        route: account,
        url: new URL('https://app.test/account'),
      });

    const authenticatedResponse = await renderAccount(authenticatedCookie);

    expect(authenticatedResponse.status).toBe(200);
    expect(authenticatedResponse.body).toContain('account:u1');
    expect(validateCalls).toBe(1);
    expect(guardSessions).toEqual(['u1']);
    expect(pageSessions).toEqual(['u1']);

    const rotatedPriorResponse = await renderAccount(anonymousCookie);

    expect(rotatedPriorResponse.status).toBe(303);
    expect(rotatedPriorResponse.headers.Location).toBe('/login?next=%2Faccount');
    expect(validateCalls).toBe(2);
    expect(guardSessions).toEqual(['u1', 'anonymous']);
    expect(pageSessions).toEqual(['u1']);

    await manager.revoke(authenticated.session.id);
    const revokedResponse = await renderAccount(authenticatedCookie);

    expect(revokedResponse.status).toBe(303);
    expect(revokedResponse.headers.Location).toBe('/login?next=%2Faccount');
    expect(validateCalls).toBe(3);
    expect(guardSessions).toEqual(['u1', 'anonymous', 'anonymous']);
    expect(pageSessions).toEqual(['u1']);
  });
});
