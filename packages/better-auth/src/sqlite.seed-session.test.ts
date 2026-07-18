import { csrfToken } from '@kovojs/server';
import { runEndpoint } from '@kovojs/server/internal/execution';
import { useSqliteSystemDb } from '@kovojs/server/internal/sqlite-capability';
import { createSqliteAppRuntime, type KovoSqliteAppRuntime } from '@kovojs/server/sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  integer,
  sqliteTable,
  text,
} from '../../server/node_modules/drizzle-orm/sqlite-core/index.js';
import { runMutation } from '../../server/src/mutation.js';
import { mount } from './mount.js';
import { betterAuthSqliteSecret, createBetterAuthSqliteBindings } from './sqlite.js';

vi.mock('./internal/runtime-lock.js', () => ({
  assertBetterAuthRuntimeRealmLocked: vi.fn(),
}));

const user = sqliteTable('user', {
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  id: text('id').primaryKey(),
  image: text('image'),
  name: text('name').notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});

const session = sqliteTable('session', {
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  id: text('id').primaryKey(),
  ipAddress: text('ipAddress'),
  token: text('token').notNull().unique(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

const account = sqliteTable('account', {
  accessToken: text('accessToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
  accountId: text('accountId').notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  id: text('id').primaryKey(),
  idToken: text('idToken'),
  password: text('password'),
  providerId: text('providerId').notNull(),
  refreshToken: text('refreshToken'),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

const verification = sqliteTable('verification', {
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  value: text('value').notNull(),
});

const rateLimit = sqliteTable('rateLimit', {
  count: integer('count').notNull(),
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  lastRequest: integer('last_request').notNull(),
});

const authSchema = { account, rateLimit, session, user, verification };
const authSecret = 'Kovo-Seed-Session-Secret-0a1B2c3D4e5F6g7H8i9J';
const demoPassword = 'Kovo-Demo-Password-123!';
const runtimes: KovoSqliteAppRuntime[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) runtime.close();
});

describe('Better Auth development seed session posture', () => {
  it('uses an exact __Host- cookie so a sibling-domain session cannot replace a later sign-in', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createSqliteAppRuntime({ tables: Object.values(authSchema) });
    runtimes.push(runtime);
    const systemDb = runtime.systemDb({
      operation: 'write',
      reason: 'Reproduce sibling-domain session cookie precedence',
      surface: 'packages/better-auth/src/sqlite.seed-session.test.ts',
    });
    const csrf = {
      field: 'csrf',
      secret: 'Kovo-Cookie-Toss-Csrf-0a1B2c3D4e5F6g7H8i9J',
      sessionId: () => 'cookie-toss-pre-auth-principal',
    };
    const createBindings = (email: string, name: string, password: string) =>
      createBetterAuthSqliteBindings({
        baseURL: 'https://app.example.test',
        csrf,
        developmentSeed: { email, name, password },
        mapSession: ({ session: authSession, user: authUser }) => ({
          id: authSession.id,
          user: { email: authUser.email, id: authUser.id, name: authUser.name },
        }),
        schema: authSchema,
        secret: betterAuthSqliteSecret(authSecret),
        signInAccess: { kind: 'public', reason: 'cookie-toss repro sign-in' },
        signOutAccess: { kind: 'public', reason: 'cookie-toss repro sign-out' },
        systemDb,
      });
    const victim = createBindings('victim@example.com', 'Victim', 'Victim-password-123!');
    const attacker = createBindings('attacker@example.com', 'Attacker', 'Attacker-password-123!');
    await victim.seedDemoUser();
    await attacker.seedDemoUser();

    const signInCookie = async (
      bindings: typeof victim,
      email: string,
      password: string,
    ): Promise<{ pair: string; setCookie: string }> => {
      const request = new Request('https://app.example.test/_m/auth/sign-in', {
        headers: { origin: 'https://app.example.test' },
        method: 'POST',
      });
      const token = csrfToken(request, csrf, { audience: 'auth/sign-in' });
      const result = await runMutation(bindings.signIn, { csrf: token, email, password }, request, {
        clientIp: () => '127.0.0.1',
      });
      expect(result).toMatchObject({ ok: true, value: { status: 'signed-in' } });
      const setCookies = result.ok ? result.responseHeaders?.['Set-Cookie'] : undefined;
      expect(setCookies).toEqual(
        expect.arrayContaining([expect.stringContaining('session_token=')]),
      );
      const setCookie = setCookies?.find((cookie) => cookie.includes('session_token='));
      if (setCookie === undefined) throw new Error('expected Better Auth session Set-Cookie');
      const pair = setCookie.split(';', 1)[0];
      if (pair === undefined) throw new Error('expected Better Auth session cookie pair');
      return { pair, setCookie };
    };

    const victimCookie = await signInCookie(victim, 'victim@example.com', 'Victim-password-123!');
    const attackerCookie = await signInCookie(
      attacker,
      'attacker@example.com',
      'Attacker-password-123!',
    );
    expect(victimCookie.pair.split('=', 1)[0]).toBe('__Host-better-auth.session_token');
    expect(victimCookie.setCookie).toContain('; Path=/');
    expect(victimCookie.setCookie).toContain('; HttpOnly');
    expect(victimCookie.setCookie).toContain('; Secure');
    expect(victimCookie.setCookie).not.toContain('; Domain=');
    expect(attackerCookie.pair.split('=', 1)[0]).toBe('__Host-better-auth.session_token');

    // A sibling can still plant a Domain cookie under a `__Secure-` name, including a valid signed
    // value from its own account. It cannot plant the exact `__Host-` name that this binding reads:
    // browsers reject `__Host-` cookies carrying Domain, so the sibling-settable name is irrelevant.
    const siblingCookie = attackerCookie.pair.replace(
      /^__Host-better-auth\.session_token=/u,
      '__Secure-better-auth.session_token=',
    );
    const resolved = await victim.sessionProvider(
      new Request('https://app.example.test/', {
        headers: { cookie: `${siblingCookie}; ${victimCookie.pair}` },
      }),
    );
    const value =
      resolved !== null && typeof resolved === 'object' && 'value' in resolved
        ? resolved.value
        : resolved;
    expect(value).toMatchObject({ user: { email: 'victim@example.com' } });
  });

  it('rejects canonical-origin skew before minting or reading a bare session cookie', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createSqliteAppRuntime({ tables: Object.values(authSchema) });
    runtimes.push(runtime);
    const systemDb = runtime.systemDb({
      operation: 'write',
      reason: 'Reproduce canonical-origin and request-scheme cookie skew',
      surface: 'packages/better-auth/src/sqlite.seed-session.test.ts',
    });
    const csrf = {
      field: 'csrf',
      secret: 'Kovo-Origin-Skew-Csrf-0a1B2c3D4e5F6g7H8i9J',
      sessionId: () => 'origin-skew-pre-auth-principal',
    };
    const createBindings = (email: string, name: string, password: string) =>
      createBetterAuthSqliteBindings({
        baseURL: 'http://localhost:5173',
        csrf,
        developmentSeed: { email, name, password },
        mapSession: ({ session: authSession, user: authUser }) => ({
          id: authSession.id,
          user: { email: authUser.email, id: authUser.id, name: authUser.name },
        }),
        schema: authSchema,
        secret: betterAuthSqliteSecret(authSecret),
        signInAccess: { kind: 'public', reason: 'origin-skew repro sign-in' },
        signOutAccess: { kind: 'public', reason: 'origin-skew repro sign-out' },
        systemDb,
      });
    const victim = createBindings('victim-skew@example.com', 'Victim', 'Victim-password-123!');
    const attacker = createBindings(
      'attacker-skew@example.com',
      'Attacker',
      'Attacker-password-123!',
    );
    await victim.seedDemoUser();
    await attacker.seedDemoUser();

    const mismatchedRequest = new Request('https://app.example.test/_m/auth/sign-in', {
      headers: { origin: 'https://app.example.test' },
      method: 'POST',
    });
    const mismatchedToken = csrfToken(mismatchedRequest, csrf, { audience: 'auth/sign-in' });
    await expect(
      runMutation(
        victim.signIn,
        {
          csrf: mismatchedToken,
          email: 'victim-skew@example.com',
          password: 'Victim-password-123!',
        },
        mismatchedRequest,
        { clientIp: () => '127.0.0.1' },
      ),
    ).rejects.toThrow(
      'Better Auth credential provider failed inside the trusted plaintext boundary',
    );
    expect(
      useSqliteSystemDb(systemDb, (db) => db.select({ id: session.id }).from(session).all()),
    ).toEqual([]);

    const signInCookie = async (
      bindings: typeof victim,
      email: string,
      password: string,
    ): Promise<{ pair: string; setCookie: string }> => {
      const request = new Request('http://localhost:5173/_m/auth/sign-in', {
        headers: { origin: 'http://localhost:5173' },
        method: 'POST',
      });
      const token = csrfToken(request, csrf, { audience: 'auth/sign-in' });
      const result = await runMutation(bindings.signIn, { csrf: token, email, password }, request, {
        clientIp: () => '127.0.0.1',
      });
      expect(result).toMatchObject({ ok: true, value: { status: 'signed-in' } });
      const setCookies = result.ok ? result.responseHeaders?.['Set-Cookie'] : undefined;
      const setCookie = setCookies?.find((cookie) => cookie.includes('session_token='));
      if (setCookie === undefined) throw new Error('expected Better Auth session Set-Cookie');
      const pair = setCookie.split(';', 1)[0];
      if (pair === undefined) throw new Error('expected Better Auth session cookie pair');
      return { pair, setCookie };
    };

    const victimCookie = await signInCookie(
      victim,
      'victim-skew@example.com',
      'Victim-password-123!',
    );
    const attackerCookie = await signInCookie(
      attacker,
      'attacker-skew@example.com',
      'Attacker-password-123!',
    );
    expect(victimCookie.pair).toMatch(/^better-auth\.session_token=/u);
    expect(victimCookie.setCookie).toContain('; Path=/');
    expect(victimCookie.setCookie).toContain('; HttpOnly');
    expect(victimCookie.setCookie).toContain('; SameSite=Lax');
    expect(victimCookie.setCookie).not.toContain('; Secure');
    expect(victimCookie.setCookie).not.toContain('; Domain=');

    // Better Auth selects the first duplicate cookie. Before the origin pin, an HTTPS adapter
    // upgraded this bare cookie to Secure without changing its name, so an older sibling Domain
    // cookie could occupy this first position and authenticate the sibling's account.
    const localDuplicate = await victim.sessionProvider(
      new Request('http://localhost:5173/', {
        headers: { cookie: `${attackerCookie.pair}; ${victimCookie.pair}` },
      }),
    );
    const localValue =
      localDuplicate !== null && typeof localDuplicate === 'object' && 'value' in localDuplicate
        ? localDuplicate.value
        : localDuplicate;
    expect(localValue).toMatchObject({ user: { email: 'attacker-skew@example.com' } });

    await expect(
      victim.sessionProvider(
        new Request('https://app.example.test/', {
          headers: { cookie: `${attackerCookie.pair}; ${victimCookie.pair}` },
        }),
      ),
    ).rejects.toThrow('Better Auth session provider failed inside the trusted plaintext boundary');
  });

  it('creates only the credential until the CSRF-protected sign-in mutation runs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createSqliteAppRuntime({ tables: Object.values(authSchema) });
    runtimes.push(runtime);
    const systemDb = runtime.systemDb({
      operation: 'write',
      reason: 'Prove Better Auth seed and sign-in session posture',
      surface: 'packages/better-auth/src/sqlite.seed-session.test.ts',
    });
    const csrf = {
      field: 'csrf',
      secret: 'Kovo-Seed-Csrf-Secret-0a1B2c3D4e5F6g7H8i9J',
      sessionId: () => 'pre-auth-session-binding',
    };
    const bindings = createBetterAuthSqliteBindings({
      baseURL: 'http://localhost:5173',
      csrf,
      developmentSeed: {
        email: 'demo@example.com',
        name: 'Demo User',
        password: demoPassword,
      },
      mapSession: ({ session: authSession, user: authUser }) => ({
        id: authSession.id,
        user: { email: authUser.email, id: authUser.id, name: authUser.name },
      }),
      schema: authSchema,
      secret: betterAuthSqliteSecret(authSecret),
      signInAccess: { kind: 'public', reason: 'test sign-in' },
      signOutAccess: { kind: 'public', reason: 'test sign-out' },
      systemDb,
    });

    await bindings.seedDemoUser();

    expect(
      useSqliteSystemDb(systemDb, (db) => ({
        accounts: db
          .select({ providerId: account.providerId, userId: account.userId })
          .from(account)
          .all(),
        sessions: db.select({ id: session.id }).from(session).all(),
        users: db.select({ email: user.email, id: user.id }).from(user).all(),
      })),
    ).toMatchObject({
      accounts: [{ providerId: 'credential' }],
      sessions: [],
      users: [{ email: 'demo@example.com' }],
    });

    const request = new Request('http://localhost:5173/_m/auth/sign-in', {
      headers: { origin: 'http://localhost:5173' },
      method: 'POST',
    });
    const token = csrfToken(request, csrf, { audience: 'auth/sign-in' });
    await expect(
      runMutation(
        bindings.signIn,
        { csrf: token, email: 'demo@example.com', password: demoPassword },
        request,
        { clientIp: () => '127.0.0.1' },
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: 'signed-in' } });
    expect(
      useSqliteSystemDb(systemDb, (db) =>
        db.select({ userId: session.userId }).from(session).all(),
      ),
    ).toHaveLength(1);
  });

  it('shares atomic credential rate-limit state across real SQLite Better Auth instances', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createSqliteAppRuntime({ tables: Object.values(authSchema) });
    runtimes.push(runtime);
    const systemDb = runtime.systemDb({
      operation: 'write',
      reason: 'Prove shared Better Auth credential rate-limit state',
      surface: 'packages/better-auth/src/sqlite.seed-session.test.ts',
    });
    const csrf = {
      field: 'csrf',
      secret: 'Kovo-Shared-Rate-Limit-Csrf-0a1B2c3D4e5F6g7H8i9J',
      sessionId: () => 'shared-rate-limit-principal',
    };
    const bindingOptions = {
      baseURL: 'http://localhost:5173',
      csrf,
      mapSession: ({ session: authSession, user: authUser }: any) => ({
        id: authSession.id,
        user: { email: authUser.email, id: authUser.id, name: authUser.name },
      }),
      schema: authSchema,
      secret: betterAuthSqliteSecret(authSecret),
      signInAccess: { kind: 'public' as const, reason: 'shared limiter sign-in' },
      signOutAccess: { kind: 'public' as const, reason: 'shared limiter sign-out' },
      systemDb,
    };
    const first = createBetterAuthSqliteBindings(bindingOptions);
    const second = createBetterAuthSqliteBindings(bindingOptions);
    const request = new Request('http://localhost:5173/_m/auth/sign-in', {
      headers: { origin: 'http://localhost:5173' },
      method: 'POST',
    });
    const token = csrfToken(request, csrf, { audience: 'auth/sign-in' });
    const definitions = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0 ? first.signIn : second.signIn,
    );
    const results = await Promise.all(
      definitions.map((definition) =>
        runMutation(
          definition,
          { csrf: token, email: 'missing@example.test', password: 'incorrect-password' },
          request,
          { clientIp: () => '127.0.0.20' },
        ),
      ),
    );

    expect(results.filter((result) => !result.ok && result.status === 422)).toHaveLength(3);
    expect(results.filter((result) => !result.ok && result.status === 429)).toHaveLength(17);
    expect(results.filter((result) => !result.ok && result.status === 429)).toEqual(
      expect.arrayContaining(
        Array.from({ length: 17 }, () =>
          expect.objectContaining({
            error: { code: 'RATE_LIMITED', payload: {} },
            retryAfter: 10,
          }),
        ),
      ),
    );
    const rows = useSqliteSystemDb(systemDb, (db) => db.select().from(rateLimit).all());
    expect(rows).toEqual([
      expect.objectContaining({
        count: 3,
        id: expect.stringMatching(/^[0-9a-f]{32}$/u),
        key: expect.stringMatching(/^kovo-ba-rl-v1:[0-9a-f]{4}$/u),
      }),
    ]);
    expect(rows[0]?.key).not.toContain('127.0.0.20');
    expect(rows[0]?.key).not.toContain('/sign-in/email');

    useSqliteSystemDb(systemDb, (db) => db.update(rateLimit).set({ lastRequest: 0 }).run());
    vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER);
    await expect(
      runMutation(
        first.signIn,
        { csrf: token, email: 'missing@example.test', password: 'incorrect-password' },
        request,
        { clientIp: () => '127.0.0.20' },
      ),
    ).resolves.toMatchObject({ error: { code: 'INVALID_CREDENTIALS' }, status: 422 });
    expect(useSqliteSystemDb(systemDb, (db) => db.select().from(rateLimit).all())).toEqual([
      expect.objectContaining({ count: 1 }),
    ]);
  });

  it('rejects non-redirect GETs and adversarial mount suffixes without limiter writes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createSqliteAppRuntime({ tables: Object.values(authSchema) });
    runtimes.push(runtime);
    const systemDb = runtime.systemDb({
      operation: 'write',
      reason: 'Prove unknown Better Auth paths cannot grow limiter storage',
      surface: 'packages/better-auth/src/sqlite.seed-session.test.ts',
    });
    const bindings = createBetterAuthSqliteBindings({
      baseURL: 'http://localhost:5173',
      csrf: {
        field: 'csrf',
        secret: 'Kovo-Unknown-Path-Csrf-0a1B2c3D4e5F6g7H8i9J',
        sessionId: () => 'unknown-path-principal',
      },
      mapSession: ({ session: authSession, user: authUser }) => ({
        id: authSession.id,
        user: { email: authUser.email, id: authUser.id, name: authUser.name },
      }),
      schema: authSchema,
      secret: betterAuthSqliteSecret(authSecret),
      signInAccess: { kind: 'public', reason: 'unknown path test' },
      signOutAccess: { kind: 'public', reason: 'unknown path test' },
      systemDb,
    });
    const endpoint = mount('/api/auth', bindings.mountAdapter);
    const suffixes = [
      '/sign-in/email',
      '/sign-up/email',
      '/sign-in//email',
      '/sign-in/%65mail',
      '/SIGN-IN/email',
      '/sign-in/email/',
      '/sign-in%2Femail',
      '/sign-in%5Cemail',
      '/sign-in/../sign-in/email',
      '/sign-in\\email',
      ...Array.from({ length: 64 }, (_, index) => `/unknown-${index}`),
    ];

    const responses = await Promise.allSettled(
      suffixes.map((suffix) =>
        runEndpoint(endpoint, new Request(`http://localhost:5173/api/auth${suffix}`)),
      ),
    );

    expect(responses).toHaveLength(suffixes.length);
    for (const response of responses) {
      expect(response.status).toBe('rejected');
      if (response.status === 'rejected') {
        expect(response.reason).toMatchObject({
          message: 'Better Auth mounted handler failed inside the trusted plaintext boundary.',
        });
      }
    }
    expect(useSqliteSystemDb(systemDb, (db) => db.select().from(rateLimit).all())).toEqual([]);
  });
});
