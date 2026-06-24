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
  "import { integer, pgTable, text, type PgDatabase } from 'drizzle-orm/pg-core';",
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
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", { cartId: text("cart_id").notNull(), productId: text("product_id").notNull(), qty: integer("qty").notNull() }, kovo({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", { id: text("id").primaryKey() }, kovo({ domain: "product", key: "id" }));',
            '',
            'export const cartQuery = query("cart", {',
            '  output: s.object({ count: s.number() }),',
            '  async load(input, db: PgDatabase<any, any, any>) {',
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
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  name: text("name").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'export const distinctProducts = query("products/distinct", {',
            '  load(_input, db: PgDatabase<any, any, any>) {',
            '    return db.selectDistinct({ name: products.name }).from(products);',
            '  },',
            '});',
            '',
            'export const firstProductNames = query("products/distinct-on", {',
            '  load(_input, db: PgDatabase<any, any, any>) {',
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

  it('extracts project query instance keys from static element access predicates', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        ]),
        {
          fileName: 'cart.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {',
            '  cartId: text("cart_id").notNull(),',
            '  qty: integer("qty").notNull(),',
            '}, kovo({ domain: "cart", key: "cartId" }));',
            '',
            'export const cartQuery = query("cart", {',
            '  load(input, db: PgDatabase<any, any, any>) {',
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
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {',
            '  sessionId: text("session_id").notNull(),',
            '  id: text("id").notNull(),',
            '  title: text("title").notNull(),',
            '}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export const questionDetail = query("questionDetail", {',
            '  load(input: { id: string }, db: PgDatabase<any, any, any>, context: { request?: { session?: { id?: string } | null } }) {',
            '    const sessionId = context.request?.session?.id;',
            '    if (!sessionId) throw new Error("auth required");',
            '    return db.select({ title: questions.title }).from(questions).where(and(eq(questions.sessionId, sessionId), eq(questions.id, input.id)));',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
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
        site: 'question.queries.ts:10',
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
              load(input, db: PgDatabase) {
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
              load(input, db: PgDatabase) {
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
            async load(_input, db: PgDatabase) {
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
            load(_input, db: PgDatabase) {
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
          import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
          import { sqliteTable, sqliteView, text } from "drizzle-orm/sqlite-core";

          export const products = sqliteTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, kovo({ domain: "product", key: "id" }));
          export const productSearch = sqliteView("product_search").as((qb) => qb.select({ name: products.name }).from(products));

          export const searchQuery = query("search/sqlite", {
            output: s.object({ name: s.string() }),
            load(_input, db: BaseSQLiteDatabase) {
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
            load(_input, db: PgDatabase) {
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
            load(_input, db: PgDatabase) {
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
            load(_input, db: PgDatabase) {
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
            async load(_input, db: PgDatabase) {
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
            async load(input, db: PgDatabase) {
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

  it('recognizes static AST output schema properties for opaque projections', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.queries.ts',
          source: `
          export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));

          export const literalOutputQuery = query("cart/literal", {
            "output": s.object({ count: s.number() }),
            async load(_input, db: PgDatabase) {
              return db.select({ count: sql<number>\`count(*)\` }).from(cartItems);
            },
          });

          export const computedOutputQuery = query("cart/computed", {
            ["output"]: s.object({ count: s.number() }),
            async load(_input, db: PgDatabase) {
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
            load(_input, db: PgDatabase) {
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
          'Secret query value reaches the client wire. Query projection user.count is opaque or unresolved while reading secret-classified table(s): users. Remove the opaque projection, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'user.queries.ts:7',
      },
    ]);
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
            '  load(_input, db: PgDatabase) {',
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
            '  load(_input, db: PgDatabase) {',
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
            '  load(_input, db: PgDatabase) {',
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
            '  load(_input, db: PgDatabase) {',
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
            '  load(_input, db: PgDatabase) {',
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
            load(_input, db: PgDatabase) {
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
          'Secret query value reaches the client wire. Query projection user.computed:[displayKey] is opaque or unresolved while reading secret-classified table(s): users. Remove the opaque projection, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'user.queries.ts:8',
      },
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection user.spread:publicColumns is opaque or unresolved while reading secret-classified table(s): users. Remove the opaque projection, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).',
        severity: 'error',
        site: 'user.queries.ts:8',
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
            async load(_input, db: PgDatabase) {
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
            async load(_input, db: PgDatabase) {
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
            async load(input, db: PgDatabase) {
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
            async load(_input, db: PgDatabase) {
              return db.select({ count: sql<number>\`count(*)\` }).from(cartItems);
            },
          });

          export const spreadOutputQuery = query("cart/spread", {
            ...sharedQueryConfig,
            async load(_input, db: PgDatabase) {
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
            load(input, db: PgDatabase) {
              return db.select({ sku: products.sku }).from(products).where(eq(products.sku, input.sku));
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
            load(input, db: PgDatabase) {
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
            load(_input, db: PgDatabase) {
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
            load(_input, db: PgDatabase) {
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
            load(_input, db: PgDatabase) {
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
            load(_input, db: PgDatabase) {
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
            load(_input, db: PgDatabase) {
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
            load(_input, db: PgDatabase) {
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

  it('keeps raw query receiver calls visible as KV433 query facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product/raw", {
            load(_input, db: PgDatabase) {
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
            code: 'KV433',
            message:
              'Query loader reaches a write without an elevated query capability. Query loader calls db.execute().',
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
            load(_input, db: PgDatabase) {
              return db.execute(sql\`select id, stock from products\`);
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
            code: 'KV433',
            message:
              'Query loader reaches a write without an elevated query capability. Query loader calls db.execute().',
            severity: 'error',
            site: 'product.queries.ts:4',
          },
        ],
        query: 'product/raw',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:4',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV433',
        message:
          'Query loader reaches a write without an elevated query capability. Query loader calls db.execute().',
        severity: 'error',
        site: 'product.queries.ts:4',
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
              load(_input, db: PgDatabase, fake: FakeDb) {
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
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db[method]().',
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
            load(_input, db: PgDatabase) {
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
            load(_input, db: PgDatabase) {
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
        query: 'users',
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
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
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
            load(_input, db: PgDatabase) {
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
        query: 'posts',
        reads: ['post'],
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
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('reports KV435 when relational with projections select nested secret columns', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'post.queries.ts',
          source: `
          export const users = pgTable("users", {
            id: text("id").primaryKey(),
            passwordHash: text("password_hash").notNull(),
          }, kovo({ domain: "user", key: "id", secret: ["passwordHash"], secretTable: true }));
          export const posts = pgTable("posts", {
            id: text("id").primaryKey(),
          }, kovo({ domain: "post", key: "id" }));
          export const postsRelations = relations(posts, ({ one }) => ({
            author: one(users),
          }));

          export const postsQuery = query("posts", {
            load(_input, db: PgDatabase) {
              return db.query.posts.findMany({
                columns: {
                  id: true,
                },
                with: {
                  author: {
                    columns: {
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

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection posts.author.passwordHash selects a secret field from secret-classified table(s): users.',
        severity: 'error',
        site: 'post.queries.ts:12',
      },
    ]);
  });

  it('reports KV435 for renamed secret-table imports in relational query projections', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'schema.ts',
          source: `
            export const users = pgTable("users", {
              id: text("id").primaryKey(),
              passwordHash: text("password_hash").notNull(),
            }, kovo({ domain: "user", key: "id", secret: ["passwordHash"], secretTable: true }));
          `,
        },
        {
          fileName: 'user.queries.ts',
          source: `
            import { users as accounts } from "./schema";

            export const usersQuery = query("users/alias-import", {
              load(_input, db: PgDatabase) {
                return db.query.users.findMany({
                  columns: {
                    passwordHash: true,
                  },
                  where: eq(accounts.id, "u_1"),
                });
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
          'Secret query value reaches the client wire. Query projection users/alias-import.passwordHash selects a secret field from secret-classified table(s): users.',
        severity: 'error',
        site: 'user.queries.ts:4',
      },
    ]);
  });

  it('reports KV435 for Drizzle table aliases targeting secret-classified tables', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'drizzle-pg-core-extra.d.ts',
          source: [
            'declare module "drizzle-orm/pg-core" {',
            '  export function alias(table: unknown, name: string): unknown;',
            '}',
          ].join('\n'),
        },
        {
          fileName: 'schema.ts',
          source: `
            export const users = pgTable("users", {
              id: text("id").primaryKey(),
              passwordHash: text("password_hash").notNull(),
            }, kovo({ domain: "user", key: "id", secret: ["passwordHash"], secretTable: true }));
          `,
        },
        {
          fileName: 'user.queries.ts',
          source: [
            'import { alias, type PgDatabase } from "drizzle-orm/pg-core";',
            'import { users } from "./schema";',
            '',
            'const userAlias = alias(users, "u");',
            '',
            'export const usersQuery = query("users/table-alias", {',
            '  load(_input, db: PgDatabase) {',
            '    return db.query.users.findMany({',
            '      columns: {',
            '        passwordHash: true,',
            '      },',
            '      where: eq(userAlias.id, "u_1"),',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'KV435',
        message:
          'Secret query value reaches the client wire. Query projection users/table-alias.passwordHash selects a secret field from secret-classified table(s): users.',
        severity: 'error',
        site: 'user.queries.ts:6',
      },
    ]);
  });

  it('keeps static element-access relational API reads visible as KV406 query facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: `
          export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));

          export const usersQuery = query("users", {
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
              load(_input, db: PgDatabase) {
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
      '  load(_input: unknown, db: PgDatabase<any, any, any>) {',
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
      '  load(_input: unknown, db: PgDatabase<any, any, any>) {',
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
      '  load(_input: unknown, db: PgDatabase<any, any, any>) {',
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
