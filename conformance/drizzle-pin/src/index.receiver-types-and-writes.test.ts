import { describe, expect, it } from 'vitest';

import { pgTable, text } from 'drizzle-orm/pg-core';

import {
  extractTouchGraphFromProject,
  serializeTouchGraph,
} from '../../../packages/drizzle/src/static.js';
import { kovo } from '../../../packages/drizzle/src/drizzle-surface.js';

import { drizzleSymbol, extractQueryFactsFromProject } from './test-helpers.js';

describe('Drizzle pinned subset conformance', () => {
  it('pins pgTable(name, cols, kovo({...})) as the real Drizzle extra config integration point', () => {
    const cartItems = pgTable(
      'cart_items',
      {
        cartId: text('cart_id').notNull(),
        productId: text('product_id').notNull(),
      },
      kovo({ domain: 'cart', key: 'productId' }),
    );

    expect(cartItems.productId).toBeDefined();
    const tableInternals = cartItems as unknown as Record<symbol, unknown>;
    const extraConfigBuilder = tableInternals[drizzleSymbol('ExtraConfigBuilder')];
    const extraConfigColumns = tableInternals[drizzleSymbol('ExtraConfigColumns')];

    expect(extraConfigBuilder).toEqual(
      expect.objectContaining({ domain: 'cart', key: 'productId' }),
    );
    expect(
      typeof extraConfigBuilder === 'function' ? extraConfigBuilder(extraConfigColumns) : [],
    ).toEqual([]);
  });

  it('recognizes real Drizzle receiver types in project extraction', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));

            export async function addItem(writer: PgDatabase<any, any, any>, productId: string) {
              await writer.insert(cartItems).values({ productId });
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
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins typed destructured Drizzle receivers with real imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface Context { db: PgDatabase<any, any, any> }
            interface FakeContext { db: { update(table: unknown): { set(value: unknown): Promise<void> } } }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              stock: integer('stock').notNull(),
            }, kovo({ domain: 'product', key: 'id' }));

            export async function restock({ db: writer }: Context, fake: FakeContext, productId: string) {
              await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));
              await fake.db.update(products).set({ stock: 0 });
            }

            export async function fakeRestock({ db }: FakeContext) {
              await db.update(products).set({ stock: -1 });
            }

            export const productQuery = query('product/destructured', {
              load(_input, { db }: Context) {
                return db.select({ id: products.id, stock: products.stock }).from(products);
              },
            });
          `,
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:13',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/destructured',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:21',
      },
    ]);
  });

  it('pins body-local typed Drizzle receiver aliases with real imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface Context { db: PgDatabase<any, any, any> }
            interface FakeDb {
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
              update(table: unknown): { set(value: unknown): Promise<void> };
            }
            interface FakeContext { db: FakeDb }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              stock: integer('stock').notNull(),
            }, kovo({ domain: 'product', key: 'id' }));

            export async function restock(context: Context, fake: FakeContext, productId: string) {
              const { db: writer } = context;
              const { db: fakeWriter } = fake;
              await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));
              await fakeWriter.update(products).set({ stock: 0 });
            }

            export const productQuery = query('product/body-local-alias', {
              load(_input, context: Context, fake: FakeContext) {
                const { db: reader } = context;
                const { db: fakeReader } = fake;
                fakeReader.select({ id: products.id }).from(products);
                return reader.select({ id: products.id, stock: products.stock }).from(products);
              },
            });
          `,
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:19',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/body-local-alias',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:23',
      },
    ]);
  });

  it('pins assignment Drizzle receiver aliases with real imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
              update(table: unknown): { set(value: unknown): Promise<void> };
            }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              stock: integer('stock').notNull(),
            }, kovo({ domain: 'product', key: 'id' }));

            export async function restock(db: PgDatabase<any, any, any>, fake: FakeDb, productId: string) {
              let writer;
              writer = db;
              let fakeWriter;
              fakeWriter = fake;
              await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));
              await fakeWriter.update(products).set({ stock: 0 });
            }

            export const productQuery = query('product/assignment-alias', {
              load(_input, db: PgDatabase<any, any, any>, fake: FakeDb) {
                let reader;
                reader = db;
                let fakeReader;
                fakeReader = fake;
                fakeReader.select({ id: products.id }).from(products);
                return reader.select({ id: products.id, stock: products.stock }).from(products);
              },
            });
          `,
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:19',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/assignment-alias',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:23',
      },
    ]);
  });

  it('pins destructuring assignment Drizzle receiver aliases with real imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
              update(table: unknown): { set(value: unknown): Promise<void> };
            }
            interface FakeContext { db: FakeDb }
            interface DrizzleContext { db: PgDatabase<any, any, any> }

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              stock: integer('stock').notNull(),
            }, kovo({ domain: 'product', key: 'id' }));

            export async function restock(context: DrizzleContext, fake: FakeContext, productId: string) {
              let writer;
              ({ db: writer } = context);
              let fakeWriter;
              ({ db: fakeWriter } = fake);
              await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));
              await fakeWriter.update(products).set({ stock: 0 });
            }

            export const productQuery = query('product/destructuring-assignment-alias', {
              load(_input, context: DrizzleContext, fake: FakeContext) {
                let reader;
                ({ db: reader } = context);
                let fakeReader;
                ({ db: fakeReader } = fake);
                fakeReader.select({ id: products.id }).from(products);
                return reader.select({ id: products.id, stock: products.stock }).from(products);
              },
            });
          `,
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:21',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/destructuring-assignment-alias',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:25',
      },
    ]);
  });

  it('pins tuple Drizzle receiver aliases with real imports', () => {
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
          'interface DrizzleContext { receivers: [PgDatabase<any, any, any>, FakeDb]; nested: { tuple: [FakeDb, PgDatabase<any, any, any>] } }',
          'interface FakeContext { receivers: [FakeDb, FakeDb] }',
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'export async function restock(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  const [writer] = context.receivers;',
          '  let assignedWriter;',
          '  [, assignedWriter] = context.nested.tuple;',
          '  const [fakeWriter] = fake.receivers;',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await assignedWriter.update(products).set({ stock: 2 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 0 });',
          '}',
          '',
          "export const productQuery = query('product/tuple-alias', {",
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    const [reader] = context.receivers;',
          '    let assignedReader;',
          '    [, assignedReader] = context.nested.tuple;',
          '    const [fakeReader] = fake.receivers;',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    assignedReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:20',
            via: 'products',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:21',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/tuple-alias',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:25',
      },
    ]);
  });

  it('pins rest destructuring containers without promoting them to real Drizzle receivers', () => {
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
          'interface DrizzleContext { receivers: [FakeDb, PgDatabase<any, any, any>]; writerRest: PgDatabase<any, any, any> }',
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'export async function restock(context: DrizzleContext, productId: string) {',
          '  const [, ...writerRest] = context.receivers;',
          '  const { ...objectRest } = context;',
          '  await writerRest.update(products).set({ stock: 0 });',
          '  await objectRest.update(products).set({ stock: 0 });',
          '  await writerRest[0].update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '}',
          '',
          "export const productQuery = query('product/rest-receiver', {",
          '  load(_input, context: DrizzleContext) {',
          '    const [, ...readerRest] = context.receivers;',
          '    const { ...objectRest } = context;',
          '    readerRest.select({ id: products.id }).from(products);',
          '    objectRest.select({ id: products.id }).from(products);',
          '    return readerRest[0].select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:19',
            via: 'products',
          },
        ],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:17',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:18',
          },
        ],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses project Drizzle receiver container surface readerRest.select().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.domain.ts:22',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses project Drizzle receiver container surface objectRest.select().',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/product.domain.ts:22',
          },
        ],
        query: 'product/rest-receiver',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:22',
      },
    ]);
  });

  it('pins object-contained tuple assignment receiver aliases with real imports', () => {
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
          'interface DrizzleContext { wrappers: { receivers: [PgDatabase<any, any, any>, FakeDb] } }',
          'interface FakeContext { wrappers: { receivers: [FakeDb, FakeDb] } }',
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'export async function restock(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  let writer;',
          '  ({ wrappers: { receivers: [writer] } } = context);',
          '  let fakeWriter;',
          '  ({ wrappers: { receivers: [fakeWriter] } } = fake);',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 0 });',
          '}',
          '',
          "export const productQuery = query('product/object-contained-tuple-assignment', {",
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    let reader;',
          '    ({ wrappers: { receivers: [reader] } } = context);',
          '    let fakeReader;',
          '    ({ wrappers: { receivers: [fakeReader] } } = fake);',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      restock: {
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
        query: 'product/object-contained-tuple-assignment',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:24',
      },
    ]);
  });

  it('pins namespace-imported project write targets with real Drizzle tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';

            export const cartItems = pgTable('cart_items', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: `
            import { eq } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import * as schema from './schema';

            export async function addItem(db: PgDatabase<any, any, any>, id: string) {
              await db.update(schema.cartItems).set({ id }).where(eq(schema.cartItems.id, id));
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins namespace static element-access project writes against real Drizzle tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';

            export const cartItems = pgTable('cart_items', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: `
            import { eq } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import * as schema from './schema';

            export async function addItem(db: PgDatabase<any, any, any>, id: string) {
              await db.update(schema['cartItems']).set({ id }).where(eq(schema['cartItems'].id, id));
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins namespace project writes through re-export barrels with real Drizzle tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';

            export const cartItems = pgTable('cart_items', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'cart', key: 'id' }));
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/tables.ts',
          source: `
            export { cartItems as cartLineItems } from './schema';
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/index.ts',
          source: `
            export * from './tables';
          `,
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: `
            import { eq } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import * as schema from './index';

            export async function addItem(db: PgDatabase<any, any, any>, id: string) {
              await db.update(schema['cartLineItems']).set({ id }).where(eq(schema['cartLineItems'].id, id));
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins project transaction aliases without leaking same-name callback receivers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, queue: FakeDb[], productId: string) {',
            '  await db.transaction(async (writer) => {',
            '    await writer.insert(cartItems).values({ productId });',
            '    queue.forEach(async (writer) => {',
            '      await writer.update(cartItems).set({ productId });',
            '    });',
            '  });',
            '  queue.forEach(async (writer) => {',
            '    await writer.update(cartItems).set({ productId });',
            '  });',
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
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:11',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins typed referenced transaction callbacks under real Drizzle imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { pgTable } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function runInTx(tx: PgDatabase<any, any, any>) {',
            '    await tx.update(cartItems).set({ productId });',
            '  }',
            '  await db.transaction(runInTx);',
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
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:8',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:8',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins unresolved referenced transaction callbacks as KV406 under real Drizzle imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { pgTable } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function runInTx(writer: unknown) {',
            '    await writer.update(cartItems).set({ productId });',
            '  }',
            '  await db.transaction(runInTx);',
            '}',
            '',
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
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
          },
        ],
      },
    });
  });

  it('pins project transaction callback receiver aliases for write extraction', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  await db.transaction(async (writer) => {',
            '    await writer.insert(cartItems).values({ productId });',
            '  });',
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

  it('pins project transaction aliases without leaking same-name callback receivers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import { eq } from 'drizzle-orm';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string, queue: any) {',
            '  await db.transaction(async (writer) => {',
            '    await writer.insert(cartItems).values({ productId });',
            '    await queue.forEach(async (writer) => {',
            '      await writer.update(cartItems).set({ productId });',
            '      await writeAudit(writer, productId);',
            '    });',
            '  });',
            '  await queue.forEach(async (writer) => {',
            '    await writer.delete(cartItems).where(eq(cartItems.productId, productId));',
            '  });',
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
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:8',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins standalone direct select chains as real Drizzle touch-graph reads', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/catalog.domain.ts',
          source: `
            import { eq } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
              vendorId: text('vendor_id'),
            }, kovo({ domain: 'product', key: 'id' }));
            export const vendors = pgTable('vendors', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'vendor', key: 'id' }));

            export async function loadCatalog(db: PgDatabase<any, any, any>) {
              await db.select({ id: products.id }).from((products as any)).leftJoin(vendors!, eq(vendors.id, products.vendorId));
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      loadCatalog: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:14',
            source: 'select',
            via: 'products',
          },
          {
            domain: 'vendor',
            keys: null,
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:14',
            source: 'select',
            via: 'vendors',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
  });

  it('pins wrapped project direct-select and write read-source tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/catalog.domain.ts',
          source: [
            "import { eq } from 'drizzle-orm';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'export const vendors = pgTable("vendors", {}, kovo({ domain: "vendor", key: "id" }));',
            'export const snapshots = pgTable("product_snapshots", {}, kovo({ domain: "snapshot", key: "productId" }));',
            '',
            'export async function syncCatalog(db: PgDatabase<any, any, any>) {',
            '  await db.select().from((products as any)).leftJoin(vendors!, eq(vendors.id, products.vendorId));',
            '  await db.insert(snapshots).select(db.select().from((products as any)));',
            '  await db.update(snapshots).set({ refreshed: true }).from(vendors!);',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "syncCatalog": {',
        '    touches: [',
        '      { domain: "snapshot", via: "product_snapshots", site: "conformance/drizzle-pin/src/catalog.domain.ts:10", keys: null },',
        '      { domain: "snapshot", via: "product_snapshots", site: "conformance/drizzle-pin/src/catalog.domain.ts:11", keys: null },',
        '    ],',
        '    reads: [',
        '      { domain: "product", via: "products", site: "conformance/drizzle-pin/src/catalog.domain.ts:10", keys: null, source: "insert-select" },',
        '      { domain: "product", via: "products", site: "conformance/drizzle-pin/src/catalog.domain.ts:9", keys: null, source: "select" },',
        '      { domain: "vendor", via: "vendors", site: "conformance/drizzle-pin/src/catalog.domain.ts:9", keys: null, source: "select" },',
        '      { domain: "vendor", via: "vendors", site: "conformance/drizzle-pin/src/catalog.domain.ts:11", keys: null, source: "update-from" },',
        '    ],',
        '    unresolved: [',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
  });

  it('pins unresolved standalone direct select tables as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/catalog.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export async function loadCatalog(db: PgDatabase<any, any, any>, tableName: string) {
              await db.select().from(tableFor(tableName));
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      loadCatalog: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:5',
          },
        ],
      },
    });
  });

  it('pins project static element-access write methods', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import { eq } from 'drizzle-orm';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  await db["insert"](cartItems).values({ productId });',
            '  await db["update"](cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
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
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:8',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins closure-local helper summaries by symbol instead of helper name', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));",
            "export const auditLog = pgTable('audit_log', {}, kovo({ domain: 'audit', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function apply(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(cartItems).values({ productId });',
            '  }',
            '  await apply(db);',
            '}',
            '',
            'export async function auditItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function apply(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(auditLog).values({ productId });',
            '  }',
            '  await apply(db);',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:8',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    });
    expect(graph.auditItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'audit',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:15',
          via: 'audit_log',
        },
      ],
      unresolved: [],
    });
  });

  it('pins project closure-local helper summaries by symbol instead of helper name', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));",
            "export const auditLog = pgTable('audit_log', {}, kovo({ domain: 'audit', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function apply(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(cartItems).values({ productId });',
            '  }',
            '  await apply(db);',
            '}',
            '',
            'export async function auditItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function apply(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(auditLog).values({ productId });',
            '  }',
            '  await apply(db);',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:8',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    });
    expect(graph.auditItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'audit',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:15',
          via: 'audit_log',
        },
      ],
      unresolved: [],
    });
  });

  it('pins uncalled closure-local helpers as isolated summaries', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));",
            "export const auditLog = pgTable('audit_log', {}, kovo({ domain: 'audit', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function writeAudit(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(auditLog).values({ productId });',
            '  }',
            '  return productId;',
            '}',
            '',
            'export async function calledItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function writeCart(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(cartItems).values({ productId });',
            '  }',
            '  await writeCart(db);',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toBeUndefined();
    expect(graph.writeAudit).toEqual({
      reads: [],
      touches: [
        {
          domain: 'audit',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:8',
          via: 'audit_log',
        },
      ],
      unresolved: [],
    });
    expect(graph.calledItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:15',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    });
  });

  it('pins project closure-local helper folding to proven receiver arguments', () => {
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
            "export const cartItems = pgTable('cart_items', {}, kovo({ domain: 'cart', key: 'productId' }));",
            "export const auditLog = pgTable('audit_log', {}, kovo({ domain: 'audit', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb, productId: string) {',
            '  async function writeAudit(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(auditLog).values({ productId });',
            '  }',
            '  await writeAudit(fake);',
            '  await db.insert(cartItems).values({ productId });',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:15',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    });
    expect(graph.writeAudit).toEqual({
      reads: [],
      touches: [
        {
          domain: 'audit',
          keys: null,
          site: 'conformance/drizzle-pin/src/cart.domain.ts:12',
          via: 'audit_log',
        },
      ],
      unresolved: [],
    });
  });

  it('pins opaque local helper Drizzle carrier aliases as KV406 under real imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            '',
            'function writeAudit(context: unknown): Promise<void> {',
            '  return Promise.resolve(context);',
            '}',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  const context = { db };',
            '  const fakeContext = { db: fake };',
            '  await writeAudit(fakeContext);',
            '  await writeAudit(context);',
            '}',
            '',
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
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:15',
          },
        ],
      },
    });
  });

  it('pins opaque local helper assigned Drizzle carrier aliases as KV406 under real imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            '',
            'function writeAudit(context: unknown): Promise<void> {',
            '  return Promise.resolve(context);',
            '}',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  let context;',
            '  context = { db };',
            '  let fakeContext;',
            '  fakeContext = { db: fake };',
            '  await writeAudit(fakeContext);',
            '  await writeAudit(context);',
            '}',
            '',
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
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:17',
          },
        ],
      },
    });
  });
});
