import { csrfToken } from '@kovojs/server';
import { useSqliteSystemDb } from '@kovojs/server/internal/sqlite-capability';
import { createSqliteAppRuntime, type KovoSqliteAppRuntime } from '@kovojs/server/sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  integer,
  sqliteTable,
  text,
} from '../../server/node_modules/drizzle-orm/sqlite-core/index.js';
import { runMutation } from '../../server/src/mutation.js';
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
    const definitions = [first.signIn, second.signIn, first.signIn, second.signIn];
    const results = [];

    for (let index = 0; index < definitions.length; index += 1) {
      results.push(
        await runMutation(
          definitions[index]!,
          { csrf: token, email: 'missing@example.test', password: 'incorrect-password' },
          request,
          { clientIp: () => '127.0.0.20' },
        ),
      );
    }

    expect(results.slice(0, 3)).toEqual([
      expect.objectContaining({ error: { code: 'INVALID_CREDENTIALS', payload: {} }, status: 422 }),
      expect.objectContaining({ error: { code: 'INVALID_CREDENTIALS', payload: {} }, status: 422 }),
      expect.objectContaining({ error: { code: 'INVALID_CREDENTIALS', payload: {} }, status: 422 }),
    ]);
    expect(results[3]).toEqual({
      error: { code: 'RATE_LIMITED', payload: {} },
      ok: false,
      retryAfter: 10,
      status: 429,
    });
    expect(useSqliteSystemDb(systemDb, (db) => db.select().from(rateLimit).all())).toHaveLength(1);
  });
});
