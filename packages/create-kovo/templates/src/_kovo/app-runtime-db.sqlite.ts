import Database from 'better-sqlite3';
import { secret } from '@kovojs/core';
import { kovoDeclaredWriteDbHandle, kovoReadonlyDbHandle, readonlyDb } from '@kovojs/server';
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
interface DeclaredWritePolicy {
  tables?: readonly string[];
  touches?: readonly string[];
}

function createAppRuntimeDb(): CreatedAppRuntimeDb {
  const client = new Database(':memory:');
  client.exec(SCHEMA_DDL);
  client.exec(SEED_CONTACTS);
  const db = drizzle({ client, schema });
  const secretReadDb = secretBoxingReadDb(readonlyDb(db), SECRET_READ_METADATA);
  Object.defineProperty(db, kovoReadonlyDbHandle, {
    configurable: true,
    value: () => secretReadDb,
  });
  Object.defineProperty(db, kovoDeclaredWriteDbHandle, {
    configurable: true,
    value: (policy: DeclaredWritePolicy) => declaredWriteDrizzleDb(db, policy),
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
  secretColumnKeysByTable: ReadonlyMap<string, ReadonlySet<string>>;
  secretColumnNamesByTable: ReadonlyMap<string, ReadonlySet<string>>;
  secretTableNames: ReadonlySet<string>;
}

interface SecretReadBoundary {
  builderSecretTableRead: boolean;
  rawWholeRowSecret: boolean;
  secretColumnKeys: ReadonlySet<string>;
  secretColumnNames: ReadonlySet<string>;
  secretColumnScopeKnown: boolean;
}

interface DeclaredSecretReadCapability {
  columns: readonly string[];
  justification: string;
  source: string;
  table: string;
}

const kovoDeclaredSecretReadCapability = Symbol('kovoDeclaredSecretReadCapability');

export function declareSecretReadCapability<T extends object>(
  statement: T,
  declaration: DeclaredSecretReadCapability,
): T {
  if (declaration.justification.trim() === '') {
    throw new Error('KV435: declared secret-read capability requires a justification.');
  }
  if (declaration.source.trim() === '' || declaration.table.trim() === '') {
    throw new Error('KV435: declared secret-read capability requires a source table.');
  }
  if (
    declaration.columns.length === 0 ||
    declaration.columns.some((column) => column.trim() === '')
  ) {
    throw new Error('KV435: declared secret-read capability requires at least one secret column.');
  }
  Object.defineProperty(statement, kovoDeclaredSecretReadCapability, {
    configurable: false,
    enumerable: false,
    value: { ...declaration, columns: [...declaration.columns] },
  });
  return statement;
}

function secretReadMetadata(tables: readonly SqliteTable[]): SecretReadMetadata {
  const allColumnKeys = new Set<string>();
  const secretColumnKeys = new Set<string>();
  const secretColumnNames = new Set<string>();
  const secretColumnKeysByTable = new Map<string, ReadonlySet<string>>();
  const secretColumnNamesByTable = new Map<string, ReadonlySet<string>>();
  const secretTableNames = new Set<string>();

  for (const table of tables) {
    const config = getTableConfig(table);
    const columnKeys = columnKeysByDbName(table, config.columns);
    for (const key of columnKeys.values()) allColumnKeys.add(key);
    const secretAnnotation = kovoSecretAnnotation(table);
    if (secretAnnotation === undefined) continue;

    secretTableNames.add(config.name);
    const tableSecretColumnKeys = new Set<string>();
    const tableSecretColumnNames = new Set<string>();
    const secretKeys =
      secretAnnotation === true
        ? [...columnKeys.values()]
        : kovoSecretColumnKeys(secretAnnotation, table, columnKeys);
    for (const key of secretKeys) {
      secretColumnKeys.add(key);
      tableSecretColumnKeys.add(key);
      const column = Reflect.get(table, key);
      const dbName = isColumnLike(column) ? column.name : key;
      secretColumnNames.add(dbName);
      tableSecretColumnNames.add(dbName);
    }
    secretColumnKeysByTable.set(config.name, tableSecretColumnKeys);
    secretColumnNamesByTable.set(config.name, tableSecretColumnNames);
  }

  return {
    allColumnKeys,
    secretColumnKeys,
    secretColumnKeysByTable,
    secretColumnNames,
    secretColumnNamesByTable,
    secretTableNames,
  };
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

function declaredWriteDrizzleDb<Db extends object>(db: Db, policy: DeclaredWritePolicy): Db {
  // better-sqlite3 12 does not expose SQLite's native authorizer callback in its JS API. This
  // adapter-level fallback enforces declared tables on Drizzle's parser-blind builder boundary;
  // managedDb still guards executable raw SQL sinks before they reach the driver (SPEC §10.3/§11.2).
  return new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
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

function isDrizzleWriteMethod(prop: PropertyKey): prop is 'delete' | 'insert' | 'update' {
  return prop === 'delete' || prop === 'insert' || prop === 'update';
}

function assertDeclaredDrizzleTableAllowed(table: unknown, policy: DeclaredWritePolicy): void {
  const allowed = new Set((policy.tables ?? []).map((name) => normalizePolicyTable(name)));
  if (allowed.size === 0) return;

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
  return new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const item = Reflect.get(target, prop, receiver);
      if (typeof item !== 'function') return item;
      if (!isReadSurfaceMethod(prop)) return item.bind(target);
      return (...args: unknown[]) =>
        wrapReadSurface(
          Reflect.apply(item, db, args),
          metadata,
          readBoundaryForArgs(args, metadata, isDirectSqlReadMethod(prop)),
        );
    },
  }) as Db;
}

function isReadSurfaceMethod(prop: PropertyKey): boolean {
  return (
    prop === '$count' ||
    prop === '$with' ||
    prop === 'all' ||
    prop === 'execute' ||
    prop === 'get' ||
    prop === 'prepare' ||
    prop === 'query' ||
    prop === 'run' ||
    prop === 'select' ||
    prop === 'selectDistinct' ||
    prop === 'sql' ||
    prop === 'values' ||
    prop === 'with'
  );
}

function wrapReadSurface(
  value: unknown,
  metadata: SecretReadMetadata,
  inheritedBoundary: SecretReadBoundary = emptyReadBoundary(),
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
          mergeReadBoundaries(inheritedBoundary, readBoundaryForArgs(args, metadata, false)),
        );
    },
  });
}

function readBoundaryForQuery(value: unknown, metadata: SecretReadMetadata): SecretReadBoundary {
  const sql = querySqlText(value);
  if (sql === undefined) return emptyReadBoundary();
  let boundary = { ...emptyReadBoundary(), secretColumnScopeKnown: true };
  for (const table of metadata.secretTableNames) {
    if (!sqlReferencesTable(sql, table)) continue;
    boundary = mergeReadBoundaries(boundary, {
      builderSecretTableRead: true,
      rawWholeRowSecret: false,
      secretColumnKeys: metadata.secretColumnKeysByTable.get(table) ?? new Set<string>(),
      secretColumnNames: metadata.secretColumnNamesByTable.get(table) ?? new Set<string>(),
      secretColumnScopeKnown: true,
    });
  }
  return boundary;
}

function readBoundaryForArgs(
  args: readonly unknown[],
  metadata: SecretReadMetadata,
  directSqlRead: boolean,
): SecretReadBoundary {
  if (!directSqlRead) return emptyReadBoundary();
  for (const arg of args) {
    const sql = querySqlText(arg) ?? sqlTextFromValue(arg);
    if (sql === undefined) return { ...emptyReadBoundary(), rawWholeRowSecret: true };
    if (sqlReferencesSecretTable(sql, metadata.secretTableNames)) {
      if (!hasDeclaredSecretReadCapability(arg, metadata)) {
        throw new Error(
          'KV435: reader raw SQL secret-column read requires a declared secret-read capability (SPEC §10.3).',
        );
      }
      return {
        ...emptyReadBoundary(),
        rawWholeRowSecret: true,
      };
    }
  }
  return { ...emptyReadBoundary(), secretColumnScopeKnown: true };
}

function hasDeclaredSecretReadCapability(
  statement: unknown,
  metadata: SecretReadMetadata,
): boolean {
  if (statement === null || typeof statement !== 'object') return false;
  const declaration = Reflect.get(statement, kovoDeclaredSecretReadCapability) as
    | DeclaredSecretReadCapability
    | undefined;
  if (declaration === undefined) return false;
  if (!metadata.secretTableNames.has(declaration.table)) return false;
  const secretColumns =
    metadata.secretColumnNamesByTable.get(declaration.table) ?? new Set<string>();
  return declaration.columns.every((column) => secretColumns.has(column));
}

function mergeReadBoundaries(
  left: SecretReadBoundary,
  right: SecretReadBoundary,
): SecretReadBoundary {
  return {
    builderSecretTableRead: left.builderSecretTableRead || right.builderSecretTableRead,
    rawWholeRowSecret: left.rawWholeRowSecret || right.rawWholeRowSecret,
    secretColumnKeys: unionSets(left.secretColumnKeys, right.secretColumnKeys),
    secretColumnNames: unionSets(left.secretColumnNames, right.secretColumnNames),
    secretColumnScopeKnown: left.secretColumnScopeKnown || right.secretColumnScopeKnown,
  };
}

function emptyReadBoundary(): SecretReadBoundary {
  return {
    builderSecretTableRead: false,
    rawWholeRowSecret: false,
    secretColumnKeys: new Set<string>(),
    secretColumnNames: new Set<string>(),
    secretColumnScopeKnown: false,
  };
}

function unionSets(left: ReadonlySet<string>, right: ReadonlySet<string>): ReadonlySet<string> {
  if (left.size === 0) return right;
  if (right.size === 0) return left;
  return new Set([...left, ...right]);
}

function isDirectSqlReadMethod(prop: PropertyKey): boolean {
  return (
    prop === 'all' ||
    prop === 'execute' ||
    prop === 'get' ||
    prop === 'prepare' ||
    prop === 'query' ||
    prop === 'run' ||
    prop === 'sql' ||
    prop === 'values'
  );
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
    if (sqlReferencesTable(sql, table)) return true;
  }
  return false;
}

function sqlReferencesTable(sql: string, table: string): boolean {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_])"?${escaped}"?(?:$|[^A-Za-z0-9_])`, 'i').test(sql);
}

function boxSecretRows(
  value: unknown,
  metadata: SecretReadMetadata,
  boundary: SecretReadBoundary = emptyReadBoundary(),
): unknown {
  if (Array.isArray(value)) return value.map((entry) => boxSecretRows(entry, metadata, boundary));
  if (value === null || typeof value !== 'object') return value;
  if (boundary.rawWholeRowSecret && Array.isArray((value as { rows?: unknown }).rows)) {
    return {
      ...value,
      rows: (value as { rows: unknown[] }).rows.map((row) =>
        row !== null && typeof row === 'object' ? secret(row) : row,
      ),
    };
  }
  if (boundary.rawWholeRowSecret) return secret(value);
  if (boundary.builderSecretTableRead && hasUnclassifiedReadKey(value, metadata)) {
    return secret(value);
  }
  const boxed: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const secretColumnKeys = boundary.secretColumnScopeKnown
      ? boundary.secretColumnKeys
      : metadata.secretColumnKeys;
    const secretColumnNames = boundary.secretColumnScopeKnown
      ? boundary.secretColumnNames
      : metadata.secretColumnNames;
    boxed[key] =
      item === null || item === undefined
        ? item
        : secretColumnKeys.has(key) || secretColumnNames.has(key)
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
