import { PGlite } from '@electric-sql/pglite';
import {
  createAuthorizationCensusDb,
  createSecretBoxingReadDb,
  createDeclaredWriteDb,
  createPostgresReadonlyClient,
  createPostgresScopedClient,
  declareSecretReadCapability,
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  readonlyDb,
  type PostgresReadonlyClientOptions,
  type PostgresScopedClientOptions,
} from '@kovojs/server';
import { extractKovoRuntimeDbMetadata, type KovoRuntimeDbMetadata } from '@kovojs/drizzle';
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
  db: (request?: unknown) => AppDb;
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
const SECRET_READ_METADATA = extractKovoRuntimeDbMetadata(SCHEMA_TABLES);
const READER_ROLE = 'kovo_reader';
const WRITER_ROLE = 'kovo_writer';
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
  return {
    db: (request?: unknown) =>
      request === undefined
        ? createInternalFrameworkDb(client)
        : createRequestScopedDb(client, principalFromRequest(request)),
    readonlyDb: createRequestScopedReadonlyDb(client),
    ready,
  };
}

async function initializeAppDb(client: PGlite): Promise<void> {
  await ensurePgliteRole(client, READER_ROLE);
  await ensurePgliteRole(client, WRITER_ROLE);
  await client.exec(SCHEMA_DDL);
  await client.exec(
    'REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) FROM PUBLIC',
  );
  await applyPgliteOwnerPolicies(client, SCHEMA_TABLES, SECRET_READ_METADATA);
  await applyPgliteReaderColumnPrivileges(client, SCHEMA_TABLES, SECRET_READ_METADATA);
  await applyPgliteWriterTablePrivileges(client, SCHEMA_TABLES);
  await client.exec(SEED_CONTACTS);
}

type PgTableConfig = ReturnType<typeof getTableConfig>;
type PgTable = Parameters<typeof getTableConfig>[0];
type PgColumn = PgTableConfig['columns'][number];
type PgForeignKey = PgTableConfig['foreignKeys'][number];

export { declareSecretReadCapability };

function createInternalFrameworkDb(client: PGlite): AppDb {
  return drizzle({ client });
}

function createRequestScopedDb(client: PGlite, principal: string | undefined): AppDb {
  const db = createAuthorizationCensusDb(
    drizzle({
      client: createPostgresScopedClient(client, postgresScopedClientOptions(principal)),
    }),
    {
      dialectLabel: 'PGlite',
      metadata: SECRET_READ_METADATA,
      normalizeTableName: normalizePolicyTable,
      tableNames: pgTablePolicyNames,
    },
  );
  Object.defineProperty(db, kovoReadonlyDbHandle, {
    configurable: true,
    value: () => createRequestScopedReadonlyDb(client, principal),
  });
  Object.defineProperty(db, kovoDeclaredWriteDbHandle, {
    configurable: true,
    value: (policy: DeclaredWritePolicy) =>
      createDeclaredWriteDb(db, policy, {
        dialectLabel: 'PGlite',
        governedColumns: SECRET_READ_METADATA,
        normalizeTableName: normalizePolicyTable,
        tableNames: pgTablePolicyNames,
      }),
  });
  return db;
}

function createRequestScopedReadonlyDb(
  client: PGlite,
  principal: string | undefined = undefined,
): AppReadonlyDb {
  const readDb = drizzle({
    client: createPostgresReadonlyClient(client, postgresReadonlyClientOptions(principal)),
  });
  const privilegedReadDb = drizzle({
    client: createPostgresReadonlyClient(client, postgresReadonlyClientOptions(principal, false)),
  });
  return createSecretBoxingReadDb(readonlyDb(readDb), SECRET_READ_METADATA, {
    privilegedDb: readonlyDb(privilegedReadDb),
    rawSecretTableRead: 'engine',
  });
}

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

function pgTablePolicyNames(table: unknown): string[] {
  try {
    const config = getTableConfig(table as PgTable);
    const schema = (config as { schema?: unknown }).schema;
    const schemaName = typeof schema === 'string' ? schema : undefined;
    const names = [config.name, normalizePolicyTable(config.name)];
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
  metadata: KovoRuntimeDbMetadata,
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

async function applyPgliteWriterTablePrivileges(
  client: PGlite,
  tables: readonly PgTable[],
): Promise<void> {
  for (const table of tables) {
    const name = quoteIdent(getTableConfig(table).name);
    await client.exec(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${name} TO ${quoteIdent(WRITER_ROLE)}`,
    );
  }
}

async function applyPgliteOwnerPolicies(
  client: PGlite,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
): Promise<void> {
  const tableNames = new Set(tables.map((table) => getTableConfig(table).name));
  for (const [tableName, owner] of metadata.ownerSourcesByTable) {
    if (!tableNames.has(tableName)) continue;
    const table = quoteIdent(tableName);
    const predicate = `${quoteIdent(owner.columnName)} = current_setting('kovo.principal', true)`;
    await client.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await client.exec(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await client.exec(`DROP POLICY IF EXISTS kovo_owner_scope ON ${table}`);
    await client.exec(
      [
        `CREATE POLICY kovo_owner_scope ON ${table}`,
        `FOR ALL TO ${quoteIdent(READER_ROLE)}, ${quoteIdent(WRITER_ROLE)}`,
        `USING (${predicate}) WITH CHECK (${predicate})`,
      ].join(' '),
    );
  }
  for (const [tableName, ownerVia] of metadata.ownerViaSourcesByTable) {
    if (!tableNames.has(tableName) || !tableNames.has(ownerVia.parentTable)) continue;
    const table = quoteIdent(tableName);
    const childFk = `${table}.${quoteIdent(ownerVia.fkColumnName)}`;
    const parentAlias = quoteIdent(`kovo_parent_${ownerVia.parentTable}`);
    const parentOwner = metadata.ownerSourcesByTable.get(ownerVia.parentTable);
    if (parentOwner === undefined) continue;
    const predicate = [
      'EXISTS (SELECT 1 FROM',
      `${quoteIdent(ownerVia.parentTable)} ${parentAlias}`,
      'WHERE',
      `${parentAlias}.${quoteIdent(ownerVia.parentKeyColumnName)} = ${childFk}`,
      'AND',
      `${parentAlias}.${quoteIdent(parentOwner.columnName)} = current_setting('kovo.principal', true))`,
    ].join(' ');
    await client.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await client.exec(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await client.exec(`DROP POLICY IF EXISTS kovo_owner_scope ON ${table}`);
    await client.exec(
      [
        `CREATE POLICY kovo_owner_scope ON ${table}`,
        `FOR ALL TO ${quoteIdent(READER_ROLE)}, ${quoteIdent(WRITER_ROLE)}`,
        `USING (${predicate}) WITH CHECK (${predicate})`,
      ].join(' '),
    );
  }
}

function postgresScopedClientOptions(principal: string | undefined): PostgresScopedClientOptions {
  const options: PostgresScopedClientOptions = { role: WRITER_ROLE };
  if (principal !== undefined) options.principal = principal;
  return options;
}

function postgresReadonlyClientOptions(
  principal: string | undefined,
  readerRole: string | false = READER_ROLE,
): PostgresReadonlyClientOptions {
  const options: PostgresReadonlyClientOptions = { readerRole };
  if (principal !== undefined) options.principal = principal;
  return options;
}

function principalFromRequest(request: unknown): string | undefined {
  const userId = (request as { session?: { user?: { id?: unknown } } } | undefined)?.session?.user
    ?.id;
  return typeof userId === 'string' && userId !== '' ? userId : undefined;
}

const appDatabase = createAppRuntimeDb();

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb;
export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/** Framework construction/auth adapter hook; do not import this into endpoint/webhook/task code. */
export function appRuntimeDbProvider(request?: unknown): AppDb {
  return appDatabase.db(request);
}
