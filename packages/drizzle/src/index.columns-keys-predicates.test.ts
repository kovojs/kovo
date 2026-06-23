import { describe, expect, it } from 'vitest';

import {
  diagnosticsForTouchGraph,
  extractSymbolicEffectsFromProject,
  extractTouchGraphFromProject,
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, sqliteDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

const extractQueryFactsFromProject = (
  options: Parameters<typeof extractQueryFactsFromProjectBase>[0],
) => extractQueryFactsFromProjectBase(withPgDatabaseTypes(options));

describe('@kovojs/drizzle touch graph helpers', () => {
  it('derives project query shapes from Drizzle column builders instead of selected aliases', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              archived: boolean("archived").notNull(),
              createdAt: timestamp("created_at"),
              id: text("id").primaryKey(),
              metadata: json("metadata"),
              name: text("name"),
              stock: integer("stock").notNull(),
            }, kovo({ domain: "product", key: "id" }));

            export const productQuery = query("product", {
              load(_input, db: PgDatabase) {
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
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('derives SQLite mode-based query shapes from sqlite-core builders', () => {
    const facts = extractQueryFactsFromProjectBase({
      files: [
        sqliteDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        ]),
        {
          fileName: 'product.queries.ts',
          source: `
            import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
            import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

            export const products = sqliteTable("products", {
              active: integer("active", { mode: "boolean" }).notNull(),
              id: text("id").primaryKey(),
              metadata: text("metadata", { mode: "json" }),
              stock: integer("stock").notNull(),
            }, kovo({ domain: "product", key: "id" }));

            export const productQuery = query("product/sqlite", {
              load(_input, db: BaseSQLiteDatabase) {
                return db.select({
                  active: products.active,
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
        query: 'product/sqlite',
        reads: ['product'],
        shape: {
          active: 'boolean',
          id: 'string',
          metadata: {
            kind: 'nullable',
            shape: 'object',
          },
          stock: 'number',
        },
        site: 'product.queries.ts:12',
      },
    ]);
  });

  it('derives project query result shape from the returned select', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const auditLog = pgTable("audit_log", {
              id: text("id").primaryKey(),
              message: text("message").notNull(),
            }, kovo({ domain: "audit", key: "id" }));
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
              name: text("name").notNull(),
            }, kovo({ domain: "product", key: "id" }));

            export const productQuery = query("product", {
              async load(_input, db: PgDatabase) {
                await db.select({ message: auditLog.message }).from(auditLog);
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
        reads: ['audit', 'product'],
        shape: {
          name: 'string',
        },
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('wraps selected left-joined table columns as nullable project query shapes', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id"),
              name: text("name").notNull(),
            }, kovo({ domain: "product", key: "id" }));
            export const reviews = pgTable("reviews", {
              productId: text("product_id"),
              rating: integer("rating"),
            }, kovo({ domain: "review", key: "productId" }));

            export const productQuery = query("product", {
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
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('wraps selected right-joined source table columns as nullable query shapes', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {
            id: text("id"),
            name: text("name").notNull(),
          }, kovo({ domain: "product", key: "id" }));
          export const reviews = pgTable("reviews", {
            productId: text("product_id"),
            rating: integer("rating"),
          }, kovo({ domain: "review", key: "productId" }));

          export const reviewQuery = query("review", {
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
        query: 'review',
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
            rating: {
              kind: 'nullable',
              shape: 'number',
            },
          },
        },
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('wraps selected full-joined project columns on both sides as nullable query shapes', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id"),
              name: text("name").notNull(),
            }, kovo({ domain: "product", key: "id" }));
            export const reviews = pgTable("reviews", {
              productId: text("product_id"),
              rating: integer("rating").notNull(),
            }, kovo({ domain: "review", key: "productId" }));

            export const productReviewQuery = query("productReview", {
              load(_input, db: PgDatabase) {
                return db.select({
                  productName: products.name,
                  reviewRating: reviews.rating,
                }).from(products).fullJoin(reviews, eq(reviews.productId, products.id));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'productReview',
        reads: ['product', 'review'],
        shape: {
          productName: {
            kind: 'nullable',
            shape: 'string',
          },
          reviewRating: {
            kind: 'nullable',
            shape: 'number',
          },
        },
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('extracts direct insert-select and update-from read source tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { select(value: unknown): Promise<void> };',
          'select(): { from(table: unknown): { innerJoin(table: unknown, on: unknown): Promise<void> } };',
          'update(table: unknown): { set(value: unknown): { from(table: unknown): { where(value: unknown): Promise<void> } } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, kovo({ domain: "price", key: "productId" }));',
            'export const vendors = pgTable("vendors", {}, kovo({ domain: "vendor", key: "id" }));',
            'export const snapshots = pgTable("product_snapshots", {}, kovo({ domain: "snapshot", key: "productId" }));',
            '',
            'export async function importSnapshots(db: PgDatabase) {',
            '  await db.insert(snapshots).select(db.select().from(products).innerJoin(vendors, eq(vendors.id, products.vendorId)));',
            '  await db.update(products).set({ price: prices.amount }).from(prices).where(eq(prices.productId, products.id));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      importSnapshots: {
        reads: [
          {
            domain: 'price',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:11',
            source: 'update-from',
            via: 'prices',
          },
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:10',
            source: 'insert-select',
            via: 'products',
          },
          {
            domain: 'vendor',
            keys: null,
            site: 'product.domain.ts:10',
            source: 'insert-select',
            via: 'vendors',
          },
        ],
        touches: [
          { domain: 'product', keys: null, site: 'product.domain.ts:11', via: 'products' },
          {
            domain: 'snapshot',
            keys: null,
            site: 'product.domain.ts:10',
            via: 'product_snapshots',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:11',
      },
    ]);
  });

  it('extracts read source tables from write call AST without reparsing statement text', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { select(value: unknown): Promise<void> };',
          'select(): { from(table: unknown): { where(value: unknown): Promise<void> } };',
          'update(table: unknown): { set(value: unknown): { from(table: unknown): { where(value: unknown): Promise<void> } } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq, gt, sql } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, kovo({ domain: "price", key: "productId" }));',
            'export const snapshots = pgTable("product_snapshots", {}, kovo({ domain: "snapshot", key: "productId" }));',
            '',
            'export async function syncSnapshots(db: PgDatabase, productId: string) {',
            '  await db["insert"](snapshots).select(db.select().from(products).where(gt(sql.raw(".from(prices)"), 0)));',
            '  await db["update"](products).set({ price: prices.amount }).from(prices).where(eq(products.id, productId));',
            '}',
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
            site: 'product.domain.ts:10',
            source: 'update-from',
            via: 'prices',
          },
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:9',
            source: 'insert-select',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:10',
            via: 'products',
          },
          { domain: 'snapshot', keys: null, site: 'product.domain.ts:9', via: 'product_snapshots' },
        ],
        unresolved: [],
      },
    });
  });

  it('folds local helper writes and reads into caller summaries', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void>; select(value: unknown): Promise<void> };',
          'select(): { from(table: unknown): { innerJoin(table: unknown, on: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'export const vendors = pgTable("vendors", {}, kovo({ domain: "vendor", key: "id" }));',
            'export const snapshots = pgTable("product_snapshots", {}, kovo({ domain: "snapshot", key: "productId" }));',
            '',
            'async function insertCartItem(db: PgDatabase, input: { productId: string }) {',
            '  await db.insert(cartItems).values({ productId: input.productId });',
            '}',
            '',
            'async function snapshotProducts(db: PgDatabase) {',
            '  await db.insert(snapshots).select(db.select().from(products).innerJoin(vendors, eq(vendors.id, products.vendorId)));',
            '}',
            '',
            'export async function addItem(db: PgDatabase, input: { productId: string }) {',
            '  await insertCartItem(db, input);',
            '  await snapshotProducts(db);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toEqual({
      reads: [
        {
          domain: 'product',
          keys: null,
          site: 'cart.domain.ts:14',
          source: 'insert-select',
          via: 'products',
        },
        {
          domain: 'vendor',
          keys: null,
          site: 'cart.domain.ts:14',
          source: 'insert-select',
          via: 'vendors',
        },
      ],
      touches: [
        { domain: 'cart', keys: null, site: 'cart.domain.ts:10', via: 'cart_items' },
        { domain: 'snapshot', keys: null, site: 'cart.domain.ts:14', via: 'product_snapshots' },
      ],
      unresolved: [],
    });
    expect(graph.insertCartItem).toEqual({
      reads: [],
      touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:10', via: 'cart_items' }],
      unresolved: [],
    });
    expect(graph.snapshotProducts).toEqual({
      reads: [
        {
          domain: 'product',
          keys: null,
          site: 'cart.domain.ts:14',
          source: 'insert-select',
          via: 'products',
        },
        {
          domain: 'vendor',
          keys: null,
          site: 'cart.domain.ts:14',
          source: 'insert-select',
          via: 'vendors',
        },
      ],
      touches: [
        { domain: 'snapshot', keys: null, site: 'cart.domain.ts:14', via: 'product_snapshots' },
      ],
      unresolved: [],
    });
  });

  it('does not fold local helper summaries from comments and strings', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const auditLog = pgTable("audit_log", {}, kovo({ domain: "audit", key: "productId" }));',
            '',
            'async function writeAudit(db: PgDatabase, productId: string) {',
            '  await db.insert(auditLog).values({ productId });',
            '}',
            '',
            'export async function addItem(db: PgDatabase, productId: string) {',
            '  // await writeAudit(db, productId);',
            '  const fixture = "writeAudit(db, productId)";',
            '  const templated = `writeAudit(db, ${productId})`;',
            '  return { fixture, templated };',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      writeAudit: {
        reads: [],
        touches: [
          {
            domain: 'audit',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'audit_log',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('folds local helper summaries for domain-like helper names', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'async function insert(db: PgDatabase, productId: string) {',
            '  await db.insert(cartItems).values({ productId });',
            '}',
            '',
            'export async function addItem(db: PgDatabase, productId: string) {',
            '  await insert(db, productId);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem?.touches).toEqual([
      { domain: 'cart', keys: null, site: 'cart.domain.ts:6', via: 'cart_items' },
    ]);
    expect(graph.insert?.touches).toEqual([
      { domain: 'cart', keys: null, site: 'cart.domain.ts:6', via: 'cart_items' },
    ]);
  });

  it('keeps project closure-local helper summaries scoped by symbol instead of helper name', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {}, kovo({ domain: "audit", key: "productId" }));',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function apply(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(cartItems).values({ productId });',
            '  }',
            '',
            '  await apply(db);',
            '}',
            '',
            'export async function auditItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function apply(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(auditLog).values({ productId });',
            '  }',
            '',
            '  await apply(db);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:8', via: 'cart_items' }],
      unresolved: [],
    });
    expect(graph.auditItem).toEqual({
      reads: [],
      touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:16', via: 'audit_log' }],
      unresolved: [],
    });
  });

  it('folds project local helper summaries through typed receiver carriers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {}, kovo({ domain: "audit", key: "productId" }));',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function writeAudit({ db: writer }: { db: PgDatabase<any, any, any> }) {',
            '    await writer.insert(auditLog).values({ productId });',
            '  }',
            '',
            '  const context = { db };',
            '  await writeAudit(context);',
            '  await db.insert(cartItems).values({ productId });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [
        { domain: 'audit', keys: null, site: 'cart.domain.ts:7', via: 'audit_log' },
        { domain: 'cart', keys: null, site: 'cart.domain.ts:12', via: 'cart_items' },
      ],
      unresolved: [],
    });
    expect(graph.writeAudit).toEqual({
      reads: [],
      touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:7', via: 'audit_log' }],
      unresolved: [],
    });
  });

  it('does not fold uncalled closure-local helper bodies into parent summaries', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {}, kovo({ domain: "audit", key: "productId" }));',
            '',
            'export async function addItem(db: PgDatabase, productId: string) {',
            '  async function writeAudit(db: PgDatabase) {',
            '    await db.insert(auditLog).values({ productId });',
            '  }',
            '  return productId;',
            '}',
            '',
            'export async function calledItem(db: PgDatabase, productId: string) {',
            '  async function writeCart(db: PgDatabase) {',
            '    await db.insert(cartItems).values({ productId });',
            '  }',
            '  await writeCart(db);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toBeUndefined();
    expect(graph.writeAudit).toEqual({
      reads: [],
      touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:8', via: 'audit_log' }],
      unresolved: [],
    });
    expect(graph.calledItem).toEqual({
      reads: [],
      touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:15', via: 'cart_items' }],
      unresolved: [],
    });
  });

  it('does not fold project closure-local helper summaries when the call omits a typed receiver', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {}, kovo({ domain: "audit", key: "productId" }));',
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
      touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:15', via: 'cart_items' }],
      unresolved: [],
    });
    expect(graph.writeAudit).toEqual({
      reads: [],
      touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:12', via: 'audit_log' }],
      unresolved: [],
    });
  });

  it('dedupes recursive helper summaries at a fixed point', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'async function insertCartItem(db: PgDatabase) {',
            '  await db.insert(cartItems).values({ productId: "p1" });',
            '  await retryInsert(db);',
            '}',
            '',
            'async function retryInsert(db: PgDatabase) {',
            '  await insertCartItem(db);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.insertCartItem?.touches).toEqual([
      { domain: 'cart', keys: null, site: 'cart.domain.ts:6', via: 'cart_items' },
    ]);
    expect(graph.retryInsert?.touches).toEqual([
      { domain: 'cart', keys: null, site: 'cart.domain.ts:6', via: 'cart_items' },
    ]);
  });

  it('extracts direct parameterized keys from update and delete eq predicates', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
          'delete(table: unknown): { where(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function updateProduct(db: PgDatabase, input: { id: string }, productId: string) {',
            '  await db.update(products).set({ reserved: true }).where(eq(products.id, input.id));',
            '  await db.delete(cartItems).where(eq(cartItems.cartId, productId));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      updateProduct: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'product.domain.ts:9',
            via: 'cart_items',
          },
          { domain: 'product', keys: 'arg:id', site: 'product.domain.ts:8', via: 'products' },
        ],
        unresolved: [],
      },
    });
  });

  it('does not infer parameterized keys from predicate text inside comments and strings', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function scrubPredicates(db: PgDatabase, id: string) {',
            '  await db.update(products).set({ note: ".where(eq(products.id, id))" });',
            '  await db.update(products).set({ /* .where(eq(products.id, id)) */ reserved: true });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.scrubPredicates?.touches).toEqual([
      { domain: 'product', keys: null, site: 'product.domain.ts:6', via: 'products' },
      { domain: 'product', keys: null, site: 'product.domain.ts:7', via: 'products' },
    ]);
  });

  it('does not fabricate non-eq predicate facts from string-contained column names', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { gt, sql } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function scrubPredicate(db: PgDatabase, productId: string) {',
            '  await db.update(products).set({ reserved: true }).where(gt(sql.raw("products.id"), productId));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      scrubPredicate: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'product.domain.ts:7', via: 'products' }],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
  });

  it('does not borrow predicates from following semicolonless write statements', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function syncProducts(db: PgDatabase, productId: string) {',
            '  await db.update(products).set({ reserved: true })',
            '  await db.update(products).set({ synced: true }).where(eq(products.id, productId))',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProducts: {
        reads: [],
        touches: [
          { domain: 'product', keys: null, site: 'product.domain.ts:7', via: 'products' },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('keeps non-key and table-column predicates at table-level', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void>; from(table: unknown): { where(value: unknown): Promise<void> } } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, kovo({ domain: "price", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {});',
            '',
            'export async function syncProduct(db: PgDatabase, productId: string) {',
            '  await db.update(products).set({ reserved: true }).where(eq(products.sku, productId));',
            '  await db.update(products).set({ price: prices.amount }).from(prices).where(eq(products.id, prices.productId));',
            '  await db.update(products).set({ audited: true }).where(eq(products.id, auditLog.id));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'price',
            keys: null,
            site: 'product.domain.ts:10',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          { domain: 'product', keys: null, site: 'product.domain.ts:9', via: 'products' },
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:10',
            via: 'products',
          },
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:11',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:10',
      },
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:11',
      },
    ]);
  });

  it('degrades compound key predicates to table-level invalidation', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq, or } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function syncProducts(db: PgDatabase, primaryId: string, fallbackId: string) {',
            '  await db.update(products).set({ reserved: true }).where(or(eq(products.id, primaryId), eq(products.id, fallbackId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProducts: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:7',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:7',
      },
    ]);
  });

  it('extracts bounded disjunctions as typed symbolic match alternatives', () => {
    const files = [
      pgDatabaseTypes([
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import { eq, or } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
          '',
          'export async function syncProducts(db: PgDatabase, primaryId: string, fallbackId: string) {',
          '  await db.update(products).set({ reserved: true }).where(or(eq(products.id, primaryId), eq(products.id, fallbackId)));',
          '}',
        ].join('\n'),
      },
    ];

    expect(extractSymbolicEffectsFromProject({ files }).map((fact) => fact.effect)).toEqual([
      {
        match: {
          arms: [
            { eq: [{ column: 'id', value: { kind: 'param', path: 'primaryId' } }] },
            { eq: [{ column: 'id', value: { kind: 'param', path: 'fallbackId' } }] },
          ],
          kind: 'or',
        },
        op: 'update',
        sets: { reserved: { kind: 'const', value: true } },
        table: 'products',
      },
    ]);
  });

  it('degrades mixed derivable/opaque disjunctions with a named reason', () => {
    const files = [
      pgDatabaseTypes([
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import { eq, gt, or } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
          '',
          'export async function syncProducts(db: PgDatabase, productId: string) {',
          '  await db.update(products).set({ reserved: true }).where(or(eq(products.id, productId), gt(products.stock, 0)));',
          '}',
        ].join('\n'),
      },
    ];

    expect(extractSymbolicEffectsFromProject({ files }).map((fact) => fact.effect)).toEqual([
      {
        match: {
          expr: 'or(eq(products.id, productId), gt(products.stock, 0))',
          kind: 'opaque',
          reason: {
            code: 'mixed-disjunction',
            expr: 'or(eq(products.id, productId), gt(products.stock, 0))',
          },
        },
        op: 'update',
        sets: { reserved: { kind: 'const', value: true } },
        table: 'products',
      },
    ]);
  });

  it('degrades row identity when an unsupported conjunction child affects membership', () => {
    const files = [
      pgDatabaseTypes([
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import { and, eq, gt } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(db: PgDatabase, productId: string) {',
          '  await db.update(products).set({ reserved: true }).where(and(eq(products.id, productId), gt(products.stock, 0)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });

    expect(graph.syncProduct?.touches).toEqual([
      {
        domain: 'product',
        keys: null,
        predicate: 'non-eq',
        site: 'product.domain.ts:7',
        via: 'products',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toMatchObject([
      { code: 'KV409', site: 'product.domain.ts:7' },
    ]);
    expect(extractSymbolicEffectsFromProject({ files }).map((fact) => fact.effect)).toEqual([
      {
        match: {
          expr: 'and(eq(products.id, productId), gt(products.stock, 0))',
          kind: 'opaque',
        },
        op: 'update',
        sets: { reserved: { kind: 'const', value: true } },
        table: 'products',
      },
    ]);
  });

  it('extracts composite parameter keys from and(eq(...)) predicates', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'user.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, kovo({ domain: "user", key: "id,tenantId" }));',
            '',
            'export async function syncUser(db: PgDatabase, id: string, tenantId: string) {',
            '  await db.update(users).set({ active: true }).where(and(eq(users.id, id), eq(users.tenantId, tenantId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncUser: {
        reads: [],
        touches: [
          {
            domain: 'user',
            keys: 'arg:id,arg:tenantId',
            site: 'user.domain.ts:7',
            via: 'users',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
  });

  it('degrades partial composite keys instead of treating them as exact-row', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'ticket.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const tickets = pgTable("tickets", {}, kovo({ domain: "ticket", key: "tenantId,id" }));',
            '',
            'export async function closeTicket(db: PgDatabase, id: string) {',
            '  await db.update(tickets).set({ status: "closed" }).where(eq(tickets.id, id));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      closeTicket: {
        reads: [],
        touches: [{ domain: 'ticket', keys: null, site: 'ticket.domain.ts:7', via: 'tickets' }],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
  });

  it('extracts session-scoped composite keys without exposing private scope', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const sessionId = request.session?.id;',
            '  if (!sessionId) throw new Error("auth required");',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      voteUp: {
        reads: [],
        touches: [
          {
            domain: 'question',
            keys: 'arg:targetId',
            site: 'question.domain.ts:9',
            via: 'questions',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
  });

  it('keeps guarded session aliases stable after server-side Drizzle write payload uses', () => {
    const files = [
      pgDatabaseTypes([
        'insert(table: unknown): { values(value: unknown): Promise<void> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'question.domain.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
          'export const votes = pgTable("votes", {}, kovo({ domain: "vote", key: "sessionId,id" }));',
          '',
          'export async function voteUp({ id, targetId, userId }: { id: string; targetId: string; userId: string }, db: PgDatabase, request: { session?: { id?: string } | null }) {',
          '  const sessionId = request.session?.id;',
          '  if (!sessionId) throw new Error("auth required");',
          '  await db.insert(votes).values({ sessionId, id, targetId, userId, value: 1 });',
          '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });
    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: 'arg:targetId',
        site: 'question.domain.ts:11',
        via: 'questions',
      },
      { domain: 'vote', keys: null, site: 'question.domain.ts:10', via: 'votes' },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
    expect(extractSymbolicEffectsFromProject({ files }).map((fact) => fact.effect)).toEqual([
      {
        op: 'insert',
        table: 'votes',
        values: {
          id: { kind: 'param', path: 'id' },
          sessionId: { kind: 'session', path: 'id' },
          targetId: { kind: 'param', path: 'targetId' },
          userId: { kind: 'param', path: 'userId' },
          value: { kind: 'const', value: 1 },
        },
      },
      {
        match: {
          eq: [
            { column: 'sessionId', value: { kind: 'session', path: 'id' } },
            { column: 'id', value: { kind: 'param', path: 'targetId' } },
          ],
          kind: 'keys',
        },
        op: 'update',
        sets: { score: { kind: 'const', value: 1 } },
        table: 'questions',
      },
    ]);
  });

  it('keeps guarded session aliases stable across repeated Drizzle predicate uses', () => {
    const files = [
      pgDatabaseTypes([
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'question.domain.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
          '',
          'export async function syncTwoQuestions(db: PgDatabase, request: { session?: { id?: string } | null }, firstId: string, secondId: string) {',
          '  const sessionId = request.session?.id;',
          '  if (!sessionId) throw new Error("auth required");',
          '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, firstId)));',
          '  await db.update(questions).set({ score: 2 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, secondId)));',
          '}',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files }).syncTwoQuestions?.touches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'question', keys: 'arg:firstId', via: 'questions' }),
        expect.objectContaining({ domain: 'question', keys: 'arg:secondId', via: 'questions' }),
      ]),
    );
    expect(extractSymbolicEffectsFromProject({ files }).map((fact) => fact.effect)).toMatchObject([
      {
        match: {
          eq: [
            { column: 'sessionId', value: { kind: 'session', path: 'id' } },
            { column: 'id', value: { kind: 'param', path: 'firstId' } },
          ],
          kind: 'keys',
        },
      },
      {
        match: {
          eq: [
            { column: 'sessionId', value: { kind: 'session', path: 'id' } },
            { column: 'id', value: { kind: 'param', path: 'secondId' } },
          ],
          kind: 'keys',
        },
      },
    ]);
  });

  it('accepts return exits as nullable session guards', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const sessionId = request.session?.id;',
            '  if (!sessionId) return;',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: 'arg:targetId',
        site: 'question.domain.ts:9',
        via: 'questions',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
  });

  it('accepts framework fail exits as nullable session guards', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'declare function fail(status: number): never;',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const sessionId = request.session?.id;',
            '  if (!sessionId) fail(401);',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: 'arg:targetId',
        site: 'question.domain.ts:10',
        via: 'questions',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
  });

  it('accepts direct nullable session access after a dominating guard', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  if (!request.session?.id) throw new Error("auth required");',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, request.session.id), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: 'arg:targetId',
        site: 'question.domain.ts:8',
        via: 'questions',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
  });

  it('degrades unguarded direct nullable session access', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, request.session.id), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:7',
        via: 'questions',
      },
    ]);
  });

  it('degrades direct nullable session access used before its guard', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const observed = request.session?.id;',
            '  if (!request.session?.id) throw new Error("auth required");',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, request.session.id), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:9',
        via: 'questions',
      },
    ]);
  });

  it('uses declared analyzer summaries for same-package session helper provenance', () => {
    const files = [
      pgDatabaseTypes([
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'question.domain.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
          '',
          'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
          '',
          'function requireSessionId(request: { session?: { id?: string } | null }) {',
          '  if (!request.session?.id) throw new Error("auth required");',
          '  return request.session.id;',
          '}',
          '',
          'kovoAnalyzerSummary(requireSessionId, { returns: { kind: "session", path: "id" } });',
          '',
          'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
          '  const sessionId = requireSessionId(request);',
          '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: 'arg:targetId',
        site: 'question.domain.ts:16',
        via: 'questions',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
    expect(extractSymbolicEffectsFromProject({ files }).map((fact) => fact.effect)).toEqual([
      {
        match: {
          eq: [
            { column: 'sessionId', value: { kind: 'session', path: 'id' } },
            { column: 'id', value: { kind: 'param', path: 'targetId' } },
          ],
          kind: 'keys',
        },
        op: 'update',
        sets: { score: { kind: 'const', value: 1 } },
        table: 'questions',
      },
    ]);
  });

  it('degrades nullable session aliases used before their guard', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const sessionId = request.session?.id;',
            '  const observed = sessionId;',
            '  if (!sessionId) throw new Error("auth required");',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:10',
        via: 'questions',
      },
    ]);
  });

  it('degrades unsummarized helpers returning private scope with a named opaque match', () => {
    const files = [
      pgDatabaseTypes([
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'question.domain.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
          '',
          'function requireSessionId(request: { session?: { id?: string } | null }) {',
          '  if (!request.session?.id) throw new Error("auth required");',
          '  return request.session.id;',
          '}',
          '',
          'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
          '  const sessionId = requireSessionId(request);',
          '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:13',
        via: 'questions',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toMatchObject([
      { code: 'KV409', site: 'question.domain.ts:13' },
    ]);
    expect(extractSymbolicEffectsFromProject({ files }).map((fact) => fact.effect)).toEqual([
      {
        match: { expr: 'unsummarized-helper:requireSessionId', kind: 'opaque' },
        op: 'update',
        sets: { score: { kind: 'const', value: 1 } },
        table: 'questions',
      },
    ]);
  });

  it('degrades guarded session aliases that escape before use', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'declare function audit(value: string): void;',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const sessionId = request.session?.id;',
            '  if (!sessionId) throw new Error("auth required");',
            '  audit(sessionId);',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:11',
        via: 'questions',
      },
    ]);
  });

  it('degrades guarded session aliases passed through async helper opacity', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'declare function normalize(value: string): Promise<string>;',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const sessionId = request.session?.id;',
            '  if (!sessionId) throw new Error("auth required");',
            '  await normalize(sessionId);',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:11',
        via: 'questions',
      },
    ]);
  });

  it('erases tenant helper summaries from visible composite keys', () => {
    const files = [
      pgDatabaseTypes([
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'ticket.domain.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
          '',
          'export const tickets = pgTable("tickets", {}, kovo({ domain: "ticket", key: "tenantId,id" }));',
          '',
          'function tenantId(request: { tenant?: { id?: string } | null }) {',
          '  if (!request.tenant?.id) throw new Error("tenant required");',
          '  return request.tenant.id;',
          '}',
          '',
          'kovoAnalyzerSummary(tenantId, { returns: { kind: "tenant", path: "id" } });',
          '',
          'export async function closeTicket(db: PgDatabase, request: { tenant?: { id?: string } | null }, targetId: string) {',
          '  const currentTenantId = tenantId(request);',
          '  await db.update(tickets).set({ status: "closed" }).where(and(eq(tickets.tenantId, currentTenantId), eq(tickets.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });

    expect(graph.closeTicket?.touches).toEqual([
      {
        domain: 'ticket',
        keys: 'arg:targetId',
        site: 'ticket.domain.ts:16',
        via: 'tickets',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
    expect(extractSymbolicEffectsFromProject({ files }).map((fact) => fact.effect)).toEqual([
      {
        match: {
          eq: [
            { column: 'tenantId', value: { kind: 'tenant', path: 'id' } },
            { column: 'id', value: { kind: 'param', path: 'targetId' } },
          ],
          kind: 'keys',
        },
        op: 'update',
        sets: { status: { kind: 'const', value: 'closed' } },
        table: 'tickets',
      },
    ]);
  });

  it('degrades guarded session aliases that are mutated before use', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  let sessionId = request.session?.id;',
            '  if (!sessionId) return;',
            '  sessionId += "";',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:10',
        via: 'questions',
      },
    ]);
  });

  it('degrades unguarded nullable session aliases instead of proving row identity', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const sessionId = request.session?.id;',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:8',
        via: 'questions',
      },
    ]);
  });

  it('degrades guarded session aliases that are reassigned before use', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgDatabase, request: { session?: { id?: string } | null }, targetId: string) {',
            '  let sessionId = request.session?.id;',
            '  if (!sessionId) return;',
            '  sessionId = targetId;',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:10',
        via: 'questions',
      },
    ]);
  });

  it('degrades eq predicates with non-parameter values to table-level invalidation', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function syncProduct(db: PgDatabase) {',
            '  const randomLocal = "p1";',
            '  await db.update(products).set({ reserved: true }).where(eq(products.id, randomLocal));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:8',
      },
    ]);
  });

  it('marks direct non-equality predicates as KV409 degraded table-level invalidation', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void>; from(table: unknown): { where(value: unknown): Promise<void> } } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { gt } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, kovo({ domain: "price", key: "productId" }));',
            '',
            'export async function syncProduct(db: PgDatabase, productId: string) {',
            '  await db.update(products).set({ reserved: true }).where(gt(products.id, productId));',
            '  await db.update(products).set({ price: prices.amount }).from(prices).where(gt(prices.productId, productId));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'price',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:9',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          { domain: 'product', keys: null, site: 'product.domain.ts:9', via: 'products' },
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:8',
      },
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:9',
      },
    ]);
  });

  it('resolves local Drizzle table aliases for writes, reads, and predicates', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'packages/drizzle/src/product.domain.ts',
          source: [
            'import { eq, gt } from "drizzle-orm";',
            'import { alias, integer, pgTable, text, type PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const prices = pgTable("prices", {',
            '  amount: integer("amount").notNull(),',
            '  productId: text("product_id").notNull(),',
            '}, kovo({ domain: "price", key: "productId" }));',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            'const priceAlias = alias(prices, "pr");',
            'const productAlias = alias(products, "p");',
            '',
            'export async function syncProduct(db: PgDatabase<any, any, any>, productId: string) {',
            '  await db.update(productAlias).set({ reserved: true }).where(eq(productAlias.id, productId));',
            '  await db.update(products).set({ price: priceAlias.amount }).from(priceAlias).where(gt(priceAlias.productId, productId));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'price',
            keys: null,
            predicate: 'non-eq',
            site: 'packages/drizzle/src/product.domain.ts:16',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'packages/drizzle/src/product.domain.ts:15',
            via: 'products',
          },
          {
            domain: 'product',
            keys: null,
            site: 'packages/drizzle/src/product.domain.ts:16',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'packages/drizzle/src/product.domain.ts:16',
      },
    ]);
  });

  it('does not resolve private table declarations through namespace imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.schema.ts',
          source: `
          const hiddenProducts = pgTable("hidden_products", {}, kovo({ domain: "hidden", key: "id" }));
          export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));
        `,
        },
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import * as schema from "./cart.schema";',
            '',
            'export async function syncProduct(db: PgDatabase, productId: string) {',
            '  await db.update(schema.hiddenProducts).set({ reserved: true }).where(eq(schema.hiddenProducts.id, productId));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:6',
          },
        ],
      },
    });
  });

  it('resolves project named import and re-export Drizzle schema aliases', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
          'delete(table: unknown): { where(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'schema.ts',
          source: `
            export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));
          `,
        },
        {
          fileName: 'tables.ts',
          source: `
            export { products as productTable } from "./schema";
          `,
        },
        {
          fileName: 'product.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";
            import { products as importedProducts } from "./schema";
            import { productTable } from "./tables";

            export async function syncProduct(db: PgDatabase, productId: string) {
              await db.update(importedProducts).set({ reserved: true }).where(eq(importedProducts.id, productId));
              await db.delete(productTable).where(eq(productTable.id, productId));
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:7',
            via: 'products',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('does not resolve project Drizzle schema aliases from comments, strings, or templates', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'schema.ts',
          source: `
            export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));
          `,
        },
        {
          fileName: 'product.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";
            const quoted = "import { products as importedProducts } from './schema';";
            // import * as schema from "./schema";

            export async function syncProduct(db: PgDatabase, productId: string) {
              const templated = \`import * as schema from "./schema";\`;
              await db.update(schema.products).set({ reserved: true }).where(eq(schema.products.id, productId));
              await db.update(importedProducts).set({ reserved: false }).where(eq(importedProducts.id, productId));
              return { quoted, templated };
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:8',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:9',
          },
        ],
      },
    });
  });
});
