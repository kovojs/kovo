import { describe, expect, it } from 'vitest';

import {
  diagnosticsForQueryFacts,
  extractTouchGraphFromProject,
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

const extractQueryFactsFromProject = (
  options: Parameters<typeof extractQueryFactsFromProjectBase>[0],
) => extractQueryFactsFromProjectBase(withPgDatabaseTypes(options));

describe('@kovojs/drizzle touch graph helpers', () => {
  it('does not fabricate query reads or relational diagnostics from comments and strings', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const auditLog = pgTable("audit_log", {}, kovo({ exempt: true }));
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgAsyncDatabase<any, any>) {
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
        site: 'product.queries.ts:5',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('does not fabricate relational query facts from non-receiver objects', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const auditLog = pgTable("audit_log", {}, kovo({ exempt: true }));
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, reader: PgAsyncDatabase<any, any>) {
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
        site: 'product.queries.ts:5',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('does not fabricate select reads or instance keys from non-receiver builders', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const auditLog = pgTable("audit_log", { productId: text("product_id").notNull() }, kovo({ exempt: true }));
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(input, reader: PgAsyncDatabase<any, any>) {
              const fixture = {
                select() { return this; },
                from() { return this; },
                leftJoin() { return this; },
                where() { return this; },
              };
              function unrelated() {
                return fixture
                  .select()
                  .from(auditLog)
                  .leftJoin(auditLog, eq(auditLog.productId, products.id))
                  .where(eq(products.id, input.id));
              }
              unrelated();
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
        site: 'product.queries.ts:5',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('does not fabricate source query facts from arbitrary destructured loader bindings', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
          }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product/destructured-fake", {
            load(_input, { fake }) {
              return fake.select({ id: products.id }).from(products);
            },
          });
        `,
        },
      ],
    });

    expect(facts).toEqual([]);
  });

  it('marks source query-loader db destructuring as KV406 instead of deriving reads', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
          }, kovo({ domain: "product", key: "id" }));

          export const productQuery = query("product/destructured-db", {
            load(_input, { db: reader }) {
              return reader.select({ id: products.id }).from(products);
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
              'Statically un-analyzable write site; manual touches required. Query uses an un-provable destructured Drizzle receiver surface select() without project type proof.',
            severity: 'error',
            site: 'product.queries.ts:6',
          },
        ],
        query: 'product/destructured-db',
        reads: [],
        shape: {},
        site: 'product.queries.ts:6',
      },
    ]);
  });

  it('marks quoted source query-loader db destructuring as KV406 instead of deriving reads', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'export const productQuery = query("product/quoted-destructured-db", {',
            '  load(_input, { "db": reader }) {',
            '    return reader.select({ id: products.id }).from(products);',
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
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses an un-provable destructured Drizzle receiver surface select() without project type proof.',
            severity: 'error',
            site: 'product.queries.ts:5',
          },
        ],
        query: 'product/quoted-destructured-db',
        reads: [],
        shape: {},
        site: 'product.queries.ts:5',
      },
    ]);
  });

  it('does not scan non-load query callbacks as loader facts', () => {
    const files = [
      {
        fileName: 'product.queries.ts',
        source: [
          'import { sql } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const auditLog = pgTable("audit_log", {',
          '  id: text("id").primaryKey(),',
          '}, kovo({ exempt: true }));',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'export const productQuery = query("product/non-loader-callback", {',
          '  guard(_input, db: PgAsyncDatabase<any, any>) {',
          '    db.execute(sql`select * from audit_log`);',
          '    return db.select({ id: auditLog.id }).from(auditLog);',
          '  },',
          '  load(_input, db: PgAsyncDatabase<any, any>) {',
          '    return db.select({ id: products.id }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ];

    for (const facts of [extractQueryFactsFromProject({ files })]) {
      expect(facts).toEqual([
        {
          query: 'product/non-loader-callback',
          reads: ['product'],
          shape: {
            id: 'string',
          },
          site: 'product.queries.ts:11',
        },
      ]);
      expect(diagnosticsForQueryFacts(facts)).toEqual([]);
    }
  });

  it('does not discover query definitions from comments strings or templates', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'audit.queries.ts',
          source: [
            'export const auditLog = pgTable("audit_log", { message: text("message").notNull() }, kovo({ domain: "audit", key: "id" }));',
            '',
            '// export const commentedQuery = query("commented", { load(_input, db: PgAsyncDatabase<any, any>) { return db.select({ message: auditLog.message }).from(auditLog); } });',
            'const quoted = \'export const quotedQuery = query("quoted", { load(_input, db: PgAsyncDatabase<any, any>) { return db.select({ message: auditLog.message }).from(auditLog); } });\';',
            'const templated = `export const templatedQuery = query("templated", { load(_input, db: PgAsyncDatabase<any, any>) { return db.select({ message: auditLog.message }).from(auditLog); } });`;',
            'export const keepModule = { quoted, templated };',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('resolves imported table symbols in project query facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.schema.ts',
          source: `
            export const items = pgTable("cart_items", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'order.schema.ts',
          source: `
            export const items = pgTable("order_items", {}, kovo({ domain: "order", key: "id" }));
          `,
        },
        {
          fileName: 'cart.queries.ts',
          source: `
            import { items } from "./cart.schema";

            export const cartQuery = query("cart", {
              load(input, db: PgAsyncDatabase<any, any>) {
                return db.select({ id: items.id }).from(items).where(eq(items.id, input.id));
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
        site: 'cart.queries.ts:4',
      },
    ]);
  });

  it('does not leak source extraction state between repeated project calls', () => {
    const first = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'schema.ts',
          source: `
            export const items = pgTable("cart_items", {
              id: text("id").primaryKey(),
              qty: integer("qty").notNull(),
            }, kovo({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'queries.ts',
          source: `
            import { items } from "./schema";

            export const itemQuery = query("item", {
              load(input, db: PgAsyncDatabase<any, any>) {
                return db.select({ qty: items.qty }).from(items).where(eq(items.id, input.id));
              },
            });
          `,
        },
      ],
    });
    const second = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'schema.ts',
          source: `
            export const items = pgTable("order_items", {
              id: text("id").primaryKey(),
              qty: text("qty").notNull(),
            }, kovo({ domain: "order", key: "id" }));
          `,
        },
        {
          fileName: 'queries.ts',
          source: `
            import { items } from "./schema";

            export const itemQuery = query("item", {
              load(input, db: PgAsyncDatabase<any, any>) {
                return db.select({ qty: items.qty }).from(items).where(eq(items.id, input.id));
              },
            });
          `,
        },
      ],
    });

    expect(first).toEqual([
      {
        instanceKey: {
          domain: 'cart',
          key: 'arg:id',
        },
        query: 'item',
        reads: ['cart'],
        shape: {
          qty: 'number',
        },
        site: 'queries.ts:4',
      },
    ]);
    expect(second).toEqual([
      {
        instanceKey: {
          domain: 'order',
          key: 'arg:id',
        },
        query: 'item',
        reads: ['order'],
        shape: {
          qty: 'string',
        },
        site: 'queries.ts:4',
      },
    ]);
  });

  it('marks project-mode computed query read sources as KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'schema.ts',
          source: `
            export const items = pgTable("cart_items", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'queries.ts',
          source: `
            import { items } from "./schema";

            function tableFor<T>(table: T): T { return table; }

            export const itemQuery = query("item", {
              load(_input, db: PgAsyncDatabase<any, any>) {
                return db.select({ id: items.id }).from(tableFor(items));
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
              'Statically un-analyzable write site; manual touches required. Query read source for db.from() could not be resolved to a Drizzle table.',
            severity: 'error',
            site: 'queries.ts:6',
          },
        ],
        query: 'item',
        reads: [],
        shape: {
          id: 'string',
        },
        site: 'queries.ts:6',
      },
    ]);
  });

  it('does not leak project extraction state between repeated touch graph calls', () => {
    const first = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'schema.ts',
          source: `
            export const items = pgTable("cart_items", {}, kovo({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'import { items } from "./schema";',
            '',
            'export async function save(writer: PgAsyncDatabase<any, any>, id: string) {',
            '  await writer.update(items).set({ id }).where(eq(items.id, id));',
            '}',
          ].join('\n'),
        },
      ],
    });
    const second = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'schema.ts',
          source: `
            export const items = pgTable("order_items", {}, kovo({ domain: "order", key: "id" }));
          `,
        },
        {
          fileName: 'domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'import { items } from "./schema";',
            '',
            'export async function save(writer: PgAsyncDatabase<any, any>, id: string) {',
            '  await writer.update(items).set({ id }).where(eq(items.id, id));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(first).toEqual({
      save: {
        reads: [],
        touches: [{ domain: 'cart', keys: 'arg:id', site: 'domain.ts:5', via: 'cart_items' }],
        unresolved: [],
      },
    });
    expect(second).toEqual({
      save: {
        reads: [],
        touches: [{ domain: 'order', keys: 'arg:id', site: 'domain.ts:5', via: 'order_items' }],
        unresolved: [],
      },
    });
  });
});
