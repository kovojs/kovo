import { describe, expect, it } from 'vitest';

import { eq, sql } from 'drizzle-orm';
import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import {
  diagnosticsForTouchGraph,
  extractTouchGraphFromProject,
  extractQueryFactsFromProject,
  jiso,
} from '@jiso/drizzle/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@jiso/drizzle touch graph helpers', () => {
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
            }, jiso({ domain: "product", key: "id" }));

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

  it('derives project query result shape from the returned select', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const auditLog = pgTable("audit_log", {
              id: text("id").primaryKey(),
              message: text("message").notNull(),
            }, jiso({ domain: "audit", key: "id" }));
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
              name: text("name").notNull(),
            }, jiso({ domain: "product", key: "id" }));

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
            }, jiso({ domain: "product", key: "id" }));
            export const reviews = pgTable("reviews", {
              productId: text("product_id"),
              rating: integer("rating"),
            }, jiso({ domain: "review", key: "productId" }));

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
          }, jiso({ domain: "product", key: "id" }));
          export const reviews = pgTable("reviews", {
            productId: text("product_id"),
            rating: integer("rating"),
          }, jiso({ domain: "review", key: "productId" }));

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
            }, jiso({ domain: "product", key: "id" }));
            export const reviews = pgTable("reviews", {
              productId: text("product_id"),
              rating: integer("rating").notNull(),
            }, jiso({ domain: "review", key: "productId" }));

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
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));',
            'export const vendors = pgTable("vendors", {}, jiso({ domain: "vendor", key: "id" }));',
            'export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));',
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
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));',
            'export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'export const vendors = pgTable("vendors", {}, jiso({ domain: "vendor", key: "id" }));',
            'export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));',
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
            'export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
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
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
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
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
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
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
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
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));',
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
          { domain: 'product', keys: null, site: 'product.domain.ts:10', via: 'products' },
          { domain: 'product', keys: null, site: 'product.domain.ts:11', via: 'products' },
          { domain: 'product', keys: null, site: 'product.domain.ts:9', via: 'products' },
        ],
        unresolved: [],
      },
    });
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
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
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
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:7',
      },
    ]);
  });

  it('marks direct non-equality predicates as FW409 degraded table-level invalidation', () => {
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
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));',
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
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:8',
      },
      {
        code: 'FW409',
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
            '}, jiso({ domain: "price", key: "productId" }));',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, jiso({ domain: "product", key: "id" }));',
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
        code: 'FW409',
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
          const hiddenProducts = pgTable("hidden_products", {}, jiso({ domain: "hidden", key: "id" }));
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
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
            code: 'FW406',
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
            export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
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
            export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
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
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:8',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:9',
          },
        ],
      },
    });
  });

});
