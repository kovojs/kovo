import { describe, expect, it } from 'vitest';

import {
  diagnosticsForQueryFacts,
  diagnosticsForTouchGraph,
  extractTouchGraphFromProject,
} from '../../../packages/drizzle/src/static.js';

import { extractQueryFactsFromProject } from './test-helpers.js';

describe('Drizzle pinned subset conformance', () => {
  it('pins domain action object aliases and opaque alias degradation under real Drizzle imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
            '}',
            '',
            'declare const dynamicActions: any;',
            'const actions = { add: write(addItem) };',
            '',
            'export const productDomain = domain(actions);',
            'export const dynamicProductDomain = domain(dynamicActions);',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      'dynamicProductDomain.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:15',
          },
        ],
      },
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins wrapped query and domain calls under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'declare const dynamicActions: any;',
          '',
          'export const productDomain = (domain({',
          '  add: (write(addItem) satisfies unknown),',
          '} as const) satisfies unknown);',
          'export const dynamicProductDomain = (domain(dynamicActions) as unknown);',
          '',
          "export const productQuery = (query('product/wrapped-real', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
          '  load(_input, db: PgDatabase<any, any, any>) {',
          '    return db.select({ id: products.id }).from(products);',
          '  },',
          '} as const) satisfies unknown);',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      'dynamicProductDomain.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:16',
          },
        ],
      },
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/wrapped-real',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:18',
      },
    ]);
  });

  it('pins wrapped variable-assigned local helpers under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'const readProducts = ((db: PgDatabase<any, any, any>) => {',
          '  return db.select({ id: products.id }).from(products);',
          '}) satisfies unknown;',
          '',
          'const touchProduct = (async (db: PgDatabase<any, any, any>, productId: string) => {',
          '  return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}) as unknown;',
          '',
          "export const productQuery = query('product/wrapped-helper-real', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
          '  load(_input, db: PgDatabase<any, any, any>) {',
          '    return readProducts(db);',
          '  },',
          '});',
          '',
          'export const productDomain = domain({',
          '  add: write((db: PgDatabase<any, any, any>, productId: string) => {',
          '    return touchProduct(db, productId);',
          '  }),',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/wrapped-helper-real',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.domain.ts:15',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      readProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [],
        unresolved: [],
      },
      touchProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins typed domain action spread members as KV406 under real Drizzle imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'declare const externalActions: {',
            '  addItem(db: PgDatabase<any, any, any>, productId: string): Promise<void>;',
            '};',
            '',
            'export const productDomain = domain({',
            '  ...externalActions,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'productDomain.addItem': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
          },
        ],
      },
    });
  });

  it('pins string-indexed domain action spreads as KV406 under real Drizzle imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));",
            '',
            'type ActionBag = {',
            '  [name: string]: ReturnType<typeof write>;',
            '};',
            'declare const indexedActions: ActionBag;',
            '',
            'export const cart = domain({',
            '  ...indexedActions,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:11',
          },
        ],
      },
    });
  });

  it('pins nested destructuring assignment receiver aliases under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface FakeContext { nested: { db: FakeDb } }',
          'interface DrizzleContext { nested: { db: PgDatabase<any, any, any> } }',
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'export async function syncProduct(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  let writer;',
          '  ({ nested: { db: writer } } = context);',
          '  let fakeWriter;',
          '  ({ nested: { db: fakeWriter } } = fake);',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 2 });',
          '}',
          '',
          "export const productQuery = query('product/nested-destructuring-assignment', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    let reader;',
          '    ({ nested: { db: reader } } = context);',
          '    let fakeReader;',
          '    ({ nested: { db: fakeReader } } = fake);',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:20',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/nested-destructuring-assignment',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:24',
      },
    ]);
  });

  it('pins query-loader receiver symbols without shadowed lookalike facts', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { sql } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              execute(query: unknown): Promise<void>;
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
            }

            export const auditLog = pgTable('audit_log', {
              id: text('id').primaryKey(),
            }, kovo({ exempt: true }));
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/shadowed-db', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {
                {
                  const db = fake;
                  await db.execute(sql\`select * from audit_log\`);
                  await db.select({ id: auditLog.id }).from(auditLog);
                }
                return db.select({ id: products.id }).from(products);
              },
            });
          `,
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
        site: 'conformance/drizzle-pin/src/product.queries.ts:17',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins detached query-loader receiver methods as KV406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              execute(query: unknown): Promise<void>;
              query: any;
            }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/detached-methods', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {
                const { execute, query: relations } = db;
                const fakeExecute = fake.execute;
                await execute('select 1');
                {
                  const execute = fake.execute;
                  await execute('select 1');
                }
                await fakeExecute('select 1');
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
            site: 'conformance/drizzle-pin/src/product.queries.ts:13',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method query().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:13',
          },
        ],
        query: 'product/detached-methods',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:13',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toHaveLength(2);
  });

  it('pins detached query-loader receiver method symbols without name fallback', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            '',
            "export const productQuery = query('product/detached-symbols', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '    const { execute } = db;',
            "    await execute('select 1');",
            '    {',
            '      const execute = fake.execute;',
            "      await execute('select 1');",
            '    }',
            '    let assignedExecute;',
            '    assignedExecute = db.execute;',
            "    await assignedExecute('select 1');",
            '    {',
            '      let assignedExecute;',
            '      assignedExecute = fake.execute;',
            "      await assignedExecute('select 1');",
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
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
        ],
        query: 'product/detached-symbols',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:7',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toHaveLength(2);
  });

  it('pins spread-copied typed receiver carrier members under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '}',
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            "export const productQuery = query('product/spread-carrier', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '    const carrier = { db, fake };',
            '    const spread = { ...carrier };',
            '    const overwritten = { ...carrier, db: fake };',
            "    await spread.db.execute('select 1');",
            "    await overwritten.db.execute('select 1');",
            '    return spread.db.query.products.findMany();',
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
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:12',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call spread.db.execute().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:12',
          },
        ],
        query: 'product/spread-carrier',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toHaveLength(2);
  });

  it('pins factory-returned typed receiver carriers as KV406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {}',
            'declare function runReport(context: unknown): Promise<unknown[]>;',
            'declare function makeContext(): { nested: { db: PgDatabase<any, any, any> } };',
            'declare function makeFakeContext(): { nested: { db: FakeDb } };',
            '',
            "export const productQuery = query('product/factory-carrier', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '    void db;',
            '    void fake;',
            '    await runReport(makeFakeContext());',
            '    await runReport(makeContext());',
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
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver makeContext() to helper runReport().',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:8',
          },
        ],
        query: 'product/factory-carrier',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:8',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toHaveLength(1);
  });
});
