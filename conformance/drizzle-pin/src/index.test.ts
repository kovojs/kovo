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

import {
  createTouchGraphEntry,
  diagnosticsForQueryFacts,
  diagnosticsForTouchGraph,
  extractQueryFactsFromProject,
  extractQueryFactsFromSource,
  extractTouchGraphFromProject,
  extractTouchGraphFromSource,
  jiso,
  serializeDomainRegistry,
  serializeTouchGraph,
} from '../../../packages/drizzle/src/static.js';

function annotatedTable(name: string, annotation: ReturnType<typeof jiso>) {
  return {
    domain: annotation.domain,
    ...(annotation.key ? { key: annotation.key } : {}),
    name,
  };
}

function drizzleSymbol(name: string): symbol {
  return Symbol.for(`drizzle:${name}`);
}

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

  it('pins query-loader helper db handoff as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            declare function runReport(db: PgDatabase<any, any, any>): Promise<unknown[]>;

            export const productQuery = query('product/helper', {
              async load(_input, db: PgDatabase<any, any, any>) {
                return runReport(db);
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:10',
          },
        ],
        query: 'product/helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:10',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toHaveLength(1);
  });

  it('pins member helper Drizzle receiver handoffs as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            declare const reports: {
              run(db: PgDatabase<any, any, any>): Promise<unknown[]>;
              warm(cache: unknown): Promise<void>;
            };

            export const productQuery = query('product/member-helper', {
              async load(_input, db: PgDatabase<any, any, any>) {
                await reports.warm(cache);
                return reports.run(db);
              },
            });
          `,
        },
      ],
    });
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'declare const audit: {',
            '  write(db: PgDatabase<any, any, any>): Promise<void>;',
            '  preview(db: FakeDb): Promise<void>;',
            '};',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  await audit.write(db);',
            '  await audit.preview(fake);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper reports.run().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:13',
          },
        ],
        query: 'product/member-helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:13',
      },
    ]);
    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:13',
          },
        ],
      },
    });
  });

  it('pins containerized Drizzle receiver helper handoffs as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
            }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            declare function runReport(context: unknown): Promise<unknown[]>;

            export const productQuery = query('product/container-helper', {
              async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {
                await runReport({ fake });
                return runReport({ db });
              },
            });
          `,
        },
      ],
    });
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'declare function audit(context: unknown): Promise<void>;',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  await audit({ fake });',
            '  await audit({ db });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:14',
          },
        ],
        query: 'product/container-helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:14',
      },
    ]);
    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:11',
          },
        ],
      },
    });
  });

  it('pins typed context helper handoffs as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface ProductContext { db: PgDatabase<any, any, any> }',
            'interface FakeContext { db: unknown }',
            'declare function runReport(context: unknown): Promise<unknown[]>;',
            '',
            "export const productQuery = query('product/typed-context-helper', {",
            '  async load(_input, context: ProductContext, fake: FakeContext) {',
            '    await runReport({ fake });',
            '    return runReport({ context });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface CartContext { db: PgDatabase<any, any, any> }',
            'interface FakeContext { db: unknown }',
            'declare function writeAudit(context: unknown): Promise<void>;',
            '',
            'export async function addItem(context: CartContext, fake: FakeContext) {',
            '  await writeAudit({ fake });',
            '  await writeAudit({ context });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
        ],
        query: 'product/typed-context-helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:7',
      },
    ]);
    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:9',
          },
        ],
      },
    });
  });

  it('pins nested typed Drizzle receiver carrier members under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              execute(query: unknown): Promise<void>;
              query: any;
              update(table: unknown): { set(value: unknown): Promise<void> };
            }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            declare function runReport(context: unknown): Promise<unknown[]>;

            export const productQuery = query('product/nested-carrier', {
              async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {
                const carrier = { db, fake };
                const nested = { inner: carrier };
                const overwritten = { ...nested, inner: { db: fake } };
                const execute = nested.inner.db.execute;
                await nested.inner.db.execute(sql\`select 1\`);
                await nested.inner.db.update(products).set({ id: 'p1' });
                await nested.inner.db.query.products.findMany();
                await execute(sql\`select 1\`);
                await runReport(nested.inner.db);
                await runReport(nested);
                await overwritten.inner.db.execute(sql\`select 1\`);
                await overwritten.inner.db.update(products).set({ id: 'fake' });
                await overwritten.inner.db.query.products.findMany();
                return [];
              },
            });
          `,
        },
      ],
    });
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import { sql } from 'drizzle-orm';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            "export const products = pgTable('products', {}, jiso({ domain: 'product', key: 'id' }));",
            '',
            'declare function audit(context: unknown): Promise<void>;',
            '',
            'export async function sync(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  const carrier = { db, fake };',
            '  const nested = { inner: carrier };',
            '  const overwritten = { ...nested, inner: { db: fake } };',
            '  const execute = nested.inner.db.execute;',
            '  await nested.inner.db.execute(sql`select 1`);',
            '  await nested.inner.db.update(products).set({});',
            '  await nested.inner.db.query.products.findMany();',
            '  await execute(sql`select 1`);',
            '  await audit(nested.inner.db);',
            '  await audit(nested);',
            '  await overwritten.inner.db.execute(sql`select 1`);',
            '  await overwritten.inner.db.update(products).set({});',
            '  await overwritten.inner.db.query.products.findMany();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call nested.inner.db.execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call nested.inner.db.update().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver nested.inner.db to helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver nested to helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
        ],
        query: 'product/nested-carrier',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:16',
      },
    ]);
    expect(graph).toEqual({
      sync: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:21',
            source: 'relational-query',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:20',
            via: 'products',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:23',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:24',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:22',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:19',
          },
        ],
      },
    });
  });

  it('pins local query-loader helper carrier aliases as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
            '}',
            '',
            'function runReport(context: unknown): Promise<unknown[]> {',
            '  return Promise.resolve([]);',
            '}',
            '',
            "export const productQuery = query('product/local-carrier-helper', {",
            '  async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '    const context = { db };',
            '    const fakeContext = { db: fake };',
            '    await runReport(fakeContext);',
            '    return runReport(context);',
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to local helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:11',
          },
        ],
        query: 'product/local-carrier-helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:11',
      },
    ]);
  });

  it('pins local query-loader helper assigned carrier aliases as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
            '}',
            '',
            'function runReport(context: unknown): Promise<unknown[]> {',
            '  return Promise.resolve([]);',
            '}',
            '',
            "export const productQuery = query('product/local-assigned-carrier-helper', {",
            '  async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '    let context;',
            '    context = { db };',
            '    let fakeContext;',
            '    fakeContext = { db: fake };',
            '    await runReport(fakeContext);',
            '    return runReport(context);',
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to local helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:11',
          },
        ],
        query: 'product/local-assigned-carrier-helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:11',
      },
    ]);
  });

  it('pins nested destructuring assignment receiver aliases under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface FakeContext { nested: { db: FakeDb } }',
          'interface DrizzleContext { nested: { db: PgDatabase<any, any, any> } }',
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'export async function syncProduct(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  let writer;',
          '  ({ nested: { db: writer } } = context);',
          '  let fakeWriter;',
          '  ({ nested: { db: fakeWriter } } = fake);',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 2 });',
          '}',
          '',
          "export const productQuery = query('product/nested-destructuring-assignment', {",
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    let reader;',
          '    ({ nested: { db: reader } } = context);',
          '    let fakeReader;',
          '    ({ nested: { db: fakeReader } } = fake);',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:20',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/nested-destructuring-assignment',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:24',
      },
    ]);
  });

  it('pins query-loader receiver symbols without shadowed lookalike facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              execute(query: unknown): Promise<void>;
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
            }

            export const auditLog = pgTable('audit_log', {
              id: text('id').primaryKey(),
            }, jiso({ exempt: true }));
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/shadowed-db', {
              async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {
                {
                  const db = fake;
                  await db.execute(sql\`select * from audit_log\`);
                  await db.select({ id: auditLog.id }).from(auditLog);
                }
                return db.select({ id: products.id }).from(products);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/shadowed-db',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:17',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins detached query-loader receiver methods as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              execute(query: unknown): Promise<void>;
              query: any;
            }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/detached-methods', {
              async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {
                const { execute, query: relations } = db;
                const fakeExecute = fake.execute;
                await execute('select 1');
                {
                  const execute = fake.execute;
                  await execute('select 1');
                }
                await fakeExecute('select 1');
                return relations.products.findMany();
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:13',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method query().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:13',
          },
        ],
        query: 'product/detached-methods',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:13',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toHaveLength(2);
  });

  it('pins source nested carrier destructuring as FW406 under real Drizzle imports', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
        source: [
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const users = pgTable('users', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'user', key: 'id' }));",
          '',
          'export async function syncUsers(db, fake) {',
          '  const carrier = { db, fake };',
          '  const nested = { inner: carrier };',
          '  const { inner: { db: declaredWriter } } = nested;',
          '  let assignedWriter;',
          '  ({ inner: { db: assignedWriter } } = nested);',
          '  const { inner: { fake: fakeWriter } } = nested;',
          "  await declaredWriter.execute('select 1');",
          '  await assignedWriter.update(users).set({});',
          '  await fakeWriter.update(users).set({});',
          '}',
        ].join('\n'),
      },
    ]);
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/product.queries.ts',
        source: [
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const users = pgTable('users', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'user', key: 'id' }));",
          '',
          "export const usersQuery = query('users/nested-source-destructuring', {",
          '  load(_input, db, fake) {',
          '    const carrier = { db, fake };',
          '    const nested = { inner: carrier };',
          '    const { inner: { db: declaredReader } } = nested;',
          '    let assignedReader;',
          '    ({ inner: { db: assignedReader } } = nested);',
          '    const { inner: { fake: fakeReader } } = nested;',
          '    fakeReader.select({ id: users.id }).from(users);',
          "    declaredReader.execute('select 1');",
          '    return assignedReader.select({ id: users.id }).from(users);',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:14',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:15',
          },
        ],
      },
    });
    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface execute() without project type proof.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
        ],
        query: 'users/nested-source-destructuring',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:7',
      },
    ]);
  });

  it('pins source array carrier destructuring as FW406 under real Drizzle imports', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
        source: [
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const users = pgTable('users', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'user', key: 'id' }));",
          '',
          'export async function syncUsers(db, fake) {',
          '  const carrier = [db, fake];',
          '  const nested = [[fake, db]];',
          '  const [writer, fakeWriter] = carrier;',
          '  let assignedWriter;',
          '  [assignedWriter] = carrier;',
          '  const [[ignoredFake, nestedWriter]] = nested;',
          "  await writer.execute('select 1');",
          '  await assignedWriter.update(users).set({});',
          "  await nestedWriter.execute('select 1');",
          '  await fakeWriter.update(users).set({});',
          "  await ignoredFake.execute('select 1');",
          '}',
        ].join('\n'),
      },
    ]);
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/product.queries.ts',
        source: [
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const users = pgTable('users', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'user', key: 'id' }));",
          '',
          "export const usersQuery = query('users/source-array-carrier', {",
          '  load(_input, db, fake) {',
          '    const carrier = [db, fake];',
          '    const nested = [[fake, db]];',
          '    const [reader, fakeReader] = carrier;',
          '    let assignedReader;',
          '    [assignedReader] = carrier;',
          '    const [[ignoredFake, nestedReader]] = nested;',
          '    reader.select({ id: users.id }).from(users);',
          "    assignedReader.execute('select 1');",
          '    return nestedReader.select({ id: users.id }).from(users);',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:14',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:15',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:16',
          },
        ],
      },
    });
    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface execute() without project type proof.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
        ],
        query: 'users/source-array-carrier',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:7',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toHaveLength(3);
  });

  it('pins spread-copied typed receiver carrier members under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '}',
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "}, jiso({ domain: 'product', key: 'id' }));",
            '',
            "export const productQuery = query('product/spread-carrier', {",
            '  async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '    const carrier = { db, fake };',
            '    const spread = { ...carrier };',
            '    const overwritten = { ...carrier, db: fake };',
            "    await spread.db.execute('select 1');",
            "    await overwritten.db.execute('select 1');",
            '    return spread.db.query.products.findMany();',
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:12',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call spread.db.execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:12',
          },
        ],
        query: 'product/spread-carrier',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toHaveLength(2);
  });

  it('does not fabricate project query facts from untyped query-loader receiver names', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/untyped-db', {
              load(_input, db) {
                db.update(products);
                return db.select({ id: products.id }).from(products);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([]);
  });

  it('pins source query-loader destructuring as FW406 without fabricated reads', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/product.queries.ts',
        source: [
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          "export const fakeQuery = query('product/destructured-fake', {",
          '  load(_input, { fake }) {',
          '    return fake.select({ id: products.id }).from(products);',
          '  },',
          '});',
          '',
          "export const productQuery = query('product/destructured-db', {",
          '  load(_input, { db: reader }) {',
          '    return reader.select({ id: products.id }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode destructured Drizzle receiver surface select() without project type proof.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:13',
          },
        ],
        query: 'product/destructured-db',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:13',
      },
    ]);
  });

  it('pins quoted source query-loader destructuring as FW406 without fabricated reads', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/product.queries.ts',
        source: [
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          "export const productQuery = query('product/quoted-destructured-db', {",
          '  load(_input, { "db": reader }) {',
          '    return reader.select({ id: products.id }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode destructured Drizzle receiver surface select() without project type proof.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
        ],
        query: 'product/quoted-destructured-db',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:7',
      },
    ]);
  });

  it('pins local query-loader helper reads under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, jiso({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(db: PgDatabase<any, any, any>) {',
            '  return db.select({ name: products.name }).from(products);',
            '}',
            '',
            "export const productQuery = query('product/local-helper', {",
            '  load(_input, db: PgDatabase<any, any, any>) {',
            '    return loadProducts(db);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/local-helper',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins local query-loader helper carrier reads under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, jiso({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts({ db }: { db: PgDatabase<any, any, any> }) {',
            '  return db.select({ name: products.name }).from(products);',
            '}',
            '',
            "export const productQuery = query('product/local-carrier-helper', {",
            '  load(_input, db: PgDatabase<any, any, any>) {',
            '    const context = { db };',
            '    return loadProducts(context);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/local-carrier-helper',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins shorthand query-loader functions under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, jiso({ domain: 'product', key: 'id' }));",
            '',
            'function load(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            "export const productQuery = query('product/shorthand-loader', {",
            '  load,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/shorthand-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins member-referenced query-loader functions under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, jiso({ domain: 'product', key: 'id' }));",
            '',
            'const loaders = {',
            '  product(_input: unknown, db: PgDatabase<any, any, any>) {',
            '    return db.select({ id: products.id, name: products.name }).from(products);',
            '  },',
            '};',
            '',
            "export const productQuery = query('product/member-loader', {",
            '  load: loaders.product,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/member-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:14',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins member-referenced query-loader aliases under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, jiso({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            'const loaders = {',
            '  aliased: loadProducts,',
            '  loadProducts,',
            '};',
            '',
            "export const aliasedQuery = query('product/member-aliased-loader', {",
            '  load: loaders.aliased,',
            '});',
            '',
            "export const shorthandQuery = query('product/member-shorthand-loader', {",
            '  load: loaders.loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/member-aliased-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:17',
      },
      {
        query: 'product/member-shorthand-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:21',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins static element-access query-loader aliases under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, jiso({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            'const loaders = {',
            '  aliased: loadProducts,',
            '  loadProducts,',
            '};',
            '',
            "export const aliasedQuery = query('product/static-member-aliased-loader', {",
            '  load: loaders["aliased"],',
            '});',
            '',
            "export const shorthandQuery = query('product/static-member-shorthand-loader', {",
            '  load: loaders["loadProducts"],',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/static-member-aliased-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:17',
      },
      {
        query: 'product/static-member-shorthand-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:21',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins object alias and spread query-loader callbacks under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  select(): { from(table: unknown): Promise<unknown> };',
            '}',
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, jiso({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            'function fakeLoad(_input: unknown, fake: FakeDb) {',
            '  return fake.select().from(products);',
            '}',
            '',
            'const base = { loadProducts };',
            'const alias = base;',
            'const spread = { ...base };',
            'const overridden = { ...base, loadProducts: fakeLoad };',
            '',
            "export const aliasedQuery = query('product/object-alias-loader', {",
            '  load: alias.loadProducts,',
            '});',
            '',
            "export const spreadQuery = query('product/object-spread-loader', {",
            '  load: spread["loadProducts"],',
            '});',
            '',
            "export const overriddenQuery = query('product/overridden-object-spread-loader', {",
            '  load: overridden.loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/object-alias-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:24',
      },
      {
        query: 'product/object-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:28',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins pgTable(name, cols, jiso({...})) as the real Drizzle extra config integration point', () => {
    const cartItems = pgTable(
      'cart_items',
      {
        cartId: text('cart_id').notNull(),
        productId: text('product_id').notNull(),
      },
      jiso({ domain: 'cart', key: 'productId' }),
    );

    expect(cartItems.productId).toBeDefined();
    const tableInternals = cartItems as unknown as Record<symbol, unknown>;
    const extraConfigBuilder = tableInternals[drizzleSymbol('ExtraConfigBuilder')];
    const extraConfigColumns = tableInternals[drizzleSymbol('ExtraConfigColumns')];

    expect(extraConfigBuilder).toEqual(
      expect.objectContaining({ domain: 'cart', key: 'productId' }),
    );
    expect(
      typeof extraConfigBuilder === 'function' ? extraConfigBuilder(extraConfigColumns) : [],
    ).toEqual([]);
  });

  it('recognizes real Drizzle receiver types in project extraction', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));

            export async function addItem(writer: PgDatabase<any, any, any>, productId: string) {
              await writer.insert(cartItems).values({ productId });
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins typed destructured Drizzle receivers with real imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface Context { db: PgDatabase<any, any, any> }
            interface FakeContext { db: { update(table: unknown): { set(value: unknown): Promise<void> } } }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              stock: integer('stock').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));

            export async function restock({ db: writer }: Context, fake: FakeContext, productId: string) {
              await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));
              await fake.db.update(products).set({ stock: 0 });
            }

            export async function fakeRestock({ db }: FakeContext) {
              await db.update(products).set({ stock: -1 });
            }

            export const productQuery = query('product/destructured', {
              load(_input, { db }: Context) {
                return db.select({ id: products.id, stock: products.stock }).from(products);
              },
            });
          `,
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:13',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/destructured',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:21',
      },
    ]);
  });

  it('pins body-local typed Drizzle receiver aliases with real imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface Context { db: PgDatabase<any, any, any> }
            interface FakeDb {
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
              update(table: unknown): { set(value: unknown): Promise<void> };
            }
            interface FakeContext { db: FakeDb }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              stock: integer('stock').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));

            export async function restock(context: Context, fake: FakeContext, productId: string) {
              const { db: writer } = context;
              const { db: fakeWriter } = fake;
              await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));
              await fakeWriter.update(products).set({ stock: 0 });
            }

            export const productQuery = query('product/body-local-alias', {
              load(_input, context: Context, fake: FakeContext) {
                const { db: reader } = context;
                const { db: fakeReader } = fake;
                fakeReader.select({ id: products.id }).from(products);
                return reader.select({ id: products.id, stock: products.stock }).from(products);
              },
            });
          `,
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:19',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/body-local-alias',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:23',
      },
    ]);
  });

  it('pins assignment Drizzle receiver aliases with real imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
              update(table: unknown): { set(value: unknown): Promise<void> };
            }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              stock: integer('stock').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));

            export async function restock(db: PgDatabase<any, any, any>, fake: FakeDb, productId: string) {
              let writer;
              writer = db;
              let fakeWriter;
              fakeWriter = fake;
              await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));
              await fakeWriter.update(products).set({ stock: 0 });
            }

            export const productQuery = query('product/assignment-alias', {
              load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {
                let reader;
                reader = db;
                let fakeReader;
                fakeReader = fake;
                fakeReader.select({ id: products.id }).from(products);
                return reader.select({ id: products.id, stock: products.stock }).from(products);
              },
            });
          `,
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:19',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/assignment-alias',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:23',
      },
    ]);
  });

  it('pins destructuring assignment Drizzle receiver aliases with real imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
              update(table: unknown): { set(value: unknown): Promise<void> };
            }
            interface FakeContext { db: FakeDb }
            interface DrizzleContext { db: PgDatabase<any, any, any> }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              stock: integer('stock').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));

            export async function restock(context: DrizzleContext, fake: FakeContext, productId: string) {
              let writer;
              ({ db: writer } = context);
              let fakeWriter;
              ({ db: fakeWriter } = fake);
              await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));
              await fakeWriter.update(products).set({ stock: 0 });
            }

            export const productQuery = query('product/destructuring-assignment-alias', {
              load(_input, context: DrizzleContext, fake: FakeContext) {
                let reader;
                ({ db: reader } = context);
                let fakeReader;
                ({ db: fakeReader } = fake);
                fakeReader.select({ id: products.id }).from(products);
                return reader.select({ id: products.id, stock: products.stock }).from(products);
              },
            });
          `,
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:21',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/destructuring-assignment-alias',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:25',
      },
    ]);
  });

  it('pins tuple Drizzle receiver aliases with real imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface DrizzleContext { receivers: [PgDatabase<any, any, any>, FakeDb]; nested: { tuple: [FakeDb, PgDatabase<any, any, any>] } }',
          'interface FakeContext { receivers: [FakeDb, FakeDb] }',
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'export async function restock(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  const [writer] = context.receivers;',
          '  let assignedWriter;',
          '  [, assignedWriter] = context.nested.tuple;',
          '  const [fakeWriter] = fake.receivers;',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await assignedWriter.update(products).set({ stock: 2 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 0 });',
          '}',
          '',
          "export const productQuery = query('product/tuple-alias', {",
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    const [reader] = context.receivers;',
          '    let assignedReader;',
          '    [, assignedReader] = context.nested.tuple;',
          '    const [fakeReader] = fake.receivers;',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    assignedReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:20',
            via: 'products',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:21',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/tuple-alias',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:25',
      },
    ]);
  });

  it('pins namespace-imported project write targets with real Drizzle tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';

            export const cartItems = pgTable('cart_items', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: `
            import { eq } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import * as schema from './schema';

            export async function addItem(db: PgDatabase<any, any, any>, id: string) {
              await db.update(schema.cartItems).set({ id }).where(eq(schema.cartItems.id, id));
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: 'arg:id',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins namespace static element-access project writes against real Drizzle tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';

            export const cartItems = pgTable('cart_items', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: `
            import { eq } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import * as schema from './schema';

            export async function addItem(db: PgDatabase<any, any, any>, id: string) {
              await db.update(schema['cartItems']).set({ id }).where(eq(schema['cartItems'].id, id));
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: 'arg:id',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins namespace project writes through re-export barrels with real Drizzle tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';

            export const cartItems = pgTable('cart_items', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/tables.ts',
          source: `
            export { cartItems as cartLineItems } from './schema';
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/index.ts',
          source: `
            export * from './tables';
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: `
            import { eq } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import * as schema from './index';

            export async function addItem(db: PgDatabase<any, any, any>, id: string) {
              await db.update(schema['cartLineItems']).set({ id }).where(eq(schema['cartLineItems'].id, id));
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: 'arg:id',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins project transaction aliases without leaking same-name callback receivers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, queue: FakeDb[], productId: string) {',
            '  await db.transaction(async (writer) => {',
            '    await writer.insert(cartItems).values({ productId });',
            '    queue.forEach(async (writer) => {',
            '      await writer.update(cartItems).set({ productId });',
            '    });',
            '  });',
            '  queue.forEach(async (writer) => {',
            '    await writer.update(cartItems).set({ productId });',
            '  });',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:11',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins source transaction callback receiver aliases for write extraction', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
        source: [
          "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
          '',
          'export async function addItem(db, productId) {',
          '  await db.transaction(async (writer) => {',
          '    await writer.insert(cartItems).values({ productId });',
          '  });',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins ambient source-mode real Drizzle receiver globals as FW406', () => {
    const runtimeUsers = pgTable('users', { id: text('id').primaryKey() });
    expect(runtimeUsers.id).toBeDefined();

    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/users.domain.ts',
        source: [
          "import { eq } from 'drizzle-orm';",
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const users = pgTable('users', { id: text('id').primaryKey() }, jiso({ domain: 'user', key: 'id' }));",
          '',
          'export async function syncUsers() {',
          "  await db.update(users).set({ id: 'u1' }).where(eq(users.id, 'u1'));",
          '  await db.select({ id: users.id }).from(users);',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:7',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:8',
          },
        ],
      },
    });
  });

  it('pins source body-local receiver aliases as FW406 under real Drizzle imports', () => {
    expect(sql`select 1`).toBeDefined();

    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/users.domain.ts',
        source: [
          "import { sql } from 'drizzle-orm';",
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const users = pgTable('users', { id: text('id').primaryKey() }, jiso({ domain: 'user', key: 'id' }));",
          '',
          'export async function syncUsers(db, fake) {',
          '  const writer = db;',
          '  const context = { writer, fake };',
          '  const { writer: destructuredWriter } = context;',
          '  const fakeContext = { writer: fake };',
          '  const { writer: fakeWriter } = fakeContext;',
          '  await writer.execute(sql`select 1`);',
          "  await context.writer.update(users).set({ id: 'u1' });",
          "  await destructuredWriter.update(users).set({ id: 'u2' });",
          "  await fakeWriter.update(users).set({ id: 'fake' });",
          "  await context.fake.update(users).set({ id: 'fake' });",
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:12',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:13',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:14',
          },
        ],
      },
    });
  });

  it('pins source destructuring assignment receiver aliases as FW406 under real Drizzle imports', () => {
    expect(sql`select 1`).toBeDefined();

    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/users.domain.ts',
        source: [
          "import { sql } from 'drizzle-orm';",
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const users = pgTable('users', { id: text('id').primaryKey() }, jiso({ domain: 'user', key: 'id' }));",
          '',
          'export async function syncUsers(db, fake) {',
          '  const context = { db, fake };',
          '  let writer;',
          '  ({ db: writer } = context);',
          '  let fakeWriter;',
          '  ({ fake: fakeWriter } = context);',
          '  await writer.execute(sql`select 1`);',
          "  await writer.update(users).set({ id: 'u1' });",
          "  await fakeWriter.update(users).set({ id: 'fake' });",
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:12',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:13',
          },
        ],
      },
    });
  });

  it('pins source transaction aliases without leaking same-name callback receivers', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
        source: [
          "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
          '',
          'export async function addItem(db, productId, queue) {',
          '  await db.transaction(async (writer) => {',
          '    await writer.insert(cartItems).values({ productId });',
          '    await queue.forEach(async (writer) => {',
          '      await writer.update(cartItems).set({ productId });',
          '      await writeAudit(writer, productId);',
          '    });',
          '  });',
          '  await queue.forEach(async (writer) => {',
          '    await writer.delete(cartItems).where(eq(cartItems.productId, productId));',
          '  });',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins standalone direct select chains as real Drizzle touch-graph reads', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/catalog.domain.ts',
          source: `
            import { eq } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              vendorId: text('vendor_id'),
            }, jiso({ domain: 'product', key: 'id' }));
            export const vendors = pgTable('vendors', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'vendor', key: 'id' }));

            export async function loadCatalog(db: PgDatabase<any, any, any>) {
              await db.select({ id: products.id }).from((products as any)).leftJoin(vendors!, eq(vendors.id, products.vendorId));
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      loadCatalog: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:14',
            source: 'select',
            via: 'products',
          },
          {
            domain: 'vendor',
            keys: null,
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:14',
            source: 'select',
            via: 'vendors',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
  });

  it('pins wrapped source direct-select and write read-source tables', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/catalog.domain.ts',
        source: [
          'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
          'export const vendors = pgTable("vendors", {}, jiso({ domain: "vendor", key: "id" }));',
          'export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));',
          '',
          'export async function syncCatalog(db) {',
          '  await db.select().from((products as any)).leftJoin(vendors!, eq(vendors.id, products.vendorId));',
          '  await db.insert(snapshots).select(db.select().from((products as any)));',
          '  await db.update(snapshots).set({ refreshed: true }).from(vendors!);',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "syncCatalog": {',
        '    touches: [',
        '      { domain: "snapshot", via: "product_snapshots", site: "conformance/drizzle-pin/src/catalog.domain.ts:7", keys: null },',
        '      { domain: "snapshot", via: "product_snapshots", site: "conformance/drizzle-pin/src/catalog.domain.ts:8", keys: null },',
        '    ],',
        '    reads: [',
        '      { domain: "product", via: "products", site: "conformance/drizzle-pin/src/catalog.domain.ts:7", keys: null, source: "insert-select" },',
        '      { domain: "product", via: "products", site: "conformance/drizzle-pin/src/catalog.domain.ts:6", keys: null, source: "select" },',
        '      { domain: "vendor", via: "vendors", site: "conformance/drizzle-pin/src/catalog.domain.ts:6", keys: null, source: "select" },',
        '      { domain: "vendor", via: "vendors", site: "conformance/drizzle-pin/src/catalog.domain.ts:8", keys: null, source: "update-from" },',
        '    ],',
        '    unresolved: [',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
  });

  it('pins unresolved standalone direct select tables as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/catalog.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export async function loadCatalog(db: PgDatabase<any, any, any>, tableName: string) {
              await db.select().from(tableFor(tableName));
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      loadCatalog: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:5',
          },
        ],
      },
    });
  });

  it('pins source destructured receiver parameters as FW406 without fabricated writes', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
        source: [
          "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
          '',
          'export async function addItem({ db: writer } = makeContext(), productId) {',
          '  await writer.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:4',
          },
        ],
      },
    });
  });

  it('pins quoted source destructured receiver parameters as FW406 without fabricated writes', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
        source: [
          "import { pgTable } from 'drizzle-orm/pg-core';",
          '',
          "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
          '',
          'export async function addItem({ "db": writer } = makeContext(), productId) {',
          '  await writer.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:6',
          },
        ],
      },
    });
  });

  it('pins source static element-access write methods', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
        source: [
          "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
          '',
          'export async function addItem(db, productId) {',
          '  await db["insert"](cartItems).values({ productId });',
          '  await db["update"](cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:4',
            via: 'cart_items',
          },
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins source expression-bodied helper calls as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
        source: ['export const addItem = (db) => writeAudit(db);', ''].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:1',
          },
        ],
      },
    });
  });

  it('pins closure-local helper summaries by symbol instead of helper name', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
        source: [
          "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
          "export const auditLog = pgTable('audit_log', {}, jiso({ domain: 'audit', key: 'productId' }));",
          '',
          'export async function addItem(db, productId) {',
          '  async function apply(db) {',
          '    await db.insert(cartItems).values({ productId });',
          '  }',
          '  await apply(db);',
          '}',
          '',
          'export async function auditItem(db, productId) {',
          '  async function apply(db) {',
          '    await db.insert(auditLog).values({ productId });',
          '  }',
          '  await apply(db);',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:6',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    });
    expect(graph.auditItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'audit',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:13',
          via: 'audit_log',
        },
      ],
      unresolved: [],
    });
  });

  it('pins project closure-local helper summaries by symbol instead of helper name', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            "export const auditLog = pgTable('audit_log', {}, jiso({ domain: 'audit', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function apply(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(cartItems).values({ productId });',
            '  }',
            '  await apply(db);',
            '}',
            '',
            'export async function auditItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function apply(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(auditLog).values({ productId });',
            '  }',
            '  await apply(db);',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:8',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    });
    expect(graph.auditItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'audit',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:15',
          via: 'audit_log',
        },
      ],
      unresolved: [],
    });
  });

  it('pins uncalled closure-local helpers as isolated summaries', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
        source: [
          "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
          "export const auditLog = pgTable('audit_log', {}, jiso({ domain: 'audit', key: 'productId' }));",
          '',
          'export async function addItem(db, productId) {',
          '  async function writeAudit(db) {',
          '    await db.insert(auditLog).values({ productId });',
          '  }',
          '  return productId;',
          '}',
          '',
          'export async function calledItem(db, productId) {',
          '  async function writeCart(db) {',
          '    await db.insert(cartItems).values({ productId });',
          '  }',
          '  await writeCart(db);',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph.addItem).toBeUndefined();
    expect(graph.writeAudit).toEqual({
      reads: [],
      touches: [
        {
          domain: 'audit',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:6',
          via: 'audit_log',
        },
      ],
      unresolved: [],
    });
    expect(graph.calledItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:13',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    });
  });

  it('pins project closure-local helper folding to proven receiver arguments', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            "export const auditLog = pgTable('audit_log', {}, jiso({ domain: 'audit', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb, productId: string) {',
            '  async function writeAudit(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(auditLog).values({ productId });',
            '  }',
            '  await writeAudit(fake);',
            '  await db.insert(cartItems).values({ productId });',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:15',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    });
    expect(graph.writeAudit).toEqual({
      reads: [],
      touches: [
        {
          domain: 'audit',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:12',
          via: 'audit_log',
        },
      ],
      unresolved: [],
    });
  });

  it('pins opaque local helper Drizzle carrier aliases as FW406 under real imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            '',
            'function writeAudit(context: unknown): Promise<void> {',
            '  return Promise.resolve(context);',
            '}',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  const context = { db };',
            '  const fakeContext = { db: fake };',
            '  await writeAudit(fakeContext);',
            '  await writeAudit(context);',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:15',
          },
        ],
      },
    });
  });

  it('pins opaque local helper assigned Drizzle carrier aliases as FW406 under real imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            '',
            'function writeAudit(context: unknown): Promise<void> {',
            '  return Promise.resolve(context);',
            '}',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  let context;',
            '  context = { db };',
            '  let fakeContext;',
            '  fakeContext = { db: fake };',
            '  await writeAudit(fakeContext);',
            '  await writeAudit(context);',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:17',
          },
        ],
      },
    });
  });

  it('pins real Drizzle receiver types inside domain write callbacks', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'export const cart = domain({',
            '  addItem: write(async (writer: PgDatabase<any, any, any>, productId: string) => {',
            '    await writer.insert(cartItems).values({ productId });',
            '  }),',
            '});',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins referenced domain write callbacks with real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'function addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'export const cart = domain({',
            '  addItem: write(addItem),',
            '});',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins member-referenced domain write callbacks with real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'const callbacks = {',
            '  addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
            '    writer.insert(cartItems).values({ productId });',
            '    db.insert(cartItems).values({ productId });',
            '  },',
            '};',
            '',
            'export const cart = domain({',
            '  addItem: write(callbacks.addItem),',
            '});',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:11',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins member-referenced domain write callback aliases with real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'function addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'const callbacks = {',
            '  aliased: addItem,',
            '  addItem,',
            '};',
            '',
            'export const cart = domain({',
            '  addAliased: write(callbacks.aliased),',
            '  addShorthand: write(callbacks.addItem),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addAliased': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addShorthand': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins static element-access domain write callback aliases with real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'function addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'const callbacks = {',
            '  aliased: addItem,',
            '  addItem,',
            '};',
            '',
            'export const cart = domain({',
            '  addAliased: write(callbacks["aliased"]),',
            '  addShorthand: write(callbacks["addItem"]),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addAliased': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addShorthand': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins object alias and spread domain write callbacks with real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'function addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            'function fakeAdd(db: FakeDb, productId: string) {',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'const base = { addItem };',
            'const alias = base;',
            'const spread = { ...base };',
            'const overridden = { ...base, addItem: fakeAdd };',
            '',
            'export const cart = domain({',
            '  addAliased: write(alias.addItem),',
            '  addSpread: write(spread["addItem"]),',
            '  addOverridden: write(overridden.addItem),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addAliased': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addSpread': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins real Drizzle receiver types with static element-access write methods', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  await db["insert"](cartItems).values({ productId });',
            '  await db["update"](cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:6',
            via: 'cart_items',
          },
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins real Drizzle project read sources from write call AST', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.domain.ts',
          source: [
            "import { eq, gt, sql } from 'drizzle-orm';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {}, jiso({ domain: 'product', key: 'id' }));",
            "export const prices = pgTable('prices', {}, jiso({ domain: 'price', key: 'productId' }));",
            "export const snapshots = pgTable('product_snapshots', {}, jiso({ domain: 'snapshot', key: 'productId' }));",
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
          "}, jiso({ domain: 'product', key: 'id' }));",
          "const productAlias = alias(products, 'p');",
          '',
          'export async function syncProduct(db: PgDatabase<any, any, any>, productId: string) {',
          '  await db.update(productAlias).set({ stock: 1 }).where(eq(productAlias.id, productId));',
          '  await db.select({ stock: productAlias.stock }).from(productAlias);',
          '}',
          '',
          "export const productQuery = query('product/alias', {",
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
            }, jiso({ domain: 'user', key: 'id' }));

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

  it('pins unresolved project relational query table names as FW406', () => {
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
            code: 'FW406',
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
            }, jiso({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/order.schema.ts',
          source: `
            export const items = pgTable('order_items', {}, jiso({ domain: 'order', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';
            import { items } from './cart.schema';

            export const cartQuery = query('cart', {
              load(input, db: PgDatabase) {
                return db.select({ id: items.id }).from(items).where(eq(items.id, input.id));
              },
            });

            export const cartCountQuery = query('cart/count', {
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
            code: 'FW410',
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
        code: 'FW410',
        message:
          'Opaque query projection requires a declared output schema. cart/count.count uses sql/raw projection without output.',
        severity: 'error',
        site: 'conformance/drizzle-pin/src/cart.queries.ts:11',
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
            }, jiso({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/order.schema.ts',
          source: `
            export const products = pgTable('order_products', {
              id: integer('id').primaryKey(),
            }, jiso({ domain: 'order', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.queries.ts',
          source: `
            import * as cartSchema from './cart.schema';

            export const cartProductQuery = query('cart/product', {
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
            }, jiso({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.queries.ts',
          source: `
            import * as cartSchema from './cart.schema';

            export const cartProductQuery = query('cart/product', {
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
            }, jiso({ domain: 'cart', key: 'id' }));
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

            export const cartProductQuery = query('cart/product', {
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
            }, jiso({ domain: 'product', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { products } from './product.schema';

            export const distinctProducts = query('products/distinct', {
              load(_input, db: PgDatabase) {
                return db.selectDistinct({ name: products.name }).from(products);
              },
            });

            export const firstProductNames = query('products/distinct-on', {
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
            }, jiso({ domain: 'product', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { products } from './product.schema';

            export const productQuery = query('product', {
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

  it('pins custom column builders as FW406 instead of fabricated string shapes', () => {
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
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query projection product.location could not be resolved to a Drizzle column or typed sql<T> expression.',
            severity: 'warn',
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
            export const auditLog = pgTable('audit_log', {}, jiso({ exempt: true }));
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              name: text('name').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product', {
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

  it('pins computed real Drizzle read sources as FW406 instead of inferred reads', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.schema.ts',
          source: `
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { products } from './product.schema';

            function tableFor<T>(table: T): T { return table; }

            export const productQuery = query('product', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query read source for db.from() could not be resolved to a Drizzle table.',
            severity: 'warn',
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
            "export const products = pgTable('products', { id: text('id') }, jiso({ domain: 'product', key: 'id' }));",
            "export const vendors = pgTable('vendors', { id: text('id') }, jiso({ domain: 'vendor', key: 'id' }));",
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
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:10',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:11',
          },
        ],
      },
    });
  });

  it('pins real Drizzle raw query execute as an explicit FW406 read surface', () => {
    expect(sql`select * from users`).toBeDefined();

    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';

            export const users = pgTable('users', {}, jiso({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/raw', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db.execute().',
            severity: 'warn',
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

  it('pins computed real Drizzle query receiver methods as explicit FW406 surfaces', () => {
    expect(sql`select * from users`).toBeDefined();

    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';

            type FakeDb = Record<string, (query: unknown) => Promise<void>>;

            export const usersQuery = query('users/computed-raw', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db[method]().',
            severity: 'warn',
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

  it('pins bound and assigned real Drizzle query receiver methods as explicit FW406 surfaces', () => {
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

            export const usersQuery = query('users/bound-raw', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method <computed>().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method <computed>().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method <computed>().',
            severity: 'warn',
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

  it('pins array-destructured real Drizzle query receiver methods as explicit FW406 surfaces', () => {
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

            export const usersQuery = query('users/array-detached-raw', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method <computed>().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:9',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
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

  it('pins direct real Drizzle query carrier members as exact reads with FW406 writes', () => {
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
            "}, jiso({ domain: 'user', key: 'id' }));",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            "export const usersQuery = query('users/carrier-direct', {",
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:14',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call carrier.db.execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:14',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call carrier.db.update().',
            severity: 'warn',
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
            }, jiso({ exempt: true }));
            export const users = pgTable('users', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/non-loader-callback', {
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

  it('pins real Drizzle query-loader transaction aliases as explicit FW406 surfaces', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const users = pgTable('users', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/transaction-write', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db.transaction().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:8',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call tx.update().',
            severity: 'warn',
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
            }, jiso({ domain: 'audit', key: 'id' }));
            export const users = pgTable('users', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/nested-helper', {
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

  it('pins static element-access relational reads as explicit FW406 facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            export const users = pgTable('users', {}, jiso({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
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

  it('pins template-literal element-access relational reads as explicit FW406 facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            export const users = pgTable('users', {}, jiso({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/template-access', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
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
            }, jiso({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users/shadowed-relational', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
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

  it('pins unresolved project relational read sources as explicit FW406 facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            export const users = pgTable('users', {}, jiso({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/user.queries.ts:4',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query relational read source could not be resolved to a Drizzle table.',
            severity: 'warn',
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
            export const auditLog = pgTable('audit_log', {}, jiso({ exempt: true }));
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              name: text('name').notNull(),
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product', {
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

  it('pins real Drizzle materialized-view refresh as an explicit FW406 write surface', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/catalog.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import { pgMaterializedView, text } from 'drizzle-orm/pg-core';

            const productSearch = pgMaterializedView('product_search', { id: text('id') });

            export async function refreshCatalog(db: PgDatabase<any, any, any>) {
              await db.refreshMaterializedView(productSearch);
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      refreshCatalog: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:8',
          },
        ],
      },
    });
  });

  it('pins real Drizzle count helper as an explicit FW406 surface', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: `
            import { eq } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import { boolean, pgTable, text } from 'drizzle-orm/pg-core';

            const users = pgTable('users', {
              active: boolean('active').notNull(),
              id: text('id').primaryKey(),
            }, jiso({ domain: 'user', key: 'id' }));

            export async function countActiveUsers(db: PgDatabase<any, any, any>) {
              return db.$count(users, eq(users.active, true));
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      countActiveUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:12',
          },
        ],
      },
    });
  });

  it('pins unknown real Drizzle receiver methods as explicit FW406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              $with(name: string): unknown;
            }

            export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb) {
              db.$with('active_users');
              db['$with']('inactive_users');
              fake.$with('ignored_users');
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:9',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:10',
          },
        ],
      },
    });
  });

  it('pins computed real Drizzle receiver methods as explicit FW406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            type FakeDb = Record<string, (query: unknown) => Promise<void>>;

            export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb, method: string) {
              db[method]('active_users');
              fake[method]('ignored_users');
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:7',
          },
        ],
      },
    });
  });

  it('pins bound real Drizzle receiver methods as explicit FW406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import { pgTable, text } from 'drizzle-orm/pg-core';

            export const users = pgTable('users', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'user', key: 'id' }));

            interface FakeDb {
              execute(query: unknown): Promise<void>;
              update(table: unknown): { set(value: unknown): Promise<void> };
            }

            export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb, method: string) {
              const execute = db.execute.bind(db);
              const write = db.update.bind(db);
              const computed = db[method].bind(db);
              const fakeExecute = fake.execute.bind(fake);
              await execute('select 1');
              await write(users).set({});
              await computed('select 1');
              await fakeExecute('select 1');
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:19',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:20',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:21',
          },
        ],
      },
    });
  });

  it('pins assigned real Drizzle receiver methods as explicit FW406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const users = pgTable('users', {",
            "  id: text('id').primaryKey(),",
            "}, jiso({ domain: 'user', key: 'id' }));",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb, method: string) {',
            '  let execute;',
            '  execute = db.execute;',
            '  let write;',
            '  write = db.update;',
            '  let computed;',
            '  computed = db[method];',
            '  let fakeExecute;',
            '  fakeExecute = fake.execute;',
            '  let objectExecute;',
            '  ({ execute: objectExecute } = db);',
            '  const carrier = { db, fake };',
            '  const carrierExecute = carrier.db.execute;',
            '  let carrierComputed;',
            '  carrierComputed = carrier.db[method];',
            '  const carrierFakeExecute = carrier.fake.execute;',
            "  await execute('select 1');",
            '  await write(users).set({});',
            "  await computed('select 1');",
            "  await objectExecute('select 1');",
            "  await carrierExecute('select 1');",
            "  await carrierComputed('select 1');",
            "  await carrierFakeExecute('select 1');",
            "  await fakeExecute('select 1');",
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:29',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:30',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:31',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:32',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:33',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:34',
          },
        ],
      },
    });
  });

  it('pins array-destructured real Drizzle receiver methods as explicit FW406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const users = pgTable('users', {",
            "  id: text('id').primaryKey(),",
            "}, jiso({ domain: 'user', key: 'id' }));",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb, method: string) {',
            '  const [execute, write, computed] = [db.execute, db.update, db[method]];',
            '  const [fakeExecute] = [fake.execute];',
            '  let assignedExecute;',
            '  [assignedExecute] = [db.execute];',
            "  await execute('select 1');",
            '  await write(users).set({});',
            "  await computed('select 1');",
            "  await assignedExecute('select 1');",
            "  await fakeExecute('select 1');",
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:18',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:19',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:20',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:21',
          },
        ],
      },
    });
  });

  it('pins direct real Drizzle carrier member calls as exact facts with FW406 raw calls', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const users = pgTable('users', {",
            "  id: text('id').primaryKey(),",
            "}, jiso({ domain: 'user', key: 'id' }));",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  const carrier = { db, fake };',
            "  await carrier.db.execute('select 1');",
            '  await carrier.db.update(users).set({});',
            '  await carrier.db.query.users.findMany();',
            "  await carrier.fake.execute('select 1');",
            '  await carrier.fake.update(users).set({});',
            '  await carrier.fake.query.users.findMany();',
            '  await audit({ db: carrier.db });',
            '  await audit({ db: carrier.fake });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'conformance/drizzle-pin/src/users.domain.ts:18',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [
          {
            domain: 'user',
            keys: null,
            site: 'conformance/drizzle-pin/src/users.domain.ts:17',
            via: 'users',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:22',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:16',
          },
        ],
      },
    });
  });

  it('pins table annotations as the domain registry source', () => {
    const cartItems = annotatedTable('cart_items', jiso({ domain: 'cart', key: 'cartId' }));
    const products = annotatedTable('products', jiso({ domain: 'product', key: 'id' }));

    expect(serializeDomainRegistry([{ table: products }, { table: cartItems }])).toBe(
      [
        'export type DomainKey = "cart" | "product";',
        '',
        'export const tableDomains = {',
        '  "cart_items": "cart",',
        '  "products": "product",',
        '} as const satisfies Record<string, DomainKey>;',
        '',
      ].join('\n'),
    );
  });

  it('pins write summaries, read domains, parameterized keys, unresolved sites, and diagnostics', () => {
    const graph = {
      'cart.addItem': createTouchGraphEntry({
        reads: [
          {
            operation: 'insert-select',
            predicate: 'non-eq',
            site: 'cart.domain.ts:15',
            table: annotatedTable('products', jiso({ domain: 'product', key: 'id' })),
          },
          {
            branch: 'stock-check',
            operation: 'update-from',
            predicate: 'eq',
            readKey: 'arg:productId',
            site: 'cart.domain.ts:21',
            table: annotatedTable(
              'inventory_snapshots',
              jiso({ domain: 'inventory', key: 'productId' }),
            ),
          },
        ],
        unresolved: [{ domain: 'audit', operation: 'raw', site: 'cart.domain.ts:31' }],
        writes: [
          {
            branch: 'stock-check',
            operation: 'update',
            predicate: 'non-eq',
            site: 'cart.domain.ts:20',
            table: annotatedTable('products', jiso({ domain: 'product', key: 'id' })),
            writeKey: 'arg:productId',
          },
          {
            operation: 'insert',
            site: 'cart.domain.ts:16',
            table: annotatedTable('cart_items', jiso({ domain: 'cart', key: 'cartId' })),
          },
        ],
      }),
    };

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "cart.addItem": {',
        '    touches: [',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:16", keys: null },',
        '      { domain: "product", via: "products", site: "cart.domain.ts:20", keys: "arg:productId", branch: "stock-check", predicate: "non-eq" },',
        '    ],',
        '    reads: [',
        '      { domain: "inventory", via: "inventory_snapshots", site: "cart.domain.ts:21", keys: "arg:productId", source: "update-from", branch: "stock-check", predicate: "eq" },',
        '      { domain: "product", via: "products", site: "cart.domain.ts:15", keys: null, source: "insert-select", predicate: "non-eq" },',
        '    ],',
        '    unresolved: [',
        '      { code: \'FW406\', site: "cart.domain.ts:31", message: "Statically un-analyzable write site; manual touches required.", domain: "audit" },',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'FW406',
        message: 'Statically un-analyzable write site; manual touches required.',
        severity: 'warn',
        site: 'cart.domain.ts:31',
      },
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'cart.domain.ts:20',
      },
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'cart.domain.ts:15',
      },
    ]);
  });

  it('pins direct table source extraction for the first supported Drizzle case', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));',
          'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
          'export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));',
          'const productAlias = alias(products, "p");',
          '',
          'export async function addItem(db, productId, cartIds) {',
          '  await db.insert(cartItems).values({ productId: "p1" });',
          '  await db.update(productAlias).set({ reserved: true }).from(prices).where(eq(productAlias.id, productId));',
          '  await db.delete(cartItems).where(inArray(cartItems.cartId, cartIds));',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "addItem": {',
        '    touches: [',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:7", keys: null },',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:9", keys: null, predicate: "non-eq" },',
        '      { domain: "product", via: "products", site: "cart.domain.ts:8", keys: "arg:productId" },',
        '    ],',
        '    reads: [',
        '      { domain: "price", via: "prices", site: "cart.domain.ts:8", keys: null, source: "update-from" },',
        '    ],',
        '    unresolved: [',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'cart.domain.ts:9',
      },
    ]);
  });

  it('pins AST-backed write predicate extraction without string-contained key facts', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: [
          'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
          '',
          'export async function scrubPredicate(db, productId) {',
          '  await db.update(products).set({ reserved: true }).where(gt(sql.raw("products.id"), productId));',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "scrubPredicate": {',
        '    touches: [',
        '      { domain: "product", via: "products", site: "product.domain.ts:4", keys: null },',
        '    ],',
        '    reads: [',
        '    ],',
        '    unresolved: [',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
  });

  it('pins local conditional table resolution as a safe over-approximation', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: [
          'export const archivedProducts = pgTable("archived_products", {}, jiso({ domain: "archive", key: "id" }));',
          'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
          'const writeTarget = useArchive ? archivedProducts : products;',
          '',
          'export async function syncProduct(db, productId) {',
          '  await db.update(writeTarget).set({ reserved: true }).where(eq(writeTarget.id, productId));',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "syncProduct": {',
        '    touches: [',
        '      { domain: "archive", via: "archived_products", site: "product.domain.ts:6", keys: "arg:productId" },',
        '      { domain: "product", via: "products", site: "product.domain.ts:6", keys: "arg:productId" },',
        '    ],',
        '    reads: [',
        '    ],',
        '    unresolved: [',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
  });

  it('pins conditional table FW406 when the opaque branch contains string punctuation', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: [
          'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
          'const writeTarget = useDynamic ? tableFor("archive:products") : products;',
          '',
          'export async function syncProduct(db) {',
          '  await db.update(writeTarget).set({ reserved: true });',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "syncProduct": {',
        '    touches: [',
        '      { domain: "product", via: "products", site: "product.domain.ts:5", keys: null },',
        '    ],',
        '    reads: [',
        '    ],',
        '    unresolved: [',
        '      { code: \'FW406\', site: "product.domain.ts:5", message: "Statically un-analyzable write site; manual touches required." },',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
  });

  it('pins domain write callback extraction for the Jiso authoring surface', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'export const cart = domain({',
          '  addItem: write(async (db, productId) => {',
          '    await db.insert(cartItems).values({ productId });',
          '  }),',
          '});',
          '',
        ].join('\n'),
      },
    ]);

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "cart.addItem": {',
        '    touches: [',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:5", keys: null },',
        '    ],',
        '    reads: [',
        '    ],',
        '    unresolved: [',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
  });
});
