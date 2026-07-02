import { PGlite } from '@electric-sql/pglite';
import { secret } from '@kovojs/core';
import { kovoReadonlyDbHandle, readonlyDb } from '@kovojs/server';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';

import { account, contacts, session, user, verification } from '../schema.js';
import type { AppDb, AppReadonlyDb } from '../db.js';

// The framework-owned app database runtime: Drizzle over an in-process PGlite
// (real Postgres, compiled to WASM - no external server to run). It owns raw DB
// creation and exposes only the hooks needed by createApp/auth wiring.
//
// The DDL is derived from src/schema.ts so adding a Drizzle column updates the
// boot schema too. Unsupported DDL shapes fail during app startup instead of
// hiding until a later request.

interface CreatedAppRuntimeDb {
  db: AppDb;
  readonlyDb: AppReadonlyDb;
  ready: Promise<void>;
}

const SCHEMA_TABLES = sortTablesByForeignKeyDependencies([
  contacts,
  user,
  session,
  account,
  verification,
] as const);
const SCHEMA_DDL = schemaDdl(SCHEMA_TABLES);
const SECRET_READ_METADATA = secretReadMetadata(SCHEMA_TABLES);

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, company) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
  "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park') " +
  'ON CONFLICT (id) DO NOTHING;';

const DEFAULT_DATA_DIR = '.kovo/pglite';

function createAppRuntimeDb(): CreatedAppRuntimeDb {
  const client = new PGlite(process.env.KOVO_DATA_DIR ?? DEFAULT_DATA_DIR);
  const ready = initializeAppDb(client);
  const db = drizzle({ client });
  const readDb = drizzle({ client: readonlyPgliteClient(client) });
  const secretReadDb = secretBoxingReadDb(readDb, SECRET_READ_METADATA);
  Object.defineProperty(db, kovoReadonlyDbHandle, {
    configurable: true,
    value: () => secretReadDb,
  });
  return { db, readonlyDb: readonlyDb(db), ready };
}

async function initializeAppDb(client: PGlite): Promise<void> {
  await client.exec(SCHEMA_DDL);
  await client.exec(SEED_CONTACTS);
}

type PgTableConfig = ReturnType<typeof getTableConfig>;
type PgTable = Parameters<typeof getTableConfig>[0];
type PgColumn = PgTableConfig['columns'][number];
type PgForeignKey = PgTableConfig['foreignKeys'][number];

function schemaDdl(tables: readonly PgTable[]): string {
  return [
    ...tables.map(createTableDdl),
    ...tables.flatMap((table) =>
      getTableConfig(table).columns.map((column) => addColumnDdl(table, column)),
    ),
  ].join('\n');
}

function createTableDdl(table: PgTable): string {
  const config = getTableConfig(table);
  const definitions = [
    ...config.columns.map((column) => columnDdl(column, { createTable: true })),
    ...config.foreignKeys.map((foreignKey) => foreignKeyDdl(foreignKey)),
  ];
  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(config.name)} (${definitions.join(', ')});`;
}

function addColumnDdl(table: PgTable, column: PgColumn): string {
  return `ALTER TABLE ${quoteIdent(getTableConfig(table).name)} ADD COLUMN IF NOT EXISTS ${columnDdl(
    column,
    { createTable: false },
  )};`;
}

function columnDdl(column: PgColumn, options: { createTable: boolean }): string {
  return [
    quoteIdent(column.name),
    columnTypeDdl(column),
    options.createTable && column.primary ? 'PRIMARY KEY' : '',
    column.notNull ? 'NOT NULL' : '',
    options.createTable && column.isUnique ? 'UNIQUE' : '',
    columnDefaultDdl(column),
  ]
    .filter(Boolean)
    .join(' ');
}

function columnTypeDdl(column: PgColumn): string {
  switch (column.columnType) {
    case 'PgBoolean':
      return 'boolean';
    case 'PgInteger':
      return 'integer';
    case 'PgJsonb':
      return 'jsonb';
    case 'PgNumeric':
      return 'numeric';
    case 'PgSerial':
      return 'serial';
    case 'PgText':
      return 'text';
    case 'PgTimestamp':
      return 'timestamp';
    default:
      throw new Error(`Unsupported Postgres starter column type ${column.columnType}`);
  }
}

function columnDefaultDdl(column: PgColumn): string {
  if (!column.hasDefault) return '';
  if (column.columnType === 'PgSerial') return '';
  if (column.columnType === 'PgTimestamp') return 'DEFAULT now()';
  if (typeof column.default === 'boolean') return `DEFAULT ${column.default ? 'true' : 'false'}`;
  if (typeof column.default === 'number') return `DEFAULT ${column.default}`;
  if (typeof column.default === 'string') return `DEFAULT ${quoteLiteral(column.default)}`;
  throw new Error(`Unsupported Postgres starter default for ${column.name}`);
}

function foreignKeyDdl(foreignKey: PgForeignKey): string {
  const reference = foreignKey.reference();
  const columns = reference.columns.map((column) => quoteIdent(column.name)).join(', ');
  const foreignColumns = reference.foreignColumns
    .map((column) => quoteIdent(column.name))
    .join(', ');
  const onDelete = foreignKey.onDelete === 'no action' ? '' : ` ON DELETE ${foreignKey.onDelete}`;
  const onUpdate = foreignKey.onUpdate === 'no action' ? '' : ` ON UPDATE ${foreignKey.onUpdate}`;
  return `FOREIGN KEY (${columns}) REFERENCES ${quoteIdent(
    getTableConfig(reference.foreignTable).name,
  )} (${foreignColumns})${onDelete}${onUpdate}`;
}

function sortTablesByForeignKeyDependencies(tables: readonly PgTable[]): PgTable[] {
  const pending = new Set<PgTable>(tables);
  const sorted: PgTable[] = [];

  while (pending.size > 0) {
    let progressed = false;

    for (const table of pending) {
      const dependencies = getTableConfig(table).foreignKeys.map(
        (foreignKey) => foreignKey.reference().foreignTable,
      );
      if (dependencies.some((dependency) => dependency !== table && pending.has(dependency))) {
        continue;
      }
      sorted.push(table);
      pending.delete(table);
      progressed = true;
    }

    if (!progressed) {
      const names = [...pending].map((table) => getTableConfig(table).name).join(', ');
      throw new Error(`Cannot order Postgres starter tables with cyclic foreign keys: ${names}`);
    }
  }

  return sorted;
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function readonlyPgliteClient(client: PGlite): PGlite {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return readonlyPgliteQuery.bind(undefined, target);
      }
      if (prop === 'exec') {
        return readonlyPgliteExec.bind(undefined, target);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PGlite;
}

function readonlyPgliteQuery(
  client: PGlite,
  query: string,
  params?: unknown[],
  options?: Parameters<PGlite['query']>[2],
): Promise<unknown> {
  return client.transaction(async (tx) => {
    await runPgliteReadOnlyTransactionControl(tx);
    return Reflect.apply(tx.query, tx, [query, params, options]) as Promise<unknown>;
  });
}

function readonlyPgliteExec(
  client: PGlite,
  query: string,
  options?: Parameters<PGlite['exec']>[1],
): ReturnType<PGlite['exec']> {
  return client.transaction(async (tx) => {
    await runPgliteReadOnlyTransactionControl(tx);
    return Reflect.apply(tx.exec, tx, [query, options]) as ReturnType<PGlite['exec']>;
  });
}

function runPgliteReadOnlyTransactionControl(
  tx: Parameters<Parameters<PGlite['transaction']>[0]>[0],
): Promise<unknown> {
  return Reflect.apply(tx.exec, tx, ['SET TRANSACTION READ ONLY']) as Promise<unknown>;
}

interface SecretReadMetadata {
  allColumnKeys: ReadonlySet<string>;
  secretColumnKeys: ReadonlySet<string>;
  secretColumnNames: ReadonlySet<string>;
  secretTableNames: ReadonlySet<string>;
}

function secretReadMetadata(tables: readonly PgTable[]): SecretReadMetadata {
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

function columnKeysByDbName(table: PgTable, columns: readonly PgColumn[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [key, value] of Object.entries(table as unknown as Record<string, unknown>)) {
    if (isColumnLike(value)) keys.set(value.name, key);
  }
  for (const column of columns) {
    if (!keys.has(column.name)) keys.set(column.name, column.name);
  }
  return keys;
}

function kovoSecretAnnotation(table: PgTable): true | string | readonly unknown[] | undefined {
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
  table: PgTable,
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
