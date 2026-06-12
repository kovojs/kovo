import { describe, expect, it } from 'vitest';

import { eq, gt, inArray, sql } from 'drizzle-orm';
import { alias, boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import {
  createTouchGraphEntry,
  diagnosticsForQueryFacts,
  diagnosticsForTouchGraph,
  extractTouchGraphFromProject,
  extractTouchGraphFromSource,
  extractQueryFactsFromProject,
  jiso,
  serializeDomainRegistry,
  serializeTouchGraph,
} from '@jiso/drizzle/static';

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

  it('pins project query shapes for real Drizzle column builders', () => {
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
              load(_input, db) {
                return db.select({
                  archived: products.archived,
                  createdAt: products.createdAt,
                  discount: products.name,
                  id: products.id,
                  metadata: products.metadata,
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
              load(_input, db) {
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
              load(_input, db) {
                return db.select({
                  productName: products.name,
                  discountPercent: discounts.percent,
                }).from(products).fullJoin(discounts, eq(discounts.productId, products.id));
              },
            });

            export const reviewQuery = query('review/right', {
              load(_input, db) {
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
    const extraConfigBuilder = tableInternals[drizzleSymbol('ExtraConfigBuilder')] as
      | ((columns: unknown) => unknown)
      | ReturnType<typeof jiso>
      | undefined;
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
              load(input, db) {
                return db.select({ id: items.id }).from(items).where(eq(items.id, input.id));
              },
            });

            export const cartCountQuery = query('cart/count', {
              load(_input, db) {
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
              load(_input, db) {
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

  it('pins static element-access relational reads as explicit FW406 facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/user.queries.ts',
          source: `
            export const users = pgTable('users', {}, jiso({ domain: 'user', key: 'id' }));

            export const usersQuery = query('users', {
              load(_input, db) {
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
