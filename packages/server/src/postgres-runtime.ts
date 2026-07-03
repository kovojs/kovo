import { createHash } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { extractKovoRuntimeDbMetadata, type KovoRuntimeDbMetadata } from '@kovojs/drizzle';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { Pool, type PoolClient, type PoolConfig, type QueryConfig, type QueryResultRow } from 'pg';

import {
  createAuthorizationCensusDb,
  createDeclaredWriteDb,
  createPostgresReadonlyClient,
  createPostgresScopedClient,
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  readonlyDb,
  type PostgresReadonlyClientOptions,
  type PostgresScopedClientOptions,
  type Reader,
} from './managed-db.js';
import { createSecretBoxingReadDb } from './secret-read-boundary.js';

const DEFAULT_DATA_DIR = '.kovo/pglite';
const DEFAULT_READER_ROLE = 'kovo_reader';
const DEFAULT_WRITER_ROLE = 'kovo_writer';
const SCHEMA_STATE_TABLE = 'kovo_schema_state';

type PgTableConfig = ReturnType<typeof getTableConfig>;
type PgTable = Parameters<typeof getTableConfig>[0];
type PgColumn = PgTableConfig['columns'][number];
type PgForeignKey = PgTableConfig['foreignKeys'][number];

interface DeclaredWritePolicy {
  tables?: readonly string[];
  touches?: readonly string[];
}

interface RuntimeTransactionClient {
  exec(statement: string): Promise<unknown>;
  query<Row extends QueryResultRow = QueryResultRow>(
    query: string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

interface RuntimeSqlClient extends RuntimeTransactionClient {
  transaction<Result>(callback: (tx: RuntimeTransactionClient) => Promise<Result>): Promise<Result>;
}

interface ResolvedPostgresRuntimeConfig {
  dataDir: string;
  databaseUrl?: string;
  driver: KovoPostgresResolvedRuntimeDriver;
  postureCheckOnBoot: boolean;
  principalFromRequest: (request: unknown) => string | undefined;
  provisionOnBoot: boolean;
  readerRole: string;
  schema: Record<string, unknown>;
  seedSql: readonly string[];
  writerRole: string;
}

interface CreatedRuntimeClient {
  close(): Promise<void>;
  drizzleInternalDb(): KovoPostgresRuntimeDb;
  drizzleReadonlyDb(principal: string | undefined, useReaderRole: boolean): KovoPostgresRuntimeDb;
  drizzleRequestDb(principal: string | undefined): KovoPostgresRuntimeDb;
  sql: RuntimeSqlClient;
  label: string;
}

/** Concrete Postgres runtime driver selected after config/env resolution. */
export type KovoPostgresResolvedRuntimeDriver = 'node-postgres' | 'pglite';

/** Driver selector accepted by the generated app Postgres runtime. */
export type KovoPostgresRuntimeDriver = KovoPostgresResolvedRuntimeDriver | 'pg';

/** Drizzle database handle shape returned by the generated Postgres app runtime. */
export type KovoPostgresRuntimeDb = PgliteDatabase | NodePgDatabase;

/** Configuration accepted by the generated app Postgres runtime helper. */
export interface KovoPostgresAppRuntimeOptions {
  /**
   * The app schema module, usually `import * as schema from '../schema.js'`.
   * The runtime derives Postgres tables, DDL, RLS policies, and metadata from it.
   */
  schema: Record<string, unknown>;
  /** Override the persistent PGlite directory. Defaults to `KOVO_DATA_DIR` or `.kovo/pglite`. */
  dataDir?: string;
  /** Override the external Postgres URL. Defaults to `KOVO_DATABASE_URL`. */
  databaseUrl?: string;
  /** Force the driver. Defaults to external Postgres when a database URL is present, PGlite otherwise. */
  driver?: KovoPostgresRuntimeDriver;
  /**
   * Run privileged provisioning during app boot. Defaults to true for PGlite and false for
   * external Postgres so production boot does not perform DDL/grants.
   */
  provisionOnBoot?: boolean;
  /**
   * Check schema/RLS/grant posture during app boot. Defaults to true for external Postgres and
   * false for PGlite because the default PGlite path provisions in-process first.
   */
  postureCheckOnBoot?: boolean;
  principalFromRequest?: (request: unknown) => string | undefined;
  readerRole?: string;
  seedSql?: string | readonly string[];
  writerRole?: string;
}

/** Created app database runtime used by generated `src/_kovo/app-runtime-db.ts` modules. */
export interface KovoPostgresAppRuntimeDb {
  db(request?: unknown): KovoPostgresRuntimeDb;
  readonlyDb: Reader<KovoPostgresRuntimeDb>;
  ready: Promise<void>;
  close(): Promise<void>;
}

/** Privileged external Postgres provisioning options for the app schema. */
export interface KovoPostgresProvisionOptions extends KovoPostgresAppRuntimeOptions {
  /**
   * Force a connection string for provisioning. This must be a privileged owner/admin connection
   * for external Postgres.
   */
  databaseUrl: string;
}

/** One failing Postgres schema/RLS/grant posture check. */
export interface KovoPostgresPostureIssue {
  code: string;
  detail: string;
}

/** Result of checking an existing Postgres database against the app schema posture. */
export interface KovoPostgresPostureReport {
  driver: KovoPostgresResolvedRuntimeDriver;
  fingerprint: string;
  ok: boolean;
  issues: readonly KovoPostgresPostureIssue[];
}

/**
 * Framework-owned Postgres runtime wiring for generated apps (SPEC §10.3).
 *
 * The default no-env path keeps the technical-preview PGlite developer database. Setting
 * `KOVO_DATABASE_URL` switches to an external Postgres pool whose boot path checks existing
 * posture but does not create roles, tables, policies, or grants.
 */
export function createPostgresAppRuntimeDb(
  options: KovoPostgresAppRuntimeOptions,
): KovoPostgresAppRuntimeDb {
  const config = resolvePostgresRuntimeConfig(options);
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = extractKovoRuntimeDbMetadata(schemaTables);
  const ddl = schemaDdl(schemaTables);
  const fingerprint = schemaFingerprint(schemaTables, metadata);
  const client = createRuntimeClient(config);
  const ready = initializeRuntimeDb(client.sql, {
    config,
    fingerprint,
    metadata,
    schemaDdl: ddl,
    schemaTables,
  });

  return {
    db(request?: unknown) {
      if (request === undefined) return client.drizzleInternalDb();
      return createRequestScopedDb(
        client.drizzleRequestDb(config.principalFromRequest(request)),
        client,
        config,
        metadata,
      );
    },
    readonlyDb: createRequestScopedReadonlyDb(client, config, metadata),
    ready,
    close: () => client.close(),
  };
}

/**
 * Privileged provisioner for an external Postgres database. Run this from the CLI or deployment
 * setup, not from ordinary app boot (SPEC §10.3).
 */
export async function provisionPostgresAppDb(
  options: KovoPostgresProvisionOptions,
): Promise<KovoPostgresPostureReport> {
  const config = resolvePostgresRuntimeConfig({
    ...options,
    driver: 'node-postgres',
    postureCheckOnBoot: false,
    provisionOnBoot: true,
  });
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = extractKovoRuntimeDbMetadata(schemaTables);
  const fingerprint = schemaFingerprint(schemaTables, metadata);
  const client = createRuntimeClient(config);
  try {
    await provisionRuntimeDb(client.sql, {
      config,
      fingerprint,
      metadata,
      schemaDdl: schemaDdl(schemaTables),
      schemaTables,
    });
    return await checkRuntimeDbPosture(client.sql, {
      config,
      fingerprint,
      metadata,
      schemaTables,
    });
  } finally {
    await client.close();
  }
}

/**
 * Check that an existing external Postgres database has the schema fingerprint and owner/RLS
 * posture Kovo expects. This is the boot-time fail-closed check for managed Postgres.
 */
export async function checkPostgresAppDbPosture(
  options: KovoPostgresAppRuntimeOptions,
): Promise<KovoPostgresPostureReport> {
  const config = resolvePostgresRuntimeConfig({
    ...options,
    driver: options.driver ?? 'node-postgres',
    provisionOnBoot: false,
  });
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = extractKovoRuntimeDbMetadata(schemaTables);
  const client = createRuntimeClient(config);
  try {
    return await checkRuntimeDbPosture(client.sql, {
      config,
      fingerprint: schemaFingerprint(schemaTables, metadata),
      metadata,
      schemaTables,
    });
  } finally {
    await client.close();
  }
}

async function initializeRuntimeDb(
  client: RuntimeSqlClient,
  input: {
    config: ResolvedPostgresRuntimeConfig;
    fingerprint: string;
    metadata: KovoRuntimeDbMetadata;
    schemaDdl: string;
    schemaTables: readonly PgTable[];
  },
): Promise<void> {
  if (input.config.provisionOnBoot) {
    await provisionRuntimeDb(client, input);
  }
  if (input.config.postureCheckOnBoot) {
    const report = await checkRuntimeDbPosture(client, input);
    if (!report.ok) {
      throw new Error(
        [
          'KV433: Postgres app database posture check failed during boot (SPEC §10.3).',
          ...report.issues.map((issue) => `  ${issue.code}: ${issue.detail}`),
        ].join('\n'),
      );
    }
  }
}

async function provisionRuntimeDb(
  client: RuntimeSqlClient,
  input: {
    config: ResolvedPostgresRuntimeConfig;
    fingerprint: string;
    metadata: KovoRuntimeDbMetadata;
    schemaDdl: string;
    schemaTables: readonly PgTable[];
  },
): Promise<void> {
  await ensurePostgresRole(client, input.config.readerRole);
  await ensurePostgresRole(client, input.config.writerRole);
  await client.exec(input.schemaDdl);
  await client.exec(
    'REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) FROM PUBLIC',
  );
  await applyPostgresOwnerPolicies(client, input.schemaTables, input.metadata, input.config);
  await applyPostgresReaderColumnPrivileges(
    client,
    input.schemaTables,
    input.metadata,
    input.config,
  );
  await applyPostgresWriterTablePrivileges(
    client,
    input.schemaTables,
    input.metadata,
    input.config,
  );
  await persistSchemaFingerprint(client, input.fingerprint);
  for (const statement of input.config.seedSql) await client.exec(statement);
}

async function checkRuntimeDbPosture(
  client: RuntimeSqlClient,
  input: {
    config: ResolvedPostgresRuntimeConfig;
    fingerprint: string;
    metadata: KovoRuntimeDbMetadata;
    schemaTables: readonly PgTable[];
  },
): Promise<KovoPostgresPostureReport> {
  const issues: KovoPostgresPostureIssue[] = [];
  const state = await safeQuery<{ value: string }>(
    client,
    `SELECT value FROM ${quoteIdent(SCHEMA_STATE_TABLE)} WHERE key = $1`,
    ['fingerprint'],
  );
  if (state === undefined || state.rows[0]?.value !== input.fingerprint) {
    issues.push({
      code: 'KV433_SCHEMA_FINGERPRINT',
      detail: `expected schema fingerprint ${input.fingerprint}`,
    });
  }

  for (const [tableName, owner] of input.metadata.ownerSourcesByTable) {
    const rls = await safeQuery<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
      client,
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1',
      [tableName],
    );
    const row = rls?.rows[0];
    if (row?.relrowsecurity !== true || row.relforcerowsecurity !== true) {
      issues.push({
        code: 'KV433_FORCE_RLS',
        detail: `${tableName} must have row-level security enabled and forced`,
      });
    }
    const policy = await safeQuery(
      client,
      'SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = $2',
      [tableName, 'kovo_owner_scope'],
    );
    if ((policy?.rows.length ?? 0) === 0) {
      issues.push({
        code: 'KV433_OWNER_POLICY',
        detail: `${tableName} is missing kovo_owner_scope for ${owner.columnName}`,
      });
    }
  }

  for (const [tableName, ownerVia] of input.metadata.ownerViaSourcesByTable) {
    const policy = await safeQuery(
      client,
      'SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = $2',
      [tableName, 'kovo_owner_scope'],
    );
    if ((policy?.rows.length ?? 0) === 0) {
      issues.push({
        code: 'KV433_OWNER_VIA_POLICY',
        detail: `${tableName} is missing owner-via policy through ${ownerVia.parentTable}`,
      });
    }
  }

  for (const table of input.schemaTables) {
    const tableName = getTableConfig(table).name;
    const secretColumns = input.metadata.secretColumnNamesByTable.get(tableName) ?? new Set();
    for (const column of secretColumns) {
      const grant = await safeQuery(
        client,
        [
          'SELECT 1 FROM information_schema.column_privileges',
          'WHERE table_name = $1 AND column_name = $2 AND grantee = $3 AND privilege_type = $4',
        ].join(' '),
        [tableName, column, input.config.readerRole, 'SELECT'],
      );
      if ((grant?.rows.length ?? 0) > 0) {
        issues.push({
          code: 'KV435_SECRET_COLUMN_GRANT',
          detail: `${input.config.readerRole} must not have SELECT on ${tableName}.${column}`,
        });
      }
    }
  }

  return {
    driver: input.config.driver,
    fingerprint: input.fingerprint,
    issues,
    ok: issues.length === 0,
  };
}

function createRuntimeClient(config: ResolvedPostgresRuntimeConfig): CreatedRuntimeClient {
  if (config.driver === 'pglite') {
    const client = new PGlite(config.dataDir);
    return {
      close: () => client.close(),
      drizzleInternalDb: () => drizzlePglite({ client }),
      drizzleReadonlyDb: (principal, useReaderRole) =>
        drizzlePglite({
          client: createPostgresReadonlyClient(
            client,
            postgresReadonlyClientOptions(config, principal, useReaderRole),
          ),
        }),
      drizzleRequestDb: (principal) =>
        drizzlePglite({
          client: createPostgresScopedClient(
            client,
            postgresScopedClientOptions(config, principal),
          ),
        }),
      label: 'PGlite',
      sql: client,
    };
  }

  const pool = new Pool({ connectionString: config.databaseUrl } satisfies PoolConfig);
  const transactionalClient = new NodePostgresRuntimeClient(pool);
  return {
    close: () => transactionalClient.close(),
    drizzleInternalDb: () => drizzleNodePg({ client: pool }),
    drizzleReadonlyDb: (principal, useReaderRole) =>
      drizzleNodePg({
        client: createPostgresReadonlyClient(
          transactionalClient,
          postgresReadonlyClientOptions(config, principal, useReaderRole),
        ) as unknown as Pool,
      }),
    drizzleRequestDb: (principal) =>
      drizzleNodePg({
        client: createPostgresScopedClient(
          transactionalClient,
          postgresScopedClientOptions(config, principal),
        ) as unknown as Pool,
      }),
    label: 'Postgres',
    sql: transactionalClient,
  };
}

function createRequestScopedDb(
  db: KovoPostgresRuntimeDb,
  client: CreatedRuntimeClient,
  config: ResolvedPostgresRuntimeConfig,
  metadata: KovoRuntimeDbMetadata,
): KovoPostgresRuntimeDb {
  const governedDb = createAuthorizationCensusDb(db, {
    dialectLabel: client.label,
    metadata,
    normalizeTableName: normalizePolicyTable,
    tableNames: pgTablePolicyNames,
  });
  Object.defineProperty(governedDb, kovoReadonlyDbHandle, {
    configurable: true,
    value: () => createRequestScopedReadonlyDb(client, config, metadata),
  });
  Object.defineProperty(governedDb, kovoDeclaredWriteDbHandle, {
    configurable: true,
    value: (policy: DeclaredWritePolicy) =>
      createDeclaredWriteDb(governedDb, policy, {
        dialectLabel: client.label,
        governedColumns: metadata,
        normalizeTableName: normalizePolicyTable,
        tableNames: pgTablePolicyNames,
      }),
  });
  return governedDb;
}

function createRequestScopedReadonlyDb(
  client: CreatedRuntimeClient,
  config: ResolvedPostgresRuntimeConfig,
  metadata: KovoRuntimeDbMetadata,
  principal?: string,
): Reader<KovoPostgresRuntimeDb> {
  const readDb = client.drizzleReadonlyDb(principal, true);
  const privilegedReadDb = client.drizzleReadonlyDb(principal, false);
  return createSecretBoxingReadDb(readonlyDb(readDb), metadata, {
    privilegedDb: readonlyDb(privilegedReadDb),
    rawSecretTableRead: 'engine',
  });
}

class NodePostgresRuntimeClient implements RuntimeSqlClient {
  constructor(private readonly pool: Pool) {}

  async close(): Promise<void> {
    await this.pool.end();
  }

  async exec(statement: string): Promise<unknown> {
    return this.pool.query(statement);
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    query: QueryConfig | string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }> {
    const result = await this.pool.query<Row>(query as QueryConfig, params);
    return { rows: result.rows };
  }

  async transaction<Result>(
    callback: (tx: RuntimeTransactionClient) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();
    const tx = new NodePostgresTransactionClient(client);
    try {
      await client.query('BEGIN');
      const result = await callback(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

class NodePostgresTransactionClient implements RuntimeSqlClient {
  constructor(private readonly client: PoolClient) {}

  async exec(statement: string): Promise<unknown> {
    return this.client.query(statement);
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    query: QueryConfig | string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }> {
    const result = await this.client.query<Row>(query as QueryConfig, params);
    return { rows: result.rows };
  }

  async transaction<Result>(
    callback: (tx: RuntimeTransactionClient) => Promise<Result>,
  ): Promise<Result> {
    const savepoint = `kovo_sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    await this.client.query(`SAVEPOINT ${quoteIdent(savepoint)}`);
    try {
      const result = await callback(this);
      await this.client.query(`RELEASE SAVEPOINT ${quoteIdent(savepoint)}`);
      return result;
    } catch (error) {
      await this.client
        .query(`ROLLBACK TO SAVEPOINT ${quoteIdent(savepoint)}`)
        .catch(() => undefined);
      throw error;
    }
  }
}

function resolvePostgresRuntimeConfig(
  options: KovoPostgresAppRuntimeOptions,
): ResolvedPostgresRuntimeConfig {
  const driver = resolveDriver(options);
  const databaseUrl = options.databaseUrl ?? process.env.KOVO_DATABASE_URL;
  const config: ResolvedPostgresRuntimeConfig = {
    dataDir: options.dataDir ?? process.env.KOVO_DATA_DIR ?? DEFAULT_DATA_DIR,
    driver,
    postureCheckOnBoot:
      options.postureCheckOnBoot ??
      (driver === 'node-postgres' && options.provisionOnBoot !== true),
    principalFromRequest: options.principalFromRequest ?? principalFromRequest,
    provisionOnBoot: options.provisionOnBoot ?? driver === 'pglite',
    readerRole: options.readerRole ?? DEFAULT_READER_ROLE,
    schema: options.schema,
    seedSql: normalizeSeedSql(options.seedSql),
    writerRole: options.writerRole ?? DEFAULT_WRITER_ROLE,
  };
  if (databaseUrl !== undefined) return { ...config, databaseUrl };
  return config;
}

function resolveDriver(options: KovoPostgresAppRuntimeOptions): KovoPostgresResolvedRuntimeDriver {
  const rawDriver = options.driver ?? process.env.KOVO_DB_DRIVER;
  if (rawDriver === 'pglite') return 'pglite';
  if (rawDriver === 'node-postgres' || rawDriver === 'pg') return 'node-postgres';
  if (rawDriver !== undefined && rawDriver !== '') {
    throw new Error(`KV433: unsupported Kovo Postgres driver ${rawDriver}.`);
  }
  return options.databaseUrl !== undefined || process.env.KOVO_DATABASE_URL
    ? 'node-postgres'
    : 'pglite';
}

function normalizeSeedSql(seedSql: string | readonly string[] | undefined): readonly string[] {
  if (seedSql === undefined) return [];
  return typeof seedSql === 'string' ? [seedSql] : seedSql;
}

function postgresTablesFromSchema(schema: Record<string, unknown>): PgTable[] {
  const tables: PgTable[] = [];
  const seen = new Set<unknown>();
  for (const value of Object.values(schema)) {
    if (seen.has(value)) continue;
    const table = asPgTable(value);
    if (table === undefined) continue;
    tables.push(table);
    seen.add(value);
  }
  if (tables.length === 0) {
    throw new Error('KV433: Postgres runtime could not derive any Drizzle pgTable exports.');
  }
  return tables;
}

function asPgTable(value: unknown): PgTable | undefined {
  try {
    getTableConfig(value as PgTable);
    return value as PgTable;
  } catch {
    return undefined;
  }
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
  return `CREATE TABLE IF NOT EXISTS ${quoteTable(config)} (${definitions.join(', ')});`;
}

function addColumnDdl(table: PgTable, column: PgColumn): string {
  return `ALTER TABLE ${quoteTable(getTableConfig(table))} ADD COLUMN IF NOT EXISTS ${columnDdl(
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
      throw new Error(`KV433: unsupported Postgres starter column type ${column.columnType}.`);
  }
}

function columnDefaultDdl(column: PgColumn): string {
  if (!column.hasDefault) return '';
  if (column.columnType === 'PgSerial') return '';
  if (column.columnType === 'PgTimestamp') return 'DEFAULT now()';
  if (typeof column.default === 'boolean') return `DEFAULT ${column.default ? 'true' : 'false'}`;
  if (typeof column.default === 'number') return `DEFAULT ${column.default}`;
  if (typeof column.default === 'string') return `DEFAULT ${quoteLiteral(column.default)}`;
  throw new Error(`KV433: unsupported Postgres starter default for ${column.name}.`);
}

function foreignKeyDdl(foreignKey: PgForeignKey): string {
  const reference = foreignKey.reference();
  const columns = reference.columns.map((column) => quoteIdent(column.name)).join(', ');
  const foreignColumns = reference.foreignColumns
    .map((column) => quoteIdent(column.name))
    .join(', ');
  const onDelete = foreignKey.onDelete === 'no action' ? '' : ` ON DELETE ${foreignKey.onDelete}`;
  const onUpdate = foreignKey.onUpdate === 'no action' ? '' : ` ON UPDATE ${foreignKey.onUpdate}`;
  return `FOREIGN KEY (${columns}) REFERENCES ${quoteTable(
    getTableConfig(reference.foreignTable),
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
      throw new Error(`KV433: cannot order Postgres tables with cyclic foreign keys: ${names}.`);
    }
  }

  return sorted;
}

async function ensurePostgresRole(client: RuntimeSqlClient, role: string): Promise<void> {
  const result = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (result.rows.length === 0) await client.exec(`CREATE ROLE ${quoteIdent(role)}`);
}

async function applyPostgresReaderColumnPrivileges(
  client: RuntimeSqlClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const readableTables = postgresReaderReadableTableNames(metadata);
  for (const table of tables) {
    const tableConfig = getTableConfig(table);
    const secretColumns =
      metadata.secretColumnNamesByTable.get(tableConfig.name) ?? new Set<string>();
    const publicColumns = tableConfig.columns
      .map((column) => column.name)
      .filter((column) => !secretColumns.has(column));
    await client.exec(`REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM PUBLIC`);
    await client.exec(
      `REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM ${quoteIdent(config.readerRole)}`,
    );
    if (readableTables.has(tableConfig.name) && publicColumns.length > 0) {
      await client.exec(
        `GRANT SELECT (${publicColumns.map(quoteIdent).join(', ')}) ON TABLE ${quoteTable(
          tableConfig,
        )} TO ${quoteIdent(config.readerRole)}`,
      );
    }
  }
}

function postgresReaderReadableTableNames(metadata: KovoRuntimeDbMetadata): ReadonlySet<string> {
  const readableTables = new Set<string>();
  for (const tableName of metadata.ownerSourcesByTable.keys()) readableTables.add(tableName);
  for (const tableName of metadata.ownerViaSourcesByTable.keys()) readableTables.add(tableName);
  for (const [tableName, classifications] of metadata.authorizationClassificationsByTable) {
    if (
      classifications.some(
        (classification) =>
          classification === 'authzPolicy' ||
          classification === 'owned' ||
          classification === 'ownedVia' ||
          classification === 'public' ||
          classification === 'reference',
      )
    ) {
      readableTables.add(tableName);
    }
  }
  return readableTables;
}

async function applyPostgresWriterTablePrivileges(
  client: RuntimeSqlClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const writableTables = postgresWriterWritableTableNames(metadata);
  for (const table of tables) {
    const tableConfig = getTableConfig(table);
    await client.exec(
      `REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM ${quoteIdent(config.writerRole)}`,
    );
    if (writableTables.has(tableConfig.name)) {
      await client.exec(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${quoteTable(tableConfig)} TO ${quoteIdent(
          config.writerRole,
        )}`,
      );
    }
  }
}

function postgresWriterWritableTableNames(metadata: KovoRuntimeDbMetadata): ReadonlySet<string> {
  const writableTables = new Set<string>();
  for (const tableName of metadata.ownerSourcesByTable.keys()) writableTables.add(tableName);
  for (const tableName of metadata.ownerViaSourcesByTable.keys()) writableTables.add(tableName);
  for (const [tableName, classifications] of metadata.authorizationClassificationsByTable) {
    if (classifications.includes('authzPolicy')) writableTables.add(tableName);
  }
  return writableTables;
}

async function applyPostgresOwnerPolicies(
  client: RuntimeSqlClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
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
        `FOR ALL TO ${quoteIdent(config.readerRole)}, ${quoteIdent(config.writerRole)}`,
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
        `FOR ALL TO ${quoteIdent(config.readerRole)}, ${quoteIdent(config.writerRole)}`,
        `USING (${predicate}) WITH CHECK (${predicate})`,
      ].join(' '),
    );
  }
}

async function persistSchemaFingerprint(
  client: RuntimeSqlClient,
  fingerprint: string,
): Promise<void> {
  await client.exec(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(SCHEMA_STATE_TABLE)} (key text PRIMARY KEY, value text NOT NULL, updated_at timestamp NOT NULL DEFAULT now())`,
  );
  await client.query(
    [
      `INSERT INTO ${quoteIdent(SCHEMA_STATE_TABLE)} (key, value) VALUES ($1, $2)`,
      'ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()',
    ].join(' '),
    ['fingerprint', fingerprint],
  );
}

function schemaFingerprint(tables: readonly PgTable[], metadata: KovoRuntimeDbMetadata): string {
  const shape = tables.map((table) => {
    const config = getTableConfig(table);
    return {
      columns: config.columns.map((column) => ({
        default: column.hasDefault ? stableFingerprintValue(column.default) : '',
        name: column.name,
        notNull: column.notNull,
        primary: column.primary,
        type: column.columnType,
        unique: column.isUnique,
      })),
      foreignKeys: config.foreignKeys.map((foreignKey) => {
        const reference = foreignKey.reference();
        return {
          columns: reference.columns.map((column) => column.name),
          foreignColumns: reference.foreignColumns.map((column) => column.name),
          foreignTable: getTableConfig(reference.foreignTable).name,
          onDelete: foreignKey.onDelete,
          onUpdate: foreignKey.onUpdate,
        };
      }),
      name: config.name,
      schema: (config as { schema?: unknown }).schema,
    };
  });
  return createHash('sha256')
    .update(
      JSON.stringify({
        authorization: [...metadata.authorizationClassificationsByTable.entries()],
        owner: [...metadata.ownerSourcesByTable.entries()],
        ownerVia: [...metadata.ownerViaSourcesByTable.entries()],
        secret: [...metadata.secretColumnNamesByTable.entries()].map(([table, columns]) => [
          table,
          [...columns].sort(),
        ]),
        shape,
      }),
    )
    .digest('hex');
}

function stableFingerprintValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

async function safeQuery<Row extends QueryResultRow>(
  client: RuntimeSqlClient,
  query: string,
  params?: readonly unknown[],
): Promise<{ rows: Row[] } | undefined> {
  try {
    return await client.query<Row>(query, params === undefined ? undefined : [...params]);
  } catch {
    return undefined;
  }
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
      'KV406: Postgres declared-write fallback could not resolve a Drizzle write table (SPEC §10.3/§11.2).',
    );
  }
}

function normalizePolicyTable(table: string): string {
  return table.includes('.') ? table : `public.${table}`;
}

function postgresScopedClientOptions(
  config: ResolvedPostgresRuntimeConfig,
  principal: string | undefined,
): PostgresScopedClientOptions {
  const options: PostgresScopedClientOptions = { role: config.writerRole };
  if (principal !== undefined) options.principal = principal;
  return options;
}

function postgresReadonlyClientOptions(
  config: ResolvedPostgresRuntimeConfig,
  principal: string | undefined,
  useReaderRole: boolean,
): PostgresReadonlyClientOptions {
  const options: PostgresReadonlyClientOptions = {
    readerRole: useReaderRole ? config.readerRole : false,
  };
  if (principal !== undefined) options.principal = principal;
  return options;
}

function principalFromRequest(request: unknown): string | undefined {
  const nonRequestPrincipal = principalFromNonRequestPosture(request);
  if (nonRequestPrincipal !== undefined) return nonRequestPrincipal;
  const userId = (request as { session?: { user?: { id?: unknown } } } | undefined)?.session?.user
    ?.id;
  return typeof userId === 'string' && userId !== '' ? userId : undefined;
}

function principalFromNonRequestPosture(request: unknown): string | undefined {
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
      'System principal DB posture is not supported by the Postgres starter owner-scope provider yet (SPEC §10.3 DEC-G).',
    );
  }
  const principal = (posture as { principal?: unknown }).principal;
  return kind === 'act-as' && typeof principal === 'string' && principal.trim() === principal
    ? principal
    : undefined;
}

function quoteTable(config: PgTableConfig): string {
  const schema = (config as { schema?: unknown }).schema;
  return typeof schema === 'string' && schema !== ''
    ? `${quoteIdent(schema)}.${quoteIdent(config.name)}`
    : quoteIdent(config.name);
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
