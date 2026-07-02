import Database from 'better-sqlite3';
import { secret } from '@kovojs/core';
import { kovoReadonlyDbHandle, readonlyDb } from '@kovojs/server';
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
const SECRET_READ_METADATA = secretReadMetadata(SCHEMA_TABLES);

function createAppRuntimeDb(): CreatedAppRuntimeDb {
  const client = new Database(':memory:');
  client.exec(SCHEMA_DDL);
  client.exec(SEED_CONTACTS);
  const db = drizzle({ client, schema });
  const secretReadDb = secretBoxingReadDb(db, SECRET_READ_METADATA);
  Object.defineProperty(db, kovoReadonlyDbHandle, {
    configurable: true,
    value: () => secretReadDb,
  });
  return {
    db,
    readonlyDb: readonlyDb(db),
    ready: Promise.resolve(),
  };
}

type SqliteTable = Parameters<typeof getTableConfig>[0];
type SqliteTableConfig = ReturnType<typeof getTableConfig>;
type SqliteColumn = SqliteTableConfig['columns'][number];

interface SecretReadMetadata {
  allColumnKeys: ReadonlySet<string>;
  secretColumnKeys: ReadonlySet<string>;
  secretColumnNames: ReadonlySet<string>;
  secretTableNames: ReadonlySet<string>;
}

function secretReadMetadata(tables: readonly SqliteTable[]): SecretReadMetadata {
  const allColumnKeys = new Set<string>();
  const secretColumnKeys = new Set<string>();
  const secretColumnNames = new Set<string>();
  const secretTableNames = new Set<string>();

  for (const table of tables) {
    const config = getTableConfig(table);
    const columnKeys = columnKeysByDbName(table, config.columns);
    for (const key of columnKeys.values()) allColumnKeys.add(key);
    const secretAnnotation = kovoSecretAnnotation(table);
    if (secretAnnotation === undefined) continue;

    secretTableNames.add(config.name);
    const secretKeys =
      secretAnnotation === true
        ? [...columnKeys.values()]
        : kovoSecretColumnKeys(secretAnnotation, table, columnKeys);
    for (const key of secretKeys) {
      secretColumnKeys.add(key);
      const column = Reflect.get(table, key);
      const dbName = isColumnLike(column) ? column.name : key;
      secretColumnNames.add(dbName);
    }
  }

  return { allColumnKeys, secretColumnKeys, secretColumnNames, secretTableNames };
}

function columnKeysByDbName(
  table: SqliteTable,
  columns: readonly SqliteColumn[],
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [key, value] of Object.entries(table as unknown as Record<string, unknown>)) {
    if (isColumnLike(value)) keys.set(value.name, key);
  }
  for (const column of columns) {
    if (!keys.has(column.name)) keys.set(column.name, column.name);
  }
  return keys;
}

function kovoSecretAnnotation(table: SqliteTable): true | string | readonly unknown[] | undefined {
  for (const value of [
    ...Object.values(table as unknown as Record<string, unknown>),
    ...Object.getOwnPropertySymbols(table).map((symbol) => Reflect.get(table as object, symbol)),
  ]) {
    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      'secret' in value
    ) {
      const secretValue = (value as { secret?: unknown }).secret;
      if (secretValue === true || typeof secretValue === 'string' || Array.isArray(secretValue)) {
        return secretValue;
      }
    }
  }
  return undefined;
}

function kovoSecretColumnKeys(
  annotation: string | readonly unknown[],
  table: SqliteTable,
  columnKeys: ReadonlyMap<string, string>,
): string[] {
  const refs = Array.isArray(annotation) ? annotation : [annotation];
  return refs.flatMap((ref) => {
    if (typeof ref === 'string') return [columnKeys.get(ref) ?? ref];
    if (typeof ref !== 'function') return [];
    try {
      const selected = ref(table);
      return isColumnLike(selected) ? [columnKeys.get(selected.name) ?? selected.name] : [];
    } catch {
      return [];
    }
  });
}

function isColumnLike(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function secretBoxingReadDb<Db extends object>(db: Db, metadata: SecretReadMetadata): Db {
  const readDb = {};
  for (const prop of ['$count', '$with', 'query', 'select', 'selectDistinct', 'with'] as const) {
    const item = Reflect.get(db, prop);
    if (typeof item === 'function') {
      Reflect.set(readDb, prop, (...args: unknown[]) =>
        wrapReadSurface(Reflect.apply(item, db, args), metadata),
      );
    } else if (item !== undefined) {
      Reflect.set(readDb, prop, item);
    }
  }
  return Object.assign({}, db, readDb);
}

function wrapReadSurface(
  value: unknown,
  metadata: SecretReadMetadata,
  inheritedBoundary: { wholeRowSecret: boolean } = { wholeRowSecret: false },
): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Promise) {
    return value.then((result) => boxSecretRows(result, metadata, inheritedBoundary));
  }
  return new Proxy(value, {
    get(target, prop, receiver) {
      const item = Reflect.get(target, prop, receiver);
      if (prop === 'then' && typeof item === 'function') {
        const boundary = mergeReadBoundaries(
          inheritedBoundary,
          readBoundaryForQuery(target, metadata),
        );
        return (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) =>
          Reflect.apply(item, target, [
            (result: unknown) => onFulfilled?.(boxSecretRows(result, metadata, boundary)),
            onRejected,
          ]);
      }
      if (typeof item !== 'function') return item;
      return (...args: unknown[]) =>
        wrapReadSurface(
          Reflect.apply(item, target, args),
          metadata,
          mergeReadBoundaries(inheritedBoundary, readBoundaryForArgs(args, metadata)),
        );
    },
  });
}

function readBoundaryForQuery(
  value: unknown,
  metadata: SecretReadMetadata,
): { wholeRowSecret: boolean } {
  const sql = querySqlText(value);
  if (sql === undefined) return { wholeRowSecret: false };
  return { wholeRowSecret: sqlReferencesSecretTable(sql, metadata.secretTableNames) };
}

function readBoundaryForArgs(
  args: readonly unknown[],
  metadata: SecretReadMetadata,
): { wholeRowSecret: boolean } {
  for (const arg of args) {
    const sql = querySqlText(arg) ?? sqlTextFromValue(arg);
    if (sql === undefined) continue;
    if (sqlReferencesSecretTable(sql, metadata.secretTableNames)) return { wholeRowSecret: true };
  }
  return { wholeRowSecret: false };
}

function mergeReadBoundaries(
  left: { wholeRowSecret: boolean },
  right: { wholeRowSecret: boolean },
): { wholeRowSecret: boolean } {
  return { wholeRowSecret: left.wholeRowSecret || right.wholeRowSecret };
}

function querySqlText(value: unknown): string | undefined {
  const toSQL = (value as { toSQL?: unknown }).toSQL;
  if (typeof toSQL !== 'function') return undefined;
  try {
    const result = toSQL.call(value) as { sql?: unknown };
    return typeof result?.sql === 'string' ? result.sql : undefined;
  } catch {
    return undefined;
  }
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

function sqlReferencesSecretTable(sql: string, secretTableNames: ReadonlySet<string>): boolean {
  for (const table of secretTableNames) {
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^A-Za-z0-9_])"?${escaped}"?(?:$|[^A-Za-z0-9_])`, 'i').test(sql)) {
      return true;
    }
  }
  return false;
}

function boxSecretRows(
  value: unknown,
  metadata: SecretReadMetadata,
  boundary: { wholeRowSecret: boolean } = { wholeRowSecret: false },
): unknown {
  if (Array.isArray(value)) return value.map((entry) => boxSecretRows(entry, metadata, boundary));
  if (value === null || typeof value !== 'object') return value;
  if (boundary.wholeRowSecret && hasUnclassifiedReadKey(value, metadata)) return secret(value);
  const boxed: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    boxed[key] =
      item === null || item === undefined
        ? item
        : metadata.secretColumnKeys.has(key) || metadata.secretColumnNames.has(key)
          ? secret(item)
          : boxSecretRows(item, metadata, boundary);
  }
  return boxed;
}

function hasUnclassifiedReadKey(value: object, metadata: SecretReadMetadata): boolean {
  for (const key of Object.keys(value)) {
    if (!metadata.allColumnKeys.has(key)) return true;
  }
  return false;
}

const appDatabase = createAppRuntimeDb();

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb;
export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/** Framework construction/auth adapter hook; do not import this into endpoint/webhook/task code. */
export function appRuntimeDbProvider(): AppDb {
  return appDatabase.db;
}
