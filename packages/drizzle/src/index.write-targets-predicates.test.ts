import { describe, expect, it } from 'vitest';

import { eq, sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';

import {
  extractTouchGraphFromProject,
  jiso,
} from '@jiso/drizzle/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@jiso/drizzle touch graph helpers', () => {
  it('resolves imported table symbols instead of same-name tables from other modules', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.schema.ts',
          source: `
            export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'order.schema.ts',
          source: `
            export const items = pgTable("order_items", {}, jiso({ domain: "order", key: "id" }));
          `,
        },
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";
            import { items } from "./cart.schema";

            export async function addItem(db: PgDatabase, id: string) {
              await db.update(items).set({ id }).where(eq(items.id, id));
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
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('resolves namespace-imported project write targets from table symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.schema.ts',
          source: `
            export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'order.schema.ts',
          source: `
            export const items = pgTable("order_items", {}, jiso({ domain: "order", key: "id" }));
          `,
        },
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";
            import * as cartSchema from "./cart.schema";
            import * as orderSchema from "./order.schema";

            export async function addItem(db: PgDatabase, id: string) {
              await db.update(cartSchema.items).set({ id }).where(eq(cartSchema.items.id, id));
              const ignored = "db.update(orderSchema.items).set({ id })";
              return ignored;
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
            site: 'cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('resolves namespace static element-access project write targets from table symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.schema.ts',
          source: `
            export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";
            import * as cartSchema from "./cart.schema";

            export async function addItem(db: PgDatabase, id: string) {
              await db.update(cartSchema["items"]).set({ id }).where(eq(cartSchema["items"].id, id));
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
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('resolves namespace static element-access project write targets through re-export barrels', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.schema.ts',
          source: `
            export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'cart.tables.ts',
          source: `
            export { items as cartItems } from "./cart.schema";
          `,
        },
        {
          fileName: 'schema.ts',
          source: `
            export * from "./cart.tables";
          `,
        },
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";
            import * as schema from "./schema";

            export async function addItem(db: PgDatabase, id: string) {
              await db.update(schema["cartItems"]).set({ id }).where(eq(schema["cartItems"].id, id));
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
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('uses typed receiver origins for project static element-access writes', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '  update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb, productId: string) {',
            '  await db["insert"](cartItems).values({ productId });',
            '  await db["update"](cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
            '  await fake["insert"](cartItems).values({ productId });',
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
          { domain: 'cart', keys: null, site: 'cart.domain.ts:11', via: 'cart_items' },
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'cart.domain.ts:12',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('resolves project insert-select and update-from read sources from write call AST', () => {
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
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));',
            'export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));',
            '',
            'export async function syncSnapshots(db: PgDatabase, productId: string) {',
            '  await db.insert(snapshots).select(db.select().from(products).where(gt(sql.raw(".from(prices)"), 0)));',
            '  await db.update(products).set({ price: prices.amount }).from(prices).where(eq(products.id, productId));',
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
            site: 'product.domain.ts:9',
            source: 'update-from',
            via: 'prices',
          },
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:8',
            source: 'insert-select',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:9',
            via: 'products',
          },
          {
            domain: 'snapshot',
            keys: null,
            site: 'product.domain.ts:8',
            via: 'product_snapshots',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('does not borrow project write predicates from later writes in the same expression', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";

            export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

            export async function restock(db: PgDatabase, id: string) {
              await Promise.all([db.update(products).set({ stock: 1 }), db.update(products).set({ stock: 2 }).where(eq(products.id, id))]);
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:7',
            via: 'products',
          },
          {
            domain: 'product',
            keys: 'arg:id',
            site: 'product.domain.ts:7',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts project write predicate subquery read sources', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import { inArray } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", { id: text("id").primaryKey() }, jiso({ domain: "product", key: "id" }));',
            'export const cartItems = pgTable("cart_items", { productId: text("product_id").notNull() }, jiso({ domain: "cart", key: "productId" }));',
            '',
            'export async function reserveCartProducts(db: PgDatabase) {',
            '  await db.update(products).set({ reserved: true }).where(inArray(products.id, db.select({ productId: cartItems.productId }).from(cartItems)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      reserveCartProducts: {
        reads: [
          {
            domain: 'cart',
            keys: null,
            predicate: 'non-eq',
            site: 'cart.domain.ts:8',
            source: 'update-predicate',
            via: 'cart_items',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'cart.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('marks unresolved project write predicate subquery read sources as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import { inArray } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", { id: text("id").primaryKey() }, jiso({ domain: "product", key: "id" }));',
            '',
            'export async function reserveCartProducts(db: PgDatabase) {',
            '  await db.update(products).set({ reserved: true }).where(inArray(products.id, db.select().from(tableFor("cart_items"))));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      reserveCartProducts: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'cart.domain.ts:7',
            via: 'products',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Update predicate read source could not be resolved to a Drizzle table.',
            site: 'cart.domain.ts:7',
          },
        ],
      },
    });
  });

  it('extracts project delete predicate subquery read sources', () => {
    // SPEC §11.1: a `delete().where(subquery.from(R))` reads R; drizzle Postgres delete has no
    // `.from()`/`.using()` chain, so this is a `delete-predicate` source, not a silently dropped read.
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): Promise<void> };',
          'delete(table: unknown): { where(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import { inArray } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", { id: text("id").primaryKey() }, jiso({ domain: "product", key: "id" }));',
            'export const cartItems = pgTable("cart_items", { productId: text("product_id").notNull() }, jiso({ domain: "cart", key: "productId" }));',
            '',
            'export async function pruneOrphanedItems(db: PgDatabase) {',
            '  await db.delete(cartItems).where(inArray(cartItems.productId, db.select({ id: products.id }).from(products)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      pruneOrphanedItems: {
        reads: [
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'cart.domain.ts:8',
            source: 'delete-predicate',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'cart',
            keys: null,
            predicate: 'non-eq',
            site: 'cart.domain.ts:8',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('marks unresolved project delete predicate subquery read sources as FW406', () => {
    // SPEC §11.1: an opaque delete-predicate read source is visible as FW406, not guessed.
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): Promise<void> };',
          'delete(table: unknown): { where(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import { inArray } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", { productId: text("product_id").notNull() }, jiso({ domain: "cart", key: "productId" }));',
            '',
            'export async function pruneOrphanedItems(db: PgDatabase) {',
            '  await db.delete(cartItems).where(inArray(cartItems.productId, db.select().from(tableFor("products"))));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      pruneOrphanedItems: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            predicate: 'non-eq',
            site: 'cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Delete predicate read source could not be resolved to a Drizzle table.',
            site: 'cart.domain.ts:7',
          },
        ],
      },
    });
  });

  it('folds typed referenced project transaction callbacks through local summaries', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'transaction<T>(callback: (tx: PgDatabase<TQueryResultHKT, TFullSchema, TSchema>) => Promise<T>): Promise<T>;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            'export async function addItem(db: PgDatabase, productId: string) {',
            '  async function runInTx(tx: PgDatabase) {',
            '    await tx.update(cartItems).set({ productId });',
            '  }',
            '  await db.transaction(runInTx);',
            '}',
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
            site: 'cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      runInTx: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('marks unresolved referenced project transaction callbacks as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'transaction<T>(callback: (tx: PgDatabase<TQueryResultHKT, TFullSchema, TSchema>) => Promise<T>): Promise<T>;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            'export async function addItem(db: PgDatabase, productId: string) {',
            '  async function runInTx(writer: unknown) {',
            '    await writer.update(cartItems).set({ productId });',
            '  }',
            '  await db.transaction(runInTx);',
            '}',
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
            site: 'cart.domain.ts:7',
          },
        ],
      },
    });
  });

  it('marks project external helpers receiving a Drizzle receiver as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'declare function writeAudit(db: unknown, productId: string): Promise<void>;',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  await db.insert(cartItems).values({ productId });',
            '  await writeAudit(db, productId);',
            '}',
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
            site: 'cart.domain.ts:8',
            via: 'cart_items',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:9',
          },
        ],
      },
    });
  });

  it('marks project external helpers receiving factory-returned typed carriers as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {}',
            'declare function writeAudit(context: unknown): Promise<void>;',
            'declare function makeContext(): { nested: { db: PgDatabase<any, any, any> } };',
            'declare function makeFakeContext(): { nested: { db: FakeDb } };',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  void db;',
            '  void fake;',
            '  await writeAudit(makeFakeContext());',
            '  await writeAudit(makeContext());',
            '}',
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
            site: 'cart.domain.ts:12',
          },
        ],
      },
    });
  });

  it('marks project materialized-view refresh calls as FW406 instead of dropping the surface', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['refreshMaterializedView(view: unknown): Promise<void>;']),
        {
          fileName: 'catalog.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const productSearch = pgMaterializedView("product_search", {});',
            '',
            'export async function refreshCatalog(db: PgDatabase<any, any, any>) {',
            '  await db.refreshMaterializedView(productSearch);',
            '}',
          ].join('\n'),
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
            site: 'catalog.domain.ts:6',
          },
        ],
      },
    });
  });

  it('marks project unknown direct Drizzle receiver methods as FW406 instead of dropping them', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          '$with(name: string): unknown;',
          'batch(queries: unknown[]): Promise<unknown[]>;',
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'select(value?: unknown): { from(table: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
            '',
            'export async function syncUsers(db: PgDatabase<any, any, any>) {',
            '  await db.batch([db.select().from(users)]);',
            '  await db["$with"]("active_users");',
            '  await db.insert(users).values({});',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:6',
            source: 'select',
            via: 'users',
          },
        ],
        touches: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:8',
            via: 'users',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:6',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:7',
          },
        ],
      },
    });
  });

  it('does not mark shadowed project detached receiver method aliases', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<void>;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb { execute(query: unknown): Promise<void>; }',
            '',
            'export async function syncUsers(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  const { execute } = db;',
            '  {',
            '    const execute = fake.execute;',
            '    await execute("select 1");',
            '  }',
            '  await execute("select 1");',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
        ],
      },
    });
  });

  it('marks project static element-access raw and relational receiver calls as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<void>;', 'query: any;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
            '',
            'export async function loadUsers(db: PgDatabase<any, any, any>) {',
            "  await db['execute'](sql`update users set active = true`);",
            "  return db.query['users']['findFirst']({ where: eq(users.active, true) });",
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      loadUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:7',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:6',
          },
        ],
      },
    });
  });

  it('marks project template-literal element-access raw and relational receiver calls as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<void>;', 'query: any;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
            '',
            'export async function loadUsers(db: PgDatabase<any, any, any>) {',
            '  await db[`execute`](sql`update users set active = true`);',
            '  return db.query[`users`][`findFirst`]({ where: eq(users.active, true) });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      loadUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:7',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:6',
          },
        ],
      },
    });
  });

  it('marks project standalone direct select chains with unresolved tables as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<void> };']),
        {
          fileName: 'catalog.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export async function loadCatalog(db: PgDatabase<any, any, any>, tableName: string) {',
            '  await db.select().from(tableFor(tableName));',
            '}',
          ].join('\n'),
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
            site: 'catalog.domain.ts:4',
          },
        ],
      },
    });
  });

  it('extracts project standalone direct select chains from typed receivers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { leftJoin(table: unknown, on: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'catalog.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'export const vendors = pgTable("vendors", {}, jiso({ domain: "vendor", key: "id" }));',
            '',
            'export async function loadCatalog(reader: PgDatabase) {',
            '  await reader.select({ id: products.id }).from(products).leftJoin(vendors, eq(vendors.id, products.vendorId));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      loadCatalog: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'catalog.domain.ts:7',
            source: 'select',
            via: 'products',
          },
          {
            domain: 'vendor',
            keys: null,
            site: 'catalog.domain.ts:7',
            source: 'select',
            via: 'vendors',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
  });

});
