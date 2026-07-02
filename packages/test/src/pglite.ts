import { PGlite, type PGliteOptions, type Results } from '@electric-sql/pglite';
import {
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  type KovoDeclaredWriteDbCapable,
  type KovoReadonlyDbCapable,
} from '@kovojs/server/internal/execution';

/** SQL statement object accepted by `PgliteTestDb` helpers. */
export interface PgliteStatementCarrier {
  /** SQL text, matching common driver carrier shape. */
  sql?: string;
  /** SQL text, matching common driver carrier shape. */
  text?: string;
  /** Bound statement values. */
  values?: readonly unknown[];
}

/** SQL statement input accepted by `PgliteTestDb` helpers. */
export type PgliteStatementInput = string | PgliteStatementCarrier;

/** A PGlite-backed test database handle: `exec`/`query`/`sql` SQL helpers plus `read`/`write` and `close`. */
export interface PgliteTestDb {
  close(): Promise<void>;
  exec(statement: PgliteStatementInput): Promise<Results[]>;
  insert(table: string): { values(value: Record<string, unknown>): Promise<void> };
  pglite: PGlite;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: PgliteStatementInput,
    params?: readonly unknown[],
  ): Promise<Row[]>;
  read<Row extends Record<string, unknown> = Record<string, unknown>>(
    table: string,
  ): Promise<Row[]>;
  sql<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: PgliteStatementInput,
    params?: readonly unknown[],
  ): Promise<Row[]>;
  write(table: string, value: Record<string, unknown>): Promise<void>;
}

type DeclaredWritePolicy = Parameters<
  KovoDeclaredWriteDbCapable[typeof kovoDeclaredWriteDbHandle]
>[0];
type ReadonlyPgliteTestDb = Omit<PgliteTestDb, typeof kovoReadonlyDbHandle>;
type DeclaredWritePgliteTestDb = Omit<
  PgliteTestDb,
  typeof kovoDeclaredWriteDbHandle | typeof kovoReadonlyDbHandle
>;
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
  let readonlyQueue = Promise.resolve();
  let readonlyDb: ReadonlyPgliteTestDb | null = null;

  const runReadonly = async <Result>(callback: () => Promise<Result>): Promise<Result> => {
    const previous = readonlyQueue;
    let release!: () => void;
    readonlyQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await pglite.exec('begin read only');
      try {
        const result = await callback();
        await pglite.exec('commit');
        return result;
      } catch (error) {
        try {
          await pglite.exec('rollback');
        } catch {
          // Preserve the original engine denial for KV433 wrapping.
        }
        throw error;
      }
    } finally {
      release();
    }
  };

  const readonlyHandle = (): ReadonlyPgliteTestDb => {
    // PGlite exposes one embedded engine handle here, not a pool. Use serialized read-only
    // transactions so the engine enforces DEC-A without leaking state to the writer helpers.
    readonlyDb ??= pgliteTestDbFromOperations(
      pglite,
      async (statement) => runReadonly(() => pglite.exec(pgliteStatementText(statement))),
      async <Row extends Record<string, unknown>>(
        statement: PgliteStatementInput,
        params: readonly unknown[] = [],
      ) =>
        runReadonly(async () => {
          const carrier = pgliteStatement(statement, params);
          return (await pglite.query<Row>(carrier.text, [...carrier.values])).rows;
        }),
      true,
    );
    return readonlyDb;
  };

  const db: PgliteTestDb &
    KovoDeclaredWriteDbCapable<DeclaredWritePgliteTestDb> &
    KovoReadonlyDbCapable<ReadonlyPgliteTestDb> = {
    async close() {
      await pglite.close();
    },
    async exec(statement) {
      return pglite.exec(pgliteStatementText(statement));
    },
    insert(table) {
      return {
        values(value) {
          return insertPgliteRow(
            (statement) => pglite.exec(pgliteStatementText(statement)),
            async <Row extends Record<string, unknown>>(
              statement: PgliteStatementInput,
              params: readonly unknown[] = [],
            ) => {
              const carrier = pgliteStatement(statement, params);
              return (await pglite.query<Row>(carrier.text, [...carrier.values])).rows;
            },
            table,
            value,
          );
        },
      };
    },
    pglite,
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: PgliteStatementInput,
      params: readonly unknown[] = [],
    ) {
      const carrier = pgliteStatement(statement, params);
      const result = await pglite.query<Row>(carrier.text, [...carrier.values]);
      return result.rows;
    },
    async read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string) {
      const result = await pglite.query<Row>(`select * from ${quoteSqlIdentifier(table)}`);
      return result.rows;
    },
    async sql<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: PgliteStatementInput,
      params: readonly unknown[] = [],
    ) {
      const carrier = pgliteStatement(statement, params);
      const result = await pglite.query<Row>(carrier.text, [...carrier.values]);
      return result.rows;
    },
    async write(table, value) {
      await insertPgliteRow(
        (statement) => pglite.exec(pgliteStatementText(statement)),
        async <Row extends Record<string, unknown>>(
          statement: PgliteStatementInput,
          params: readonly unknown[] = [],
        ) => {
          const carrier = pgliteStatement(statement, params);
          return (await pglite.query<Row>(carrier.text, [...carrier.values])).rows;
        },
        table,
        value,
      );
    },
    [kovoDeclaredWriteDbHandle](policy) {
      // PGlite exposes one embedded engine handle here and does not give Kovo a request-scoped
      // GRANT/ROLE sandbox. Keep the residual explicit: enforce declared tables at this adapter
      // boundary for parser-blind helpers, with managedDb still guarding raw SQL before execution.
      return pgliteTestDbFromOperations(
        pglite,
        (statement) => pglite.exec(pgliteStatementText(statement)),
        async <Row extends Record<string, unknown>>(
          statement: PgliteStatementInput,
          params: readonly unknown[] = [],
        ) => {
          const carrier = pgliteStatement(statement, params);
          return (await pglite.query<Row>(carrier.text, [...carrier.values])).rows;
        },
        false,
        policy,
      );
    },
    [kovoReadonlyDbHandle]: readonlyHandle,
  };

  return db;
}

function pgliteTestDbFromOperations(
  pglite: PGlite,
  execStatement: (statement: PgliteStatementInput) => Promise<Results[]>,
  queryRows: <Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: PgliteStatementInput,
    params?: readonly unknown[],
  ) => Promise<Row[]>,
  readonly: boolean,
  declaredWritePolicy?: DeclaredWritePolicy,
): ReadonlyPgliteTestDb {
  return {
    async close() {
      if (!readonly) await pglite.close();
    },
    async exec(statement) {
      return execStatement(statement);
    },
    insert(table) {
      return {
        values(value) {
          if (declaredWritePolicy !== undefined) {
            assertDeclaredWriteTableAllowed(table, declaredWritePolicy, 'postgres');
          }
          return insertPgliteRow(execStatement, queryRows, table, value);
        },
      };
    },
    pglite,
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      params: readonly unknown[] = [],
    ) {
      return queryRows<Row>(statement, params);
    },
    async read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string) {
      return queryRows<Row>(`select * from ${quoteSqlIdentifier(table)}`);
    },
    async sql<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      params: readonly unknown[] = [],
    ) {
      return queryRows<Row>(statement, params);
    },
    async write(table, value) {
      if (declaredWritePolicy !== undefined) {
        assertDeclaredWriteTableAllowed(table, declaredWritePolicy, 'postgres');
      }
      await insertPgliteRow(execStatement, queryRows, table, value);
    },
  };
}

async function insertPgliteRow(
  execStatement: (statement: PgliteStatementInput) => Promise<Results[]>,
  queryRows: <Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: PgliteStatementInput,
    params?: readonly unknown[],
  ) => Promise<Row[]>,
  table: string,
  value: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    await execStatement(`insert into ${quoteSqlIdentifier(table)} default values`);
    return;
  }

  const columns = entries.map(([column]) => quoteSqlIdentifier(column)).join(', ');
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ');
  await queryRows(
    `insert into ${quoteSqlIdentifier(table)} (${columns}) values (${placeholders})`,
    entries.map(([, columnValue]) => columnValue),
  );
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
      `KV406: PGlite adapter declared-write fallback rejected table ${normalized} outside the mutation registry tables (SPEC §10.3/§11.2).`,
      `  declared tables: ${[...new Set(policy.tables ?? [])].sort().join(', ')}`,
      `  touches: ${[...new Set(policy.touches ?? [])].sort().join(', ') || '<none>'}`,
    ].join('\n'),
  );
}

function normalizePolicyTable(table: string, dialect: 'postgres' | 'sqlite'): string {
  return table.includes('.') ? table : `${dialect === 'sqlite' ? 'main' : 'public'}.${table}`;
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

function pgliteStatement(
  statement: PgliteStatementInput,
  params: readonly unknown[],
): { text: string; values: readonly unknown[] } {
  if (typeof statement === 'string') return { text: statement, values: params };
  const text = statement.text ?? statement.sql;
  if (typeof text !== 'string') throw new Error('PGlite statement carrier must include text/sql.');
  return { text, values: statement.values ?? params };
}

function pgliteStatementText(statement: PgliteStatementInput): string {
  return pgliteStatement(statement, []).text;
}
