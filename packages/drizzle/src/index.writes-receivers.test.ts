import { describe, expect, it } from 'vitest';

import {
  extractTouchGraphFromProject,
  extractQueryFactsFromProject,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle touch graph helpers', () => {
  it('extracts project-mode direct Drizzle write calls from typed function declarations', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>) {',
            '  await db.insert(cartItems).values({ productId: "p1" });',
            '  await db.update(products).set({ reserved: true });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          { domain: 'cart', keys: null, site: 'cart.domain.ts:7', via: 'cart_items' },
          { domain: 'product', keys: null, site: 'cart.domain.ts:8', via: 'products' },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts raw SQL write table allowlists from object-form write declarations', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<void>;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));',
            '',
            'export const cart = domain({',
            '  merge: write({ tables: ["cart_items"], touches: ["cart"], run: async (db: PgDatabase<any, any, any>) => {',
            '    await db.execute(sql`insert into cart_items (product_id) values (${("p1")})`);',
            '  } }),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.merge': {
        reads: [],
        tables: ['cart_items'],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:7',
          },
        ],
      },
    });
  });

  it('does not accept app-local PgDatabase classes as Drizzle receivers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'cart.domain.ts',
          source: [
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));',
            '',
            'class PgDatabase {',
            '  insert(_table: unknown) {',
            '    return { values(_value: unknown) { return Promise.resolve(); } };',
            '  }',
            '}',
            '',
            'export async function addItem(db: PgDatabase) {',
            '  await db.insert(cartItems).values({ productId: "p1" });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({});
  });

  it('defaults unannotated pgTable writes to same-name domains', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const carts = pgTable("carts", {});',
            '',
            'export async function addCart(db: PgDatabase<any, any, any>) {',
            '  await db.insert(carts).values({ id: "c1" });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addCart: {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:6', via: 'carts' }],
        unresolved: [],
      },
    });
  });

  it('emits KV404 for resolved unannotated pgTable writes without a static table name', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'audit.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'const tableName = "audit_log";',
            'export const auditLog = pgTable(tableName, {});',
            '',
            'export async function writeAudit(db: PgDatabase<any, any, any>) {',
            '  await db.insert(auditLog).values({ id: "a1" });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      writeAudit: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV404',
            message: 'Write to unmapped table.',
            site: 'audit.domain.ts:6',
          },
        ],
      },
    });
  });

  it('extracts project-mode direct Drizzle write calls from typed arrow handlers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export const addItem = async (db: PgDatabase<any, any, any>) => {',
            '  await db.insert(cartItems).values({ productId: "p1" });',
            '  await db.update(products).set({ reserved: true });',
            '};',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          { domain: 'cart', keys: null, site: 'cart.domain.ts:7', via: 'cart_items' },
          { domain: 'product', keys: null, site: 'cart.domain.ts:8', via: 'products' },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts project-mode writes from typed functions with parenthesized parameter initializers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'declare function makeDb(): PgDatabase<any, any, any>;',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));',
            '',
            'export function addItem(db: PgDatabase<any, any, any> = makeDb()) {',
            '  return db.insert(cartItems).values({ productId: "p1" });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:7', via: 'cart_items' }],
        unresolved: [],
      },
    });
  });

  it('marks project-mode typed destructured receiver writes as real table touches', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'interface Ctx { db: PgDatabase }',
            'declare function makeContext(): Ctx;',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'export async function addItem({ db: writer }: Ctx = makeContext(), productId: string) {',
            '  await writer.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
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
            keys: 'arg:productId',
            site: 'cart.domain.ts:8',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts project-mode expression-bodied arrow write handlers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));',
            '',
            'export const addItem = (db: PgDatabase<any, any, any>) => db.insert(cartItems).values({ productId: "p1" });',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:5', via: 'cart_items' }],
        unresolved: [],
      },
    });
  });

  it('omits write-side-only exempt table writes from the project touch graph', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const auditLog = pgTable("audit_log", {}, kovo({ exempt: true }));',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function restockProduct(db: PgDatabase<any, any, any>) {',
            '  await db.insert(auditLog).values({ event: "restock" });',
            '  await db.update(products).set({ stock: 10 });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      restockProduct: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'product.domain.ts:8', via: 'products' }],
        unresolved: [],
      },
    });
  });

  it('extracts project-mode writes from typed variable-assigned mutation handlers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
          'delete(table: unknown): Promise<void>;',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export const restockProduct = async function (db: PgDatabase<any, any, any>) {',
            '  await db.update(products).set({ stock: 10 });',
            '};',
            'export let addItem = async (db: PgDatabase<any, any, any>) => {',
            '  await db.insert(cartItems).values({ productId: "p1" });',
            '};',
            'export var removeProduct = async function removeProduct(db: PgDatabase<any, any, any>) {',
            '  await db.delete(products);',
            '};',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:10', via: 'cart_items' }],
        unresolved: [],
      },
      removeProduct: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'cart.domain.ts:13', via: 'products' }],
        unresolved: [],
      },
      restockProduct: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'cart.domain.ts:7', via: 'products' }],
        unresolved: [],
      },
    });
  });

  it('derives child touches from Drizzle foreign-key cascade actions', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'delete(table: unknown): Promise<void>;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            'export const cartItems = pgTable("cart_items", {',
            '  id: text("id").primaryKey(),',
            '  productId: text("product_id").references(() => products.id, { onDelete: "cascade", onUpdate: "set null" }),',
            '}, kovo({ domain: "cart", key: "id" }));',
            '',
            'export const removeProduct = async (db: PgDatabase<any, any, any>) => {',
            '  await db.delete(products);',
            '};',
            'export const renameProduct = async (db: PgDatabase<any, any, any>) => {',
            '  await db.update(products).set({ id: "p2" });',
            '};',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      removeProduct: {
        reads: [],
        touches: [
          { domain: 'cart', keys: null, site: 'cart.domain.ts:12', via: 'cart_items' },
          { domain: 'product', keys: null, site: 'cart.domain.ts:12', via: 'products' },
        ],
        unresolved: [],
      },
      renameProduct: {
        reads: [],
        touches: [
          { domain: 'cart', keys: null, site: 'cart.domain.ts:15', via: 'cart_items' },
          { domain: 'product', keys: null, site: 'cart.domain.ts:15', via: 'products' },
        ],
        unresolved: [],
      },
    });
  });

  // SPEC §11.1 (part-4 D2): a CASCADE child is itself deleted, so the DB re-fires
  // that child's own ON DELETE CASCADE FKs — the fan-out is a transitive closure.
  it('follows multi-level (a→b→c) CASCADE chains as a transitive closure', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['delete(table: unknown): Promise<void>;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const a = pgTable("a", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "adom", key: "id" }));',
            'export const b = pgTable("b", {',
            '  id: text("id").primaryKey(),',
            '  aId: text("a_id").references(() => a.id, { onDelete: "cascade" }),',
            '}, kovo({ domain: "bdom", key: "id" }));',
            'export const c = pgTable("c", {',
            '  id: text("id").primaryKey(),',
            '  bId: text("b_id").references(() => b.id, { onDelete: "cascade" }),',
            '}, kovo({ domain: "cdom", key: "id" }));',
            '',
            'export const wipe = async (db: PgDatabase<any, any, any>) => {',
            '  await db.delete(a);',
            '};',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      wipe: {
        reads: [],
        touches: [
          { domain: 'adom', keys: null, site: 'cart.domain.ts:16', via: 'a' },
          { domain: 'bdom', keys: null, site: 'cart.domain.ts:16', via: 'b' },
          { domain: 'cdom', keys: null, site: 'cart.domain.ts:16', via: 'c' },
        ],
        unresolved: [],
      },
    });
  });

  // SPEC §11.1 (part-4 D2): the transitive closure must terminate on FK cycles.
  it('terminates the CASCADE closure on a foreign-key cycle', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['delete(table: unknown): Promise<void>;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const a = pgTable("a", {',
            '  id: text("id").primaryKey(),',
            '  bId: text("b_id").references((): any => b.id, { onDelete: "cascade" }),',
            '}, kovo({ domain: "adom", key: "id" }));',
            'export const b = pgTable("b", {',
            '  id: text("id").primaryKey(),',
            '  aId: text("a_id").references(() => a.id, { onDelete: "cascade" }),',
            '}, kovo({ domain: "bdom", key: "id" }));',
            '',
            'export const wipe = async (db: PgDatabase<any, any, any>) => {',
            '  await db.delete(a);',
            '};',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      wipe: {
        reads: [],
        touches: [
          { domain: 'adom', keys: null, site: 'cart.domain.ts:13', via: 'a' },
          { domain: 'bdom', keys: null, site: 'cart.domain.ts:13', via: 'b' },
        ],
        unresolved: [],
      },
    });
  });

  it('unions declared trigger fan-out domains into project-mode writes', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id", fans: [{ via: "price_rules", domain: "price", when: "update" }] }));',
            '',
            'export const renameProduct = async (db: PgDatabase<any, any, any>) => {',
            '  await db.update(products).set({ id: "p2" });',
            '};',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      renameProduct: {
        reads: [],
        touches: [
          { domain: 'price', keys: null, site: 'product.domain.ts:8', via: 'price_rules' },
          { domain: 'product', keys: null, site: 'product.domain.ts:8', via: 'products' },
        ],
        unresolved: [],
      },
    });
  });

  it('reports KV413 when a detected trigger lacks a declared fan-out', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            'const triggerDdl = sql`CREATE TRIGGER product_price_fanout AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION sync_price_rules()`;',
            '',
            'export const renameProduct = async (db: PgDatabase<any, any, any>) => {',
            '  await db.update(products).set({ id: "p2" });',
            '};',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      renameProduct: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'product.domain.ts:9', via: 'products' }],
        unresolved: [
          {
            code: 'KV413',
            domain: 'product',
            message: 'Database engine side-effect needs a declared fan-out.',
            site: 'product.domain.ts:9',
          },
        ],
      },
    });
  });

  it('recognizes project-mode pgTable initializers with kovo annotations as tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {',
            '  cartId: text("cart_id"),',
            '}, kovo({ domain: "cart", key: "cartId" }));',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>) {',
            '  await db.insert(cartItems).values({ productId: "p1" });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:8', via: 'cart_items' }],
        unresolved: [],
      },
    });
  });

  it('resolves project-mode Postgres namespace table factories from real import symbols', () => {
    const source = [
      'import * as pg from "drizzle-orm/pg-core";',
      'import type { PgDatabase } from "drizzle-orm/pg-core";',
      '',
      'export const products = pg.pgTable("products", {',
      '  id: pg.text("id").primaryKey(),',
      '  stock: pg.integer("stock").notNull(),',
      '}, kovo({ domain: "product", key: "id" }));',
      '',
      'export async function restock(db: PgDatabase<any, any, any>, productId: string) {',
      '  await db.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
      '}',
      '',
      'export const productQuery = query("product/namespace-factory", {',
      '  load(input, db: PgDatabase<any, any, any>) {',
      '    return db.select({ id: products.id, stock: products.stock }).from(products).where(eq(products.id, input.id));',
      '  },',
      '});',
    ].join('\n');

    expect(
      extractTouchGraphFromProject({ files: [{ fileName: 'product.domain.ts', source }] }),
    ).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:10',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(
      extractQueryFactsFromProject({ files: [{ fileName: 'product.domain.ts', source }] }),
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
          stock: 'number',
        },
        site: 'product.domain.ts:13',
      },
    ]);
  });

  it('extracts project-mode writes through real Drizzle table receivers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {',
            '  cartId: text("cart_id"),',
            '}, kovo({ domain: "cart", key: "cartId" }));',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, cartId: string) {',
            '  await db.update(cartItems).set({ touched: true }).where(eq(cartItems.cartId, cartId));',
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
            keys: 'arg:cartId',
            site: 'cart.domain.ts:8',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  // SPEC §11.1 (part-4 D1): CTE-prefixed writes `db.with(cte).update/insert/delete(t)`
  // resolve the write receiver through chained `.with()` so the write still touches the
  // domain (previously the CallExpression receiver was rejected → no touch, no KV406).
  it('records CTE-prefixed writes (db.with(cte).update(t)) through the chained .with() receiver', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'with(cte: unknown): { update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function reprice(db: PgDatabase<any, any, any>, id: string, cte: unknown) {',
            '  await db.with(cte).update(products).set({ price: 1 }).where(eq(products.id, id));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      reprice: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:id',
            site: 'cart.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('records CTE-prefixed inserts and deletes through chained .with()', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'with(cte: unknown): { insert(table: unknown): { values(value: unknown): Promise<void> }; delete(table: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function fill(db: PgDatabase<any, any, any>, cte: unknown) {',
            '  await db.with(cte).insert(cartItems).values({ productId: "p1" });',
            '  await db.with(cte).delete(products);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      fill: {
        reads: [],
        touches: [
          { domain: 'cart', keys: null, site: 'cart.domain.ts:7', via: 'cart_items' },
          { domain: 'product', keys: null, site: 'cart.domain.ts:8', via: 'products' },
        ],
        unresolved: [],
      },
    });
  });
});
