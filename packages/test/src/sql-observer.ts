import { parseSqlOperations } from './verifier-sql.js';
import type {
  DbVerificationConfig,
  ObservedDbOperation,
  ObservationRecorder,
} from './verifier-observation.js';

/** @internal Observe a SQL statement argument and record its operations (SPEC.md §11.2). */
export function observeSqlStatementArgument(
  statement: unknown,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): ObservedDbOperation[] {
  const sql = sqlStatementText(statement);
  if (sql === undefined) return [];
  try {
    return observeSqlStatement(sql, config, recorder);
  } catch {
    // SPEC.md §11.2: instrumentation verifies observed SQL, but must not prevent
    // the user's database method from receiving adapter-specific statements.
    return [];
  }
}

/** @internal Extract SQL text from a statement string or `{text}`/`{sql}` carrier. */
export function sqlStatementText(statement: unknown): string | undefined {
  if (typeof statement === 'string') return statement;
  if (typeof statement !== 'object' || statement === null) return undefined;

  const record = statement as Record<PropertyKey, unknown>;
  const text = readStringProperty(record, 'text');
  if (text !== undefined) return text;

  return readStringProperty(record, 'sql');
}

function readStringProperty(
  record: Record<PropertyKey, unknown>,
  property: 'text' | 'sql',
): string | undefined {
  try {
    const value = record[property];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function observeSqlStatement(
  statement: string,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): ObservedDbOperation[] {
  const observed = parseSqlOperations(statement, { dialect: config.sqlDialect }).map(
    (operation): ObservedDbOperation => ({
      branch: undefined,
      domain: config.domainByTable[operation.table],
      kind: operation.kind,
      mutationRead: operation.mutationRead,
      rowKey: operation.rowKey,
      sql: statement,
      table: operation.table,
    }),
  );

  for (const operation of observed) {
    recorder.record(operation);
  }

  return observed;
}

interface TableObservationSnapshot {
  count: number;
  fingerprint: string;
}

/** @internal Record DB-engine writes (cascade/trigger effects) observed by table snapshots. */
export async function observeSqlEngineSideEffects(
  target: object,
  statement: string | undefined,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  explicitOperations: readonly ObservedDbOperation[],
  before: ReadonlyMap<string, TableObservationSnapshot>,
): Promise<void> {
  if (!statement || before.size === 0) return;

  const after = await tableObservationSnapshots(
    target,
    Object.keys(config.domainByTable),
    config.sqlDialect,
  );
  const explicitWriteTables = new Set(
    explicitOperations
      .filter((operation) => operation.kind === 'write')
      .map((operation) => operation.table),
  );

  for (const [table, beforeSnapshot] of before) {
    if (explicitWriteTables.has(table)) continue;
    const afterSnapshot = after.get(table);
    if (
      afterSnapshot?.count === beforeSnapshot.count &&
      afterSnapshot.fingerprint === beforeSnapshot.fingerprint
    ) {
      continue;
    }

    recorder.record({
      branch: undefined,
      domain: config.domainByTable[table],
      kind: 'write',
      mutationRead: undefined,
      rowKey: undefined,
      sql: statement,
      table,
    });
  }
}

/** @internal Snapshot configured table contents when the wrapped DB exposes a raw query handle. */
export async function tableObservationSnapshots(
  target: object,
  tables: readonly string[],
  sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): Promise<ReadonlyMap<string, TableObservationSnapshot>> {
  const query = tableCountQuery(target, sqlDialect);
  if (!query) return new Map();
  const existing = await existingTables(query, sqlDialect);
  if (!existing) return new Map();

  const snapshots = new Map<string, TableObservationSnapshot>();
  for (const table of tables.filter((name) => existing.has(unqualifiedTableName(name)))) {
    try {
      const rows = resultRows(
        await query(`select * from ${quoteSqlIdentifier(table, sqlDialect)}`),
      );
      snapshots.set(table, {
        count: rows.length,
        fingerprint: stableRowsFingerprint(rows),
      });
    } catch {
      // Missing tables or adapter-specific snapshot failures should not block the user's query.
    }
  }
  return snapshots;
}

/** @internal Snapshot configured table row counts when the wrapped DB exposes a raw query handle. */
export async function tableCounts(
  target: object,
  tables: readonly string[],
  sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): Promise<ReadonlyMap<string, number>> {
  const query = tableCountQuery(target, sqlDialect);
  if (!query) return new Map();
  const existing = await existingTables(query, sqlDialect);
  if (!existing) return new Map();

  const counts = new Map<string, number>();
  for (const table of tables.filter((name) => existing.has(unqualifiedTableName(name)))) {
    try {
      const rows = await query(
        `select count(*) as count from ${quoteSqlIdentifier(table, sqlDialect)}`,
      );
      const count = countValue(rows);
      if (count !== undefined) counts.set(table, count);
    } catch {
      // Missing tables or adapter-specific count failures should not block the user's query.
    }
  }
  return counts;
}

async function existingTables(
  query: (statement: string) => Promise<unknown>,
  sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): Promise<ReadonlySet<string> | null> {
  try {
    const rows = await query(tableDiscoverySql(sqlDialect));
    const column = sqlDialect === 'sqlite' ? 'name' : 'table_name';
    return new Set(
      resultRows(rows).flatMap((row): string[] => {
        if (typeof row !== 'object' || row === null) return [];
        const tableName = (row as Record<string, unknown>)[column];
        return typeof tableName === 'string' ? [tableName] : [];
      }),
    );
  } catch {
    return null;
  }
}

/**
 * @internal Whether a wrapped db exposes a raw query handle
 * usable for the row-count net (SPEC.md §11.2 meta-soundness).
 *
 * The count/fingerprint net snapshots configured tables before and after a
 * statement. It accepts both promise-returning handles (PGlite/Postgres) and
 * synchronous adapter methods (better-sqlite3) by normalizing query results to a
 * Promise at the boundary.
 */
export function hasTableCountHandle(
  target: object,
  sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): boolean {
  return tableCountQuery(target, sqlDialect) !== null;
}

function tableCountQuery(
  target: object,
  sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): ((statement: string) => Promise<unknown>) | null {
  const record = target as Record<PropertyKey, unknown>;
  const pglite = record.pglite;
  if (typeof pglite === 'object' && pglite !== null) {
    const query = (pglite as Record<PropertyKey, unknown>).query;
    if (typeof query === 'function') {
      return (statement) => Promise.resolve(query.call(pglite, statement));
    }
  }

  if (typeof record.prepare === 'function') {
    return (statement) => {
      const prepared = (record.prepare as Function).call(target, statement);
      if (typeof prepared !== 'object' || prepared === null) return Promise.resolve([]);
      const all = (prepared as Record<PropertyKey, unknown>).all;
      if (typeof all !== 'function') return Promise.resolve([]);
      return Promise.resolve(all.call(prepared));
    };
  }

  if (
    isAsyncFunction(record.query) ||
    (sqlDialect === 'sqlite' && typeof record.query === 'function')
  ) {
    return (statement) => Promise.resolve((record.query as Function).call(target, statement));
  }

  return null;
}

function isAsyncFunction(value: unknown): value is Function {
  return typeof value === 'function' && value.constructor.name === 'AsyncFunction';
}

function tableDiscoverySql(sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres'): string {
  if (sqlDialect === 'sqlite') {
    return "select name from sqlite_schema where type = 'table' and name not like 'sqlite_%'";
  }

  return "select table_name from information_schema.tables where table_schema = 'public'";
}

function countValue(result: unknown): number | undefined {
  const rows = resultRows(result);
  const row = rows[0];
  if (typeof row !== 'object' || row === null) return undefined;

  const value = (row as Record<string, unknown>).count;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function resultRows(result: unknown): unknown[] {
  return Array.isArray(result)
    ? result
    : typeof result === 'object' &&
        result !== null &&
        Array.isArray((result as { rows?: unknown }).rows)
      ? (result as { rows: unknown[] }).rows
      : [];
}

function stableRowsFingerprint(rows: readonly unknown[]): string {
  return JSON.stringify(
    rows.map((row) => JSON.stringify(stableJsonValue(row))).sort(compareStrings),
  );
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

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unqualifiedTableName(table: string): string {
  return table.split('.').at(-1) ?? table;
}

function quoteSqlIdentifier(
  identifier: string,
  _sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): string {
  return identifier
    .split('.')
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join('.');
}
