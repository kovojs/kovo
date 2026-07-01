export type SqlWriteOracleDialect = 'postgres' | 'sqlite';

export interface SqlWriteOracleExecutor {
  exec(statement: string): unknown;
  query(statement: string): unknown;
}

export interface SqlWriteOracleOptions {
  dialect: SqlWriteOracleDialect;
}

export interface SqlWriteOracleResult {
  before: SqlWriteOracleSnapshot;
  changed: boolean;
  after: SqlWriteOracleSnapshot;
}

interface SqlWriteOracleSnapshot {
  catalog: string;
  tables: readonly string[];
  rows: readonly [table: string, fingerprint: string][];
  metadata: readonly [key: string, value: string][];
}

/**
 * Execute a statement inside a rolled-back transaction and diff database state
 * before and after execution (DEC3 / SPEC §11.2). Tests use this as an oracle
 * for SQL write-classifier coverage; managed handles still enforce at the
 * runtime choke.
 */
export async function sqlWriteOracle(
  executor: SqlWriteOracleExecutor,
  statement: string,
  options: SqlWriteOracleOptions,
): Promise<SqlWriteOracleResult> {
  await executor.exec('begin');
  try {
    const before = await snapshotDatabase(executor, options.dialect);
    await executor.exec(statement);
    const after = await snapshotDatabase(executor, options.dialect);
    return {
      after,
      before,
      changed: snapshotFingerprint(before) !== snapshotFingerprint(after),
    };
  } finally {
    await executor.exec('rollback');
  }
}

async function snapshotDatabase(
  executor: SqlWriteOracleExecutor,
  dialect: SqlWriteOracleDialect,
): Promise<SqlWriteOracleSnapshot> {
  const catalogRows = await queryRows(executor, catalogQuery(dialect));
  const tables = catalogRows
    .filter((row) => row.type === 'table')
    .map((row) => String(row.name))
    .sort(compareStrings);
  const rows: [string, string][] = [];
  for (const table of tables) {
    rows.push([table, await tableFingerprint(executor, dialect, table)]);
  }

  return {
    catalog: stableFingerprint(catalogRows),
    metadata: await metadataSnapshot(executor, dialect),
    rows,
    tables,
  };
}

function catalogQuery(dialect: SqlWriteOracleDialect): string {
  if (dialect === 'sqlite') {
    return `
      select type, name, tbl_name as "tableName", sql
      from sqlite_schema
      where name not like 'sqlite_%'
      order by type, name
    `;
  }

  return `
    select 'table' as type, table_name as name, table_name as "tableName", table_type as sql
    from information_schema.tables
    where table_schema = 'public'
    union all
    select 'column' as type, table_name || '.' || column_name as name, table_name as "tableName",
      data_type || ':' || is_nullable || ':' || ordinal_position as sql
    from information_schema.columns
    where table_schema = 'public'
    union all
    select 'index' as type, indexname as name, tablename as "tableName", indexdef as sql
    from pg_indexes
    where schemaname = 'public'
    order by type, name
  `;
}

async function metadataSnapshot(
  executor: SqlWriteOracleExecutor,
  dialect: SqlWriteOracleDialect,
): Promise<[string, string][]> {
  if (dialect !== 'sqlite') return [];

  const rows = await queryRows(executor, 'pragma user_version');
  const userVersion = rows[0]?.user_version;
  return [['pragma:user_version', stableFingerprint(userVersion ?? '')]];
}

async function tableFingerprint(
  executor: SqlWriteOracleExecutor,
  dialect: SqlWriteOracleDialect,
  table: string,
): Promise<string> {
  try {
    const rows = await queryRows(executor, `select * from ${quoteSqlIdentifier(table, dialect)}`);
    return stableFingerprint(rows);
  } catch {
    return '<unreadable>';
  }
}

async function queryRows(
  executor: SqlWriteOracleExecutor,
  statement: string,
): Promise<Record<string, unknown>[]> {
  const result = await executor.query(statement);
  const rows = Array.isArray(result)
    ? result
    : typeof result === 'object' &&
        result !== null &&
        Array.isArray((result as { rows?: unknown }).rows)
      ? (result as { rows: unknown[] }).rows
      : [];
  return rows.filter(isRecord);
}

function snapshotFingerprint(snapshot: SqlWriteOracleSnapshot): string {
  return stableFingerprint(snapshot);
}

function stableFingerprint(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, entry]) => [key, stableJsonValue(entry)]),
  );
}

function quoteSqlIdentifier(identifier: string, _dialect: SqlWriteOracleDialect): string {
  return identifier
    .split('.')
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join('.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
