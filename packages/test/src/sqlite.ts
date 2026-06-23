import { createRequire } from 'node:module';

interface BetterSqliteConstructor {
  new (filename: string, options?: SqliteTestDbOptions): BetterSqliteHandle;
}

interface BetterSqliteHandle {
  close(): void;
  exec(statement: string): unknown;
  prepare<Row = unknown>(statement: string): BetterSqliteStatement<Row>;
  transaction<Callback extends (...args: never[]) => unknown>(callback: Callback): Callback;
}

interface BetterSqliteStatement<Row = unknown> {
  all(...params: unknown[]): Row[];
  run(...params: unknown[]): unknown;
}

/** Options passed through to the better-sqlite3 constructor used by `createSqliteTestDb()`. */
export interface SqliteTestDbOptions {
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
  exec(statement: string): void;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[],
  ): Row[];
  read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string): Row[];
  sql<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[],
  ): Row[];
  sqlite: BetterSqliteHandle;
  write(table: string, value: Record<string, unknown>): void;
}

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
  const sqlite = new Database(':memory:', options);

  return {
    close() {
      sqlite.close();
    },
    exec(statement) {
      sqlite.exec(statement);
    },
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      params: readonly unknown[] = [],
    ): Row[] {
      return sqlite.prepare<Row>(statement).all(...params);
    },
    read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string): Row[] {
      return sqlite.prepare<Row>(`select * from ${quoteSqlIdentifier(table)}`).all();
    },
    sql<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      params: readonly unknown[] = [],
    ): Row[] {
      return sqlite.prepare<Row>(statement).all(...params);
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
