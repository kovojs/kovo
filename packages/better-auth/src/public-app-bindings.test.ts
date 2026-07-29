import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { KovoPostgresAppRuntimeDb } from '@kovojs/server/postgres';
import { createPostgresAppRuntimeDb } from '@kovojs/server/postgres';
import type { KovoSqliteAppRuntime } from '@kovojs/server/sqlite';
import { createSqliteAppRuntime } from '@kovojs/server/sqlite';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { kovo } from '../../drizzle/src/index.js';
import {
  bigint,
  integer,
  pgTable,
  text,
} from '../../server/node_modules/drizzle-orm/pg-core/index.js';
import {
  integer as sqliteInteger,
  sqliteTable,
  text as sqliteText,
} from '../../server/node_modules/drizzle-orm/sqlite-core/index.js';
import type {
  BetterAuthAppBindings,
  BetterAuthAppBindingsOptions,
  BetterAuthAppCredentialResult,
  BetterAuthAppRequest,
  BetterAuthAppSignInMutation,
  BetterAuthAppSignOutMutation,
} from '@kovojs/better-auth';
import { createBetterAuthPostgresAppBindings } from '@kovojs/better-auth/postgres';
import { createBetterAuthSqliteAppBindings } from '@kovojs/better-auth/sqlite';

const authMocks = vi.hoisted(() => {
  const auth = {
    $context: Promise.resolve({
      baseURL: 'http://localhost:5173/api/auth',
      options: {
        advanced: { ipAddress: { ipAddressHeaders: ['x-kovo-client-ip'] } },
        basePath: '/api/auth',
      },
    }),
    api: {
      getSession: vi.fn(async () => null),
      signInEmail: vi.fn(async () => new Response(null, { status: 204 })),
      signOut: vi.fn(async () => new Response(null, { status: 204 })),
      signUpEmail: vi.fn(async () => new Response(null, { status: 204 })),
    },
    handler: vi.fn(async () => new Response(null, { status: 204 })),
  };
  return {
    auth,
    betterAuth: vi.fn(() => auth),
    drizzleAdapter: vi.fn(() => Object.freeze({ kind: 'app-binding-adapter' })),
  };
});

vi.mock('better-auth', () => ({ betterAuth: authMocks.betterAuth }));
vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: authMocks.drizzleAdapter,
}));
vi.mock('./internal/runtime-lock.js', () => ({
  assertBetterAuthRuntimeRealmLocked: vi.fn(),
}));
vi.mock('@kovojs/server/internal/runtime-environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kovojs/server/internal/runtime-environment')>()),
  runtimeEnvironmentValue(name: string) {
    if (name === 'BETTER_AUTH_SECRET') return 'public-app-binding-test-secret-at-least-32-chars';
    if (name === 'BETTER_AUTH_URL') return 'http://localhost:5173';
    if (name === 'NODE_ENV') return 'development';
    return undefined;
  },
  runtimeLoopbackDevelopmentOrigin: () => 'http://localhost:5173',
}));

interface AppSession {
  id: string;
  user: { email: string; id: string; name: string };
}

type AppRequest = BetterAuthAppRequest<AppSession>;

const postgresRows = pgTable(
  'kovo_better_auth_public_binding_rows',
  { id: text('id').primaryKey() },
  kovo((columns) => ({
    domain: 'better-auth-public-binding',
    key: columns.id,
    reference: true,
  })),
);
const postgresRateLimit = pgTable('rateLimit', {
  count: integer('count').notNull(),
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});
const sqliteRows = sqliteTable('kovo_better_auth_public_binding_rows', {
  id: sqliteText('id').primaryKey(),
});
const sqliteRateLimit = sqliteTable('rateLimit', {
  count: sqliteInteger('count').notNull(),
  id: sqliteText('id').primaryKey(),
  key: sqliteText('key').notNull().unique(),
  lastRequest: sqliteInteger('last_request').notNull(),
});

const roots: string[] = [];
const postgresRuntimes: KovoPostgresAppRuntimeDb[] = [];
const sqliteRuntimes: KovoSqliteAppRuntime[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  for (const runtime of postgresRuntimes.splice(0)) await runtime.close();
  for (const runtime of sqliteRuntimes.splice(0)) runtime.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('human-public Better Auth app binding doors', () => {
  it('exposes one nameable backend-neutral app binding contract', () => {
    expectTypeOf<BetterAuthAppBindings<AppSession, AppRequest>>().toHaveProperty('sessionProvider');
    expectTypeOf<BetterAuthAppSignInMutation<AppRequest>>().toHaveProperty('key');
    expectTypeOf<
      BetterAuthAppSignOutMutation<AppRequest, AppRequest & { session: AppSession }>
    >().toHaveProperty('key');
    expectTypeOf<BetterAuthAppCredentialResult<'signed-in'>>().toEqualTypeOf<{
      redirectTo: string;
      status: 'signed-in';
    }>();
  });

  it('binds a genuine Postgres runtime and returns no database or raw-auth authority', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-public-auth-postgres-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: { postgresRateLimit, postgresRows },
    });
    postgresRuntimes.push(runtime);
    await runtime.ready;

    const bindings = createBetterAuthPostgresAppBindings(
      runtime,
      options({ rateLimit: postgresRateLimit, rows: postgresRows }),
    );

    expect(Object.keys(bindings).sort()).toEqual([
      'mountAdapter',
      'seedDemoUser',
      'sessionProvider',
      'signIn',
      'signOut',
    ]);
    expect(Object.isFrozen(bindings)).toBe(true);
    expect(bindings).not.toHaveProperty('auth');
    expect(bindings).not.toHaveProperty('database');
    expect(bindings).not.toHaveProperty('systemDb');
    expect(authMocks.drizzleAdapter).toHaveBeenCalledOnce();
  });

  it('binds a genuine SQLite runtime through the same sanitized result contract', () => {
    const runtime = createSqliteAppRuntime({ tables: [sqliteRows, sqliteRateLimit] });
    sqliteRuntimes.push(runtime);

    const bindings = createBetterAuthSqliteAppBindings(
      runtime,
      options({ rateLimit: sqliteRateLimit, rows: sqliteRows }),
    );

    expect(Object.keys(bindings).sort()).toEqual([
      'mountAdapter',
      'seedDemoUser',
      'sessionProvider',
      'signIn',
      'signOut',
    ]);
    expect(Object.isFrozen(bindings)).toBe(true);
    expect(bindings).not.toHaveProperty('auth');
    expect(bindings).not.toHaveProperty('database');
    expect(bindings).not.toHaveProperty('systemDb');
    expect(authMocks.drizzleAdapter).toHaveBeenCalledOnce();
  });

  it('rejects structural runtime forgeries before constructing a database adapter', () => {
    expect(() =>
      createBetterAuthPostgresAppBindings(
        {} as KovoPostgresAppRuntimeDb,
        options({ rateLimit: postgresRateLimit, rows: postgresRows }),
      ),
    ).toThrow(/KV414.*invalid Postgres app runtime/u);
    expect(() =>
      createBetterAuthSqliteAppBindings(
        {} as KovoSqliteAppRuntime,
        options({ rateLimit: sqliteRateLimit, rows: sqliteRows }),
      ),
    ).toThrow(/KV414.*invalid SQLite app runtime/u);
    expect(authMocks.drizzleAdapter).not.toHaveBeenCalled();
  });

  it('keeps each public task entry isolated from the other database engine', () => {
    const postgresSource = readFileSync(new URL('./public-postgres.ts', import.meta.url), 'utf8');
    const sqliteSource = readFileSync(new URL('./public-sqlite.ts', import.meta.url), 'utf8');

    expect(postgresSource).not.toMatch(/(?:server|better-auth)\/sqlite|\.\/sqlite/u);
    expect(sqliteSource).not.toMatch(/(?:server|better-auth)\/postgres|\.\/postgres/u);
    expect(postgresSource).toContain("from './postgres.js'");
    expect(sqliteSource).toContain("from './sqlite.js'");
  });
});

function options(
  schema: Record<string, unknown>,
): BetterAuthAppBindingsOptions<AppSession, AppRequest> {
  return {
    csrf: {
      field: 'csrf',
      secret: 'public-app-binding-csrf-secret-at-least-32-chars',
      sessionId: () => undefined,
    },
    mapSession: ({ session, user }) => ({
      id: session.id,
      user: { email: user.email, id: user.id, name: user.name },
    }),
    schema,
    signInAccess: { kind: 'public', reason: 'sign-in begins before authentication' },
  };
}
