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
  createDeclaredWriteDb,
  createSqliteAuthorizationDb,
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
  sqliteFile: string;
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
const RUNTIME_DB_METADATA = extractKovoRuntimeDbMetadata(SCHEMA_TABLES);
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
  const db = drizzle({ client });
  const secretReadDb = createSecretBoxingReadDb(
    readonlyDb(db, {
      rawRead: {
        dialectLabel: 'SQLite',
        executeMethod: 'all',
        normalizeTableName: normalizePolicyTable,
        sqliteAuthorizer: {
          constants: nodeSqliteConstants,
          openDatabase: () => new NodeSqliteDatabaseSync(sqliteFile),
        },
      },
    }),
    RUNTIME_DB_METADATA,
    {
      sqliteColumnOrigins: client,
    },
  );
  Object.defineProperty(db, kovoReadonlyDbHandle, {
    configurable: true,
    value: () => secretReadDb,
  });
  Object.defineProperty(db, kovoDeclaredWriteDbHandle, {
    configurable: true,
    value: (policy: DeclaredWritePolicy) =>
      createDeclaredWriteDb(db, policy, {
        dialectLabel: 'SQLite',
        governedColumns: RUNTIME_DB_METADATA,
        normalizeTableName: normalizePolicyTable,
        sqliteAuthorizer: {
          constants: nodeSqliteConstants,
          openDatabase: () => new NodeSqliteDatabaseSync(sqliteFile),
        },
        tableNames: sqliteTablePolicyNames,
      }),
  });
  return {
    db,
    readonlyDb: secretReadDb,
    ready: Promise.resolve(),
    sqliteFile,
  };
}

type SqliteTable = Parameters<typeof getTableConfig>[0];
export { declareSecretReadCapability };

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

const appDatabase = createAppRuntimeDb();

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb;
export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/** Framework construction/auth adapter hook; do not import this into endpoint/webhook/task code. */
export function appRuntimeDbProvider(request?: unknown): AppDb {
  if (request === undefined) return appDatabase.db;

  const principal = ownerPrincipalFromRequest(request);
  const authorizedDb = createSqliteAuthorizationDb(appDatabase.db, {
    metadata: RUNTIME_DB_METADATA,
    principal,
  });
  const requestDb = Object.create(authorizedDb) as AppDb;
  Object.defineProperty(requestDb, kovoReadonlyDbHandle, {
    configurable: true,
    value: () =>
      createSqliteAuthorizationDb(appDatabase.readonlyDb, {
        metadata: RUNTIME_DB_METADATA,
        principal,
      }),
  });
  Object.defineProperty(requestDb, kovoDeclaredWriteDbHandle, {
    configurable: true,
    value: (policy: DeclaredWritePolicy) =>
      createSqliteAuthorizationDb(
        createDeclaredWriteDb(appDatabase.db, policy, {
          dialectLabel: 'SQLite',
          governedColumns: RUNTIME_DB_METADATA,
          normalizeTableName: normalizePolicyTable,
          sqliteAuthorizer: {
            constants: nodeSqliteConstants,
            openDatabase: () => new NodeSqliteDatabaseSync(appDatabase.sqliteFile),
          },
          tableNames: sqliteTablePolicyNames,
        }),
        {
          metadata: RUNTIME_DB_METADATA,
          principal,
        },
      ),
  });
  return requestDb;
}

function ownerPrincipalFromRequest(request: unknown): string | undefined {
  const nonRequestPrincipal = ownerPrincipalFromNonRequestPosture(request);
  if (nonRequestPrincipal !== undefined) return nonRequestPrincipal;
  if ((typeof request !== 'object' && typeof request !== 'function') || request === null) {
    return undefined;
  }
  const session = (request as { session?: unknown }).session;
  if ((typeof session !== 'object' && typeof session !== 'function') || session === null) {
    return undefined;
  }
  const user = (session as { user?: unknown }).user;
  if ((typeof user !== 'object' && typeof user !== 'function') || user === null) return undefined;
  const id = (user as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() === id && id !== '' ? id : undefined;
}

function ownerPrincipalFromNonRequestPosture(request: unknown): string | undefined {
  if ((typeof request !== 'object' && typeof request !== 'function') || request === null) {
    return undefined;
  }
  const posture = (request as { principalPosture?: unknown }).principalPosture;
  if ((typeof posture !== 'object' && typeof posture !== 'function') || posture === null) {
    return undefined;
  }
  const kind = (posture as { kind?: unknown }).kind;
  if (kind === 'system') {
    throw new Error(
      'System principal DB posture is not supported by the SQLite starter owner-scope provider yet (SPEC §10.3 DEC-G).',
    );
  }
  const principal = (posture as { principal?: unknown }).principal;
  return kind === 'act-as' && typeof principal === 'string' && principal.trim() === principal
    ? principal
    : undefined;
}
