import { execFileSync, type ExecFileSyncOptionsWithBufferEncoding } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stampTrustedSql } from '@kovojs/core/internal/sql-safety';
import { KovoReadonlyHandleError, managedDb, readonlyDb } from './managed-db.js';
import type { Reader } from './managed-db.js';
import { kovoAsyncMutationTransaction, wrapManagedDbForSqlSafety } from './sql-safe-handle.js';
import { runQuery } from './query.js';
import { query } from './api/data.js';
import { domain } from './domain.js';

// SPEC §6.6/§9.4/§10.3 (MARQUEE / KV433+KV422): the framework-owned managed DB handle.
//
// These tests prove the runtime floor: a `query()` loader's `context.db` is the SQL-safe (KV422)
// read-only (KV433) handle whose write verbs throw, while reads pass through; mutation/write
// surfaces receive the full read-write handle; and the KV422 raw-string rejection still holds through
// the managed handle (the unification). The static no-write-reachable proof (KV433 Stage 2) and the
// `Reader<Db>` tsc mirror are exercised elsewhere (drizzle static gate; type-level).

const product = domain('product');

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
import { readonlyDb, type Reader } from '@kovojs/server';

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

// @ts-expect-error SPEC §6.6/§9.4/§10.3: raw provider handles lack the Reader brand.
acceptsReader(raw);
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
      // @ts-expect-error managedDb(..., 'read') exposes only the read capability allowlist.
      readHandle.transaction(() => undefined);
      // @ts-expect-error managedDb(..., 'read') does not expose raw driver escape handles.
      void readHandle.$client;
      const writeHandle = managedDb(raw, 'write');
      writeHandle.insert('products');
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

  it('routes SQL-shaped driver methods through the parser instead of denying by name', async () => {
    const log: string[] = [];
    const reader = readonlyDb(fakeDb(log)) as unknown as Record<
      'all' | 'execute' | 'futureStatement' | 'get' | 'run' | 'values',
      (statement: unknown) => Promise<unknown>
    >;

    for (const method of ['all', 'execute', 'futureStatement', 'get', 'run', 'values'] as const) {
      await expect(
        reader[method]({ sql: 'select id from products where id = ?', values: ['p1'] }),
      ).resolves.toMatchObject({ sql: 'select id from products where id = ?' });
    }
    expect(log).toEqual(['all', 'execute', 'futureStatement', 'get', 'run', 'values']);

    for (const method of ['all', 'execute', 'futureStatement', 'get', 'run', 'values'] as const) {
      expect(() =>
        reader[method](
          stampTrustedSql(
            { sql: 'delete from products where id = ? returning id', values: ['p1'] },
            `${method} read-handle write attempt`,
          ),
        ),
      ).toThrow(/KV433/);
    }
    expect(log).toEqual(['all', 'execute', 'futureStatement', 'get', 'run', 'values']);
  });

  it('passes reads through unchanged', async () => {
    const log: string[] = [];
    const reader = readonlyDb(fakeDb(log));
    const rows = await reader.select().from('products');
    expect(rows).toEqual([{ id: 'p1' }]);
    expect(log).toEqual(['select:products']);
  });

  it('parses allowed SQL-shaped read methods instead of trusting the allowlist alone', async () => {
    const log: string[] = [];
    const reader = readonlyDb(fakeDb(log));
    const queryMethod = (reader as unknown as { query(statement: unknown): Promise<unknown> })
      .query;

    expect(() => queryMethod('select * from products')).toThrow(/KV422/);
    expect(() =>
      queryMethod(
        stampTrustedSql(
          { sql: 'delete from products where id = ? returning id', values: ['p1'] },
          'attempted public read-handle write',
        ),
      ),
    ).toThrow(/KV433/);
    expect(log).toEqual([]);

    await expect(
      queryMethod({ sql: 'select id from products where id = ?', values: ['p1'] }),
    ).resolves.toMatchObject({ sql: 'select id from products where id = ?' });
    expect(log).toEqual(['query']);
  });

  it('binds allowed read methods to the wrapped DB target', async () => {
    const log: string[] = [];
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
  it('read mode rejects writes AND raw-string SQL (the unification)', () => {
    const handle = managedDb(fakeDb([]), 'read');
    // KV433: write verb throws the readonly error.
    expect(() => (handle as unknown as { insert(t: string): unknown }).insert('products')).toThrow(
      KovoReadonlyHandleError,
    );
    // KV422: a raw string statement is rejected by the same handle.
    expect(() => (handle as { query(s: unknown): unknown }).query('SELECT 1')).toThrow(/KV422/);
  });

  it('read mode rejects SQL writes even through allowed read-shaped SQL methods', () => {
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
    ).not.toThrow();
  });

  it('read mode parses SQLite sinks and blocks mutating statements before execution', async () => {
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

    await expect(
      (handle as unknown as { all(statement: unknown): Promise<unknown> }).all({
        sql: 'select id from products where id = ?',
        values: ['p1'],
      }),
    ).resolves.toMatchObject({ sql: 'select id from products where id = ?' });
    expect(() =>
      (
        handle as unknown as { transaction(callback: (tx: unknown) => unknown): unknown }
      ).transaction(() => {
        log.push('callback-entered');
      }),
    ).toThrow(KovoReadonlyHandleError);
    expect(log).toEqual(['all']);
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
  ])('$name parses SQLite read sinks and rejects write-shaped reads', async ({ create }) => {
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
    await expect(
      (handle as unknown as { get(statement: unknown): Promise<unknown> }).get({
        sql: 'select id from products where id = ?',
        values: ['p1'],
      }),
    ).resolves.toMatchObject({ sql: 'select id from products where id = ?' });
    expect(() =>
      (
        handle as unknown as { transaction(callback: (tx: unknown) => unknown): unknown }
      ).transaction(() => {
        log.push('transaction-callback-entered');
      }),
    ).toThrow(KovoReadonlyHandleError);

    const rows = await (handle as unknown as ReturnType<typeof fakeDb>).select().from('products');
    expect(rows).toEqual([{ id: 'p1' }]);
    expect(log).toEqual(['get', 'select:products']);
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
  ])('$name denies raw driver escape properties and parses future methods', async ({ create }) => {
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

    expect(
      (handle as unknown as { futureStatement(statement: unknown): unknown }).futureStatement({
        sql: 'select id from products where id = ?',
        values: ['p1'],
      }),
    ).toMatchObject({ sql: 'select id from products where id = ?' });
    expect(log).toEqual(['futureStatement:[object Object]']);
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
    const handle = wrapManagedDbForSqlSafety(raw, undefined, {
      capability: 'read',
      dialect: 'sqlite',
    });

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
    ).resolves.toMatchObject({ sql: 'select id from products where id = ?' });
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
      { capability: 'read', dialect: 'sqlite' },
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
      { capability: 'read' },
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
    'read mode $name rejects raw strings and mutating statements before execution',
    async ({ dialect, log: expectedLog, method, read, rawDb, write }) => {
      const log: string[] = [];
      const handle = managedDb(rawDb(log), 'read', {
        sqlWritePolicy: dialect === undefined ? {} : { dialect },
      }) as unknown as Record<string, (statement: unknown) => unknown>;

      const execute = (statement: unknown) => handle[method]!(statement);

      expect(() => execute('select id from products')).toThrow(/KV422/);
      expect(log).toEqual([]);

      await expect(Promise.resolve(execute(read))).resolves.toMatchObject(read);
      expect(log).toEqual([expectedLog]);

      expect(() => execute(stampTrustedSql(write, `read-mode ${method} write attempt`))).toThrow(
        /KV433/,
      );
      expect(log).toEqual([expectedLog]);
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
      {
        capability: 'write',
        dialect: 'sqlite',
        tables: ['contacts'],
        touches: ['contact'],
      },
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
    ).resolves.toMatchObject({ sql: 'select id from products where id = ?' });
    await expect(
      handle.run(
        stampTrustedSql(
          { sql: 'update products set name = ? where id = ?', values: ['Ada', 'p1'] },
          'audited SQLite product update',
        ),
      ),
    ).resolves.toMatchObject({ sql: 'update products set name = ? where id = ?' });
    expect(() =>
      handle.values(
        stampTrustedSql(
          { sql: 'delete from users where id = ?', values: ['u1'] },
          'drifted SQLite user delete',
        ),
      ),
    ).toThrow(/KV406/);
    expect(log).toEqual(['get', 'run']);
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
    const outer = wrapManagedDbForSqlSafety(inner, undefined, {
      capability: 'write',
      tables: ['products'],
      touches: ['product'],
    });

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
    ).toMatchObject({ sql: 'select id from products where id = ?' });
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

      await expect(Promise.resolve(execute(read))).resolves.toMatchObject(read);
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
