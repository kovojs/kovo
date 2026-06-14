import { PGlite, type PGliteOptions, type Results } from '@electric-sql/pglite';

/** A PGlite-backed test database handle: `exec`/`query`/`sql` SQL helpers plus `read`/`write` and `close`. */
export interface PgliteTestDb {
  close(): Promise<void>;
  exec(statement: string): Promise<Results[]>;
  pglite: PGlite;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
  read<Row extends Record<string, unknown> = Record<string, unknown>>(
    table: string,
  ): Promise<Row[]>;
  sql<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
  write(table: string, value: Record<string, unknown>): Promise<void>;
}
/**
 * Spin up an ephemeral in-process Postgres (PGlite) for tests, returning a
 * handle with SQL and row helpers. No external database required.
 *
 * @param options - PGlite options (e.g. data directory; defaults to in-memory).
 * @returns A ready `PgliteTestDb`.
 */
export async function createPgliteTestDb(options: PGliteOptions = {}): Promise<PgliteTestDb> {
  const pglite = new PGlite(options);
  await pglite.waitReady;

  return {
    async close() {
      await pglite.close();
    },
    async exec(statement) {
      return pglite.exec(statement);
    },
    pglite,
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      params: readonly unknown[] = [],
    ) {
      const result = await pglite.query<Row>(statement, [...params]);
      return result.rows;
    },
    async read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string) {
      const result = await pglite.query<Row>(`select * from ${quoteSqlIdentifier(table)}`);
      return result.rows;
    },
    async sql<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      params: readonly unknown[] = [],
    ) {
      const result = await pglite.query<Row>(statement, [...params]);
      return result.rows;
    },
    async write(table, value) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        await pglite.exec(`insert into ${quoteSqlIdentifier(table)} default values`);
        return;
      }

      const columns = entries.map(([column]) => quoteSqlIdentifier(column)).join(', ');
      const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ');
      await pglite.query(
        `insert into ${quoteSqlIdentifier(table)} (${columns}) values (${placeholders})`,
        entries.map(([, columnValue]) => columnValue),
      );
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
