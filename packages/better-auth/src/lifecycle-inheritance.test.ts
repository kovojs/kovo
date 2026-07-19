import { readFileSync } from 'node:fs';

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it } from 'vitest';

import { betterAuthCredentialMutationApis } from './internal/contracts.js';

interface StoredSession {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  token: string;
  updatedAt: Date;
  userId: string;
}

function inheritedAuth() {
  const database = {
    account: [] as Record<string, unknown>[],
    session: [] as StoredSession[],
    user: [] as Record<string, unknown>[],
    verification: [] as Record<string, unknown>[],
  };
  const auth = betterAuth({
    advanced: {
      disableCSRFCheck: true,
      disableOriginCheck: true,
      ipAddress: { ipAddressHeaders: ['x-kovo-client-ip'] },
    },
    baseURL: 'http://localhost:5173',
    database: memoryAdapter(database),
    emailAndPassword: { autoSignIn: false, enabled: true },
    rateLimit: { enabled: false },
    secret: 'kovo-lifecycle-inheritance-test-secret-0123456789abcdef',
    telemetry: { enabled: false },
    trustedOrigins: [],
  });
  return { auth, database };
}

async function postAuth(
  auth: ReturnType<typeof betterAuth>,
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: 'http://localhost:5173',
    'x-kovo-client-ip': '127.0.0.1',
  };
  if (cookie !== undefined) headers.cookie = cookie;
  return await auth.handler(
    new Request(`http://localhost:5173/api/auth/${path}`, {
      body: JSON.stringify(body),
      headers,
      method: 'POST',
    }),
  );
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers
    .getSetCookie()
    .find((value) => value.includes('session_token='));
  if (setCookie === undefined) throw new Error('expected Better Auth session Set-Cookie');
  const pair = setCookie.split(';', 1)[0];
  if (pair === undefined) throw new Error('expected Better Auth session cookie pair');
  return pair;
}

describe('Better Auth 1.6.17 lifecycle inheritance (Plan 3 §5.3 C13 anchor)', () => {
  it('characterizes every session default Kovo inherits by omitting session options', async () => {
    const { auth } = inheritedAuth();
    const context = await auth.$context;

    expect(Object.hasOwn(context.options, 'session')).toBe(false);
    expect(context.sessionConfig).toEqual({
      cookieRefreshCache: false,
      expiresIn: 604_800,
      freshAge: 86_400,
      updateAge: 86_400,
    });
    expect(context.authCookies.sessionData.attributes.maxAge).toBe(300);
  });

  it('rotates both session id and token on sign-in with a pre-existing cookie without revoking the old session', async () => {
    const { auth, database } = inheritedAuth();
    const email = 'lifecycle@example.test';
    const password = 'Lifecycle-password-123!';

    const signUp = await postAuth(auth, 'sign-up/email', {
      email,
      name: 'Lifecycle User',
      password,
    });
    expect(signUp.status).toBe(200);
    expect(database.session).toEqual([]);

    const firstSignIn = await postAuth(auth, 'sign-in/email', { email, password });
    expect(firstSignIn.status).toBe(200);
    const firstCookie = sessionCookie(firstSignIn);
    expect(database.session).toHaveLength(1);
    const firstSession = { ...database.session[0]! };
    const lifetimeMs = firstSession.expiresAt.getTime() - firstSession.createdAt.getTime();
    expect(lifetimeMs).toBeGreaterThanOrEqual(604_799_000);
    expect(lifetimeMs).toBeLessThanOrEqual(604_800_000);

    const secondSignIn = await postAuth(auth, 'sign-in/email', { email, password }, firstCookie);
    expect(secondSignIn.status).toBe(200);
    const secondCookie = sessionCookie(secondSignIn);
    expect(secondCookie).not.toBe(firstCookie);
    expect(database.session).toHaveLength(2);

    const secondSession = database.session.find((row) => row.id !== firstSession.id);
    expect(secondSession).toBeDefined();
    expect(secondSession?.id).not.toBe(firstSession.id);
    expect(secondSession?.token).not.toBe(firstSession.token);
    expect(database.session).toContainEqual(expect.objectContaining({ id: firstSession.id }));

    const oldSessionResponse = await auth.handler(
      new Request('http://localhost:5173/api/auth/get-session', {
        headers: { cookie: firstCookie },
      }),
    );
    expect(oldSessionResponse.status).toBe(200);
    await expect(oldSessionResponse.json()).resolves.toMatchObject({
      session: { id: firstSession.id },
    });
  });

  it('binds the explain boundary to the three direct Kovo transitions and the GET-only delegated partition', () => {
    const boundary = JSON.parse(
      readFileSync(new URL('../../cli/src/auth-lifecycle-boundary.json', import.meta.url), 'utf8'),
    ) as {
      delegatedReachable: readonly { id: string; status: string }[];
      inheritedSession: Record<string, unknown>;
      kovoOwnedTransitions: readonly {
        devOnly: boolean;
        id: string;
        upstreamApi: string;
      }[];
      structurallyUnreachable: readonly { id: string }[];
    };

    expect(betterAuthCredentialMutationApis).toEqual(['signInEmail', 'signOut', 'signUpEmail']);
    expect(boundary.kovoOwnedTransitions).toEqual([
      expect.objectContaining({ devOnly: false, id: 'signIn', upstreamApi: 'signInEmail' }),
      expect.objectContaining({ devOnly: false, id: 'signOut', upstreamApi: 'signOut' }),
      expect.objectContaining({ devOnly: true, id: 'seedSignUp', upstreamApi: 'signUpEmail' }),
    ]);
    expect(boundary.inheritedSession).toEqual({
      cookieCacheEnabled: false,
      cookieCacheMaxAge: 300,
      expiresIn: 604_800,
      freshAge: 86_400,
      preexistingCookieSignIn: 'rotates-id-and-token-retains-prior-session',
      updateAge: 86_400,
    });
    expect(boundary.structurallyUnreachable).toEqual([
      expect.objectContaining({ id: 'unsafe-method-provider-lifecycle' }),
    ]);
    expect(boundary.delegatedReachable).toEqual([
      expect.objectContaining({ id: 'get-provider-callback-lifecycle', status: 'unsupported' }),
    ]);

    const mountSource = readFileSync(new URL('./mount.ts', import.meta.url), 'utf8');
    const serverMountSource = readFileSync(
      new URL('../../server/src/internal/better-auth.ts', import.meta.url),
      'utf8',
    );
    expect(mountSource).toContain("EndpointDeclaration<Path, 'GET', 'prefix'>");
    expect(serverMountSource).toContain("method: 'GET'");
  });
});
