import { describe, expect, it } from 'vitest';

import { mutation, s, publicAccess } from '@kovojs/server';

import { createKovoTestHarness } from './harness.js';
import { createSqliteTestDb, type SqliteTestDb } from './sqlite.js';
import { expectedDiagnostic } from './test-fixtures.js';

describe('@kovojs/test SQLite harness integration', () => {
  it('runs mutation suites against an in-memory SQLite database', async () => {
    const db = createSqliteTestDb();

    try {
      db.exec('create table cart_items (product_id text primary key, qty integer not null)');

      const addToCart = mutation('cart/add', {
        access: publicAccess('test fixture'),
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
      access: publicAccess('test fixture'),
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
});
