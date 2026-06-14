import { describe, expect, it } from 'vitest';

import { extractTouchGraphFromProject, extractQueryFactsFromProject } from '@jiso/drizzle/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@jiso/drizzle touch graph helpers', () => {
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));',
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
            'export const auditLog = pgTable("audit_log", {}, jiso({ exempt: true }));',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
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
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
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

  it('recognizes project-mode pgTable initializers with jiso annotations as tables', () => {
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
            '}, jiso({ domain: "cart", key: "cartId" }));',
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
      '}, jiso({ domain: "product", key: "id" }));',
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
            '}, jiso({ domain: "cart", key: "cartId" }));',
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
});
