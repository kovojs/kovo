import { describe, expect, it } from 'vitest';
import { KovoReadonlyHandleError, managedDb, readonlyDb } from './managed-db.js';
import { runQuery } from './query.js';
import { query } from './api/data.js';
import { domain } from './domain.js';

// SPEC §6.6/§9.4/§10.3 (MARQUEE / KV433+KV422): the framework-owned managed DB handle.
//
// These tests prove the runtime floor: a `query()` loader's `context.db` is the SQL-safe (KV422)
// read-only (KV433) handle whose write verbs throw, while reads pass through; a `query.elevated`
// loader receives the full read-write handle; and the KV422 raw-string rejection still holds through
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
    // Make the value look like a db adapter so the SQL-safe wrap engages.
    execute(statement: unknown) {
      log.push('execute');
      return Promise.resolve(statement);
    },
  };
}

describe('readonlyDb (KV433 Stage 1 runtime proxy)', () => {
  it('throws KovoReadonlyHandleError on every write verb', () => {
    const reader = readonlyDb(fakeDb([]));
    for (const verb of ['insert', 'update', 'delete', 'execute', 'run', 'batch'] as const) {
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
});

describe('managedDb (KV422 SQL-safe unified with KV433 read-only)', () => {
  it('read mode rejects writes AND raw-string SQL (the unification)', () => {
    const handle = managedDb(fakeDb([]), 'read');
    // KV433: write verb throws the readonly error.
    expect(() => (handle as { insert(t: string): unknown }).insert('products')).toThrow(
      KovoReadonlyHandleError,
    );
    // KV422: a raw string statement is rejected by the same handle.
    expect(() => (handle as { query(s: unknown): unknown }).query('SELECT 1')).toThrow(/KV422/);
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

  it('query.elevated receives the full read-write handle (audited escape)', async () => {
    const log: string[] = [];
    const db = fakeDb(log);
    const elevated = query.elevated('product/touch', {
      reads: [product],
      async load(_input, context) {
        // Idempotent-safe-to-repeat write on a read surface — allowed only because elevated.
        await (
          context!.db as unknown as { update(t: string): { set(): { where(): Promise<void> } } }
        )
          .update('products')
          .set()
          .where();
        return { touched: true };
      },
    });

    expect(elevated.elevated).toBe(true);
    const result = await runQuery(elevated, undefined, { db: undefined }, { db: () => db });
    expect(result.ok).toBe(true);
    expect(log).toContain('update:products');
  });
});
