import { describe, expect, it } from 'vitest';

import { createMemoryOpaqueSessionStore, createOpaqueSessionManager } from './opaque-session.js';

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
    let now = 1_000;
    const manager = createOpaqueSessionManager({
      store: createMemoryOpaqueSessionStore<{ user: { id: string } }>({
        now: () => now,
        ttlMs: 100,
      }),
    });
    const established = await manager.establish({ user: { id: 'u1' } });

    now = 1_100;

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
});
