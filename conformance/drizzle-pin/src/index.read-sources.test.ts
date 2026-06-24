import { describe, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';
import { customType, text } from 'drizzle-orm/pg-core';

import {
  diagnosticsForQueryFacts,
  diagnosticsForTouchGraph,
  extractTouchGraphFromProject,
} from '../../../packages/drizzle/src/static.js';

import { extractQueryFactsFromProject } from './test-helpers.js';

describe('Drizzle pinned subset conformance', () => {
  it('pins real Drizzle project read sources from write call AST', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.domain.ts',
          source: [
            "import { eq, gt, sql } from 'drizzle-orm';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {}, kovo({ domain: 'product', key: 'id' }));",
            "export const prices = pgTable('prices', {}, kovo({ domain: 'price', key: 'productId' }));",
            "export const snapshots = pgTable('product_snapshots', {}, kovo({ domain: 'snapshot', key: 'productId' }));",
            '',
            'export async function syncSnapshots(db: PgDatabase<any, any, any>, productId: string) {',
            "  await db.insert(snapshots).select(db.select().from((products as any)).where(gt(sql.raw('.from(prices)'), 0)));",
            '  await db.update(products).set({ price: prices.productId }).from(prices!).where(eq(products.id, productId));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncSnapshots: {
        reads: [
          {
            domain: 'price',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:10',
            source: 'update-from',
            via: 'prices',
          },
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
            source: 'insert-select',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:10',
            via: 'products',
          },
          {
            domain: 'snapshot',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
            via: 'product_snapshots',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins real Drizzle alias tables as project touch and query facts', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import { eq } from 'drizzle-orm';",
          "import { alias, integer, pgTable, text, type PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          "const productAlias = alias(products, 'p');",
          '',
          'export async function syncProduct(db: PgDatabase<any, any, any>, productId: string) {',
          '  await db.update(productAlias).set({ stock: 1 }).where(eq(productAlias.id, productId));',
          '  await db.select({ stock: productAlias.stock }).from(productAlias);',
          '}',
          '',
          "export const productQuery = query('product/alias', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
          '  load(input, db: PgDatabase<any, any, any>) {',
          '    return db.select({ stock: productAlias.stock }).from(productAlias).where(eq(productAlias.id, input.id));',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:11',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        instanceKey: {
          domain: 'product',
          key: 'arg:id',
        },
        query: 'product/alias',
        reads: ['product'],
        shape: {
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:15',
      },
    ]);
  });

  it('pins project relational query API calls as static read surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import { boolean, pgTable, text } from 'drizzle-orm/pg-core';

            export const users = pgTable('users', {
              active: boolean('active').notNull(),
              id: text('id').primaryKey(),
            }, kovo({ domain: 'user', key: 'id' }));

            export async function loadActiveUsers(db: PgDatabase<any, any, any>) {
              return db.query.users.findMany({ where: eq(users.active, true) });
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      loadActiveUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'conformance/drizzle-pin/src/users.domain.ts:11',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
  });

  it('pins unresolved project relational query table names as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export async function loadActiveUsers(db: PgDatabase<any, any, any>, tableName: string) {
              return db.query[tableName].findMany();
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      loadActiveUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:5',
          },
        ],
      },
    });
  });

  it('pins project query facts for the real Drizzle Postgres subset', () => {
    expect(sql<number>`count(*)`).toBeDefined();

    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.schema.ts',
          source: `
            export const items = pgTable('cart_items', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/order.schema.ts',
          source: `
            export const items = pgTable('order_items', {}, kovo({ domain: 'order', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';
            import { items } from './cart.schema';

            export const cartQuery = query('cart', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(input, db: PgDatabase) {
                return db.select({ id: items.id }).from(items).where(eq(items.id, input.id));
              },
            });

            export const cartCountQuery = query('cart/count', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                return db.select({ count: sql<number>\`count(*)\` }).from(items);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        instanceKey: {
          domain: 'cart',
          key: 'arg:id',
        },
        query: 'cart',
        reads: ['cart'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/cart.queries.ts:5',
      },
      {
        diagnostics: [
          {
            code: 'KV410',
            message:
              'Opaque query projection requires a declared output schema. cart/count.count uses sql/raw projection without output.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/cart.queries.ts:11',
          },
        ],
        query: 'cart/count',
        reads: ['cart'],
        shape: {
          count: 'number',
        },
        site: 'conformance/drizzle-pin/src/cart.queries.ts:11',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV410',
        message:
          'Opaque query projection requires a declared output schema. cart/count.count uses sql/raw projection without output.',
        severity: 'error',
        site: 'conformance/drizzle-pin/src/cart.queries.ts:11',
      },
    ]);
  });

  it('pins real Postgres with() query-builder chains without fake unclassified diagnostics', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { pgTable, text, type PgDatabase } from 'drizzle-orm/pg-core';

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/with-read', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                const active = db.$with('active_products').as(db.select({ id: products.id }).from(products));
                return db.with(active).select({ id: products.id }).from(products);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db.$with().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:8',
          },
        ],
        query: 'product/with-read',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:8',
      },
    ]);
  });

  it('pins namespace-imported project query projections against real Drizzle tables', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.schema.ts',
          source: `
            export const products = pgTable('cart_products', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/order.schema.ts',
          source: `
            export const products = pgTable('order_products', {
              id: integer('id').primaryKey(),
            }, kovo({ domain: 'order', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.queries.ts',
          source: `
            import * as cartSchema from './cart.schema';

            export const cartProductQuery = query('cart/product', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(input, db: PgDatabase) {
                return db.select({
                  id: cartSchema.products.id,
                }).from(cartSchema.products).where(eq(cartSchema.products.id, input.id));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        instanceKey: {
          domain: 'cart',
          key: 'arg:id',
        },
        query: 'cart/product',
        reads: ['cart'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/cart.queries.ts:4',
      },
    ]);
  });

  it('pins namespace static element-access project query tables against real Drizzle tables', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.schema.ts',
          source: `
            export const products = pgTable('cart_products', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.queries.ts',
          source: `
            import * as cartSchema from './cart.schema';

            export const cartProductQuery = query('cart/product', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(input, db: PgDatabase) {
                return db.select({
                  id: cartSchema['products'].id,
                }).from(cartSchema['products']).where(eq(cartSchema['products'].id, input.id));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        instanceKey: {
          domain: 'cart',
          key: 'arg:id',
        },
        query: 'cart/product',
        reads: ['cart'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/cart.queries.ts:4',
      },
    ]);
  });

  it('pins namespace project queries through re-export barrels with real Drizzle tables', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.schema.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';

            export const products = pgTable('cart_products', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.tables.ts',
          source: `
            export { products as cartProducts } from './cart.schema';
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: `
            export * from './cart.tables';
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.queries.ts',
          source: `
            import { eq } from 'drizzle-orm';
            import * as schema from './schema';

            export const cartProductQuery = query('cart/product', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(input, db: PgDatabase) {
                return db.select({
                  id: schema['cartProducts'].id,
                }).from(schema.cartProducts).where(eq(schema.cartProducts.id, input.id));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        instanceKey: {
          domain: 'cart',
          key: 'arg:id',
        },
        query: 'cart/product',
        reads: ['cart'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/cart.queries.ts:5',
      },
    ]);
  });

  it('pins project query facts for real Drizzle distinct selects', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.schema.ts',
          source: `
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              name: text('name').notNull(),
            }, kovo({ domain: 'product', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { products } from './product.schema';

            export const distinctProducts = query('products/distinct', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                return db.selectDistinct({ name: products.name }).from(products);
              },
            });

            export const firstProductNames = query('products/distinct-on', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                return db.selectDistinctOn([products.id], { id: products.id, name: products.name }).from(products);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'products/distinct',
        reads: ['product'],
        shape: {
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:4',
      },
      {
        query: 'products/distinct-on',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:10',
      },
    ]);
  });

  it('pins AST-backed column nullability against comment and string contents', () => {
    expect(text('note', { enum: ['.notNull('] })).toBeDefined();

    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.schema.ts',
          source: `
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              note: text('note', { enum: ['.notNull('] }),
              stock: integer('stock' /* .notNull( */),
            }, kovo({ domain: 'product', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { products } from './product.schema';

            export const productQuery = query('product', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                return db.select({
                  note: products.note,
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
        query: 'product',
        reads: ['product'],
        shape: {
          note: {
            kind: 'nullable',
            shape: 'string',
          },
          stock: {
            kind: 'nullable',
            shape: 'number',
          },
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:4',
      },
    ]);
  });

  it('pins custom column builders as KV406 instead of fabricated string shapes', () => {
    const point = customType<{ data: { x: number; y: number } }>({
      dataType() {
        return 'point';
      },
    });
    expect(point('location')).toBeDefined();

    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            const point = customType<{ data: { x: number; y: number } }>({
              dataType() {
                return 'point';
              },
            });
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              location: point('location'),
            }, kovo({ domain: 'product', key: 'id' }));

            export const productQuery = query('product', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                return db.select({
                  id: products.id,
                  location: products.location,
                }).from(products);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query projection product.location could not be resolved to a Drizzle column or typed sql<T> expression.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:12',
          },
        ],
        query: 'product',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:12',
      },
    ]);
  });

  it('pins AST query-read extraction against comment and string contents', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            export const auditLog = pgTable('audit_log', {}, kovo({ exempt: true }));
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              name: text('name').notNull(),
            }, kovo({ domain: 'product', key: 'id' }));

            export const productQuery = query('product', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                const fixture = ".from(auditLog) db.query.auditLog.findMany(";
                // return db.query.auditLog.findMany({ where: eq(auditLog.productId, products.id) });
                return db.select({ name: products.name }).from(products);
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
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:8',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins computed real Drizzle read sources as KV406 instead of inferred reads', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.schema.ts',
          source: `
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'product', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { products } from './product.schema';

            function tableFor<T>(table: T): T { return table; }

            export const productQuery = query('product', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                return db.select({ id: products.id }).from(tableFor(products));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query read source for db.from() could not be resolved to a Drizzle table.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:6',
          },
        ],
        query: 'product',
        reads: [],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:6',
      },
    ]);
  });

  it('pins resolved write read sources when real Drizzle write targets are opaque', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/catalog.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', { id: text('id') }, kovo({ domain: 'product', key: 'id' }));",
            "export const vendors = pgTable('vendors', { id: text('id') }, kovo({ domain: 'vendor', key: 'id' }));",
            '',
            'function tableFor<T>(table: T): T { return table; }',
            '',
            'export async function syncCatalog(db: PgDatabase<any, any, any>) {',
            '  await db.insert(tableFor(products)).select(db.select().from(products));',
            '  await db.update(tableFor(products)).set({ refreshed: true }).from(vendors);',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncCatalog: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:10',
            source: 'insert-select',
            via: 'products',
          },
          {
            domain: 'vendor',
            keys: null,
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:11',
            source: 'update-from',
            via: 'vendors',
          },
        ],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:10',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:11',
          },
        ],
      },
    });
  });

  it('pins opaque real Drizzle write read sources as explicit KV406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/catalog.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', { id: text('id') }, kovo({ domain: 'product', key: 'id' }));",
            "export const snapshots = pgTable('product_snapshots', { productId: text('product_id') }, kovo({ domain: 'snapshot', key: 'productId' }));",
            '',
            'function tableFor<T>(name: string): T { return name as T; }',
            '',
            'export async function syncCatalog(db: PgDatabase<any, any, any>) {',
            "  await db.insert(snapshots).select(db.select().from(tableFor('products')));",
            "  await db.update(products).set({ refreshed: true }).from(tableFor('vendors'));",
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncCatalog: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:11',
            via: 'products',
          },
          {
            domain: 'snapshot',
            keys: null,
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:10',
            via: 'product_snapshots',
          },
        ],
        unresolved: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Insert-select read source could not be resolved to a Drizzle table.',
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:10',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Update-from read source could not be resolved to a Drizzle table.',
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:11',
          },
        ],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'KV406',
        message:
          'Statically un-analyzable write site; manual touches required. Insert-select read source could not be resolved to a Drizzle table.',
        severity: 'error',
        site: 'conformance/drizzle-pin/src/catalog.domain.ts:10',
      },
      {
        code: 'KV406',
        message:
          'Statically un-analyzable write site; manual touches required. Update-from read source could not be resolved to a Drizzle table.',
        severity: 'error',
        site: 'conformance/drizzle-pin/src/catalog.domain.ts:11',
      },
    ]);
  });

  it('pins real Drizzle raw query execute as an explicit KV406 read surface', () => {
    expect(sql`select * from users`).toBeDefined();

    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';

            export const users = pgTable('users', {}, kovo({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/raw', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                return db.execute(sql\`select * from users\`);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db.execute().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:6',
          },
        ],
        query: 'users/raw',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/user.queries.ts:6',
      },
    ]);
  });

  it('does not promote PgDatabase-like query receiver names under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            interface PgDatabaseLike {
              execute(query: unknown): Promise<void>;
            }

            declare function runReport(context: unknown): Promise<unknown[]>;

            export const usersQuery = query('users/fake-db-like', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabaseLike) {
                db.execute(sql\`select * from users\`);
                return runReport({ db });
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins computed real Drizzle query receiver methods as explicit KV406 surfaces', () => {
    expect(sql`select * from users`).toBeDefined();

    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';

            type FakeDb = Record<string, (query: unknown) => Promise<void>>;

            export const usersQuery = query('users/computed-raw', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase, fake: FakeDb) {
                const method = 'execute';
                db[method](sql\`select * from users\`);
                fake[method](sql\`select * from users\`);
                return [];
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db[method]().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:6',
          },
        ],
        query: 'users/computed-raw',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/user.queries.ts:6',
      },
    ]);
  });

  it('pins bound and assigned real Drizzle query receiver methods as explicit KV406 surfaces', () => {
    expect(sql`select * from users`).toBeDefined();

    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              execute(query: unknown): Promise<void>;
            }

            export const usersQuery = query('users/bound-raw', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase<any, any, any>, fake: FakeDb, method: string) {
                const execute = db.execute.bind(db);
                const computed = db[method].bind(db);
                const fakeExecute = fake.execute.bind(fake);
                let assignedExecute;
                assignedExecute = db.execute;
                let assignedComputed;
                assignedComputed = db[method];
                let objectExecute;
                ({ execute: objectExecute } = db);
                const carrier = { db, fake };
                const carrierExecute = carrier.db.execute;
                let carrierComputed;
                carrierComputed = carrier.db[method];
                const carrierFakeExecute = carrier.fake.execute;
                execute(sql\`select * from users\`);
                computed(sql\`select * from users\`);
                assignedExecute(sql\`select * from users\`);
                assignedComputed(sql\`select * from users\`);
                objectExecute(sql\`select * from users\`);
                carrierExecute(sql\`select * from users\`);
                carrierComputed(sql\`select * from users\`);
                carrierFakeExecute(sql\`select * from users\`);
                fakeExecute(sql\`select * from users\`);
                return [];
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method <computed>().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method <computed>().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method <computed>().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
        ],
        query: 'users/bound-raw',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/user.queries.ts:9',
      },
    ]);
  });

  it('pins array-destructured real Drizzle query receiver methods as explicit KV406 surfaces', () => {
    expect(sql`select * from users`).toBeDefined();

    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              execute(query: unknown): Promise<void>;
            }

            export const usersQuery = query('users/array-detached-raw', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase<any, any, any>, fake: FakeDb, method: string) {
                const [execute, computed] = [db.execute, db[method]];
                const [fakeExecute] = [fake.execute];
                let assignedExecute;
                [assignedExecute] = [db.execute];
                execute(sql\`select * from users\`);
                computed(sql\`select * from users\`);
                assignedExecute(sql\`select * from users\`);
                fakeExecute(sql\`select * from users\`);
                return [];
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method <computed>().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
        ],
        query: 'users/array-detached-raw',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/user.queries.ts:9',
      },
    ]);
  });

  it('pins direct real Drizzle query carrier members as exact reads with KV406 writes', () => {
    expect(sql`select * from users`).toBeDefined();

    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const users = pgTable('users', {",
            "  id: text('id').primaryKey(),",
            "}, kovo({ domain: 'user', key: 'id' }));",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            "export const usersQuery = query('users/carrier-direct', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '    const carrier = { db, fake };',
            '    await carrier.db.execute(sql`select * from users`);',
            '    await carrier.db.update(users).set({ id: "u1" });',
            '    await carrier.db.query.users.findMany();',
            '    await carrier.fake.execute(sql`select * from users`);',
            '    await carrier.fake.update(users).set({ id: "fake" });',
            '    await carrier.fake.query.users.findMany();',
            '    return [];',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:14',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call carrier.db.execute().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:14',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call carrier.db.update().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:14',
          },
        ],
        query: 'users/carrier-direct',
        reads: ['user'],
        shape: {},
        site: 'conformance/drizzle-pin/src/user.queries.ts:14',
      },
    ]);
  });

  it('pins non-load query callbacks as non-loader surfaces', () => {
    expect(sql`select * from audit_log`).toBeDefined();

    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const auditLog = pgTable('audit_log', {
              id: text('id').primaryKey(),
            }, kovo({ exempt: true }));
            export const users = pgTable('users', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/non-loader-callback', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              guard(_input, db: PgDatabase<any, any, any>) {
                db.execute(sql\`select * from audit_log\`);
                return db.select({ id: auditLog.id }).from(auditLog);
              },
              load(_input, db: PgDatabase<any, any, any>) {
                return db.select({ id: users.id }).from(users);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'users/non-loader-callback',
        reads: ['user'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/user.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins real Drizzle query-loader transaction aliases as explicit KV406 surfaces', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const users = pgTable('users', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/transaction-write', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              async load(_input, db: PgDatabase<any, any, any>) {
                await db.transaction(async (tx) => {
                  await tx.update(users).set({ id: 'u1' });
                });
                return [];
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db.transaction().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:8',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call tx.update().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:8',
          },
        ],
        query: 'users/transaction-write',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/user.queries.ts:8',
      },
    ]);
  });

  it('pins uncalled nested query-loader helpers as non-query surfaces under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const auditLog = pgTable('audit_log', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'audit', key: 'id' }));
            export const users = pgTable('users', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/nested-helper', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase<any, any, any>) {
                function readAudit(reader: PgDatabase<any, any, any>) {
                  return reader.select({ id: auditLog.id }).from(auditLog);
                }

                function readUsers(reader: PgDatabase<any, any, any>) {
                  return reader.select({ id: users.id }).from(users);
                }

                return readUsers(db);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'users/nested-helper',
        reads: ['user'],
        shape: {},
        site: 'conformance/drizzle-pin/src/user.queries.ts:11',
      },
    ]);
  });

  it('pins static element-access relational reads as explicit KV406 facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            export const users = pgTable('users', {}, kovo({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                return db.query['users']['findMany']({ where: eq(users.active, true) });
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:4',
          },
        ],
        query: 'users',
        reads: ['user'],
        shape: {},
        site: 'conformance/drizzle-pin/src/user.queries.ts:4',
      },
    ]);
  });

  it('pins template-literal element-access relational reads as explicit KV406 facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            export const users = pgTable('users', {}, kovo({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/template-access', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                return db.query[\`users\`][\`findFirst\`]({ where: eq(users.active, true) });
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:4',
          },
        ],
        query: 'users/template-access',
        reads: ['user'],
        shape: {},
        site: 'conformance/drizzle-pin/src/user.queries.ts:4',
      },
    ]);
  });

  it('pins project relational query tables from declarations instead of loader-local shadows', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import { boolean, pgTable, text } from 'drizzle-orm/pg-core';

            const users = pgTable('users', {
              active: boolean('active').notNull(),
              id: text('id').primaryKey(),
            }, kovo({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/shadowed-relational', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase<any, any, any>, fake: { users: unknown }) {
                {
                  const { users } = fake;
                  void users;
                }
                return db.query.users.findMany({ where: eq(users.active, true) });
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:10',
          },
        ],
        query: 'users/shadowed-relational',
        reads: ['user'],
        shape: {},
        site: 'conformance/drizzle-pin/src/user.queries.ts:10',
      },
    ]);
  });

  it('pins unresolved project relational read sources as explicit KV406 facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            export const users = pgTable('users', {}, kovo({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db: PgDatabase) {
                return db.query.archivedUsers.findMany({ where: eq(users.active, true) });
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:4',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query relational read source could not be resolved to a Drizzle table.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/user.queries.ts:4',
          },
        ],
        query: 'users',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/user.queries.ts:4',
      },
    ]);
  });

  it('does not pin relational reads from non-receiver objects', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            export const auditLog = pgTable('audit_log', {}, kovo({ exempt: true }));
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              name: text('name').notNull(),
            }, kovo({ domain: 'product', key: 'id' }));

            export const productQuery = query('product', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, reader: PgDatabase) {
                const fixture = { query: { auditLog: { findMany() { return []; } } } };
                fixture.query.auditLog.findMany();
                return reader.select({ name: products.name }).from(products);
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
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:8',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });
});
