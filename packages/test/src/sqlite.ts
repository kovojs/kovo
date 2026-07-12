import { createRequire } from 'node:module';
import {
  DatabaseSync as NodeSqliteDatabaseSync,
  constants as nodeSqliteConstants,
  type StatementSync as NodeSqliteStatementSync,
} from 'node:sqlite';
import {
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  type KovoDeclaredWriteDbCapable,
  type KovoReadonlyDbCapable,
} from '@kovojs/server/internal/execution';
import { snapshotManagedSqlStatement } from '@kovojs/core/internal/sql-safety';
import {
  formatPolicyValues,
  snapshotAdapterPolicy,
  snapshotAdapterStatementCarrier,
  snapshotAdapterValues,
  snapshotRowEntries,
} from './adapter-security.js';
import {
  verifierArrayJoin,
  verifierArrayPush,
  verifierApply,
  verifierFreeze,
  verifierGetPrototypeOf,
  verifierSet,
  verifierSetAdd,
  verifierSetClear,
  verifierSetForEach,
  verifierSetHas,
  verifierSetSize,
  verifierRegExpExec,
  verifierStringIncludes,
  verifierStringReplaceAll,
  verifierStringSplit,
  verifierStableMethod,
  verifierWeakMap,
  verifierWeakMapGet,
  verifierWeakMapSet,
} from './verifier-security-intrinsics.js';

interface BetterSqliteConstructor {
  new (filename: string, options?: SqliteTestDbOptions): SqliteNativeHandle;
}

/** SQL statement object accepted by `SqliteTestDb` helpers. */
export interface SqliteStatementCarrier {
  /** SQL text, matching common driver carrier shape. */
  sql?: string;
  /** SQL text, matching common driver carrier shape. */
  text?: string;
  /** Bound statement values. */
  values?: readonly unknown[];
}

/** SQL statement input accepted by `SqliteTestDb` helpers. */
export type SqliteStatementInput = string | SqliteStatementCarrier;

/** Minimal better-sqlite3 statement handle surfaced by `SqliteTestDb.sqlite`. */
export interface SqliteNativeStatement<Row = unknown> {
  all(...params: unknown[]): Row[];
  run(...params: unknown[]): unknown;
}

/** Minimal better-sqlite3 database handle surfaced by `SqliteTestDb.sqlite`. */
export interface SqliteNativeHandle {
  close(): void;
  exec(statement: string): unknown;
  prepare<Row = unknown>(statement: string): SqliteNativeStatement<Row>;
  transaction<Callback extends (...args: never[]) => unknown>(callback: Callback): Callback;
}

/** Options passed through to the better-sqlite3 constructor used by `createSqliteTestDb()`. */
export interface SqliteTestDbOptions {
  /** Database filename. Defaults to ':memory:'. Use a real file to enable a dedicated read-only reader connection. */
  filename?: string;
  /** Require the database file to already exist before opening it. */
  fileMustExist?: boolean;
  /** Path to a custom better-sqlite3 native binding. */
  nativeBinding?: string;
  /** Open the database in read-only mode. */
  readonly?: boolean;
  /** Busy timeout in milliseconds. */
  timeout?: number;
  /** Optional SQL statement logger. */
  verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
}

/** A better-sqlite3-backed test database handle: raw SQLite plus SQL and row helpers. */
export interface SqliteTestDb {
  close(): void;
  exec(statement: SqliteStatementInput): void;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: SqliteStatementInput,
    params?: readonly unknown[],
  ): Row[];
  read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string): Row[];
  sqlite: SqliteNativeHandle;
  write(table: string, value: Record<string, unknown>): void;
}

type DeclaredWritePolicy = Parameters<
  KovoDeclaredWriteDbCapable[typeof kovoDeclaredWriteDbHandle]
>[0];
type ReadonlySqliteTestDb = Omit<SqliteTestDb, typeof kovoReadonlyDbHandle>;
type DeclaredWriteSqliteTestDb = Omit<
  SqliteTestDb,
  typeof kovoDeclaredWriteDbHandle | typeof kovoReadonlyDbHandle
>;

/**
 * Spin up an ephemeral in-process SQLite database for tests. The default driver
 * is better-sqlite3, matching the SQLite runtime slice in `plans/sqlite-support.md`.
 *
 * @param options - better-sqlite3 options.
 * @returns A ready `SqliteTestDb`.
 */
export function createSqliteTestDb(options: SqliteTestDbOptions = {}): SqliteTestDb {
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3') as BetterSqliteConstructor;
  const { filename = ':memory:', ...sqliteOptions } = options;
  const sqlite = new Database(filename, sqliteOptions);
  pinSqliteHandle(sqlite);
  pinSqliteStatement(callSqlitePrepare(sqlite, 'select 1'));
  const readonlyHandles = verifierSet<SqliteNativeHandle>();
  const declaredWriteHandles = verifierSet<SqliteNativeHandle>();
  let readonlyDb: ReadonlySqliteTestDb | null = null;

  const db: SqliteTestDb &
    KovoDeclaredWriteDbCapable<DeclaredWriteSqliteTestDb> &
    Partial<KovoReadonlyDbCapable<ReadonlySqliteTestDb>> = {
    close() {
      verifierSetForEach(readonlyHandles, (handle) => callSqliteClose(handle));
      verifierSetClear(readonlyHandles);
      verifierSetForEach(declaredWriteHandles, (handle) => callSqliteClose(handle));
      verifierSetClear(declaredWriteHandles);
      callSqliteClose(sqlite);
    },
    exec(statement) {
      callSqliteExec(sqlite, sqliteStatementText(statement));
    },
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: SqliteStatementInput,
      params: readonly unknown[] = [],
    ): Row[] {
      const carrier = sqliteStatement(statement, params);
      return callSqliteStatementAll<Row>(callSqlitePrepare(sqlite, carrier.text), carrier.values);
    },
    read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string): Row[] {
      return callSqliteStatementAll<Row>(
        callSqlitePrepare(sqlite, `select * from ${quoteSqlIdentifier(table)}`),
        [],
      );
    },
    sqlite,
    write(table, value) {
      insertSqliteRow(sqlite, table, value);
    },
    [kovoDeclaredWriteDbHandle](policy) {
      const policySnapshot = snapshotAdapterPolicy(policy, 'sqlite') as DeclaredWritePolicy;
      if (filename !== ':memory:') {
        const declaredWriteHandle = nodeSqliteDeclaredWriteHandle(filename, policySnapshot);
        verifierSetAdd(declaredWriteHandles, declaredWriteHandle);
        return declaredWriteSqliteTestDbFromHandle(declaredWriteHandle, policySnapshot);
      }

      // In-memory better-sqlite3 databases cannot share state with a second native SQLite authorizer
      // connection. Keep the residual explicit: this fallback protects parser-blind helpers only.
      return declaredWriteSqliteTestDbFromHandle(sqlite, policySnapshot);
    },
  };

  if (filename !== ':memory:') {
    db[kovoReadonlyDbHandle] = () => {
      if (readonlyDb) return readonlyDb;
      const readonlySqlite = new Database(filename, {
        ...sqliteOptions,
        fileMustExist: true,
        readonly: true,
      });
      pinSqliteHandle(readonlySqlite);
      pinSqliteStatement(callSqlitePrepare(readonlySqlite, 'select 1'));
      callSqliteExec(readonlySqlite, 'PRAGMA query_only=ON');
      verifierSetAdd(readonlyHandles, readonlySqlite);
      readonlyDb = sqliteTestDbFromHandle(readonlySqlite);
      return readonlyDb;
    };
  }

  return db;
}

class NodeSqliteDeclaredWriteError extends Error {
  constructor(policy: DeclaredWritePolicy, detail: string) {
    super(
      verifierArrayJoin(
        [
          `KV406: SQLite authorizer rejected ${detail} outside the mutation registry tables (SPEC §10.3/§11.2).`,
          `  declared tables: ${formatPolicyValues(policy.tables ?? [])}`,
          `  touches: ${formatPolicyValues(policy.touches ?? []) || '<none>'}`,
        ],
        '\n',
      ),
    );
    this.name = 'NodeSqliteDeclaredWriteError';
  }
}

class NodeSqliteAuthorizedHandle implements SqliteNativeHandle {
  #closed = false;

  constructor(
    private readonly sqlite: NodeSqliteDatabaseSync,
    private readonly policy: DeclaredWritePolicy,
  ) {}

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    callSqliteClose(this.sqlite as unknown as SqliteNativeHandle);
  }

  exec(statement: string): unknown {
    return mapNodeSqliteAuthorizerError(this.policy, () =>
      callSqliteExec(this.sqlite as unknown as SqliteNativeHandle, statement),
    );
  }

  prepare<Row = unknown>(statement: string): SqliteNativeStatement<Row> {
    return mapNodeSqliteAuthorizerError(this.policy, () => {
      const prepared = callSqlitePrepare<Row>(
        this.sqlite as unknown as SqliteNativeHandle,
        statement,
      );
      return nodeSqliteStatement<Row>(prepared as unknown as NodeSqliteStatementSync, this.policy);
    });
  }

  transaction<Callback extends (...args: never[]) => unknown>(callback: Callback): Callback {
    return ((...args: Parameters<Callback>) => {
      mapNodeSqliteAuthorizerError(this.policy, () =>
        callSqliteExec(this.sqlite as unknown as SqliteNativeHandle, 'BEGIN'),
      );
      try {
        const result = verifierApply<ReturnType<Callback>>(callback, undefined, args);
        mapNodeSqliteAuthorizerError(this.policy, () =>
          callSqliteExec(this.sqlite as unknown as SqliteNativeHandle, 'COMMIT'),
        );
        return result;
      } catch (error) {
        mapNodeSqliteAuthorizerError(this.policy, () =>
          callSqliteExec(this.sqlite as unknown as SqliteNativeHandle, 'ROLLBACK'),
        );
        throw error;
      }
    }) as Callback;
  }
}

function nodeSqliteDeclaredWriteHandle(
  filename: string,
  policy: DeclaredWritePolicy,
): SqliteNativeHandle {
  const sqlite = new NodeSqliteDatabaseSync(filename);
  pinSqliteHandle(sqlite as unknown as SqliteNativeHandle);
  pinSqliteStatement(callSqlitePrepare(sqlite as unknown as SqliteNativeHandle, 'select 1'));
  const allowedTables = verifierSet<string>();
  for (let index = 0; index < (policy.tables ?? []).length; index += 1) {
    const table = policy.tables?.[index];
    if (table !== undefined) verifierSetAdd(allowedTables, normalizePolicyTable(table, 'sqlite'));
  }
  const setAuthorizer = verifierStableMethod(sqlite, 'setAuthorizer');
  verifierApply(setAuthorizer, sqlite, [
    (
      action: number,
      objectName: string | null,
      columnName: string | null,
      databaseName: string | null,
      triggerOrView: string | null,
    ) => {
      if (
        verifierSetHas(sqliteAuthorizerDdlActions, action) ||
        action === nodeSqliteConstants.SQLITE_PRAGMA
      ) {
        return nodeSqliteConstants.SQLITE_DENY;
      }

      if (verifierSetHas(sqliteAuthorizerWriteActions, action)) {
        const table = sqliteAuthorizerTableName(databaseName, objectName);
        if (verifierSetSize(allowedTables) > 0 && verifierSetHas(allowedTables, table)) {
          return nodeSqliteConstants.SQLITE_OK;
        }
        if (isInternalSqliteTable(objectName, triggerOrView)) {
          return nodeSqliteConstants.SQLITE_OK;
        }
        return nodeSqliteConstants.SQLITE_DENY;
      }

      return nodeSqliteConstants.SQLITE_OK;
    },
  ]);

  return new NodeSqliteAuthorizedHandle(sqlite, policy);
}

const sqliteAuthorizerWriteActions = verifierSet<number>();
verifierSetAdd(sqliteAuthorizerWriteActions, nodeSqliteConstants.SQLITE_DELETE);
verifierSetAdd(sqliteAuthorizerWriteActions, nodeSqliteConstants.SQLITE_INSERT);
verifierSetAdd(sqliteAuthorizerWriteActions, nodeSqliteConstants.SQLITE_UPDATE);

const sqliteAuthorizerDdlActions = verifierSet<number>();
for (const action of [
  nodeSqliteConstants.SQLITE_ALTER_TABLE,
  nodeSqliteConstants.SQLITE_ATTACH,
  nodeSqliteConstants.SQLITE_CREATE_INDEX,
  nodeSqliteConstants.SQLITE_CREATE_TABLE,
  nodeSqliteConstants.SQLITE_CREATE_TEMP_INDEX,
  nodeSqliteConstants.SQLITE_CREATE_TEMP_TABLE,
  nodeSqliteConstants.SQLITE_CREATE_TEMP_TRIGGER,
  nodeSqliteConstants.SQLITE_CREATE_TEMP_VIEW,
  nodeSqliteConstants.SQLITE_CREATE_TRIGGER,
  nodeSqliteConstants.SQLITE_CREATE_VIEW,
  nodeSqliteConstants.SQLITE_CREATE_VTABLE,
  nodeSqliteConstants.SQLITE_DETACH,
  nodeSqliteConstants.SQLITE_DROP_INDEX,
  nodeSqliteConstants.SQLITE_DROP_TABLE,
  nodeSqliteConstants.SQLITE_DROP_TEMP_INDEX,
  nodeSqliteConstants.SQLITE_DROP_TEMP_TABLE,
  nodeSqliteConstants.SQLITE_DROP_TEMP_TRIGGER,
  nodeSqliteConstants.SQLITE_DROP_TEMP_VIEW,
  nodeSqliteConstants.SQLITE_DROP_TRIGGER,
  nodeSqliteConstants.SQLITE_DROP_VIEW,
  nodeSqliteConstants.SQLITE_DROP_VTABLE,
  nodeSqliteConstants.SQLITE_REINDEX,
]) {
  verifierSetAdd(sqliteAuthorizerDdlActions, action);
}

function nodeSqliteStatement<Row>(
  statement: NodeSqliteStatementSync,
  policy: DeclaredWritePolicy,
): SqliteNativeStatement<Row> {
  return {
    all(...params: unknown[]): Row[] {
      return mapNodeSqliteAuthorizerError(policy, () =>
        callSqliteStatementAll<Row>(statement, nodeSqliteParams(params)),
      );
    },
    run(...params: unknown[]): unknown {
      return mapNodeSqliteAuthorizerError(policy, () =>
        callSqliteStatementRun(statement, nodeSqliteParams(params)),
      );
    },
  };
}

function nodeSqliteParams(params: unknown[]): Parameters<NodeSqliteStatementSync['run']> {
  return params as Parameters<NodeSqliteStatementSync['run']>;
}

function mapNodeSqliteAuthorizerError<T>(policy: DeclaredWritePolicy, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof Error && /not authorized/i.test(error.message)) {
      throw new NodeSqliteDeclaredWriteError(policy, 'a SQLite engine write/DDL/pragma');
    }
    throw error;
  }
}

function sqliteAuthorizerTableName(databaseName: string | null, tableName: string | null): string {
  return `${databaseName ?? 'main'}.${tableName ?? '<unknown>'}`;
}

function isInternalSqliteTable(tableName: string | null, triggerOrView: string | null): boolean {
  return (
    triggerOrView === null && (tableName === 'sqlite_sequence' || tableName === 'sqlite_stat1')
  );
}

function declaredWriteSqliteTestDbFromHandle(
  sqlite: SqliteNativeHandle,
  policy: DeclaredWritePolicy,
): DeclaredWriteSqliteTestDb {
  return {
    close() {
      callSqliteClose(sqlite);
    },
    exec(statement) {
      callSqliteExec(sqlite, sqliteStatementText(statement));
    },
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: SqliteStatementInput,
      params: readonly unknown[] = [],
    ): Row[] {
      const carrier = sqliteStatement(statement, params);
      return callSqliteStatementAll<Row>(callSqlitePrepare(sqlite, carrier.text), carrier.values);
    },
    read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string): Row[] {
      return callSqliteStatementAll<Row>(
        callSqlitePrepare(sqlite, `select * from ${quoteSqlIdentifier(table)}`),
        [],
      );
    },
    sqlite,
    write(table, value) {
      assertDeclaredWriteTableAllowed(table, policy, 'sqlite');
      insertSqliteRow(sqlite, table, value);
    },
  };
}

function sqliteTestDbFromHandle(sqlite: SqliteNativeHandle): ReadonlySqliteTestDb {
  return {
    close() {
      callSqliteClose(sqlite);
    },
    exec(statement) {
      callSqliteExec(sqlite, sqliteStatementText(statement));
    },
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: SqliteStatementInput,
      params: readonly unknown[] = [],
    ): Row[] {
      const carrier = sqliteStatement(statement, params);
      return callSqliteStatementAll<Row>(callSqlitePrepare(sqlite, carrier.text), carrier.values);
    },
    read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string): Row[] {
      return callSqliteStatementAll<Row>(
        callSqlitePrepare(sqlite, `select * from ${quoteSqlIdentifier(table)}`),
        [],
      );
    },
    sqlite,
    write(table, value) {
      insertSqliteRow(sqlite, table, value);
    },
  };
}

function insertSqliteRow(
  sqlite: SqliteNativeHandle,
  table: string,
  value: Record<string, unknown>,
): void {
  const entries = snapshotRowEntries(value);
  if (entries.length === 0) {
    callSqliteExec(sqlite, `insert into ${quoteSqlIdentifier(table)} default values`);
    return;
  }

  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    verifierArrayPush(columns, quoteSqlIdentifier(entry[0]));
    verifierArrayPush(placeholders, '?');
    verifierArrayPush(values, entry[1]);
  }
  callSqliteStatementRun(
    callSqlitePrepare(
      sqlite,
      `insert into ${quoteSqlIdentifier(table)} (${verifierArrayJoin(columns, ', ')}) values (${verifierArrayJoin(placeholders, ', ')})`,
    ),
    values,
  );
}

function assertDeclaredWriteTableAllowed(
  table: string,
  policy: DeclaredWritePolicy,
  dialect: 'postgres' | 'sqlite',
): void {
  const allowed = verifierSet<string>();
  for (let index = 0; index < (policy.tables ?? []).length; index += 1) {
    const name = policy.tables?.[index];
    if (name !== undefined) verifierSetAdd(allowed, normalizePolicyTable(name, dialect));
  }
  if (verifierSetSize(allowed) === 0) return;

  const normalized = normalizePolicyTable(table, dialect);
  if (verifierSetHas(allowed, normalized)) return;

  throw new Error(
    verifierArrayJoin(
      [
        `KV406: SQLite adapter declared-write fallback rejected table ${normalized} outside the mutation registry tables (SPEC §10.3/§11.2).`,
        `  declared tables: ${formatPolicyValues(policy.tables ?? [])}`,
        `  touches: ${formatPolicyValues(policy.touches ?? []) || '<none>'}`,
      ],
      '\n',
    ),
  );
}

function normalizePolicyTable(table: string, dialect: 'postgres' | 'sqlite'): string {
  return verifierStringIncludes(table, '.')
    ? table
    : `${dialect === 'sqlite' ? 'main' : 'public'}.${table}`;
}

function sqliteStatement(
  statement: SqliteStatementInput,
  params: readonly unknown[],
): { text: string; values: readonly unknown[] } {
  if (typeof statement === 'string') {
    return { text: statement, values: snapshotAdapterValues(params) };
  }
  const snapshot = snapshotManagedSqlStatement(statement, 'sqlite');
  if (snapshot.ok) return snapshot.statement;
  if (snapshot.message !== undefined) throw new Error(`KV422: ${snapshot.message}`);
  return snapshotAdapterStatementCarrier(statement, params, 'SQLite statement carrier');
}

function sqliteStatementText(statement: SqliteStatementInput): string {
  return sqliteStatement(statement, []).text;
}

function quoteSqlIdentifier(identifier: string): string {
  const parts = verifierStringSplit(identifier, '.');
  const quoted: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined) continue;
    if (verifierRegExpExec(/^[A-Za-z_][A-Za-z0-9_]*$/, part) === null) {
      throw new Error(`Invalid SQL identifier: ${identifier}`);
    }
    verifierArrayPush(quoted, `"${verifierStringReplaceAll(part, '"', '""')}"`);
  }
  return verifierArrayJoin(quoted, '.');
}

interface SqliteHandleControls {
  close: Function;
  exec: Function;
  prepare: Function;
}

interface SqliteStatementControls {
  all: Function;
  run: Function;
}

const sqliteHandleControls = verifierWeakMap<object, SqliteHandleControls>();
const sqliteStatementControls = verifierWeakMap<object, SqliteStatementControls>();

function pinSqliteHandle(handle: SqliteNativeHandle): SqliteHandleControls {
  const cached = verifierWeakMapGet(sqliteHandleControls, handle);
  if (cached !== undefined) return cached;
  const controls = verifierFreeze({
    close: verifierStableMethod(handle, 'close'),
    exec: verifierStableMethod(handle, 'exec'),
    prepare: verifierStableMethod(handle, 'prepare'),
  });
  verifierWeakMapSet(sqliteHandleControls, handle, controls);
  return controls;
}

function pinSqliteStatement(statement: object): SqliteStatementControls {
  const owner = verifierGetPrototypeOf(statement) ?? statement;
  const cached = verifierWeakMapGet(sqliteStatementControls, owner);
  if (cached !== undefined) return cached;
  const controls = verifierFreeze({
    all: verifierStableMethod(statement, 'all'),
    run: verifierStableMethod(statement, 'run'),
  });
  verifierWeakMapSet(sqliteStatementControls, owner, controls);
  return controls;
}

function callSqliteClose(handle: SqliteNativeHandle): void {
  verifierApply(pinSqliteHandle(handle).close, handle, []);
}

function callSqliteExec(handle: SqliteNativeHandle, statement: string): unknown {
  return verifierApply(pinSqliteHandle(handle).exec, handle, [statement]);
}

function callSqlitePrepare<Row>(
  handle: SqliteNativeHandle,
  statement: string,
): SqliteNativeStatement<Row> {
  const prepared = verifierApply<SqliteNativeStatement<Row>>(
    pinSqliteHandle(handle).prepare,
    handle,
    [statement],
  );
  pinSqliteStatement(prepared);
  return prepared;
}

function callSqliteStatementAll<Row>(statement: object, params: readonly unknown[]): Row[] {
  return verifierApply(pinSqliteStatement(statement).all, statement, snapshotAdapterValues(params));
}

function callSqliteStatementRun(statement: object, params: readonly unknown[]): unknown {
  return verifierApply(pinSqliteStatement(statement).run, statement, snapshotAdapterValues(params));
}
