import { describe, expect, it } from 'vitest';

import {
  diagnosticsForQueryFacts,
  extractAlgebraicShapesFromProject,
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
  revealFactsFromQueryFacts,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, sqliteDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

const extractQueryFactsFromProject = (
  options: Parameters<typeof extractQueryFactsFromProjectBase>[0],
) => extractQueryFactsFromProjectBase(withPgDatabaseTypes(options));

// Part-4 Lane C — algebraic field classification (SPEC §10.5 Stage 2).
const ITEMS_C_TABLE = [
  "export const items = pgTable('items', {",
  "  id: text('id').primaryKey(),",
  "  cartId: text('cart_id'),",
  "  assignee: text('assignee'),",
  "  qty: integer('qty'),",
  "}, kovo({ domain: 'item', key: 'id' }));",
].join('\n');

const C_COMMON_IMPORTS = [
  "import { and, count, eq, sum } from 'drizzle-orm';",
  "import { integer, pgTable, text, type PgAsyncDatabase } from 'drizzle-orm/pg-core';",
  '',
].join('\n');

function singleAlgebraicField(...lines: string[]) {
  const shapes = extractAlgebraicShapesFromProject({
    files: [{ fileName: 'lane-c.query.ts', source: lines.join('\n') }],
  });
  const shape = shapes[0];
  if (!shape) throw new Error('expected an extracted AlgebraicQueryShape');
  const field = shape.fields.f;
  if (!field) throw new Error('expected field "f"');
  return field;
}

describe('@kovojs/drizzle touch graph helpers', () => {
  it('extracts project query result shapes, read domains, and instance keys from joined Drizzle selects', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { innerJoin(table: unknown, on: unknown): { where(value: unknown): Promise<unknown[]> } } };',
        ]),
        {
          fileName: 'cart.queries.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", { cartId: text("cart_id").notNull(), productId: text("product_id").notNull(), qty: integer("qty").notNull() }, kovo({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", { id: text("id").primaryKey() }, kovo({ domain: "product", key: "id" }));',
            '',
            'export const cartQuery = query("cart", {',
            '  output: s.object({ count: s.number() }),',
            // SPEC §10.2: an opaque sql<T>/raw projection must declare the tables it reads.
            '  reads: [cartItems, products],',
            '  async load(input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      count: sql<number>`count(*)`,',
            '      productId: products.id,',
            '      item: {',
            '        qty: cartItems.qty,',
            '      },',
            '    }).from(cartItems).innerJoin(products, eq(products.id, cartItems.productId)).where(eq(cartItems.cartId, input.cartId));',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        hasClientArgPredicate: true,
        instanceKey: {
          domain: 'cart',
          key: 'arg:cartId',
        },
        query: 'cart',
        reads: ['cart', 'product'],
        shape: {
          count: 'number',
          item: {
            qty: 'number',
          },
          productId: 'string',
        },
        site: 'cart.queries.ts:6',
      },
    ]);
  });

  it('recognizes typed sql projections imported from drizzle-orm as declared output shape', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: [
            'import { sql } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", { id: text("id").primaryKey() }, kovo({ domain: "cart", key: "id" }));',
            'export const cartQuery = query("cart/count", {',
            '  output: s.object({ count: s.number() }),',
            '  reads: [cartItems],',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({ count: sql<number>`count(*)` }).from(cartItems);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'cart/count',
        reads: ['cart'],
        shape: { count: 'number' },
        site: 'cart.queries.ts:5',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('recognizes typed sql projections through aliases, namespaces, local aliases, and barrels', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'sql-barrel.ts',
          source: 'export { sql as barrelSql } from "drizzle-orm";',
        },
        {
          fileName: 'cart.queries.ts',
          source: [
            'import { sql as aliasedSql } from "drizzle-orm";',
            'import * as orm from "drizzle-orm";',
            'import { barrelSql } from "./sql-barrel";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'const localSql = aliasedSql;',
            'export const cartItems = pgTable("cart_items", { id: text("id").primaryKey() }, kovo({ domain: "cart", key: "id" }));',
            'export const cartQuery = query("cart/counts", {',
            '  output: s.object({ aliasCount: s.number(), namespaceCount: s.number(), localCount: s.number(), barrelCount: s.number() }),',
            '  reads: [cartItems],',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      aliasCount: aliasedSql<number>`count(*)`,',
            '      namespaceCount: orm.sql<number>`count(*)`,',
            '      localCount: localSql<number>`count(*)`,',
            '      barrelCount: barrelSql<number>`count(*)`,',
            '    }).from(cartItems);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
    expect(facts[0]?.shape).toEqual({
      aliasCount: 'number',
      barrelCount: 'number',
      localCount: 'number',
      namespaceCount: 'number',
    });
  });

  it('recognizes Kovo SQL projections through catalog-backed root aliases and barrels', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'kovo-sql-barrel.ts',
          source: 'export { sql as brandedSql } from "@kovojs/drizzle";',
        },
        {
          fileName: 'cart.queries.ts',
          source: [
            'import { sql as kovoSql } from "@kovojs/drizzle";',
            'import * as kovoDrizzle from "@kovojs/drizzle";',
            'import { brandedSql } from "./kovo-sql-barrel";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", { id: text("id").primaryKey() }, kovo({ domain: "cart", key: "id" }));',
            'export const cartQuery = query("cart/kovo-counts", {',
            '  output: s.object({ aliasCount: s.number(), namespaceCount: s.number(), barrelCount: s.number() }),',
            '  reads: [cartItems],',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      aliasCount: kovoSql<number>`count(*)`,',
            '      namespaceCount: kovoDrizzle.sql<number>`count(*)`,',
            '      barrelCount: brandedSql<number>`count(*)`,',
            '    }).from(cartItems);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
    expect(facts[0]?.shape).toEqual({
      aliasCount: 'number',
      barrelCount: 'number',
      namespaceCount: 'number',
    });
  });

  it('keeps a local sql shadow fail-closed even when the real import is present', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: [
            'import { sql as realSql } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'function sql<T>(_strings: TemplateStringsArray): T { return 0 as T; }',
            'export const cartItems = pgTable("cart_items", { id: text("id").primaryKey() }, kovo({ domain: "cart", key: "id" }));',
            'export const cartQuery = query("cart/counts", {',
            '  output: s.object({ safeCount: s.number(), shadowCount: s.number() }),',
            '  reads: [cartItems],',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      safeCount: realSql<number>`count(*)`,',
            '      shadowCount: sql<number>`count(*)`,',
            '    }).from(cartItems);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts[0]?.shape).toEqual({ safeCount: 'number' });
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV406',
        message: expect.stringContaining(
          'Query projection cart/counts.shadowCount could not be resolved',
        ),
        severity: 'error',
        site: 'cart.queries.ts:6',
      },
    ]);
  });

  it('extracts project query facts from Drizzle distinct selects', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes([
          'selectDistinct(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          'selectDistinctOn(on: unknown, value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        ]),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  name: text("name").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'export const distinctProducts = query("products/distinct", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.selectDistinct({ name: products.name }).from(products);',
            '  },',
            '});',
            '',
            'export const firstProductNames = query("products/distinct-on", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.selectDistinctOn([products.id], { id: products.id, name: products.name }).from(products);',
            '  },',
            '});',
          ].join('\n'),
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
        site: 'product.queries.ts:8',
      },
      {
        query: 'products/distinct-on',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'product.queries.ts:14',
      },
    ]);
  });

  it('extracts pgEnum and text array column shapes from project-mode selects', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'orders.queries.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'const orderStatus = pgEnum("order_status", ["open", "closed"]);',
            'export const orders = pgTable("orders", {',
            '  id: text("id").primaryKey(),',
            '  status: orderStatus("status").notNull(),',
            '  tags: text("tags").array().notNull(),',
            '}, kovo({ domain: "order", key: "id" }));',
            '',
            'export const orderList = query("orders/list", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({ status: orders.status, tags: orders.tags }).from(orders);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'orders/list',
        reads: ['order'],
        shape: {
          status: 'string',
          tags: ['string'],
        },
        site: 'orders.queries.ts:10',
      },
    ]);
  });

  it('extracts s.record output schemas as object-shaped JSON', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'settings.queries.ts',
          source: [
            'export const settings = pgTable("settings", { id: text("id").primaryKey() }, kovo({ domain: "settings", key: "id" }));',
            '',
            'export const settingsQuery = query("settings", {',
            '  output: s.object({ attributes: s.record(s.string()) }),',
            '  reads: [settings],',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({ attributes: sql<Record<string, string>>`attributes` }).from(settings);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'settings',
        shape: {
          attributes: 'object',
        },
        reads: ['settings'],
        site: 'settings.queries.ts:3',
      },
    ]);
  });

  it('recognizes output schema receivers by identity and rejects local shadows', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'schema-api.ts',
          source: 'export { s as schema } from "@kovojs/server/api/data";',
        },
        {
          fileName: 'cart.queries.ts',
          source: [
            'import { sql } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'import { schema } from "./schema-api";',
            'import * as data from "@kovojs/server/api/data";',
            '',
            'const schemaAlias = schema;',
            'const s = { object: (value: unknown) => value, number: () => "number" };',
            'export const cartItems = pgTable("cart_items", { id: text("id").primaryKey() }, kovo({ domain: "cart", key: "id" }));',
            '',
            'export const aliasQuery = query("cart/alias", {',
            '  output: schemaAlias.object({ count: schema.number() }),',
            '  reads: [cartItems],',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({ count: sql`count(*)` }).from(cartItems);',
            '  },',
            '});',
            '',
            'export const namespaceQuery = query("cart/namespace", {',
            '  output: data.s.object({ count: data.s.number() }),',
            '  reads: [cartItems],',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({ count: sql`count(*)` }).from(cartItems);',
            '  },',
            '});',
            '',
            'export const shadowQuery = query("cart/shadow", {',
            '  output: s.object({ count: s.number() }),',
            '  reads: [cartItems],',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({ count: sql`count(*)` }).from(cartItems);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ query: 'cart/alias', shape: { count: 'number' } }),
        expect.objectContaining({ query: 'cart/namespace', shape: { count: 'number' } }),
      ]),
    );
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV410',
        message:
          'Opaque query projection requires a declared output schema. cart/shadow.count uses sql/raw projection without output.',
        severity: 'error',
        site: 'cart.queries.ts:26',
      },
    ]);
  });

  it('marks read-only table domains on extracted query facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'notes.queries.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const notes = pgTable("notes", {',
            '  id: text("id").primaryKey(),',
            '  body: text("body").notNull(),',
            '}, kovo({ domain: "note", key: "id", readOnly: true }));',
            '',
            'export const noteIndex = query("notes/index", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({ body: notes.body }).from(notes);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'notes/index',
        reads: ['note'],
        readOnlyDomains: ['note'],
        shape: {
          body: 'string',
        },
        site: 'notes.queries.ts:8',
      },
    ]);
  });

  it('marks declared Domain reads immutable only when every project table in that domain is read-only', () => {
    const facts = (includeWritableSibling: boolean) =>
      extractQueryFactsFromProject({
        files: [
          {
            fileName: 'notes.queries.ts',
            source: `
              import { domain, query, s } from '@kovojs/server';
              export const notes = pgTable('notes', {
                id: text('id').primaryKey(),
              }, kovo({ domain: 'note', key: 'id', readOnly: true }));
              ${
                includeWritableSibling
                  ? `export const noteDrafts = pgTable('note_drafts', {
                       id: text('id').primaryKey(),
                     }, kovo({ domain: 'note', key: 'id' }));`
                  : ''
              }
              const noteDomain = domain('note');
              export const noteIndex = query('notes/declared-domain', {
                output: s.object({ items: s.array(s.string()) }),
                reads: [noteDomain],
                load() { return { items: [] }; },
              });
            `,
          },
        ],
      });

    expect(facts(false)).toEqual([
      expect.objectContaining({
        query: 'notes/declared-domain',
        readOnlyDomains: ['note'],
        reads: ['note'],
      }),
    ]);
    expect(facts(true)).toEqual([
      expect.not.objectContaining({ readOnlyDomains: expect.anything() }),
    ]);
  });

  it('extracts project query instance keys from static element access predicates', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        ]),
        {
          fileName: 'cart.queries.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {',
            '  cartId: text("cart_id").notNull(),',
            '  qty: integer("qty").notNull(),',
            '}, kovo({ domain: "cart", key: "cartId" }));',
            '',
            'export const cartQuery = query("cart", {',
            '  load(input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      qty: cartItems.qty,',
            '    }).from(cartItems).where(eq(cartItems["cartId"], input["cartId"]));',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        hasClientArgPredicate: true,
        instanceKey: {
          domain: 'cart',
          key: 'arg:cartId',
        },
        query: 'cart',
        reads: ['cart'],
        shape: {
          qty: 'number',
        },
        site: 'cart.queries.ts:8',
      },
    ]);
  });

  it('derives public instance keys from guarded session-scoped composite query predicates', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        ]),
        {
          fileName: 'question.queries.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'import { query } from "@kovojs/server";',
            '',
            'export const questions = pgTable("questions", {',
            '  sessionId: text("session_id").notNull(),',
            '  id: text("id").notNull(),',
            '  title: text("title").notNull(),',
            '}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export const questionDetail = query("questionDetail", {',
            '  load(input: { id: string }, context: { db: PgAsyncDatabase<any, any>; request: { session: { id: string } } }) {',
            '    return context.db.select({ title: questions.title }).from(questions).where(and(eq(questions.sessionId, context.request.session.id), eq(questions.id, input.id)));',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        hasClientArgPredicate: true,
        instanceKey: {
          domain: 'question',
          key: 'arg:id',
        },
        query: 'questionDetail',
        reads: ['question'],
        sessionAnchoredReads: ['question'],
        shape: {
          title: 'string',
        },
        site: 'question.queries.ts:11',
      },
    ]);
  });

  it('resolves namespace-imported project query projection shapes from table symbols', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.schema.ts',
          source: `
            export const products = pgTable("cart_products", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'order.schema.ts',
          source: `
            export const products = pgTable("order_products", {
              id: integer("id").primaryKey(),
            }, kovo({ domain: "order", key: "id" }));
          `,
        },
        {
          fileName: 'cart.queries.ts',
          source: `
            import * as cartSchema from "./cart.schema";

            export const cartProductQuery = query("cart/product", {
              load(input, db: PgAsyncDatabase<any, any>) {
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
        hasClientArgPredicate: true,
        instanceKey: {
          domain: 'cart',
          key: 'arg:id',
        },
        query: 'cart/product',
        reads: ['cart'],
        shape: {
          id: 'string',
        },
        site: 'cart.queries.ts:4',
      },
    ]);
  });

  it('resolves namespace static element-access project query tables from symbols', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.schema.ts',
          source: `
            export const products = pgTable("cart_products", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'cart.queries.ts',
          source: `
            import * as cartSchema from "./cart.schema";

            export const cartProductQuery = query("cart/product", {
              load(input, db: PgAsyncDatabase<any, any>) {
                return db.select({
                  id: cartSchema["products"].id,
                }).from(cartSchema["products"]).where(eq(cartSchema["products"].id, input.id));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        hasClientArgPredicate: true,
        instanceKey: {
          domain: 'cart',
          key: 'arg:id',
        },
        query: 'cart/product',
        reads: ['cart'],
        shape: {
          id: 'string',
        },
        site: 'cart.queries.ts:4',
      },
    ]);
  });

  it('resolves namespace-imported project query tables through re-export barrels', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.schema.ts',
          source: `
            export const products = pgTable("cart_products", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'cart.tables.ts',
          source: `
            export { products as cartProducts } from "./cart.schema";
          `,
        },
        {
          fileName: 'schema.ts',
          source: `
            export * from "./cart.tables";
          `,
        },
        {
          fileName: 'cart.queries.ts',
          source: `
            import * as schema from "./schema";

            export const cartProductQuery = query("cart/product", {
              load(input, db: PgAsyncDatabase<any, any>) {
                return db.select({
                  id: schema["cartProducts"].id,
                }).from(schema.cartProducts).where(eq(schema.cartProducts.id, input.id));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        hasClientArgPredicate: true,
        instanceKey: {
          domain: 'cart',
          key: 'arg:id',
        },
        query: 'cart/product',
        reads: ['cart'],
        shape: {
          id: 'string',
        },
        site: 'cart.queries.ts:4',
      },
    ]);
  });

  it('reports KV411 when a query read set includes an exempt table', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const auditLog = pgTable("audit_log", { message: text("message").notNull(), productId: text("product_id").notNull() }, kovo({ exempt: true }));
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            async load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                message: auditLog.message,
                name: products.name,
              }).from(products).leftJoin(auditLog, eq(auditLog.productId, products.id));
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
            code: 'KV411',
            message: 'Query read set includes an exempt table. Tables: audit_log.',
            severity: 'error',
            site: 'product.queries.ts:5',
          },
        ],
        query: 'product',
        reads: ['product'],
        shape: {
          message: {
            kind: 'nullable',
            shape: 'string',
          },
          name: 'string',
        },
        site: 'product.queries.ts:5',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV411',
        message: 'Query read set includes an exempt table. Tables: audit_log.',
        severity: 'error',
        site: 'product.queries.ts:5',
      },
    ]);
  });

  it('derives view read sets and reports KV412 for unmodeled materialized views', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "product", key: "id" }));
          export const productSearch = pgView("product_search").as((qb) => qb.select({ name: products.name }).from(products));
          export const productStats = pgMaterializedView("product_stats").as((qb) => qb.select({ productId: sql<string>\`product_id\` }));

          export const searchQuery = query("search", {
            output: s.object({ name: s.string() }),
            reads: [productSearch],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ name: sql<string>\`name\` })
                .from(productSearch)
                .leftJoin(productStats, eq(productStats.productId, productSearch.id));
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
            code: 'KV412',
            message:
              'Query reads an unmodeled relation. materialized-view product_stats has no derived or declared domain.',
            severity: 'error',
            site: 'product.queries.ts:9',
          },
        ],
        query: 'search',
        reads: ['product'],
        shape: {
          name: 'string',
        },
        site: 'product.queries.ts:9',
      },
    ]);
    expect(
      diagnosticsForQueryFacts(facts).map(({ code, message, severity }) => ({
        code,
        message,
        severity,
      })),
    ).toEqual([
      {
        code: 'KV412',
        message:
          'Query reads an unmodeled relation. materialized-view product_stats has no derived or declared domain.',
        severity: 'error',
      },
    ]);
  });

  it('derives SQLite view read sets as ordinary views', () => {
    const facts = extractQueryFactsFromProjectBase({
      files: [
        sqliteDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        ]),
        {
          fileName: 'product.queries.ts',
          source: `
          import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
          import { sqliteTable, sqliteView, text } from "drizzle-orm/sqlite-core";

          export const products = sqliteTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "product", key: "id" }));
          export const productSearch = sqliteView("product_search").as((qb) => qb.select({ name: products.name }).from(products));

          export const searchQuery = query("search/sqlite", {
            output: s.object({ name: s.string() }),
            reads: [productSearch],
            load(_input, db: SQLiteAsyncDatabase) {
              return db.select({ name: sql<string>\`name\` }).from(productSearch);
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'search/sqlite',
        reads: ['product'],
        shape: {
          name: 'string',
        },
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('terminates cyclic pgView read-set derivation at the base table domain', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "product", key: "id" }));
          export const productSearchA = pgView("product_search_a").as((qb) =>
            qb.select({ id: products.id, name: products.name })
              .from(products)
              .leftJoin(productSearchB, eq(productSearchB.id, products.id)));
          export const productSearchB = pgView("product_search_b").as((qb) =>
            qb.select({ id: productSearchA.id, name: productSearchA.name }).from(productSearchA));

          export const searchQuery = query("search/view-cycle", {
            output: s.object({ name: s.string() }),
            reads: [productSearchB],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ name: sql<string>\`name\` }).from(productSearchB);
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'search/view-cycle',
        reads: ['product'],
        shape: {
          name: 'string',
        },
        site: 'product.queries.ts:13',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('terminates cyclic sqliteView read-set derivation at the base table domain', () => {
    const facts = extractQueryFactsFromProjectBase({
      files: [
        sqliteDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        ]),
        {
          fileName: 'product.queries.ts',
          source: `
          import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
          import { sqliteTable, sqliteView, text } from "drizzle-orm/sqlite-core";

          export const products = sqliteTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "product", key: "id" }));
          export const productSearchA = sqliteView("product_search_a").as((qb) =>
            qb.select({ id: products.id, name: products.name })
              .from(products)
              .leftJoin(productSearchB, eq(productSearchB.id, products.id)));
          export const productSearchB = sqliteView("product_search_b").as((qb) =>
            qb.select({ id: productSearchA.id, name: productSearchA.name }).from(productSearchA));

          export const searchQuery = query("search/sqlite-view-cycle", {
            output: s.object({ name: s.string() }),
            reads: [productSearchB],
            load(_input, db: SQLiteAsyncDatabase) {
              return db.select({ name: sql<string>\`name\` }).from(productSearchB);
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'search/sqlite-view-cycle',
        reads: ['product'],
        shape: {
          name: 'string',
        },
        site: 'product.queries.ts:16',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('uses declared materialized-view metadata as a query read domain', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const productStats = pgMaterializedView(
            "product_stats",
            { productId: text("product_id") },
            kovo({ view: { of: "product", refresh: "async" } }),
          );

          export const statsQuery = query("stats", {
            output: s.object({ productId: s.string() }),
            reads: [productStats],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ productId: sql<string>\`product_id\` }).from(productStats);
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'stats',
        reads: ['product'],
        shape: {
          productId: 'string',
        },
        site: 'product.queries.ts:8',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('does not derive column nullability from comments or strings', () => {
    const files = [
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            note: text("note", { enum: [".notNull("] }),
            stock: integer("stock" /* .notNull( */),
          }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                note: products.note,
                stock: products.stock,
              }).from(products);
            },
          });
        `,
      },
    ];
    const expectedShape = {
      note: {
        kind: 'nullable',
        shape: 'string',
      },
      stock: {
        kind: 'nullable',
        shape: 'number',
      },
    };

    for (const facts of [extractQueryFactsFromProject({ files })]) {
      expect(facts).toHaveLength(1);
      expect(facts[0]?.shape).toEqual(expectedShape);
    }
  });

  it('reports KV439 for whole-row table values projected onto the query wire', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: `
          export const users = pgTable("users", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
            email: text("email").notNull(),
          }, kovo({ domain: "user", key: "id" }));

          export const userQuery = query("user", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ row: users }).from(users);
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
            code: 'KV439',
            message:
              'DB table row reaches the client query wire without an explicit projection. Query projection user.row carries table-row provenance; select explicit fields instead.',
            severity: 'error',
            site: 'user.queries.ts:8',
          },
        ],
        query: 'user',
        reads: ['user'],
        shape: {
          row: {
            kind: 'table-row',
            shape: {
              email: 'string',
              id: 'string',
              name: 'string',
            },
            table: 'users',
          },
        },
        site: 'user.queries.ts:8',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV439',
        message:
          'DB table row reaches the client query wire without an explicit projection. Query projection user.row carries table-row provenance; select explicit fields instead.',
        severity: 'error',
        site: 'user.queries.ts:8',
      },
    ]);
  });

  it('recurses into table-row wrappers when a whole secret table is projected', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'vault.queries.ts',
          source: `
          export const vaults = pgTable("vaults", {
            id: text("id").primaryKey(),
            token: text("token").notNull(),
          }, kovo({ domain: "vault", key: "id", secret: true }));

          export const vaultQuery = query("vault", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ row: vaults }).from(vaults);
            },
          });
        `,
        },
      ],
    });

    expect(facts[0]?.shape).toEqual({
      row: {
        kind: 'table-row',
        shape: {
          id: { kind: 'secret', shape: 'string' },
          token: { kind: 'secret', shape: 'string' },
        },
        table: 'vaults',
      },
    });
    expect(
      diagnosticsForQueryFacts(facts).filter((diagnostic) => diagnostic.code === 'KV435'),
    ).toEqual([
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection vault.row.id reads a secret-classified column or unresolved projection from secret-classified table(s): vaults. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'vault.queries.ts:9',
      },
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection vault.row.token reads a secret-classified column or unresolved projection from secret-classified table(s): vaults. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'vault.queries.ts:9',
      },
    ]);
  });

  it('allows explicit projected shapes from DB columns without KV439', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: `
          export const users = pgTable("users", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
            email: text("email").notNull(),
          }, kovo({ domain: "user", key: "id" }));

          export const userQuery = query("user", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ id: users.id, name: users.name }).from(users);
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'user',
        reads: ['user'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'user.queries.ts:8',
      },
    ]);
    expect(
      diagnosticsForQueryFacts(facts).filter((diagnostic) => diagnostic.code === 'KV439'),
    ).toEqual([]);
  });

  it('marks unknown column builder projections as KV406 instead of guessing string shape', () => {
    const files = [
      {
        fileName: 'product.queries.ts',
        source: `
          const point = customType<{ data: { x: number; y: number } }>({
            dataType() {
              return 'point';
            },
          });
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            location: point("location"),
          }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                id: products.id,
                location: products.location,
              }).from(products);
            },
          });
        `,
      },
    ];

    for (const facts of [extractQueryFactsFromProject({ files })]) {
      expect(facts).toEqual([
        {
          diagnostics: [
            {
              code: 'KV406',
              message:
                'Statically un-analyzable write site; manual touches required. Query projection product.location could not be resolved to a Drizzle column or typed sql<T> expression.',
              severity: 'error',
              site: 'product.queries.ts:12',
            },
          ],
          query: 'product',
          reads: ['product'],
          shape: {
            id: 'string',
          },
          site: 'product.queries.ts:12',
        },
      ]);
    }
  });

  it('does not derive returned select shape from comments or strings', () => {
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
            async load(_input, db: PgAsyncDatabase<any, any>) {
              const fixture = "return db.select({ message: auditLog.message }).from(auditLog)";
              // return db.select({ message: auditLog.message }).from(auditLog);
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

  it('reports KV410 for opaque query projections without declared output schemas', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: `
          export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));

          export const cartQuery = query("cart", {
            async load(input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                count: sql<number>\`count(*)\`,
              }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
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
            code: 'KV410',
            message:
              'Opaque query projection requires a declared output schema. cart.count uses sql/raw projection without output.',
            severity: 'error',
            site: 'cart.queries.ts:4',
          },
        ],
        hasClientArgPredicate: true,
        instanceKey: {
          domain: 'cart',
          key: 'arg:cartId',
        },
        query: 'cart',
        reads: ['cart'],
        shape: {
          count: 'number',
        },
        site: 'cart.queries.ts:4',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV410',
        message:
          'Opaque query projection requires a declared output schema. cart.count uses sql/raw projection without output.',
        severity: 'error',
        site: 'cart.queries.ts:4',
      },
    ]);
  });

  it('routes aggregate helper projections through KV410 instead of KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: `
          import { avg, avgDistinct, count, countDistinct, max, min, sum, sumDistinct } from 'drizzle-orm';

          export const cartItems = pgTable("cart_items", {
            cartId: text("cart_id").notNull(),
            qty: integer("qty").notNull(),
          }, kovo({ domain: "cart", key: "cartId" }));

          export const cartStats = query("cart/stats", {
            async load(input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                total: count(),
                quantity: sum(cartItems.qty),
                average: avg(cartItems.qty),
              }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV410',
        message:
          'Opaque query projection requires a declared output schema. cart/stats.total uses sql/raw projection without output.',
        severity: 'error',
        site: 'cart.queries.ts:9',
      },
      {
        code: 'KV410',
        message:
          'Opaque query projection requires a declared output schema. cart/stats.quantity uses sql/raw projection without output.',
        severity: 'error',
        site: 'cart.queries.ts:9',
      },
      {
        code: 'KV410',
        message:
          'Opaque query projection requires a declared output schema. cart/stats.average uses sql/raw projection without output.',
        severity: 'error',
        site: 'cart.queries.ts:9',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts).map((diagnostic) => diagnostic.code)).not.toContain(
      'KV406',
    );
  });

  it('accepts aggregate helper projections with declared output and reads', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: `
          import { avg, avgDistinct, count, countDistinct, max, min, sum, sumDistinct } from 'drizzle-orm';

          export const cartItems = pgTable("cart_items", {
            cartId: text("cart_id").notNull(),
            qty: integer("qty").notNull(),
          }, kovo({ domain: "cart", key: "cartId" }));

          export const cartStats = query("cart/stats", {
            output: s.object({
              average: s.number(),
              averageDistinct: s.number(),
              maxQuantity: s.number(),
              minQuantity: s.number(),
              quantity: s.number(),
              quantityDistinct: s.number(),
              total: s.number(),
              totalDistinct: s.number(),
            }),
            reads: [cartItems],
            async load(input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                average: avg(cartItems.qty),
                averageDistinct: avgDistinct(cartItems.qty),
                maxQuantity: max(cartItems.qty),
                minQuantity: min(cartItems.qty),
                quantity: sum(cartItems.qty),
                quantityDistinct: sumDistinct(cartItems.qty),
                total: count(),
                totalDistinct: countDistinct(cartItems.qty),
              }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
    expect(facts[0]?.reads).toEqual(['cart']);
  });

  it('recognizes aggregate helper projections through aliases, namespaces, local aliases, and barrels', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'aggregate-barrel.ts',
          source: 'export { sumDistinct as barrelSumDistinct } from "drizzle-orm";',
        },
        {
          fileName: 'cart.queries.ts',
          source: `
          import { avg, count as aliasedCount } from 'drizzle-orm';
          import * as orm from 'drizzle-orm';
          import { barrelSumDistinct } from './aggregate-barrel';

          const localAvg = avg;
          export const cartItems = pgTable("cart_items", {
            cartId: text("cart_id").notNull(),
            qty: integer("qty").notNull(),
          }, kovo({ domain: "cart", key: "cartId" }));

          export const cartStats = query("cart/stats", {
            output: s.object({
              aliasTotal: s.number(),
              namespaceQuantity: s.number(),
              localAverage: s.number(),
              barrelQuantity: s.number(),
            }),
            reads: [cartItems],
            async load(input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                aliasTotal: aliasedCount(),
                namespaceQuantity: orm.sum(cartItems.qty),
                localAverage: localAvg(cartItems.qty),
                barrelQuantity: barrelSumDistinct(cartItems.qty),
              }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
    expect(facts[0]?.shape).toEqual({
      aliasTotal: 'number',
      barrelQuantity: 'number',
      localAverage: 'number',
      namespaceQuantity: 'number',
    });
  });

  it('uses declared output shape when an aggregate loader reaches db through a typed helper', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: `
          import { sum } from 'drizzle-orm';

          type Reader = PgAsyncDatabase<any, any>;
          interface LoadContext {
            db?: Reader;
          }

          export const cart = { key: "cart" } as const;
          export const cartItems = pgTable("cart_items", {
            cartId: text("cart_id").notNull(),
            qty: integer("qty").notNull(),
          }, kovo({ domain: "cart", key: "cartId" }));

          export const cartQuery = query("cart", {
            output: s.object({ count: s.number() }),
            reads: [cart],
            async load(_input: unknown, context?: LoadContext) {
              const db = requireDb(context);
              const rows = await db.select({ count: sum(cartItems.qty) }).from(cartItems);
              return { count: Number(rows[0]?.count ?? 0) };
            },
          });

          function requireDb(context?: LoadContext): Reader {
            if (!context?.db) throw new Error("missing db");
            return context.db;
          }
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'cart',
        reads: ['cart'],
        shape: { count: 'number' },
        site: 'cart.queries.ts:15',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('keeps local aggregate-named helpers fail-closed as KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: `
          export const cartItems = pgTable("cart_items", {
            cartId: text("cart_id").notNull(),
            qty: integer("qty").notNull(),
          }, kovo({ domain: "cart", key: "cartId" }));

          function count() {
            return Math.random();
          }

          export const cartStats = query("cart/stats", {
            output: s.object({ total: s.number() }),
            reads: [cartItems],
            async load(input, db: PgAsyncDatabase<any, any>) {
              return db.select({ total: count() }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV406',
        message: expect.stringContaining('Query projection cart/stats.total could not be resolved'),
        severity: 'error',
        site: 'cart.queries.ts:11',
      },
    ]);
  });

  it('keeps a local aggregate shadow fail-closed even when the real import is present', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: `
          import { count as realCount } from 'drizzle-orm';

          export const cartItems = pgTable("cart_items", {
            cartId: text("cart_id").notNull(),
            qty: integer("qty").notNull(),
          }, kovo({ domain: "cart", key: "cartId" }));

          function count() {
            return Math.random();
          }

          export const cartStats = query("cart/stats", {
            output: s.object({ safeTotal: s.number(), shadowTotal: s.number() }),
            reads: [cartItems],
            async load(input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                safeTotal: realCount(),
                shadowTotal: count(),
              }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV406',
        message: expect.stringContaining(
          'Query projection cart/stats.shadowTotal could not be resolved',
        ),
        severity: 'error',
        site: 'cart.queries.ts:13',
      },
    ]);
  });

  it('recognizes static AST output schema properties for opaque projections', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: `
          export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));

          export const literalOutputQuery = query("cart/literal", {
            "output": s.object({ count: s.number() }),
            reads: [cartItems],
            async load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ count: sql<number>\`count(*)\` }).from(cartItems);
            },
          });

          export const computedOutputQuery = query("cart/computed", {
            ["output"]: s.object({ count: s.number() }),
            reads: [cartItems],
            async load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ count: sql<number>\`count(*)\` }).from(cartItems);
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
    expect(facts.map((fact) => fact.query)).toEqual(['cart/computed', 'cart/literal']);
  });

  it('reports KV435 for opaque output-schema projections from secret tables', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: `
          export const users = pgTable("users", {
            id: text("id").primaryKey(),
            passwordHash: text("password_hash").notNull(),
          }, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));

          export const userStats = query("user", {
            output: s.object({ count: s.number() }),
            // Even a fully-declared opaque projection over a secret table must still fire KV435.
            reads: [users],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ count: sql<number>\`count(*)\` }).from(users);
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection user.count reads a secret-classified column or unresolved projection from secret-classified table(s): users. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'user.queries.ts:12',
      },
    ]);
  });

  it('reports KV435 and KV406 for transformed secret column projections', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: `
          function wrap(value: string | null): string {
            return value ?? "";
          }

          export const users = pgTable("users", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
            passwordHash: text("password_hash"),
          }, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));

          export const userList = query("user", {
            async load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                binary: users.passwordHash ?? "",
                call: wrap(users.passwordHash),
                json: JSON.stringify({ value: users.passwordHash }),
                logical: users.passwordHash || users.name,
                template: \`\${users.passwordHash}\`,
              }).from(users);
            },
          });
        `,
        },
      ],
    });

    const diagnostics = diagnosticsForQueryFacts(facts);
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'KV435')).toEqual([
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining('Query projection user.binary reads a secret-classified'),
      }),
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining('Query projection user.call reads a secret-classified'),
      }),
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining('Query projection user.json reads a secret-classified'),
      }),
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining('Query projection user.logical reads a secret-classified'),
      }),
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining(
          'Query projection user.template reads a secret-classified',
        ),
      }),
    ]);
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'KV406')).toEqual([
      expect.objectContaining({ code: 'KV406', message: expect.stringContaining('user.binary') }),
      expect.objectContaining({ code: 'KV406', message: expect.stringContaining('user.call') }),
      expect.objectContaining({ code: 'KV406', message: expect.stringContaining('user.json') }),
      expect.objectContaining({ code: 'KV406', message: expect.stringContaining('user.logical') }),
      expect.objectContaining({ code: 'KV406', message: expect.stringContaining('user.template') }),
    ]);
  });

  it('reports KV435 when a second select launders a secret through find and assignment', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'contact.queries.ts',
          source: `
          export const contacts = pgTable("contacts", {
            company: text("company").notNull(),
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "contact", key: "id", secret: ["company"] }));

          export const contactList = query("contacts", {
            async load(_input, db: PgAsyncDatabase<any, any>) {
              const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);
              const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);
              for (const secretRow of secretRows) {
                const item = items.find((candidate) => candidate.id === secretRow.id);
                if (item) item.company = secretRow.secret;
              }
              return items;
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining(
          'Query projection contacts.secret reads a secret-classified',
        ),
        site: 'contact.queries.ts:11',
      }),
    ]);
  });

  it('reports KV435 when a second select secret is pushed into the returned array', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'contact.queries.ts',
          source: `
          export const contacts = pgTable("contacts", {
            company: text("company").notNull(),
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "contact", key: "id", secret: ["company"] }));

          export const contactList = query("contacts", {
            async load(_input, db: PgAsyncDatabase<any, any>) {
              const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);
              const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);
              const first = secretRows[0];
              if (first) items.push({ id: first.id, name: "redacted", company: first.secret });
              return items;
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining(
          'Query projection contacts.secret reads a secret-classified',
        ),
        site: 'contact.queries.ts:11',
      }),
    ]);
  });

  it.each([
    [
      'callback push with a renamed secret projection',
      [
        'const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);',
        'const secretRows = await db.select({ id: contacts.id, displayCompany: contacts.company }).from(contacts);',
        'secretRows.forEach((secretRow) => {',
        '  items.push({ id: secretRow.id, name: "redacted", company: secretRow.displayCompany });',
        '});',
        'return items;',
      ],
    ],
    [
      'object spread plus JSON/template/call wrappers',
      [
        'const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);',
        'const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);',
        'const secretById = new Map<string, string>();',
        'secretRows.forEach((secretRow) => {',
        '  const payload = { ...secretRow, encoded: JSON.stringify({ value: `${wrapSecret(secretRow.secret)}` }) };',
        '  secretById.set(payload.id, payload.encoded);',
        '});',
        'return items.map((item) => ({ ...item, company: secretById.get(item.id) ?? null }));',
      ],
    ],
    [
      'reduce into a Map plus nullish/template wrappers',
      [
        'const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);',
        'const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);',
        'const secretById = secretRows.reduce((acc, secretRow) => {',
        '  acc.set(secretRow.id, `${secretRow.secret ?? ""}`);',
        '  return acc;',
        '}, new Map<string, string>());',
        'return items.map((item) => ({ ...item, company: secretById.get(item.id) ?? null }));',
      ],
    ],
    [
      'Object.assign into an element alias',
      [
        'const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);',
        'const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);',
        'const item = items[0];',
        'const secretRow = secretRows[0];',
        'if (item && secretRow) Object.assign(item, { company: secretRow.secret });',
        'return items;',
      ],
    ],
    [
      'compound assignment into an element alias',
      [
        'const items = await db.select({ id: contacts.id, name: contacts.name, company: contacts.name }).from(contacts);',
        'const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);',
        'const item = items[0];',
        'const secretRow = secretRows[0];',
        'if (item && secretRow) item.company ||= secretRow.secret;',
        'return items;',
      ],
    ],
  ])('reports KV435 for cross-select laundering via %s', (_label, loadBody) => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'contact.queries.ts',
          source: `
          function wrapSecret(value: string): string {
            return value;
          }

          export const contacts = pgTable("contacts", {
            company: text("company").notNull(),
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "contact", key: "id", secret: ["company"] }));

          export const contactList = query("contacts", {
            async load(_input, db: PgAsyncDatabase<any, any>) {
              ${loadBody.join('\n')}
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining('reads a secret-classified'),
      }),
    ]);
  });

  it.each([
    [
      'local function returning a closed-over secret projection',
      [
        'const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);',
        'const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);',
        'function pickSecret() {',
        '  return secretRows[0]?.secret ?? null;',
        '}',
        'return items.map((item) => ({ ...item, company: pickSecret() }));',
      ],
    ],
    [
      'local function mutating the returned shape from a secret argument',
      [
        'const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);',
        'const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);',
        'function attachSecret(rows: Array<{ id: string; secret: string }>) {',
        '  const first = rows[0];',
        '  if (first) items.push({ id: first.id, name: "redacted", company: first.secret });',
        '}',
        'attachSecret(secretRows);',
        'return items;',
      ],
    ],
    [
      'local arrow helper mutating the returned shape from a secret argument',
      [
        'const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);',
        'const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);',
        'const attachSecret = (rows: Array<{ id: string; secret: string }>) => {',
        '  const first = rows[0];',
        '  if (first) items.push({ id: first.id, name: "redacted", company: first.secret });',
        '};',
        'attachSecret(secretRows);',
        'return items;',
      ],
    ],
    [
      'local arrow helper mutating the returned shape from a closed-over secret projection',
      [
        'const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);',
        'const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);',
        'const collect = () => {',
        '  for (const row of secretRows) {',
        '    items.push({ id: row.id, name: row.secret });',
        '  }',
        '};',
        'collect();',
        'return items;',
      ],
    ],
    [
      'local arrow helper reading a closed-over secret projection without an off-wire declaration',
      [
        'const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);',
        'const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);',
        'const inspectSecret = () => {',
        '  for (const row of secretRows) void row.secret;',
        '};',
        'inspectSecret();',
        'return items;',
      ],
    ],
  ])('reports KV435 for cross-select laundering through %s', (_label, loadBody) => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'contact.queries.ts',
          source: `
          export const contacts = pgTable("contacts", {
            company: text("company").notNull(),
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "contact", key: "id", secret: ["company"] }));

          export const contactList = query("contacts", {
            async load(_input, db: PgAsyncDatabase<any, any>) {
              ${loadBody.join('\n')}
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining('reads a secret-classified'),
      }),
    ]);
  });

  it('allows an audited declareOffWire block for a server-only secret helper', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'contact.queries.ts',
          source: `
          import { declareOffWire } from "@kovojs/core";

          export const contacts = pgTable("contacts", {
            company: text("company").notNull(),
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "contact", key: "id", secret: ["company"] }));

          export const contactList = query("contacts", {
            async load(_input, db: PgAsyncDatabase<any, any>) {
              const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);
              const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);
              const inspectSecret = () => {
                for (const row of secretRows) void row.secret;
              };
              declareOffWire(() => {
                inspectSecret();
              }, { justification: "internal cache partition only" });
              return items;
            },
          });
        `,
        },
      ],
    });

    expect(
      diagnosticsForQueryFacts(facts).filter((diagnostic) => diagnostic.code === 'KV435'),
    ).toEqual([]);
  });

  it('does not let a shadowed declareOffWire hide a server-only secret helper', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'contact.queries.ts',
          source: `
          function declareOffWire(run: () => void, _options: { justification: string }): void {
            run();
          }

          export const contacts = pgTable("contacts", {
            company: text("company").notNull(),
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "contact", key: "id", secret: ["company"] }));

          export const contactList = query("contacts", {
            async load(_input, db: PgAsyncDatabase<any, any>) {
              const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);
              const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);
              const inspectSecret = () => {
                for (const row of secretRows) void row.secret;
              };
              declareOffWire(() => {
                inspectSecret();
              }, { justification: "fake local wrapper" });
              return items;
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining('reads a secret-classified'),
      }),
    ]);
  });

  it('does not let declareOffWire hide secret writes to the returned query shape', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'contact.queries.ts',
          source: `
          import { declareOffWire } from "@kovojs/core";

          export const contacts = pgTable("contacts", {
            company: text("company").notNull(),
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "contact", key: "id", secret: ["company"] }));

          export const contactList = query("contacts", {
            async load(_input, db: PgAsyncDatabase<any, any>) {
              const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);
              const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);
              const collect = () => {
                for (const row of secretRows) {
                  items.push({ id: row.id, name: row.secret });
                }
              };
              declareOffWire(() => {
                collect();
              }, { justification: "internal cache partition only" });
              return items;
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining('reads a secret-classified'),
      }),
    ]);
  });

  it('keeps a second secret select green when its value is proven off the returned query wire', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'contact.queries.ts',
          source: `
          export const contacts = pgTable("contacts", {
            company: text("company").notNull(),
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "contact", key: "id", secret: ["company"] }));

          export const contactList = query("contacts", {
            async load(_input, db: PgAsyncDatabase<any, any>) {
              const items = await db.select({ id: contacts.id, name: contacts.name }).from(contacts);
              const secretRows = await db.select({ id: contacts.id, secret: contacts.company }).from(contacts);
              const serverOnlyCount = secretRows.length;
              if (serverOnlyCount > 10) await Promise.resolve(serverOnlyCount);
              return items;
            },
          });
        `,
        },
      ],
    });

    expect(
      diagnosticsForQueryFacts(facts).filter((diagnostic) => diagnostic.code === 'KV435'),
    ).toEqual([]);
  });

  it('recognizes audited trustedReveal calls imported from @kovojs/core', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: [
            'import { trustedReveal } from "@kovojs/core";',
            '',
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  passwordHash: text("password_hash").notNull(),',
            '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
            '',
            'export const userDetail = query("user", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      passwordDigest: trustedReveal(users.passwordHash, {',
            '        justification: "one-way digest shown to admins",',
            '        source: "users.passwordHash",',
            '      }),',
            '    }).from(users);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
    expect(facts[0]?.shape).toMatchObject({
      passwordDigest: {
        kind: 'revealed',
        reveal: {
          grade: 'audit',
          justification: 'one-way digest shown to admins',
          method: 'arbitrary-fn',
          selectedSecret: true,
          site: 'user.queries.ts:11',
          source: 'users.passwordHash',
        },
        shape: { kind: 'secret', shape: 'string' },
      },
    });
    expect(revealFactsFromQueryFacts(facts)).toEqual([
      {
        grade: 'audit',
        justification: 'one-way digest shown to admins',
        method: 'arbitrary-fn',
        path: 'passwordDigest',
        query: 'user',
        selectedSecret: true,
        site: 'user.queries.ts:11',
        source: 'users.passwordHash',
      },
    ]);
  });

  it('recognizes proof-grade namespace trustedReveal calls for structured non-secret projections', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: [
            'import * as core from "@kovojs/core";',
            '',
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  passwordHash: text("password_hash").notNull(),',
            '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
            '',
            'export const userStats = query("user", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      publicId: core.trustedReveal(users.id, {',
            '        method: "server-projection",',
            '        justification: "server projects a public identifier",',
            '        source: "users.id",',
            '      }),',
            '    }).from(users);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
    expect(facts[0]?.shape).toMatchObject({
      publicId: {
        kind: 'revealed',
        reveal: {
          grade: 'proof',
          justification: 'server projects a public identifier',
          method: 'server-projection',
          selectedSecret: false,
          site: 'user.queries.ts:11',
          source: 'users.id',
        },
        shape: 'string',
      },
    });
    expect(revealFactsFromQueryFacts(facts)).toEqual([
      {
        grade: 'proof',
        justification: 'server projects a public identifier',
        method: 'server-projection',
        path: 'publicId',
        query: 'user',
        selectedSecret: false,
        site: 'user.queries.ts:11',
        source: 'users.id',
      },
    ]);
  });

  it('recognizes trustedReveal through aliases, local aliases, and barrels', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'core-barrel.ts',
          source: 'export { trustedReveal as barrelReveal } from "@kovojs/core";',
        },
        {
          fileName: 'user.queries.ts',
          source: [
            'import { trustedReveal as reveal } from "@kovojs/core";',
            'import { barrelReveal } from "./core-barrel";',
            '',
            'const localReveal = reveal;',
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  passwordHash: text("password_hash").notNull(),',
            '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
            '',
            'export const userDetail = query("user", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      aliasDigest: reveal(users.passwordHash, { justification: "alias reveal", source: "users.passwordHash" }),',
            '      localDigest: localReveal(users.passwordHash, { justification: "local reveal", source: "users.passwordHash" }),',
            '      barrelDigest: barrelReveal(users.passwordHash, { justification: "barrel reveal", source: "users.passwordHash" }),',
            '    }).from(users);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
    expect(
      revealFactsFromQueryFacts(facts)
        .map((fact) => fact.justification)
        .sort(),
    ).toEqual(['alias reveal', 'barrel reveal', 'local reveal']);
  });

  it('keeps a local trustedReveal shadow untrusted even when the real import is present', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: [
            'import { trustedReveal as realReveal } from "@kovojs/core";',
            '',
            'function trustedReveal<T>(value: T): T { return value; }',
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  passwordHash: text("password_hash").notNull(),',
            '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
            '',
            'export const userDetail = query("user", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      fakePublic: trustedReveal(users.id),',
            '      realDigest: realReveal(users.passwordHash, { justification: "real reveal", source: "users.passwordHash" }),',
            '    }).from(users);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV406',
        message: expect.stringContaining('Query projection user.fakePublic could not be resolved'),
        severity: 'error',
        site: 'user.queries.ts:9',
      },
    ]);
    expect(facts[0]?.shape).toMatchObject({
      realDigest: { kind: 'revealed' },
    });
    expect(revealFactsFromQueryFacts(facts)).toEqual([
      expect.objectContaining({
        justification: 'real reveal',
        path: 'realDigest',
      }),
    ]);
  });

  it('keeps trustedReveal sql projections audit-grade and subject to output-schema diagnostics', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: [
            'import * as core from "@kovojs/core";',
            '',
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  passwordHash: text("password_hash").notNull(),',
            '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
            '',
            'export const userStats = query("user", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      passwordDigest: core.trustedReveal(sql<string>`substr(password_hash, 1, 8)`, {',
            '        method: "server-projection",',
            '        justification: "server projects a digest prefix",',
            '        source: "users.passwordHash",',
            '      }),',
            '    }).from(users);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts[0]?.shape).toMatchObject({
      passwordDigest: {
        kind: 'revealed',
        reveal: {
          grade: 'audit',
          justification: 'server projects a digest prefix',
          method: 'server-projection',
          selectedSecret: false,
          site: 'user.queries.ts:11',
          source: 'users.passwordHash',
        },
        shape: 'string',
      },
    });
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV410',
        message:
          'Opaque query projection requires a declared output schema. user.passwordDigest uses sql/raw projection without output.',
        severity: 'error',
        site: 'user.queries.ts:8',
      },
    ]);
    expect(revealFactsFromQueryFacts(facts)).toEqual([
      {
        grade: 'audit',
        justification: 'server projects a digest prefix',
        method: 'server-projection',
        path: 'passwordDigest',
        query: 'user',
        selectedSecret: false,
        site: 'user.queries.ts:11',
        source: 'users.passwordHash',
      },
    ]);
  });

  it('does not treat local functions named trustedReveal as audited reveal calls', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: [
            'function trustedReveal<T>(value: T): T { return value; }',
            '',
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  passwordHash: text("password_hash").notNull(),',
            '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
            '',
            'export const userDetail = query("user", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      passwordDigest: trustedReveal(users.passwordHash),',
            '    }).from(users);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts[0]?.shape).not.toMatchObject({
      passwordDigest: { kind: 'revealed' },
    });
    expect(revealFactsFromQueryFacts(facts)).toEqual([]);
  });

  it('does not treat shadowed reveal aliases as audited reveal calls', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: [
            'import { trustedReveal as realReveal } from "@kovojs/core";',
            '',
            'function reveal<T>(value: T): T { return value; }',
            '',
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  passwordHash: text("password_hash").notNull(),',
            '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
            '',
            'export const userDetail = query("user", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      fakeDigest: reveal(users.passwordHash),',
            '      realDigest: realReveal(users.passwordHash, { justification: "real reveal", source: "users.passwordHash" }),',
            '    }).from(users);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV435',
          message: expect.stringContaining(
            'Query projection user.fakeDigest reads a secret-classified',
          ),
        }),
        expect.objectContaining({
          code: 'KV406',
          message: expect.stringContaining(
            'Query projection user.fakeDigest could not be resolved',
          ),
        }),
      ]),
    );
    expect(facts[0]?.shape).toMatchObject({
      realDigest: { kind: 'revealed' },
    });
    expect(revealFactsFromQueryFacts(facts)).toEqual([
      expect.objectContaining({
        justification: 'real reveal',
        path: 'realDigest',
      }),
    ]);
  });

  it('does not let bare casts reveal secret query projections', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: [
            'import type { Secret } from "@kovojs/core";',
            '',
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  passwordHash: text("password_hash").notNull(),',
            '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
            '',
            'export const userDetail = query("user", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      castString: users.passwordHash as unknown as string,',
            '      castSecret: users.passwordHash as unknown as Secret<string>,',
            '    }).from(users);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(revealFactsFromQueryFacts(facts)).toEqual([]);
    expect(facts[0]?.shape).toMatchObject({
      castSecret: { kind: 'secret', shape: 'string' },
      castString: { kind: 'secret', shape: 'string' },
    });
    expect(diagnosticsForQueryFacts(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV435',
          message: expect.stringContaining(
            'Query projection user.castString reads a secret-classified',
          ),
        }),
        expect.objectContaining({
          code: 'KV435',
          message: expect.stringContaining(
            'Query projection user.castSecret reads a secret-classified',
          ),
        }),
      ]),
    );
  });

  it('requires a non-empty static trustedReveal justification before emitting reveal facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: [
            'import { trustedReveal } from "@kovojs/core";',
            '',
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  passwordHash: text("password_hash").notNull(),',
            '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
            '',
            'export const userDetail = query("user", {',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.select({',
            '      passwordDigest: trustedReveal(users.passwordHash, { justification: "   " }),',
            '    }).from(users);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts[0]?.shape).toMatchObject({
      passwordDigest: { kind: 'secret', shape: 'string' },
    });
    expect(revealFactsFromQueryFacts(facts)).toEqual([]);
  });

  it('reports KV435 for spread and computed-key projections from secret tables', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: `
          export const users = pgTable("users", {
            id: text("id").primaryKey(),
            email: text("email").notNull(),
            passwordHash: text("password_hash").notNull(),
          }, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));

          export const userList = query("user", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              const displayKey = "displayName";
              const publicColumns = { email: users.email };
              return db.select({
                [displayKey]: users.email,
                ...publicColumns,
                id: users.id,
              }).from(users);
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection user.computed:[displayKey] reads a secret-classified column or unresolved projection from secret-classified table(s): users. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'user.queries.ts:13',
      },
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection user.spread:publicColumns reads a secret-classified column or unresolved projection from secret-classified table(s): users. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'user.queries.ts:14',
      },
      {
        code: 'KV406',
        message:
          'Statically un-analyzable write site; manual touches required. Query projection user.computed:[displayKey] could not be resolved to a Drizzle column or typed sql<T> expression.',
        severity: 'error',
        site: 'user.queries.ts:8',
      },
      {
        code: 'KV406',
        message:
          'Statically un-analyzable write site; manual touches required. Query projection user.spread:publicColumns could not be resolved to a Drizzle column or typed sql<T> expression.',
        severity: 'error',
        site: 'user.queries.ts:8',
      },
    ]);
  });

  it('marks typed SQL time projections as volatile-time query shape fields', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'subscription.queries.ts',
          source: `
          export const subscriptions = pgTable("subscriptions", {
            id: text("id").primaryKey(),
          }, kovo({ domain: "subscription", key: "id" }));

          export const subscriptionQuery = query("subscription", {
            output: s.object({ serverNow: s.string() }),
            reads: [subscriptions],
            async load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ serverNow: sql<string>\`now()\` }).from(subscriptions);
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'subscription',
        reads: ['subscription'],
        shape: {
          serverNow: { kind: 'volatile-time', shape: 'string' },
        },
        site: 'subscription.queries.ts:6',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('marks time-predicate rowsets as volatile-time query shapes', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'subscription.queries.ts',
          source: `
          export const subscriptions = pgTable("subscriptions", {
            id: text("id").primaryKey(),
            expiresAt: text("expires_at").notNull(),
          }, kovo({ domain: "subscription", key: "id" }));

          export const subscriptionQuery = query("subscription", {
            output: s.object({ id: s.string() }),
            async load(_input, db: PgAsyncDatabase<any, any>) {
              return db
                .select({ id: subscriptions.id })
                .from(subscriptions)
                .where(gt(subscriptions.expiresAt, sql<string>\`now()\`));
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'subscription',
        reads: ['subscription'],
        shape: {
          kind: 'volatile-time',
          shape: {
            id: 'string',
          },
        },
        site: 'subscription.queries.ts:7',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('does not treat comments or strings as declared query output schemas', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: `
          export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));

          export const cartQuery = query("cart", {
            // output: s.object({ count: s.number() }),
            description: "output: not a schema",
            async load(input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                count: sql<number>\`count(*)\`,
              }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV410',
        message:
          'Opaque query projection requires a declared output schema. cart.count uses sql/raw projection without output.',
        severity: 'error',
        site: 'cart.queries.ts:4',
      },
    ]);
  });

  it('does not treat dynamic output keys or spread contents as declared query output schemas', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: `
          const outputKey = "output";
          const sharedQueryConfig = { output: s.object({ count: s.number() }) };
          export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));

          export const dynamicOutputQuery = query("cart/dynamic", {
            [outputKey]: s.object({ count: s.number() }),
            async load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ count: sql<number>\`count(*)\` }).from(cartItems);
            },
          });

          export const spreadOutputQuery = query("cart/spread", {
            ...sharedQueryConfig,
            async load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ count: sql<number>\`count(*)\` }).from(cartItems);
            },
          });
        `,
        },
      ],
    });

    expect(
      diagnosticsForQueryFacts(facts).map(({ code, message, severity }) => ({
        code,
        message,
        severity,
      })),
    ).toEqual([
      {
        code: 'KV410',
        message:
          'Opaque query projection requires a declared output schema. cart/dynamic.count uses sql/raw projection without output.',
        severity: 'error',
      },
      {
        code: 'KV410',
        message:
          'Opaque query projection requires a declared output schema. cart/spread.count uses sql/raw projection without output.',
        severity: 'error',
      },
    ]);
  });

  it('omits instance keys when Drizzle query predicates do not target an annotated table key', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", { sku: text("sku").notNull() }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(input, db: PgAsyncDatabase<any, any>) {
              return db.select({ sku: products.sku }).from(products).where(eq(products.sku, input.sku));
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        hasClientArgPredicate: true,
        query: 'product',
        reads: ['product'],
        shape: {
          sku: 'string',
        },
        site: 'product.queries.ts:4',
      },
    ]);
  });

  it('does not infer query instance keys from comments and strings', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(input, db: PgAsyncDatabase<any, any>) {
              const fixture = ".where(eq(products.id, input.id))";
              // return db.select({ name: products.name }).from(products).where(eq(products.id, input.id));
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
        site: 'product.queries.ts:4',
      },
    ]);
  });

  it('marks unresolved computed projections as KV406 instead of guessing from selected aliases', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                displayName: formatName(products.name),
                stock: computeStock(products.id),
                id: products.id,
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
              'Statically un-analyzable write site; manual touches required. Query projection product.displayName could not be resolved to a Drizzle column or typed sql<T> expression.',
            severity: 'error',
            site: 'product.queries.ts:7',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query projection product.stock could not be resolved to a Drizzle column or typed sql<T> expression.',
            severity: 'error',
            site: 'product.queries.ts:7',
          },
        ],
        query: 'product',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.queries.ts:7',
      },
    ]);
  });

  it('does not fabricate projection facts from punctuation inside string-literal keys', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                "display:name,raw": products.name,
                "unresolved:value,raw": compute(products.id),
                id: products.id,
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
              'Statically un-analyzable write site; manual touches required. Query projection product.unresolved:value,raw could not be resolved to a Drizzle column or typed sql<T> expression.',
            severity: 'error',
            site: 'product.queries.ts:7',
          },
        ],
        query: 'product',
        reads: ['product'],
        shape: {
          'display:name,raw': 'string',
          id: 'string',
        },
        site: 'product.queries.ts:7',
      },
    ]);
  });

  it('resolves static element-access projection columns from AST facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                displayName: products["name"],
                id: products["id"],
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
          displayName: 'string',
          id: 'string',
        },
        site: 'product.queries.ts:7',
      },
    ]);
  });

  it('does not infer typed sql projections from string contents', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
          }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({
                count: "sql<number>\`count(*)\`",
                id: products.id,
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
              'Statically un-analyzable write site; manual touches required. Query projection product.count could not be resolved to a Drizzle column or typed sql<T> expression.',
            severity: 'error',
            site: 'product.queries.ts:6',
          },
        ],
        query: 'product',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.queries.ts:6',
      },
    ]);
  });

  it('marks shorthand projections as KV406 instead of dropping them', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
          }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              const id = products.id;
              return db.select({ id }).from(products);
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
              'Statically un-analyzable write site; manual touches required. Query projection product.id could not be resolved to a Drizzle column or typed sql<T> expression.',
            severity: 'error',
            site: 'product.queries.ts:6',
          },
        ],
        query: 'product',
        reads: ['product'],
        shape: {},
        site: 'product.queries.ts:6',
      },
    ]);
  });

  it('keeps projection-less selects visible as KV406 query facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select().from(products);
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
              'Statically un-analyzable write site; manual touches required. Query uses db.select() without an explicit projection.',
            severity: 'error',
            site: 'product.queries.ts:4',
          },
        ],
        query: 'product',
        reads: ['product'],
        shape: {},
        site: 'product.queries.ts:4',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV406',
        message:
          'Statically un-analyzable write site; manual touches required. Query uses db.select() without an explicit projection.',
        severity: 'error',
        site: 'product.queries.ts:4',
      },
    ]);
  });

  it('keeps raw query receiver calls visible as KV406 query facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product/raw", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.execute(sql\`select * from products\`);
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
              'Statically un-analyzable raw/opaque query read; declare output and reads: to attest the read set. Query uses db.execute().',
            severity: 'error',
            site: 'product.queries.ts:4',
          },
        ],
        query: 'product/raw',
        reads: [],
        shape: {},
        site: 'product.queries.ts:4',
      },
    ]);
  });

  it('reports undeclared SQLite raw query receivers as raw reads, not write sites', () => {
    const facts = extractQueryFactsFromProjectBase({
      files: [
        sqliteDatabaseTypes(['get(query: unknown): Promise<unknown>;']),
        {
          fileName: 'product.queries.ts',
          source: `
          import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
          export const products = sqliteTable("products", { id: text("id").primaryKey() }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product/sqlite-raw", {
            load(_input, db: SQLiteAsyncDatabase<any, any, any>) {
              return db.get(sql\`select id from products\`);
            },
          });
        `,
        },
      ],
    });

    const diagnostics = diagnosticsForQueryFacts(facts);
    expect(diagnostics).toMatchObject([
      {
        code: 'KV406',
        message: expect.stringContaining('raw/opaque query read; declare output and reads:'),
        severity: 'error',
      },
    ]);
    expect(diagnostics[0]?.message).toContain('Query uses db.get().');
    expect(diagnostics[0]?.message).not.toContain('write site');
  });

  it('honors explicit reads and output for opaque raw query receiver calls', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<unknown[]>;']),
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", { id: text("id").primaryKey() }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product/raw", {
            output: s.object({ id: s.string(), stock: s.number().int() }),
            reads: [products],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.execute(sql\`select id, stock from products\`);
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/raw',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:4',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('honors explicit reads and output for SQLite raw query receiver calls', () => {
    const facts = extractQueryFactsFromProjectBase({
      files: [
        sqliteDatabaseTypes(['all(query: unknown): Promise<unknown[]>;']),
        {
          fileName: 'product.queries.ts',
          source: `
          import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
          export const products = sqliteTable("products", { id: text("id").primaryKey() }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product/raw", {
            output: s.object({ id: s.string(), stock: s.number().int() }),
            reads: [products],
            load(_input, db: SQLiteAsyncDatabase<any, any, any>) {
              return db.all(sql\`select id, stock from products\`);
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/raw',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:5',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('fails closed on dynamic opaque-query reads entries', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<unknown[]>;']),
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", { id: text("id").primaryKey() }, kovo({ domain: "product", key: "id" }));
          const extraReads = [products];

          export const productQuery = query("product/raw", {
            output: s.object({ id: s.string() }),
            reads: [products, ...extraReads],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.execute(sql\`select id from products\`);
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toMatchObject([
      {
        code: 'KV410',
        message: expect.stringContaining('dynamic or spread reads fail closed'),
        severity: 'error',
      },
    ]);
  });

  it('keeps computed query receiver calls visible as KV406 query facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<void>;']),
        {
          fileName: 'product.queries.ts',
          source: `
            type FakeDb = Record<string, (query: unknown) => Promise<void>>;

            export const productQuery = query("product/computed-raw", {
              load(_input, db: PgAsyncDatabase<any, any>, fake: FakeDb) {
                const method = "execute";
                db[method](sql\`select * from products\`);
                fake[method](sql\`select * from products\`);
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
              'Statically un-analyzable raw/opaque query read; declare output and reads: to attest the read set. Query uses db[method]().',
            severity: 'error',
            site: 'product.queries.ts:4',
          },
        ],
        query: 'product/computed-raw',
        reads: [],
        shape: {},
        site: 'product.queries.ts:4',
      },
    ]);
  });

  it('keeps relational query API reads visible as KV406 query facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: `
          export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));

          export const usersQuery = query("users", {
            load(_input, db: PgAsyncDatabase<any, any>) {
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
            site: 'user.queries.ts:4',
          },
        ],
        query: 'users',
        reads: ['user'],
        shape: {},
        site: 'user.queries.ts:4',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV406',
        message:
          'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
        severity: 'error',
        site: 'user.queries.ts:4',
      },
    ]);
  });

  it('derives relational query shapes from static columns projections, including secret facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: `
          export const users = pgTable("users", {
            apiToken: text("api_token"),
            id: text("id").primaryKey(),
            name: text("name").notNull(),
            passwordHash: text("password_hash").notNull(),
          }, kovo({ domain: "user", key: "id", secret: ["passwordHash", "apiToken"] }));

          export const usersQuery = query("users", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.query.users.findMany({
                columns: {
                  apiToken: true,
                  id: true,
                  name: true,
                  passwordHash: true,
                },
                where: eq(users.active, true),
              });
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
            code: 'KV435',
            message:
              'Secret query value reaches the client wire. Query projection users.apiToken reads a secret-classified column or unresolved projection from secret-classified table(s): users. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
            severity: 'error',
            site: 'user.queries.ts:13',
          },
          {
            code: 'KV435',
            message:
              'Secret query value reaches the client wire. Query projection users.passwordHash reads a secret-classified column or unresolved projection from secret-classified table(s): users. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
            severity: 'error',
            site: 'user.queries.ts:16',
          },
        ],
        query: 'users',
        readProvenance: [
          {
            columns: [
              {
                classification: 'secret',
                column: 'apiToken',
                path: 'apiToken',
                projection: 'column',
                site: 'user.queries.ts:13',
                table: 'users',
              },
              {
                classification: 'secret',
                column: 'passwordHash',
                path: 'passwordHash',
                projection: 'column',
                site: 'user.queries.ts:16',
                table: 'users',
              },
            ],
            domain: 'user',
            keys: null,
            scope: { kind: 'unscoped' },
            site: 'user.queries.ts:9',
            source: 'select',
            via: 'users',
          },
        ],
        reads: ['user'],
        shape: {
          apiToken: {
            kind: 'nullable',
            shape: {
              kind: 'secret',
              shape: 'string',
            },
          },
          id: 'string',
          name: 'string',
          passwordHash: {
            kind: 'secret',
            shape: 'string',
          },
        },
        site: 'user.queries.ts:9',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection users.apiToken reads a secret-classified column or unresolved projection from secret-classified table(s): users. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'user.queries.ts:13',
      },
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection users.passwordHash reads a secret-classified column or unresolved projection from secret-classified table(s): users. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'user.queries.ts:16',
      },
    ]);
  });

  it('derives nested relational query shapes from static with columns projections', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'post.queries.ts',
          source: `
          export const users = pgTable("users", {
            apiToken: text("api_token"),
            id: text("id").primaryKey(),
            passwordHash: text("password_hash").notNull(),
          }, kovo({ domain: "user", key: "id", secret: ["passwordHash", "apiToken"] }));
          export const posts = pgTable("posts", {
            id: text("id").primaryKey(),
          }, kovo({ domain: "post", key: "id" }));
          export const postsRelations = relations(posts, ({ one }) => ({
            author: one(users),
          }));

          export const postsQuery = query("posts", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.query.posts.findMany({
                columns: {
                  id: true,
                },
                with: {
                  author: {
                    columns: {
                      apiToken: true,
                      passwordHash: true,
                    },
                  },
                },
              });
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
            code: 'KV435',
            message:
              'Secret query value reaches the client wire. Query projection posts.author.apiToken reads a secret-classified column or unresolved projection from secret-classified table(s): users. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
            severity: 'error',
            site: 'post.queries.ts:23',
          },
          {
            code: 'KV435',
            message:
              'Secret query value reaches the client wire. Query projection posts.author.passwordHash reads a secret-classified column or unresolved projection from secret-classified table(s): users. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
            severity: 'error',
            site: 'post.queries.ts:24',
          },
        ],
        query: 'posts',
        readProvenance: [
          {
            columns: [
              {
                classification: 'secret',
                column: 'apiToken',
                path: 'author.apiToken',
                projection: 'column',
                site: 'post.queries.ts:23',
                table: 'users',
              },
              {
                classification: 'secret',
                column: 'passwordHash',
                path: 'author.passwordHash',
                projection: 'column',
                site: 'post.queries.ts:24',
                table: 'users',
              },
            ],
            domain: 'user',
            keys: null,
            scope: { kind: 'unscoped' },
            site: 'post.queries.ts:14',
            source: 'select',
            via: 'users',
          },
        ],
        reads: ['post', 'user'],
        shape: {
          author: {
            apiToken: {
              kind: 'nullable',
              shape: {
                kind: 'secret',
                shape: 'string',
              },
            },
            passwordHash: {
              kind: 'secret',
              shape: 'string',
            },
          },
          id: 'string',
        },
        site: 'post.queries.ts:14',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection posts.author.apiToken reads a secret-classified column or unresolved projection from secret-classified table(s): users. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'post.queries.ts:23',
      },
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection posts.author.passwordHash reads a secret-classified column or unresolved projection from secret-classified table(s): users. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'post.queries.ts:24',
      },
    ]);
  });

  it('derives array shapes for defineRelations many projections', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'post.queries.ts',
          source: `
          export const posts = pgTable("posts", {
            id: text("id").primaryKey(),
          }, kovo({ domain: "post", key: "id" }));
          export const comments = pgTable("comments", {
            body: text("body").notNull(),
            id: text("id").primaryKey(),
            postId: text("post_id").notNull(),
          }, kovo({ domain: "comment", key: "id" }));
          export const postRelations = defineRelations({ posts, comments }, (r) => ({
            posts: {
              comments: r.many.comments(),
            },
          }));

          export const postsQuery = query("posts", {
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.query.posts.findMany({
                columns: { id: true },
                with: {
                  comments: {
                    columns: {
                      body: true,
                      id: true,
                    },
                  },
                },
              });
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'posts',
        reads: ['comment', 'post'],
        shape: {
          comments: [
            {
              body: 'string',
              id: 'string',
            },
          ],
          id: 'string',
        },
        site: 'post.queries.ts:16',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('keeps static element-access relational API reads visible as KV406 query facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: `
          export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));

          export const usersQuery = query("users", {
            load(_input, db: PgAsyncDatabase<any, any>) {
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
            site: 'user.queries.ts:4',
          },
        ],
        query: 'users',
        reads: ['user'],
        shape: {},
        site: 'user.queries.ts:4',
      },
    ]);
  });

  it('resolves project relational query tables from namespace-imported table symbols', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'schema.ts',
          source: `
            export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));
          `,
        },
        {
          fileName: 'user.queries.ts',
          source: `
            import * as schema from "./schema";

            export const usersQuery = query("users/namespace", {
              load(_input, db: PgAsyncDatabase<any, any>) {
                return db.query.users.findMany({ where: eq(schema.users.active, true) });
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
            site: 'user.queries.ts:4',
          },
        ],
        query: 'users/namespace',
        reads: ['user'],
        shape: {},
        site: 'user.queries.ts:4',
      },
    ]);
  });

  it('marks project relational query read sources that cannot resolve to a table as KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: `
            export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));

            export const usersQuery = query("users", {
              load(_input, db: PgAsyncDatabase<any, any>) {
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
            site: 'user.queries.ts:4',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query relational read source could not be resolved to a Drizzle table.',
            severity: 'error',
            site: 'user.queries.ts:4',
          },
        ],
        query: 'users',
        reads: [],
        shape: {},
        site: 'user.queries.ts:4',
      },
    ]);
  });
});

describe('@kovojs/drizzle algebraic field classification — Lane C extractor fixes', () => {
  // C4 (SPEC §10.5): Drizzle `count(t.col)` counts only NON-NULL values, unlike
  // `count()`/`count(*)`. Classifying it as COUNT(*) over-counts NULL-column INSERTs,
  // so it must be opaque (the deriver then punts the pair rather than mis-counting).
  it('C4: count(t.col) classifies as opaque, not a plain COUNT', () => {
    const field = singleAlgebraicField(
      C_COMMON_IMPORTS,
      ITEMS_C_TABLE,
      "export const q = query('q', {",
      '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
      '    return { f: db.select({ value: count(items.assignee) }).from(items) };',
      '  },',
      '});',
    );
    expect(field).toEqual({
      kind: 'opaque',
      reason: { code: 'opaque-projection', expr: 'count(items.assignee)' },
    });
  });

  it('C4: argument-less count() still classifies as a plain COUNT', () => {
    const field = singleAlgebraicField(
      C_COMMON_IMPORTS,
      ITEMS_C_TABLE,
      "export const q = query('q', {",
      '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
      '    return { f: db.select({ value: count() }).from(items) };',
      '  },',
      '});',
    );
    expect(field).toEqual({
      kind: 'count',
      rowset: { filters: [], key: 'id', orderBy: [], table: 'items' },
    });
  });

  // C3 (SPEC §10.5): a multi-eq COUNT must carry the FULL filter chain so the deriver
  // can re-check every predicate — not just the first eq.
  it('C3: count() WHERE and(eq,eq) carries the full filter chain', () => {
    const field = singleAlgebraicField(
      C_COMMON_IMPORTS,
      ITEMS_C_TABLE,
      "export const q = query('q', {",
      '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
      "    return { f: db.select({ value: count() }).from(items).where(and(eq(items.cartId, 'c1'), eq(items.assignee, 'u1'))) };",
      '  },',
      '});',
    );
    expect(field).toEqual({
      kind: 'count',
      pred: { column: 'cartId', op: 'eq', value: { kind: 'const', value: 'c1' } },
      rowset: {
        filters: [
          { column: 'cartId', op: 'eq', value: { kind: 'const', value: 'c1' } },
          { column: 'assignee', op: 'eq', value: { kind: 'const', value: 'u1' } },
        ],
        key: 'id',
        orderBy: [],
        table: 'items',
      },
    });
  });
});

// SPEC §10.2/§11.1: the declared `reads:` set is `readonly Domain[]` (packages/server/src/query.ts),
// so the canonical form lists Domain VALUES (`domain('x')`). Those values must resolve to their
// domain key and fold into the query's read set (§11.1) — not stay decorative while the read set is
// derived only from `.from()`. A fully-raw opaque read whose `reads:` resolves to no domain has an
// empty folded read set (silent staleness) and is itself a KV410 error (§10.2).
describe('declared reads: Domain-value resolution (SPEC §10.2/§11.1)', () => {
  it('folds a declared Domain VALUE (const reference) into the query read set', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'post.queries.ts',
          source: `
          const tagDomain = domain("tag");
          export const posts = pgTable("posts", { id: text("id").primaryKey() }, kovo({ domain: "post", key: "id" }));

          export const postQuery = query("post", {
            output: s.object({ id: s.string(), tagCount: s.number() }),
            // The raw subquery reads the \`tags\` table (domain "tag"), invisible to static table
            // extraction; the declared Domain value must fold "tag" into the read set (§11.1).
            reads: [tagDomain],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db
                .select({ id: posts.id, tagCount: sql<number>\`(SELECT count(*) FROM tags WHERE tags.post_id = posts.id)\` })
                .from(posts);
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'post',
        // "post" is the `.from()`-derived domain; "tag" is the declared Domain value (§11.1 fold).
        reads: ['post', 'tag'],
        shape: { id: 'string', tagCount: 'number' },
        site: 'post.queries.ts:5',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('folds an inline domain("x") Domain VALUE without firing the dynamic-reads guard', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'post.queries.ts',
          source: `
          export const posts = pgTable("posts", { id: text("id").primaryKey() }, kovo({ domain: "post", key: "id" }));

          export const postQuery = query("post", {
            output: s.object({ id: s.string(), tagCount: s.number() }),
            reads: [domain("tag")],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db
                .select({ id: posts.id, tagCount: sql<number>\`(SELECT count(*) FROM tags)\` })
                .from(posts);
            },
          });
        `,
        },
      ],
    });

    const fact = facts[0];
    expect(fact?.reads).toEqual(['post', 'tag']);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('folds declared Domain values through aliases, namespaces, local aliases, and barrels', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'server-barrel.ts',
          source: 'export { domain as barrelDomain } from "@kovojs/server";',
        },
        {
          fileName: 'post.queries.ts',
          source: `
          import { domain as dom, query, s } from "@kovojs/server";
          import * as server from "@kovojs/server";
          import { sql } from "@kovojs/drizzle";
          import { barrelDomain } from "./server-barrel";
          import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
          const localDomain = dom;

          export const posts = pgTable("posts", { id: text("id").primaryKey() }, kovo({ domain: "post", key: "id" }));

          export const postQuery = query("post", {
            output: s.object({ id: s.string(), tagCount: s.number() }),
            reads: [dom("tag"), server.tag("topic"), localDomain("local"), barrelDomain("barrel")],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db
                .select({ id: posts.id, tagCount: sql<number>\`(SELECT count(*) FROM tags)\` })
                .from(posts);
            },
          });
        `,
        },
      ],
    });

    expect(facts[0]?.reads).toEqual(['barrel', 'local', 'post', 'tag', 'topic']);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('does not fold a local domain() shadow as a framework declared read', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'post.queries.ts',
          source: `
          import { query, s } from "@kovojs/server";
          import { sql } from "@kovojs/drizzle";
          import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
          function domain(value: string) { return { key: value }; }

          export const posts = pgTable("posts", { id: text("id").primaryKey() }, kovo({ domain: "post", key: "id" }));

          export const postQuery = query("post", {
            output: s.object({ id: s.string(), tagCount: s.number() }),
            reads: [domain("tag")],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db
                .select({ id: posts.id, tagCount: sql<number>\`(SELECT count(*) FROM tags)\` })
                .from(posts);
            },
          });
        `,
        },
      ],
    });

    expect(facts[0]?.reads).toEqual(['post']);
    expect(diagnosticsForQueryFacts(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV410',
          message: expect.stringContaining('dynamic or spread reads fail closed'),
        }),
      ]),
    );
  });

  it('reports KV410 for a fully-raw opaque read whose reads: resolves to no domain', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<unknown[]>;']),
        {
          fileName: 'product.queries.ts',
          source: `
          // A Domain-typed value the analyzer cannot trace to a domain key (no domain()/tag() call):
          // the declared opaque read suppresses the generic KV406, so the empty folded read set must
          // surface as KV410 (§10.2) instead of becoming silent staleness.
          declare const externalDomain: { key: string };

          export const rawQuery = query("product/raw", {
            output: s.object({ n: s.number() }),
            reads: [externalDomain],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.execute(sql\`SELECT count(*) AS n FROM things\`);
            },
          });
        `,
        },
      ],
    });

    expect(facts[0]?.reads).toEqual([]);
    expect(diagnosticsForQueryFacts(facts)).toMatchObject([
      {
        code: 'KV410',
        message: expect.stringContaining('resolves to no invalidation domain'),
        severity: 'error',
      },
    ]);
  });

  it('reports KV411 for a declared reads: entry naming an exempt table', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const auditLog = pgTable("audit_log", { id: text("id").primaryKey() }, kovo({ exempt: true }));
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            output: s.object({ name: s.string() }),
            // An exempt table named in reads: is KV411, exactly as a statically-visible join would be.
            reads: [auditLog],
            load(_input, db: PgAsyncDatabase<any, any>) {
              return db.select({ name: products.name }).from(products);
            },
          });
        `,
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV411',
        message: 'Query read set includes an exempt table. Tables: audit_log.',
        severity: 'error',
        site: 'product.queries.ts:5',
      },
    ]);
  });

  it('leaves a builder-derived read set unchanged when no reads: is declared', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgAsyncDatabase<any, any>) {
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
        shape: { name: 'string' },
        site: 'product.queries.ts:4',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });
});
