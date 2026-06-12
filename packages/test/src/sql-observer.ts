import { parseSqlOperations } from './verifier-sql.js';
import type { DbVerificationConfig, ObservationRecorder } from './verifier-observation.js';

export function observeSqlStatementIfString(
  statement: unknown,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): void {
  if (typeof statement !== 'string') return;
  try {
    observeSqlStatement(statement, config, recorder);
  } catch {
    // SPEC.md §11.2: instrumentation verifies observed SQL, but must not prevent
    // the user's database method from receiving adapter-specific statements.
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
