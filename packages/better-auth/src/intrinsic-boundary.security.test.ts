import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPostgresAppRuntimeDb, type KovoPostgresAppRuntimeDb } from '@kovojs/server';
import { createSqliteAppRuntime, type KovoSqliteAppRuntime } from '@kovojs/server/sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pgTable, text as pgText } from '../../server/node_modules/drizzle-orm/pg-core/index.js';
import {
  sqliteTable,
  text as sqliteText,
} from '../../server/node_modules/drizzle-orm/sqlite-core/index.js';
// Keep these static imports above the hostile schema step. The generated app imports the Kovo
// adapter before evaluating its schema and only calls the binding constructor afterward.
import { betterAuthPostgresSecret, createBetterAuthPostgresBindings } from './postgres.js';
import { betterAuthSqliteSecret, createBetterAuthSqliteBindings } from './sqlite.js';

const postgresProof = pgTable('kovo_better_auth_intrinsic_boundary_pg', {
  id: pgText('id').primaryKey(),
});
const sqliteProof = sqliteTable('kovo_better_auth_intrinsic_boundary_sqlite', {
  id: sqliteText('id').primaryKey(),
});
const postgresSecret = 'Kovo-Postgres-Intrinsic-Boundary-Secret-0a1B2c3D4e5F';
const sqliteSecret = 'Kovo-Sqlite-Intrinsic-Boundary-Secret-0a1B2c3D4e5F';
const postgresRuntimes: KovoPostgresAppRuntimeDb[] = [];
const sqliteRuntimes: KovoSqliteAppRuntime[] = [];
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const runtime of sqliteRuntimes.splice(0)) runtime.close();
  for (const runtime of postgresRuntimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe.sequential('Better Auth shared-realm intrinsic boundary', () => {
  it('reproduces Postgres signing-secret disclosure after adapter import and schema evaluation', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = mkdtempSync(join(tmpdir(), 'kovo-better-auth-intrinsic-pg-'));
    roots.push(root);
    const runtime = createPostgresAppRuntimeDb({
      dataDir: root,
      driver: 'pglite',
      schema: { postgresProof },
    });
    postgresRuntimes.push(runtime);
    await runtime.ready;

    const disclosed = await exposeSecretToLateSetReplacement(postgresSecret, async () => {
      const bindings = createBetterAuthPostgresBindings({
        baseURL: 'https://app.example.test',
        csrf: { secret: 'csrf-secret-0123456789abcdef0123456789', sessionId: () => undefined },
        mapSession: ({ session, user }) => ({ id: session.id, user: { id: user.id } }),
        schema: { postgresProof },
        secret: betterAuthPostgresSecret(postgresSecret),
        signInAccess: { kind: 'public', reason: 'intrinsic-boundary repro sign-in' },
        signOutAccess: { kind: 'public', reason: 'intrinsic-boundary repro sign-out' },
        systemDb: runtime.systemDb({
          operation: 'write',
          reason: 'Better Auth shared-realm intrinsic boundary repro',
          surface: 'packages/better-auth/src/intrinsic-boundary.security.test.ts#postgres',
        }),
      });
      await bindings.sessionProvider({ headers: new Headers() });
    });

    expect(disclosed).toContain(postgresSecret);
  });

  it('reproduces SQLite signing-secret disclosure after adapter import and schema evaluation', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createSqliteAppRuntime({ tables: [sqliteProof] });
    sqliteRuntimes.push(runtime);

    const disclosed = await exposeSecretToLateSetReplacement(sqliteSecret, async () => {
      const bindings = createBetterAuthSqliteBindings({
        baseURL: 'http://localhost:5173',
        csrf: { secret: 'csrf-secret-0123456789abcdef0123456789', sessionId: () => undefined },
        mapSession: ({ session, user }) => ({ id: session.id, user: { id: user.id } }),
        schema: { sqliteProof },
        secret: betterAuthSqliteSecret(sqliteSecret),
        signInAccess: { kind: 'public', reason: 'intrinsic-boundary repro sign-in' },
        signOutAccess: { kind: 'public', reason: 'intrinsic-boundary repro sign-out' },
        systemDb: runtime.systemDb({
          operation: 'write',
          reason: 'Better Auth shared-realm intrinsic boundary repro',
          surface: 'packages/better-auth/src/intrinsic-boundary.security.test.ts#sqlite',
        }),
      });
      await bindings.sessionProvider({ headers: new Headers() });
    });

    expect(disclosed).toContain(sqliteSecret);
  });
});

async function exposeSecretToLateSetReplacement(
  secret: string,
  useBindings: () => Promise<void>,
): Promise<readonly string[]> {
  const NativeSet = globalThis.Set;
  const disclosed: string[] = [];
  class HostileSchemaSet<Value> extends NativeSet<Value> {
    constructor(values?: readonly Value[] | null) {
      if (typeof values === 'string') disclosed.push(values);
      super(values);
    }
  }

  globalThis.Set = HostileSchemaSet as SetConstructor;
  try {
    await useBindings();
  } finally {
    globalThis.Set = NativeSet;
  }
  return disclosed;
}
