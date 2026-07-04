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
  const readonlyHandles = new Set<SqliteNativeHandle>();
  const declaredWriteHandles = new Set<SqliteNativeHandle>();
  let readonlyDb: ReadonlySqliteTestDb | null = null;

  const db: SqliteTestDb &
    KovoDeclaredWriteDbCapable<DeclaredWriteSqliteTestDb> &
    Partial<KovoReadonlyDbCapable<ReadonlySqliteTestDb>> = {
    close() {
      for (const handle of readonlyHandles) handle.close();
      readonlyHandles.clear();
      for (const handle of declaredWriteHandles) handle.close();
      declaredWriteHandles.clear();
      sqlite.close();
    },
    exec(statement) {
      sqlite.exec(sqliteStatementText(statement));
    },
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: SqliteStatementInput,
      params: readonly unknown[] = [],
    ): Row[] {
      const carrier = sqliteStatement(statement, params);
      return sqlite.prepare<Row>(carrier.text).all(...carrier.values);
    },
    read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string): Row[] {
      return sqlite.prepare<Row>(`select * from ${quoteSqlIdentifier(table)}`).all();
    },
    sqlite,
    write(table, value) {
      insertSqliteRow(sqlite, table, value);
    },
    [kovoDeclaredWriteDbHandle](policy) {
      if (filename !== ':memory:') {
        const declaredWriteHandle = nodeSqliteDeclaredWriteHandle(filename, policy);
        declaredWriteHandles.add(declaredWriteHandle);
        return declaredWriteSqliteTestDbFromHandle(declaredWriteHandle, policy);
      }

      // In-memory better-sqlite3 databases cannot share state with a second native SQLite authorizer
      // connection. Keep the residual explicit: this fallback protects parser-blind helpers only.
      return declaredWriteSqliteTestDbFromHandle(sqlite, policy);
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
      readonlySqlite.exec('PRAGMA query_only=ON');
      readonlyHandles.add(readonlySqlite);
      readonlyDb = sqliteTestDbFromHandle(readonlySqlite);
      return readonlyDb;
    };
  }

  return db;
}

class NodeSqliteDeclaredWriteError extends Error {
  constructor(policy: DeclaredWritePolicy, detail: string) {
    super(
      [
        `KV406: SQLite authorizer rejected ${detail} outside the mutation registry tables (SPEC §10.3/§11.2).`,
        `  declared tables: ${[...new Set(policy.tables ?? [])].sort().join(', ')}`,
        `  touches: ${[...new Set(policy.touches ?? [])].sort().join(', ') || '<none>'}`,
      ].join('\n'),
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
    this.sqlite.close();
  }

  exec(statement: string): unknown {
    return mapNodeSqliteAuthorizerError(this.policy, () => this.sqlite.exec(statement));
  }

  prepare<Row = unknown>(statement: string): SqliteNativeStatement<Row> {
    return mapNodeSqliteAuthorizerError(this.policy, () => {
      const prepared = this.sqlite.prepare(statement);
      return nodeSqliteStatement<Row>(prepared, this.policy);
    });
  }

  transaction<Callback extends (...args: never[]) => unknown>(callback: Callback): Callback {
    return ((...args: Parameters<Callback>) => {
      this.exec('BEGIN');
      try {
        const result = callback(...(args as never[]));
        this.exec('COMMIT');
        return result;
      } catch (error) {
        this.exec('ROLLBACK');
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
  const allowedTables = new Set(
    (policy.tables ?? []).map((name) => normalizePolicyTable(name, 'sqlite')),
  );
  sqlite.setAuthorizer((action, objectName, columnName, databaseName, triggerOrView) => {
    if (sqliteAuthorizerDdlActions.has(action) || action === nodeSqliteConstants.SQLITE_PRAGMA) {
      return nodeSqliteConstants.SQLITE_DENY;
    }

    if (sqliteAuthorizerWriteActions.has(action)) {
      const table = sqliteAuthorizerTableName(databaseName, objectName);
      if (allowedTables.size > 0 && allowedTables.has(table)) {
        return nodeSqliteConstants.SQLITE_OK;
      }
      if (isInternalSqliteTable(objectName, triggerOrView)) {
        return nodeSqliteConstants.SQLITE_OK;
      }
      return nodeSqliteConstants.SQLITE_DENY;
    }

    return nodeSqliteConstants.SQLITE_OK;
  });

  return new NodeSqliteAuthorizedHandle(sqlite, policy);
}

const sqliteAuthorizerWriteActions = new Set([
  nodeSqliteConstants.SQLITE_DELETE,
  nodeSqliteConstants.SQLITE_INSERT,
  nodeSqliteConstants.SQLITE_UPDATE,
]);

const sqliteAuthorizerDdlActions = new Set([
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
]);

function nodeSqliteStatement<Row>(
  statement: NodeSqliteStatementSync,
  policy: DeclaredWritePolicy,
): SqliteNativeStatement<Row> {
  return {
    all(...params: unknown[]): Row[] {
      return mapNodeSqliteAuthorizerError(
        policy,
        () => statement.all(...nodeSqliteParams(params)) as Row[],
      );
    },
    run(...params: unknown[]): unknown {
      return mapNodeSqliteAuthorizerError(policy, () => statement.run(...nodeSqliteParams(params)));
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
      sqlite.close();
    },
    exec(statement) {
      sqlite.exec(sqliteStatementText(statement));
    },
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: SqliteStatementInput,
      params: readonly unknown[] = [],
    ): Row[] {
      const carrier = sqliteStatement(statement, params);
      return sqlite.prepare<Row>(carrier.text).all(...carrier.values);
    },
    read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string): Row[] {
      return sqlite.prepare<Row>(`select * from ${quoteSqlIdentifier(table)}`).all();
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
      sqlite.close();
    },
    exec(statement) {
      sqlite.exec(sqliteStatementText(statement));
    },
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: SqliteStatementInput,
      params: readonly unknown[] = [],
    ): Row[] {
      const carrier = sqliteStatement(statement, params);
      return sqlite.prepare<Row>(carrier.text).all(...carrier.values);
    },
    read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string): Row[] {
      return sqlite.prepare<Row>(`select * from ${quoteSqlIdentifier(table)}`).all();
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
  const entries = Object.entries(value);
  if (entries.length === 0) {
    sqlite.exec(`insert into ${quoteSqlIdentifier(table)} default values`);
    return;
  }

  const columns = entries.map(([column]) => quoteSqlIdentifier(column)).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  sqlite
    .prepare(`insert into ${quoteSqlIdentifier(table)} (${columns}) values (${placeholders})`)
    .run(...entries.map(([, columnValue]) => columnValue));
}

function assertDeclaredWriteTableAllowed(
  table: string,
  policy: DeclaredWritePolicy,
  dialect: 'postgres' | 'sqlite',
): void {
  const allowed = new Set((policy.tables ?? []).map((name) => normalizePolicyTable(name, dialect)));
  if (allowed.size === 0) return;

  const normalized = normalizePolicyTable(table, dialect);
  if (allowed.has(normalized)) return;

  throw new Error(
    [
      `KV406: SQLite adapter declared-write fallback rejected table ${normalized} outside the mutation registry tables (SPEC §10.3/§11.2).`,
      `  declared tables: ${[...new Set(policy.tables ?? [])].sort().join(', ')}`,
      `  touches: ${[...new Set(policy.touches ?? [])].sort().join(', ') || '<none>'}`,
    ].join('\n'),
  );
}

function normalizePolicyTable(table: string, dialect: 'postgres' | 'sqlite'): string {
  return table.includes('.') ? table : `${dialect === 'sqlite' ? 'main' : 'public'}.${table}`;
}

function sqliteStatement(
  statement: SqliteStatementInput,
  params: readonly unknown[],
): { text: string; values: readonly unknown[] } {
  if (typeof statement === 'string') return { text: statement, values: params };
  const text = statement.sql ?? statement.text;
  if (typeof text !== 'string') throw new Error('SQLite statement carrier must include sql/text.');
  return { text, values: statement.values ?? params };
}

function sqliteStatementText(statement: SqliteStatementInput): string {
  return sqliteStatement(statement, []).text;
}

function quoteSqlIdentifier(identifier: string): string {
  return identifier
    .split('.')
    .map((part) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
        throw new Error(`Invalid SQL identifier: ${identifier}`);
      }

      return `"${part.replaceAll('"', '""')}"`;
    })
    .join('.');
}
