import { describe, expect, it } from 'vitest';

import { eq, gt, inArray, sql } from 'drizzle-orm';
import {
  alias,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import * as pg from 'drizzle-orm/pg-core';

import {
  createTouchGraphEntry,
  diagnosticsForQueryFacts,
  diagnosticsForTouchGraph,
  extractQueryFactsFromProject,
  extractTouchGraphFromProject,
  jiso,
  serializeDomainRegistry,
  serializeTouchGraph,
} from '../../../packages/drizzle/src/static.js';

import { annotatedTable, drizzleSymbol } from './test-helpers.js';

describe('Drizzle pinned subset conformance', () => {
  it('pins project domain action namespace spreads for exported write variables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: `
            export const cartItems = pgTable('cart_items', {
              productId: text('product_id').primaryKey(),
            }, jiso({ domain: 'cart', key: 'productId' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/actions.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import { cartItems } from './schema';

            function addItem(db: PgDatabase<any, any, any>, productId: string) {
              return db.insert(cartItems).values({ productId });
            }

            export const addItemAction = write(addItem);
            export declare const hiddenAction: unknown;
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: `
            import * as CartActions from './actions';

            export const cart = domain({
              ...CartActions,
            });
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
            keys: null,
            site: 'conformance/drizzle-pin/src/actions.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:5',
          },
        ],
      },
      'cart.addItemAction': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins destructured static domain action aliases under real Drizzle imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: `
            export const cartItems = pgTable('cart_items', {
              productId: text('product_id').primaryKey(),
            }, jiso({ domain: 'cart', key: 'productId' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/actions.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import { cartItems } from './schema';

            function addItem(db: PgDatabase<any, any, any>, productId: string) {
              return db.insert(cartItems).values({ productId });
            }

            export class CartActions {
              static add = write(addItem);
              static get restock() {
                return write(addItem);
              }
            }
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: `
            import { CartActions } from './actions';

            const { add, restock: refill } = CartActions;

            export const cart = domain({
              add,
              refill,
            });
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
            keys: null,
            site: 'conformance/drizzle-pin/src/actions.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.add': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.refill': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins query-loader helper db handoff as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            declare function runReport(db: PgDatabase<any, any, any>): Promise<unknown[]>;

            export const productQuery = query('product/helper', {
              async load(_input, db: PgDatabase<any, any, any>) {
                return runReport(db);
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:10',
          },
        ],
        query: 'product/helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:10',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toHaveLength(1);
  });

  it('pins member helper Drizzle receiver handoffs as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            declare const reports: {
              run(db: PgDatabase<any, any, any>): Promise<unknown[]>;
              warm(cache: unknown): Promise<void>;
            };

            export const productQuery = query('product/member-helper', {
              async load(_input, db: PgDatabase<any, any, any>) {
                await reports.warm(cache);
                return reports.run(db);
              },
            });
          `,
        },
      ],
    });
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'declare const audit: {',
            '  write(db: PgDatabase<any, any, any>): Promise<void>;',
            '  preview(db: FakeDb): Promise<void>;',
            '};',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  await audit.write(db);',
            '  await audit.preview(fake);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper reports.run().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:13',
          },
        ],
        query: 'product/member-helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:13',
      },
    ]);
    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:13',
          },
        ],
      },
    });
  });

  it('pins inline object-member local helpers under real Drizzle Postgres receiver types', () => {
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
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'const helpers = {',
          '  loadProducts(db: PgDatabase<any, any, any>) {',
          '    return db.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '  touchProduct: async (db: PgDatabase<any, any, any>) => {',
          '    await db.update(products).set({ stock: 1 });',
          '  },',
          '  fakeLoad(fake: FakeDb) {',
          '    return fake.select({ id: products.id }).from(products);',
          '  },',
          '  fakeTouch: async (fake: FakeDb) => {',
          '    await fake.update(products).set({ stock: 2 });',
          '  },',
          '};',
          '',
          "export const productQuery = query('product/inline-member-local-helper', {",
          '  load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
          '    helpers.fakeLoad(fake);',
          '    return helpers.loadProducts(db);',
          '  },',
          '});',
          '',
          'export async function syncProduct(db: PgDatabase<any, any, any>, fake: FakeDb) {',
          '  await helpers.fakeTouch(fake);',
          '  await helpers.touchProduct(db);',
          '}',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/inline-member-local-helper',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.domain.ts:28',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:18',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins static class member helper propagation and FW406 under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import { eq, sql } from 'drizzle-orm';",
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          'declare function inspect(value: unknown): void;',
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function readProducts(db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id }).from(products);',
          '}',
          '',
          'function touchProduct(db: PgDatabase<any, any, any>, productId: string) {',
          '  return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'class ProductHelpers {',
          '  static visibleRead(_input: unknown, db: PgDatabase<any, any, any>) {',
          '    return readProducts(db);',
          '  }',
          '',
          '  static opaqueRead(_input: unknown, db: PgDatabase<any, any, any>) {',
          '    inspect(db);',
          '    return db.execute(sql`select * from products`);',
          '  }',
          '',
          '  static visibleWrite(db: PgDatabase<any, any, any>, productId: string) {',
          '    return touchProduct(db, productId);',
          '  }',
          '',
          '  static opaqueWrite(db: PgDatabase<any, any, any>) {',
          '    inspect(db);',
          '    return db.execute(sql`delete from products`);',
          '  }',
          '}',
          '',
          "export const productQuery = query('product/static-class-local-helper', {",
          '  load(input, db: PgDatabase<any, any, any>) {',
          '    ProductHelpers.opaqueRead(input, db);',
          '    return ProductHelpers.visibleRead(input, db);',
          '  },',
          '});',
          '',
          'export const productDomain = domain({',
          '  add: write((db: PgDatabase<any, any, any>, productId: string) => {',
          '    ProductHelpers.opaqueWrite(db);',
          '    return ProductHelpers.visibleWrite(db, productId);',
          '  }),',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query local helper has unresolved Drizzle inspect().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.domain.ts:24',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query local helper has unresolved Drizzle execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.domain.ts:25',
          },
        ],
        query: 'product/static-class-local-helper',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.domain.ts:38',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:15',
            via: 'products',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:33',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:34',
          },
        ],
      },
      readProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:11',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:15',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins real Drizzle receiver proof through typed destructured declarations', () => {
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
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          "export const productQuery = query('product/destructured-receiver', {",
          '  load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
          '    const context = { db, nested: { db }, tuple: [db] as [PgDatabase<any, any, any>] };',
          '    const { nested: { db: reader } } = context;',
          '    const [tupleReader] = context.tuple;',
          '    const { select: fakeSelect } = fake;',
          '    fakeSelect({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id }).from(products);',
          '  },',
          '});',
          '',
          'export async function syncProduct(context: { db: PgDatabase<any, any, any> }, fake: { db: FakeDb }) {',
          '  const { db: writer } = context;',
          '  const { db: fakeWriter } = fake;',
          '  await writer.update(products).set({});',
          '  await fakeWriter.update(products).set({});',
          '}',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/destructured-receiver',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:12',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:26',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins containerized Drizzle receiver helper handoffs as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
            }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            declare function runReport(context: unknown): Promise<unknown[]>;

            export const productQuery = query('product/container-helper', {
              async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {
                await runReport({ fake });
                return runReport({ db });
              },
            });
          `,
        },
      ],
    });
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'declare function audit(context: unknown): Promise<void>;',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  await audit({ fake });',
            '  await audit({ db });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:14',
          },
        ],
        query: 'product/container-helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:14',
      },
    ]);
    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:11',
          },
        ],
      },
    });
  });

  it('pins typed context helper handoffs as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface ProductContext { db: PgDatabase<any, any, any> }',
            'interface FakeContext { db: unknown }',
            'declare function runReport(context: unknown): Promise<unknown[]>;',
            '',
            "export const productQuery = query('product/typed-context-helper', {",
            '  async load(_input, context: ProductContext, fake: FakeContext) {',
            '    await runReport({ fake });',
            '    return runReport({ context });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface CartContext { db: PgDatabase<any, any, any> }',
            'interface FakeContext { db: unknown }',
            'declare function writeAudit(context: unknown): Promise<void>;',
            '',
            'export async function addItem(context: CartContext, fake: FakeContext) {',
            '  await writeAudit({ fake });',
            '  await writeAudit({ context });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
        ],
        query: 'product/typed-context-helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:7',
      },
    ]);
    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:9',
          },
        ],
      },
    });
  });

  it('pins nested typed Drizzle receiver carrier members under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              execute(query: unknown): Promise<void>;
              query: any;
              update(table: unknown): { set(value: unknown): Promise<void> };
            }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            declare function runReport(context: unknown): Promise<unknown[]>;

            export const productQuery = query('product/nested-carrier', {
              async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {
                const carrier = { db, fake };
                const nested = { inner: carrier };
                const overwritten = { ...nested, inner: { db: fake } };
                const execute = nested.inner.db.execute;
                await nested.inner.db.execute(sql\`select 1\`);
                await nested.inner.db.update(products).set({ id: 'p1' });
                await nested.inner.db.query.products.findMany();
                await execute(sql\`select 1\`);
                await runReport(nested.inner.db);
                await runReport(nested);
                await overwritten.inner.db.execute(sql\`select 1\`);
                await overwritten.inner.db.update(products).set({ id: 'fake' });
                await overwritten.inner.db.query.products.findMany();
                return [];
              },
            });
          `,
        },
      ],
    });
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import { sql } from 'drizzle-orm';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            "export const products = pgTable('products', {}, jiso({ domain: 'product', key: 'id' }));",
            '',
            'declare function audit(context: unknown): Promise<void>;',
            '',
            'export async function sync(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  const carrier = { db, fake };',
            '  const nested = { inner: carrier };',
            '  const overwritten = { ...nested, inner: { db: fake } };',
            '  const execute = nested.inner.db.execute;',
            '  await nested.inner.db.execute(sql`select 1`);',
            '  await nested.inner.db.update(products).set({});',
            '  await nested.inner.db.query.products.findMany();',
            '  await execute(sql`select 1`);',
            '  await audit(nested.inner.db);',
            '  await audit(nested);',
            '  await overwritten.inner.db.execute(sql`select 1`);',
            '  await overwritten.inner.db.update(products).set({});',
            '  await overwritten.inner.db.query.products.findMany();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call nested.inner.db.execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call nested.inner.db.update().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver nested.inner.db to helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver nested to helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
        ],
        query: 'product/nested-carrier',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:16',
      },
    ]);
    expect(graph).toEqual({
      sync: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:21',
            source: 'relational-query',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:20',
            via: 'products',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:23',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:24',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:22',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:19',
          },
        ],
      },
    });
  });

  it('pins local query-loader helper carrier aliases as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
            '}',
            '',
            'function runReport(context: unknown): Promise<unknown[]> {',
            '  return Promise.resolve([]);',
            '}',
            '',
            "export const productQuery = query('product/local-carrier-helper', {",
            '  async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to local helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:11',
          },
        ],
        query: 'product/local-carrier-helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:11',
      },
    ]);
  });

  it('pins local query-loader helper assigned carrier aliases as FW406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
            '}',
            '',
            'function runReport(context: unknown): Promise<unknown[]> {',
            '  return Promise.resolve([]);',
            '}',
            '',
            "export const productQuery = query('product/local-assigned-carrier-helper', {",
            '  async load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to local helper runReport().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:11',
          },
        ],
        query: 'product/local-assigned-carrier-helper',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:11',
      },
    ]);
  });

  it('pins member-referenced local helpers under real Drizzle Postgres receiver types', () => {
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
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function loadProducts(db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id, stock: products.stock }).from(products);',
          '}',
          'function touchProduct(db: PgDatabase<any, any, any>) {',
          '  return db.update(products).set({ stock: 1 });',
          '}',
          'function fakeLoad(fake: FakeDb) {',
          '  return fake.select({ id: products.id }).from(products);',
          '}',
          'function fakeTouch(fake: FakeDb) {',
          '  return fake.update(products).set({ stock: 2 });',
          '}',
          '',
          'const helpers = { loadProducts, touchProduct, fakeLoad, fakeTouch };',
          '',
          "export const productQuery = query('product/member-local-helper', {",
          '  load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {',
          '    helpers.fakeLoad(fake);',
          '    return helpers.loadProducts(db);',
          '  },',
          '});',
          '',
          'export async function syncProduct(db: PgDatabase<any, any, any>, fake: FakeDb) {',
          '  await helpers.fakeTouch(fake);',
          '  await helpers.touchProduct(db);',
          '}',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/member-local-helper',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.domain.ts:28',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      loadProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:14',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:17',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:17',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins destructured local helper members under real Drizzle Postgres receiver types', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
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
          "export const productQuery = query('product/destructured-local-helper', {",
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
        site: 'conformance/drizzle-pin/src/product.domain.ts:17',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      loadProducts: {
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
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:11',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:11',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins nested static callback containers under real Drizzle Postgres receiver types', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          'interface FakeDb {',
          '  insert(table: unknown): { values(value: unknown): Promise<void> };',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '}',
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, fake: FakeDb, productId: string) {',
          '  db.insert(products).values({ id: productId });',
          '  fake.insert(products).values({ id: productId });',
          '}',
          'function fakeAdd(fake: FakeDb, productId: string) {',
          '  fake.insert(products).values({ id: productId });',
          '}',
          'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id, stock: products.stock }).from(products);',
          '}',
          'function emptyLoad() {',
          '  return [];',
          '}',
          '',
          'const domainBase = { nested: { addItem } };',
          'const domainSpread = { ...domainBase };',
          'const domainOverridden = { ...domainBase, nested: { addItem: fakeAdd } };',
          'const queryBase = { nested: { loadProducts } };',
          'const querySpread = { ...queryBase };',
          'const queryOverridden = { ...queryBase, nested: { loadProducts: emptyLoad } };',
          '',
          'export const productDomain = domain({',
          '  addSpread: write(domainSpread["nested"]["addItem"]),',
          '  addOverridden: write(domainOverridden.nested.addItem),',
          '});',
          '',
          "export const productQuery = query('product/nested-callback-container', {",
          '  load: querySpread["nested"]["loadProducts"],',
          '});',
          "export const emptyQuery = query('product/overridden-nested-callback-container', {",
          '  load: queryOverridden.nested.loadProducts,',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:14',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      loadProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:21',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [],
        unresolved: [],
      },
      'productDomain.addSpread': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:14',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/nested-callback-container',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:39',
      },
    ]);
  });

  it('pins static property callback containers under real Drizzle Postgres receiver types', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import { eq } from 'drizzle-orm';",
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'class ProductLoaders {',
          '  static loadProduct = (_input: unknown, db: PgDatabase<any, any, any>) => {',
          '    return db.select({ id: products.id }).from(products);',
          '  };',
          '  static options = { load: ProductLoaders.loadProduct };',
          '}',
          '',
          'class ProductActions {',
          '  static add = write(addItem);',
          '  static actions = { add: ProductActions.add };',
          '}',
          '',
          'export const productDomain = domain(ProductActions.actions);',
          '',
          "export const productQuery = query('product/static-property-loader', ProductLoaders.options);",
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/static-property-loader',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:26',
      },
    ]);
  });

  it('pins static class helper members under real Drizzle Postgres receiver types', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import { eq } from 'drizzle-orm';",
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'class ProductHelpers {',
          '  static loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '    return db.select({ id: products.id }).from(products);',
          '  }',
          '',
          '  static touchProduct = (db: PgDatabase<any, any, any>, productId: string) => {',
          '    return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '  };',
          '}',
          '',
          "export const productQuery = query('product/static-class-helper-loader', {",
          '  load(input: unknown, db: PgDatabase<any, any, any>) {',
          '    return ProductHelpers.loadProducts(input, db);',
          '  },',
          '});',
          '',
          'export const productDomain = domain({',
          '  add: write((db: PgDatabase<any, any, any>, productId: string) => {',
          '    return ProductHelpers.touchProduct(db, productId);',
          '  }),',
          '});',
        ].join('\n'),
      },
    ];

    const facts = extractQueryFactsFromProject({ files });
    const graph = extractTouchGraphFromProject({ files });

    expect(facts).toEqual([
      {
        query: 'product/static-class-helper-loader',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.domain.ts:18',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
    expect(graph).toEqual({
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:14',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
  });

  it('pins static accessor callback containers under real Drizzle Postgres receiver types', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import { eq } from 'drizzle-orm';",
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'class ProductLoaders {',
          '  static get loadProduct() {',
          '    return (_input: unknown, db: PgDatabase<any, any, any>) => {',
          '      return db.select({ id: products.id, stock: products.stock }).from(products);',
          '    };',
          '  }',
          '  static get options() {',
          '    return { load: ProductLoaders.loadProduct };',
          '  }',
          '}',
          '',
          'class ProductActions {',
          '  static get add() {',
          '    return write((db: PgDatabase<any, any, any>, productId: string) => {',
          '      return db.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '    });',
          '  }',
          '  static get actions() {',
          '    return { add: ProductActions.add };',
          '  }',
          '}',
          '',
          'export const productDomain = domain(ProductActions.actions);',
          '',
          "export const productQuery = query('product/static-accessor-loader', ProductLoaders.options);",
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:23',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/static-accessor-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:33',
      },
    ]);
  });

  it('pins destructured static callback containers under real Drizzle Postgres receiver types', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '}',
          '',
          'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id, stock: products.stock }).from(products);',
          '}',
          '',
          'const callbacks = { addItem };',
          'const loaders = { nested: { loadProducts } };',
          'const { addItem: addFromContainer } = callbacks;',
          'const { nested: { loadProducts: loadFromContainer } } = loaders;',
          '',
          'export const productDomain = domain({',
          '  add: write(addFromContainer),',
          '});',
          '',
          "export const productQuery = query('product/destructured-callback-container', {",
          '  load: loadFromContainer,',
          '});',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      loadProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:13',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [],
        unresolved: [],
      },
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/destructured-callback-container',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:25',
      },
    ]);
  });

  it('pins tuple-destructured static callback containers under real Drizzle Postgres receiver types', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '}',
          '',
          'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id, stock: products.stock }).from(products);',
          '}',
          '',
          'const callbacks = [addItem] as const;',
          'const loaders = [{ loadProducts }] as const;',
          'const [addFromContainer] = callbacks;',
          'const [{ loadProducts: loadFromContainer }] = loaders;',
          '',
          'export const productDomain = domain({',
          '  add: write(addFromContainer),',
          '});',
          '',
          "export const productQuery = query('product/tuple-destructured-callback-container', {",
          '  load: loadFromContainer,',
          '});',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      loadProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:13',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [],
        unresolved: [],
      },
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/tuple-destructured-callback-container',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:25',
      },
    ]);
  });

  it('pins tuple-indexed static callback configs under real Drizzle Postgres receiver types', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '}',
          '',
          'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id, stock: products.stock }).from(products);',
          '}',
          '',
          'const callbackTuples = [[addItem], [{ loadProducts }]] as const;',
          'const actionConfigs = [{ add: write(callbackTuples[0][0]) }] as const;',
          'const queryConfigs = [{ load: callbackTuples[1][0].loadProducts }] as const;',
          '',
          'export const productDomain = domain(actionConfigs[0]);',
          '',
          "export const productQuery = query('product/tuple-indexed-config', queryConfigs[0]);",
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      loadProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:13',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [],
        unresolved: [],
      },
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/tuple-indexed-config',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:22',
      },
    ]);
  });

  it('pins unresolved dynamic callback references as FW406 under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id }).from(products);',
          '}',
          '',
          'declare const actionName: string;',
          'declare const loaderName: string;',
          'const callbacks = { addItem };',
          'const loaders = { loadProducts };',
          '',
          'export const productDomain = domain({',
          '  add: write(callbacks[actionName]),',
          '});',
          '',
          "export const productQuery = query('product/unresolved-dynamic-loader', {",
          '  load: loaders[loaderName],',
          '});',
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
      loadProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [],
        unresolved: [],
      },
      'productDomain.add': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:21',
          },
        ],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.domain.ts:24',
          },
        ],
        query: 'product/unresolved-dynamic-loader',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.domain.ts:24',
      },
    ]);
  });

  it('pins static computed query loaders and domain actions under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          "const loadKey = 'load';",
          "const addKey = 'add';",
          "const keyBag = { restock: 'restock' } as const;",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'export const productDomain = domain({',
          '  [addKey]: write(addItem),',
          '  [keyBag.restock]: write(addItem),',
          '});',
          '',
          "export const productQuery = query('product/static-computed-loader', {",
          '  [loadKey](_input: unknown, db: PgDatabase<any, any, any>) {',
          '    return db.select({ id: products.id }).from(products);',
          '  },',
          '});',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
            via: 'products',
          },
        ],
        unresolved: [],
      },
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
      'productDomain.restock': {
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
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/static-computed-loader',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:20',
      },
    ]);
  });

  it('pins unresolved computed query loaders and domain actions as FW406 under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'declare const actionKey: string;',
          'declare const loadKey: string;',
          '',
          'function addItem(db: PgDatabase<any, any, any>) {',
          '  db.update(products).set({});',
          '}',
          '',
          'export const productDomain = domain({',
          '  [actionKey]: write(addItem),',
          '});',
          '',
          "export const productQuery = query('product/unresolved-computed-loader', {",
          '  [loadKey](_input: unknown, db: PgDatabase<any, any, any>) {',
          '    return db.select({ id: products.id }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:11',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      'productDomain.<computed>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:15',
          },
        ],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.domain.ts:18',
          },
        ],
        query: 'product/unresolved-computed-loader',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.domain.ts:18',
      },
    ]);
  });

  it('pins opaque domain action spreads as FW406 under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'declare const dynamicActions: any;',
          'const staticActions = { add: write(addItem) };',
          '',
          'export const productDomain = domain({',
          '  ...staticActions,',
          '  ...dynamicActions,',
          '});',
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
      'productDomain.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
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
  });

  it('pins direct opaque domain action members as FW406 under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'const addAction = write(addItem);',
          'declare const dynamicAction: unknown;',
          'const actionBag = { aliased: addAction, opaque: dynamicAction };',
          '',
          'export const productDomain = domain({',
          '  add: addAction,',
          '  dynamic: dynamicAction,',
          '  method(db: PgDatabase<any, any, any>) {',
          '    db.update(products).set({});',
          '  },',
          '  ...actionBag,',
          '});',
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
      'productDomain.aliased': {
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
      'productDomain.dynamic': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:17',
          },
        ],
      },
      'productDomain.method': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:18',
          },
        ],
      },
      'productDomain.opaque': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:13',
          },
        ],
      },
    });
  });

  it('pins conditional domain action spreads under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'declare const useDynamic: boolean;',
          'declare const dynamicActions: any;',
          'const staticActions = { add: write(addItem) };',
          '',
          'export const productDomain = domain({',
          '  ...(useDynamic ? dynamicActions : staticActions),',
          '});',
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
      'productDomain.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
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
  });

  it('pins direct conditional domain action members under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'declare const useDynamic: boolean;',
          'declare const dynamicAction: any;',
          '',
          'export const productDomain = domain({',
          '  add: useDynamic ? dynamicAction : write(addItem),',
          '});',
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
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:15',
          },
        ],
      },
    });
  });

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
            "}, jiso({ domain: 'product', key: 'id' }));",
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
            code: 'FW406',
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
          "}, jiso({ domain: 'product', key: 'id' }));",
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
          "export const productQuery = (query('product/wrapped-real', {",
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
            code: 'FW406',
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
          "}, jiso({ domain: 'product', key: 'id' }));",
          '',
          'const readProducts = ((db: PgDatabase<any, any, any>) => {',
          '  return db.select({ id: products.id }).from(products);',
          '}) satisfies unknown;',
          '',
          'const touchProduct = (async (db: PgDatabase<any, any, any>, productId: string) => {',
          '  return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}) as unknown;',
          '',
          "export const productQuery = query('product/wrapped-helper-real', {",
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

  it('pins typed domain action spread members as FW406 under real Drizzle imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "}, jiso({ domain: 'product', key: 'id' }));",
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
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
          },
        ],
      },
    });
  });

  it('pins string-indexed domain action spreads as FW406 under real Drizzle imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
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
            code: 'FW406',
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
          "}, jiso({ domain: 'product', key: 'id' }));",
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
          "export const productQuery = query('product/nested-destructuring-assignment', {",
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
            }, jiso({ exempt: true }));
            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/shadowed-db', {
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

  it('pins detached query-loader receiver methods as FW406 under real Drizzle imports', () => {
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
            }, jiso({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/detached-methods', {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:13',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method query().',
            severity: 'warn',
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
            "export const productQuery = query('product/detached-symbols', {",
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
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
            "}, jiso({ domain: 'product', key: 'id' }));",
            '',
            "export const productQuery = query('product/spread-carrier', {",
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.queries.ts:12',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call spread.db.execute().',
            severity: 'warn',
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

  it('pins factory-returned typed receiver carriers as FW406 under real Drizzle imports', () => {
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
            "export const productQuery = query('product/factory-carrier', {",
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver makeContext() to helper runReport().',
            severity: 'warn',
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
