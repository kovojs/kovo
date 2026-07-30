import { describe, expect, it } from 'vitest';

import {
  createReferenceAuth,
  referenceAuthRequest,
  referenceSession,
  renderReferenceLoginForm,
  renderReferenceLogoutForm,
  type ReferenceAuthBindings,
} from './app.js';

describe('reference auth adoption', () => {
  it('ships no-JS login and logout forms backed by app-scoped credential mutations', () => {
    const request = referenceAuthRequest();
    const login = String(renderReferenceLoginForm(request, { next: '/admin' }));
    const logout = String(renderReferenceLogoutForm());

    expect(login).toContain('data-mutation="auth/sign-in"');
    expect(login).toContain('name="Kovo-Idem"');
    expect(login).toContain('name="next" value="/admin"');
    expect(logout).toContain('data-mutation="auth/sign-out"');
  });

  it('maps fixture cookies into the declared reference session', async () => {
    const auth = createReferenceAuth();
    const token = seedReferenceSession(auth, 'u1');
    const session = sessionValue(
      await auth.sessionProvider(
        referenceAuthRequest(`kovo_reference_session=${token}`, undefined, auth.db),
      ),
    );

    expect(session).toEqual({
      id: 'session-u1',
      user: {
        email: 'ada@example.com',
        id: 'u1',
        name: 'Ada Lovelace',
        roles: ['admin', 'member'],
      },
    });
    expect(session?.id).not.toBe(token);
  });

  it('uses only the exact __Host session cookie on HTTPS', async () => {
    const auth = createReferenceAuth();
    const token = seedReferenceSession(auth, 'u1');
    const httpsUrl = 'https://localhost/account';

    await expect(
      auth.sessionProvider(
        referenceAuthRequest(`kovo_reference_session=${token}`, httpsUrl, auth.db),
      ),
    ).resolves.toBeNull();
    const session = sessionValue(
      await auth.sessionProvider(
        referenceAuthRequest(`__Host-kovo_reference_session=${token}`, httpsUrl, auth.db),
      ),
    );
    expect(session).toMatchObject({
      id: 'session-u1',
      user: { id: 'u1' },
    });
  });

  it('rejects non-loopback and production fixture ingress', async () => {
    const auth = createReferenceAuth();
    const token = seedReferenceSession(auth, 'u1');

    for (const url of ['http://reference.test/account', 'https://reference.test/account']) {
      await expect(
        auth.sessionProvider(referenceAuthRequest(`kovo_reference_session=${token}`, url, auth.db)),
      ).rejects.toThrow('requires an exact loopback request URL');
    }

    const previousMode = process.env.NODE_ENV;
    const previousSecret = process.env.KOVO_REFERENCE_AUTH_CSRF_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.KOVO_REFERENCE_AUTH_CSRF_SECRET = 'configured-production-secret';
    try {
      await expect(
        auth.sessionProvider(
          referenceAuthRequest(`kovo_reference_session=${token}`, undefined, auth.db),
        ),
      ).rejects.toThrow('explicit local-only development capability');
    } finally {
      restoreEnv('NODE_ENV', previousMode);
      restoreEnv('KOVO_REFERENCE_AUTH_CSRF_SECRET', previousSecret);
    }
  });

  it('normalizes hostile next values before they reach native form serialization', () => {
    const request = referenceAuthRequest();
    for (const next of ['https://evil.test', '//evil.test', '/\\evil.test', '/account\nInjected']) {
      expect(String(renderReferenceLoginForm(request, { next }))).toContain(
        'name="next" value="/account"',
      );
    }
  });

  it('keeps the app session schema explicit and role-bearing', () => {
    expect(
      referenceSession.parse({
        session: {
          id: 'session-u2',
          user: {
            email: 'grace@example.com',
            id: 'u2',
            name: 'Grace Hopper',
            roles: ['member'],
          },
        },
      }),
    ).toEqual({
      id: 'session-u2',
      user: {
        email: 'grace@example.com',
        id: 'u2',
        name: 'Grace Hopper',
        roles: ['member'],
      },
    });
  });
});

function seedReferenceSession(auth: ReferenceAuthBindings, userId: 'u1' | 'u2'): string {
  const token = crypto.randomUUID();
  auth.fixture.sessions.set(token, {
    expiresAt: Date.now() + 60_000,
    sessionId: `session-${userId}`,
    userId,
  });
  return token;
}

function sessionValue<T>(value: T | { value: T } | null): T | null {
  return value && typeof value === 'object' && 'value' in value ? value.value : value;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
