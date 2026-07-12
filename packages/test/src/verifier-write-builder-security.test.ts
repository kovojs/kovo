import { describe, expect, it } from 'vitest';

import { managedDb } from '@kovojs/server/internal/execution';

import { expectedDiagnostic } from './test-fixtures.js';
import { createDbVerifier } from './verifier.js';

const drizzleTableName = Symbol.for('drizzle:Name');

function table(name: string): { [drizzleTableName]: string } {
  return { [drizzleTableName]: name };
}

describe('@kovojs/test Drizzle write-builder security', () => {
  it('C219 observes update-from reads through returning and execution', () => {
    const products = table('products');
    const prices = table('prices');
    let escapeCalls = 0;
    const writeBuilder = {
      execute() {
        return [];
      },
      escape() {
        escapeCalls += 1;
      },
      from(_source: unknown) {
        return this;
      },
      returning() {
        return this;
      },
      set(_values: unknown) {
        return this;
      },
    };
    const verifier = createDbVerifier(
      {
        syncProduct: {
          reads: [],
          touches: [{ domain: 'product', keys: null, site: 'sync.ts:1', via: 'products' }],
          unresolved: [],
        },
      },
      { domainByTable: { prices: 'price', products: 'product' } },
    );
    const db = verifier.wrap({
      update(_target: unknown) {
        return writeBuilder;
      },
    });

    const entry = db.update(products);
    const base = entry.set({ price: 10 });
    const fromDescriptor = Object.getOwnPropertyDescriptor(base, 'from');
    const escapeDescriptor = Object.getOwnPropertyDescriptor(base, 'escape');
    expect(Object.getPrototypeOf(entry)).toBeNull();
    expect(Object.getPrototypeOf(base)).toBeNull();
    expect(fromDescriptor && 'value' in fromDescriptor).toBe(true);
    expect(fromDescriptor && 'value' in fromDescriptor ? fromDescriptor.value : null).not.toBe(
      writeBuilder.from,
    );
    expect(() =>
      escapeDescriptor && 'value' in escapeDescriptor
        ? Reflect.apply(escapeDescriptor.value as Function, base, [])
        : undefined,
    ).toThrow(/KV407.*unsupported write-builder/u);
    expect(escapeCalls).toBe(0);
    base.from(prices).returning().execute();

    expect(verifier.observed).toContainEqual(
      expect.objectContaining({ kind: 'read', mutationRead: true, table: 'prices' }),
    );

    expect(() => verifier.assertCovered('syncProduct')).toThrow(
      expectedDiagnostic('KV407', 'price'),
    );
  });

  it('C219 observes insert-select callback reads through returning and execution', () => {
    const products = table('products');
    const vendors = table('vendors');
    const snapshots = table('product_snapshots');
    let readEscapeCalls = 0;
    let queryEscapeCalls = 0;
    let selectedByAdapter: unknown;
    let safeQueryBuilder: unknown;
    let safeReadBuilder: unknown;
    const readBuilder = {
      escape() {
        readEscapeCalls += 1;
      },
      from(_source: unknown) {
        return this;
      },
      innerJoin(_source: unknown) {
        return this;
      },
    };
    const writeBuilder = {
      execute() {
        return [];
      },
      returning() {
        return this;
      },
      select(query: (qb: { select(): typeof readBuilder }) => unknown) {
        const queryBuilder = {
          escape() {
            queryEscapeCalls += 1;
          },
          select: () => readBuilder,
        };
        selectedByAdapter = query(queryBuilder);
        return this;
      },
    };
    const verifier = createDbVerifier(
      {
        refreshSnapshots: {
          reads: [],
          touches: [
            {
              domain: 'snapshot',
              keys: null,
              site: 'snapshots.ts:1',
              via: 'product_snapshots',
            },
          ],
          unresolved: [],
        },
      },
      {
        domainByTable: {
          products: 'product',
          product_snapshots: 'snapshot',
          vendors: 'vendor',
        },
      },
    );
    const db = verifier.wrap({
      insert(_target: unknown) {
        return writeBuilder;
      },
    });

    db.insert(snapshots)
      .select((qb) => {
        safeQueryBuilder = qb;
        safeReadBuilder = qb.select();
        return safeReadBuilder.from(products).innerJoin(vendors);
      })
      .returning()
      .execute();

    expect(selectedByAdapter).toBe(readBuilder);
    expect(Object.getPrototypeOf(safeQueryBuilder)).toBeNull();
    expect(Object.getPrototypeOf(safeReadBuilder)).toBeNull();
    expect(() => (safeQueryBuilder as { escape(): void }).escape()).toThrow(
      /KV407.*insert-select query-builder/u,
    );
    expect(() => (safeReadBuilder as { escape(): void }).escape()).toThrow(
      /KV407.*unsupported read-builder/u,
    );
    expect(queryEscapeCalls).toBe(0);
    expect(readEscapeCalls).toBe(0);
    expect(verifier.observed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'read', mutationRead: true, table: 'products' }),
        expect.objectContaining({ kind: 'read', mutationRead: true, table: 'vendors' }),
      ]),
    );

    expect(() => verifier.assertCovered('refreshSnapshots')).toThrow(
      expectedDiagnostic('KV407', 'product'),
    );
  });

  it('C219 recursively wraps insert, update, delete, and prepared write chains', () => {
    const products = table('products');
    const prices = table('prices');
    const vendors = table('vendors');
    const auditLog = table('audit_log');
    const snapshots = table('product_snapshots');
    const prepared = {
      escape() {
        throw new Error('raw prepared escape executed');
      },
      execute() {
        return ['prepared'];
      },
    };
    const calls: string[] = [];
    const insertBuilder = {
      execute() {
        calls.push('insert.execute');
      },
      onConflictDoUpdate() {
        calls.push('insert.conflict');
        return this;
      },
      returning() {
        calls.push('insert.returning');
        return this;
      },
      values() {
        calls.push('insert.values');
        return this;
      },
    };
    const updateBuilder = {
      execute() {
        calls.push('update.execute');
      },
      from() {
        calls.push('update.from');
        return this;
      },
      leftJoin() {
        calls.push('update.leftJoin');
        return this;
      },
      prepare() {
        calls.push('update.prepare');
        return prepared;
      },
      returning() {
        calls.push('update.returning');
        return this;
      },
      set() {
        calls.push('update.set');
        return this;
      },
      where() {
        calls.push('update.where');
        return this;
      },
    };
    const deleteBuilder = {
      execute() {
        calls.push('delete.execute');
      },
      returning() {
        calls.push('delete.returning');
        return this;
      },
      using() {
        calls.push('delete.using');
        return this;
      },
      where() {
        calls.push('delete.where');
        return this;
      },
    };
    const verifier = createDbVerifier(
      {
        refresh: {
          reads: [
            {
              domain: 'audit',
              keys: null,
              site: 'refresh.ts:4',
              source: 'delete-using',
              via: 'audit_log',
            },
            {
              domain: 'price',
              keys: null,
              site: 'refresh.ts:2',
              source: 'update-from',
              via: 'prices',
            },
            {
              domain: 'vendor',
              keys: null,
              site: 'refresh.ts:3',
              source: 'update-from',
              via: 'vendors',
            },
          ],
          touches: [
            { domain: 'product', keys: null, site: 'refresh.ts:2', via: 'products' },
            { domain: 'snapshot', keys: null, site: 'refresh.ts:1', via: 'product_snapshots' },
          ],
          unresolved: [],
        },
      },
      {
        domainByTable: {
          audit_log: 'audit',
          prices: 'price',
          products: 'product',
          product_snapshots: 'snapshot',
          vendors: 'vendor',
        },
      },
    );
    const db = verifier.wrap({
      delete() {
        return deleteBuilder;
      },
      insert() {
        return insertBuilder;
      },
      update() {
        return updateBuilder;
      },
    });

    db.insert(snapshots).values({ id: 'p1' }).onConflictDoUpdate({}).returning().execute();
    const update = db
      .update(products)
      .set({ price: 10 })
      .from(prices)
      .leftJoin(vendors, true)
      .where(true)
      .returning();
    update.execute();
    const safePrepared = update.prepare();
    expect(Object.getPrototypeOf(safePrepared)).toBeNull();
    expect(safePrepared.execute()).toEqual(['prepared']);
    expect(() => safePrepared.escape()).toThrow(/KV407.*unsupported write-builder/u);
    db.delete(products).using(auditLog).where(true).returning().execute();

    expect(calls).toEqual([
      'insert.values',
      'insert.conflict',
      'insert.returning',
      'insert.execute',
      'update.set',
      'update.from',
      'update.leftJoin',
      'update.where',
      'update.returning',
      'update.execute',
      'update.prepare',
      'delete.using',
      'delete.where',
      'delete.returning',
      'delete.execute',
    ]);
    expect(() => verifier.assertCovered('refresh')).not.toThrow();
  });

  it('C219 accepts only witnessed direct insert-select builders', () => {
    const products = table('products');
    const snapshots = table('product_snapshots');
    const readBuilder = {
      from() {
        return this;
      },
    };
    let selectedByAdapter: unknown;
    const insertBuilder = {
      execute() {},
      select(selected: unknown) {
        selectedByAdapter = selected;
        return this;
      },
    };
    const verifier = createDbVerifier(
      {
        refresh: {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'refresh.ts:1',
              source: 'insert-select',
              via: 'products',
            },
          ],
          touches: [
            { domain: 'snapshot', keys: null, site: 'refresh.ts:1', via: 'product_snapshots' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product', product_snapshots: 'snapshot' } },
    );
    const db = verifier.wrap({
      insert() {
        return insertBuilder;
      },
      select() {
        return readBuilder;
      },
    });

    db.insert(snapshots).select(db.select().from(products)).execute();

    expect(selectedByAdapter).toBe(readBuilder);
    expect(() => verifier.assertCoveredOperations(verifier.observed, 'refresh')).not.toThrow();
    expect(() => db.insert(snapshots).select({ getSQL: () => 'select * from products' })).toThrow(
      /KV407.*verifier-wrapped read builder/u,
    );
  });

  it('C219 composes insert-select observation under the managed write membrane', () => {
    const products = table('products');
    const snapshots = table('product_snapshots');
    const readBuilder = {
      from() {
        return this;
      },
    };
    const insertBuilder = {
      execute() {},
      select(query: (qb: { select(): typeof readBuilder }) => unknown) {
        query({ select: () => readBuilder });
        return this;
      },
    };
    const verifier = createDbVerifier(
      {
        refresh: {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'refresh.ts:1',
              source: 'insert-select',
              via: 'products',
            },
          ],
          touches: [
            { domain: 'snapshot', keys: null, site: 'refresh.ts:1', via: 'product_snapshots' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product', product_snapshots: 'snapshot' } },
    );
    const observed = verifier.wrap({
      insert() {
        return insertBuilder;
      },
    });
    const db = managedDb(observed, 'write') as unknown as typeof observed;

    db.insert(snapshots)
      .select((qb) => qb.select().from(products))
      .execute();

    expect(() => verifier.assertCovered('refresh')).not.toThrow();
  });

  it('C219 rejects write builders whose target has no stable physical identity', () => {
    let adapterCalls = 0;
    const verifier = createDbVerifier({}, { domainByTable: {} });
    const db = verifier.wrap({
      update() {
        adapterCalls += 1;
        return { set: () => ({ execute() {} }) };
      },
    });

    expect(() => db.update({}).set({ value: 1 }).execute()).toThrow(
      /KV407.*stable physical identity/u,
    );
    expect(adapterCalls).toBe(0);
  });
});
