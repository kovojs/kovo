import { describe, expect, it } from 'vitest';

import { createDbVerifier } from './verifier.js';
import { expectedDiagnostic } from './test-fixtures.js';
import { sqlStatementText } from './sql-observer.js';

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
