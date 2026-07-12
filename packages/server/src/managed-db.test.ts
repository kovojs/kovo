import { execFileSync, type ExecFileSyncOptionsWithBufferEncoding } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DatabaseSync as NodeSqliteDatabaseSync,
  constants as nodeSqliteConstants,
} from 'node:sqlite';
import { PGlite } from '@electric-sql/pglite';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { drainSecretRevealAuditFacts, secret } from '@kovojs/core';
import { isManagedSqlStatement, stampTrustedSql } from '@kovojs/core/internal/sql-safety';
import { sql, staticSql, trustedSql } from '@kovojs/drizzle';
import {
  StringChunk,
  and,
  asc,
  count,
  defineRelations,
  eq,
  sql as drizzleSql,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres } from 'drizzle-orm/pglite';
import { integer, pgTable, text, withReplicas as withPostgresReplicas } from 'drizzle-orm/pg-core';
import { getTableConfig, sqliteTable, text as sqliteText } from 'drizzle-orm/sqlite-core';
import {
  KovoReadonlyHandleError,
  createAuthorizationCensusDb,
  createDeclaredWriteDb,
  createFrameworkAuthorizationCensusDb,
  createPostgresReadonlyClient,
  createPostgresScopedClient,
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  declarePublicRead,
  drainPublicReadAuditFacts,
  managedDb,
  readonlyDb,
} from './managed-db.js';
import type { AuthorizationCensusDbOptions, Reader, Writer } from './managed-db.js';
import {
  kovoAsyncMutationTransaction,
  managedSqlExecutionPolicy,
  runSqliteAsyncTransaction,
  wrapManagedDbForSqlSafety,
} from './sql-safe-handle.js';
import { runQuery } from './query.js';
import { query } from './api/data.js';
import { domain } from './domain.js';
import { runWithRequestInputProvenance } from './request-input-provenance.js';
import { trustedAssign, serverValue } from './write-governance.js';
import { createSqliteAppRuntimeDb } from './sqlite-runtime.js';

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
              allowImportingTsExtensions: true,
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
              allowImportingTsExtensions: true,
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

  it('routes the exact authorized rawRead carrier without live Function.call', () => {
    const allowed = stampTrustedSql(
      { text: 'select label from allowed', values: [] },
      'exact rawRead carrier',
    );
    const secret = stampTrustedSql(
      { text: 'select secret from secrets', values: [] },
      'attacker substituted rawRead carrier',
    );
    const raw = {
      all(statement: unknown) {
        return [statement];
      },
    };
    const reader = readonlyDb(raw, { rawRead: sqliteRawReadPolicy(['allowed']) });
    const nativeCall = Function.prototype.call;
    let rows: unknown;
    try {
      Function.prototype.call = function (thisArg: unknown, ...args: unknown[]) {
        if (this === raw.all) return Reflect.apply(nativeCall, this, [thisArg, secret]);
        return Reflect.apply(nativeCall, this, [thisArg, ...args]);
      };
      rows = reader.rawRead(allowed, { reads: ['allowed'] });
    } finally {
      Function.prototype.call = nativeCall;
    }

    expect(rows).toEqual([{ text: 'select label from allowed', values: [] }]);
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
    expect(() =>
      reader.crossOwnerRead(
        {
          text: 'select id from orders where id in (select order_id from victim_accounts)',
          values: [],
        },
        declaration,
      ),
    ).toThrow(/KV414/u);
    expect(observed).toEqual([]);

    const carrier = { text: 'select id from orders where id = $1', values: ['o1'] };
    await expect(reader.crossOwnerRead(carrier, declaration)).resolves.toEqual([
      { text: 'select id from orders where id = $1', values: ['o1'] },
    ]);
    expect(observed[0]).not.toBe(carrier);
    expect(observed).toEqual([{ text: 'select id from orders where id = $1', values: ['o1'] }]);
  });

  it('routes the exact authorized crossOwnerRead carrier without live Function.call', () => {
    const allowed = stampTrustedSql(
      { text: 'select id from orders', values: [] },
      'exact cross-owner carrier',
    );
    const secret = stampTrustedSql(
      { text: 'select secret from secrets', values: [] },
      'attacker substituted cross-owner carrier',
    );
    const adminClient = {
      query(statement: unknown) {
        return [statement];
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
      ): unknown;
    };
    const nativeCall = Function.prototype.call;
    let rows: unknown;
    try {
      Function.prototype.call = function (thisArg: unknown, ...args: unknown[]) {
        if (this === adminClient.query) {
          return Reflect.apply(nativeCall, this, [thisArg, secret]);
        }
        return Reflect.apply(nativeCall, this, [thisArg, ...args]);
      };
      rows = reader.crossOwnerRead(allowed, {
        reads: ['orders'],
        reason: 'support lookup',
        role: 'admin',
      });
    } finally {
      Function.prototype.call = nativeCall;
    }

    expect(rows).toEqual([{ text: 'select id from orders', values: [] }]);
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
  it('cannot skip raw SQL builder validation through late Array.map replacement', () => {
    const accepted: unknown[] = [];
    const raw = {
      select(projection?: unknown) {
        accepted.push(projection);
        return { from: () => [] };
      },
    };
    const handle = managedDb(raw, 'write') as unknown as typeof raw;
    const nativeMap = Array.prototype.map;
    let error: unknown;
    try {
      Array.prototype.map = function <Value>(): Value[] {
        return this as Value[];
      };
      try {
        handle.select({ leaked: sql.raw('(select classified from secrets)') });
      } catch (caught) {
        error = caught;
      }
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('KV422');
    expect(accepted).toEqual([]);
  });

  it('cannot hide native Drizzle raw SQL through late Symbol.keyFor replacement', () => {
    const accepted: unknown[] = [];
    const raw = {
      select(projection?: unknown) {
        accepted.push(projection);
        return { from: () => [] };
      },
    };
    const handle = managedDb(raw, 'write') as unknown as typeof raw;
    const nativeKeyFor = Symbol.keyFor;
    let error: unknown;
    try {
      Symbol.keyFor = () => 'app-masked-symbol';
      try {
        handle.select({ leaked: sql.raw('(select classified from secrets)') });
      } catch (caught) {
        error = caught;
      }
    } finally {
      Symbol.keyFor = nativeKeyFor;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('KV422');
    expect(accepted).toEqual([]);
  });

  it('reconstructs witnessed SQL and rejects executable subquery wrappers at the real sink', () => {
    const client = new Database(':memory:');
    try {
      client.exec(
        'create table public_data (label text not null); create table secrets (classified text not null);',
      );
      client.exec(
        "insert into public_data values ('public'); insert into secrets values ('victim-secret');",
      );
      const publicData = sqliteTable('public_data', { label: sqliteText('label').notNull() });
      const secrets = sqliteTable('secrets', { classified: sqliteText('classified').notNull() });
      const rawDb = drizzle({ client });
      const handle = managedDb(rawDb, 'write');

      const witnessed = sql`1`;
      const chunks = witnessed.queryChunks as unknown as { value: string[] }[];
      chunks[0]!.value[0] = '(select classified from secrets)';
      expect(handle.select({ leaked: witnessed }).from(publicData).all()).toEqual([{ leaked: 1 }]);

      const benign = drizzleSql`${1}`;
      const dangerousChunks = drizzleSql.raw('(select classified from secrets)').queryChunks;
      let executablePropertyReads = 0;
      const splitCarrier = new Proxy(benign, {
        get(target, property, receiver) {
          if (property === 'queryChunks') {
            executablePropertyReads += 1;
            return dangerousChunks;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      expect(handle.select({ leaked: splitCarrier }).from(publicData).all()).toEqual([
        { leaked: 1 },
      ]);
      expect(executablePropertyReads).toBe(0);

      const splitTable = new Proxy(publicData, {
        get(target, property, receiver) {
          if (property === Symbol.for('drizzle:Name')) return 'secrets';
          return Reflect.get(target, property, receiver);
        },
      });
      expect(handle.select({ total: count() }).from(splitTable).get()).toEqual({ total: 1 });

      const splitProjection = new Proxy(
        { label: publicData.label },
        {
          get(target, property, receiver) {
            if (property === 'label') {
              return drizzleSql.raw('(select classified from secrets)').as('label');
            }
            return Reflect.get(target, property, receiver);
          },
        },
      );
      expect(handle.select(splitProjection).from(publicData).get()).toEqual({ label: 'public' });

      const descriptorControl = drizzleSql`${1}`;
      const rawDescriptor = Object.getOwnPropertyDescriptor(
        drizzleSql.raw('(select classified from secrets)'),
        'queryChunks',
      )!;
      let queryChunkDescriptorReads = 0;
      const splitDescriptors = new Proxy(descriptorControl, {
        getOwnPropertyDescriptor(target, property) {
          if (property === 'queryChunks') {
            queryChunkDescriptorReads += 1;
            if (queryChunkDescriptorReads >= 3) return rawDescriptor;
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
      expect(handle.select({ leaked: splitDescriptors }).from(publicData).all()).toEqual([
        { leaked: 1 },
      ]);
      expect(queryChunkDescriptorReads).toBe(1);

      class CustomSqlWrapper {
        getSQL() {
          return drizzleSql.raw(
            "exists(select 1 from secrets where classified = 'victim-secret')",
          );
        }
      }
      expect(() =>
        handle.select().from(publicData).where(new CustomSqlWrapper()).all(),
      ).toThrow(/KV422[\s\S]*custom SQLWrapper/u);
      expect(() =>
        handle
          .select()
          .from(publicData)
          .where({
            getSQL() {
              return drizzleSql.raw(
                "exists(select 1 from secrets where classified = 'victim-secret')",
              );
            },
          })
          .all(),
      ).toThrow(/KV422[\s\S]*custom SQLWrapper/u);

      const evil = rawDb
        .select({ leaked: drizzleSql.raw('classified').as('leaked') })
        .from(secrets)
        .as('evil');
      expect(() => handle.select().from(evil).all()).toThrow(/KV422/u);
    } finally {
      client.close();
    }
  });

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

  it('rejects unbranded native Drizzle raw/identifier carriers after detached assignment', () => {
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
    let dangerous: typeof drizzleSql.raw;
    dangerous = drizzleSql.raw;

    expect(() =>
      handle.select().from('products').orderBy(dangerous('created_at desc; select pg_sleep(10)--')),
    ).toThrow(/KV422/);
    expect(() => handle.select().from(drizzleSql.identifier('attacker_table'))).toThrow(/KV422/);
    expect(accepted).toEqual([]);
  });

  it('rejects Kovo raw fragments after carrier destructuring and identity wrappers', () => {
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
    const holder = { dangerous: sql.raw };
    const { dangerous: destructured } = holder;
    const identity = <T>(value: T): T => value;
    const wrapped = identity(sql.raw);

    expect(() =>
      handle.select().from('products').orderBy(destructured('created_at desc; select 1--')),
    ).toThrow(/KV422/);
    expect(() =>
      handle.select().from('products').orderBy(wrapped('created_at desc; select 1--')),
    ).toThrow(/KV422/);
    expect(accepted).toEqual([]);
  });

  it('keeps typed native Drizzle predicates/orderings green while closing raw wrappers', () => {
    const products = pgTable('products', {
      id: text('id').primaryKey(),
      stock: integer('stock').notNull(),
    });
    const accepted: unknown[] = [];
    const builder = {
      from(value: unknown) {
        accepted.push(value);
        return this;
      },
      orderBy(value: unknown) {
        accepted.push(value);
        return this;
      },
      where(value: unknown) {
        accepted.push(value);
        return this;
      },
    };
    const raw = { select: (_projection?: unknown) => builder };
    const handle = managedDb(raw, 'write') as unknown as typeof raw;

    expect(() =>
      handle
        .select()
        .from(products)
        .where(and(eq(products.id, 'p1'), eq(products.stock, 1)))
        .orderBy(asc(products.id)),
    ).not.toThrow();
    expect(accepted).toHaveLength(3);

    const dangerous = drizzleSql.raw('select pg_sleep(10)--');
    expect(() =>
      handle
        .select()
        .from(products)
        .orderBy(new StringChunk(['raw desc'])),
    ).toThrow(/KV422/);
    expect(() => handle.select(dangerous.as('leak'))).toThrow(/KV422/);
    expect(() => handle.select().from(products).where(dangerous.mapWith(Number))).toThrow(/KV422/);
    expect(() =>
      handle
        .select()
        .from(products)
        .where(drizzleSql`${products.id} = ${dangerous}`),
    ).toThrow(/KV422/);
    expect(() =>
      handle
        .select()
        .from(products)
        .where(sql`${products.id} = ${dangerous}`),
    ).toThrow(/KV422/);
    const wrapper = { getSQL: () => dangerous };
    expect(() =>
      handle
        .select()
        .from(products)
        .where(drizzleSql`${products.id} = ${wrapper}`),
    ).toThrow(/KV422/);
    expect(() =>
      handle
        .select()
        .from(products)
        .orderBy(drizzleSql.join([products.id, dangerous], drizzleSql`, `)),
    ).toThrow(/KV422/);
  });

  it('accepts Drizzle count-star while keeping native raw near-matches closed', () => {
    const products = pgTable('products', {
      id: text('id').primaryKey(),
    });
    const accepted: unknown[] = [];
    const builder = {
      from(value: unknown) {
        accepted.push(value);
        return [];
      },
    };
    const raw = {
      select(projection?: unknown) {
        accepted.push(projection);
        return builder;
      },
    };
    const handle = managedDb(raw, 'write') as unknown as typeof raw;

    expect(() => handle.select({ value: count() }).from(products)).not.toThrow();
    expect(() => handle.select({ value: count(products.id) }).from(products)).not.toThrow();
    expect(() => handle.select({ value: count().as('total') }).from(products)).not.toThrow();

    const countControl = count();
    const injected = drizzleSql.raw('*); select pg_sleep(10)--');
    let executablePropertyReads = 0;
    const forgedCount = new Proxy(countControl, {
      get(target, property, receiver) {
        if (property === 'queryChunks') {
          executablePropertyReads += 1;
          return injected.queryChunks;
        }
        if (property === 'getSQL' || property === 'toQuery') {
          executablePropertyReads += 1;
          return Reflect.get(injected, property, injected);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => handle.select({ value: forgedCount }).from(products)).not.toThrow();
    const reconstructedProjection = accepted[6] as { value: unknown };
    expect(executablePropertyReads).toBe(0);
    expect(reconstructedProjection.value === forgedCount).toBe(false);
    expect(Object.isFrozen(reconstructedProjection.value)).toBe(true);

    expect(() => handle.select({ value: drizzleSql.raw('count(*)') })).toThrow(/KV422/);
    expect(() => handle.select({ value: drizzleSql`count(*)` })).toThrow(/KV422/);
    expect(() =>
      handle.select({
        value: drizzleSql`count(${drizzleSql.raw('*); select pg_sleep(10)--')})`,
      }),
    ).toThrow(/KV422/);
    expect(accepted).toHaveLength(8);
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
        .orderBy(sql`${sql.identifier('created_at', { allow: ['created_at'] })} desc`),
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
          sql.join([sql.identifier('created_at', { allow: ['created_at'] })], staticSql`, `),
        ),
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
    expect(accepted).toHaveLength(5);
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

  it('keeps framework engine hooks usable but unreflectable through the authorization census', async () => {
    const log: string[] = [];
    const raw = {
      select() {
        log.push('writer-select');
        return { from: () => Promise.resolve([]) };
      },
    };
    const censusOptions: AuthorizationCensusDbOptions = {
      dialectLabel: 'Postgres',
      metadata: {
        authorizationClassificationsByTable: new Map(),
        schemaTableNames: new Set(),
      },
      normalizeTableName: (table) => table,
      tableNames: () => [],
    };
    const readonlyTarget = {
      select() {
        log.push('readonly-select');
        return { from: () => Promise.resolve([]) };
      },
    };
    const publicCensus = createAuthorizationCensusDb(raw, censusOptions);
    expect(() =>
      Object.defineProperty(publicCensus, kovoReadonlyDbHandle, {
        configurable: true,
        value: () => raw,
      }),
    ).toThrow();
    const governed = createFrameworkAuthorizationCensusDb(
      raw,
      censusOptions,
      () => readonlyTarget,
      (policy) => {
        log.push(`declared-write:${policy.tables?.join(',') ?? ''}`);
        return raw;
      },
    );

    expect(Object.getOwnPropertyDescriptor(governed, kovoReadonlyDbHandle)).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(governed, kovoDeclaredWriteDbHandle)).toBeUndefined();
    expect(Reflect.ownKeys(governed)).not.toContain(kovoReadonlyDbHandle);
    expect(Reflect.ownKeys(governed)).not.toContain(kovoDeclaredWriteDbHandle);

    const reader = managedDb(governed, 'read') as unknown as {
      select(): { from(table: string): Promise<unknown[]> };
    };
    await expect(reader.select().from('contacts')).resolves.toEqual([]);
    managedDb(governed, 'write', {
      sqlWritePolicy: { tables: ['contacts'], touches: ['contact'] },
    });
    expect(log).toEqual(['readonly-select', 'declared-write:contacts']);
  });

  it('rejects accessor-backed census roots and relational controls without invoking them', () => {
    let accessorExecutions = 0;
    const victims = Object.defineProperty({}, 'findMany', {
      configurable: true,
      get() {
        accessorExecutions += 1;
        return () => [];
      },
    });
    const queryNamespace = Object.defineProperty({ victims }, 'futureRelation', {
      configurable: true,
      get() {
        accessorExecutions += 1;
        return victims;
      },
    });
    const raw = Object.defineProperty({ query: queryNamespace }, 'futureCapability', {
      configurable: true,
      get() {
        accessorExecutions += 1;
        return () => [];
      },
    });
    const handle = createAuthorizationCensusDb(raw, {
      dialectLabel: 'Postgres',
      metadata: {
        authorizationClassificationsByTable: new Map([
          ['victims', ['authzPolicy']],
          ['futureRelation', ['authzPolicy']],
        ]),
        schemaTableNames: new Set(['victims', 'futureRelation']),
      },
      normalizeTableName: (table) => table,
      tableNames: () => [],
    }) as typeof raw;

    expect(() => void handle.futureCapability).toThrow(/KV414[\s\S]*accessor-backed/);
    expect(() => void handle.query.futureRelation).toThrow(/KV414[\s\S]*accessor-backed/);
    expect(() => void handle.query.victims.findMany).toThrow(/KV414[\s\S]*accessor-backed/);
    expect(accessorExecutions).toBe(0);
  });

  it('denies unclassified Drizzle relational roots and nested with selections', async () => {
    const client = new Database(':memory:');
    try {
      client.exec(
        [
          'create table contacts (id text primary key)',
          'create table drafts (id text primary key, contact_id text)',
          "insert into contacts values ('c1')",
          "insert into drafts values ('d1', 'c1')",
        ].join(';'),
      );
      const contacts = sqliteTable('contacts', { id: sqliteText('id').primaryKey() });
      const drafts = sqliteTable('drafts', {
        contactId: sqliteText('contact_id'),
        id: sqliteText('id').primaryKey(),
      });
      const relations = defineRelations({ contacts, drafts }, (r) => ({
        contacts: { drafts: r.many.drafts() },
        drafts: {
          contact: r.one.contacts({ from: r.drafts.contactId, to: r.contacts.id }),
        },
      }));
      const handle = createAuthorizationCensusDb(drizzle({ client, relations }), {
        dialectLabel: 'SQLite',
        metadata: {
          authorizationClassificationsByTable: new Map([['contacts', ['authzPolicy']]]),
          schemaTableNames: new Set(['contacts', 'drafts']),
        },
        normalizeTableName: (table) => table,
        tableNames: (table) => [getTableConfig(table as typeof contacts).name],
      });

      expect(() => handle.query.drafts.findMany()).toThrow(
        /KV414[\s\S]*drafts[\s\S]*no authorization classification/,
      );
      expect(() => handle.query.contacts.findMany({ with: { drafts: true } })).toThrow(
        /KV414[\s\S]*drafts[\s\S]*no authorization classification/,
      );
      expect(Object.getOwnPropertyDescriptor(handle, 'query')).toBeUndefined();
      expect(Reflect.ownKeys(handle)).not.toContain('query');
      await expect(handle.query.contacts.findMany()).resolves.toEqual([{ id: 'c1' }]);
    } finally {
      client.close();
    }
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

  it('cannot hide a second destructive write target through Array.map replacement', () => {
    const executed: unknown[] = [];
    const handle = managedDb(
      {
        query(statement: unknown) {
          executed.push(statement);
          return statement;
        },
      },
      'write',
      { sqlWritePolicy: { dialect: 'postgres', tables: ['allowed'], touches: ['allowed'] } },
    ) as unknown as { query(statement: unknown): unknown };
    const carrier = stampTrustedSql(
      { text: 'truncate table allowed, victim_accounts', values: [] },
      'declared-table completeness regression',
    );
    const nativeMap = Array.prototype.map;
    let error: unknown;
    try {
      Array.prototype.map = function <Value, Result>(
        callback: (value: Value, index: number, array: Value[]) => Result,
      ): Result[] {
        if (
          this.length === 2 &&
          (this[0] as { name?: unknown } | undefined)?.name === 'allowed' &&
          (this[1] as { name?: unknown } | undefined)?.name === 'victim_accounts'
        ) {
          return [callback(this[0] as Value, 0, this as Value[])];
        }
        return Reflect.apply(nativeMap, this, [callback]) as Result[];
      };
      try {
        handle.query(carrier);
      } catch (caught) {
        error = caught;
      }
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('KV406');
    expect(executed).toEqual([]);
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

  it('keeps declared Drizzle writes closed after late Set.has replacement', async () => {
    const writes: string[] = [];
    const raw = {
      insert(table: { name: string }) {
        writes.push(table.name);
        return { values: async () => 'inserted' };
      },
    };
    const handle = createDeclaredWriteDb(
      raw,
      { tables: ['public.allowed'], touches: ['allowed'] },
      {
        dialectLabel: 'proof',
        normalizeTableName: (table) => (table.includes('.') ? table : `public.${table}`),
        tableNames: (table) => [(table as { name: string }).name],
      },
    );
    const nativeHas = Set.prototype.has;
    let error: unknown;
    try {
      Set.prototype.has = function (): boolean {
        return true;
      };
      try {
        await handle.insert({ name: 'victim_accounts' }).values();
      } catch (caught) {
        error = caught;
      }
    } finally {
      Set.prototype.has = nativeHas;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('KV406');
    expect(writes).toEqual([]);
  });

  it('requires every observed Drizzle table to be declared', () => {
    const writes: string[] = [];
    const handle = createDeclaredWriteDb(
      {
        insert(table: string) {
          writes.push(table);
          return { values: () => undefined };
        },
      },
      { tables: ['allowed'] },
      {
        dialectLabel: 'proof',
        normalizeTableName: (table) => table,
        tableNames: () => ['allowed', 'victim_accounts'],
      },
    );

    expect(() => handle.insert('joined-write').values()).toThrow(/KV406/u);
    expect(writes).toEqual([]);
  });

  it('pins declared-write policy and option properties before the first sink', () => {
    const writes: string[] = [];
    const tables = ['allowed'];
    const policy = { tables };
    const options = {
      dialectLabel: 'proof',
      normalizeTableName: (table: string) => table,
      tableNames: (table: string) => [table],
    };
    const handle = createDeclaredWriteDb(
      {
        insert(table: string) {
          writes.push(table);
          return { values: () => undefined };
        },
      },
      policy,
      options,
    );
    tables[0] = 'victim_accounts';
    options.tableNames = () => ['allowed'];

    expect(() => handle.insert('victim_accounts').values()).toThrow(/KV406/u);
    expect(writes).toEqual([]);
  });

  it('real SQLite declared writes and raw reads ignore poisoned Set.has authority', () => {
    const allowed = sqliteTable('allowed', { id: sqliteText('id').primaryKey() });
    const victim = sqliteTable('victim_accounts', {
      id: sqliteText('id').primaryKey(),
      secret: sqliteText('secret').notNull(),
    });
    const dataDir = mkdtempSync(join(process.cwd(), '.tmp-kovo-sqlite-'));
    const sqliteFile = join(dataDir, 'authority.sqlite');
    const client = new Database(sqliteFile);
    client.exec(
      "CREATE TABLE allowed (id text primary key); CREATE TABLE victim_accounts (id text primary key, secret text not null); INSERT INTO victim_accounts VALUES ('v1', 'victim-secret');",
    );
    const db = drizzle({ client });
    const runtime = createSqliteAppRuntimeDb({
      db,
      metadata: {
        allColumnKeys: new Set(['id', 'secret']),
        columnSources: new Map(),
        governedColumnKeysByTable: new Map(),
        governedColumnNamesByTable: new Map(),
        secretColumnKeys: new Set(),
        secretColumnKeysByTable: new Map(),
        secretColumnNames: new Set(),
        secretColumnNamesByTable: new Map(),
        secretTableNames: new Set(),
      },
      normalizeTableName: (table) => (table.includes('.') ? table : `main.${table}`),
      sqliteAuthorizer: {
        constants: nodeSqliteConstants,
        openDatabase: () => new NodeSqliteDatabaseSync(sqliteFile),
      },
      sqliteColumnOrigins: client,
      tableNames: (table) => [`main.${getTableConfig(table as typeof allowed).name}`],
    });
    const writer = managedDb(runtime.db, 'write', {
      sqlWritePolicy: { tables: ['allowed'], touches: ['allowed'] },
    }) as typeof db;
    const rawRead = runtime.readonlyDb.rawRead as <Row>(
      statement: unknown,
      declaration: { actAs?: string; reads: readonly string[] },
    ) => Row[];
    const statement = trustedSql(sql.raw('select id, secret from victim_accounts'), {
      justification: 'real SQLite undeclared raw-read regression',
    });

    try {
      expect(() => writer.insert(victim).values({ id: 'v2', secret: 'stolen' }).run()).toThrow(
        /KV406/u,
      );
      expect(() => rawRead(statement, { actAs: 'attacker', reads: ['allowed'] })).toThrow(
        /outside the declared reads set/u,
      );

      const nativeHas = Set.prototype.has;
      let writeError: unknown;
      let readError: unknown;
      try {
        Set.prototype.has = function (): boolean {
          return true;
        };
        try {
          writer.insert(victim).values({ id: 'v2', secret: 'stolen' }).run();
        } catch (caught) {
          writeError = caught;
        }
        try {
          rawRead(statement, { actAs: 'attacker', reads: ['allowed'] });
        } catch (caught) {
          readError = caught;
        }
      } finally {
        Set.prototype.has = nativeHas;
      }

      expect(writeError).toBeInstanceOf(Error);
      expect((writeError as Error).message).toContain('KV406');
      expect(readError).toBeInstanceOf(Error);
      expect((readError as Error).message).toContain('outside the declared reads set');
      expect(client.prepare('select id from victim_accounts order by id').all()).toEqual([
        { id: 'v1' },
      ]);
      void allowed;
    } finally {
      client.close();
      rmSync(dataDir, { force: true, recursive: true });
    }
  });

  it('pins SQLite runtime security handles through captured property definition', () => {
    const db = { select: () => ({ from: () => [] }) };
    const nativeDefineProperty = Object.defineProperty;
    Object.defineProperty = ((target, property, descriptor) =>
      property === kovoReadonlyDbHandle || property === kovoDeclaredWriteDbHandle
        ? target
        : Reflect.apply(nativeDefineProperty, Object, [
            target,
            property,
            descriptor,
          ])) as typeof Object.defineProperty;

    let runtime: ReturnType<typeof createSqliteAppRuntimeDb<typeof db>>;
    try {
      runtime = createSqliteAppRuntimeDb({
        db,
        metadata: {
          allColumnKeys: new Set(),
          columnSources: new Map(),
          governedColumnKeysByTable: new Map(),
          governedColumnNamesByTable: new Map(),
          secretColumnKeys: new Set(),
          secretColumnKeysByTable: new Map(),
          secretColumnNames: new Set(),
          secretColumnNamesByTable: new Map(),
          secretTableNames: new Set(),
        },
        normalizeTableName: (table) => table,
        sqliteAuthorizer: {
          constants: nodeSqliteConstants,
          openDatabase: () => new NodeSqliteDatabaseSync(':memory:'),
        },
        tableNames: () => [],
      });
    } finally {
      Object.defineProperty = nativeDefineProperty;
    }

    expect(runtime.db[kovoReadonlyDbHandle]()).toBe(runtime.readonlyDb);
    expect(typeof runtime.db[kovoDeclaredWriteDbHandle]).toBe('function');
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

  it('blocks every alternate real PGlite execution surface on scoped clients', async () => {
    const client = new PGlite();
    await client.waitReady;
    try {
      await client.exec('CREATE TABLE scoped_surface_proof (id integer primary key, secret text)');
      const scoped = createPostgresReadonlyClient(client, { readerRole: false }) as typeof client;

      expect(() => scoped.sql`insert into scoped_surface_proof values (1, 'BYPASS')`).toThrow(
        /transaction role frame/u,
      );
      for (const method of [
        'describeQuery',
        'execProtocol',
        'execProtocolRaw',
        'execProtocolRawStream',
        'listen',
        'runExclusive',
      ]) {
        expect(() =>
          ((scoped as unknown as Record<string, unknown>)[method] as () => unknown)(),
        ).toThrow(/transaction role frame/u);
      }
      await expect(
        scoped.transaction(async (tx) => {
          expect(() => tx.sql`select 1`).toThrow(/transaction role frame/u);
          expect(() => tx.rollback()).toThrow(/transaction role frame/u);
          expect(() => tx.listen('proof', () => undefined)).toThrow(/transaction role frame/u);
          return tx.query('select count(*)::int as count from scoped_surface_proof');
        }),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
      await expect(client.query('select * from scoped_surface_proof')).resolves.toMatchObject({
        rows: [],
      });
    } finally {
      await client.close();
    }
  });

  it('pins the real PGlite transaction control before retained raw-client mutation', async () => {
    // SPEC §6.6 C9/§10.3: the exact transaction control that establishes the read-only frame is
    // authority-bearing. A retained raw client must not be able to swap that control after the
    // scoped facade has been constructed.
    const client = new PGlite();
    await client.waitReady;
    try {
      await client.exec('CREATE TABLE tx_swap_proof (id integer primary key, secret text)');
      const scoped = createPostgresReadonlyClient(client, { readerRole: false }) as typeof client;
      const rawQuery = client.query;
      let replacementReached = false;
      Object.defineProperty(client, 'transaction', {
        configurable: true,
        value<Result>(callback: (tx: unknown) => Promise<Result>) {
          replacementReached = true;
          return callback({
            exec: async () => undefined,
            query: (...args: unknown[]) => Reflect.apply(rawQuery, client, args),
          });
        },
      });

      await expect(
        scoped.query("insert into tx_swap_proof values (1, 'BYPASS')"),
      ).rejects.toThrow();
      expect(replacementReached).toBe(false);
      await expect(client.query('select * from tx_swap_proof')).resolves.toMatchObject({ rows: [] });
    } finally {
      await client.close();
    }
  });

  it('pins transaction query and exec controls before the first awaited control statement', async () => {
    const log: string[] = [];
    const tx = {
      exec(statement: string) {
        log.push(`original-exec:${statement}`);
        tx.exec = async (next: string) => {
          log.push(`replacement-exec:${next}`);
        };
        tx.query = async (next: string) => {
          log.push(`replacement-query:${next}`);
          return [{ leaked: 'BYPASS' }];
        };
        return Promise.resolve();
      },
      query(statement: string) {
        log.push(`original-query:${statement}`);
        return Promise.resolve([{ id: 'safe' }]);
      },
    };
    const client = {
      transaction<Result>(callback: (value: typeof tx) => Promise<Result>) {
        return callback(tx);
      },
    };
    const scoped = createPostgresScopedClient(client, {
      principal: 'user-1',
      readOnly: true,
      role: 'kovo_reader',
    });

    await expect(scoped.query('select id from contacts')).resolves.toEqual([{ id: 'safe' }]);
    expect(log).toEqual([
      'original-exec:SET TRANSACTION READ ONLY',
      `original-query:SELECT set_config('kovo.principal', $1, true)`,
      'original-exec:SET LOCAL ROLE "kovo_reader"',
      'original-query:select id from contacts',
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

  it('pins the Postgres principal and role options before app code can mutate them', async () => {
    const log: string[] = [];
    const client = {
      transaction<Result>(callback: (tx: typeof client) => Promise<Result>) {
        return callback(this);
      },
      exec(statement: string) {
        log.push(`exec:${statement}`);
        return Promise.resolve();
      },
      query(statement: string, params?: unknown[]) {
        log.push(`query:${statement}:${JSON.stringify(params ?? [])}`);
        return Promise.resolve([]);
      },
    };
    const options = { principal: 'user-1', role: 'kovo_reader' as string | false };
    const scoped = createPostgresScopedClient(client, options);
    options.principal = 'victim';
    options.role = false;

    await expect(scoped.query('select id from contacts')).resolves.toEqual([]);
    expect(log).toEqual([
      `query:SELECT set_config('kovo.principal', $1, true):["user-1"]`,
      'exec:SET LOCAL ROLE "kovo_reader"',
      'query:select id from contacts:[]',
    ]);
  });

  it('rejects non-callback Postgres transaction overloads before the driver', () => {
    let reached = false;
    const scoped = createPostgresScopedClient({
      transaction(_callback: unknown) {
        reached = true;
      },
    }) as { transaction(callback: unknown): unknown };

    expect(() => scoped.transaction('COMMIT')).toThrow(/require a callback/u);
    expect(reached).toBe(false);
  });

  it('does not let late Function.bind replace the scoped Postgres query choke', async () => {
    const log: string[] = [];
    const client = {
      query(statement: string) {
        log.push(`raw:${statement}`);
        return Promise.resolve([{ secret: 'victim-secret' }]);
      },
      transaction<Result>(callback: (tx: typeof client) => Promise<Result>) {
        log.push('transaction');
        return callback(this);
      },
      exec(statement: string) {
        log.push(`exec:${statement}`);
        return Promise.resolve();
      },
    };
    const scoped = createPostgresScopedClient(client, { principal: 'user-1', role: false });
    const nativeBind = Function.prototype.bind;
    let query: (statement: string) => Promise<unknown>;
    try {
      Function.prototype.bind = function (thisArg: unknown, ...args: unknown[]) {
        if (this.name === 'scopedPostgresQuery') {
          return Reflect.apply(nativeBind, client.query, [client]);
        }
        return Reflect.apply(nativeBind, this, [thisArg, ...args]);
      };
      query = scoped.query;
    } finally {
      Function.prototype.bind = nativeBind;
    }

    await expect(query('select id from allowed')).resolves.toEqual([{ secret: 'victim-secret' }]);
    expect(log).toEqual([
      'transaction',
      `raw:SELECT set_config('kovo.principal', $1, true)`,
      'raw:select id from allowed',
    ]);
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
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
      'SAVEPOINT attacker',
      'RELEASE SAVEPOINT attacker',
      'CREATE TABLE stolen (id text)',
      "RESET ROLE; SELECT set_config('kovo.principal', 'victim', true)",
      '/* hidden utility */ SET ROLE kovo_admin',
      'SELECT 1; /* comment */ SELECT 2',
      "SELECT pg_catalog.set_config('kovo.principal', $1, true)",
      'SELECT "set_config"(\'kovo.principal\', $1, true)',
      'SELECT "pg_catalog"."set_config"(\'kovo.principal\', $1, true)',
      'SELECT U&"set_con\\0066ig"(\'kovo.principal\', $1, true)',
      'SELECT pg_catalog.U&"set_con\\0066ig"(\'kovo.principal\', $1, true)',
      'SELECT U&"pg_c\\0061talog".U&"set_con\\+000066ig"(\'kovo.principal\', $1, true)',
      "SELECT U&\"set_con!0066ig\" UESCAPE '!'('kovo.principal', $1, true)",
      'SELECT /* adjacent */ U&"set_con\\0066ig" /* call */ (\'kovo.principal\', $1, true)',
      'SELECT U&"caf\\00e9"',
      'VACUUM',
    ]) {
      expect(() => scoped.query(statement, ['victim'])).toThrow(/KV414/);
    }

    expect(log).toEqual([]);
  });

  it('keeps scoped-principal SQL control closed after late RegExp replacement', () => {
    // SPEC §6.6/§10.3: principal-setting SQL is classified by a fixed scanner rather than
    // app-replaceable RegExp methods. The engine ACL remains a second, independent door.
    const queries: string[] = [];
    const tx = {
      exec: async (_sql: string) => undefined,
      query: async (statement: string) => {
        queries.push(statement);
        return [];
      },
    };
    const scoped = createPostgresScopedClient(
      {
        transaction: async <Result>(callback: (value: typeof tx) => Promise<Result>) =>
          callback(tx),
      },
      { principal: 'attacker', role: false },
    ) as unknown as { query(sql: string, values?: readonly unknown[]): Promise<unknown> };
    const attackerSql = "SELECT pg_catalog.set_config('kovo.principal', $1, true)";
    const nativeTest = RegExp.prototype.test;
    let error: unknown;
    try {
      RegExp.prototype.test = function (): boolean {
        return false;
      };
      try {
        void scoped.query(attackerSql, ['victim']);
      } catch (caught) {
        error = caught;
      }
    } finally {
      RegExp.prototype.test = nativeTest;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('cannot change framework transaction settings');
    expect(queries).toEqual([]);
  });

  it('keeps transaction-control tokens closed under inherited array index setters', () => {
    const queries: string[] = [];
    const tx = {
      exec: async (_sql: string) => undefined,
      query: async (statement: string) => {
        queries.push(statement);
        return [];
      },
    };
    const scoped = createPostgresScopedClient(
      {
        transaction: async <Result>(callback: (value: typeof tx) => Promise<Result>) =>
          callback(tx),
      },
      { principal: 'attacker', role: false },
    ) as unknown as { query(sql: string): Promise<unknown> };
    const prior = Object.getOwnPropertyDescriptor(Array.prototype, '1');
    let error: unknown;
    try {
      Object.defineProperty(Array.prototype, '1', {
        configurable: true,
        set(value: unknown) {
          if (typeof value === 'string') return;
          Object.defineProperty(this, '1', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      try {
        void scoped.query('ROLLBACK AND CHAIN');
      } catch (caught) {
        error = caught;
      }
    } finally {
      if (prior === undefined) delete (Array.prototype as { 1?: unknown })[1];
      else Object.defineProperty(Array.prototype, '1', prior);
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('cannot control the framework transaction frame');
    expect(queries).toEqual([]);
  });

  it('rejects Unicode-escaped set_config before it can replace the scoped Postgres principal', async () => {
    const client = new PGlite();
    await client.waitReady;
    try {
      await client.exec(
        [
          'CREATE ROLE kovo_writer',
          'CREATE TABLE scoped_notes (id text PRIMARY KEY, owner_id text NOT NULL, title text NOT NULL)',
          `INSERT INTO scoped_notes VALUES ('n1', 'u1', 'One'), ('n2', 'u2', 'Two')`,
          'ALTER TABLE scoped_notes ENABLE ROW LEVEL SECURITY',
          'ALTER TABLE scoped_notes FORCE ROW LEVEL SECURITY',
          `CREATE POLICY owner_scope ON scoped_notes TO kovo_writer USING (owner_id = current_setting('kovo.principal', true)) WITH CHECK (owner_id = current_setting('kovo.principal', true))`,
          'GRANT SELECT, UPDATE ON scoped_notes TO kovo_writer',
        ].join('; '),
      );

      const scoped = createPostgresScopedClient(client, {
        principal: 'u1',
        role: 'kovo_writer',
      }) as typeof client;
      await expect(
        scoped.query(
          `UPDATE scoped_notes SET title = 'blocked' WHERE owner_id = 'u2' RETURNING id`,
        ),
      ).resolves.toMatchObject({ rows: [] });

      await expect(
        scoped.transaction(async (tx) => {
          await tx.query(String.raw`SELECT U&"set_con\0066ig"('kovo.principal', 'u2', true)`);
          return tx.query(
            `UPDATE scoped_notes SET title = 'cross-owner' WHERE owner_id = 'u2' RETURNING id`,
          );
        }),
      ).rejects.toThrow(/KV414/);

      await expect(
        client.query(`SELECT title FROM scoped_notes WHERE id = 'n2'`),
      ).resolves.toMatchObject({ rows: [{ title: 'Two' }] });
    } finally {
      await client.close();
    }
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

  it('binds driver transactions without exposing their underlying client identity', async () => {
    class PrivateFieldClient {
      #ready = true;

      exec(): Promise<void> {
        if (!this.#ready) throw new Error('not ready');
        return Promise.resolve();
      }

      query(): Promise<unknown[]> {
        if (!this.#ready) throw new Error('not ready');
        return Promise.resolve([]);
      }

      transaction<Result>(
        callback: (tx: this) => Promise<Result> | Result,
      ): Promise<Result> | Result {
        if (!this.#ready) throw new Error('not ready');
        return callback(this);
      }
    }

    const scoped = createPostgresScopedClient(new PrivateFieldClient()) as PrivateFieldClient;

    await expect(scoped.transaction((tx) => tx instanceof PrivateFieldClient)).resolves.toBe(false);
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

  it('denies withReplicas primary and replica raw-handle escapes', async () => {
    const primary = new PGlite();
    const replica = new PGlite();
    try {
      const replicated = withPostgresReplicas(
        drizzlePostgres({ client: primary }),
        [drizzlePostgres({ client: replica })],
      );
      const handle = managedDb(replicated, 'write', {
        sqlWritePolicy: { dialect: 'postgres', tables: ['allowed'], touches: ['allowed'] },
      });

      expect(() => void handle.$primary).toThrow(/raw driver escape db\.\$primary|KV422/);
      expect(() => void handle.$replicas).toThrow(/raw driver escape db\.\$replicas|KV422/);
      expect(Object.getOwnPropertyDescriptor(handle, '$primary')).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(handle, '$replicas')).toBeUndefined();
      expect(Reflect.ownKeys(handle)).not.toContain('$primary');
      expect(Reflect.ownKeys(handle)).not.toContain('$replicas');
      expect(Object.getPrototypeOf(handle)).toBeNull();
      expect(() => handle.$primary.execute(drizzleSql.raw('delete from victim_accounts'))).toThrow(
        /raw driver escape db\.\$primary|KV422/,
      );
    } finally {
      await primary.close();
      await replica.close();
    }
  });

  it('denies raw relational builder sessions on managed read handles', async () => {
    const client = new Database(':memory:');
    try {
      client.exec(
        [
          'create table victims (id text primary key)',
          'create table victim_accounts (id text primary key)',
          "insert into victims values ('v1')",
          "insert into victim_accounts values ('a1')",
        ].join(';'),
      );
      const victims = sqliteTable('victims', { id: sqliteText('id').primaryKey() });
      const relations = defineRelations({ victims }, () => ({}));
      const handle = managedDb(drizzle({ client, relations }), 'read');

      await expect(handle.query.victims.findMany()).resolves.toEqual([{ id: 'v1' }]);
      expect(
        Object.getOwnPropertyDescriptor(handle.query.victims, 'session'),
      ).toBeUndefined();
      expect(Reflect.ownKeys(handle.query.victims)).not.toContain('session');
      expect(Object.getPrototypeOf(handle.query.victims)).toBeNull();
      expect(() =>
        Object.defineProperty(handle.query.victims, 'findMany', {
          configurable: true,
          value(this: { session: { run(statement: unknown): unknown } }) {
            this.session.run(drizzleSql.raw('delete from victim_accounts'));
            return [];
          },
        }),
      ).toThrow();
      expect(() =>
        (handle.query.victims as unknown as { session: { run(statement: unknown): unknown } })
          .session.run(drizzleSql.raw('delete from victim_accounts')),
      ).toThrow(/raw driver escape db\.session|KV422/);
      expect(
        client.prepare('select count(*) as count from victim_accounts').get(),
      ).toEqual({ count: 1 });
    } finally {
      client.close();
    }
  });

  it('rejects accessor-backed managed capabilities recursively before invoking them', () => {
    let accessorExecutions = 0;
    const nested = Object.defineProperty({}, 'futureCapability', {
      configurable: true,
      get() {
        accessorExecutions += 1;
        return () => undefined;
      },
    });
    const raw = Object.defineProperty(
      {
        nested,
        select() {
          return { from: () => [] };
        },
      },
      'futureCapability',
      {
        configurable: true,
        get() {
          accessorExecutions += 1;
          return () => undefined;
        },
      },
    );
    const handle = managedDb(raw, 'write', {
      sqlWritePolicy: { tables: ['victims'], touches: ['victim'] },
    }) as typeof raw;

    expect(() => void handle.futureCapability).toThrow(/KV422[\s\S]*accessor-backed/);
    expect(() => void handle.nested.futureCapability).toThrow(/KV422[\s\S]*accessor-backed/);
    expect(accessorExecutions).toBe(0);
  });

  it('denies strict SQL configuration writes while preserving explicit domain transaction state', () => {
    const strictRaw = {
      execute(statement: unknown) {
        return statement;
      },
      securityFlag: true,
    };
    const strict = managedDb(strictRaw, 'write', {
      sqlWritePolicy: { tables: ['victims'], touches: ['victim'] },
    }) as typeof strictRaw;
    expect(() => {
      strict.securityFlag = false;
    }).toThrow();
    expect(strictRaw.securityFlag).toBe(true);

    type DomainDb = {
      count: number;
      transaction<Result>(callback: (db: DomainDb) => Result): Result;
    };
    const domain: DomainDb = {
      count: 1,
      transaction<Result>(callback: (db: DomainDb) => Result): Result {
        return callback(this);
      },
    };
    const governedDomain = managedDb(domain, 'write', {
      sqlWritePolicy: { tables: [], touches: ['counter'] },
    });
    governedDomain.count = 2;
    expect(domain.count).toBe(2);
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

  it('pins real SQLite frame controls through rollback after prototype poisoning', async () => {
    // SPEC §6.6 C9/§10.3: BEGIN and its matching COMMIT/ROLLBACK are one authority frame. The
    // callback cannot replace a shared driver prototype between those transitions.
    const client = new Database(':memory:');
    const nativeExec = Database.prototype.exec;
    try {
      client.exec('create table rollback_control_proof (id integer primary key)');
      await expect(
        runSqliteAsyncTransaction(client, client, async (transactionDb) => {
          (transactionDb as Database).prepare('insert into rollback_control_proof values (1)').run();
          Database.prototype.exec = function (statement: string): Database {
            return Reflect.apply(nativeExec, this, [
              statement === 'ROLLBACK' ? 'COMMIT' : statement,
            ]);
          };
          throw new Error('handler failure');
        }),
      ).rejects.toThrow(/handler failure/u);
    } finally {
      Database.prototype.exec = nativeExec;
    }
    expect(client.prepare('select id from rollback_control_proof').all()).toEqual([]);
    client.close();
  });

  it('pins SQLite controls at managed-handle construction before authored code can poison BEGIN', async () => {
    const client = new Database(':memory:');
    const nativeExec = Database.prototype.exec;
    let callbackReached = false;
    try {
      client.exec('create table begin_control_proof (id integer primary key)');
      const handle = wrapManagedDbForSqlSafety(
        client,
        undefined,
        managedSqlExecutionPolicy({ capability: 'write', dialect: 'sqlite' }),
      ) as Database & {
        [kovoAsyncMutationTransaction]?: (
          callback: (transactionDb: unknown) => Promise<unknown>,
        ) => Promise<unknown>;
      };
      Database.prototype.exec = function (): Database {
        return this;
      };
      const transaction = handle[kovoAsyncMutationTransaction];
      expect(transaction).toBeTypeOf('function');
      await expect(
        transaction!(async () => {
          callbackReached = true;
          client.prepare('insert into begin_control_proof values (1)').run();
          throw new Error('handler failure');
        }),
      ).rejects.toThrow(/handler failure/u);
    } finally {
      Database.prototype.exec = nativeExec;
    }
    expect(callbackReached).toBe(true);
    expect(client.prepare('select id from begin_control_proof').all()).toEqual([]);
    client.close();
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

  it('write mode default-denies benignly named unknown methods and unsupported SQL families', () => {
    const log: string[] = [];
    const handle = managedDb(
      {
        batch(statements: unknown) {
          log.push('batch');
          return statements;
        },
        futureCapability(options: unknown) {
          log.push('futureCapability');
          return options;
        },
        execute(statement: unknown) {
          log.push('execute');
          return statement;
        },
        refreshMaterializedView(view: unknown) {
          log.push('refreshMaterializedView');
          return view;
        },
      },
      'write',
      {
        sqlWritePolicy: {
          dialect: 'postgres',
          tables: ['products'],
          touches: ['product'],
        },
      },
    );

    expect(() =>
      (handle as unknown as { futureCapability(options: unknown): unknown }).futureCapability({}),
    ).toThrow(/unknown managed DB method db\.futureCapability|KV422/);
    expect(() =>
      (handle as unknown as { batch(statements: unknown): unknown }).batch([
        drizzleSql.raw('delete from victim_accounts'),
      ]),
    ).toThrow(/managed DB method db\.batch|KV422/);
    expect(() =>
      (
        handle as unknown as { refreshMaterializedView(view: unknown): unknown }
      ).refreshMaterializedView({ name: 'accounts' }),
    ).toThrow(/managed DB method db\.refreshMaterializedView|KV422/);
    expect(log).toEqual([]);
  });

  it('keeps PostgreSQL selectDistinctOn on the governed builder path', async () => {
    const client = new PGlite();
    try {
      await client.exec(
        "create table products (id text primary key, label text not null); insert into products values ('p1', 'one')",
      );
      const products = pgTable('products', {
        id: text('id').primaryKey(),
        label: text('label').notNull(),
      });
      const handle = managedDb(drizzlePostgres({ client, schema: { products } }), 'write', {
        sqlWritePolicy: {
          dialect: 'postgres',
          tables: ['products'],
          touches: ['product'],
        },
      });

      await expect(
        handle.selectDistinctOn([products.id], { id: products.id }).from(products),
      ).resolves.toEqual([{ id: 'p1' }]);
    } finally {
      await client.close();
    }
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
    const firstReflectGet = source.indexOf('witnessReflectGet(target, prop, receiver)');
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
