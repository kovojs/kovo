import { createRequire } from 'node:module';
import {
  kovoReadonlyDbHandle,
  type KovoReadonlyDbCapable,
} from '@kovojs/server/internal/execution';

interface BetterSqliteConstructor {
  new (filename: string, options?: SqliteTestDbOptions): SqliteNativeHandle;
}

interface SqliteStatementCarrier {
  sql?: string;
  text?: string;
  values?: readonly unknown[];
}

type SqliteStatementInput = string | SqliteStatementCarrier;

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
  sql<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: SqliteStatementInput,
    params?: readonly unknown[],
  ): Row[];
  sqlite: SqliteNativeHandle;
  write(table: string, value: Record<string, unknown>): void;
}

type ReadonlySqliteTestDb = Omit<SqliteTestDb, typeof kovoReadonlyDbHandle>;

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
  let readonlyDb: ReadonlySqliteTestDb | null = null;

  const db: SqliteTestDb & Partial<KovoReadonlyDbCapable<ReadonlySqliteTestDb>> = {
    close() {
      for (const handle of readonlyHandles) handle.close();
      readonlyHandles.clear();
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
    sql<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: SqliteStatementInput,
      params: readonly unknown[] = [],
    ): Row[] {
      const carrier = sqliteStatement(statement, params);
      return sqlite.prepare<Row>(carrier.text).all(...carrier.values);
    },
    sqlite,
    write(table, value) {
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
    sql<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: SqliteStatementInput,
      params: readonly unknown[] = [],
    ): Row[] {
      const carrier = sqliteStatement(statement, params);
      return sqlite.prepare<Row>(carrier.text).all(...carrier.values);
    },
    sqlite,
    write(table, value) {
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
    },
  };
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
