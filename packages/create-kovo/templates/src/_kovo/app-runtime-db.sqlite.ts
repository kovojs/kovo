import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DatabaseSync as NodeSqliteDatabaseSync,
  constants as nodeSqliteConstants,
} from 'node:sqlite';

import Database from 'better-sqlite3';
import {
  createSecretBoxingReadDb,
  declareSecretReadCapability,
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  readonlyDb,
} from '@kovojs/server';
import { extractKovoRuntimeDbMetadata } from '@kovojs/drizzle';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '../schema.js';
import type { AppDb, AppReadonlyDb } from '../db.js';

// The framework-owned app database runtime for the opt-in SQLite scaffold.
// Postgres remains the default starter dialect.

interface CreatedAppRuntimeDb {
  db: AppDb;
  readonlyDb: AppReadonlyDb;
  ready: Promise<void>;
}

const SCHEMA_DDL = [
  // App domain.
  "CREATE TABLE contacts (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, company text NOT NULL DEFAULT '');",
  // Better Auth tables (column names match src/schema.ts). SQLite stores
  // booleans and Drizzle timestamp_ms dates as integer mode columns.
  'CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" integer NOT NULL DEFAULT 0, image text, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)));',
  'CREATE TABLE "session" (id text PRIMARY KEY, "expiresAt" integer NOT NULL, token text NOT NULL UNIQUE, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);',
  'CREATE TABLE "account" (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" integer, "refreshTokenExpiresAt" integer, scope text, password text, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)));',
  'CREATE TABLE "verification" (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" integer NOT NULL, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)));',
].join('\n');

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, company) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
  "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park');";
const SCHEMA_TABLES = [
  schema.contacts,
  schema.user,
  schema.session,
  schema.account,
  schema.verification,
] as const;
const SECRET_READ_METADATA = extractKovoRuntimeDbMetadata(SCHEMA_TABLES);
interface DeclaredWritePolicy {
  tables?: readonly string[];
  touches?: readonly string[];
}

function createAppRuntimeDb(): CreatedAppRuntimeDb {
  const sqliteDir = mkdtempSync(join(tmpdir(), 'kovo-sqlite-runtime-'));
  const sqliteFile = join(sqliteDir, 'app.sqlite');
  process.once('exit', () => rmSync(sqliteDir, { force: true, recursive: true }));
  const client = new Database(sqliteFile);
  client.exec(SCHEMA_DDL);
  client.exec(SEED_CONTACTS);
  const db = drizzle({ client, schema });
  const secretReadDb = createSecretBoxingReadDb(readonlyDb(db), SECRET_READ_METADATA, {
    sqliteColumnOrigins: client,
  });
  Object.defineProperty(db, kovoReadonlyDbHandle, {
    configurable: true,
    value: () => secretReadDb,
  });
  Object.defineProperty(db, kovoDeclaredWriteDbHandle, {
    configurable: true,
    value: (policy: DeclaredWritePolicy) => declaredWriteDrizzleDb(db, policy, sqliteFile),
  });
  return {
    db,
    readonlyDb: secretReadDb,
    ready: Promise.resolve(),
  };
}

interface SqlCarrier {
  params: readonly unknown[];
  text: string;
}

type SqliteTable = Parameters<typeof getTableConfig>[0];
export { declareSecretReadCapability };

function declaredWriteDrizzleDb<Db extends object>(
  db: Db,
  policy: DeclaredWritePolicy,
  sqliteFile: string,
): Db {
  const authorizer = new DeclaredWriteSqliteAuthorizer(sqliteFile, policy);
  return new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (isDirectSqlWriteMethod(prop) && typeof value === 'function') {
        return (statement: unknown, ...args: unknown[]) => {
          authorizer.assertDirectSqlAllowed(statement, args);
          return Reflect.apply(value, target, [statement, ...args]);
        };
      }
      if (isDrizzleWriteMethod(prop) && typeof value === 'function') {
        return (table: unknown, ...args: unknown[]) => {
          assertDeclaredDrizzleTableAllowed(table, policy);
          return Reflect.apply(value, target, [table, ...args]);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Db;
}

class DeclaredWriteSqliteAuthorizer {
  constructor(
    private readonly sqliteFile: string,
    private readonly policy: DeclaredWritePolicy,
  ) {}

  assertDirectSqlAllowed(statement: unknown, params: readonly unknown[]): void {
    const carrier = sqlCarrierFromValue(statement, params);
    if (carrier === undefined) {
      throw new Error(
        'KV406: SQLite declared-write authorizer could not resolve executable SQL text (SPEC §10.3/§11.2).',
      );
    }

    const sqlite = new NodeSqliteDatabaseSync(this.sqliteFile);
    try {
      sqlite.setAuthorizer((action, objectName, _columnName, databaseName, triggerOrView) => {
        if (
          sqliteAuthorizerDdlActions.has(action) ||
          action === nodeSqliteConstants.SQLITE_PRAGMA
        ) {
          return nodeSqliteConstants.SQLITE_DENY;
        }

        if (!sqliteAuthorizerWriteActions.has(action)) return nodeSqliteConstants.SQLITE_OK;

        const table = `${databaseName ?? 'main'}.${objectName ?? '<unknown>'}`;
        const allowed = new Set(
          (this.policy.tables ?? []).map((name) => normalizePolicyTable(name)),
        );
        if (allowed.has(table)) return nodeSqliteConstants.SQLITE_OK;
        if (
          triggerOrView === null &&
          (objectName === 'sqlite_sequence' || objectName === 'sqlite_stat1')
        ) {
          return nodeSqliteConstants.SQLITE_OK;
        }
        return nodeSqliteConstants.SQLITE_DENY;
      });

      sqlite.prepare(carrier.text);
    } catch (error) {
      if (error instanceof Error && /not authorized/i.test(error.message)) {
        throw new Error(
          [
            'KV406: SQLite authorizer rejected a declared-write statement outside the mutation registry tables (SPEC §10.3/§11.2).',
            `  declared tables: ${[...new Set(this.policy.tables ?? [])].sort().join(', ')}`,
            `  touches: ${[...new Set(this.policy.touches ?? [])].sort().join(', ') || '<none>'}`,
          ].join('\n'),
        );
      }
      throw error;
    } finally {
      sqlite.close();
    }
  }
}

const sqliteAuthorizerWriteActions = new Set([
  nodeSqliteConstants.SQLITE_DELETE,
  nodeSqliteConstants.SQLITE_INSERT,
  nodeSqliteConstants.SQLITE_UPDATE,
]);

const sqliteAuthorizerDdlActions = new Set([
  nodeSqliteConstants.SQLITE_ALTER_TABLE,
  nodeSqliteConstants.SQLITE_ATTACH,
  nodeSqliteConstants.SQLITE_CREATE_INDEX,
  nodeSqliteConstants.SQLITE_CREATE_TABLE,
  nodeSqliteConstants.SQLITE_CREATE_TEMP_INDEX,
  nodeSqliteConstants.SQLITE_CREATE_TEMP_TABLE,
  nodeSqliteConstants.SQLITE_CREATE_TEMP_TRIGGER,
  nodeSqliteConstants.SQLITE_CREATE_TEMP_VIEW,
  nodeSqliteConstants.SQLITE_CREATE_TRIGGER,
  nodeSqliteConstants.SQLITE_CREATE_VIEW,
  nodeSqliteConstants.SQLITE_CREATE_VTABLE,
  nodeSqliteConstants.SQLITE_DETACH,
  nodeSqliteConstants.SQLITE_DROP_INDEX,
  nodeSqliteConstants.SQLITE_DROP_TABLE,
  nodeSqliteConstants.SQLITE_DROP_TEMP_INDEX,
  nodeSqliteConstants.SQLITE_DROP_TEMP_TABLE,
  nodeSqliteConstants.SQLITE_DROP_TEMP_TRIGGER,
  nodeSqliteConstants.SQLITE_DROP_TEMP_VIEW,
  nodeSqliteConstants.SQLITE_DROP_TRIGGER,
  nodeSqliteConstants.SQLITE_DROP_VIEW,
  nodeSqliteConstants.SQLITE_DROP_VTABLE,
  nodeSqliteConstants.SQLITE_REINDEX,
]);

function isDrizzleWriteMethod(prop: PropertyKey): prop is 'delete' | 'insert' | 'update' {
  return prop === 'delete' || prop === 'insert' || prop === 'update';
}

function isDirectSqlWriteMethod(prop: PropertyKey): boolean {
  return (
    prop === 'all' || prop === 'execute' || prop === 'get' || prop === 'run' || prop === 'values'
  );
}

function assertDeclaredDrizzleTableAllowed(table: unknown, policy: DeclaredWritePolicy): void {
  const allowed = new Set((policy.tables ?? []).map((name) => normalizePolicyTable(name)));
  const tableNames = sqliteTablePolicyNames(table);
  if (tableNames.some((name) => allowed.has(name))) return;

  throw new Error(
    [
      `KV406: SQLite adapter declared-write fallback rejected table ${tableNames[0] ?? '<unknown>'} outside the mutation registry tables (SPEC §10.3/§11.2).`,
      `  declared tables: ${[...new Set(policy.tables ?? [])].sort().join(', ')}`,
      `  touches: ${[...new Set(policy.touches ?? [])].sort().join(', ') || '<none>'}`,
    ].join('\n'),
  );
}

function sqliteTablePolicyNames(table: unknown): string[] {
  try {
    const config = getTableConfig(table as SqliteTable);
    const schema = (config as { schema?: unknown }).schema;
    const schemaName = typeof schema === 'string' ? schema : undefined;
    const names = [normalizePolicyTable(config.name)];
    if (schemaName !== undefined) names.push(`${schemaName}.${config.name}`);
    return [...new Set(names)];
  } catch {
    throw new Error(
      'KV406: SQLite adapter declared-write fallback could not resolve a Drizzle write table (SPEC §10.3/§11.2).',
    );
  }
}

function normalizePolicyTable(table: string): string {
  return table.includes('.') ? table : `main.${table}`;
}

function sqlCarrierFromValue(value: unknown, params: readonly unknown[]): SqlCarrier | undefined {
  if (typeof value === 'string') return { params, text: value };
  const toSQL = (value as { toSQL?: unknown }).toSQL;
  if (typeof toSQL === 'function') {
    try {
      const result = toSQL.call(value) as { params?: unknown; sql?: unknown };
      if (typeof result?.sql === 'string') {
        return {
          params: Array.isArray(result.params) ? result.params : params,
          text: result.sql,
        };
      }
    } catch {
      return undefined;
    }
  }
  const text = sqlTextFromValue(value);
  if (text !== undefined) return { params, text };
  return undefined;
}

function sqlTextFromValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return undefined;
  const sql = (value as { sql?: unknown }).sql;
  if (typeof sql === 'string') return sql;
  const chunks = (value as { queryChunks?: unknown }).queryChunks;
  if (Array.isArray(chunks)) {
    const text = chunks
      .flatMap((chunk) => {
        const part = (chunk as { value?: unknown }).value;
        return Array.isArray(part)
          ? part.filter((item): item is string => typeof item === 'string')
          : [];
      })
      .join('');
    return text || undefined;
  }
  return undefined;
}

const appDatabase = createAppRuntimeDb();

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb;
export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/** Framework construction/auth adapter hook; do not import this into endpoint/webhook/task code. */
export function appRuntimeDbProvider(): AppDb {
  return appDatabase.db;
}
