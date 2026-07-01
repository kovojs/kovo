import { describe, expect, it } from 'vitest';
import { stampTrustedSql } from '@kovojs/core/internal/sql-safety';
import { KovoReadonlyHandleError, managedDb, readonlyDb } from './managed-db.js';
import type { Reader } from './managed-db.js';
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

describe('readonlyDb (KV433 Stage 1 runtime proxy)', () => {
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
      const readHandle = managedDb(raw, 'read');
      acceptsReader(readHandle);
      // @ts-expect-error managedDb(..., 'read') returns the branded read-only surface.
      readHandle.update('products');
      // @ts-expect-error managedDb(..., 'read') exposes only the read capability allowlist.
      readHandle.transaction(() => undefined);
      const writeHandle = managedDb(raw, 'write');
      writeHandle.insert('products');
    };
    void compileOnly;
  });

  it('throws KovoReadonlyHandleError on every non-read capability', () => {
    const reader = readonlyDb(fakeDb([]));
    for (const verb of [
      'all',
      'batch',
      'delete',
      'execute',
      'get',
      'insert',
      'run',
      'transaction',
      'update',
      'values',
      'with',
    ] as const) {
      const method = (reader as Record<string, unknown>)[verb];
      expect(typeof method).toBe('function');
      expect(() => (method as () => unknown)()).toThrow(KovoReadonlyHandleError);
    }
  });

  it('passes reads through unchanged', async () => {
    const log: string[] = [];
    const reader = readonlyDb(fakeDb(log));
    const rows = await reader.select().from('products');
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

  it('read mode denies SQLite sink and transaction properties before they can write', () => {
    const log: string[] = [];
    const handle = managedDb(fakeDb(log), 'read', {
      sqlWritePolicy: { dialect: 'sqlite' },
    });

    for (const verb of ['all', 'get', 'values'] as const) {
      expect(() =>
        (handle as unknown as Record<typeof verb, (statement: unknown) => unknown>)[verb](
          stampTrustedSql(
            { sql: 'insert into products (id) values (?) returning id', values: ['p1'] },
            `${verb} write attempt`,
          ),
        ),
      ).toThrow(KovoReadonlyHandleError);
    }
    expect(() =>
      (
        handle as unknown as { transaction(callback: (tx: unknown) => unknown): unknown }
      ).transaction(() => {
        log.push('callback-entered');
      }),
    ).toThrow(KovoReadonlyHandleError);
    expect(log).toEqual([]);
  });

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
