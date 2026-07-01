import { describe, expect, it } from 'vitest';

import { mutation, s } from '@kovojs/server';

import { createKovoTestHarness } from './harness.js';
import { createSqliteTestDb, type SqliteTestDb } from './sqlite.js';
import { expectedDiagnostic } from './test-fixtures.js';

describe('@kovojs/test SQLite harness integration', () => {
  it('runs mutation suites against an in-memory SQLite database', async () => {
    const db = createSqliteTestDb();

    try {
      db.exec('create table cart_items (product_id text primary key, qty integer not null)');

      const addToCart = mutation('cart/add', {
        csrf: false,
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

  it('verifies raw better-sqlite3 handle calls against the static touch graph', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
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
        expectedDiagnostic('KV402', 'audit'),
      );
    } finally {
      db.close();
    }
  });

  it('verifies parser-rejected prepared SQLite writes at execution time', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
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
        expectedDiagnostic('KV402', 'audit'),
      );
    } finally {
      db.close();
    }
  });

  it('verifies SQLite trigger count side effects against the static touch graph', async () => {
    const deleteProduct = mutation('product/delete', {
      csrf: false,
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
        expectedDiagnostic('KV402', 'cart'),
      );
    } finally {
      db.close();
    }
  });

  it('verifies prepared SQLite trigger fingerprint side effects at execution time', async () => {
    const repriceProduct = mutation('product/reprice', {
      csrf: false,
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
        expectedDiagnostic('KV402', 'inventory'),
      );
    } finally {
      db.close();
    }
  });

  it('verifies SQLite trigger fingerprint side effects when row counts do not change', async () => {
    const repriceProduct = mutation('product/reprice', {
      csrf: false,
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
        expectedDiagnostic('KV402', 'inventory'),
      );
    } finally {
      db.close();
    }
  });
});
