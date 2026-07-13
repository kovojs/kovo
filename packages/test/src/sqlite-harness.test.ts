import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { stampTrustedSql } from '@kovojs/core/internal/sql-safety';
import { mutation, s } from '@kovojs/server';
import {
  kovoDeclaredWriteDbHandle,
  managedDb,
  type KovoDeclaredWriteDbCapable,
} from '@kovojs/server/internal/execution';

import { createKovoTestHarness } from './harness.js';
import { createSqliteTestDb, type SqliteTestDb } from './sqlite.js';
import { expectedDiagnostic } from './test-fixtures.js';

describe('@kovojs/test SQLite harness integration', () => {
  it('executes managed query snapshots instead of rereading mutable SQLite carriers', () => {
    const db = createSqliteTestDb();

    try {
      db.exec('create table products (id text primary key)');
      db.write('products', { id: 'p1' });
      let textDescriptorReads = 0;
      const carrier = new Proxy(
        {},
        {
          getOwnPropertyDescriptor(_target, prop) {
            if (prop === 'sql') {
              textDescriptorReads += 1;
              return {
                configurable: true,
                enumerable: true,
                value:
                  textDescriptorReads === 1
                    ? 'select id from products where id = ?'
                    : 'delete from products where id = ?',
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
      const writer = managedDb(db, 'write', {
        sqlWritePolicy: { dialect: 'sqlite', tables: ['products'], touches: ['product'] },
      }) as unknown as Pick<SqliteTestDb, 'query'>;

      expect(writer.query<{ id: string }>(carrier as never)).toEqual([{ id: 'p1' }]);
      expect(db.read<{ id: string }>('products')).toEqual([{ id: 'p1' }]);
    } finally {
      db.close();
    }
  });

  it('backs managed readers with a dedicated readonly/query_only SQLite handle', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-sqlite-readonly-'));
    const db = createSqliteTestDb({ filename: join(root, 'app.sqlite') });

    try {
      db.exec('create table products (id text primary key, qty integer not null)');
      db.write('products', { id: 'p1', qty: 1 });
      db.write('products', { id: 'p2', qty: 2 });

      const reader = managedDb(db, 'read', {
        rawRead: {
          dialectLabel: 'SQLite',
          executeMethod: 'query',
          normalizeTableName: (table) => table.replace(/^main\./, ''),
        },
        sqlWritePolicy: { dialect: 'sqlite' },
      }) as unknown as Pick<SqliteTestDb, 'exec' | 'query'> & {
        rawRead<Row extends Record<string, unknown> = Record<string, unknown>>(
          statement: unknown,
          declaration: { reads: readonly string[] },
        ): Row[];
      };

      expect(
        reader.rawRead<{ ids: string }>(
          {
            sql: 'select group_concat(id, ?) as ids from products',
            values: [','],
          },
          { reads: ['products'] },
        ),
      ).toEqual([{ ids: 'p1,p2' }]);
      expect(() =>
        reader.query<{ ids: string }>(
          stampTrustedSql({ sql: "select date('2020-01-02') as today" }, 'static SQLite date read'),
        ),
      ).toThrow(/KV433/);

      for (const statement of [
        { sql: 'insert into products (id, qty) values (?, ?)', values: ['p3', 3] },
        { sql: 'update products set qty = ? where id = ?', values: [4, 'p1'] },
        { sql: 'delete from products where id = ?', values: ['p1'] },
      ]) {
        expect(() => reader.rawRead(statement, { reads: ['products'] })).toThrow(/KV433.*engine/s);
      }
      expect(() =>
        reader.exec(stampTrustedSql({ sql: 'drop table products' }, 'read-surface DDL attempt')),
      ).toThrow(/KV433/);
      expect(() =>
        reader.rawRead(
          stampTrustedSql({ sql: 'select * from products for update' }, 'read lock attempt'),
          { reads: ['products'] },
        ),
      ).toThrow();

      db.write('products', { id: 'p3', qty: 3 });
      expect(db.read<{ id: string }>('products').map((row) => row.id)).toEqual(['p1', 'p2', 'p3']);
    } finally {
      db.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('runs mutation suites against an in-memory SQLite database', async () => {
    const db = createSqliteTestDb();

    try {
      db.exec('create table cart_items (product_id text primary key, qty integer not null)');

      const addToCart = mutation('cart/add', {
        csrf: false,
        csrfJustification: 'test fixture uses a non-browser caller',
        input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
        handler(input, request: { db: SqliteTestDb }) {
          request.db.write('cart_items', {
            product_id: input.productId,
            qty: input.quantity,
          });
          return request.db.read<{ product_id: string; qty: number }>('cart_items');
        },
      });
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'cart.addItem': {
            reads: [
              {
                domain: 'cart',
                keys: null,
                site: 'cart.domain.ts:2',
                source: 'cart_items',
                via: 'cart_items',
              },
            ],
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            cart_items: 'cart',
          },
          sqlDialect: 'sqlite',
        },
      });

      await expect(
        harness.exec(addToCart, { productId: 'p1', quantity: 2 }),
      ).resolves.toMatchObject({
        ok: true,
        value: [{ product_id: 'p1', qty: 2 }],
      });
    } finally {
      db.close();
    }
  });

  it('enforces declared tables on SQLite adapter helper writes with schema-qualified names', () => {
    const db = createSqliteTestDb();

    try {
      db.exec('create table cart_items (product_id text primary key, qty integer not null)');
      db.exec('create table audit_log (product_id text primary key)');

      const writer = managedDb(db, 'write', {
        sqlWritePolicy: {
          dialect: 'sqlite',
          tables: ['cart_items'],
          touches: ['cart'],
        },
      }) as unknown as Pick<SqliteTestDb, 'write'>;

      writer.write('main.cart_items', { product_id: 'p1', qty: 2 });
      expect(db.read<{ product_id: string }>('cart_items')).toMatchObject([{ product_id: 'p1' }]);

      expect(() => writer.write('main.audit_log', { product_id: 'p1' })).toThrow(
        /KV406.*SQLite adapter declared-write fallback/s,
      );
      expect(db.read('audit_log')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('backs file SQLite declared writers with sqlite3_set_authorizer enforcement', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-sqlite-authorizer-'));
    const db = createSqliteTestDb({ filename: join(root, 'app.sqlite') });

    try {
      db.exec('create table cart_items (product_id text primary key, qty integer not null)');
      db.exec('create table audit_log (product_id text primary key)');
      db.exec(`
        create trigger cart_audit
        after update on cart_items
        begin
          insert into audit_log (product_id) values (new.product_id);
        end
      `);

      const writer = (
        db as SqliteTestDb &
          KovoDeclaredWriteDbCapable<Pick<SqliteTestDb, 'exec' | 'query' | 'read'>>
      )[kovoDeclaredWriteDbHandle]({
        dialect: 'sqlite',
        tables: ['cart_items'],
        touches: ['cart'],
      });

      writer.exec("insert into cart_items (product_id, qty) values ('p1', 2)");
      expect(db.read<{ product_id: string; qty: number }>('cart_items')).toEqual([
        { product_id: 'p1', qty: 2 },
      ]);

      expect(() => writer.exec("insert into audit_log (product_id) values ('p1')")).toThrow(
        /KV406.*SQLite authorizer/s,
      );
      expect(() => writer.exec("update cart_items set qty = 3 where product_id = 'p1'")).toThrow(
        /KV406.*SQLite authorizer/s,
      );
      expect(() => writer.exec('create table extra (id text primary key)')).toThrow(
        /KV406.*SQLite authorizer/s,
      );
      expect(() => writer.exec('pragma user_version = 1')).toThrow(/KV406.*SQLite authorizer/s);

      expect(db.read<{ product_id: string }>('audit_log')).toEqual([]);
      expect(db.read<{ product_id: string; qty: number }>('cart_items')).toEqual([
        { product_id: 'p1', qty: 2 },
      ]);
    } finally {
      db.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects raw better-sqlite3 handle SQL strings before touch graph verification', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: Pick<SqliteTestDb, 'sqlite'> }) {
        request.db.sqlite
          .prepare('insert into audit_log (product_id) values (?)')
          .run(input.productId);
        return input.productId;
      },
    });
    const db = createSqliteTestDb();

    try {
      db.exec('create table audit_log (product_id text not null)');
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            audit_log: 'audit',
            cart_items: 'cart',
          },
          sqlDialect: 'sqlite',
        },
      });

      await expect(harness.exec(cartMutation, { productId: 'p1' })).rejects.toThrow(
        /KV422: SQL text injection risk/,
      );
    } finally {
      db.close();
    }
  });

  it('rejects parser-rejected prepared SQLite raw strings before execution-time verification', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: Pick<SqliteTestDb, 'sqlite'> }) {
        request.db.sqlite
          .prepare('replace into audit_log (product_id) values (?)')
          .run(input.productId);
        return input.productId;
      },
    });
    const db = createSqliteTestDb();

    try {
      db.exec('create table audit_log (product_id text primary key)');
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            audit_log: 'audit',
            cart_items: 'cart',
          },
          sqlDialect: 'sqlite',
        },
      });

      await expect(harness.exec(cartMutation, { productId: 'p1' })).rejects.toThrow(
        /KV422: SQL text injection risk/,
      );
    } finally {
      db.close();
    }
  });

  it('rejects raw SQLite trigger SQL strings before touch graph verification', async () => {
    const deleteProduct = mutation('product/delete', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ productId: s.string() }),
      async handler(input, request: { db: Pick<SqliteTestDb, 'exec'> }) {
        await request.db.exec(`delete from products where id = '${input.productId}'`);
        return input.productId;
      },
    });
    const db = createSqliteTestDb();

    try {
      db.exec('create table products (id text primary key)');
      db.exec('create table cart_items (product_id text not null)');
      db.exec(`
        create trigger delete_cart_items
        after delete on products
        begin
          delete from cart_items where product_id = old.id;
        end
      `);
      db.exec("insert into products (id) values ('p1')");
      db.exec("insert into cart_items (product_id) values ('p1')");
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'product.delete': {
            touches: [
              { domain: 'product', keys: 'sql:id', site: 'product.domain.ts:1', via: 'products' },
            ],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            cart_items: 'cart',
            products: 'product',
          },
          sqlDialect: 'sqlite',
        },
      });

      await expect(harness.exec(deleteProduct, { productId: 'p1' })).rejects.toThrow(
        /KV422: SQL text injection risk/,
      );
    } finally {
      db.close();
    }
  });

  it('rejects raw prepared SQLite trigger SQL strings before execution-time verification', async () => {
    const repriceProduct = mutation('product/reprice', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: Pick<SqliteTestDb, 'sqlite'> }) {
        request.db.sqlite
          .prepare('update products set price = ? where id = ?')
          .run(20, input.productId);
        return input.productId;
      },
    });
    const db = createSqliteTestDb();

    try {
      db.exec('create table products (id text primary key, price integer not null)');
      db.exec('create table inventory (product_id text primary key, refreshed_at text not null)');
      db.exec(`
        create trigger refresh_inventory
        after update on products
        begin
          update inventory set refreshed_at = 'v2' where product_id = new.id;
        end
      `);
      db.exec("insert into products (id, price) values ('p1', 10)");
      db.exec("insert into inventory (product_id, refreshed_at) values ('p1', 'v1')");
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'product.reprice': {
            touches: [
              { domain: 'product', keys: 'sql:id', site: 'product.domain.ts:1', via: 'products' },
            ],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            inventory: 'inventory',
            products: 'product',
          },
          sqlDialect: 'sqlite',
        },
      });

      await expect(harness.exec(repriceProduct, { productId: 'p1' })).rejects.toThrow(
        /KV422: SQL text injection risk/,
      );
    } finally {
      db.close();
    }
  });

  it('verifies SQLite trigger fingerprint side effects when row counts do not change', async () => {
    const repriceProduct = mutation('product/reprice', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ productId: s.string() }),
      async handler(input, request: { db: Pick<SqliteTestDb, 'exec'> }) {
        await request.db.exec(`update products set price = 20 where id = '${input.productId}'`);
        return input.productId;
      },
    });
    const db = createSqliteTestDb();

    try {
      db.exec('create table products (id text primary key, price integer not null)');
      db.exec('create table inventory (product_id text primary key, refreshed_at text not null)');
      db.exec(`
        create trigger refresh_inventory
        after update on products
        begin
          update inventory set refreshed_at = 'v2' where product_id = new.id;
        end
      `);
      db.exec("insert into products (id, price) values ('p1', 10)");
      db.exec("insert into inventory (product_id, refreshed_at) values ('p1', 'v1')");
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'product.reprice': {
            touches: [
              { domain: 'product', keys: 'sql:id', site: 'product.domain.ts:1', via: 'products' },
            ],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            inventory: 'inventory',
            products: 'product',
          },
          sqlDialect: 'sqlite',
        },
      });

      await expect(harness.exec(repriceProduct, { productId: 'p1' })).rejects.toThrow(
        /KV422: SQL text injection risk/,
      );
    } finally {
      db.close();
    }
  });
});
