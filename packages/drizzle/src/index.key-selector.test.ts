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

// SPEC §10.1: every column-bearing annotation field is a direct identity from the callback's
// concrete column record. Dot and element access must therefore derive the same `instanceKey`.
// Strings and nested selector callbacks are deliberately outside the authored grammar.
const factsForCartKey = (cartKey: string) =>
  extractQueryFactsFromProject({
    files: [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { innerJoin(table: unknown, on: unknown): { where(value: unknown): Promise<unknown[]> } } };',
      ]),
      {
        fileName: 'cart.queries.ts',
        source: [
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          `export const cartItems = pgTable("cart_items", { cartId: text("cart_id").notNull(), productId: text("product_id").notNull(), qty: integer("qty").notNull() }, kovo((columns) => ({ domain: "cart", key: ${cartKey} })));`,
          'export const products = pgTable("products", { id: text("id").primaryKey() }, kovo((columns) => ({ domain: "product", key: columns.id })));',
          '',
          'export const cartQuery = query("cart", {',
          '  output: s.object({ count: s.number() }),',
          '  async load(input, db: PgAsyncDatabase<any, any>) {',
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

describe('@kovojs/drizzle kovo((columns) => ({ key })) column identity (SPEC §10.1)', () => {
  it('derives the same instanceKey from dot and element access identities', () => {
    const dotAccess = factsForCartKey('columns.cartId');
    const elementAccess = factsForCartKey('columns["cartId"]');

    expect(dotAccess[0]?.instanceKey).toEqual({ domain: 'cart', key: 'arg:cartId' });
    expect(elementAccess).toEqual(dotAccess);
  });

  it('accepts a parenthesized direct column identity', () => {
    expect(factsForCartKey('(columns.cartId)')).toEqual(factsForCartKey('columns.cartId'));
  });

  it.each(['"cartId"', '(table) => table.cartId', "(table) => table['cartId']"])(
    'does not derive key authority from the retired %s form',
    (legacyKey) => {
      expect(factsForCartKey(legacyKey)[0]?.instanceKey).toBeUndefined();
    },
  );

  it('extracts secret column annotations from concrete identities', () => {
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
              }, kovo((columns) => ({ domain: "user", key: columns.id, secret: [columns.passwordHash, columns.apiToken] })));
              export const vault = pgTable("vault", {
                id: text("id").primaryKey(),
                payload: text("payload").notNull(),
              }, kovo((columns) => ({ domain: "vault", key: columns.id, secret: true })));
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
});
