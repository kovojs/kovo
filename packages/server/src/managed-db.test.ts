import { execFileSync, type ExecFileSyncOptionsWithBufferEncoding } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { drainSecretRevealAuditFacts, secret } from '@kovojs/core';
import { isManagedSqlStatement, stampTrustedSql } from '@kovojs/core/internal/sql-safety';
import { sql, staticSql, trustedSql } from '@kovojs/drizzle';
import {
  KovoReadonlyHandleError,
  createAuthorizationCensusDb,
  createDeclaredWriteDb,
  createPostgresReadonlyClient,
  createPostgresScopedClient,
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  declarePublicRead,
  drainPublicReadAuditFacts,
  managedDb,
  readonlyDb,
} from './managed-db.js';
import type { Reader, Writer } from './managed-db.js';
import {
  kovoAsyncMutationTransaction,
  managedSqlExecutionPolicy,
  wrapManagedDbForSqlSafety,
} from './sql-safe-handle.js';
import { runQuery } from './query.js';
import { query } from './api/data.js';
import { domain } from './domain.js';
import { runWithRequestInputProvenance } from './request-input-provenance.js';
import { trustedAssign, serverValue } from './write-governance.js';

// SPEC §6.6/§9.4/§10.3 (MARQUEE / KV433+KV422): the framework-owned managed DB handle.
//
// These tests prove the runtime floor: a `query()` loader's `context.db` is the SQL-safe (KV422)
// read-only (KV433) handle whose write verbs throw, while reads pass through; mutation/write
// surfaces receive the full read-write handle; and the KV422 raw-string rejection still holds through
// the managed handle (the unification). The static no-write-reachable proof (KV433 Stage 2) and the
// `Reader<Db>` tsc mirror are exercised elsewhere (drizzle static gate; type-level).

const product = domain('product');
const POSTGRES_READER_ROLE = 'kovo_reader';
const POSTGRES_WRITER_ROLE = 'kovo_writer';

function resolveBin(name: string): string {
  return join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );
}

function execFileSyncWithDiagnostics(
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptionsWithBufferEncoding,
): void {
  try {
    execFileSync(file, [...args], options);
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString('utf8') ?? '';
    const stdout = (error as { stdout?: Buffer }).stdout?.toString('utf8') ?? '';
    throw new Error([stdout, stderr].filter(Boolean).join('\n'));
  }
}

interface FakeRow {
  id: string;
}

async function runAsPostgresWriter(client: PGlite, statement: string): Promise<void> {
  await client.exec('BEGIN');
  try {
    await client.exec(`SET LOCAL ROLE ${POSTGRES_WRITER_ROLE}`);
    await client.exec("SET LOCAL kovo.principal = 'demo-user'");
    await client.exec(statement);
    await client.exec('COMMIT');
  } catch (error) {
    await client.exec('ROLLBACK');
    throw error;
  }
}

async function runAsPostgresReader(
  client: PGlite,
  statement: string,
): Promise<readonly Record<string, unknown>[]> {
  await client.exec('BEGIN');
  try {
    await client.exec('SET TRANSACTION READ ONLY');
    await client.exec(`SET LOCAL ROLE ${POSTGRES_READER_ROLE}`);
    await client.exec("SET LOCAL kovo.principal = 'demo-user'");
    const result = await client.query(statement);
    await client.exec('COMMIT');
    return result.rows as readonly Record<string, unknown>[];
  } catch (error) {
    await client.exec('ROLLBACK');
    throw error;
  }
}

function fakeDb(log: string[]) {
  return {
    insert(table: string) {
      log.push(`insert:${table}`);
      return { values: () => Promise.resolve() };
    },
    update(table: string) {
      log.push(`update:${table}`);
      return { set: () => ({ where: () => Promise.resolve() }) };
    },
    delete(table: string) {
      log.push(`delete:${table}`);
      return { where: () => Promise.resolve() };
    },
    select(): { from(table: string): Promise<FakeRow[]> } {
      return {
        from(table: string) {
          log.push(`select:${table}`);
          return Promise.resolve([{ id: 'p1' }]);
        },
      };
    },
    // KV422 SQL sink — accepts only branded/separated carriers.
    query(statement: unknown) {
      log.push('query');
      return Promise.resolve(statement);
    },
    all(statement: unknown) {
      log.push('all');
      return Promise.resolve(statement);
    },
    get(statement: unknown) {
      log.push('get');
      return Promise.resolve(statement);
    },
    run(statement: unknown) {
      log.push('run');
      return Promise.resolve(statement);
    },
    values(statement: unknown) {
      log.push('values');
      return Promise.resolve(statement);
    },
    futureStatement(...args: unknown[]) {
      log.push('futureStatement');
      return Promise.resolve(args.at(-1));
    },
    batch() {
      log.push('batch');
      return Promise.resolve();
    },
    // Make the value look like a db adapter so the SQL-safe wrap engages.
    execute(statement: unknown) {
      log.push('execute');
      return Promise.resolve(statement);
    },
    transaction<Result>(
      callback: (tx: { execute(statement: unknown): Promise<unknown> }) => Result,
    ) {
      log.push('transaction');
      return callback({
        execute(statement: unknown) {
          log.push('tx.execute');
          return Promise.resolve(statement);
        },
      });
    },
  };
}

interface GovernedWriteTestTable {
  name: string;
}

interface GovernedWriteTestDb {
  insert(table: GovernedWriteTestTable): {
    values(row: unknown): {
      onConflictDoUpdate(config: { set?: unknown }): Promise<string>;
    } & Promise<string>;
  };
  update(table: GovernedWriteTestTable): {
    set(row: unknown): Promise<string>;
  };
}

function governedWriteHandle(log: unknown[]): GovernedWriteTestDb {
  const raw = {
    insert(table: GovernedWriteTestTable) {
      return {
        values(row: unknown) {
          log.push({ op: 'insert', row, table: table.name });
          return Object.assign(Promise.resolve('inserted'), {
            onConflictDoUpdate(config: { set?: unknown }) {
              log.push({ config, op: 'conflict', table: table.name });
              return Promise.resolve('conflict');
            },
          });
        },
      };
    },
    update(table: GovernedWriteTestTable) {
      return {
        set(row: unknown) {
          log.push({ op: 'update', row, table: table.name });
          return Promise.resolve('updated');
        },
      };
    },
  };
  return createDeclaredWriteDb(
    raw,
    { tables: ['public.accounts'], touches: ['account'] },
    {
      dialectLabel: 'PGlite',
      governedColumns: {
        governedColumnKeysByTable: new Map([['accounts', new Set(['id', 'role'])]]),
        governedColumnNamesByTable: new Map([['accounts', new Set(['id', 'account_role'])]]),
      },
      normalizeTableName: (table) => (table.includes('.') ? table : `public.${table}`),
      tableNames: (table) => [(table as GovernedWriteTestTable).name],
    },
  ) as GovernedWriteTestDb;
}

const SQLITE_RAW_READ_CONSTANTS = {
  SQLITE_ALTER_TABLE: 1,
  SQLITE_ATTACH: 2,
  SQLITE_CREATE_INDEX: 3,
  SQLITE_CREATE_TABLE: 4,
  SQLITE_CREATE_TEMP_INDEX: 5,
  SQLITE_CREATE_TEMP_TABLE: 6,
  SQLITE_CREATE_TEMP_TRIGGER: 7,
  SQLITE_CREATE_TEMP_VIEW: 8,
  SQLITE_CREATE_TRIGGER: 9,
  SQLITE_CREATE_VIEW: 10,
  SQLITE_CREATE_VTABLE: 11,
  SQLITE_DELETE: 12,
  SQLITE_DENY: 13,
  SQLITE_DETACH: 14,
  SQLITE_DROP_INDEX: 15,
  SQLITE_DROP_TABLE: 16,
  SQLITE_DROP_TEMP_INDEX: 17,
  SQLITE_DROP_TEMP_TABLE: 18,
  SQLITE_DROP_TEMP_TRIGGER: 19,
  SQLITE_DROP_TEMP_VIEW: 20,
  SQLITE_DROP_TRIGGER: 21,
  SQLITE_DROP_VIEW: 22,
  SQLITE_DROP_VTABLE: 23,
  SQLITE_INSERT: 24,
  SQLITE_OK: 25,
  SQLITE_PRAGMA: 26,
  SQLITE_REINDEX: 27,
  SQLITE_UPDATE: 28,
  SQLITE_READ: 29,
};

function sqliteRawReadPolicy(
  observedTables: readonly string[],
  ownerTables: readonly string[] = [],
) {
  let authorize = (
    _action: number,
    _objectName: string | null,
    _columnName: string | null,
    _databaseName: string | null,
    _triggerOrView: string | null,
  ) => SQLITE_RAW_READ_CONSTANTS.SQLITE_OK;
  return {
    dialectLabel: 'SQLite',
    executeMethod: 'all' as const,
    normalizeTableName: (table: string) => (table.includes('.') ? table : `main.${table}`),
    ownerTables,
    sqliteAuthorizer: {
      constants: SQLITE_RAW_READ_CONSTANTS,
      openDatabase: () => ({
        close() {},
        prepare() {
          for (const table of observedTables) {
            authorize(SQLITE_RAW_READ_CONSTANTS.SQLITE_READ, table, 'id', 'main', null);
          }
        },
        setAuthorizer(
          callback: (
            action: number,
            objectName: string | null,
            columnName: string | null,
            databaseName: string | null,
            triggerOrView: string | null,
          ) => number,
        ) {
          authorize = callback;
        },
      }),
    },
  };
}

const RUNTIME_SQL_MATRIX_SINKS = [
  'execute',
  'query',
  'run',
  'get',
  'all',
  'values',
  'transaction',
  'with',
  'unknown-method',
] as const;

type RuntimeSqlMatrixSink = (typeof RUNTIME_SQL_MATRIX_SINKS)[number];

const RUNTIME_SQL_MATRIX_DIALECTS = [
  {
    dialect: undefined,
    name: 'pglite',
    read: { text: 'select id from products where id = $1', values: ['p1'] },
    write: { text: 'update users set name = $1 where id = $2', values: ['Ada', 'u1'] },
  },
  {
    dialect: 'sqlite' as const,
    name: 'better-sqlite3-style',
    read: { sql: 'select id from products where id = ?', values: ['p1'] },
    write: { sql: 'delete from users where id = ?', values: ['u1'] },
  },
  {
    dialect: undefined,
    name: 'unknown synthetic',
    read: { text: 'select id from products where id = $1', values: ['p1'] },
    write: { text: 'insert into users (id) values ($1)', values: ['u1'] },
  },
] as const;

function runtimeSqlMatrixRawDb(
  dialectName: string,
  sink: RuntimeSqlMatrixSink,
  log: string[],
): object {
  const methodName = sink === 'unknown-method' ? 'futureStatement' : sink;
  const directMethod = (statement: unknown) => {
    log.push(`${dialectName}.${methodName}`);
    return statement;
  };

  if (sink === 'transaction') {
    return {
      transaction(callback: (tx: { execute(statement: unknown): unknown }) => unknown) {
        log.push(`${dialectName}.transaction`);
        return callback({
          execute(statement: unknown) {
            log.push(`${dialectName}.transaction.execute`);
            return statement;
          },
        });
      },
    };
  }

  if (sink === 'with') {
    return {
      with(_cte: unknown) {
        log.push(`${dialectName}.with`);
        return {
          execute(statement: unknown) {
            log.push(`${dialectName}.with.execute`);
            return statement;
          },
          select() {
            log.push(`${dialectName}.with.select`);
            return { from: () => [] };
          },
        };
      },
    };
  }

  return { [methodName]: directMethod };
}

function executeRuntimeSqlMatrixSink(
  handle: Record<string, unknown>,
  sink: RuntimeSqlMatrixSink,
  statement: unknown,
): unknown {
  if (sink === 'transaction') {
    return (
      handle as {
        transaction(callback: (tx: { execute(statement: unknown): unknown }) => unknown): unknown;
      }
    ).transaction((tx) => tx.execute(statement));
  }
  if (sink === 'with') {
    return (
      handle as {
        with(cte: unknown): { execute(statement: unknown): unknown };
      }
    )
      .with('active_products')
      .execute(statement);
  }
  const method = sink === 'unknown-method' ? 'futureStatement' : sink;
  return (handle as Record<string, (statement: unknown) => unknown>)[method]!(statement);
}

function runtimeSqlMatrixStatementExecutionLog(
  log: readonly string[],
  sink: RuntimeSqlMatrixSink,
): string[] {
  if (sink === 'transaction') return log.filter((entry) => entry.endsWith('.transaction.execute'));
  if (sink === 'with') return log.filter((entry) => entry.endsWith('.with.execute'));
  const method = sink === 'unknown-method' ? 'futureStatement' : sink;
  return log.filter((entry) => entry.endsWith(`.${method}`));
}

describe('readonlyDb (KV433 Stage 1 runtime proxy)', () => {
  it('typechecks Reader<Db> as a read-only capability surface', () => {
    const root = mkdtempSync(join(process.cwd(), 'packages/server/.tmp-reader-types-'));
    try {
      writeFileSync(
        join(root, 'reader-type-proof.ts'),
        `
import { declarePublicRead, readonlyDb, type Reader } from '@kovojs/server';

type FakeDb = {
  $client: { execute(statement: unknown): Promise<unknown> };
  all(statement: unknown): Promise<unknown>;
  get(statement: unknown): Promise<unknown>;
  insert(table: string): { values(value: unknown): Promise<void> };
  select(): { from(table: string): Promise<unknown[]> };
  transaction<Result>(callback: (tx: FakeDb) => Promise<Result>): Promise<Result>;
  update(table: string): { set(value: unknown): { where(value: unknown): Promise<void> } };
  values(statement: unknown): Promise<unknown[]>;
  with(cte: unknown): {
    select(): { from(table: string): Promise<unknown[]> };
    update(table: string): { set(value: unknown): Promise<void> };
  };
};

declare const raw: FakeDb;

const reader = readonlyDb(raw);
const acceptsReader = (db: Reader<FakeDb>) => db;
acceptsReader(reader);

reader.select().from('products');
reader.with('active').select().from('products');
reader.rawRead({ sql: 'select id from products', values: [] }, { reads: ['products'] });
reader.rawRead(
  { sql: 'select id from products where published = 1', values: [] },
  {
    declarePublicRead: declarePublicRead({
      reason: 'published catalog',
      rows: { predicate: 'published = true', table: 'products' },
      columns: ['id'],
    }),
    reads: ['products'],
  },
);

// @ts-expect-error SPEC §6.6/§9.4/§10.3: raw provider handles lack the Reader brand.
acceptsReader(raw);
// @ts-expect-error SPEC §9.4/KV433: Reader<Db> hides callable raw query handles.
reader.query({ text: 'select 1', values: [] });
// @ts-expect-error SPEC §9.4/KV433: Reader<Db> hides write builders.
reader.insert('products');
// @ts-expect-error SPEC §9.4/KV433: Reader<Db> hides write builders.
reader.update('products');
// @ts-expect-error SPEC §9.4/KV433: Reader<Db> hides transaction openers.
reader.transaction(async () => undefined);
// @ts-expect-error SPEC §9.4/KV433: Reader<Db> hides raw driver escape handles.
void reader.$client;
// @ts-expect-error SPEC §9.4/KV433: Reader<Db> hides dialect/raw SQL sinks by default.
reader.all({ text: 'select 1', values: [] });
// @ts-expect-error SPEC §9.4/KV433: Reader<Db> hides SQLite .get sinks by default.
reader.get({ sql: 'select 1', values: [] });
// @ts-expect-error SPEC §9.4/KV433: Reader<Db> hides SQLite .values sinks by default.
reader.values({ sql: 'select 1', values: [] });
// @ts-expect-error SPEC §9.4/KV433: Reader<Db> narrows CTE-prefixed builders to reads.
reader.with('active').update('products');

type RelationalDb = {
  query: {
    products: {
      findMany(): Promise<unknown[]>;
    };
  };
};

declare const relationalRaw: RelationalDb;
readonlyDb(relationalRaw).query.products.findMany();

`,
        'utf8',
      );
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              exactOptionalPropertyTypes: true,
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              noEmit: true,
              noUncheckedIndexedAccess: true,
              skipLibCheck: true,
              strict: true,
              target: 'ES2024',
              types: ['node'],
              verbatimModuleSyntax: true,
            },
            include: ['reader-type-proof.ts'],
          },
          null,
          2,
        ),
        'utf8',
      );

      expect(() =>
        execFileSyncWithDiagnostics(resolveBin('tsc'), ['-p', join(root, 'tsconfig.json')], {
          cwd: process.cwd(),
          stdio: 'pipe',
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('typechecks Writer<Db> as a framework-managed write capability surface', () => {
    const root = mkdtempSync(join(process.cwd(), 'packages/server/.tmp-writer-types-'));
    try {
      writeFileSync(
        join(root, 'writer-type-proof.ts'),
        `
import { managedDb, type Writer } from '../src/managed-db.js';
import { managedSqlExecutionPolicy, wrapManagedDbForSqlSafety } from '../src/sql-safe-handle.js';

type FakeDb = {
  execute(statement: unknown): Promise<unknown>;
  insert(table: string): { values(value: unknown): Promise<void> };
  select(): { from(table: string): Promise<unknown[]> };
  update(table: string): { set(value: unknown): { where(value: unknown): Promise<void> } };
};

declare const raw: FakeDb;

const writer = managedDb(raw, 'write');
const acceptsWriter = (db: Writer<FakeDb>) => db;
const acceptsRawSurface = (db: FakeDb) => db;
const executionPolicy = managedSqlExecutionPolicy({ capability: 'write' });

acceptsWriter(writer);
acceptsRawSurface(writer);
writer.insert('products');
writer.update('products');
wrapManagedDbForSqlSafety(raw, undefined, executionPolicy);

// @ts-expect-error SPEC §10.3/§11.2 DEC-E: raw provider handles lack the Writer brand.
acceptsWriter(raw);
// @ts-expect-error SPEC §10.2/§10.3/§11.2 DEC-E: plain structural policy objects cannot reach DB exec wrapping.
wrapManagedDbForSqlSafety(raw, undefined, { capability: 'write' });

`,
        'utf8',
      );
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              exactOptionalPropertyTypes: true,
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              noEmit: true,
              noUncheckedIndexedAccess: true,
              skipLibCheck: true,
              strict: true,
              target: 'ES2024',
              types: ['node'],
              verbatimModuleSyntax: true,
            },
            include: ['writer-type-proof.ts'],
          },
          null,
          2,
        ),
        'utf8',
      );

      expect(() =>
        execFileSyncWithDiagnostics(resolveBin('tsc'), ['-p', join(root, 'tsconfig.json')], {
          cwd: process.cwd(),
          stdio: 'pipe',
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('brands Reader<Db> so raw write handles are not casually assignable', () => {
    type FakeDb = ReturnType<typeof fakeDb>;
    const raw = fakeDb([]);
    const reader = readonlyDb(raw);
    const acceptsReader = (db: Reader<FakeDb>) => db;

    expect(acceptsReader(reader)).toBe(reader);

    // SPEC §6.6: this is type-level ergonomics only; casts/any can defeat it, so the runtime proxy
    // and static KV433 gate remain authoritative.
    const compileOnly = () => {
      // @ts-expect-error raw provider handles lack the module-private Reader brand.
      acceptsReader(raw);
      // @ts-expect-error Reader<Db> hides write verbs on framework-owned read surfaces.
      reader.insert('products');
      // @ts-expect-error Reader<Db> hides future/dialect SQL sinks by default.
      reader.all({ text: 'select 1', values: [] });
      // @ts-expect-error Reader<Db> hides SQLite .get sinks by default.
      reader.get({ text: 'select 1', values: [] });
      // @ts-expect-error Reader<Db> hides callable raw query handles by default.
      reader.query({ text: 'select 1', values: [] });
      // @ts-expect-error Reader<Db> hides SQLite .values sinks by default.
      reader.values({ text: 'select 1', values: [] });
      const withReader = readonlyDb({
        select() {
          return 'select';
        },
        with(_cte: string) {
          return {
            select() {
              return 'with-select';
            },
            update() {
              return 'with-update';
            },
          };
        },
      });
      withReader.with('active').select();
      // @ts-expect-error Reader<Db> narrows CTE-prefixed builders to read methods.
      withReader.with('active').update();
      const readHandle = managedDb(raw, 'read');
      acceptsReader(readHandle);
      // @ts-expect-error managedDb(..., 'read') returns the branded read-only surface.
      readHandle.update('products');
      // @ts-expect-error managedDb(..., 'read') does not expose callable raw query handles.
      readHandle.query({ text: 'select 1', values: [] });
      // @ts-expect-error managedDb(..., 'read') exposes only the read capability allowlist.
      readHandle.transaction(() => undefined);
      // @ts-expect-error managedDb(..., 'read') does not expose raw driver escape handles.
      void readHandle.$client;
      const writeHandle = managedDb(raw, 'write');
      const acceptsWriter = (db: Writer<FakeDb>) => db;
      acceptsWriter(writeHandle);
      writeHandle.insert('products');
      // @ts-expect-error raw provider handles lack the module-private Writer brand.
      acceptsWriter(raw);
    };
    void compileOnly;
  });

  it('throws KovoReadonlyHandleError on non-SQL read capability properties', () => {
    const reader = readonlyDb(fakeDb([]));
    for (const verb of [
      'batch',
      'delete',
      'insert',
      'session',
      'transaction',
      'update',
      '$client',
    ] as const) {
      const method = (reader as Record<string, unknown>)[verb];
      expect(typeof method).toBe('function');
      expect(() => (method as () => unknown)()).toThrow(KovoReadonlyHandleError);
    }
  });

  it('denies root raw/FROM-source read methods even when the target exposes them', () => {
    const log: string[] = [];
    const reader = readonlyDb(fakeDb(log)) as unknown as Record<
      'all' | 'exec' | 'execute' | 'futureStatement' | 'get' | 'prepare' | 'run' | 'sql' | 'values',
      (statement: unknown) => Promise<unknown>
    >;

    for (const method of [
      'all',
      'exec',
      'execute',
      'futureStatement',
      'get',
      'prepare',
      'run',
      'sql',
      'values',
    ] as const) {
      expect(() =>
        reader[method](
          stampTrustedSql(
            { sql: 'select id from products where id = ?', values: ['p1'] },
            `${method} read-handle raw read attempt`,
          ),
        ),
      ).toThrow(/KV433/);
    }
    expect(log).toEqual([]);
  });

  it('executes declared rawRead statements after SQLite observed-set verification', async () => {
    const log: string[] = [];
    const reader = readonlyDb(fakeDb(log), {
      rawRead: sqliteRawReadPolicy(['products']),
    });
    const rows = await reader.rawRead<{ id: string }>(
      stampTrustedSql({ sql: 'select id from products where id = ?', values: ['p1'] }, 'rawRead'),
      { reads: ['products'] },
    );

    expect(rows).toMatchObject({ text: 'select id from products where id = ?' });
    expect(log).toEqual(['all']);
  });

  it('rejects SQLite rawRead statements whose observed tables exceed declared reads', () => {
    const log: string[] = [];
    const reader = readonlyDb(fakeDb(log), {
      rawRead: sqliteRawReadPolicy(['products', 'accounts']),
    });

    expect(() =>
      reader.rawRead(
        stampTrustedSql({ sql: 'select id from products', values: [] }, 'underdeclared rawRead'),
        { reads: ['products'] },
      ),
    ).toThrow(/KV410[\s\S]*outside the declared reads set/);
    expect(log).toEqual([]);
  });

  it('rejects owner-table SQLite rawRead statements without an explicit scope', async () => {
    const log: string[] = [];
    const reader = readonlyDb(fakeDb(log), {
      rawRead: sqliteRawReadPolicy(['orders'], ['orders']),
    });

    const statement = stampTrustedSql(
      { sql: 'select id from orders where id = ?', values: ['o1'] },
      'owner rawRead',
    );
    expect(() => reader.rawRead(statement, { reads: ['orders'] })).toThrow(
      /KV414[\s\S]*requires actAs or declarePublicRead/,
    );
    await expect(
      reader.rawRead(statement, { actAs: 'user-1', reads: ['orders'] }),
    ).resolves.toMatchObject({
      text: 'select id from orders where id = ?',
    });
    expect(log).toEqual(['all']);
  });

  it('validates and audits scoped public rawRead declarations', async () => {
    drainPublicReadAuditFacts();
    expect(() => declarePublicRead({ reason: '' })).toThrow(/non-empty reason/);
    expect(() =>
      declarePublicRead({ reason: 'published orders', rows: { predicate: ' ' } }),
    ).toThrow(/rows scope/);
    expect(() => declarePublicRead({ columns: ['id', ' '], reason: 'published orders' })).toThrow(
      /columns scope/,
    );

    const log: string[] = [];
    const reader = readonlyDb(fakeDb(log), {
      rawRead: sqliteRawReadPolicy(['orders'], ['orders']),
    });
    const statement = stampTrustedSql(
      { sql: 'select id, status from orders where published = 1', values: [] },
      'public owner rawRead',
    );
    await expect(
      reader.rawRead(statement, {
        declarePublicRead: declarePublicRead({
          columns: ['id', 'status', 'id'],
          reason: 'published order status page',
          rows: { predicate: 'published = true', table: 'orders' },
        }),
        reads: ['orders'],
      }),
    ).resolves.toMatchObject({
      text: 'select id, status from orders where published = 1',
    });

    expect(drainPublicReadAuditFacts()).toEqual([
      {
        columns: ['id', 'status'],
        declaredReads: ['main.orders'],
        dialectLabel: 'SQLite',
        observedReads: ['main.orders'],
        ownerReads: ['main.orders'],
        reason: 'published order status page',
        rows: { predicate: 'published = true', table: 'orders' },
      },
    ]);
    expect(log).toEqual(['all']);
  });

  it('audits Postgres public rawRead declarations while preserving the scoped read-only client path', async () => {
    drainPublicReadAuditFacts();
    const log: string[] = [];
    const reader = readonlyDb(fakeDb(log), {
      rawRead: {
        dialectLabel: 'Postgres',
        executeMethod: 'query',
        normalizeTableName: (table) => table,
        ownerTables: ['orders'],
      },
    });

    await expect(
      reader.rawRead(
        stampTrustedSql(
          { sql: 'select id from orders where published = true', values: [] },
          'public postgres owner rawRead',
        ),
        {
          declarePublicRead: declarePublicRead({
            columns: ['id'],
            reason: 'published order index',
            rows: 'published = true',
          }),
          reads: ['orders'],
        },
      ),
    ).resolves.toMatchObject({
      text: 'select id from orders where published = true',
    });

    expect(drainPublicReadAuditFacts()).toEqual([
      {
        columns: ['id'],
        declaredReads: ['orders'],
        dialectLabel: 'Postgres',
        reason: 'published order index',
        rows: 'published = true',
      },
    ]);
    expect(log).toEqual(['query']);
  });

  it('bounds normal public rawRead observations to the newest 256 facts', async () => {
    drainPublicReadAuditFacts();
    const reader = readonlyDb(
      {
        query(statement: unknown) {
          return Promise.resolve([statement]);
        },
      },
      {
        rawRead: {
          dialectLabel: 'Postgres',
          executeMethod: 'query',
          normalizeTableName: (table) => table,
          ownerTables: ['orders'],
        },
      },
    );
    const statement = stampTrustedSql(
      { sql: 'select id from orders where published = true', values: [] },
      'bounded public rawRead',
    );

    for (let index = 0; index < 10_000; index += 1) {
      await reader.rawRead(statement, {
        declarePublicRead: declarePublicRead({ reason: `bounded public read ${index}` }),
        reads: ['orders'],
      });
    }

    const facts = drainPublicReadAuditFacts();
    expect(facts).toHaveLength(256);
    expect(facts[0]).toMatchObject({ reason: 'bounded public read 9744' });
    expect(facts.at(-1)).toMatchObject({ reason: 'bounded public read 9999' });
    expect(drainPublicReadAuditFacts()).toEqual([]);
  });

  it('rawRead reconstructs a plain carrier and never forwards submit-bearing app values', async () => {
    const observed: unknown[] = [];
    const reader = readonlyDb(
      {
        query(statement: unknown) {
          observed.push(statement);
          return Promise.resolve([statement]);
        },
      },
      {
        rawRead: {
          dialectLabel: 'Postgres',
          executeMethod: 'query',
          normalizeTableName: (table) => table,
        },
      },
    );

    expect(() =>
      reader.rawRead(
        {
          submit() {
            throw new Error('out-of-band SQL executed');
          },
          text: 'select id from products where id = $1',
          values: ['p1'],
        },
        { reads: ['products'] },
      ),
    ).toThrow(/submit-bearing[\s\S]*SPEC §10\.3/);
    expect(observed).toEqual([]);

    const carrier = { text: 'select id from products where id = $1', values: ['p1'] };
    await expect(reader.rawRead(carrier, { reads: ['products'] })).resolves.toHaveLength(1);
    expect(observed[0]).not.toBe(carrier);
    expect(observed[0]).toMatchObject({
      text: 'select id from products where id = $1',
      values: ['p1'],
    });
  });

  it('crossOwnerRead reconstructs the admin-client carrier and refuses submit-bearing app values', async () => {
    const observed: unknown[] = [];
    const adminClient = {
      query(statement: unknown) {
        observed.push(statement);
        return Promise.resolve([statement]);
      },
    };
    const reader = managedDb(fakeDb([]), 'read', {
      crossOwnerRead: {
        adminClient,
        dialectLabel: 'Postgres',
        executeMethod: 'query',
        hasRole: (role) => role === 'admin',
        normalizeTableName: (table) => table,
        ownerTables: ['orders'],
      },
    }) as unknown as {
      crossOwnerRead(
        statement: unknown,
        declaration: { reads: readonly string[]; reason: string; role: 'admin' },
      ): Promise<unknown>;
    };

    const declaration = {
      reads: ['orders'],
      reason: 'admin support lookup',
      role: 'admin' as const,
    };
    expect(() =>
      reader.crossOwnerRead(
        {
          submit() {
            throw new Error('out-of-band SQL executed');
          },
          text: 'select id from orders where id = $1',
          values: ['o1'],
        },
        declaration,
      ),
    ).toThrow(/submit-bearing[\s\S]*SPEC §10\.3/);
    expect(observed).toEqual([]);

    const carrier = { text: 'select id from orders where id = $1', values: ['o1'] };
    await expect(reader.crossOwnerRead(carrier, declaration)).resolves.toEqual([
      { text: 'select id from orders where id = $1', values: ['o1'] },
    ]);
    expect(observed[0]).not.toBe(carrier);
    expect(observed).toEqual([{ text: 'select id from orders where id = $1', values: ['o1'] }]);
  });

  it('passes reads through unchanged', async () => {
    const log: string[] = [];
    const reader = readonlyDb(fakeDb(log));
    const rows = await reader.select().from('products');
    expect(rows).toEqual([{ id: 'p1' }]);
    expect(log).toEqual(['select:products']);
  });

  it('preserves builder terminals returned after select().from()', () => {
    const log: string[] = [];
    const raw = {
      all(statement: unknown) {
        log.push(`root.all:${String(statement)}`);
        return [];
      },
      select() {
        log.push('select');
        return {
          from(table: string) {
            log.push(`from:${table}`);
            return {
              all() {
                log.push('builder.all');
                return [{ id: 'p1' }];
              },
            };
          },
        };
      },
    };
    const reader = readonlyDb(raw) as unknown as typeof raw;

    expect(() =>
      reader.all(stampTrustedSql({ sql: 'select id from products' }, 'root all raw read')),
    ).toThrow(/KV433/);
    expect(reader.select().from('products').all()).toEqual([{ id: 'p1' }]);
    expect(log).toEqual(['select', 'from:products', 'builder.all']);
  });

  it('denies callable raw query while preserving relational query namespaces', async () => {
    const log: string[] = [];
    const callableReader = readonlyDb(fakeDb(log)) as unknown as {
      query(statement: unknown): Promise<unknown>;
    };

    expect(() =>
      callableReader.query({ sql: 'select id from products where id = ?', values: ['p1'] }),
    ).toThrow(/KV433/);
    expect(() =>
      callableReader.query(
        stampTrustedSql(
          { sql: 'delete from products where id = ? returning id', values: ['p1'] },
          'attempted public read-handle write',
        ),
      ),
    ).toThrow(/KV433/);
    expect(log).toEqual([]);

    const relationalRaw = {
      query: {
        users: {
          findMany() {
            log.push('query.users.findMany');
            return Promise.resolve([{ id: 'u1' }]);
          },
        },
      },
    };
    await expect(readonlyDb(relationalRaw).query.users.findMany()).resolves.toEqual([{ id: 'u1' }]);
    expect(log).toEqual(['query.users.findMany']);
  });

  it('binds allowed read methods to the wrapped DB target', async () => {
    const log: string[] = [];
    let authorize = (
      _action: number,
      _objectName: string | null,
      _columnName: string | null,
      _databaseName: string | null,
      _triggerOrView: string | null,
    ) => constants.SQLITE_OK;
    const raw = {
      select() {
        if (this !== raw) throw new Error('select this binding was not preserved');
        return {
          from(table: string) {
            log.push(`select:${table}`);
            return Promise.resolve([{ id: 'p1' }]);
          },
        };
      },
    };
    const rows = await readonlyDb(raw).select().from('products');
    expect(rows).toEqual([{ id: 'p1' }]);
    expect(log).toEqual(['select:products']);
  });

  it('does not expose then as a denied capability', async () => {
    const reader = readonlyDb(fakeDb([]));
    expect((reader as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(Promise.resolve(reader)).resolves.toBe(reader);
  });
});

describe('managedDb (KV422 SQL-safe unified with KV433 read-only)', () => {
  it('rejects untrusted sql.raw fragments across managed Drizzle builder fast paths', () => {
    const log: string[] = [];
    const builder = {
      from(table: unknown) {
        log.push(`from:${String(table)}`);
        return this;
      },
      orderBy(value: unknown) {
        const resolved = typeof value === 'function' ? value({}) : value;
        log.push(`orderBy:${String(resolved)}`);
        return [];
      },
      where(value: unknown) {
        log.push(`where:${String(value)}`);
        return this;
      },
    };
    const raw = {
      select(projection?: unknown) {
        log.push(`select:${projection === undefined ? 'all' : 'projection'}`);
        return builder;
      },
    };
    const handle = managedDb(raw, 'write') as unknown as typeof raw;

    expect(() => handle.select({ unsafe: sql.raw('count(*)') })).toThrow(/KV422[\s\S]*sql\.raw/);
    expect(() => handle.select().from('products').where(sql.raw('1 = 1'))).toThrow(
      /KV422[\s\S]*sql\.raw/,
    );
    expect(() =>
      handle
        .select()
        .from('products')
        .orderBy(() => sql.raw('created_at desc')),
    ).toThrow(/KV422[\s\S]*sql\.raw/);
    expect(log).not.toEqual(expect.arrayContaining([expect.stringContaining('orderBy:')]));
  });

  it('keeps static/allowlisted builders green and requires trustedSql for raw builder chunks', () => {
    const accepted: unknown[] = [];
    const builder = {
      from(_table: unknown) {
        return this;
      },
      orderBy(value: unknown) {
        accepted.push(value);
        return [];
      },
    };
    const raw = { select: () => builder };
    const handle = managedDb(raw, 'write') as unknown as typeof raw;

    expect(
      handle
        .select()
        .from('products')
        .orderBy(staticSql`created_at desc`),
    ).toEqual([]);
    expect(
      handle
        .select()
        .from('products')
        .orderBy(sql.identifier('created_at', { allow: ['created_at'] })),
    ).toEqual([]);
    expect(
      handle
        .select()
        .from('products')
        .orderBy(
          trustedSql(sql.raw('created_at desc'), {
            justification: 'reviewed fixed report ordering',
          }),
        ),
    ).toEqual([]);
    expect(accepted).toHaveLength(3);
  });

  it('denies schema tables with no DEC-K classification at the managed builder boundary', () => {
    const log: string[] = [];
    const raw = {
      select() {
        return {
          from(table: { name: string }) {
            log.push(`select:${table.name}`);
            return [];
          },
          leftJoin(table: { name: string }) {
            log.push(`leftJoin:${table.name}`);
            return [];
          },
        };
      },
      insert(table: { name: string }) {
        log.push(`insert:${table.name}`);
        return { values: () => undefined };
      },
    };
    const handle = createAuthorizationCensusDb(raw, {
      dialectLabel: 'PGlite',
      metadata: {
        authorizationClassificationsByTable: new Map([
          ['contacts', ['authzPolicy']],
          ['reference_tags', ['reference']],
          ['published_posts', ['public']],
        ]),
        schemaTableNames: new Set(['contacts', 'reference_tags', 'published_posts', 'drafts']),
      },
      normalizeTableName: (table) => (table.includes('.') ? table : `public.${table}`),
      tableNames: (table) => [(table as { name: string }).name],
    });

    expect(handle.select().from({ name: 'contacts' })).toEqual([]);
    expect(handle.select().from({ name: 'reference_tags' })).toEqual([]);
    expect(handle.select().leftJoin({ name: 'published_posts' })).toEqual([]);
    expect(() => handle.select().from({ name: 'drafts' })).toThrow(
      /KV414[\s\S]*drafts[\s\S]*no authorization classification/,
    );
    expect(() => handle.insert({ name: 'drafts' }).values()).toThrow(/KV414/);
    expect(log).toEqual(['select:contacts', 'select:reference_tags', 'leftJoin:published_posts']);
  });

  // @kovo-security-certifies KV414 postgres-reader-grant-default-deny
  it('proves Postgres reader grants default-deny unclassified tables while RLS scopes owner reads', async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        CREATE ROLE ${POSTGRES_READER_ROLE};
        CREATE TABLE orders (id text PRIMARY KEY, user_id text NOT NULL, label text NOT NULL);
        CREATE TABLE verification (
          id text PRIMARY KEY,
          identifier text NOT NULL,
          value text NOT NULL,
          "expiresAt" integer NOT NULL
        );
        INSERT INTO orders (id, user_id, label) VALUES
          ('own-row', 'demo-user', 'owned'),
          ('other-row', 'other-user', 'blocked');
        INSERT INTO verification (id, identifier, value, "expiresAt")
          VALUES ('v1', 'demo-user', 'secret-token', 1);
        REVOKE ALL ON TABLE orders FROM PUBLIC;
        REVOKE ALL ON TABLE verification FROM PUBLIC;
        REVOKE ALL ON TABLE orders FROM ${POSTGRES_READER_ROLE};
        REVOKE ALL ON TABLE verification FROM ${POSTGRES_READER_ROLE};
        GRANT SELECT (id, user_id, label) ON TABLE orders TO ${POSTGRES_READER_ROLE};
        ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
        ALTER TABLE orders FORCE ROW LEVEL SECURITY;
        CREATE POLICY kovo_owner_scope ON orders
          FOR SELECT TO ${POSTGRES_READER_ROLE}
          USING (user_id = current_setting('kovo.principal', true));
      `);

      await expect(
        runAsPostgresReader(client, 'SELECT id, label FROM orders ORDER BY id'),
      ).resolves.toEqual([{ id: 'own-row', label: 'owned' }]);

      await expect(runAsPostgresReader(client, 'SELECT id FROM verification')).rejects.toThrow(
        /permission denied for table verification/u,
      );
    } finally {
      await client.close();
    }
  });

  // @kovo-security-certifies KV406 postgres-writer-grant-default-deny
  it('proves Postgres writer grants default-deny unclassified tables while RLS bounds owner writes', async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        CREATE ROLE ${POSTGRES_WRITER_ROLE};
        CREATE TABLE orders (id text PRIMARY KEY, user_id text NOT NULL, label text NOT NULL);
        CREATE TABLE verification (
          id text PRIMARY KEY,
          identifier text NOT NULL,
          value text NOT NULL,
          "expiresAt" integer NOT NULL
        );
        REVOKE ALL ON TABLE orders FROM PUBLIC;
        REVOKE ALL ON TABLE verification FROM PUBLIC;
        REVOKE ALL ON TABLE orders FROM ${POSTGRES_WRITER_ROLE};
        REVOKE ALL ON TABLE verification FROM ${POSTGRES_WRITER_ROLE};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE orders TO ${POSTGRES_WRITER_ROLE};
        ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
        ALTER TABLE orders FORCE ROW LEVEL SECURITY;
        CREATE POLICY kovo_owner_scope ON orders
          FOR ALL TO ${POSTGRES_WRITER_ROLE}
          USING (user_id = current_setting('kovo.principal', true))
          WITH CHECK (user_id = current_setting('kovo.principal', true));
      `);

      await expect(
        runAsPostgresWriter(
          client,
          "INSERT INTO orders (id, user_id, label) VALUES ('own-row', 'demo-user', 'owned')",
        ),
      ).resolves.toBeUndefined();

      await expect(
        runAsPostgresWriter(
          client,
          "INSERT INTO verification (id, identifier, value, \"expiresAt\") VALUES ('v1', 'demo-user', 'forged', 1)",
        ),
      ).rejects.toThrow(/permission denied for table verification/u);

      await expect(
        runAsPostgresWriter(
          client,
          "INSERT INTO orders (id, user_id, label) VALUES ('cross-owner', 'other-user', 'blocked')",
        ),
      ).rejects.toThrow(/violates row-level security policy/u);

      await expect(
        runAsPostgresWriter(
          client,
          "UPDATE orders SET user_id = 'other-user' WHERE id = 'own-row'",
        ),
      ).rejects.toThrow(/violates row-level security policy/u);
    } finally {
      await client.close();
    }
  });

  it('does not census-deny unknown framework or driver tables outside the schema metadata', () => {
    const log: string[] = [];
    const handle = createAuthorizationCensusDb(
      {
        select() {
          return {
            from(table: { name: string }) {
              log.push(`select:${table.name}`);
              return [];
            },
          };
        },
      },
      {
        dialectLabel: 'PGlite',
        metadata: {
          authorizationClassificationsByTable: new Map(),
          schemaTableNames: new Set(['drafts']),
        },
        normalizeTableName: (table) => (table.includes('.') ? table : `public.${table}`),
        tableNames: (table) => [(table as { name: string }).name],
      },
    );

    expect(handle.select().from({ name: '_kovo_jobs' })).toEqual([]);
    expect(log).toEqual(['select:_kovo_jobs']);
  });

  it('rejects forged direct SQL wrapper policies before exposing DB exec', () => {
    const log: string[] = [];
    const raw = {
      execute(statement: unknown) {
        log.push('execute');
        return statement;
      },
    };

    expect(() =>
      wrapManagedDbForSqlSafety(raw, undefined, {
        capability: 'write',
      } as never),
    ).toThrow(/framework-owned constructor/);
    expect(log).toEqual([]);

    const minted = managedSqlExecutionPolicy({ capability: 'write' });
    expect(() => wrapManagedDbForSqlSafety(raw, undefined, { ...minted } as never)).toThrow(
      /framework-owned constructor/,
    );
    expect(log).toEqual([]);

    const handle = wrapManagedDbForSqlSafety(raw, undefined, minted);
    expect(
      (handle as { execute(statement: unknown): unknown }).execute({
        text: 'select $1',
        values: [1],
      }),
    ).toMatchObject({ text: 'select $1' });
    expect(log).toEqual(['execute']);
  });

  it('read mode rejects writes AND callable raw query handles', () => {
    const handle = managedDb(fakeDb([]), 'read');
    // KV433: write verb throws the readonly error.
    expect(() => (handle as unknown as { insert(t: string): unknown }).insert('products')).toThrow(
      KovoReadonlyHandleError,
    );
    // DEC-C: callable root query() is a FROM-source raw read and is outside the strict allowlist.
    expect(() => (handle as { query(s: unknown): unknown }).query('SELECT 1')).toThrow(/KV433/);
  });

  it('read mode denies callable query while preserving builder reads', async () => {
    const handle = managedDb(fakeDb([]), 'read', {
      sqlWritePolicy: { dialect: 'sqlite' },
    });

    expect(() =>
      (handle as { query(s: unknown): unknown }).query(
        stampTrustedSql(
          { sql: 'delete from products where id = ? returning id', values: ['p1'] },
          'attempted read-surface write',
        ),
      ),
    ).toThrow(/KV433/);
    expect(() =>
      (handle as { query(s: unknown): unknown }).query({
        sql: 'select id from products where id = ?',
        values: ['p1'],
      }),
    ).toThrow(/KV433/);

    await expect(
      (handle as unknown as ReturnType<typeof fakeDb>).select().from('products'),
    ).resolves.toEqual([{ id: 'p1' }]);
  });

  it('uses a dedicated engine read-only target without exposing its callable query sink', async () => {
    const log: string[] = [];
    const raw = {
      readonlyState: false,
      [kovoReadonlyDbHandle]() {
        log.push('readonly-target-created');
        return {
          query(statement: unknown) {
            log.push('readonly.query');
            if (
              typeof statement === 'object' &&
              statement !== null &&
              'text' in statement &&
              String((statement as { text: unknown }).text).includes('setval')
            ) {
              throw new Error('cannot execute setval in a read-only transaction');
            }
            return Promise.resolve(statement);
          },
        };
      },
      insert(table: string) {
        log.push(`writer.insert:${table}:readonly=${String(this.readonlyState)}`);
        return { values: () => Promise.resolve() };
      },
      query(statement: unknown) {
        log.push('writer.query');
        return Promise.resolve(statement);
      },
    };

    const reader = managedDb(raw, 'read') as unknown as {
      query(statement: unknown): Promise<unknown>;
    };
    expect(() =>
      reader.query({
        text: "select string_agg(name, ',') from contacts where created_at < date_trunc('day', now()) and id <> $1",
        values: ['archived'],
      }),
    ).toThrow(/KV433/);
    expect(() =>
      reader.query(
        stampTrustedSql({ text: "select setval('contact_id_seq', 1)" }, 'engine-readonly setval'),
      ),
    ).toThrow(/KV433/);

    const writer = managedDb(raw, 'write') as unknown as {
      insert(table: string): { values(): Promise<void> };
    };
    await expect(writer.insert('contacts').values()).resolves.toBeUndefined();

    expect(log).toEqual(['readonly-target-created', 'writer.insert:contacts:readonly=false']);
  });

  it('preserves adapter-provided read capabilities from the engine read-only hook', async () => {
    const log: string[] = [];
    const raw = {
      [kovoReadonlyDbHandle]() {
        log.push('readonly-target-created');
        return readonlyDb(fakeDb(log), {
          rawRead: {
            dialectLabel: 'Postgres',
            executeMethod: 'query',
            normalizeTableName: (table) => table,
          },
        });
      },
      query(statement: unknown) {
        log.push('writer.query');
        return Promise.resolve(statement);
      },
    };

    const reader = managedDb(raw, 'read') as unknown as {
      rawRead(statement: unknown, declaration: { reads: readonly string[] }): Promise<unknown>;
    };
    await expect(
      reader.rawRead(
        stampTrustedSql(
          { sql: 'select id from products where id = ?', values: ['p1'] },
          'adapter-provided rawRead capability',
        ),
        { reads: ['products'] },
      ),
    ).resolves.toMatchObject({ text: 'select id from products where id = ?' });

    expect(log).toEqual(['readonly-target-created', 'query']);
  });

  it('fails closed when an engine read-only hook returns the writer handle', () => {
    const raw = {
      [kovoReadonlyDbHandle]() {
        return raw;
      },
      query(statement: unknown) {
        return statement;
      },
    };

    expect(() => managedDb(raw, 'read')).toThrow(/KV433[\s\S]*dedicated engine read-only handle/);
  });

  it('read mode denies SQLite root sinks before execution', async () => {
    const log: string[] = [];
    const handle = managedDb(fakeDb(log), 'read', {
      sqlWritePolicy: { dialect: 'sqlite' },
    });

    const attempts = [
      {
        method: 'all',
        statement: { sql: 'delete from products where id = ? returning id', values: ['p1'] },
      },
      {
        method: 'get',
        statement: { sql: 'insert into products (id) values (?) returning id', values: ['p1'] },
      },
      {
        method: 'values',
        statement: { sql: 'update products set id = ? where id = ?', values: ['p2', 'p1'] },
      },
    ] as const;
    for (const { method, statement } of attempts) {
      expect(() =>
        (handle as unknown as Record<typeof method, (statement: unknown) => unknown>)[method](
          stampTrustedSql(statement, `${method} write attempt`),
        ),
      ).toThrow(/KV433/);
    }

    expect(() =>
      (handle as unknown as { all(statement: unknown): Promise<unknown> }).all({
        sql: 'select id from products where id = ?',
        values: ['p1'],
      }),
    ).toThrow(/KV433/);
    expect(() =>
      (
        handle as unknown as { transaction(callback: (tx: unknown) => unknown): unknown }
      ).transaction(() => {
        log.push('callback-entered');
      }),
    ).toThrow(KovoReadonlyHandleError);
    expect(log).toEqual([]);
  });

  it.each([
    {
      create(log: string[]) {
        return readonlyDb(fakeDb(log));
      },
      name: 'readonlyDb',
    },
    {
      create(log: string[]) {
        return managedDb(fakeDb(log), 'read', { sqlWritePolicy: { dialect: 'sqlite' } });
      },
      name: "managedDb('read')",
    },
  ])('$name denies SQLite read sinks and preserves builder terminals', async ({ create }) => {
    const log: string[] = [];
    const handle = create(log);

    const attempts = [
      {
        method: 'all',
        statement: { sql: 'delete from products where id = ? returning id', values: ['p1'] },
      },
      {
        method: 'get',
        statement: { sql: 'insert into products (id) values (?) returning id', values: ['p1'] },
      },
      {
        method: 'values',
        statement: { sql: 'replace into products (id) values (?)', values: ['p1'] },
      },
    ] as const;
    for (const { method, statement } of attempts) {
      expect(() =>
        (handle as unknown as Record<typeof method, (statement: unknown) => unknown>)[method](
          stampTrustedSql(statement, `${method} read-handle write attempt`),
        ),
      ).toThrow(/KV433/);
    }
    expect(() =>
      (handle as unknown as { get(statement: unknown): Promise<unknown> }).get({
        sql: 'select id from products where id = ?',
        values: ['p1'],
      }),
    ).toThrow(/KV433/);
    expect(() =>
      (
        handle as unknown as { transaction(callback: (tx: unknown) => unknown): unknown }
      ).transaction(() => {
        log.push('transaction-callback-entered');
      }),
    ).toThrow(KovoReadonlyHandleError);

    const rows = await (handle as unknown as ReturnType<typeof fakeDb>).select().from('products');
    expect(rows).toEqual([{ id: 'p1' }]);
    expect(log).toEqual(['select:products']);
  });

  it.each([
    {
      create(db: object) {
        return readonlyDb(db);
      },
      name: 'readonlyDb',
    },
    {
      create(db: object) {
        return managedDb(db, 'read', { sqlWritePolicy: { dialect: 'sqlite' } });
      },
      name: "managedDb('read')",
    },
  ])('$name denies raw driver escape properties and future root methods', async ({ create }) => {
    const log: string[] = [];
    const handle = create({
      $client: {
        execute(statement: unknown) {
          log.push(`$client:${String(statement)}`);
        },
      },
      session: {
        run(statement: unknown) {
          log.push(`session:${String(statement)}`);
        },
      },
      futureStatement(statement: unknown) {
        log.push(`futureStatement:${String(statement)}`);
        return statement;
      },
      select(): { from(table: string): Promise<FakeRow[]> } {
        return {
          from(table: string) {
            log.push(`select:${table}`);
            return Promise.resolve([{ id: 'p1' }]);
          },
        };
      },
    });

    expect(() => (handle as unknown as { $client(): unknown }).$client()).toThrow(
      KovoReadonlyHandleError,
    );
    expect(() => (handle as unknown as { session(): unknown }).session()).toThrow(
      KovoReadonlyHandleError,
    );
    expect(() =>
      (handle as unknown as { futureStatement(statement: unknown): unknown }).futureStatement(
        stampTrustedSql(
          { sql: 'delete from products where id = ? returning id', values: ['p1'] },
          'future read-handle write attempt',
        ),
      ),
    ).toThrow(/KV433/);
    expect(log).toEqual([]);

    expect(() =>
      (handle as unknown as { futureStatement(statement: unknown): unknown }).futureStatement({
        sql: 'select id from products where id = ?',
        values: ['p1'],
      }),
    ).toThrow(/KV433/);
    expect(log).toEqual([]);
  });

  it("managedDb('read') exposes only the read half of CTE-prefixed .with() builders", async () => {
    const log: string[] = [];
    const handle = managedDb(
      {
        with(_cte: unknown) {
          log.push('with');
          return {
            select() {
              log.push('with.select');
              return { from: () => Promise.resolve([{ id: 'p1' }]) };
            },
            update() {
              log.push('with.update');
              return { set: () => Promise.resolve() };
            },
          };
        },
      },
      'read',
      { sqlWritePolicy: { dialect: 'sqlite' } },
    ) as unknown as {
      with(cte: unknown): {
        select(): { from(table: string): Promise<FakeRow[]> };
        update(): { set(): Promise<void> };
      };
    };

    await expect(handle.with('active').select().from('products')).resolves.toEqual([{ id: 'p1' }]);
    expect(() => handle.with('active').update()).toThrow(/KV433/);
    expect(log).toEqual(['with', 'with.select', 'with']);
  });

  it('wrapManagedDbForSqlSafety read capability blocks write builders and transactions directly', async () => {
    const log: string[] = [];
    const raw = {
      ...fakeDb(log),
      with(..._args: unknown[]) {
        log.push('with');
        return {
          select() {
            log.push('with.select');
            return { from: () => Promise.resolve([]) };
          },
          update() {
            log.push('with.update');
            return { set: () => Promise.resolve() };
          },
        };
      },
    };
    const handle = wrapManagedDbForSqlSafety(
      raw,
      undefined,
      managedSqlExecutionPolicy({
        capability: 'read',
        dialect: 'sqlite',
      }),
    );

    expect(() => handle.insert('products')).toThrow(/unknown managed DB method db\.insert|KV422/);
    expect(() => handle.update('products')).toThrow(/unknown managed DB method db\.update|KV422/);
    expect(() => handle.delete('products')).toThrow(/unknown managed DB method db\.delete|KV422/);
    expect(() =>
      handle.transaction(() => {
        log.push('transaction-callback-entered');
      }),
    ).toThrow(/KV433/);
    expect(log).toEqual([]);

    const withBuilder = handle.with('cte');
    await expect(withBuilder.select().from('products')).resolves.toEqual([]);
    expect(() => withBuilder.update()).toThrow(/KV433/);
    expect(log).toEqual(['with', 'with.select']);

    await expect(
      handle.all({ sql: 'select id from products where id = ?', values: ['p1'] }),
    ).resolves.toMatchObject({ text: 'select id from products where id = ?' });
    expect(() =>
      handle.all(
        stampTrustedSql(
          { sql: 'delete from products where id = ? returning id', values: ['p1'] },
          'direct wrapper read-handle write attempt',
        ),
      ),
    ).toThrow(/KV433/);
    expect(log).toEqual(['with', 'with.select', 'all']);
  });

  it('read capability fails closed on raw SQL DDL before execution', () => {
    const log: string[] = [];
    const handle = wrapManagedDbForSqlSafety(
      {
        run(statement: unknown) {
          log.push('run');
          return statement;
        },
      },
      undefined,
      managedSqlExecutionPolicy({ capability: 'read', dialect: 'sqlite' }),
    ) as { run(statement: unknown): unknown };

    expect(() =>
      handle.run(stampTrustedSql({ sql: 'DROP TABLE contacts' }, 'read-handle DDL attempt')),
    ).toThrow(/KV433/);
    expect(log).toEqual([]);
  });

  it('read capability fails closed on unproven read-shaped SQL functions before execution', () => {
    const log: string[] = [];
    const handle = wrapManagedDbForSqlSafety(
      {
        query(statement: unknown) {
          log.push('query');
          return statement;
        },
      },
      undefined,
      managedSqlExecutionPolicy({ capability: 'read' }),
    ) as { query(statement: unknown): unknown };

    expect(() =>
      handle.query(
        stampTrustedSql(
          { text: "select setval('probe_seq', 1)" },
          'read-handle volatile function attempt',
        ),
      ),
    ).toThrow(/KV433/);
    expect(() =>
      handle.query(
        stampTrustedSql(
          { text: "select nextval('probe_seq')" },
          'read-handle sequence function attempt',
        ),
      ),
    ).toThrow(/KV433/);
    expect(log).toEqual([]);
  });

  it('P3 runtime twin closes when static SQL classification is bypassed', () => {
    const log: string[] = [];
    const handle = managedDb(
      {
        query(statement: unknown) {
          log.push('query');
          return statement;
        },
      },
      'read',
      { sqlWritePolicy: { dialect: 'postgres' } },
    ) as unknown as { query(statement: unknown): unknown };

    expect(() =>
      handle.query(
        stampTrustedSql(
          { text: "select setval('probe_seq', 1)" },
          'P3 static-arm bypass volatile write',
        ),
      ),
    ).toThrow(/KV433/);
    expect(log).toEqual([]);
  });

  it.each([
    {
      dialect: undefined,
      log: 'pglite.query',
      method: 'query',
      name: 'pglite query',
      read: { text: 'select id from products where id = $1', values: ['p1'] },
      rawDb(log: string[]) {
        return {
          query(statement: unknown) {
            log.push('pglite.query');
            return statement;
          },
        };
      },
      write: { text: 'update products set name = $1 where id = $2', values: ['Ada', 'p1'] },
    },
    {
      dialect: 'sqlite' as const,
      log: 'sqlite.all',
      method: 'all',
      name: 'better-sqlite3 all',
      read: { sql: 'select id from products where id = ?', values: ['p1'] },
      rawDb(log: string[]) {
        return {
          all(statement: unknown) {
            log.push('sqlite.all');
            return statement;
          },
        };
      },
      write: { sql: 'delete from products where id = ?', values: ['p1'] },
    },
    {
      dialect: 'sqlite' as const,
      log: 'sqlite.get',
      method: 'get',
      name: 'better-sqlite3 get',
      read: { sql: 'select id from products where id = ?', values: ['p1'] },
      rawDb(log: string[]) {
        return {
          get(statement: unknown) {
            log.push('sqlite.get');
            return statement;
          },
        };
      },
      write: { sql: 'insert into products (id) values (?)', values: ['p1'] },
    },
    {
      dialect: 'sqlite' as const,
      log: 'sqlite.values',
      method: 'values',
      name: 'better-sqlite3 values',
      read: { sql: 'select id from products where id = ?', values: ['p1'] },
      rawDb(log: string[]) {
        return {
          values(statement: unknown) {
            log.push('sqlite.values');
            return statement;
          },
        };
      },
      write: { sql: 'replace into products (id) values (?)', values: ['p1'] },
    },
    {
      dialect: undefined,
      log: 'future.futureStatement',
      method: 'futureStatement',
      name: 'unknown future method',
      read: { text: 'select id from products where id = $1', values: ['p1'] },
      rawDb(log: string[]) {
        return {
          futureStatement(statement: unknown) {
            log.push('future.futureStatement');
            return statement;
          },
        };
      },
      write: { text: 'insert into products (id) values ($1)', values: ['p1'] },
    },
  ])(
    'read mode $name denies root SQL methods before execution',
    async ({ dialect, method, read, rawDb, write }) => {
      const log: string[] = [];
      const handle = managedDb(rawDb(log), 'read', {
        sqlWritePolicy: dialect === undefined ? {} : { dialect },
      }) as unknown as Record<string, (statement: unknown) => unknown>;

      const execute = (statement: unknown) => handle[method]!(statement);

      expect(() => execute('select id from products')).toThrow(/KV433/);
      expect(log).toEqual([]);

      expect(() => execute(read)).toThrow(/KV433/);
      expect(log).toEqual([]);

      expect(() => execute(stampTrustedSql(write, `read-mode ${method} write attempt`))).toThrow(
        /KV433/,
      );
      expect(log).toEqual([]);
    },
  );

  it('write mode allows writes but still rejects raw-string SQL (KV422 holds)', async () => {
    const log: string[] = [];
    const handle = managedDb(fakeDb(log), 'write');
    await (handle as { insert(t: string): { values(): Promise<void> } })
      .insert('products')
      .values();
    expect(log).toContain('insert:products');
    expect(() => (handle as { query(s: unknown): unknown }).query('SELECT 1')).toThrow(/KV422/);
  });

  it('passes a frozen ManagedSqlStatement snapshot to drivers instead of the mutable carrier', () => {
    const carrier = {
      text: 'select id from products where id = $1',
      values: ['p1'],
    };
    let observed: unknown;
    const handle = managedDb(
      {
        query(statement: unknown) {
          carrier.text = 'delete from products where id = $1';
          observed = statement;
          return statement;
        },
      },
      'write',
      {
        sqlWritePolicy: {
          tables: ['products'],
          touches: ['product'],
        },
      },
    ) as unknown as { query(statement: unknown): unknown };

    expect(handle.query(carrier)).toMatchObject({
      text: 'select id from products where id = $1',
      values: ['p1'],
    });
    expect(observed).not.toBe(carrier);
    expect(isManagedSqlStatement(observed)).toBe(true);
    expect(Object.isFrozen(observed)).toBe(true);
    expect(carrier.text).toBe('delete from products where id = $1');
  });

  it('write mode refuses submit-bearing carriers before direct SQL execution', () => {
    const log: string[] = [];
    const handle = managedDb(
      {
        query(statement: unknown) {
          log.push(String((statement as { text?: unknown }).text));
          return statement;
        },
      },
      'write',
      {
        sqlWritePolicy: {
          tables: ['products'],
          touches: ['product'],
        },
      },
    ) as unknown as { query(statement: unknown): unknown };

    expect(() =>
      handle.query({
        submit() {
          throw new Error('out-of-band SQL executed');
        },
        text: 'select id from products where id = $1',
        values: ['p1'],
      }),
    ).toThrow(/submit-bearing[\s\S]*SPEC §10\.3/);
    expect(log).toEqual([]);
  });

  it('fails closed on getter-backed separated carriers before driver execution', () => {
    const log: string[] = [];
    let reads = 0;
    const handle = managedDb(
      {
        query(statement: unknown) {
          log.push(String((statement as { text?: unknown }).text));
          return statement;
        },
      },
      'write',
      {
        sqlWritePolicy: {
          tables: ['products'],
          touches: ['product'],
        },
      },
    ) as unknown as { query(statement: unknown): unknown };

    expect(() =>
      handle.query({
        get text() {
          reads += 1;
          return reads === 1
            ? 'select id from products where id = $1'
            : 'delete from users where id = $1';
        },
        values: ['p1'],
      }),
    ).toThrow(/accessor\/proxy .*\.text/);
    expect(reads).toBe(0);
    expect(log).toEqual([]);
  });

  it('executes the first proxy snapshot instead of rereading proxy SQL at the driver', () => {
    const log: string[] = [];
    let textDescriptorReads = 0;
    const carrier = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(_target, prop) {
          if (prop === 'text') {
            textDescriptorReads += 1;
            return {
              configurable: true,
              enumerable: true,
              value:
                textDescriptorReads === 1
                  ? 'select id from products where id = $1'
                  : 'delete from users where id = $1',
              writable: true,
            };
          }
          if (prop === 'values') {
            return {
              configurable: true,
              enumerable: true,
              value: ['p1'],
              writable: true,
            };
          }
          return undefined;
        },
      },
    );
    const handle = managedDb(
      {
        query(statement: unknown) {
          log.push((statement as { text: string }).text);
          return statement;
        },
      },
      'write',
      {
        sqlWritePolicy: {
          tables: ['products'],
          touches: ['product'],
        },
      },
    ) as unknown as { query(statement: unknown): unknown };

    expect(handle.query(carrier)).toMatchObject({
      text: 'select id from products where id = $1',
      values: ['p1'],
    });
    expect(log).toEqual(['select id from products where id = $1']);
  });

  it('write mode enforces the raw-SQL table allowlist before execution', async () => {
    const log: string[] = [];
    const handle = managedDb(fakeDb(log), 'write', {
      sqlWritePolicy: {
        tables: ['products'],
        touches: ['product'],
      },
    });

    await expect(
      (handle as { execute(statement: unknown): Promise<unknown> }).execute(
        stampTrustedSql(
          { text: 'update products set name = $1 where id = $2', values: ['Ada', 'p1'] },
          'audited product update',
        ),
      ),
    ).resolves.toMatchObject({ text: 'update products set name = $1 where id = $2' });
    expect(log).toEqual(['execute']);

    expect(() =>
      (handle as { execute(statement: unknown): unknown }).execute(
        stampTrustedSql(
          { sql: 'delete from users where id = ?', args: ['u1'] },
          'drifted user delete',
        ),
      ),
    ).toThrow(/KV406/);
    expect(log).toEqual(['execute']);
  });

  it('threads declared write policy to engine-capable adapters before parser-blind builders run', async () => {
    const log: string[] = [];
    const raw = {
      [kovoDeclaredWriteDbHandle](policy: { tables?: readonly string[] }) {
        log.push(`engine-policy:${policy.tables?.join(',') ?? '<none>'}`);
        const allowed = new Set(policy.tables ?? []);
        return {
          insert(table: string) {
            return {
              values() {
                if (!allowed.has(table)) {
                  throw new Error(`KV406: engine declared-write policy rejected ${table}`);
                }
                log.push(`engine-insert:${table}`);
                return Promise.resolve();
              },
            };
          },
        };
      },
      insert(table: string) {
        log.push(`raw-insert:${table}`);
        return { values: () => Promise.resolve() };
      },
    };
    const handle = managedDb(raw, 'write', {
      sqlWritePolicy: {
        tables: ['contacts'],
        touches: ['contact'],
      },
    }) as { insert(table: string): { values(): Promise<void> } };

    await expect(handle.insert('contacts').values()).resolves.toBeUndefined();
    expect(() => handle.insert('userx').values()).toThrow(/KV406/);
    expect(log).toEqual(['engine-policy:contacts', 'engine-insert:contacts']);
  });

  it('fails closed when a declared write policy has no tables', async () => {
    const log: string[] = [];
    const raw = {
      [kovoDeclaredWriteDbHandle](policy: { tables?: readonly string[] }) {
        log.push(`engine-policy:${policy.tables?.join(',') ?? '<none>'}`);
        const allowed = new Set(policy.tables ?? []);
        return {
          insert(table: string) {
            return {
              values() {
                if (!allowed.has(table)) {
                  throw new Error(`KV406: engine declared-write policy rejected ${table}`);
                }
                log.push(`engine-insert:${table}`);
                return Promise.resolve();
              },
            };
          },
        };
      },
      execute(statement: unknown) {
        log.push('raw-execute');
        return statement;
      },
    };
    const handle = managedDb(raw, 'write', {
      sqlWritePolicy: { tables: [], touches: ['contact'] },
    }) as {
      insert(table: string): { values(): Promise<void> };
    };

    expect(() => handle.insert('contacts').values()).toThrow(/KV406/);
    expect(log).toEqual(['engine-policy:']);

    const rawSqlHandle = managedDb(
      {
        execute(statement: unknown) {
          log.push('raw-execute');
          return statement;
        },
      },
      'write',
      {
        sqlWritePolicy: { tables: [], touches: ['contact'] },
      },
    ) as { execute(statement: unknown): unknown };
    expect(() =>
      rawSqlHandle.execute(
        stampTrustedSql(
          { text: 'insert into contacts (id) values ($1)', values: ['c1'] },
          'absent tables write',
        ),
      ),
    ).toThrow(/KV406/);
    expect(log).toEqual(['engine-policy:']);
  });

  it('server-owned declared-write helper enforces tables only for Drizzle builders', async () => {
    const log: string[] = [];
    const raw = {
      insert(table: { name: string }) {
        log.push(`insert:${table.name}`);
        return { values: () => Promise.resolve() };
      },
    };
    const handle = createDeclaredWriteDb(
      raw,
      { tables: ['public.contacts'], touches: ['userx'] },
      {
        dialectLabel: 'PGlite',
        normalizeTableName: (table) => (table.includes('.') ? table : `public.${table}`),
        tableNames: (table) => [(table as { name: string }).name],
      },
    );

    await expect(handle.insert({ name: 'contacts' }).values()).resolves.toBeUndefined();
    expect(() => handle.insert({ name: 'userx' }).values()).toThrow(/KV406/);
    expect(log).toEqual(['insert:contacts']);
  });

  it('rejects parsed request input copied to governed columns in managed Drizzle writes', async () => {
    const log: unknown[] = [];
    const handle = governedWriteHandle(log);
    const table = { name: 'accounts' };

    await runWithRequestInputProvenance(
      { id: 'input-id', name: 'Ada', role: 'admin' },
      async (input) => {
        expect(() => handle.update(table).set({ role: input.role })).toThrow(/KV438[\s\S]*role/);
        const { role } = input;
        expect(() => handle.update(table).set({ role })).toThrow(/KV438[\s\S]*<input>\.role/);
        expect(() => handle.insert(table).values({ ...input })).toThrow(/KV438/);
        expect(() => handle.insert(table).values(input)).toThrow(/KV438/);
        expect(() =>
          handle.insert(table).values([{ id: 'server-id', name: 'Grace', role: input.role }]),
        ).toThrow(/KV438/);
        expect(log).toEqual([]);
      },
    );
  });

  it('allows non-governed request fields and server-owned governed values', async () => {
    const log: unknown[] = [];
    const handle = governedWriteHandle(log);
    const table = { name: 'accounts' };

    await runWithRequestInputProvenance({ name: 'Ada', role: 'admin' }, async (input) => {
      await expect(handle.update(table).set({ name: input.name })).resolves.toBe('updated');
      await expect(handle.update(table).set({ role: 'user' })).resolves.toBe('updated');
      await expect(handle.insert(table).values({ id: 'server-id', role: 'user' })).resolves.toBe(
        'inserted',
      );
    });
    expect(log).toEqual([
      { op: 'update', row: { name: 'Ada' }, table: 'accounts' },
      { op: 'update', row: { role: 'user' }, table: 'accounts' },
      { op: 'insert', row: { id: 'server-id', role: 'user' }, table: 'accounts' },
    ]);
  });

  it('treats trustedAssign as the audited request-input escape but not serverValue(input)', async () => {
    const log: unknown[] = [];
    const handle = governedWriteHandle(log);
    const table = { name: 'accounts' };

    await runWithRequestInputProvenance({ role: 'admin' }, async (input) => {
      await expect(
        handle.update(table).set({ role: trustedAssign(input.role, 'operator role grant') }),
      ).resolves.toBe('updated');
      expect(() =>
        handle.update(table).set({ role: serverValue(input.role, 'attempted laundering') }),
      ).toThrow(/KV438/);
    });
    expect(log).toEqual([{ op: 'update', row: { role: 'admin' }, table: 'accounts' }]);
  });

  it('checks governed columns in conflict update payloads', async () => {
    const log: unknown[] = [];
    const handle = governedWriteHandle(log);
    const table = { name: 'accounts' };

    await runWithRequestInputProvenance({ role: 'admin' }, async (input) => {
      expect(() =>
        handle
          .insert(table)
          .values({ id: 'server-id', name: 'Ada', role: 'user' })
          .onConflictDoUpdate({ set: { role: input.role } }),
      ).toThrow(/KV438[\s\S]*onConflictDoUpdate\.set/);
    });
    expect(log).toEqual([
      { op: 'insert', row: { id: 'server-id', name: 'Ada', role: 'user' }, table: 'accounts' },
    ]);
  });

  it('server-owned declared-write helper denies SQLite direct SQL outside tables', () => {
    const constants = {
      SQLITE_ALTER_TABLE: 1,
      SQLITE_ATTACH: 2,
      SQLITE_CREATE_INDEX: 3,
      SQLITE_CREATE_TABLE: 4,
      SQLITE_CREATE_TEMP_INDEX: 5,
      SQLITE_CREATE_TEMP_TABLE: 6,
      SQLITE_CREATE_TEMP_TRIGGER: 7,
      SQLITE_CREATE_TEMP_VIEW: 8,
      SQLITE_CREATE_TRIGGER: 9,
      SQLITE_CREATE_VIEW: 10,
      SQLITE_CREATE_VTABLE: 11,
      SQLITE_DELETE: 12,
      SQLITE_DENY: 13,
      SQLITE_DETACH: 14,
      SQLITE_DROP_INDEX: 15,
      SQLITE_DROP_TABLE: 16,
      SQLITE_DROP_TEMP_INDEX: 17,
      SQLITE_DROP_TEMP_TABLE: 18,
      SQLITE_DROP_TEMP_TRIGGER: 19,
      SQLITE_DROP_TEMP_VIEW: 20,
      SQLITE_DROP_TRIGGER: 21,
      SQLITE_DROP_VIEW: 22,
      SQLITE_DROP_VTABLE: 23,
      SQLITE_INSERT: 24,
      SQLITE_OK: 25,
      SQLITE_PRAGMA: 26,
      SQLITE_REINDEX: 27,
      SQLITE_UPDATE: 28,
    };
    let authorize = (
      _action: number,
      _objectName: string | null,
      _columnName: string | null,
      _databaseName: string | null,
      _triggerOrView: string | null,
    ) => constants.SQLITE_OK;
    let attemptedSql = '';
    const raw = {
      run(statement: unknown) {
        attemptedSql = String(statement);
        return undefined;
      },
    };
    const handle = createDeclaredWriteDb(
      raw,
      { tables: ['contacts'], touches: ['userx'] },
      {
        dialectLabel: 'SQLite',
        normalizeTableName: (table) => (table.includes('.') ? table : `main.${table}`),
        sqliteAuthorizer: {
          constants,
          openDatabase: () => ({
            close() {},
            prepare(statement: string) {
              const table = statement.includes('userx') ? 'userx' : 'contacts';
              const decision = authorize(constants.SQLITE_INSERT, table, null, 'main', null);
              if (decision === constants.SQLITE_DENY) throw new Error('not authorized');
            },
            setAuthorizer(callback) {
              authorize = callback;
            },
          }),
        },
        tableNames: () => ['contacts'],
      },
    ) as { run(statement: string): void };

    expect(() => handle.run('insert into userx (id) values (?)')).toThrow(/KV406/);
    expect(attemptedSql).toBe('');
  });

  it('server-owned Postgres read-only client sets transaction read-only before queries', async () => {
    const log: string[] = [];
    const client = {
      transaction<Result>(callback: (tx: typeof client) => Promise<Result>) {
        log.push('transaction');
        return callback(this);
      },
      exec(statement: string) {
        log.push(`exec:${statement}`);
        return Promise.resolve();
      },
      query(statement: string) {
        log.push(`query:${statement}`);
        return Promise.resolve([{ id: 'c1' }]);
      },
    };
    const reader = createPostgresReadonlyClient(client, { readerRole: 'kovo_reader' });

    await expect(reader.query('select id from contacts')).resolves.toEqual([{ id: 'c1' }]);
    expect(log).toEqual([
      'transaction',
      'exec:SET TRANSACTION READ ONLY',
      'exec:SET LOCAL ROLE "kovo_reader"',
      'query:select id from contacts',
    ]);
  });

  it('server-owned Postgres scoped client parameterizes the principal before assuming the app role', async () => {
    const log: string[] = [];
    const client = {
      transaction<Result>(callback: (tx: typeof client) => Promise<Result>) {
        log.push('transaction');
        return callback(this);
      },
      exec(statement: string) {
        log.push(`exec:${statement}`);
        return Promise.resolve();
      },
      query(statement: string, params?: unknown[]) {
        log.push(`query:${statement}:${JSON.stringify(params ?? [])}`);
        return Promise.resolve([{ id: 'c1' }]);
      },
    };
    const scoped = createPostgresScopedClient(client, {
      principal: 'user-1',
      readOnly: true,
      role: 'kovo_reader',
    });

    await expect(scoped.query('select id from contacts')).resolves.toEqual([{ id: 'c1' }]);
    expect(log).toEqual([
      'transaction',
      'exec:SET TRANSACTION READ ONLY',
      `query:SELECT set_config('kovo.principal', $1, true):["user-1"]`,
      'exec:SET LOCAL ROLE "kovo_reader"',
      'query:select id from contacts:[]',
    ]);
    expect(() => scoped.exec('select 1')).toThrow(/parameterized db\.query/);
  });

  it('rejects unsafe app SQL before scoped Postgres query execution', async () => {
    const log: string[] = [];
    const client = {
      transaction<Result>(callback: (tx: typeof client) => Promise<Result>) {
        log.push('transaction');
        return callback(this);
      },
      exec(statement: string) {
        log.push(`exec:${statement}`);
        return Promise.resolve();
      },
      query(statement: unknown, params?: unknown[]) {
        log.push(`query:${String(statement)}:${JSON.stringify(params ?? [])}`);
        return Promise.resolve({ rows: [] });
      },
    };
    const scoped = createPostgresScopedClient(client, {
      principal: 'user-1',
      readOnly: true,
      role: 'kovo_reader',
    });

    for (const statement of [
      "SET kovo.principal='victim'",
      "SET kovo.role='admin'",
      'RESET ROLE',
      'SET ROLE kovo_admin',
      'DISCARD ALL',
      'CREATE TABLE stolen (id text)',
      "RESET ROLE; SELECT set_config('kovo.principal', 'victim', true)",
      '/* hidden utility */ SET ROLE kovo_admin',
      'SELECT 1; /* comment */ SELECT 2',
      "SELECT pg_catalog.set_config('kovo.principal', $1, true)",
      'SELECT "set_config"(\'kovo.principal\', $1, true)',
      'SELECT "pg_catalog"."set_config"(\'kovo.principal\', $1, true)',
      'VACUUM',
    ]) {
      expect(() => scoped.query(statement, ['victim'])).toThrow(/KV414/);
    }

    expect(log).toEqual([]);
  });

  it('allows only the single-statement app Postgres command allowlist', async () => {
    const log: string[] = [];
    const client = {
      transaction<Result>(callback: (tx: typeof client) => Promise<Result>) {
        log.push('transaction');
        return callback(this);
      },
      exec(statement: string) {
        log.push(`exec:${statement}`);
        return Promise.resolve();
      },
      query(statement: unknown, params?: unknown[]) {
        const sql = typeof statement === 'string' ? statement : JSON.stringify(statement);
        log.push(`query:${sql}:${JSON.stringify(params ?? [])}`);
        return Promise.resolve({ rows: [] });
      },
    };
    const scoped = createPostgresScopedClient(client, { role: false });

    await expect(scoped.query('select id from contacts where id = $1', ['c1'])).resolves.toEqual({
      rows: [],
    });
    await expect(
      scoped.query({ text: 'insert into contacts (id) values ($1)', values: ['c2'] }),
    ).resolves.toEqual({ rows: [] });
    await expect(
      scoped.query({ sql: 'update contacts set label = $1 where id = $2', values: ['x', 'c1'] }),
    ).resolves.toEqual({ rows: [] });
    await expect(scoped.query('delete from contacts where id = $1', ['c1'])).resolves.toEqual({
      rows: [],
    });
    await expect(
      scoped.query('with selected as (select $1::text as id) select id from selected', ['c1']),
    ).resolves.toEqual({ rows: [] });

    expect(() => scoped.query({ values: [] })).toThrow(/unknown SQL query carriers/);
    expect(() => scoped.query({ text: 'explain select id from contacts', values: [] })).toThrow(
      /allowlist/,
    );
    expect(() => scoped.query('select 1 /* unterminated')).toThrow(/unterminated block comment/);
  });

  it('scoped Postgres query configs preserve driver metadata with copied text and values', async () => {
    const log: string[] = [];
    const client = {
      transaction<Result>(callback: (tx: typeof client) => Promise<Result>) {
        log.push('transaction');
        return callback(this);
      },
      exec(statement: string) {
        log.push(`exec:${statement}`);
        return Promise.resolve();
      },
      query(statement: unknown, params?: unknown[]) {
        log.push(`query:${JSON.stringify(statement)}:${JSON.stringify(params ?? [])}`);
        return Promise.resolve({ rows: [] });
      },
    };
    const scoped = createPostgresScopedClient(client, { role: false });
    const carrier = {
      rowMode: 'array',
      text: 'select id from contacts where id = $1',
      types: { getTypeParser: 'driver-codec-marker' },
      values: ['c1'],
    };

    await expect(scoped.query(carrier)).resolves.toEqual({ rows: [] });
    carrier.text = 'delete from contacts where id = $1';
    carrier.values.push('mutated');
    expect(log).toEqual([
      'transaction',
      'query:{"rowMode":"array","text":"select id from contacts where id = $1","types":{"getTypeParser":"driver-codec-marker"},"values":["c1"]}:[]',
    ]);

    expect(() =>
      scoped.query({
        submit() {
          throw new Error('out-of-band SQL executed');
        },
        text: 'select id from contacts where id = $1',
        values: ['c1'],
      }),
    ).toThrow(/submit-bearing[\s\S]*SPEC §10\.3/);
    expect(log).toEqual([
      'transaction',
      'query:{"rowMode":"array","text":"select id from contacts where id = $1","types":{"getTypeParser":"driver-codec-marker"},"values":["c1"]}:[]',
    ]);
  });

  it('guards nested Postgres transaction query paths with the same statement chokepoint', async () => {
    const log: string[] = [];
    const client = {
      transaction<Result>(callback: (tx: typeof client) => Promise<Result>) {
        log.push('transaction');
        return Promise.resolve(callback(this));
      },
      exec(statement: string) {
        log.push(`exec:${statement}`);
        return Promise.resolve();
      },
      query(statement: unknown, params?: unknown[]) {
        log.push(`query:${String(statement)}:${JSON.stringify(params ?? [])}`);
        return Promise.resolve({ rows: [] });
      },
    };
    const scoped = createPostgresScopedClient(client, {
      principal: 'user-1',
      readOnly: true,
      role: 'kovo_reader',
    }) as typeof client;

    await expect(
      scoped.transaction(async (tx) => tx.query('select id from contacts where id = $1', ['c1'])),
    ).resolves.toEqual({ rows: [] });
    await expect(scoped.transaction(async (tx) => tx.query('RESET ROLE'))).rejects.toThrow(/KV414/);

    expect(log).toEqual([
      'transaction',
      'exec:SET TRANSACTION READ ONLY',
      `query:SELECT set_config('kovo.principal', $1, true):["user-1"]`,
      'exec:SET LOCAL ROLE "kovo_reader"',
      'query:select id from contacts where id = $1:["c1"]',
      'transaction',
      'exec:SET TRANSACTION READ ONLY',
      `query:SELECT set_config('kovo.principal', $1, true):["user-1"]`,
      'exec:SET LOCAL ROLE "kovo_reader"',
    ]);
  });

  it('binds pass-through Postgres client methods to the underlying client', () => {
    class PrivateFieldClient {
      #ready = true;

      transaction<Result>(callback: (tx: this) => Result): Result {
        if (!this.#ready) throw new Error('not ready');
        return callback(this);
      }
    }

    const scoped = createPostgresScopedClient(new PrivateFieldClient()) as PrivateFieldClient;

    expect(scoped.transaction((tx) => tx instanceof PrivateFieldClient)).toBe(true);
  });

  it('refuses Secret boxes at builder values and set write boundaries', () => {
    const log: string[] = [];
    const raw = {
      insert(table: string) {
        return {
          values(row: unknown) {
            log.push(`insert:${table}:${JSON.stringify(row)}`);
            return Promise.resolve();
          },
        };
      },
      update(table: string) {
        return {
          set(row: unknown) {
            log.push(`update:${table}:${JSON.stringify(row)}`);
            return { where: () => Promise.resolve() };
          },
        };
      },
    };
    const handle = managedDb(raw, 'write', {
      sqlWritePolicy: { tables: ['contacts'], touches: ['contact'] },
    }) as {
      insert(table: string): { values(row: unknown): Promise<void> };
      update(table: string): { set(row: unknown): { where(): Promise<void> } };
    };

    expect(() => handle.insert('contacts').values({ token: secret('sk_live') })).toThrow(/KV435/);
    expect(() => handle.update('contacts').set({ nested: { token: secret('sk_live') } })).toThrow(
      /KV435/,
    );
    expect(log).toEqual([]);
  });

  it('refuses Secret boxes in raw-SQL write bind params', () => {
    const log: string[] = [];
    const handle = managedDb(fakeDb(log), 'write', {
      sqlWritePolicy: { tables: ['contacts'], touches: ['contact'] },
    }) as { execute(statement: unknown): unknown };

    expect(() =>
      handle.execute(
        stampTrustedSql(
          {
            text: 'update contacts set token = $1 where id = $2',
            values: [secret('sk_live'), 'c1'],
          },
          'secret raw write bind',
        ),
      ),
    ).toThrow(/KV435/);
    expect(log).toEqual([]);
  });

  it('records reveal audit facts when a revealed Secret is intentionally written', async () => {
    drainSecretRevealAuditFacts();
    const log: unknown[] = [];
    const token = secret('sk_live').reveal('copy token into audited internal sink');
    const handle = managedDb(
      {
        insert(_table: string) {
          return {
            values(row: unknown) {
              log.push(row);
              return Promise.resolve();
            },
          };
        },
      },
      'write',
      {
        sqlWritePolicy: { tables: ['contacts'], touches: ['contact'] },
      },
    ) as { insert(table: string): { values(row: unknown): Promise<void> } };

    await expect(handle.insert('contacts').values({ token })).resolves.toBeUndefined();
    expect(log).toEqual([{ token: 'sk_live' }]);
    expect(drainSecretRevealAuditFacts()).toMatchObject([
      { kind: 'secret-reveal', reason: 'copy token into audited internal sink' },
    ]);
  });

  it('denies app-defined triggers at the managed raw-SQL write boundary', () => {
    const log: string[] = [];
    const handle = managedDb(fakeDb(log), 'write', {
      sqlWritePolicy: { dialect: 'sqlite', tables: ['contacts'], touches: ['contact'] },
    }) as { execute(statement: unknown): unknown };

    expect(() =>
      handle.execute(
        stampTrustedSql(
          {
            sql: [
              'create trigger contacts_ai after insert on contacts',
              'begin insert into userx (id) values (new.id); end',
            ].join(' '),
            values: [],
          },
          'trigger side-effect proof',
        ),
      ),
    ).toThrow(/KV406/);
    expect(log).toEqual([]);
  });

  it('threads declared write policy through an already managed writer without guarding the adapter hook', async () => {
    const log: string[] = [];
    const raw = {
      [kovoDeclaredWriteDbHandle](policy: { tables?: readonly string[] }) {
        log.push(`engine-policy:${policy.tables?.join(',') ?? '<none>'}`);
        const allowed = new Set(policy.tables ?? []);
        return {
          insert(table: string) {
            return {
              values() {
                if (!allowed.has(table)) {
                  throw new Error(`KV406: engine declared-write policy rejected ${table}`);
                }
                log.push(`engine-insert:${table}`);
                return Promise.resolve();
              },
            };
          },
        };
      },
      insert(table: string) {
        log.push(`raw-insert:${table}`);
        return { values: () => Promise.resolve() };
      },
    };
    const alreadyManaged = managedDb(raw, 'write');
    const handle = managedDb(alreadyManaged, 'write', {
      sqlWritePolicy: {
        tables: ['contacts'],
        touches: ['contact'],
      },
    }) as { insert(table: string): { values(): Promise<void> } };

    await expect(handle.insert('contacts').values()).resolves.toBeUndefined();
    expect(() => handle.insert('userx').values()).toThrow(/KV406/);
    expect(log).toEqual(['engine-policy:contacts', 'engine-insert:contacts']);
  });

  it('scopes declared-write engine policy to one writer without leaking to later writers', async () => {
    const log: string[] = [];
    const raw = {
      [kovoDeclaredWriteDbHandle](policy: { tables?: readonly string[] }) {
        const allowed = new Set(policy.tables ?? []);
        log.push(`engine-policy:${[...allowed].join(',')}`);
        return {
          insert(table: string) {
            return {
              values() {
                if (!allowed.has(table)) {
                  throw new Error(`KV406: engine declared-write policy rejected ${table}`);
                }
                log.push(`engine-insert:${table}`);
                return Promise.resolve();
              },
            };
          },
        };
      },
      insert(table: string) {
        log.push(`raw-insert:${table}`);
        return { values: () => Promise.resolve() };
      },
    };

    const contactsWriter = managedDb(raw, 'write', {
      sqlWritePolicy: { tables: ['contacts'], touches: ['contact'] },
    }) as { insert(table: string): { values(): Promise<void> } };
    await expect(contactsWriter.insert('contacts').values()).resolves.toBeUndefined();
    expect(() => contactsWriter.insert('userx').values()).toThrow(/KV406/);

    const userWriter = managedDb(raw, 'write', {
      sqlWritePolicy: { tables: ['userx'], touches: ['user'] },
    }) as { insert(table: string): { values(): Promise<void> } };
    await expect(userWriter.insert('userx').values()).resolves.toBeUndefined();
    expect(() => userWriter.insert('contacts').values()).toThrow(/KV406/);

    const broadWriter = managedDb(raw, 'write') as {
      insert(table: string): { values(): Promise<void> };
    };
    await expect(broadWriter.insert('contacts').values()).resolves.toBeUndefined();

    expect(log).toEqual([
      'engine-policy:contacts',
      'engine-insert:contacts',
      'engine-policy:userx',
      'engine-insert:userx',
      'raw-insert:contacts',
    ]);
  });

  it('write mode declared-table allowlist fails closed on unproven read-shaped SQL functions', () => {
    const log: string[] = [];
    const handle = managedDb(fakeDb(log), 'write', {
      sqlWritePolicy: {
        tables: ['contacts'],
        touches: ['contact'],
      },
    });

    expect(() =>
      (handle as { execute(statement: unknown): unknown }).execute(
        stampTrustedSql(
          { text: "select setval('probe_seq', 1)" },
          'declared-table volatile function attempt',
        ),
      ),
    ).toThrow(/KV406/);
    expect(log).toEqual([]);
  });

  it('write mode fails closed on raw SQL DDL even when the table is declared', () => {
    const log: string[] = [];
    const handle = wrapManagedDbForSqlSafety(
      {
        run(statement: unknown) {
          log.push('run');
          return statement;
        },
      },
      undefined,
      managedSqlExecutionPolicy({
        capability: 'write',
        dialect: 'sqlite',
        tables: ['contacts'],
        touches: ['contact'],
      }),
    ) as { run(statement: unknown): unknown };

    expect(() =>
      handle.run(stampTrustedSql({ sql: 'DROP TABLE contacts' }, 'managed write DDL attempt')),
    ).toThrow(/KV406/);
    expect(log).toEqual([]);
  });

  it('write mode requires schema-qualified matches for declared raw-SQL tables on pglite handles', async () => {
    const log: string[] = [];
    const handle = managedDb(
      {
        query(statement: unknown) {
          log.push('pglite.query');
          return Promise.resolve(statement);
        },
      },
      'write',
      {
        sqlWritePolicy: {
          tables: ['contacts'],
          touches: ['contact'],
        },
      },
    ) as { query(statement: unknown): Promise<unknown> };

    await expect(
      handle.query(
        stampTrustedSql(
          {
            text: 'update public.contacts set name = $1 where id = $2',
            values: ['Ada', 'c1'],
          },
          'declared public contact update',
        ),
      ),
    ).resolves.toMatchObject({ text: 'update public.contacts set name = $1 where id = $2' });
    expect(log).toEqual(['pglite.query']);

    expect(() =>
      handle.query(
        stampTrustedSql(
          {
            text: 'update otherschema.contacts set name = $1 where id = $2',
            values: ['Ada', 'c1'],
          },
          'cross-schema contact update',
        ),
      ),
    ).toThrow(/KV406/);
    expect(log).toEqual(['pglite.query']);
  });

  it('write mode enforces the raw-SQL table allowlist inside transactions', async () => {
    const log: string[] = [];
    const handle = managedDb(fakeDb(log), 'write', {
      sqlWritePolicy: {
        tables: ['products'],
        touches: ['product'],
      },
    });
    type Tx = { execute(statement: unknown): Promise<unknown> };
    type Transactional = {
      transaction<Result>(callback: (tx: Tx) => Result): Result;
    };

    await expect(
      (handle as Transactional).transaction((tx) =>
        tx.execute(
          stampTrustedSql(
            { text: 'update products set name = $1 where id = $2', values: ['Ada', 'p1'] },
            'audited product transaction update',
          ),
        ),
      ),
    ).resolves.toMatchObject({ text: 'update products set name = $1 where id = $2' });
    expect(log).toEqual(['transaction', 'tx.execute']);

    await expect(
      Promise.resolve(
        (handle as Transactional).transaction((tx) =>
          tx.execute(
            stampTrustedSql(
              { text: 'insert into users (id) values ($1)', values: ['u1'] },
              'drifted user transaction insert',
            ),
          ),
        ),
      ),
    ).rejects.toThrow(/KV406/);
    expect(log).toEqual(['transaction', 'tx.execute', 'transaction']);
  });

  it('write mode enforces SQLite top-level raw SQL sinks', async () => {
    const log: string[] = [];
    const sqlite = {
      all(statement: unknown) {
        log.push('all');
        return Promise.resolve(statement);
      },
      get(statement: unknown) {
        log.push('get');
        return Promise.resolve(statement);
      },
      run(statement: unknown) {
        log.push('run');
        return Promise.resolve(statement);
      },
      values(statement: unknown) {
        log.push('values');
        return Promise.resolve(statement);
      },
    };
    const handle = managedDb(sqlite, 'write', {
      sqlWritePolicy: {
        dialect: 'sqlite',
        tables: ['products'],
        touches: ['product'],
      },
    });

    expect(() => handle.all('select * from products')).toThrow(/KV422/);
    expect(log).toEqual([]);

    await expect(
      handle.get({ sql: 'select id from products where id = ?', values: ['p1'] }),
    ).resolves.toMatchObject({ text: 'select id from products where id = ?' });
    await expect(
      handle.run(
        stampTrustedSql(
          { sql: 'update products set name = ? where id = ?', values: ['Ada', 'p1'] },
          'audited SQLite product update',
        ),
      ),
    ).resolves.toMatchObject({ text: 'update products set name = ? where id = ?' });
    await expect(
      handle.run(
        stampTrustedSql(
          { sql: 'update main.products set name = ? where id = ?', values: ['Ada', 'p1'] },
          'audited SQLite main-schema product update',
        ),
      ),
    ).resolves.toMatchObject({ text: 'update main.products set name = ? where id = ?' });
    expect(() =>
      handle.values(
        stampTrustedSql(
          { sql: 'delete from users where id = ?', values: ['u1'] },
          'drifted SQLite user delete',
        ),
      ),
    ).toThrow(/KV406/);
    expect(() =>
      handle.values(
        stampTrustedSql(
          { sql: 'update otherschema.products set name = ? where id = ?', values: ['Ada', 'p1'] },
          'drifted SQLite attached-schema product update',
        ),
      ),
    ).toThrow(/KV406/);
    expect(log).toEqual(['get', 'run', 'run']);
  });

  it('write mode denies raw driver escape properties before exposing child handles', () => {
    const log: string[] = [];
    const handle = managedDb(
      {
        $client: {
          execute(statement: unknown) {
            log.push('$client.execute');
            return statement;
          },
        },
        session: {
          run(statement: unknown) {
            log.push('session.run');
            return statement;
          },
        },
      },
      'write',
      {
        sqlWritePolicy: {
          dialect: 'sqlite',
          tables: ['products'],
          touches: ['product'],
        },
      },
    );

    expect(() => void handle.$client).toThrow(/raw driver escape db\.\$client|KV422/);
    expect(() => void handle.session).toThrow(/raw driver escape db\.session|KV422/);
    expect(() => handle.$client.execute({ sql: 'select id from products', values: [] })).toThrow(
      /raw driver escape db\.\$client|KV422/,
    );
    expect(() =>
      handle.session.run(
        stampTrustedSql(
          { sql: 'delete from users where id = ?', values: ['u1'] },
          'drifted session delete',
        ),
      ),
    ).toThrow(/raw driver escape db\.session|KV422/);
    expect(log).toEqual([]);
  });

  it('write mode internal transaction probe does not pierce layered raw driver escape denial', () => {
    const inner = managedDb(
      {
        $client: {
          query() {
            throw new Error('raw client should not be reached');
          },
        },
      },
      'write',
      {
        sqlWritePolicy: {
          tables: ['products'],
          touches: ['product'],
        },
      },
    );
    const outer = wrapManagedDbForSqlSafety(
      inner,
      undefined,
      managedSqlExecutionPolicy({
        capability: 'write',
        tables: ['products'],
        touches: ['product'],
      }),
    );

    expect(() => void outer.$client).toThrow(/raw driver escape db\.\$client|KV422/);
    expect(
      (
        outer as typeof outer & {
          [kovoAsyncMutationTransaction]?: (
            callback: (transactionDb: unknown) => Promise<unknown>,
          ) => Promise<unknown>;
        }
      )[kovoAsyncMutationTransaction],
    ).toBeUndefined();
  });

  it('write mode denies unknown methods behind raw driver escape properties before execution', () => {
    const log: string[] = [];
    const handle = managedDb(
      {
        $client: {
          futureStatement(statement: unknown) {
            log.push('$client.futureStatement');
            return statement;
          },
        },
        session: {
          futureStatement(statement: unknown) {
            log.push('session.futureStatement');
            return statement;
          },
        },
      },
      'write',
      {
        sqlWritePolicy: {
          dialect: 'sqlite',
          tables: ['products'],
          touches: ['product'],
        },
      },
    );

    expect(() => handle.$client.futureStatement('select id from products')).toThrow(
      /raw driver escape db\.\$client|KV422/,
    );
    expect(() =>
      handle.session.futureStatement({
        sql: 'select id from products where id = ?',
        values: ['p1'],
      }),
    ).toThrow(/raw driver escape db\.session|KV422/);
    expect(log).toEqual([]);
  });

  it('write mode parses unknown driver method SQL carriers at any argument position', () => {
    const log: string[] = [];
    const handle = managedDb(
      {
        execute(statement: unknown) {
          log.push('execute');
          return statement;
        },
        futureStatement(options: unknown, statement: unknown) {
          log.push(`futureStatement:${JSON.stringify(options)}`);
          return statement;
        },
      },
      'write',
      {
        sqlWritePolicy: {
          dialect: 'sqlite',
          tables: ['products'],
          touches: ['product'],
        },
      },
    );
    const futureStatement = (
      handle as unknown as {
        futureStatement(options: unknown, statement: unknown): unknown;
      }
    ).futureStatement;

    expect(() => futureStatement({ mode: 'read' }, 'select id from products')).toThrow(/KV422/);
    expect(log).toEqual([]);

    expect(
      futureStatement(
        { mode: 'read' },
        { sql: 'select id from products where id = ?', values: ['p1'] },
      ),
    ).toMatchObject({ text: 'select id from products where id = ?' });
    expect(log).toEqual(['futureStatement:{"mode":"read"}']);

    expect(() =>
      futureStatement(
        { mode: 'write' },
        stampTrustedSql(
          { sql: 'delete from users where id = ?', values: ['u1'] },
          'future method drifted outside declared tables',
        ),
      ),
    ).toThrow(/KV406/);
    expect(log).toEqual(['futureStatement:{"mode":"read"}']);
  });

  it('write mode fails closed for unknown methods on SQL-capable handles without a SQL carrier', () => {
    const log: string[] = [];
    const handle = managedDb(
      {
        execute(statement: unknown) {
          log.push('execute');
          return statement;
        },
        futureStatement(options: unknown) {
          log.push(`futureStatement:${JSON.stringify(options)}`);
          return options;
        },
      },
      'write',
      {
        sqlWritePolicy: {
          dialect: 'sqlite',
          tables: ['products'],
          touches: ['product'],
        },
      },
    );

    expect(() =>
      (handle as unknown as { futureStatement(options: unknown): unknown }).futureStatement({
        mode: 'opaque',
      }),
    ).toThrow(/unknown managed DB method db\.futureStatement/);
    expect(log).toEqual([]);
  });

  it('write mode fails closed for an unknown future driver method with no known adapter shape', () => {
    const log: string[] = [];
    const handle = managedDb(
      {
        futureStatement(options: unknown) {
          log.push(`futureStatement:${JSON.stringify(options)}`);
          return options;
        },
      },
      'write',
      {
        sqlWritePolicy: {
          dialect: 'sqlite',
          tables: ['products'],
          touches: ['product'],
        },
      },
    );

    expect(() =>
      (handle as unknown as { futureStatement(options: unknown): unknown }).futureStatement({
        mode: 'opaque',
      }),
    ).toThrow(/unknown managed DB method db\.futureStatement/);
    expect(log).toEqual([]);
  });

  it('write mode fails closed for raw escape properties before unknown nested methods', () => {
    const log: string[] = [];
    const handle = managedDb(
      {
        $client: {
          futureStatement(options: unknown) {
            log.push(`$client.futureStatement:${JSON.stringify(options)}`);
            return options;
          },
        },
        session: {
          futureStatement(options: unknown) {
            log.push(`session.futureStatement:${JSON.stringify(options)}`);
            return options;
          },
        },
      },
      'write',
      {
        sqlWritePolicy: {
          dialect: 'sqlite',
          tables: ['products'],
          touches: ['product'],
        },
      },
    );

    expect(() => handle.$client.futureStatement({ mode: 'opaque' })).toThrow(
      /raw driver escape db\.\$client|KV422/,
    );
    expect(() => handle.session.futureStatement({ mode: 'opaque' })).toThrow(
      /raw driver escape db\.session|KV422/,
    );
    expect(log).toEqual([]);
  });

  it('keeps the managed raw-driver escape denial before nested handle wrapping (source gate)', () => {
    const source = readFileSync(new URL('./sql-safe-handle.ts', import.meta.url), 'utf8');
    const denial = source.indexOf('isManagedRawDriverEscapeProperty(prop)');
    const firstReflectGet = source.indexOf('Reflect.get(target, prop, receiver)');
    const nestedWrap = source.indexOf('isNestedSqlHandleProperty(prop)');

    expect(denial).toBeGreaterThanOrEqual(0);
    expect(denial).toBeLessThan(firstReflectGet);
    expect(denial).toBeLessThan(nestedWrap);
  });

  it.each(
    RUNTIME_SQL_MATRIX_DIALECTS.flatMap((dialect) =>
      RUNTIME_SQL_MATRIX_SINKS.map((sink) => ({ ...dialect, sink })),
    ),
  )(
    'runtime matrix $name × $sink rejects raw strings and cross-table writes before execution',
    async ({ dialect, name, read, sink, write }) => {
      const log: string[] = [];
      const handle = managedDb(runtimeSqlMatrixRawDb(name, sink, log), 'write', {
        sqlWritePolicy: {
          ...(dialect === undefined ? {} : { dialect }),
          tables: ['products'],
          touches: ['product'],
        },
      }) as Record<string, unknown>;

      const execute = (statement: unknown) => executeRuntimeSqlMatrixSink(handle, sink, statement);

      await expect(
        Promise.resolve().then(() => execute('select id from products')),
      ).rejects.toThrow(/KV422/);
      expect(runtimeSqlMatrixStatementExecutionLog(log, sink)).toEqual([]);
      log.splice(0);

      await expect(Promise.resolve(execute(read))).resolves.toMatchObject({
        text: 'text' in read ? read.text : read.sql,
        values: read.values,
      });
      const successfulExecutionLog = runtimeSqlMatrixStatementExecutionLog(log, sink);
      expect(successfulExecutionLog.length).toBeGreaterThan(0);

      await expect(
        Promise.resolve().then(() =>
          execute(stampTrustedSql(write, `drifted ${String(sink)} write outside declared tables`)),
        ),
      ).rejects.toThrow(/KV406/);
      expect(runtimeSqlMatrixStatementExecutionLog(log, sink)).toEqual(successfulExecutionLog);

      if (sink === 'unknown-method') {
        expect(() =>
          (handle as { futureStatement(options: { mode: 'opaque' }): unknown }).futureStatement({
            mode: 'opaque',
          }),
        ).toThrow(/unknown managed DB method db\.futureStatement/);
        expect(runtimeSqlMatrixStatementExecutionLog(log, sink)).toEqual(successfulExecutionLog);
      }
    },
  );
});

describe('query loader threading (the chokepoint)', () => {
  it('a loader reads through context.db (read-only handle)', async () => {
    const log: string[] = [];
    const db = fakeDb(log);
    const readQuery = query('product/read', {
      reads: [product],
      async load(_input, context) {
        const rows = await (
          context!.db as unknown as { select(): { from(t: string): Promise<FakeRow[]> } }
        )
          .select()
          .from('products');
        return { rows };
      },
    });

    const result = await runQuery(readQuery, undefined, { db: undefined }, { db: () => db });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ rows: [{ id: 'p1' }] });
    expect(log).toEqual(['select:products']);
  });

  it('a loader write through context.db throws KovoReadonlyHandleError (KV433)', async () => {
    const db = fakeDb([]);
    const writingLoader = query('product/illegal-write', {
      reads: [product],
      async load(_input, context) {
        // A write on a read surface — the confused-deputy case the read-only proxy fails closed.
        await (context!.db as unknown as { insert(t: string): { values(): Promise<void> } })
          .insert('products')
          .values();
        return { ok: true };
      },
    });

    await expect(
      runQuery(writingLoader, undefined, { db: undefined }, { db: () => db }),
    ).rejects.toThrow(KovoReadonlyHandleError);
  });

  it('a forged elevated marker still receives the read-only query handle (KV433)', async () => {
    const log: string[] = [];
    const db = fakeDb(log);
    const legacyMarkedQuery = Object.assign(
      query('product/touch', {
        reads: [product],
        async load(_input, context) {
          await (
            context!.db as unknown as { update(t: string): { set(): { where(): Promise<void> } } }
          )
            .update('products')
            .set()
            .where();
          return { touched: true };
        },
      }),
      { elevated: true },
    );

    await expect(
      runQuery(legacyMarkedQuery, undefined, { db: undefined }, { db: () => db }),
    ).rejects.toThrow(KovoReadonlyHandleError);
    expect(log).toEqual([]);
  });

  it('managed write mode still exposes the full SQL-safe handle for write surfaces', async () => {
    const log: string[] = [];
    const db = fakeDb(log);
    const writable = managedDb(db, 'write');

    await (writable as unknown as { update(t: string): { set(): { where(): Promise<void> } } })
      .update('products')
      .set()
      .where();

    expect(log).toContain('update:products');
  });
});
