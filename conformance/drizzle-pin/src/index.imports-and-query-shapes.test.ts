import { describe, expect, it } from 'vitest';

import { eq, gt, inArray, sql } from 'drizzle-orm';
import {
  alias,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import * as pg from 'drizzle-orm/pg-core';

import {
  createTouchGraphEntry,
  diagnosticsForQueryFacts,
  diagnosticsForTouchGraph,
  extractQueryFactsFromProject,
  extractTouchGraphFromProject,
  jiso,
  serializeDomainRegistry,
  serializeTouchGraph,
} from '../../../packages/drizzle/src/static.js';

import { annotatedTable, drizzleSymbol } from './test-helpers.js';

describe('Drizzle pinned subset conformance', () => {
  it('imports the pinned real Drizzle Postgres subset used by extraction examples', () => {
    const products = pgTable('products', {
      archived: boolean('archived').notNull().default(false),
      createdAt: timestamp('created_at').notNull(),
      id: text('id').primaryKey(),
      metadata: jsonb('metadata'),
      stock: integer('stock').notNull(),
    });
    const cartItems = pgTable('cart_items', {
      cartId: text('cart_id').notNull(),
      productId: text('product_id').notNull(),
      qty: integer('qty').notNull(),
    });
    const productAlias = alias(products, 'p');

    expect(products.id).toBeDefined();
    expect(products.metadata).toBeDefined();
    expect(cartItems.productId).toBeDefined();
    expect(productAlias.id).toBeDefined();
    expect(eq(products.id, 'p1')).toBeDefined();
    expect(gt(products.stock, 0)).toBeDefined();
    expect(inArray(cartItems.cartId, ['c1', 'c2'])).toBeDefined();
  });

  it('does not promote deferred real SQLite/MySQL database receivers to v1 project proof', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/deferred-engine.domain.ts',
        source: [
          "import type { MySqlDatabase } from 'drizzle-orm/mysql-core';",
          "import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'export async function writeSqlite(db: BaseSQLiteDatabase<any, any, any, any>, productId: string) {',
          '  await db.update(products).set({ id: productId });',
          '}',
          '',
          "export const productQuery = query('product/deferred-mysql', {",
          '  load(_input, db: MySqlDatabase<any, any, any, any>) {',
          '    return db.select({ id: products.id }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({});
    expect(extractQueryFactsFromProject({ files })).toEqual([]);
  });

  it('pins project query shapes for real Drizzle column builders and static element access', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            export const products = pgTable('products', {
              archived: boolean('archived').notNull(),
              createdAt: timestamp('created_at'),
              id: text('id').primaryKey(),
              metadata: jsonb('metadata'),
              name: text('name'),
              stock: integer('stock').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product', {
              load(_input, db: PgDatabase) {
                return db.select({
                  archived: products['archived'],
                  createdAt: products.createdAt,
                  discount: products.name,
                  id: products.id,
                  metadata: products.metadata,
                  stock: products['stock'],
                }).from(products);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product',
        reads: ['product'],
        shape: {
          archived: 'boolean',
          createdAt: {
            kind: 'nullable',
            shape: 'string',
          },
          discount: {
            kind: 'nullable',
            shape: 'string',
          },
          id: 'string',
          metadata: {
            kind: 'nullable',
            shape: 'object',
          },
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:11',
      },
    ]);
  });

  it('pins aliased real Drizzle Postgres table and column factories in project extraction', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { pgTable as table, text as pgText, integer as pgInteger, type PgDatabase } from 'drizzle-orm/pg-core';

            export const products = table('products', {
              id: pgText('id').primaryKey(),
              stock: pgInteger('stock').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/aliased-factories', {
              load(_input, db: PgDatabase<any, any, any>) {
                return db.select({
                  id: products.id,
                  stock: products.stock,
                }).from(products);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/aliased-factories',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:9',
      },
    ]);
  });

  it('pins real Drizzle Postgres factory re-export barrels in project extraction', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/pg-barrel.ts',
          source: `
            export { pgTable as table, text as pgText, integer as pgInteger } from 'drizzle-orm/pg-core';
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import { table, pgText, pgInteger } from './pg-barrel';

            export const products = table('products', {
              id: pgText('id').primaryKey(),
              stock: pgInteger('stock').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/barrel-factories', {
              load(_input, db: PgDatabase<any, any, any>) {
                return db.select({
                  id: products.id,
                  stock: products.stock,
                }).from(products);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/barrel-factories',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:10',
      },
    ]);
  });

  it('pins project extraction for real Postgres namespace table factories', () => {
    const products = pg.pgTable('products', {
      id: pg.text('id').primaryKey(),
      metadata: pg.jsonb('metadata'),
      stock: pg.integer('stock').notNull(),
    });

    expect(products.id).toBeDefined();
    expect(products.metadata).toBeDefined();
    expect(products.stock).toBeDefined();

    const source = [
      "import * as pg from 'drizzle-orm/pg-core';",
      "import type { PgDatabase } from 'drizzle-orm/pg-core';",
      '',
      "export const products = pg.pgTable('products', {",
      "  id: pg.text('id').primaryKey(),",
      "  metadata: pg.jsonb('metadata'),",
      "  stock: pg.integer('stock').notNull(),",
      "}, jiso({ domain: 'product', key: 'id' }));",
      '',
      'export async function restock(db: PgDatabase<any, any, any>, productId: string) {',
      '  await db.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
      '}',
      '',
      "export const productQuery = query('product/namespace-factory', {",
      '  load(input, db: PgDatabase<any, any, any>) {',
      '    return db.select({ id: products.id, metadata: products.metadata, stock: products.stock }).from(products).where(eq(products.id, input.id));',
      '  },',
      '});',
    ].join('\n');

    expect(
      extractTouchGraphFromProject({
        files: [{ fileName: 'conformance/drizzle-pin/src/product.namespace.ts', source }],
      }),
    ).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.namespace.ts:11',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(
      extractQueryFactsFromProject({
        files: [{ fileName: 'conformance/drizzle-pin/src/product.namespace.ts', source }],
      }),
    ).toEqual([
      {
        instanceKey: {
          domain: 'product',
          key: 'arg:id',
        },
        query: 'product/namespace-factory',
        reads: ['product'],
        shape: {
          id: 'string',
          metadata: {
            kind: 'nullable',
            shape: 'object',
          },
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.namespace.ts:14',
      },
    ]);
  });

  it('pins wrapped project query projection expressions under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              stock: integer('stock').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/wrapped-projection', {
              load(_input, db: PgDatabase<any, any, any>) {
                return db.select({
                  id: (products.id as unknown) as typeof products.id,
                  stock: products['stock']!,
                  count: (sql<number>\`count(*)\` satisfies unknown),
                }).from(products);
              },
              output: {},
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/wrapped-projection',
        reads: ['product'],
        shape: {
          count: 'number',
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:10',
      },
    ]);
  });

  it('pins project query loader getters returning static callbacks under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              name: text('name').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));

            function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {
              return db.select({
                id: products.id,
                name: products.name,
              }).from(products);
            }

            const options = {
              get load() {
                return loadProducts;
              },
            };

            export const productQuery = query('product/getter-loader', options);
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/getter-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:22',
      },
    ]);
  });

  it('pins nullable project query shapes for real Drizzle left joins', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            export const products = pgTable('products', {
              id: text('id'),
              name: text('name').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));
            export const reviews = pgTable('reviews', {
              productId: text('product_id'),
              rating: integer('rating'),
            }, jiso({ domain: 'review', key: 'productId' }));

            export const productQuery = query('product', {
              load(_input, db: PgDatabase) {
                return db.select({
                  name: products.name,
                  review: { rating: reviews.rating },
                }).from(products).leftJoin(reviews, eq(reviews.productId, products.id));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product',
        reads: ['product', 'review'],
        shape: {
          name: 'string',
          review: {
            kind: 'nullable',
            shape: {
              rating: {
                kind: 'nullable',
                shape: 'number',
              },
            },
          },
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:11',
      },
    ]);
  });

  it('pins nullable project query shapes for real Drizzle right and full joins', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            export const discounts = pgTable('discounts', {
              percent: integer('percent').notNull(),
              productId: text('product_id'),
            }, jiso({ domain: 'discount', key: 'productId' }));
            export const products = pgTable('products', {
              id: text('id'),
              name: text('name').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));
            export const reviews = pgTable('reviews', {
              productId: text('product_id'),
              rating: integer('rating').notNull(),
            }, jiso({ domain: 'review', key: 'productId' }));

            export const discountQuery = query('discount/full', {
              load(_input, db: PgDatabase) {
                return db.select({
                  productName: products.name,
                  discountPercent: discounts.percent,
                }).from(products).fullJoin(discounts, eq(discounts.productId, products.id));
              },
            });

            export const reviewQuery = query('review/right', {
              load(_input, db: PgDatabase) {
                return db.select({
                  product: { name: products.name },
                  review: { rating: reviews.rating },
                }).from(products).rightJoin(reviews, eq(reviews.productId, products.id));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'discount/full',
        reads: ['discount', 'product'],
        shape: {
          discountPercent: {
            kind: 'nullable',
            shape: 'number',
          },
          productName: {
            kind: 'nullable',
            shape: 'string',
          },
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:15',
      },
      {
        query: 'review/right',
        reads: ['product', 'review'],
        shape: {
          product: {
            kind: 'nullable',
            shape: {
              name: {
                kind: 'nullable',
                shape: 'string',
              },
            },
          },
          review: {
            rating: 'number',
          },
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:24',
      },
    ]);
  });
});
