import { parseSqlOperations } from './verifier-sql.js';
import type { DbVerificationConfig, ObservationRecorder } from './verifier-observation.js';

export function observeSqlStatementArgument(
  statement: unknown,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): void {
  const sql = sqlStatementText(statement);
  if (sql === undefined) return;
  try {
    observeSqlStatement(sql, config, recorder);
  } catch {
    // SPEC.md §11.2: instrumentation verifies observed SQL, but must not prevent
    // the user's database method from receiving adapter-specific statements.
  }
}

export function observeSqlStatementIfString(
  statement: unknown,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): void {
  observeSqlStatementArgument(statement, config, recorder);
}

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
): void {
  for (const operation of parseSqlOperations(statement)) {
    recorder.record({
      branch: undefined,
      domain: config.domainByTable[operation.table],
      kind: operation.kind,
      mutationRead: operation.mutationRead,
      rowKey: operation.rowKey,
      sql: statement,
      table: operation.table,
    });
  }
}
