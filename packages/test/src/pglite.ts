import { PGlite, type PGliteOptions, type Results } from '@electric-sql/pglite';
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
  snapshotOwnDataRecord,
  snapshotRowEntries,
} from './adapter-security.js';
import {
  verifierApply,
  verifierArrayJoin,
  verifierArrayPush,
  verifierPromise,
  verifierPromiseResolve,
  verifierNumber,
  verifierRegExpExec,
  verifierSet,
  verifierSetAdd,
  verifierSetHas,
  verifierSetSize,
  verifierStableMethod,
  verifierStringIncludes,
  verifierStringReplaceAll,
  verifierStringSplit,
} from './verifier-security-intrinsics.js';

const NativePGlite = PGlite;
const nativePgliteExec = verifierStableMethod(NativePGlite.prototype, 'exec');
const nativePgliteQuery = verifierStableMethod(NativePGlite.prototype, 'query');
const nativePgliteClose = verifierStableMethod(NativePGlite.prototype, 'close');

/** SQL statement object accepted by `PgliteTestDb` helpers. */
export interface PgliteStatementCarrier {
  /** Drizzle SQL chunks, used by Kovo static/parameterized SQL objects. */
  queryChunks?: readonly unknown[];
  /** SQL text, matching common driver carrier shape. */
  sql?: string;
  /** SQL text, matching common driver carrier shape. */
  text?: string;
  /** Bound statement values. */
  values?: readonly unknown[];
}

/** SQL statement input accepted by `PgliteTestDb` helpers. */
export type PgliteStatementInput = string | PgliteStatementCarrier;

/** A PGlite-backed test database handle: `exec`/`query` SQL helpers plus `read`/`write` and `close`. */
export interface PgliteTestDb {
  close(): Promise<void>;
  exec(statement: PgliteStatementInput): Promise<Results[]>;
  pglite: PGlite;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: PgliteStatementInput,
    params?: readonly unknown[],
  ): Promise<Row[]>;
  read<Row extends Record<string, unknown> = Record<string, unknown>>(
    table: string,
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
  const optionsSnapshot = snapshotOwnDataRecord(options, 'PGlite options') as PGliteOptions;
  const pglite = new NativePGlite(optionsSnapshot);
  await pglite.waitReady;
  let transactionQueue: Promise<void> = verifierPromiseResolve(undefined);
  let readonlyDb: ReadonlyPgliteTestDb | null = null;
  let readonlyPglite: PGlite | null = null;
  let readonlyPgliteReady: Promise<PGlite> | null = null;

  const runSerializedTransaction = async <Result>(
    begin: 'begin' | 'begin read only',
    callback: () => Promise<Result>,
  ): Promise<Result> => {
    const previous = transactionQueue;
    let release!: () => void;
    transactionQueue = verifierPromise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await callPgliteExec(pglite, begin);
      try {
        const result = await callback();
        await callPgliteExec(pglite, 'commit');
        return result;
      } catch (error) {
        try {
          await callPgliteExec(pglite, 'rollback');
        } catch {
          // Preserve the original engine denial for KV433 wrapping.
        }
        throw error;
      }
    } finally {
      release();
    }
  };

  const runReadonly = async <Result>(callback: () => Promise<Result>): Promise<Result> =>
    runSerializedTransaction('begin read only', callback);

  const runDeclaredWriteFallback = async <Result>(
    policy: DeclaredWritePolicy,
    callback: () => Promise<Result>,
  ): Promise<Result> =>
    runSerializedTransaction('begin', async () => {
      const result = await callback();
      const unexpected = await unexpectedPgliteWriteStatTables(pglite, policy);
      if (unexpected.length > 0) {
        throw new PgliteDeclaredWriteScopeError(policy, unexpected);
      }
      return result;
    });

  const readonlyHandle = (): ReadonlyPgliteTestDb => {
    const readonlyDataDir = pgliteReadonlyDataDir(optionsSnapshot);
    if (readonlyDataDir !== undefined) {
      readonlyDb ??= pgliteTestDbFromOperations(
        pglite,
        async (statement) => {
          const reader = await readonlyPgliteSession(readonlyDataDir);
          return pgliteExecStatement(reader, statement);
        },
        async <Row extends Record<string, unknown>>(
          statement: PgliteStatementInput,
          params: readonly unknown[] = [],
        ) => {
          const reader = await readonlyPgliteSession(readonlyDataDir);
          const carrier = pgliteStatement(statement, params);
          return (await callPgliteQuery<Row>(reader, carrier.text, carrier.values)).rows;
        },
        true,
        undefined,
        () => readonlyPglite ?? pglite,
      );
      return readonlyDb;
    }

    // PGlite documents its in-memory mode as single-user/single-connection. Without a dataDir
    // there is no second engine session to pool, so keep DEC-A engine enforcement as serialized
    // read-only transactions and avoid setting a default that would poison the writer handle.
    readonlyDb ??= pgliteTestDbFromOperations(
      pglite,
      async (statement) => runReadonly(() => pgliteExecStatement(pglite, statement)),
      async <Row extends Record<string, unknown>>(
        statement: PgliteStatementInput,
        params: readonly unknown[] = [],
      ) =>
        runReadonly(async () => {
          const carrier = pgliteStatement(statement, params);
          return (await callPgliteQuery<Row>(pglite, carrier.text, carrier.values)).rows;
        }),
      true,
    );
    return readonlyDb;
  };

  const readonlyPgliteSession = async (dataDir: string): Promise<PGlite> => {
    if (readonlyPglite !== null) return readonlyPglite;
    readonlyPgliteReady ??= (async () => {
      try {
        const reader = new NativePGlite({ ...optionsSnapshot, dataDir });
        await reader.waitReady;
        await callPgliteExec(reader, 'set default_transaction_read_only = on');
        readonlyPglite = reader;
        return reader;
      } catch (error) {
        readonlyPgliteReady = null;
        throw error;
      }
    })();
    return readonlyPgliteReady;
  };

  const db: PgliteTestDb &
    KovoDeclaredWriteDbCapable<DeclaredWritePgliteTestDb> &
    KovoReadonlyDbCapable<ReadonlyPgliteTestDb> = {
    async close() {
      if (readonlyPglite !== null) {
        await callPgliteClose(readonlyPglite);
        readonlyPglite = null;
        readonlyPgliteReady = null;
      }
      await callPgliteClose(pglite);
    },
    async exec(statement) {
      return pgliteExecStatement(pglite, statement);
    },
    pglite,
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: PgliteStatementInput,
      params: readonly unknown[] = [],
    ) {
      const carrier = pgliteStatement(statement, params);
      const result = await callPgliteQuery<Row>(pglite, carrier.text, carrier.values);
      return result.rows;
    },
    async read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string) {
      const result = await callPgliteQuery<Row>(
        pglite,
        `select * from ${quoteSqlIdentifier(table)}`,
        [],
      );
      return result.rows;
    },
    async write(table, value) {
      await insertPgliteRow(
        (statement) => pgliteExecStatement(pglite, statement),
        async <Row extends Record<string, unknown>>(
          statement: PgliteStatementInput,
          params: readonly unknown[] = [],
        ) => {
          const carrier = pgliteStatement(statement, params);
          return (await callPgliteQuery<Row>(pglite, carrier.text, carrier.values)).rows;
        },
        table,
        value,
      );
    },
    [kovoDeclaredWriteDbHandle](policy) {
      const policySnapshot = snapshotAdapterPolicy(policy, 'postgres') as DeclaredWritePolicy;
      // PGlite exposes one embedded engine handle here and does not give Kovo a request-scoped
      // GRANT/ROLE sandbox. Use Postgres transaction stats as the committed DEC-B fallback:
      // statements execute in one transaction, out-of-declared table deltas roll back as KV406.
      // Residual per plans/fundamental-fixes-followup-3.md: writes with no stat delta are not caught.
      return pgliteTestDbFromOperations(
        pglite,
        (statement) =>
          runDeclaredWriteFallback(policySnapshot, () => pgliteExecStatement(pglite, statement)),
        async <Row extends Record<string, unknown>>(
          statement: PgliteStatementInput,
          params: readonly unknown[] = [],
        ) => {
          const carrier = pgliteStatement(statement, params);
          return runDeclaredWriteFallback(
            policySnapshot,
            async () => (await callPgliteQuery<Row>(pglite, carrier.text, carrier.values)).rows,
          );
        },
        false,
        policySnapshot,
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
  pgliteHandle: () => PGlite = () => pglite,
): ReadonlyPgliteTestDb {
  return {
    async close() {
      if (!readonly) await callPgliteClose(pglite);
    },
    async exec(statement) {
      return execStatement(statement);
    },
    get pglite() {
      return pgliteHandle();
    },
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: PgliteStatementInput,
      params: readonly unknown[] = [],
    ) {
      return queryRows<Row>(statement, params);
    },
    async read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string) {
      return queryRows<Row>(`select * from ${quoteSqlIdentifier(table)}`);
    },
    async write(table, value) {
      if (declaredWritePolicy !== undefined) {
        assertDeclaredWriteTableAllowed(table, declaredWritePolicy, 'postgres');
      }
      await insertPgliteRow(execStatement, queryRows, table, value);
    },
  };
}

function pgliteReadonlyDataDir(options: PGliteOptions): string | undefined {
  if (typeof options.dataDir !== 'string') return undefined;
  if (options.dataDir === '' || options.dataDir.startsWith('memory://')) return undefined;
  return options.dataDir;
}

interface PgliteWriteStatRow {
  [key: string]: unknown;
  table: string;
  n_tup_del: number | string;
  n_tup_ins: number | string;
  n_tup_upd: number | string;
}

class PgliteDeclaredWriteScopeError extends Error {
  constructor(policy: DeclaredWritePolicy, unexpected: readonly string[]) {
    super(
      verifierArrayJoin(
        [
          'KV406: PGlite declared-write stat-delta fallback rejected table(s) outside the mutation registry tables (SPEC §10.3/§11.2).',
          `  unexpected: ${formatPolicyValues(unexpected)}`,
          `  declared tables: ${formatPolicyValues(policy.tables ?? [])}`,
          `  touches: ${formatPolicyValues(policy.touches ?? []) || '<none>'}`,
        ],
        '\n',
      ),
    );
    this.name = 'PgliteDeclaredWriteScopeError';
  }
}

async function unexpectedPgliteWriteStatTables(
  pglite: PGlite,
  policy: DeclaredWritePolicy,
): Promise<string[]> {
  const declaredTables = policy.tables ?? [];
  if (declaredTables.length === 0) return [];

  const allowed = verifierSet<string>();
  for (let index = 0; index < declaredTables.length; index += 1) {
    const table = declaredTables[index];
    if (table !== undefined) verifierSetAdd(allowed, normalizePolicyTable(table, 'postgres'));
  }
  const stats = await callPgliteQuery<PgliteWriteStatRow>(
    pglite,
    verifierArrayJoin(
      [
        'select relid::regclass::text as table, n_tup_ins, n_tup_upd, n_tup_del',
        'from pg_stat_xact_user_tables',
      ],
      ' ',
    ),
    [],
  );
  const unexpected: string[] = [];
  for (let index = 0; index < stats.rows.length; index += 1) {
    const row = stats.rows[index];
    if (
      row !== undefined &&
      verifierNumber(row.n_tup_ins) +
        verifierNumber(row.n_tup_upd) +
        verifierNumber(row.n_tup_del) >
        0
    ) {
      const table = normalizePolicyTable(row.table, 'postgres');
      if (!verifierSetHas(allowed, table)) verifierArrayPush(unexpected, table);
    }
  }
  return unexpected;
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
  const entries = snapshotRowEntries(value);
  if (entries.length === 0) {
    await execStatement({
      text: `insert into ${quoteSqlIdentifier(table)} default values`,
      values: [],
    });
    return;
  }

  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    verifierArrayPush(columns, quoteSqlIdentifier(entry[0]));
    verifierArrayPush(placeholders, `$${index + 1}`);
    verifierArrayPush(values, entry[1]);
  }
  await queryRows({
    text: `insert into ${quoteSqlIdentifier(table)} (${verifierArrayJoin(columns, ', ')}) values (${verifierArrayJoin(placeholders, ', ')})`,
    values,
  });
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
        `KV406: PGlite adapter declared-write fallback rejected table ${normalized} outside the mutation registry tables (SPEC §10.3/§11.2).`,
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

function pgliteStatement(
  statement: PgliteStatementInput,
  params: readonly unknown[],
): { text: string; values: readonly unknown[] } {
  if (typeof statement === 'string') {
    return { text: statement, values: snapshotAdapterValues(params) };
  }
  const snapshot = snapshotManagedSqlStatement(statement, 'postgres');
  if (snapshot.ok) return snapshot.statement;
  if (snapshot.message !== undefined) throw new Error(`KV422: ${snapshot.message}`);
  return snapshotAdapterStatementCarrier(statement, params, 'PGlite statement carrier');
}

async function pgliteExecStatement(
  pglite: PGlite,
  statement: PgliteStatementInput,
): Promise<Results[]> {
  const carrier = pgliteStatement(statement, []);
  if (carrier.values.length === 0) return callPgliteExec(pglite, carrier.text);
  await callPgliteQuery(pglite, carrier.text, carrier.values);
  return [];
}

function callPgliteExec(pglite: PGlite, statement: string): Promise<Results[]> {
  return verifierApply(nativePgliteExec, pglite, [statement]);
}

function callPgliteQuery<Row extends Record<string, unknown>>(
  pglite: PGlite,
  statement: string,
  values: readonly unknown[],
): Promise<{ rows: Row[] }> {
  return verifierApply(nativePgliteQuery, pglite, [statement, snapshotAdapterValues(values)]);
}

function callPgliteClose(pglite: PGlite): Promise<void> {
  return verifierApply(nativePgliteClose, pglite, []);
}
