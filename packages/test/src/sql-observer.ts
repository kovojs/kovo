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
  const observed = parseSqlOperations(statement).map(
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

/** @internal Record DB-engine writes (cascade/trigger effects) observed by row-count deltas. */
export async function observeSqlEngineSideEffects(
  target: object,
  statement: string | undefined,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  explicitOperations: readonly ObservedDbOperation[],
  before: ReadonlyMap<string, number>,
): Promise<void> {
  if (!statement || before.size === 0) return;

  const after = await tableCounts(target, Object.keys(config.domainByTable));
  const explicitWriteTables = new Set(
    explicitOperations
      .filter((operation) => operation.kind === 'write')
      .map((operation) => operation.table),
  );

  for (const [table, beforeCount] of before) {
    if (explicitWriteTables.has(table)) continue;
    if (after.get(table) === beforeCount) continue;

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

/** @internal Snapshot configured table row counts when the wrapped DB exposes a raw query handle. */
export async function tableCounts(
  target: object,
  tables: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const query = tableCountQuery(target);
  if (!query) return new Map();
  const existing = await existingTables(query);
  if (!existing) return new Map();

  const counts = new Map<string, number>();
  for (const table of tables.filter((name) => existing.has(unqualifiedTableName(name)))) {
    try {
      const rows = await query(`select count(*) as count from ${quoteSqlIdentifier(table)}`);
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
): Promise<ReadonlySet<string> | null> {
  try {
    const rows = await query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    return new Set(
      resultRows(rows).flatMap((row): string[] => {
        if (typeof row !== 'object' || row === null) return [];
        const tableName = (row as Record<string, unknown>).table_name;
        return typeof tableName === 'string' ? [tableName] : [];
      }),
    );
  } catch {
    return null;
  }
}

/**
 * @internal Whether a wrapped db exposes an *asynchronous* raw query handle
 * usable for the row-count net (SPEC.md §11.2 meta-soundness).
 *
 * The count net snapshots row counts before/after a statement across an awaited
 * boundary, so it only applies to a real async DB seam. Synchronous test doubles
 * (whose `query`/`exec` return values directly) cannot be count-netted and must
 * not have count probes dispatched into them, so they are excluded here.
 */
export function hasTableCountHandle(target: object): boolean {
  return isAsyncQueryHandle(rawQueryHandle(target));
}

function isAsyncQueryHandle(handle: unknown): boolean {
  return typeof handle === 'function' && handle.constructor?.name === 'AsyncFunction';
}

function rawQueryHandle(target: object): unknown {
  const record = target as Record<PropertyKey, unknown>;
  const pglite = record.pglite;
  if (typeof pglite === 'object' && pglite !== null) {
    const query = (pglite as Record<PropertyKey, unknown>).query;
    if (typeof query === 'function') return query;
  }
  return record.query;
}

function tableCountQuery(target: object): ((statement: string) => Promise<unknown>) | null {
  const record = target as Record<PropertyKey, unknown>;
  const pglite = record.pglite;
  if (typeof pglite === 'object' && pglite !== null) {
    const query = (pglite as Record<PropertyKey, unknown>).query;
    if (typeof query === 'function') return (statement) => query.call(pglite, statement);
  }

  if (typeof record.query === 'function') {
    return (statement) => (record.query as Function).call(target, statement);
  }

  return null;
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

function unqualifiedTableName(table: string): string {
  return table.split('.').at(-1) ?? table;
}

function quoteSqlIdentifier(identifier: string): string {
  return identifier
    .split('.')
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join('.');
}
