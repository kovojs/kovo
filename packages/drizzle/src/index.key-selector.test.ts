import { describe, expect, it } from 'vitest';

import {
  createProjectExtraction,
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
  projectTablesBySyntheticName,
} from '@kovojs/drizzle/internal/static';
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

  it('extracts secret column annotations from strings and selectors', () => {
    const extraction = createProjectExtraction(
      withPgDatabaseTypes({
        files: [
          {
            fileName: 'user.schema.ts',
            source: `
              import { kovo } from "@kovojs/drizzle";
              import { pgTable, text } from "drizzle-orm/pg-core";

              export const users = pgTable("users", {
                apiToken: text("api_token").notNull(),
                id: text("id").primaryKey(),
                passwordHash: text("password_hash").notNull(),
              }, kovo({ domain: "user", key: "id", secret: ["passwordHash", (t) => t.apiToken] }));
              export const vault = pgTable("vault", {
                id: text("id").primaryKey(),
                payload: text("payload").notNull(),
              }, kovo({ domain: "vault", key: "id", secret: true }));
            `,
          },
        ],
      }),
    );
    const tables = [...projectTablesBySyntheticName(extraction).values()];
    const userTable = tables.find((table) => table.annotation.name === 'users');
    const vaultTable = tables.find((table) => table.annotation.name === 'vault');

    expect(userTable?.annotation).toMatchObject({
      domain: 'user',
      secret: ['passwordHash', 'apiToken'],
    });
    expect(vaultTable?.annotation).toMatchObject({
      domain: 'vault',
      secret: true,
    });
  });

  it('extracts atomic and version column annotations from strings and selectors', () => {
    const extraction = createProjectExtraction(
      withPgDatabaseTypes({
        files: [
          {
            fileName: 'inventory.schema.ts',
            source: `
              import { kovo } from "@kovojs/drizzle";
              import { integer, pgTable, text } from "drizzle-orm/pg-core";

              export const products = pgTable("products", {
                id: text("id").primaryKey(),
                reserved: integer("reserved").notNull(),
                stock: integer("stock").notNull(),
                version: integer("version").notNull(),
              }, kovo({ domain: "product", key: "id", atomic: ["stock", (t) => t.reserved], version: (t) => t.version }));
            `,
          },
        ],
      }),
    );
    const productTable = [...projectTablesBySyntheticName(extraction).values()].find(
      (table) => table.annotation.name === 'products',
    );

    expect(productTable?.annotation).toMatchObject({
      atomic: ['stock', 'reserved'],
      domain: 'product',
      version: 'version',
    });
  });
});
