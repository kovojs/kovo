import { describe, expect, it } from 'vitest';

import { createDbVerifier } from './index.js';

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

describe('@jiso/test SQL verifier observation', () => {
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
});
