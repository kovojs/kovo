/* oxlint-disable typescript/unbound-method -- Adversarial test replaces late realm methods. */
import { describe, expect, it } from 'vitest';

import { createDbVerifier } from './verifier.js';
import { expectedDiagnostic } from './test-fixtures.js';
import { sqlStatementText } from './sql-observer.js';

const nativeReflectApply = Reflect.apply;

interface SqlDb {
  sql(statement: string): unknown[];
}

function createSqlDb(): SqlDb {
  return {
    sql() {
      return [];
    },
  };
}

describe('@kovojs/test SQL observer', () => {
  it('extracts only supported SQL statement shapes', () => {
    expect(sqlStatementText('select * from products')).toBe('select * from products');
    expect(sqlStatementText({ text: 'select * from products', values: ['p1'] })).toBe(
      'select * from products',
    );
    expect(sqlStatementText({ sql: 'select * from products', parameters: ['p1'] })).toBe(
      'select * from products',
    );
    expect(sqlStatementText({ text: 7, sql: undefined })).toBeUndefined();
    expect(sqlStatementText({ toString: () => 'select * from products' })).toBeUndefined();
  });

  it('passes unparseable SQL through without fabricated observations', () => {
    const calls: string[] = [];
    const verifier = createDbVerifier({}, { domainByTable: { products: 'product' } });
    const db = verifier.wrap({
      sql(statement: string): string[] {
        calls.push(statement);
        return ['adapter-result'];
      },
    });

    expect(db.sql('select * from')).toEqual(['adapter-result']);

    expect(calls).toEqual(['select * from']);
    expect(verifier.observed).toEqual([]);
  });

  it('observes insert-select reads through the verifier wrapper', () => {
    const verifier = createDbVerifier(
      {
        'cart.addFromProduct': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'cart.ts:2',
              source: 'insert-select',
              via: 'products',
            },
          ],
          touches: [{ domain: 'cart', keys: null, site: 'cart.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      { domainByTable: { cart_items: 'cart', products: 'product' } },
    );
    const db = verifier.wrap(createSqlDb());

    db.sql("insert into cart_items (product_id) select id from products where id = 'p1'");

    expect(verifier.observed).toEqual([
      {
        branch: undefined,
        domain: 'cart',
        kind: 'write',
        mutationRead: undefined,
        rowKey: undefined,
        sql: "insert into cart_items (product_id) select id from products where id = 'p1'",
        table: 'cart_items',
      },
      {
        branch: undefined,
        domain: 'product',
        kind: 'read',
        mutationRead: true,
        rowKey: 'id',
        sql: "insert into cart_items (product_id) select id from products where id = 'p1'",
        table: 'products',
      },
    ]);
    expect(() => verifier.assertCovered()).not.toThrow();
  });

  it('C140 pins engine side-effect dispatch and fingerprints against late replacement', async () => {
    const rows: Record<string, Record<string, unknown>[]> = {
      inventory: [{ product_id: 'p1', refreshed_at: 'v1' }],
      products: [{ id: 'p1', price: 10 }],
    };
    const db = {
      async query(statement: string): Promise<{ rows: Record<string, unknown>[] }> {
        if (statement.includes('information_schema.tables')) {
          return { rows: [{ table_name: 'inventory' }, { table_name: 'products' }] };
        }
        const table = /from\s+"([^"]+)"/i.exec(statement)?.[1];
        return { rows: table ? (rows[table]?.map((row) => ({ ...row })) ?? []) : [] };
      },
      async sql(statement: string): Promise<unknown[]> {
        if (/update\s+products\b/i.test(statement)) {
          rows.products[0] = { id: 'p1', price: 20 };
          rows.inventory[0] = { product_id: 'p1', refreshed_at: 'v2' };
        }
        return [];
      },
    };
    const verifier = createDbVerifier(
      {
        'product.reprice': {
          touches: [
            { domain: 'product', keys: null, site: 'product.domain.ts:1', via: 'products' },
            { domain: 'inventory', keys: null, site: 'product.domain.ts:2', via: 'inventory' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { inventory: 'inventory', products: 'product' } },
    );
    const wrapped = verifier.wrap(db);

    const nativeCall = Function.prototype.call;
    const nativeStringify = JSON.stringify;
    try {
      Function.prototype.call = function (thisArg: unknown, ...args: unknown[]) {
        if (this === db.query) return Promise.resolve({ rows: [] });
        return nativeReflectApply(this, thisArg, args);
      };
      JSON.stringify = () => 'constant-attacker-fingerprint';
      await wrapped.sql("update products set price = 20 where id = 'p1'");
    } finally {
      JSON.stringify = nativeStringify;
      Function.prototype.call = nativeCall;
    }

    expect(verifier.observed).toEqual([
      {
        branch: undefined,
        domain: 'product',
        kind: 'write',
        mutationRead: undefined,
        rowKey: 'id',
        sql: "update products set price = 20 where id = 'p1'",
        table: 'products',
      },
      {
        branch: undefined,
        domain: 'inventory',
        kind: 'write',
        mutationRead: undefined,
        rowKey: undefined,
        sql: "update products set price = 20 where id = 'p1'",
        table: 'inventory',
      },
    ]);
    expect(() => verifier.assertCovered('product.reprice')).not.toThrow();
  });

  it('does not let later CTE aliases hide earlier body table reads', () => {
    const verifier = createDbVerifier(
      {},
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createSqlDb());
    const statement = [
      'with source as (select * from products where id = $1),',
      'products as (select * from source)',
      'select * from products',
    ].join(' ');

    db.sql(statement);

    expect(verifier.observed).toEqual([
      {
        branch: undefined,
        domain: 'product',
        kind: 'read',
        mutationRead: undefined,
        rowKey: 'id',
        sql: statement,
        table: 'products',
      },
    ]);
    expect(() => verifier.assertReadsCovered(['product'])).not.toThrow();
    expect(() => verifier.assertReadsCovered([])).toThrow(expectedDiagnostic('KV407', 'product'));
  });
});
