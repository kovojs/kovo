import { describe, expect, it } from 'vitest';

import { extractQueryFactsFromProject as extractQueryFactsFromProjectBase } from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

const extractQueryFactsFromProject = (
  options: Parameters<typeof extractQueryFactsFromProjectBase>[0],
) => extractQueryFactsFromProjectBase(withPgDatabaseTypes(options));

// SPEC §10.1: `kovo({ key })` accepts a column name OR a `(t) => t.col` selector
// (the Drizzle idiom). The compiler reads the selector statically, so a keyed
// read must derive the same `instanceKey` from either form. The annotation key
// drives instance-keying (matched against the read's `where` predicate), so a
// broken selector extraction would change `instanceKey`.
const factsForCartKey = (cartKey: string) =>
  extractQueryFactsFromProject({
    files: [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { innerJoin(table: unknown, on: unknown): { where(value: unknown): Promise<unknown[]> } } };',
      ]),
      {
        fileName: 'cart.queries.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          `export const cartItems = pgTable("cart_items", { cartId: text("cart_id").notNull(), productId: text("product_id").notNull(), qty: integer("qty").notNull() }, kovo({ domain: "cart", key: ${cartKey} }));`,
          'export const products = pgTable("products", { id: text("id").primaryKey() }, kovo({ domain: "product", key: "id" }));',
          '',
          'export const cartQuery = query("cart", {',
          '  output: s.object({ count: s.number() }),',
          '  async load(input, db: PgDatabase<any, any, any>) {',
          '    return db',
          '      .select({ count: sql<number>`count(*)`, productId: products.id })',
          '      .from(cartItems)',
          '      .innerJoin(products, eq(products.id, cartItems.productId))',
          '      .where(eq(cartItems.cartId, input.cartId));',
          '  },',
          '});',
        ].join('\n'),
      },
    ],
  });

describe('@kovojs/drizzle kovo({ key }) column selector (SPEC §10.1)', () => {
  it('derives the same instanceKey from a (t) => t.col selector as from a string key', () => {
    const stringForm = factsForCartKey('"cartId"');
    const selectorForm = factsForCartKey('(t) => t.cartId');

    // The string form pins the expected instance key derived from the annotation.
    expect(stringForm[0]?.instanceKey).toEqual({ domain: 'cart', key: 'arg:cartId' });
    // The selector form must extract identically (full query-fact parity).
    expect(selectorForm).toEqual(stringForm);
  });

  it('accepts block-body and bracket-access selectors', () => {
    const stringForm = factsForCartKey('"cartId"');
    expect(factsForCartKey('(t) => { return t.cartId; }')).toEqual(stringForm);
    expect(factsForCartKey("(t) => t['cartId']")).toEqual(stringForm);
  });
});
