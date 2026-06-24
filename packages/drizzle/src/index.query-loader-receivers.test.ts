import { describe, expect, it } from 'vitest';

import {
  diagnosticsForQueryFacts,
  extractTouchGraphFromProject,
  extractQueryFactsFromProject,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

const queryReceiverTypes = pgDatabaseTypes([
  '$count(table: unknown): Promise<number>;',
  '$with(name: string): unknown;',
  'execute(query: unknown): Promise<void>;',
  'query: any;',
  'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
  'update(table: unknown): { set(value: unknown): Promise<void> };',
]);

describe('@kovojs/drizzle touch graph helpers', () => {
  it('does not fabricate project query facts from untyped shorthand query-loader receivers', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'const load = (_input, db) => {',
            '  db.update(products);',
            '  return db.select({ id: products.id }).from(products);',
            '};',
            '',
            'export const productQuery = query("product/untyped-shorthand-loader", {',
            '  load,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([]);
  });

  it('extracts project query-loader direct typed receiver carrier members', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        queryReceiverTypes,
        {
          fileName: 'product.queries.ts',
          source: [
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export const productQuery = query("product/carrier-direct", {',
            '  async load(_input, db: PgDatabase, fake: FakeDb) {',
            '    const carrier = { db, fake };',
            '    await carrier.db.execute("select 1");',
            '    await carrier.db.update(products).set({ id: "p1" });',
            '    await carrier.db.query.products.findMany();',
            '    await carrier.fake.execute("select 1");',
            '    await carrier.fake.update(products).set({ id: "fake" });',
            '    await carrier.fake.query.products.findMany();',
            '    return [];',
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
            code: 'KV433',
            message:
              'Query loader reaches a write without an elevated query capability. Query loader calls carrier.db.execute().',
            severity: 'error',
            site: 'product.queries.ts:11',
          },
          {
            code: 'KV433',
            message:
              'Query loader reaches a write without an elevated query capability. Query loader calls carrier.db.update().',
            severity: 'error',
            site: 'product.queries.ts:11',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'error',
            site: 'product.queries.ts:11',
          },
        ],
        query: 'product/carrier-direct',
        reads: ['product'],
        shape: {},
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('extracts project query-loader nested typed receiver carrier members', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        queryReceiverTypes,
        {
          fileName: 'product.queries.ts',
          source: [
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export const productQuery = query("product/carrier-nested", {',
            '  async load(_input, db: PgDatabase, fake: FakeDb) {',
            '    const carrier = { db, fake };',
            '    const nested = { inner: carrier };',
            '    const overwritten = { ...nested, inner: { db: fake } };',
            '    const execute = nested.inner.db.execute;',
            '    await nested.inner.db.execute("select 1");',
            '    await nested.inner.db.update(products).set({ id: "p1" });',
            '    await nested.inner.db.query.products.findMany();',
            '    await execute("select 1");',
            '    await runReport(nested);',
            '    await overwritten.inner.db.execute("select 1");',
            '    await overwritten.inner.db.update(products).set({ id: "fake" });',
            '    await overwritten.inner.db.query.products.findMany();',
            '    return [];',
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
            code: 'KV433',
            message:
              'Query loader reaches a write without an elevated query capability. Query loader calls nested.inner.db.execute().',
            severity: 'error',
            site: 'product.queries.ts:11',
          },
          {
            code: 'KV433',
            message:
              'Query loader reaches a write without an elevated query capability. Query loader calls nested.inner.db.update().',
            severity: 'error',
            site: 'product.queries.ts:11',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'error',
            site: 'product.queries.ts:11',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'product.queries.ts:11',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver nested to helper runReport().',
            severity: 'error',
            site: 'product.queries.ts:11',
          },
        ],
        query: 'product/carrier-nested',
        reads: ['product'],
        shape: {},
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('marks project query-loader detached receiver method aliases as KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        queryReceiverTypes,
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "product", key: "id" }));

            interface FakeDb {
              execute(query: unknown): Promise<void>;
              query: any;
              update(table: unknown): { set(value: unknown): Promise<void> };
            }

            export const productQuery = query("product/detached-methods", {
              async load(_input, db: PgDatabase, fake: FakeDb) {
                const { execute, update: write, query: relations } = db;
                const carrier = { db, fake };
                const carrierExecute = carrier.db.execute;
                const carrierFakeExecute = carrier.fake.execute;
                const fakeExecute = fake.execute;
                const countProducts = db["$count"];
                await execute("select 1");
                await write(products).set({ id: "p1" });
                await carrierExecute("select 1");
                await carrierFakeExecute("select 1");
                await fakeExecute("select 1");
                await countProducts(products);
                return relations.products.findMany();
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
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'product.queries.ts:12',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method update().',
            severity: 'error',
            site: 'product.queries.ts:12',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'product.queries.ts:12',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method $count().',
            severity: 'error',
            site: 'product.queries.ts:12',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method query().',
            severity: 'error',
            site: 'product.queries.ts:12',
          },
        ],
        query: 'product/detached-methods',
        reads: [],
        shape: {},
        site: 'product.queries.ts:12',
      },
    ]);
  });

  it('keeps project query-loader reads through Postgres with() select chains', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        queryReceiverTypes,
        {
          fileName: 'product.queries.ts',
          source: [
            'import { pgTable, text, type PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'export const productQuery = query("product/with-read", {',
            '  load(_input, db: PgDatabase) {',
            '    const active = db.$with("active_products").as(db.select({ id: products.id }).from(products));',
            '    return db.with(active).select({ id: products.id }).from(products);',
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
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db.$with().',
            severity: 'error',
            site: 'product.queries.ts:7',
          },
        ],
        query: 'product/with-read',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.queries.ts:7',
      },
    ]);
  });

  it('uses project query-loader detached receiver method symbols without name fallback', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        queryReceiverTypes,
        {
          fileName: 'product.queries.ts',
          source: [
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            '',
            'export const productQuery = query("product/detached-symbols", {',
            '  async load(_input, db: PgDatabase, fake: FakeDb) {',
            '    const { execute } = db;',
            '    await execute("select 1");',
            '    {',
            '      const execute = fake.execute;',
            '      await execute("select 1");',
            '    }',
            '    let assignedExecute;',
            '    assignedExecute = db.execute;',
            '    await assignedExecute("select 1");',
            '    {',
            '      let assignedExecute;',
            '      assignedExecute = fake.execute;',
            '      await assignedExecute("select 1");',
            '    }',
            '    return [];',
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
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'product.queries.ts:5',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'product.queries.ts:5',
          },
        ],
        query: 'product/detached-symbols',
        reads: [],
        shape: {},
        site: 'product.queries.ts:5',
      },
    ]);
  });

  it('marks project query-loader bound receiver method aliases as KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        queryReceiverTypes,
        {
          fileName: 'product.queries.ts',
          source: `
            interface FakeDb {
              execute(query: unknown): Promise<void>;
            }

            export const productQuery = query("product/bound-methods", {
              async load(_input, db: PgDatabase, fake: FakeDb, method: string) {
                const execute = db.execute.bind(db);
                const computed = db[method].bind(db);
                const fakeExecute = fake.execute.bind(fake);
                await execute("select 1");
                await computed("select 1");
                await fakeExecute("select 1");
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
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'product.queries.ts:6',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method <computed>().',
            severity: 'error',
            site: 'product.queries.ts:6',
          },
        ],
        query: 'product/bound-methods',
        reads: [],
        shape: {},
        site: 'product.queries.ts:6',
      },
    ]);
  });

  it('does not fabricate project query facts from explicitly typed non-Drizzle receivers', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            interface FakeDb {
              select(projection: unknown): { from(table: unknown): unknown };
              update(table: unknown): unknown;
            }

            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "product", key: "id" }));

            export const productQuery = query("product/fake-db", {
              load(_input, db: FakeDb) {
                db.update(products);
                return db.select({ id: products.id }).from(products);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([]);
  });

  it('does not fabricate project query facts from untyped source-mode receiver names', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "product", key: "id" }));

            export const productQuery = query("product/untyped-db", {
              load(_input, db) {
                db.update(products);
                return db.select({ id: products.id }).from(products);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([]);
  });

  it('does not fabricate project query facts from shadowed receiver names', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        ]),
        {
          fileName: 'product.queries.ts',
          source: [
            'import { sql } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
            '}',
            '',
            'export const auditLog = pgTable("audit_log", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ exempt: true }));',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'export const productQuery = query("product/shadowed-db", {',
            '  async load(_input, db: PgDatabase, fake: FakeDb) {',
            '    {',
            '      const db = fake;',
            '      await db.execute(sql`select * from audit_log`);',
            '      await db.select({ id: auditLog.id }).from(auditLog);',
            '    }',
            '    return db.select({ id: products.id }).from(products);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/shadowed-db',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.queries.ts:16',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('marks query-loader helpers receiving db as KV406 instead of dropping the query fact', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        queryReceiverTypes,
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "product", key: "id" }));

            declare function loadProducts(receiver: unknown): Promise<unknown[]>;
            declare function readCache(client: unknown): Promise<unknown[]>;

            export const productQuery = query("product/helper", {
              async load(_input, db: PgDatabase) {
                await readCache(cache);
                return loadProducts(db);
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
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper loadProducts().',
            severity: 'error',
            site: 'product.queries.ts:9',
          },
        ],
        query: 'product/helper',
        reads: [],
        shape: {},
        site: 'product.queries.ts:9',
      },
    ]);
  });

  it('marks query-loader member helpers receiving db as KV406 instead of dropping the query fact', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        queryReceiverTypes,
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "product", key: "id" }));

            declare const productServices: {
              loadProducts(receiver: unknown): Promise<unknown[]>;
              readCache(client: unknown): Promise<unknown[]>;
            };

            export const productQuery = query("product/member-helper", {
              async load(_input, db: PgDatabase) {
                await productServices.readCache(cache);
                return productServices.loadProducts(db);
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
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper productServices.loadProducts().',
            severity: 'error',
            site: 'product.queries.ts:11',
          },
        ],
        query: 'product/member-helper',
        reads: [],
        shape: {},
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('marks query-loader helpers receiving db through containers as KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        queryReceiverTypes,
        {
          fileName: 'product.queries.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";

            interface FakeDb {
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
            }

            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "product", key: "id" }));

            declare function loadProducts(context: unknown): Promise<unknown[]>;

            export const productQuery = query("product/helper-context", {
              async load(_input, db: PgDatabase, fake: FakeDb) {
                await loadProducts({ fake });
                return loadProducts({ db });
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
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper loadProducts().',
            severity: 'error',
            site: 'product.queries.ts:14',
          },
        ],
        query: 'product/helper-context',
        reads: [],
        shape: {},
        site: 'product.queries.ts:14',
      },
    ]);
  });

  it('marks query-loader helpers receiving typed Drizzle context containers as KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface DrizzleContext { db: PgDatabase }',
            'interface FakeContext { db: unknown }',
            'declare function loadProducts(context: unknown): Promise<unknown[]>;',
            '',
            'export const productQuery = query("product/helper-typed-context", {',
            '  async load(_input, context: DrizzleContext, fake: FakeContext) {',
            '    await loadProducts({ fake });',
            '    return loadProducts({ context });',
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
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to helper loadProducts().',
            severity: 'error',
            site: 'product.queries.ts:7',
          },
        ],
        query: 'product/helper-typed-context',
        reads: [],
        shape: {},
        site: 'product.queries.ts:7',
      },
    ]);
  });

  it('marks local query-loader helpers receiving carrier aliases as KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        queryReceiverTypes,
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
            '}',
            '',
            'function runReport(context: unknown): Promise<unknown[]> {',
            '  return Promise.resolve([]);',
            '}',
            '',
            'export const productQuery = query("product/local-carrier-helper", {',
            '  async load(_input, db: PgDatabase, fake: FakeDb) {',
            '    const context = { db };',
            '    const fakeContext = { db: fake };',
            '    await runReport(fakeContext);',
            '    return runReport(context);',
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
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to local helper runReport().',
            severity: 'error',
            site: 'product.queries.ts:11',
          },
        ],
        query: 'product/local-carrier-helper',
        reads: [],
        shape: {},
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('marks local query-loader helpers receiving assigned carrier aliases as KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        queryReceiverTypes,
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
            '}',
            '',
            'function runReport(context: unknown): Promise<unknown[]> {',
            '  return Promise.resolve([]);',
            '}',
            '',
            'export const productQuery = query("product/local-assigned-carrier-helper", {',
            '  async load(_input, db: PgDatabase, fake: FakeDb) {',
            '    let context;',
            '    context = { db };',
            '    let fakeContext;',
            '    fakeContext = { db: fake };',
            '    await runReport(fakeContext);',
            '    return runReport(context);',
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
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to local helper runReport().',
            severity: 'error',
            site: 'product.queries.ts:11',
          },
        ],
        query: 'product/local-assigned-carrier-helper',
        reads: [],
        shape: {},
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('folds local query-loader helper reads into query facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
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
            'function loadProducts(db: PgDatabase<any, any, any>) {',
            '  return db.select({ name: products.name }).from(products);',
            '}',
            '',
            'export const productQuery = query("product/helper-local", {',
            '  load(_input, db: PgDatabase<any, any, any>) {',
            '    return loadProducts(db);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/helper-local',
        reads: ['product'],
        shape: {},
        site: 'product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('folds local query-loader helper reads through typed receiver carriers', () => {
    const facts = extractQueryFactsFromProject({
      files: [
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
            'function loadProducts({ db }: { db: PgDatabase<any, any, any> }) {',
            '  return db.select({ name: products.name }).from(products);',
            '}',
            '',
            'export const productQuery = query("product/helper-carrier-local", {',
            '  load(_input, db: PgDatabase<any, any, any>) {',
            '    const context = { db };',
            '    return loadProducts(context);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/helper-carrier-local',
        reads: ['product'],
        shape: {},
        site: 'product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('folds destructured local helper members into query and touch summaries', () => {
    const files = [
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'function loadProducts(db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id }).from(products);',
          '}',
          'function touchProduct(db: PgDatabase<any, any, any>) {',
          '  return db.update(products).set({ id: "p1" });',
          '}',
          '',
          'const helpers = { nested: { loadProducts, touchProduct } };',
          'const { nested: { loadProducts: loadFromHelper, touchProduct: touchFromHelper } } = helpers;',
          '',
          'export const productQuery = query("product/destructured-local-helper", {',
          '  load(_input, db: PgDatabase<any, any, any>) {',
          '    return loadFromHelper(db);',
          '  },',
          '});',
          '',
          'export async function syncProduct(db: PgDatabase<any, any, any>) {',
          '  await touchFromHelper(db);',
          '}',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/destructured-local-helper',
        reads: ['product'],
        shape: {},
        site: 'product.domain.ts:17',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      loadProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:8',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [],
        unresolved: [],
      },
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:11',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      touchProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:11',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('marks local query-loader helper writes as KV433', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'async function writeProducts(db: PgDatabase<any, any, any>) {',
            '  await db.update(products).set({ id: "p1" });',
            '}',
            '',
            'export const productQuery = query("product/helper-write", {',
            '  async load(_input, db: PgDatabase<any, any, any>) {',
            '    await writeProducts(db);',
            '    return [];',
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
            code: 'KV433',
            message:
              'Query loader reaches a write without an elevated query capability. Query local helper reaches Drizzle update().',
            severity: 'error',
            site: 'product.queries.ts:8',
          },
        ],
        query: 'product/helper-write',
        reads: [],
        shape: {},
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('does not fabricate project query facts from uncalled nested loader helpers', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const auditLog = pgTable("audit_log", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "audit", key: "id" }));',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'export const productQuery = query("product/loader-helper", {',
            '  load(_input, db: PgDatabase<any, any, any>) {',
            '    function readAudit(reader: PgDatabase<any, any, any>) {',
            '      return reader.select({ id: auditLog.id }).from(auditLog);',
            '    }',
            '',
            '    function readProducts(reader: PgDatabase<any, any, any>) {',
            '      return reader.select({ id: products.id }).from(products);',
            '    }',
            '',
            '    return readProducts(db);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/loader-helper',
        reads: ['product'],
        shape: {},
        site: 'product.queries.ts:10',
      },
    ]);
  });

  it('ignores uncalled nested query-loader helper predicates', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const auditLog = pgTable("audit_log", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "audit", key: "id" }));',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'export const productQuery = query("product/nested-predicate", {',
            '  load(input, db: PgDatabase<any, any, any>) {',
            '    function readAudit(reader: PgDatabase<any, any, any>) {',
            '      return reader.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.id, input.id));',
            '    }',
            '',
            '    return db.select({ id: products.id }).from(products).where(eq(products.id, input.id));',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        instanceKey: {
          domain: 'product',
          key: 'arg:id',
        },
        query: 'product/nested-predicate',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.queries.ts:11',
      },
    ]);
  });
});
