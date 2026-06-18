import { describe, expect, it } from 'vitest';

import {
  diagnosticsForQueryFacts,
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

const extractQueryFactsFromProject = (
  options: Parameters<typeof extractQueryFactsFromProjectBase>[0],
) => extractQueryFactsFromProjectBase(withPgDatabaseTypes(options));

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
              severity: 'warn',
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
            severity: 'warn',
            site: 'product.queries.ts:7',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query projection product.stock could not be resolved to a Drizzle column or typed sql<T> expression.',
            severity: 'warn',
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
            severity: 'warn',
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
            severity: 'warn',
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
            severity: 'warn',
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
            severity: 'warn',
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
        severity: 'warn',
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
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db.execute().',
            severity: 'warn',
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
            severity: 'warn',
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
            severity: 'warn',
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
        severity: 'warn',
        site: 'user.queries.ts:4',
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
            severity: 'warn',
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
            severity: 'warn',
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
            severity: 'warn',
            site: 'user.queries.ts:4',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query relational read source could not be resolved to a Drizzle table.',
            severity: 'warn',
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
