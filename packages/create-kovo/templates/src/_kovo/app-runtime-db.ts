import { PGlite } from '@electric-sql/pglite';
import { secret } from '@kovojs/core';
import { kovoDeclaredWriteDbHandle, kovoReadonlyDbHandle, readonlyDb } from '@kovojs/server';
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
const READER_ROLE = 'kovo_reader';
interface DeclaredWritePolicy {
  tables?: readonly string[];
  touches?: readonly string[];
}

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
  const readDb = drizzle({ client: readonlyPgliteClient(client, { readerRole: true }) });
  const privilegedReadDb = drizzle({
    client: readonlyPgliteClient(client, { readerRole: false }),
  });
  const secretReadDb = secretBoxingReadDb(
    readonlyDb(readDb),
    SECRET_READ_METADATA,
    readonlyDb(privilegedReadDb),
  );
  Object.defineProperty(db, kovoReadonlyDbHandle, {
    configurable: true,
    value: () => secretReadDb,
  });
  Object.defineProperty(db, kovoDeclaredWriteDbHandle, {
    configurable: true,
    value: (policy: DeclaredWritePolicy) => declaredWriteDrizzleDb(db, policy),
  });
  return { db, readonlyDb: secretReadDb, ready };
}

async function initializeAppDb(client: PGlite): Promise<void> {
  await ensurePgliteRole(client, READER_ROLE);
  await client.exec(SCHEMA_DDL);
  await applyPgliteReaderColumnPrivileges(client, SCHEMA_TABLES, SECRET_READ_METADATA);
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

function declaredWriteDrizzleDb<Db extends object>(db: Db, policy: DeclaredWritePolicy): Db {
  // PGlite gives this runtime one embedded handle, not a request-scoped GRANT/ROLE sandbox. This
  // adapter fallback enforces declared tables on Drizzle's parser-blind builder boundary; managedDb
  // still guards executable raw SQL sinks before they reach the engine (SPEC §10.3/§11.2).
  return new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (isDrizzleWriteMethod(prop) && typeof value === 'function') {
        return (table: unknown, ...args: unknown[]) => {
          assertDeclaredDrizzleTableAllowed(table, policy);
          return Reflect.apply(value, target, [table, ...args]);
        };
      }
      if (prop === 'transaction' && typeof value === 'function') {
        return (callback: (tx: unknown) => unknown, ...args: unknown[]) =>
          Reflect.apply(value, target, [
            (tx: unknown) => callback(declaredWriteDrizzleDb(tx as object, policy)),
            ...args,
          ]);
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
  const tableNames = pgTablePolicyNames(table);
  if (tableNames.some((name) => allowed.has(name))) return;

  throw new Error(
    [
      `KV406: PGlite adapter declared-write fallback rejected table ${tableNames[0] ?? '<unknown>'} outside the mutation registry tables (SPEC §10.3/§11.2).`,
      `  declared tables: ${[...new Set(policy.tables ?? [])].sort().join(', ')}`,
      `  touches: ${[...new Set(policy.touches ?? [])].sort().join(', ') || '<none>'}`,
    ].join('\n'),
  );
}

function pgTablePolicyNames(table: unknown): string[] {
  try {
    const config = getTableConfig(table as PgTable);
    const schema = (config as { schema?: unknown }).schema;
    const schemaName = typeof schema === 'string' ? schema : undefined;
    const names = [normalizePolicyTable(config.name)];
    if (schemaName !== undefined) names.push(`${schemaName}.${config.name}`);
    return [...new Set(names)];
  } catch {
    throw new Error(
      'KV406: PGlite adapter declared-write fallback could not resolve a Drizzle write table (SPEC §10.3/§11.2).',
    );
  }
}

function normalizePolicyTable(table: string): string {
  return table.includes('.') ? table : `public.${table}`;
}

async function ensurePgliteRole(client: PGlite, role: string): Promise<void> {
  const result = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (result.rows.length === 0) await client.exec(`CREATE ROLE ${quoteIdent(role)}`);
}

async function applyPgliteReaderColumnPrivileges(
  client: PGlite,
  tables: readonly PgTable[],
  metadata: SecretReadMetadata,
): Promise<void> {
  for (const table of tables) {
    const config = getTableConfig(table);
    const secretColumns = metadata.secretColumnNamesByTable.get(config.name) ?? new Set<string>();
    const publicColumns = config.columns
      .map((column) => column.name)
      .filter((column) => !secretColumns.has(column));
    await client.exec(`REVOKE ALL ON TABLE ${quoteIdent(config.name)} FROM PUBLIC`);
    await client.exec(
      `REVOKE ALL ON TABLE ${quoteIdent(config.name)} FROM ${quoteIdent(READER_ROLE)}`,
    );
    if (publicColumns.length > 0) {
      await client.exec(
        `GRANT SELECT (${publicColumns.map(quoteIdent).join(', ')}) ON TABLE ${quoteIdent(
          config.name,
        )} TO ${quoteIdent(READER_ROLE)}`,
      );
    }
  }
}

function readonlyPgliteClient(client: PGlite, options: { readerRole: boolean }): PGlite {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return readonlyPgliteQuery.bind(undefined, target, options);
      }
      if (prop === 'exec') {
        return readonlyPgliteExec.bind(undefined, target, options);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PGlite;
}

function readonlyPgliteQuery(
  client: PGlite,
  roleOptions: { readerRole: boolean },
  query: string,
  params?: unknown[],
  queryOptions?: Parameters<PGlite['query']>[2],
): Promise<unknown> {
  return client.transaction(async (tx) => {
    await runPgliteReadOnlyTransactionControl(tx, roleOptions.readerRole);
    return Reflect.apply(tx.query, tx, [query, params, queryOptions]) as Promise<unknown>;
  });
}

function readonlyPgliteExec(
  client: PGlite,
  options: { readerRole: boolean },
  query: string,
  execOptions?: Parameters<PGlite['exec']>[1],
): ReturnType<PGlite['exec']> {
  return client.transaction(async (tx) => {
    await runPgliteReadOnlyTransactionControl(tx, options.readerRole);
    return Reflect.apply(tx.exec, tx, [query, execOptions]) as ReturnType<PGlite['exec']>;
  });
}

function runPgliteReadOnlyTransactionControl(
  tx: Parameters<Parameters<PGlite['transaction']>[0]>[0],
  readerRole: boolean,
): Promise<unknown> {
  return (async () => {
    await (Reflect.apply(tx.exec, tx, ['SET TRANSACTION READ ONLY']) as Promise<unknown>);
    if (readerRole) {
      await (Reflect.apply(tx.exec, tx, [
        `SET LOCAL ROLE ${quoteIdent(READER_ROLE)}`,
      ]) as Promise<unknown>);
    }
  })();
}

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
  declaredSecretRead: boolean;
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

function secretReadMetadata(tables: readonly PgTable[]): SecretReadMetadata {
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

function secretBoxingReadDb<Db extends object>(
  db: Db,
  metadata: SecretReadMetadata,
  privilegedDb?: Db,
): Db {
  return new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const item = Reflect.get(target, prop, receiver);
      if (typeof item !== 'function') return item;
      if (!isReadSurfaceMethod(prop)) return item.bind(target);
      return (...args: unknown[]) => {
        const boundary = readBoundaryForArgs(args, metadata, isDirectSqlReadMethod(prop));
        const readTarget =
          boundary.declaredSecretRead && privilegedDb !== undefined
            ? (privilegedDb as Record<PropertyKey, unknown>)
            : target;
        const readMethod = Reflect.get(readTarget, prop, receiver);
        if (typeof readMethod !== 'function') return readMethod;
        return wrapReadSurface(
          Reflect.apply(readMethod, readTarget, args),
          metadata,
          boundary,
          privilegedDb,
        );
      };
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
  privilegedDb?: object,
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
          privilegedDb,
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
      declaredSecretRead: false,
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
      const declaredSecretRead = hasDeclaredSecretReadCapability(arg, metadata);
      return mergeReadBoundaries(secretBoundaryForSql(sql, metadata), {
        ...emptyReadBoundary(),
        declaredSecretRead,
        rawWholeRowSecret: declaredSecretRead,
      });
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
    declaredSecretRead: left.declaredSecretRead || right.declaredSecretRead,
    rawWholeRowSecret: left.rawWholeRowSecret || right.rawWholeRowSecret,
    secretColumnKeys: unionSets(left.secretColumnKeys, right.secretColumnKeys),
    secretColumnNames: unionSets(left.secretColumnNames, right.secretColumnNames),
    secretColumnScopeKnown: left.secretColumnScopeKnown || right.secretColumnScopeKnown,
  };
}

function emptyReadBoundary(): SecretReadBoundary {
  return {
    builderSecretTableRead: false,
    declaredSecretRead: false,
    rawWholeRowSecret: false,
    secretColumnKeys: new Set<string>(),
    secretColumnNames: new Set<string>(),
    secretColumnScopeKnown: false,
  };
}

function secretBoundaryForSql(sql: string, metadata: SecretReadMetadata): SecretReadBoundary {
  let boundary = { ...emptyReadBoundary(), secretColumnScopeKnown: true };
  for (const table of metadata.secretTableNames) {
    if (!sqlReferencesTable(sql, table)) continue;
    boundary = mergeReadBoundaries(boundary, {
      builderSecretTableRead: false,
      declaredSecretRead: false,
      rawWholeRowSecret: false,
      secretColumnKeys: metadata.secretColumnKeysByTable.get(table) ?? new Set<string>(),
      secretColumnNames: metadata.secretColumnNamesByTable.get(table) ?? new Set<string>(),
      secretColumnScopeKnown: true,
    });
  }
  return boundary;
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
