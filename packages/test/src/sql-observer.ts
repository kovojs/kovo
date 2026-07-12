import { parseSqlOperations } from './verifier-sql.js';
import type {
  DbVerificationConfig,
  ObservedDbOperation,
  ObservationRecorder,
} from './verifier-observation.js';
import {
  verifierApply,
  verifierArrayJoin,
  verifierArrayPush,
  verifierArraySort,
  verifierDefineProperty,
  verifierDenseArraySnapshot,
  verifierGetOwnPropertyDescriptor,
  verifierIsArray,
  verifierIsAsyncFunction,
  verifierJsonStringify,
  verifierMap,
  verifierMapForEach,
  verifierMapGet,
  verifierMapSet,
  verifierMapSize,
  verifierNullRecord,
  verifierNumber,
  verifierObjectKeys,
  verifierPromiseResolve,
  verifierReflectGet,
  verifierRegExpExec,
  verifierSet,
  verifierSetAdd,
  verifierSetHas,
  verifierStableMethod,
  verifierString,
  verifierStringReplaceAll,
  verifierStringSplit,
} from './verifier-security-intrinsics.js';

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
    const descriptor = verifierGetOwnPropertyDescriptor(record, property);
    return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function observeSqlStatement(
  statement: string,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): ObservedDbOperation[] {
  const parsed = parseSqlOperations(statement, { dialect: config.sqlDialect });
  const observed: ObservedDbOperation[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const operation = parsed[index];
    if (operation === undefined) continue;
    verifierArrayPush(observed, {
      branch: undefined,
      domain: config.domainByTable[operation.table],
      kind: operation.kind,
      mutationRead: operation.mutationRead,
      rowKey: operation.rowKey,
      sql: statement,
      table: operation.table,
    });
  }

  for (let index = 0; index < observed.length; index += 1) {
    const operation = observed[index];
    if (operation !== undefined) recorder.record(operation);
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
  if (!statement || verifierMapSize(before) === 0) return;

  const after = await tableObservationSnapshots(
    target,
    verifierObjectKeys(config.domainByTable),
    config.sqlDialect,
  );
  recordSqlEngineSideEffects(statement, config, recorder, explicitOperations, before, after);
}

/** @internal Synchronous variant for better-sqlite3-style prepared execution. */
export function observeSqlEngineSideEffectsSync(
  target: object,
  statement: string | undefined,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  explicitOperations: readonly ObservedDbOperation[],
  before: ReadonlyMap<string, TableObservationSnapshot>,
): void {
  if (!statement || verifierMapSize(before) === 0) return;

  const after = tableObservationSnapshotsSync(
    target,
    verifierObjectKeys(config.domainByTable),
    config.sqlDialect,
  );
  if (after === null) return;

  recordSqlEngineSideEffects(statement, config, recorder, explicitOperations, before, after);
}

function recordSqlEngineSideEffects(
  statement: string,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  explicitOperations: readonly ObservedDbOperation[],
  before: ReadonlyMap<string, TableObservationSnapshot>,
  after: ReadonlyMap<string, TableObservationSnapshot>,
): void {
  const explicitWriteTables = verifierSet<string>();
  for (let index = 0; index < explicitOperations.length; index += 1) {
    const operation = explicitOperations[index];
    if (operation?.kind === 'write') verifierSetAdd(explicitWriteTables, operation.table);
  }

  verifierMapForEach(before, (beforeSnapshot, table) => {
    if (verifierSetHas(explicitWriteTables, table)) return;
    const afterSnapshot = verifierMapGet(after, table);
    if (
      afterSnapshot?.count === beforeSnapshot.count &&
      afterSnapshot.fingerprint === beforeSnapshot.fingerprint
    ) {
      return;
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
  });
}

/** @internal Snapshot configured table contents when the wrapped DB exposes a raw query handle. */
export async function tableObservationSnapshots(
  target: object,
  tables: readonly string[],
  sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): Promise<ReadonlyMap<string, TableObservationSnapshot>> {
  const query = tableCountQuery(target, sqlDialect);
  if (!query) return verifierMap();
  const existing = await existingTables(query, sqlDialect);
  if (!existing) return verifierMap();

  const snapshots = verifierMap<string, TableObservationSnapshot>();
  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index];
    if (table === undefined || !verifierSetHas(existing, unqualifiedTableName(table))) continue;
    try {
      const rows = resultRows(
        await query(`select * from ${quoteSqlIdentifier(table, sqlDialect)}`),
      );
      verifierMapSet(snapshots, table, {
        count: rows.length,
        fingerprint: stableRowsFingerprint(rows),
      });
    } catch {
      // Missing tables or adapter-specific snapshot failures should not block the user's query.
    }
  }
  return snapshots;
}

/** @internal Synchronously snapshot configured table contents when supported by the adapter. */
export function tableObservationSnapshotsSync(
  target: object,
  tables: readonly string[],
  sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): ReadonlyMap<string, TableObservationSnapshot> | null {
  const query = tableCountQuerySync(target, sqlDialect);
  if (!query) return null;
  const existing = existingTablesSync(query, sqlDialect);
  if (!existing) return verifierMap();

  const snapshots = verifierMap<string, TableObservationSnapshot>();
  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index];
    if (table === undefined || !verifierSetHas(existing, unqualifiedTableName(table))) continue;
    try {
      const rows = resultRows(query(`select * from ${quoteSqlIdentifier(table, sqlDialect)}`));
      verifierMapSet(snapshots, table, {
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
  if (!query) return verifierMap();
  const existing = await existingTables(query, sqlDialect);
  if (!existing) return verifierMap();

  const counts = verifierMap<string, number>();
  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index];
    if (table === undefined || !verifierSetHas(existing, unqualifiedTableName(table))) continue;
    try {
      const rows = await query(
        `select count(*) as count from ${quoteSqlIdentifier(table, sqlDialect)}`,
      );
      const count = countValue(rows);
      if (count !== undefined) verifierMapSet(counts, table, count);
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
    return tableNamesFromRows(resultRows(rows), column);
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
  _sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): ((statement: string) => Promise<unknown>) | null {
  const record = target as Record<PropertyKey, unknown>;
  const pglite = optionalPropertyValue(record, 'pglite');
  if (typeof pglite === 'object' && pglite !== null) {
    const query = optionalStableMethod(pglite, 'query');
    if (query !== undefined) {
      return (statement) => verifierPromiseResolve(verifierApply(query, pglite, [statement]));
    }
  }

  const prepare = optionalStableMethod(record, 'prepare');
  if (prepare !== undefined) {
    return (statement) => {
      const prepared = verifierApply<unknown>(prepare, target, [statement]);
      if (typeof prepared !== 'object' || prepared === null) return verifierPromiseResolve([]);
      const all = optionalStableMethod(prepared, 'all');
      if (all === undefined) return verifierPromiseResolve([]);
      return verifierPromiseResolve(verifierApply(all, prepared, []));
    };
  }

  const query = optionalStableMethod(record, 'query');
  if (query !== undefined && (verifierIsAsyncFunction(query) || _sqlDialect === 'sqlite')) {
    return (statement) => verifierPromiseResolve(verifierApply(query, target, [statement]));
  }

  return null;
}

function tableCountQuerySync(
  target: object,
  sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): ((statement: string) => unknown) | null {
  const record = target as Record<PropertyKey, unknown>;

  const prepare = optionalStableMethod(record, 'prepare');
  if (prepare !== undefined) {
    return (statement) => {
      const prepared = verifierApply<unknown>(prepare, target, [statement]);
      if (typeof prepared !== 'object' || prepared === null) return [];
      const all = optionalStableMethod(prepared, 'all');
      return all === undefined ? [] : verifierApply(all, prepared, []);
    };
  }

  const query = optionalStableMethod(record, 'query');
  if (sqlDialect === 'sqlite' && query !== undefined) {
    return (statement) => verifierApply(query, target, [statement]);
  }

  return null;
}

function existingTablesSync(
  query: (statement: string) => unknown,
  sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): ReadonlySet<string> | null {
  try {
    const rows = query(tableDiscoverySql(sqlDialect));
    const column = sqlDialect === 'sqlite' ? 'name' : 'table_name';
    return tableNamesFromRows(resultRows(rows), column);
  } catch {
    return null;
  }
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

  const descriptor = verifierGetOwnPropertyDescriptor(row, 'count');
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  const value = descriptor.value;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return verifierNumber(value);
  if (typeof value === 'string' && verifierRegExpExec(/^\d+$/, value) !== null) {
    return verifierNumber(value);
  }
  return undefined;
}

function resultRows(result: unknown): readonly unknown[] {
  let rows: unknown = result;
  if (!verifierIsArray(rows) && typeof result === 'object' && result !== null) {
    const descriptor = verifierGetOwnPropertyDescriptor(result, 'rows');
    rows = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  }
  if (!verifierIsArray(rows)) return [];
  return verifierDenseArraySnapshot(rows, 'SQL observation rows', (row) => row);
}

function stableRowsFingerprint(rows: readonly unknown[]): string {
  const fingerprints: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    verifierArrayPush(fingerprints, verifierJsonStringify(stableJsonValue(row)) ?? 'undefined');
  }
  verifierArraySort(fingerprints, compareStrings);
  return verifierJsonStringify(fingerprints) ?? '[]';
}

function stableJsonValue(value: unknown): unknown {
  if (verifierIsArray(value)) {
    return verifierDenseArraySnapshot(value, 'SQL observation row array', (entry) =>
      stableJsonValue(entry),
    );
  }
  if (typeof value === 'bigint') return verifierString(value);
  if (typeof value !== 'object' || value === null) return value;

  const keys = verifierObjectKeys(value);
  verifierArraySort(keys, compareStrings);
  const snapshot = verifierNullRecord<unknown>();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const descriptor = verifierGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`SQL observation row ${key} must be an enumerable own data property.`);
    }
    verifierDefineProperty(snapshot, key, {
      enumerable: true,
      value: stableJsonValue(descriptor.value),
    });
  }
  return snapshot;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unqualifiedTableName(table: string): string {
  const parts = verifierStringSplit(table, '.');
  return parts[parts.length - 1] ?? table;
}

function quoteSqlIdentifier(
  identifier: string,
  _sqlDialect: DbVerificationConfig['sqlDialect'] = 'postgres',
): string {
  const parts = verifierStringSplit(identifier, '.');
  const quoted: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part !== undefined) {
      verifierArrayPush(quoted, `"${verifierStringReplaceAll(part, '"', '""')}"`);
    }
  }
  return verifierArrayJoin(quoted, '.');
}

function optionalPropertyValue(record: object, property: PropertyKey): unknown {
  try {
    return verifierReflectGet(record, property, record);
  } catch {
    return undefined;
  }
}

function optionalStableMethod(record: object, property: PropertyKey): Function | undefined {
  try {
    return verifierStableMethod(record, property);
  } catch {
    return undefined;
  }
}

function tableNamesFromRows(rows: readonly unknown[], column: string): ReadonlySet<string> {
  const tables = verifierSet<string>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (typeof row !== 'object' || row === null) continue;
    const descriptor = verifierGetOwnPropertyDescriptor(row, column);
    if (descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string') {
      verifierSetAdd(tables, descriptor.value);
    }
  }
  return tables;
}
