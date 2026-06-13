import { describe, expect, it } from 'vitest';

import { eq, getTableName, sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import {
  createTouchGraphEntry,
  deriveInvalidationRegistry,
  diagnosticsForQueryFacts,
  diagnosticsForTouchGraph,
  extractTouchGraphFromProject,
  extractTouchGraphFromSource,
  extractQueryFactsFromProject,
  extractQueryFactsFromSource,
  jiso,
  serializeInvalidationRegistry,
  serializeDomainRegistry,
  serializeTouchGraph,
  type SourceFileInput,
} from '@jiso/drizzle/static';

function annotatedTable(name: string, annotation: ReturnType<typeof jiso>) {
  return {
    domain: annotation.domain,
    ...(annotation.key ? { key: annotation.key } : {}),
    name,
  };
}

function pgDatabaseTypes(methods: readonly string[]): SourceFileInput {
  return {
    fileName: 'drizzle-types.d.ts',
    source: [
      'declare module "drizzle-orm/pg-core" {',
      '  export class PgDatabase<TQueryResultHKT = unknown, TFullSchema = unknown, TSchema = unknown> {',
      ...methods.map((method) => `    ${method}`),
      '  }',
      '}',
    ].join('\n'),
  };
}

function unresolvedQueryLoadFact(query: string, site: string) {
  return {
    diagnostics: [
      {
        code: 'FW406',
        message:
          'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
        severity: 'warn',
        site,
      },
    ],
    query,
    reads: [],
    shape: {},
    site,
  };
}

describe('@jiso/drizzle touch graph helpers', () => {
  it('extracts writes and query facts through real drizzle-orm pgTable/select/update types', () => {
    const products = pgTable(
      'products',
      {
        archived: boolean('archived').notNull().default(false),
        createdAt: timestamp('created_at').notNull(),
        id: text('id').primaryKey(),
        metadata: jsonb('metadata'),
        stock: integer('stock').notNull(),
      },
      jiso({ domain: 'product', key: 'id' }),
    );

    expect(getTableName(products)).toBe('products');
    expect(products.metadata).toBeDefined();
    expect(eq(products.id, 'p1')).toBeDefined();
    expect(sql<number>`count(*)`).toBeDefined();

    const project = {
      files: [
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import { integer, pgTable, text, type PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
            '',
            'export async function restock(db: PgDatabase<any, any, any>, productId: string) {',
            '  await db.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
            '}',
            '',
            'export const productQuery = query("product", {',
            '  load(input, db: PgDatabase) {',
            '    return db.select({ id: products.id, stock: products.stock }).from(products).where(eq(products.id, input.id));',
            '  },',
            '});',
            '',
          ].join('\n'),
        },
      ],
    };

    expect(extractTouchGraphFromProject(project)).toEqual({
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
    expect(extractQueryFactsFromProject(project)).toEqual([
      {
        instanceKey: {
          domain: 'product',
          key: 'arg:id',
        },
        query: 'product',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:13',
      },
    ]);
  });

  it('keeps deferred SQLite/MySQL database receiver types out of v1 project proof', () => {
    const files = [
      {
        fileName: 'deferred-engine-types.d.ts',
        source: [
          'declare module "drizzle-orm/sqlite-core" {',
          '  export class BaseSQLiteDatabase<TResultKind = unknown, TRunResult = unknown, TFullSchema = unknown, TSchema = unknown> {}',
          '}',
          'declare module "drizzle-orm/mysql-core" {',
          '  export class MySqlDatabase<TQueryResult = unknown, TPreparedQuery = unknown, TFullSchema = unknown, TSchema = unknown> {}',
          '}',
        ].join('\n'),
      },
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { MySqlDatabase } from "drizzle-orm/mysql-core";',
          'import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export async function writeSqlite(db: BaseSQLiteDatabase, productId: string) {',
          '  await db.update(products).set({ id: productId });',
          '}',
          '',
          'export const productQuery = query("product/mysql", {',
          '  load(_input, db: MySqlDatabase) {',
          '    return db.select({ id: products.id }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({});
    expect(extractQueryFactsFromProject({ files })).toEqual([]);
  });

  it('resolves wrapped query projection expressions in source and project modes', () => {
    const sourceFile = {
      fileName: 'product.queries.ts',
      source: [
        'export const products = pgTable("products", {',
        '  id: text("id").primaryKey(),',
        '  stock: integer("stock").notNull(),',
        '}, jiso({ domain: "product", key: "id" }));',
        '',
        'export const productQuery = query("product/wrapped-projection", {',
        '  load(_input, db) {',
        '    return db.select({',
        '      id: (products.id as unknown) as typeof products.id,',
        '      stock: products["stock"]!,',
        '      count: (sql<number>`count(*)` satisfies unknown),',
        '    }).from(products);',
        '  },',
        '  output: {},',
        '});',
        '',
      ].join('\n'),
    };

    const expected = [
      {
        query: 'product/wrapped-projection',
        reads: ['product'],
        shape: {
          count: 'number',
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:6',
      },
    ];

    expect(extractQueryFactsFromSource([sourceFile])).toEqual(expected);
    expect(
      extractQueryFactsFromProject({
        files: [
          pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<void> };']),
          {
            ...sourceFile,
            source: sourceFile.source.replace('load(_input, db)', 'load(_input, db: PgDatabase)'),
          },
        ],
      }),
    ).toEqual(expected);
  });

  it('degrades deferred SQLite table factories instead of extracting exact v1 source writes', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'user.domain.ts',
        source: [
          'export const users = sqliteTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(db) {',
          '  await db.update(users).set({ active: true });',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'user.domain.ts:4',
          },
        ],
      },
    });
  });

  it('creates deterministic touch graph entries from annotated tables and read domains', () => {
    const cartItems = annotatedTable('cart_items', jiso({ domain: 'cart', key: 'cartId' }));
    const products = annotatedTable('products', jiso({ domain: 'product', key: 'id' }));
    const priceRules = annotatedTable('price_rules', jiso({ domain: 'pricing', key: 'id' }));

    const entry = createTouchGraphEntry({
      reads: [
        {
          operation: 'insert-select',
          site: 'cart.domain.ts:7',
          table: products,
        },
        {
          branch: 'discounted',
          operation: 'update-from',
          predicate: 'eq',
          readKey: 'arg:ruleId',
          site: 'cart.domain.ts:11',
          table: priceRules,
        },
      ],
      writes: [
        {
          branch: 'stock-check',
          operation: 'update',
          predicate: 'non-eq',
          site: 'cart.domain.ts:12',
          table: products,
          writeKey: 'arg:productId',
        },
        {
          operation: 'insert',
          site: 'cart.domain.ts:8',
          table: cartItems,
        },
      ],
    });

    expect(entry).toEqual({
      reads: [
        {
          branch: 'discounted',
          domain: 'pricing',
          keys: 'arg:ruleId',
          predicate: 'eq',
          site: 'cart.domain.ts:11',
          source: 'update-from',
          via: 'price_rules',
        },
        {
          domain: 'product',
          keys: null,
          site: 'cart.domain.ts:7',
          source: 'insert-select',
          via: 'products',
        },
      ],
      touches: [
        { domain: 'cart', keys: null, site: 'cart.domain.ts:8', via: 'cart_items' },
        {
          branch: 'stock-check',
          domain: 'product',
          keys: 'arg:productId',
          predicate: 'non-eq',
          site: 'cart.domain.ts:12',
          via: 'products',
        },
      ],
      unresolved: [],
    });
  });

  it('serializes committed generated/touch-graph.ts output', () => {
    expect(
      serializeTouchGraph({
        'cart.addItem': createTouchGraphEntry({
          reads: [
            {
              operation: 'update-from',
              site: 'cart.domain.ts:11',
              table: annotatedTable('prices', jiso({ domain: 'price' })),
            },
          ],
          unresolved: [{ domain: 'audit', operation: 'raw', site: 'cart.domain.ts:20' }],
          writes: [
            {
              branch: 'stock-check',
              operation: 'update',
              predicate: 'non-eq',
              site: 'cart.domain.ts:12',
              table: annotatedTable('products', jiso({ domain: 'product', key: 'id' })),
              writeKey: 'arg:productId',
            },
          ],
        }),
      }),
    ).toBe(`export const touchGraph = {
  "cart.addItem": {
    touches: [
      { domain: "product", via: "products", site: "cart.domain.ts:12", keys: "arg:productId", branch: "stock-check", predicate: "non-eq" },
    ],
    reads: [
      { domain: "price", via: "prices", site: "cart.domain.ts:11", keys: null, source: "update-from" },
    ],
    unresolved: [
      { code: 'FW406', site: "cart.domain.ts:20", message: "Statically un-analyzable write site; manual touches required.", domain: "audit" },
    ],
  },
} as const;
`);
  });

  it('reports FW406 diagnostics for unresolved write sites', () => {
    expect(
      diagnosticsForTouchGraph({
        'cart.addItem': createTouchGraphEntry({
          reads: [
            {
              operation: 'insert-select',
              predicate: 'non-eq',
              site: 'cart.domain.ts:18',
              table: annotatedTable('prices', jiso({ domain: 'price', key: 'productId' })),
            },
          ],
          unresolved: [{ operation: 'raw', site: 'cart.domain.ts:20' }],
          writes: [
            {
              operation: 'update',
              predicate: 'non-eq',
              site: 'cart.domain.ts:12',
              table: annotatedTable('products', jiso({ domain: 'product', key: 'id' })),
            },
          ],
        }),
      }),
    ).toEqual([
      {
        code: 'FW406',
        message: 'Statically un-analyzable write site; manual touches required.',
        severity: 'warn',
        site: 'cart.domain.ts:20',
      },
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'cart.domain.ts:12',
      },
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'cart.domain.ts:18',
      },
    ]);
  });

  it('serializes deterministic domain registry output from table annotations', () => {
    const cartItems = annotatedTable('cart_items', jiso({ domain: 'cart', key: 'cartId' }));
    const products = annotatedTable('products', jiso({ domain: 'product', key: 'id' }));

    expect(serializeDomainRegistry([{ table: products }, { table: cartItems }]))
      .toBe(`export type DomainKey = "cart" | "product";

export const tableDomains = {
  "cart_items": "cart",
  "products": "product",
} as const satisfies Record<string, DomainKey>;
`);
  });

  it('serializes an empty domain registry as a never-keyed map', () => {
    expect(serializeDomainRegistry([])).toBe(`export type DomainKey = never;

export const tableDomains = {
} as const satisfies Record<string, DomainKey>;
`);
  });

  it('derives v1 invalidation registry sets from touch graph and query read sets', () => {
    const registry = deriveInvalidationRegistry({
      mutations: [{ mutation: 'cart/add', touchGraphKey: 'cart.addItem' }],
      queries: [
        { domains: ['cart'], query: 'cart' },
        { domains: ['order'], query: 'orderHistory' },
        {
          domains: ['product'],
          instanceKey: { domain: 'product', key: 'arg:id' },
          query: 'productGrid',
        },
        { domains: ['pricing'], query: 'priceRules' },
      ],
      touchGraph: {
        'cart.addItem': createTouchGraphEntry({
          writes: [
            {
              operation: 'insert',
              site: 'cart.domain.ts:8',
              table: annotatedTable('cart_items', jiso({ domain: 'cart', key: 'cartId' })),
            },
            {
              operation: 'insert',
              site: 'cart.domain.ts:12',
              table: annotatedTable('orders', jiso({ domain: 'order' })),
            },
            {
              operation: 'update',
              site: 'cart.domain.ts:16',
              table: annotatedTable('products', jiso({ domain: 'product', key: 'id' })),
              writeKey: 'arg:productId',
            },
          ],
        }),
      },
    });

    expect(registry).toEqual({
      'cart/add': [
        { domains: ['cart'], keys: null, query: 'cart' },
        { domains: ['order'], keys: null, query: 'orderHistory' },
        { domains: ['product'], keys: { product: 'arg:productId' }, query: 'productGrid' },
      ],
    });
  });

  it('serializes v1 invalidation registry facts for generated artifacts', () => {
    expect(
      serializeInvalidationRegistry(
        {
          'cart/add': [
            { domains: ['cart'], keys: null, query: 'cart' },
            { domains: ['order'], keys: null, query: 'orderHistory' },
            { domains: ['product'], keys: { product: 'arg:productId' }, query: 'productGrid' },
          ],
        },
        { constName: 'commerceInvalidationSets', typeName: 'CommerceInvalidationSets' },
      ),
    ).toBe(`export const commerceInvalidationSets = {
  'cart/add': [
    { query: 'cart', domains: ['cart'], keys: null },
    { query: 'orderHistory', domains: ['order'], keys: null },
    { query: 'productGrid', domains: ['product'], keys: { 'product': 'arg:productId' } },
  ],
} as const;

export interface CommerceInvalidationSets {
  'cart/add': 'cart' | 'orderHistory' | 'productGrid';
}
`);
  });

  it('serializes legacy graph entries without read sites as empty reads', () => {
    expect(
      serializeTouchGraph({
        'legacy.write': {
          touches: [],
          unresolved: [],
        },
      }),
    ).toBe(`export const touchGraph = {
  "legacy.write": {
    touches: [
    ],
    reads: [
    ],
    unresolved: [
    ],
  },
} as const;
`);
  });

  it('extracts direct Drizzle write calls from annotated source tables', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export async function addItem(db) {
            await db.insert(cartItems).values({ productId: "p1" });
            await db.update(products).set({ reserved: true });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          { domain: 'cart', keys: null, site: 'cart.domain.ts:6', via: 'cart_items' },
          { domain: 'product', keys: null, site: 'cart.domain.ts:7', via: 'products' },
        ],
        unresolved: [],
      },
    });
  });

  it('does not leak source extraction state between repeated source calls', () => {
    const first = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));

          export function save(db) {
            return db.insert(items).values({ id: "cart-1" });
          }
        `,
      },
    ]);
    const second = extractTouchGraphFromSource([
      {
        fileName: 'order.domain.ts',
        source: `
          export const items = pgTable("order_items", {}, jiso({ domain: "order", key: "id" }));

          export function save(db) {
            return db.insert(items).values({ id: "order-1" });
          }
        `,
      },
    ]);
    const third = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));

          export function save(db) {
            return db.insert(items).values({ id: "cart-2" });
          }
        `,
      },
    ]);

    expect(first).toEqual({
      save: {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:5', via: 'cart_items' }],
        unresolved: [],
      },
    });
    expect(second).toEqual({
      save: {
        reads: [],
        touches: [{ domain: 'order', keys: null, site: 'order.domain.ts:5', via: 'order_items' }],
        unresolved: [],
      },
    });
    expect(third).toEqual({
      save: {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:5', via: 'cart_items' }],
        unresolved: [],
      },
    });
  });

  it('extracts direct Drizzle write calls from exported arrow handlers', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export const addItem = async (db) => {
            await db.insert(cartItems).values({ productId: "p1" });
            await db.update(products).set({ reserved: true });
          };
        `,
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          { domain: 'cart', keys: null, site: 'cart.domain.ts:6', via: 'cart_items' },
          { domain: 'product', keys: null, site: 'cart.domain.ts:7', via: 'products' },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts direct Drizzle write calls from functions with parenthesized parameter initializers', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));

          export function addItem(db = makeDb()) {
            return db.insert(cartItems).values({ productId: "p1" });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:5', via: 'cart_items' }],
        unresolved: [],
      },
    });
  });

  it('marks source destructured receiver parameters as FW406 instead of extracting table facts', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'export async function addItem({ db: writer } = makeContext(), productId) {',
          '  await writer.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
          '}',
        ].join('\n'),
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
            site: 'cart.domain.ts:4',
          },
        ],
      },
    });
  });

  it('marks quoted source destructured receiver parameters as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'export async function addItem({ "db": writer } = makeContext(), productId) {',
          '  await writer.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
          '}',
        ].join('\n'),
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
            site: 'cart.domain.ts:4',
          },
        ],
      },
    });
  });

  it('does not mark shadowed source destructured receiver names as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'export async function addItem({ db: writer } = makeContext(), productId) {',
          '  {',
          '  const writer = fakeDb();',
          '  await writer.update(cartItems).set({ productId });',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({});
  });

  it('extracts source writes through static element-access write methods', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'export async function addItem(db, productId) {',
          '  await db["insert"](cartItems).values({ productId });',
          '  await db["update"](cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          { domain: 'cart', keys: null, site: 'cart.domain.ts:4', via: 'cart_items' },
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts Drizzle writes through transaction callback receiver aliases', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

          export async function addItem(db, productId) {
            await db.transaction(async (writer) => {
              await writer.insert(cartItems).values({ productId });
              await writeAudit(writer, productId);
            });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:7',
          },
        ],
      },
    });
  });

  it('does not leak transaction callback receiver aliases into unrelated or shadowed callbacks', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'export async function addItem(db, productId, queue) {',
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
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts expression-bodied arrow write handlers', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));

          export const addItem = (db) => db.insert(cartItems).values({ productId: "p1" });
        `,
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:4', via: 'cart_items' }],
        unresolved: [],
      },
    });
  });

  it('marks expression-bodied external helpers receiving a Drizzle receiver as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const addItem = (db) => writeAudit(db);
        `,
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
            site: 'cart.domain.ts:2',
          },
        ],
      },
    });
  });

  it('does not fabricate source-mode writes from comments and strings', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export async function describeWrite(db) {
            const fixture = "await db.update(products).set({ reserved: true })";
            // await db.delete(products);
            return fixture;
          }
        `,
      },
    ]);

    expect(graph).toEqual({});
  });

  it('omits write-side-only exempt table writes from the touch graph', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const auditLog = pgTable("audit_log", {}, jiso({ exempt: true }));
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export async function restockProduct(db) {
            await db.insert(auditLog).values({ event: "restock" });
            await db.update(products).set({ stock: 10 });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      restockProduct: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'product.domain.ts:7', via: 'products' }],
        unresolved: [],
      },
    });
  });

  it('extracts writes from exported variable-assigned mutation handlers', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export const restockProduct = async function (db) {
            await db.update(products).set({ stock: 10 });
          };
          export let addItem = (db) => {
            await db.insert(cartItems).values({ productId: "p1" });
          };
          export var removeProduct = function removeProduct(db) {
            await db.delete(products);
          };
        `,
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:9', via: 'cart_items' }],
        unresolved: [],
      },
      removeProduct: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'cart.domain.ts:12', via: 'products' }],
        unresolved: [],
      },
      restockProduct: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'cart.domain.ts:6', via: 'products' }],
        unresolved: [],
      },
    });
  });

  it('does not treat arbitrary domain objects as source tables', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartConfig = { domain: "cart", key: "cartId", name: "cart_items" };

          export async function addItem(db) {
            await db.insert(cartConfig).values({ productId: "p1" });
          }
        `,
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
            site: 'cart.domain.ts:5',
          },
        ],
      },
    });
  });

  it('does not treat source consts with domain and key properties as tables', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartConfig = {
            domain: "cart",
            key: "cartId",
            pgTable: "cart_items",
            jiso: true,
          };

          export async function addItem(db) {
            await db.insert(cartConfig).values({ productId: "p1" });
          }
        `,
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
            site: 'cart.domain.ts:10',
          },
        ],
      },
    });
  });

  it('recognizes source-mode pgTable initializers with jiso annotations as tables', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {
            cartId: text("cart_id"),
          }, jiso({ domain: "cart", key: "cartId" }));

          export async function addItem(db) {
            await db.insert(cartItems).values({ productId: "p1" });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:7', via: 'cart_items' }],
        unresolved: [],
      },
    });
  });

  it('ignores source-mode table declarations inside comments and strings', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          const fixture = "export const ghost = pgTable(\\"ghost\\", {}, jiso({ domain: \\"ghost\\", key: \\"id\\" }))";
          // export const commented = pgTable("commented", {}, jiso({ domain: "commented", key: "id" }));

          export async function addItem(db) {
            await db.insert(ghost).values({ id: "g1" });
            await db.insert(commented).values({ id: "c1" });
          }
        `,
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
            site: 'cart.domain.ts:6',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:7',
          },
        ],
      },
    });
  });

  it('recognizes semicolonless source-mode table and alias declarations', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {
            cartId: text("cart_id"),
          }, jiso({ domain: "cart", key: "cartId" }))
          const writeTarget = cartItems

          export async function addItem(db, cartId) {
            await db.update(writeTarget).set({ touched: true }).where(eq(writeTarget.cartId, cartId))
          }
        `,
      },
    ]);

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

  it('extracts query result shapes, read domains, and instance keys from Drizzle selects', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'cart.queries.ts',
        source: `
          export const cartItems = pgTable("cart_items", { cartId: text("cart_id").notNull(), productId: text("product_id").notNull(), qty: integer("qty").notNull() }, jiso({ domain: "cart", key: "cartId" }));
          export const products = pgTable("products", { id: text("id").primaryKey() }, jiso({ domain: "product", key: "id" }));

          export const cartQuery = query("cart", {
            output: s.object({ count: s.number() }),
            async load(input, db: PgDatabase) {
              return db.select({
                count: sql<number>\`count(*)\`,
                productId: products.id,
                item: {
                  qty: cartItems.qty,
                },
              }).from(cartItems).innerJoin(products, eq(products.id, cartItems.productId)).where(eq(cartItems.cartId, input.cartId));
            },
          });
        `,
      },
    ]);

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
        site: 'cart.queries.ts:5',
      },
    ]);
  });

  it('extracts query facts from Drizzle distinct selects', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, jiso({ domain: "product", key: "id" }));

          export const distinctProducts = query("products/distinct", {
            load(_input, db: PgDatabase) {
              return db.selectDistinct({ name: products.name }).from(products);
            },
          });

          export const firstProductNames = query("products/distinct-on", {
            load(_input, db: PgDatabase) {
              return db.selectDistinctOn([products.id], { id: products.id, name: products.name }).from(products);
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([
      {
        query: 'products/distinct',
        reads: ['product'],
        shape: {
          name: 'string',
        },
        site: 'product.queries.ts:7',
      },
      {
        query: 'products/distinct-on',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'product.queries.ts:13',
      },
    ]);
  });

  it('extracts query instance keys from static element access predicates', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'cart.queries.ts',
        source: `
          export const cartItems = pgTable("cart_items", {
            cartId: text("cart_id").notNull(),
            qty: integer("qty").notNull(),
          }, jiso({ domain: "cart", key: "cartId" }));

          export const cartQuery = query("cart", {
            load(input, db: PgDatabase) {
              return db.select({
                qty: cartItems.qty,
              }).from(cartItems).where(eq(cartItems["cartId"], input["cartId"]));
            },
          });
        `,
      },
    ]);

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
        site: 'cart.queries.ts:7',
      },
    ]);
  });

  it('marks computed query read sources as FW406 instead of dropping them', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", { id: text("id").primaryKey() }, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgDatabase) {
              return db.select({ id: products.id }).from((() => products)());
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query read source for db.from() could not be resolved to a Drizzle table.',
            severity: 'warn',
            site: 'product.queries.ts:4',
          },
        ],
        query: 'product',
        reads: [],
        shape: {
          id: 'string',
        },
        site: 'product.queries.ts:4',
      },
    ]);
  });

  it('scopes namespace-imported query tables to the referenced source module', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'cart.schema.ts',
        source: `
          export const products = pgTable("cart_products", {
            id: text("id").primaryKey(),
          }, jiso({ domain: "cart", key: "id" }));
        `,
      },
      {
        fileName: 'order.schema.ts',
        source: `
          export const products = pgTable("order_products", {
            id: integer("id").primaryKey(),
          }, jiso({ domain: "order", key: "id" }));
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
    ]);

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

  it('resolves namespace-imported project query projection shapes from table symbols', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'cart.schema.ts',
          source: `
            export const products = pgTable("cart_products", {
              id: text("id").primaryKey(),
            }, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'order.schema.ts',
          source: `
            export const products = pgTable("order_products", {
              id: integer("id").primaryKey(),
            }, jiso({ domain: "order", key: "id" }));
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
            }, jiso({ domain: "cart", key: "id" }));
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
            }, jiso({ domain: "cart", key: "id" }));
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

  it('reports FW411 when a query read set includes an exempt table', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const auditLog = pgTable("audit_log", { message: text("message").notNull(), productId: text("product_id").notNull() }, jiso({ exempt: true }));
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, jiso({ domain: "product", key: "id" }));

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
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW411',
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
        code: 'FW411',
        message: 'Query read set includes an exempt table. Tables: audit_log.',
        severity: 'error',
        site: 'product.queries.ts:5',
      },
    ]);
  });

  it('derives source query shapes from Drizzle column builders instead of selected aliases', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {
            archived: boolean("archived").notNull(),
            id: text("id").primaryKey(),
            metadata: json("metadata"),
            name: text("name"),
            stock: integer("stock").notNull(),
          }, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgDatabase) {
              return db.select({
                archived: products.archived,
                discount: products.name,
                id: products.id,
                metadata: products.metadata,
                stock: products.stock,
              }).from(products);
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([
      {
        query: 'product',
        reads: ['product'],
        shape: {
          archived: 'boolean',
          discount: {
            kind: 'nullable',
            shape: 'string',
          },
          id: 'string',
          metadata: {
            kind: 'nullable',
            shape: 'object',
          },
          stock: 'number',
        },
        site: 'product.queries.ts:10',
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
          }, jiso({ domain: "product", key: "id" }));

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

    for (const facts of [
      extractQueryFactsFromSource(files),
      extractQueryFactsFromProject({ files }),
    ]) {
      expect(facts).toHaveLength(1);
      expect(facts[0]?.shape).toEqual(expectedShape);
    }
  });

  it('marks unknown column builder projections as FW406 instead of guessing string shape', () => {
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
          }, jiso({ domain: "product", key: "id" }));

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

    for (const facts of [
      extractQueryFactsFromSource(files),
      extractQueryFactsFromProject({ files }),
    ]) {
      expect(facts).toEqual([
        {
          diagnostics: [
            {
              code: 'FW406',
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

  it('derives source query result shape from the returned select', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const auditLog = pgTable("audit_log", {
            id: text("id").primaryKey(),
            message: text("message").notNull(),
          }, jiso({ domain: "audit", key: "id" }));
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            async load(_input, db: PgDatabase) {
              await db.select({ message: auditLog.message }).from(auditLog);
              return db.select({ name: products.name }).from(products);
            },
          });
        `,
      },
    ]);

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

  it('does not derive returned select shape from comments or strings', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const auditLog = pgTable("audit_log", {
            id: text("id").primaryKey(),
            message: text("message").notNull(),
          }, jiso({ domain: "audit", key: "id" }));
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, jiso({ domain: "product", key: "id" }));

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
    ]);

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

  it('reports FW410 for opaque query projections without declared output schemas', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'cart.queries.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));

          export const cartQuery = query("cart", {
            async load(input, db: PgDatabase) {
              return db.select({
                count: sql<number>\`count(*)\`,
              }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW410',
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
        code: 'FW410',
        message:
          'Opaque query projection requires a declared output schema. cart.count uses sql/raw projection without output.',
        severity: 'error',
        site: 'cart.queries.ts:4',
      },
    ]);
  });

  it('recognizes static AST output schema properties for opaque projections', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'cart.queries.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));

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
    ]);

    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
    expect(facts.map((fact) => fact.query)).toEqual(['cart/computed', 'cart/literal']);
  });

  it('does not treat comments or strings as declared query output schemas', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'cart.queries.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));

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
    ]);

    expect(diagnosticsForQueryFacts(facts)).toEqual([
      {
        code: 'FW410',
        message:
          'Opaque query projection requires a declared output schema. cart.count uses sql/raw projection without output.',
        severity: 'error',
        site: 'cart.queries.ts:4',
      },
    ]);
  });

  it('does not treat dynamic output keys or spread contents as declared query output schemas', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'cart.queries.ts',
        source: `
          const outputKey = "output";
          const sharedQueryConfig = { output: s.object({ count: s.number() }) };
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));

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
    ]);

    expect(
      diagnosticsForQueryFacts(facts).map(({ code, message, severity }) => ({
        code,
        message,
        severity,
      })),
    ).toEqual([
      {
        code: 'FW410',
        message:
          'Opaque query projection requires a declared output schema. cart/dynamic.count uses sql/raw projection without output.',
        severity: 'error',
      },
      {
        code: 'FW410',
        message:
          'Opaque query projection requires a declared output schema. cart/spread.count uses sql/raw projection without output.',
        severity: 'error',
      },
    ]);
  });

  it('omits instance keys when Drizzle query predicates do not target an annotated table key', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", { sku: text("sku").notNull() }, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(input, db: PgDatabase) {
              return db.select({ sku: products.sku }).from(products).where(eq(products.sku, input.sku));
            },
          });
        `,
      },
    ]);

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
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(input, db: PgDatabase) {
              const fixture = ".where(eq(products.id, input.id))";
              // return db.select({ name: products.name }).from(products).where(eq(products.id, input.id));
              return db.select({ name: products.name }).from(products);
            },
          });
        `,
      },
    ]);

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

  it('marks unresolved computed projections as FW406 instead of guessing from selected aliases', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, jiso({ domain: "product", key: "id" }));

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
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query projection product.displayName could not be resolved to a Drizzle column or typed sql<T> expression.',
            severity: 'warn',
            site: 'product.queries.ts:7',
          },
          {
            code: 'FW406',
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
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, jiso({ domain: "product", key: "id" }));

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
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
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
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
            name: text("name").notNull(),
          }, jiso({ domain: "product", key: "id" }));

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
    ]);

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
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
          }, jiso({ domain: "product", key: "id" }));

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
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
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

  it('marks shorthand projections as FW406 instead of dropping them', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
          }, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgDatabase) {
              const id = products.id;
              return db.select({ id }).from(products);
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
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

  it('keeps projection-less selects visible as FW406 query facts', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgDatabase) {
              return db.select().from(products);
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
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
        code: 'FW406',
        message:
          'Statically un-analyzable write site; manual touches required. Query uses db.select() without an explicit projection.',
        severity: 'warn',
        site: 'product.queries.ts:4',
      },
    ]);
  });

  it('keeps raw query receiver calls visible as FW406 query facts', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product/raw", {
            load(_input, db: PgDatabase) {
              return db.execute(sql\`select * from products\`);
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
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

  it('keeps computed query receiver calls visible as FW406 query facts', () => {
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
            code: 'FW406',
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

  it('keeps relational query API reads visible as FW406 query facts', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: `
          export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));

          export const usersQuery = query("users", {
            load(_input, db: PgDatabase) {
              return db.query.users.findMany({ where: eq(users.active, true) });
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
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
        code: 'FW406',
        message:
          'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
        severity: 'warn',
        site: 'user.queries.ts:4',
      },
    ]);
  });

  it('keeps static element-access relational API reads visible as FW406 query facts', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: `
          export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));

          export const usersQuery = query("users", {
            load(_input, db: PgDatabase) {
              return db.query['users']['findMany']({ where: eq(users.active, true) });
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
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
            export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));
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
            code: 'FW406',
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

  it('marks project relational query read sources that cannot resolve to a table as FW406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'user.queries.ts',
          source: `
            export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));

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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
            site: 'user.queries.ts:4',
          },
          {
            code: 'FW406',
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

  it('marks project query-loader writes as FW406 instead of dropping the query fact', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, jiso({ domain: "product", key: "id" }));

            export const productQuery = query("product/write", {
              async load(_input, db: PgDatabase) {
                await db.update(products).set({ id: "p1" });
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db.update().',
            severity: 'warn',
            site: 'product.queries.ts:6',
          },
        ],
        query: 'product/write',
        reads: [],
        shape: {},
        site: 'product.queries.ts:6',
      },
    ]);
  });

  it('extracts project shorthand query-loader functions through typed receiver symbols', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
            '',
            'function load(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'export const productQuery = query("product/shorthand-loader", {',
            '  load,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/shorthand-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('extracts project member-referenced query-loader functions through typed receiver symbols', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
            '',
            'const loaders = {',
            '  product(_input: unknown, db: PgDatabase<any, any, any>) {',
            '    return db.select({ id: products.id, stock: products.stock }).from(products);',
            '  },',
            '};',
            '',
            'export const productQuery = query("product/member-loader", {',
            '  load: loaders.product,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/member-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:14',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('extracts project query-loader callbacks through static object aliases and spreads', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  select(): { from(table: unknown): Promise<unknown> };',
            '}',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, jiso({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id }).from(products);',
            '}',
            'function fakeLoad(_input: unknown, fake: FakeDb) {',
            '  return fake.select().from(products);',
            '}',
            '',
            'const base = { loadProducts };',
            'const alias = base;',
            'const spread = { ...base };',
            'const overridden = { ...base, loadProducts: fakeLoad };',
            '',
            'export const aliasedQuery = query("product/project-object-alias-loader", {',
            '  load: alias.loadProducts,',
            '});',
            '',
            'export const spreadQuery = query("product/project-object-spread-loader", {',
            '  load: spread["loadProducts"],',
            '});',
            '',
            'export const overriddenQuery = query("product/project-overridden-object-spread-loader", {',
            '  load: overridden.loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/project-object-alias-loader',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.queries.ts:23',
      },
      {
        query: 'product/project-object-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.queries.ts:27',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('extracts project query loaders from static config spreads and degrades obscuring spreads', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const dynamicConfig: any;',
            'const base = { load: loadProducts };',
            'const spread = { ...base };',
            '',
            'export const spreadQuery = query("product/project-config-spread-loader", {',
            '  ...spread,',
            '});',
            '',
            'export const obscuredQuery = query("product/project-config-obscured-loader", {',
            '  load: loadProducts,',
            '  ...dynamicConfig,',
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
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'warn',
            site: 'product.queries.ts:20',
          },
        ],
        query: 'product/project-config-obscured-loader',
        reads: [],
        shape: {},
        site: 'product.queries.ts:20',
      },
      {
        query: 'product/project-config-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:16',
      },
    ]);
  });

  it('extracts project query loaders from conditional config spreads and degrades opaque branches', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const useDynamic: boolean;',
            'declare const dynamicConfig: any;',
            'const staticConfig = { load: loadProducts };',
            '',
            'export const productQuery = query("product/project-conditional-config-spread-loader", {',
            '  ...(useDynamic ? dynamicConfig : staticConfig),',
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
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'warn',
            site: 'product.queries.ts:16',
          },
        ],
        query: 'product/project-conditional-config-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:16',
      },
    ]);
  });

  it('extracts project query loaders from direct conditional load members', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const useDynamic: boolean;',
            'declare const dynamicLoad: any;',
            '',
            'export const productQuery = query("product/project-conditional-load-member", {',
            '  load: useDynamic ? dynamicLoad : loadProducts,',
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
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'warn',
            site: 'product.queries.ts:15',
          },
        ],
        query: 'product/project-conditional-load-member',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:15',
      },
    ]);
  });

  it('extracts project query loaders from static external config objects and degrades unresolved configs', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const dynamicConfig: any;',
            'const baseConfig = { load: loadProducts };',
            'const configAlias = baseConfig;',
            'export const configQuery = query("product/project-external-config-loader", configAlias);',
            'export const dynamicQuery = query("product/project-dynamic-config-loader", dynamicConfig);',
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
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'warn',
            site: 'product.queries.ts:16',
          },
        ],
        query: 'product/project-dynamic-config-loader',
        reads: [],
        shape: {},
        site: 'product.queries.ts:16',
      },
      {
        query: 'product/project-external-config-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:15',
      },
    ]);
  });

  it('extracts project domain actions from static config spreads and degrades unresolved callbacks', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            'function fakeAdd(db: FakeDb, productId: string) {',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'declare const actionName: string;',
            'const callbacks = { addItem };',
            'const base = {',
            '  addItem: write(addItem),',
            '  unresolved: write(callbacks[actionName]),',
            '};',
            'const spread = { ...base };',
            'const overridden = { ...base, addItem: write(fakeAdd) };',
            '',
            'export const cart = domain({',
            '  ...spread,',
            '  addDirect: write(addItem),',
            '  ...overridden,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addDirect': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.unresolved': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:21',
          },
        ],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts project query-loader callbacks through nested static object aliases', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            'function emptyLoad() {',
            '  return [];',
            '}',
            '',
            'const base = { nested: { loadProducts } };',
            'const alias = base;',
            'const spread = { ...base };',
            'const overridden = { ...base, nested: { loadProducts: emptyLoad } };',
            '',
            'export const aliasedQuery = query("product/project-nested-object-alias-loader", {',
            '  load: alias.nested.loadProducts,',
            '});',
            '',
            'export const spreadQuery = query("product/project-nested-object-spread-loader", {',
            '  load: spread["nested"]["loadProducts"],',
            '});',
            '',
            'export const overriddenQuery = query("product/project-overridden-nested-object-loader", {',
            '  load: overridden.nested.loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/project-nested-object-alias-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:20',
      },
      {
        query: 'product/project-nested-object-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:24',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('extracts project callbacks through destructured static callback containers', () => {
    const files = [
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
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
          'export const productQuery = query("product/destructured-callback-container", {',
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
            site: 'product.domain.ts:9',
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
            site: 'product.domain.ts:13',
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
            site: 'product.domain.ts:9',
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
        site: 'product.domain.ts:25',
      },
    ]);
  });

  it('extracts project callbacks through tuple-destructured static callback containers', () => {
    const files = [
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
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
          'export const productQuery = query("product/tuple-destructured-callback-container", {',
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
            site: 'product.domain.ts:9',
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
            site: 'product.domain.ts:13',
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
            site: 'product.domain.ts:9',
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
        site: 'product.domain.ts:25',
      },
    ]);
  });

  it('extracts project callbacks and configs through tuple-indexed static containers', () => {
    const files = [
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
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
          'export const productQuery = query("product/tuple-indexed-config", queryConfigs[0]);',
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
            site: 'product.domain.ts:9',
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
            site: 'product.domain.ts:13',
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
            site: 'product.domain.ts:9',
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
        site: 'product.domain.ts:22',
      },
    ]);
  });

  it('extracts imported project query-loader callbacks through ts-morph aliases', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'schema.ts',
          source: [
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  name: text("name").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
          ].join('\n'),
        },
        {
          fileName: 'loaders.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { products } from "./schema";',
            '',
            'export function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            'export const loaders = { loadProducts };',
          ].join('\n'),
        },
        {
          fileName: 'product.queries.ts',
          source: [
            'import { loadProducts, loaders } from "./loaders";',
            '',
            'export const productQuery = query("product/imported-loader", {',
            '  load: loadProducts,',
            '});',
            '',
            'export const memberQuery = query("product/imported-member-loader", {',
            '  load: loaders.loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/imported-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'product.queries.ts:3',
      },
      {
        query: 'product/imported-member-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'product.queries.ts:7',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('extracts namespace-imported project query-loader callback containers through barrels', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'schema.ts',
          source: [
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  name: text("name").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
          ].join('\n'),
        },
        {
          fileName: 'loaders.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { products } from "./schema";',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            'export const loaders = { loadProducts };',
          ].join('\n'),
        },
        {
          fileName: 'barrel.ts',
          source: ['export { loaders } from "./loaders";'].join('\n'),
        },
        {
          fileName: 'product.queries.ts',
          source: [
            'import * as LoaderBarrel from "./barrel";',
            '',
            'export const productQuery = query("product/namespace-barrel-loader", {',
            '  load: LoaderBarrel.loaders["loadProducts"],',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/namespace-barrel-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'product.queries.ts:3',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('does not fabricate project query facts from untyped shorthand query-loader receivers', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, jiso({ domain: "product", key: "id" }));',
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
        {
          fileName: 'product.queries.ts',
          source: [
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, jiso({ domain: "product", key: "id" }));',
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
            site: 'product.queries.ts:11',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call carrier.db.execute().',
            severity: 'warn',
            site: 'product.queries.ts:11',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call carrier.db.update().',
            severity: 'warn',
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
        {
          fileName: 'product.queries.ts',
          source: [
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, jiso({ domain: "product", key: "id" }));',
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses Drizzle relational query API without static projection.',
            severity: 'warn',
            site: 'product.queries.ts:11',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call nested.inner.db.execute().',
            severity: 'warn',
            site: 'product.queries.ts:11',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call nested.inner.db.update().',
            severity: 'warn',
            site: 'product.queries.ts:11',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'product.queries.ts:11',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver nested to helper runReport().',
            severity: 'warn',
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

  it('marks project query-loader detached receiver method aliases as FW406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, jiso({ domain: "product", key: "id" }));

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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'product.queries.ts:12',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method update().',
            severity: 'warn',
            site: 'product.queries.ts:12',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'product.queries.ts:12',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method $count().',
            severity: 'warn',
            site: 'product.queries.ts:12',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method query().',
            severity: 'warn',
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

  it('uses project query-loader detached receiver method symbols without name fallback', () => {
    const facts = extractQueryFactsFromProject({
      files: [
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'product.queries.ts:5',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
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

  it('marks project query-loader bound receiver method aliases as FW406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method execute().',
            severity: 'warn',
            site: 'product.queries.ts:6',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses detached Drizzle receiver method <computed>().',
            severity: 'warn',
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
            }, jiso({ domain: "product", key: "id" }));

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
            }, jiso({ domain: "product", key: "id" }));

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
            '}, jiso({ exempt: true }));',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, jiso({ domain: "product", key: "id" }));',
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

  it('marks query-loader helpers receiving db as FW406 instead of dropping the query fact', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, jiso({ domain: "product", key: "id" }));

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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper loadProducts().',
            severity: 'warn',
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

  it('marks query-loader member helpers receiving db as FW406 instead of dropping the query fact', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, jiso({ domain: "product", key: "id" }));

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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper productServices.loadProducts().',
            severity: 'warn',
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

  it('marks query-loader helpers receiving db through containers as FW406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";

            interface FakeDb {
              select(value?: unknown): { from(table: unknown): Promise<unknown[]> };
            }

            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, jiso({ domain: "product", key: "id" }));

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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver db to helper loadProducts().',
            severity: 'warn',
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

  it('marks query-loader helpers receiving typed Drizzle context containers as FW406', () => {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to helper loadProducts().',
            severity: 'warn',
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

  it('marks local query-loader helpers receiving carrier aliases as FW406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to local helper runReport().',
            severity: 'warn',
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

  it('marks local query-loader helpers receiving assigned carrier aliases as FW406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to local helper runReport().',
            severity: 'warn',
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
            '}, jiso({ domain: "product", key: "id" }));',
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
            '}, jiso({ domain: "product", key: "id" }));',
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
          '}, jiso({ domain: "product", key: "id" }));',
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

  it('marks local query-loader helper writes as FW406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, jiso({ domain: "product", key: "id" }));',
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query local helper touches Drizzle table via update().',
            severity: 'warn',
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
            '}, jiso({ domain: "audit", key: "id" }));',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, jiso({ domain: "product", key: "id" }));',
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
            '}, jiso({ domain: "audit", key: "id" }));',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, jiso({ domain: "product", key: "id" }));',
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

  it('does not fabricate query reads or relational diagnostics from comments and strings', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const auditLog = pgTable("audit_log", {}, jiso({ exempt: true }));
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, db: PgDatabase) {
              const fixture = ".from(auditLog) db.query.auditLog.findMany(";
              // return db.query.auditLog.findMany({ where: eq(auditLog.productId, products.id) });
              return db.select({ name: products.name }).from(products);
            },
          });
        `,
      },
    ]);

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
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const auditLog = pgTable("audit_log", {}, jiso({ exempt: true }));
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(_input, reader) {
              const fixture = { query: { auditLog: { findMany() { return []; } } } };
              fixture.query.auditLog.findMany();
              return reader.select({ name: products.name }).from(products);
            },
          });
        `,
      },
    ]);

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
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const auditLog = pgTable("audit_log", { productId: text("product_id").notNull() }, jiso({ exempt: true }));
          export const products = pgTable("products", { id: text("id").primaryKey(), name: text("name").notNull() }, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(input, reader) {
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
    ]);

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
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
          }, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product/destructured-fake", {
            load(_input, { fake }) {
              return fake.select({ id: products.id }).from(products);
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([]);
  });

  it('marks source query-loader db destructuring as FW406 instead of deriving reads', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {
            id: text("id").primaryKey(),
          }, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product/destructured-db", {
            load(_input, { db: reader }) {
              return reader.select({ id: products.id }).from(products);
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode destructured Drizzle receiver surface select() without project type proof.',
            severity: 'warn',
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

  it('marks quoted source query-loader db destructuring as FW406 instead of deriving reads', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: [
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export const productQuery = query("product/quoted-destructured-db", {',
          '  load(_input, { "db": reader }) {',
          '    return reader.select({ id: products.id }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode destructured Drizzle receiver surface select() without project type proof.',
            severity: 'warn',
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
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const auditLog = pgTable("audit_log", {',
          '  id: text("id").primaryKey(),',
          '}, jiso({ exempt: true }));',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export const productQuery = query("product/non-loader-callback", {',
          '  guard(_input, db: PgDatabase<any, any, any>) {',
          '    db.execute(sql`select * from audit_log`);',
          '    return db.select({ id: auditLog.id }).from(auditLog);',
          '  },',
          '  load(_input, db: PgDatabase<any, any, any>) {',
          '    return db.select({ id: products.id }).from(products);',
          '  },',
          '});',
        ].join('\n'),
      },
    ];

    for (const facts of [
      extractQueryFactsFromSource(files),
      extractQueryFactsFromProject({ files }),
    ]) {
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
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'audit.queries.ts',
        source: [
          'export const auditLog = pgTable("audit_log", { message: text("message").notNull() }, jiso({ domain: "audit", key: "id" }));',
          '',
          '// export const commentedQuery = query("commented", { load(_input, db: PgDatabase) { return db.select({ message: auditLog.message }).from(auditLog); } });',
          'const quoted = \'export const quotedQuery = query("quoted", { load(_input, db: PgDatabase) { return db.select({ message: auditLog.message }).from(auditLog); } });\';',
          'const templated = `export const templatedQuery = query("templated", { load(_input, db: PgDatabase) { return db.select({ message: auditLog.message }).from(auditLog); } });`;',
          'export const keepModule = { quoted, templated };',
          '',
        ].join('\n'),
      },
    ]);

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
            }, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'order.schema.ts',
          source: `
            export const items = pgTable("order_items", {}, jiso({ domain: "order", key: "id" }));
          `,
        },
        {
          fileName: 'cart.queries.ts',
          source: `
            import { items } from "./cart.schema";

            export const cartQuery = query("cart", {
              load(input, db: PgDatabase) {
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
            }, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'queries.ts',
          source: `
            import { items } from "./schema";

            export const itemQuery = query("item", {
              load(input, db: PgDatabase) {
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
            }, jiso({ domain: "order", key: "id" }));
          `,
        },
        {
          fileName: 'queries.ts',
          source: `
            import { items } from "./schema";

            export const itemQuery = query("item", {
              load(input, db: PgDatabase) {
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

  it('marks project-mode computed query read sources as FW406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'schema.ts',
          source: `
            export const items = pgTable("cart_items", {
              id: text("id").primaryKey(),
            }, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'queries.ts',
          source: `
            import { items } from "./schema";

            function tableFor<T>(table: T): T { return table; }

            export const itemQuery = query("item", {
              load(_input, db: PgDatabase) {
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
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query read source for db.from() could not be resolved to a Drizzle table.',
            severity: 'warn',
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
            export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { items } from "./schema";',
            '',
            'export async function save(writer: PgDatabase, id: string) {',
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
            export const items = pgTable("order_items", {}, jiso({ domain: "order", key: "id" }));
          `,
        },
        {
          fileName: 'domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { items } from "./schema";',
            '',
            'export async function save(writer: PgDatabase, id: string) {',
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

  it('derives project query shapes from Drizzle column builders instead of selected aliases', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              archived: boolean("archived").notNull(),
              createdAt: timestamp("created_at"),
              id: text("id").primaryKey(),
              metadata: json("metadata"),
              name: text("name"),
              stock: integer("stock").notNull(),
            }, jiso({ domain: "product", key: "id" }));

            export const productQuery = query("product", {
              load(_input, db: PgDatabase) {
                return db.select({
                  archived: products.archived,
                  createdAt: products.createdAt,
                  discount: products.name,
                  id: products.id,
                  metadata: products.metadata,
                  stock: products.stock,
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
          archived: 'boolean',
          createdAt: {
            kind: 'nullable',
            shape: 'string',
          },
          discount: {
            kind: 'nullable',
            shape: 'string',
          },
          id: 'string',
          metadata: {
            kind: 'nullable',
            shape: 'object',
          },
          stock: 'number',
        },
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('derives project query result shape from the returned select', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const auditLog = pgTable("audit_log", {
              id: text("id").primaryKey(),
              message: text("message").notNull(),
            }, jiso({ domain: "audit", key: "id" }));
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
              name: text("name").notNull(),
            }, jiso({ domain: "product", key: "id" }));

            export const productQuery = query("product", {
              async load(_input, db: PgDatabase) {
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

  it('wraps selected left-joined table columns as nullable project query shapes', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id"),
              name: text("name").notNull(),
            }, jiso({ domain: "product", key: "id" }));
            export const reviews = pgTable("reviews", {
              productId: text("product_id"),
              rating: integer("rating"),
            }, jiso({ domain: "review", key: "productId" }));

            export const productQuery = query("product", {
              load(_input, db: PgDatabase) {
                return db.select({
                  name: products.name,
                  review: { rating: reviews.rating },
                }).from(products).leftJoin(reviews, eq(reviews.productId, products.id));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product',
        reads: ['product', 'review'],
        shape: {
          name: 'string',
          review: {
            kind: 'nullable',
            shape: {
              rating: {
                kind: 'nullable',
                shape: 'number',
              },
            },
          },
        },
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('wraps selected right-joined source table columns as nullable query shapes', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {
            id: text("id"),
            name: text("name").notNull(),
          }, jiso({ domain: "product", key: "id" }));
          export const reviews = pgTable("reviews", {
            productId: text("product_id"),
            rating: integer("rating"),
          }, jiso({ domain: "review", key: "productId" }));

          export const reviewQuery = query("review", {
            load(_input, db: PgDatabase) {
              return db.select({
                product: { name: products.name },
                review: { rating: reviews.rating },
              }).from(products).rightJoin(reviews, eq(reviews.productId, products.id));
            },
          });
        `,
      },
    ]);

    expect(facts).toEqual([
      {
        query: 'review',
        reads: ['product', 'review'],
        shape: {
          product: {
            kind: 'nullable',
            shape: {
              name: {
                kind: 'nullable',
                shape: 'string',
              },
            },
          },
          review: {
            rating: {
              kind: 'nullable',
              shape: 'number',
            },
          },
        },
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('wraps selected full-joined project columns on both sides as nullable query shapes', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id"),
              name: text("name").notNull(),
            }, jiso({ domain: "product", key: "id" }));
            export const reviews = pgTable("reviews", {
              productId: text("product_id"),
              rating: integer("rating").notNull(),
            }, jiso({ domain: "review", key: "productId" }));

            export const productReviewQuery = query("productReview", {
              load(_input, db: PgDatabase) {
                return db.select({
                  productName: products.name,
                  reviewRating: reviews.rating,
                }).from(products).fullJoin(reviews, eq(reviews.productId, products.id));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'productReview',
        reads: ['product', 'review'],
        shape: {
          productName: {
            kind: 'nullable',
            shape: 'string',
          },
          reviewRating: {
            kind: 'nullable',
            shape: 'number',
          },
        },
        site: 'product.queries.ts:11',
      },
    ]);
  });

  it('extracts direct insert-select and update-from read source tables', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
          export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));
          export const vendors = pgTable("vendors", {}, jiso({ domain: "vendor", key: "id" }));
          export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));

          export async function importSnapshots(db) {
            await db.insert(snapshots).select(db.select().from(products).innerJoin(vendors, eq(vendors.id, products.vendorId)));
            await db.update(products).set({ price: prices.amount }).from(prices).where(eq(prices.productId, products.id));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      importSnapshots: {
        reads: [
          {
            domain: 'price',
            keys: null,
            site: 'product.domain.ts:9',
            source: 'update-from',
            via: 'prices',
          },
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:8',
            source: 'insert-select',
            via: 'products',
          },
          {
            domain: 'vendor',
            keys: null,
            site: 'product.domain.ts:8',
            source: 'insert-select',
            via: 'vendors',
          },
        ],
        touches: [
          { domain: 'product', keys: null, site: 'product.domain.ts:9', via: 'products' },
          { domain: 'snapshot', keys: null, site: 'product.domain.ts:8', via: 'product_snapshots' },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts read source tables from write call AST without reparsing statement text', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: [
          'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
          'export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));',
          'export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));',
          '',
          'export async function syncSnapshots(db, productId) {',
          '  await db["insert"](snapshots).select(db.select().from(products).where(gt(sql.raw(".from(prices)"), 0)));',
          '  await db["update"](products).set({ price: prices.amount }).from(prices).where(eq(products.id, productId));',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncSnapshots: {
        reads: [
          {
            domain: 'price',
            keys: null,
            site: 'product.domain.ts:7',
            source: 'update-from',
            via: 'prices',
          },
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:6',
            source: 'insert-select',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:7',
            via: 'products',
          },
          {
            domain: 'snapshot',
            keys: null,
            site: 'product.domain.ts:6',
            via: 'product_snapshots',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('folds local helper writes and reads into caller summaries', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
          export const vendors = pgTable("vendors", {}, jiso({ domain: "vendor", key: "id" }));
          export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));

          async function insertCartItem(db, input) {
            await db.insert(cartItems).values({ productId: input.productId });
          }

          async function snapshotProducts(db) {
            await db.insert(snapshots).select(db.select().from(products).innerJoin(vendors, eq(vendors.id, products.vendorId)));
          }

          export async function addItem(db, input) {
            await insertCartItem(db, input);
            await snapshotProducts(db);
          }
        `,
      },
    ]);

    expect(graph.addItem).toEqual({
      reads: [
        {
          domain: 'product',
          keys: null,
          site: 'cart.domain.ts:12',
          source: 'insert-select',
          via: 'products',
        },
        {
          domain: 'vendor',
          keys: null,
          site: 'cart.domain.ts:12',
          source: 'insert-select',
          via: 'vendors',
        },
      ],
      touches: [
        { domain: 'cart', keys: null, site: 'cart.domain.ts:8', via: 'cart_items' },
        { domain: 'snapshot', keys: null, site: 'cart.domain.ts:12', via: 'product_snapshots' },
      ],
      unresolved: [],
    });
    expect(graph.insertCartItem).toEqual({
      reads: [],
      touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:8', via: 'cart_items' }],
      unresolved: [],
    });
    expect(graph.snapshotProducts).toEqual({
      reads: [
        {
          domain: 'product',
          keys: null,
          site: 'cart.domain.ts:12',
          source: 'insert-select',
          via: 'products',
        },
        {
          domain: 'vendor',
          keys: null,
          site: 'cart.domain.ts:12',
          source: 'insert-select',
          via: 'vendors',
        },
      ],
      touches: [
        { domain: 'snapshot', keys: null, site: 'cart.domain.ts:12', via: 'product_snapshots' },
      ],
      unresolved: [],
    });
  });

  it('does not fold local helper summaries from comments and strings', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));

          async function writeAudit(db, productId) {
            await db.insert(auditLog).values({ productId });
          }

          export async function addItem(db, productId) {
            // await writeAudit(db, productId);
            const fixture = "writeAudit(db, productId)";
            const templated = \`writeAudit(db, \${productId})\`;
            return { fixture, templated };
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      writeAudit: {
        reads: [],
        touches: [
          {
            domain: 'audit',
            keys: null,
            site: 'cart.domain.ts:5',
            via: 'audit_log',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('folds local helper summaries for domain-like helper names', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

          async function insert(db, productId) {
            await db.insert(cartItems).values({ productId });
          }

          export async function addItem(db, productId) {
            await insert(db, productId);
          }
        `,
      },
    ]);

    expect(graph.addItem?.touches).toEqual([
      { domain: 'cart', keys: null, site: 'cart.domain.ts:5', via: 'cart_items' },
    ]);
    expect(graph.insert?.touches).toEqual([
      { domain: 'cart', keys: null, site: 'cart.domain.ts:5', via: 'cart_items' },
    ]);
  });

  it('keeps closure-local helper summaries scoped by symbol instead of helper name', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));
          export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));

          export async function addItem(db, productId) {
            async function apply(db) {
              await db.insert(cartItems).values({ productId });
            }

            await apply(db);
          }

          export async function auditItem(db, productId) {
            async function apply(db) {
              await db.insert(auditLog).values({ productId });
            }

            await apply(db);
          }
        `,
      },
    ]);

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:7', via: 'cart_items' }],
      unresolved: [],
    });
    expect(graph.auditItem).toEqual({
      reads: [],
      touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:15', via: 'audit_log' }],
      unresolved: [],
    });
  });

  it('keeps project closure-local helper summaries scoped by symbol instead of helper name', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function apply(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(cartItems).values({ productId });',
            '  }',
            '',
            '  await apply(db);',
            '}',
            '',
            'export async function auditItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function apply(writer: PgDatabase<any, any, any>) {',
            '    await writer.insert(auditLog).values({ productId });',
            '  }',
            '',
            '  await apply(db);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:8', via: 'cart_items' }],
      unresolved: [],
    });
    expect(graph.auditItem).toEqual({
      reads: [],
      touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:16', via: 'audit_log' }],
      unresolved: [],
    });
  });

  it('folds project local helper summaries through typed receiver carriers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  async function writeAudit({ db: writer }: { db: PgDatabase<any, any, any> }) {',
            '    await writer.insert(auditLog).values({ productId });',
            '  }',
            '',
            '  const context = { db };',
            '  await writeAudit(context);',
            '  await db.insert(cartItems).values({ productId });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [
        { domain: 'audit', keys: null, site: 'cart.domain.ts:7', via: 'audit_log' },
        { domain: 'cart', keys: null, site: 'cart.domain.ts:12', via: 'cart_items' },
      ],
      unresolved: [],
    });
    expect(graph.writeAudit).toEqual({
      reads: [],
      touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:7', via: 'audit_log' }],
      unresolved: [],
    });
  });

  it('does not fold uncalled closure-local helper bodies into parent summaries', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          'export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));',
          '',
          'export async function addItem(db, productId) {',
          '  async function writeAudit(db) {',
          '    await db.insert(auditLog).values({ productId });',
          '  }',
          '  return productId;',
          '}',
          '',
          'export async function calledItem(db, productId) {',
          '  async function writeCart(db) {',
          '    await db.insert(cartItems).values({ productId });',
          '  }',
          '  await writeCart(db);',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph.addItem).toBeUndefined();
    expect(graph.writeAudit).toEqual({
      reads: [],
      touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:6', via: 'audit_log' }],
      unresolved: [],
    });
    expect(graph.calledItem).toEqual({
      reads: [],
      touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:13', via: 'cart_items' }],
      unresolved: [],
    });
  });

  it('does not fold closure-local helper summaries when the call omits a source receiver', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          'export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));',
          '',
          'export async function addItem(db, fake, productId) {',
          '  async function writeAudit(db) {',
          '    await db.insert(auditLog).values({ productId });',
          '  }',
          '  await writeAudit(fake);',
          '  await db.insert(cartItems).values({ productId });',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph.addItem).toEqual({
      reads: [],
      touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:9', via: 'cart_items' }],
      unresolved: [],
    });
    expect(graph.writeAudit).toEqual({
      reads: [],
      touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:6', via: 'audit_log' }],
      unresolved: [],
    });
  });

  it('does not fold project closure-local helper summaries when the call omits a typed receiver', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            'export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));',
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
      touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:15', via: 'cart_items' }],
      unresolved: [],
    });
    expect(graph.writeAudit).toEqual({
      reads: [],
      touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:12', via: 'audit_log' }],
      unresolved: [],
    });
  });

  it('dedupes recursive helper summaries at a fixed point', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

          async function insertCartItem(db) {
            await db.insert(cartItems).values({ productId: "p1" });
            await retryInsert(db);
          }

          async function retryInsert(db) {
            await insertCartItem(db);
          }
        `,
      },
    ]);

    expect(graph.insertCartItem?.touches).toEqual([
      { domain: 'cart', keys: null, site: 'cart.domain.ts:5', via: 'cart_items' },
    ]);
    expect(graph.retryInsert?.touches).toEqual([
      { domain: 'cart', keys: null, site: 'cart.domain.ts:5', via: 'cart_items' },
    ]);
  });

  it('extracts direct parameterized keys from update and delete eq predicates', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export async function updateProduct(db, input, productId) {
            await db.update(products).set({ reserved: true }).where(eq(products.id, input.id));
            await db.delete(cartItems).where(eq(cartItems.cartId, productId));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      updateProduct: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'product.domain.ts:7',
            via: 'cart_items',
          },
          { domain: 'product', keys: 'arg:id', site: 'product.domain.ts:6', via: 'products' },
        ],
        unresolved: [],
      },
    });
  });

  it('does not infer parameterized keys from predicate text inside comments and strings', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export async function scrubPredicates(db, id) {
            await db.update(products).set({ note: ".where(eq(products.id, id))" });
            await db.update(products).set({ /* .where(eq(products.id, id)) */ reserved: true });
          }
        `,
      },
    ]);

    expect(graph.scrubPredicates?.touches).toEqual([
      { domain: 'product', keys: null, site: 'product.domain.ts:5', via: 'products' },
      { domain: 'product', keys: null, site: 'product.domain.ts:6', via: 'products' },
    ]);
  });

  it('does not fabricate non-eq predicate facts from string-contained column names', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export async function scrubPredicate(db, productId) {
            await db.update(products).set({ reserved: true }).where(gt(sql.raw("products.id"), productId));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      scrubPredicate: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'product.domain.ts:5', via: 'products' }],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
  });

  it('does not borrow predicates from following semicolonless write statements', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export async function syncProducts(db, productId) {
            await db.update(products).set({ reserved: true })
            await db.update(products).set({ synced: true }).where(eq(products.id, productId))
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProducts: {
        reads: [],
        touches: [
          { domain: 'product', keys: null, site: 'product.domain.ts:5', via: 'products' },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:6',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('keeps non-key and table-column predicates at table-level', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
          export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));
          export const auditLog = pgTable("audit_log", {});

          export async function syncProduct(db, productId) {
            await db.update(products).set({ reserved: true }).where(eq(products.sku, productId));
            await db.update(products).set({ price: prices.amount }).from(prices).where(eq(products.id, prices.productId));
            await db.update(products).set({ audited: true }).where(eq(products.id, auditLog.id));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'price',
            keys: null,
            site: 'product.domain.ts:8',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          { domain: 'product', keys: null, site: 'product.domain.ts:7', via: 'products' },
          { domain: 'product', keys: null, site: 'product.domain.ts:8', via: 'products' },
          { domain: 'product', keys: null, site: 'product.domain.ts:9', via: 'products' },
        ],
        unresolved: [],
      },
    });
  });

  it('degrades compound key predicates to table-level invalidation', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export async function syncProducts(db, primaryId, fallbackId) {
            await db.update(products).set({ reserved: true }).where(or(eq(products.id, primaryId), eq(products.id, fallbackId)));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProducts: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:5',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:5',
      },
    ]);
  });

  it('marks direct non-equality predicates as FW409 degraded table-level invalidation', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
          export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));

          export async function syncProduct(db, productId) {
            await db.update(products).set({ reserved: true }).where(gt(products.id, productId));
            await db.update(products).set({ price: prices.amount }).from(prices).where(gt(prices.productId, productId));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'price',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:7',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          { domain: 'product', keys: null, site: 'product.domain.ts:7', via: 'products' },
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:6',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:6',
      },
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:7',
      },
    ]);
  });

  it('resolves local Drizzle table aliases for writes, reads, and predicates', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
          const priceAlias = alias(prices, "pr");
          const productAlias = alias(products, "p");

          export async function syncProduct(db, productId) {
            await db.update(productAlias).set({ reserved: true }).where(eq(productAlias.id, productId));
            await db.update(products).set({ price: priceAlias.amount }).from(priceAlias).where(gt(priceAlias.productId, productId));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'price',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:9',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:8',
            via: 'products',
          },
          { domain: 'product', keys: null, site: 'product.domain.ts:9', via: 'products' },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:9',
      },
    ]);
  });

  it('resolves namespace-imported Drizzle schema identifiers', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'schema.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
        `,
      },
      {
        fileName: 'product.domain.ts',
        source: `
          import * as schema from "./schema";

          export async function syncProduct(db, productId) {
            await db.update(schema.products).set({ reserved: true }).where(eq(schema.products.id, productId));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:5',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('does not resolve namespace-imported table identifiers from unrelated source modules', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.schema.ts',
        source: `
          export const products = pgTable("cart_products", {}, jiso({ domain: "cart", key: "id" }));
        `,
      },
      {
        fileName: 'order.schema.ts',
        source: `
          export const products = pgTable("order_products", {}, jiso({ domain: "order", key: "id" }));
        `,
      },
      {
        fileName: 'cart.domain.ts',
        source: `
          import * as cartSchema from "./cart.schema";

          export async function syncProduct(db, productId) {
            await db.update(cartSchema.products).set({ reserved: true }).where(eq(cartSchema.products.id, productId));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'cart.domain.ts:5',
            via: 'cart_products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('does not resolve private table declarations through namespace imports', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.schema.ts',
        source: `
          const hiddenProducts = pgTable("hidden_products", {}, jiso({ domain: "hidden", key: "id" }));
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
        `,
      },
      {
        fileName: 'product.domain.ts',
        source: `
          import * as schema from "./cart.schema";

          export async function syncProduct(db, productId) {
            await db.update(schema.hiddenProducts).set({ reserved: true }).where(eq(schema.hiddenProducts.id, productId));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:5',
          },
        ],
      },
    });
  });

  it('resolves named import and re-export Drizzle schema aliases', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'schema.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
        `,
      },
      {
        fileName: 'tables.ts',
        source: `
          export { products as productTable } from "./schema";
        `,
      },
      {
        fileName: 'product.domain.ts',
        source: `
          import { products as importedProducts } from "./schema";
          import { productTable } from "./tables";

          export async function syncProduct(db, productId) {
            await db.update(importedProducts).set({ reserved: true }).where(eq(importedProducts.id, productId));
            await db.delete(productTable).where(eq(productTable.id, productId));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:6',
            via: 'products',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:7',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('does not resolve Drizzle schema aliases from comments, strings, or templates', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'schema.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
        `,
      },
      {
        fileName: 'product.domain.ts',
        source: `
          const quoted = "import { products as importedProducts } from './schema';";
          // import * as schema from "./schema";

          export async function syncProduct(db, productId) {
            const templated = \`import * as schema from "./schema";\`;
            await db.update(schema.products).set({ reserved: true }).where(eq(schema.products.id, productId));
            await db.update(importedProducts).set({ reserved: false }).where(eq(importedProducts.id, productId));
            return { quoted, templated };
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:7',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:8',
          },
        ],
      },
    });
  });

  it('does not infer renamed Drizzle receiver parameters from broad source-mode names', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

          export async function addItem(client, database, writer, productId) {
            await client.insert(cartItems).values({ productId });
            await database.insert(cartItems).values({ productId });
            await writer.insert(cartItems).values({ productId });
          }
        `,
      },
    ]);

    expect(graph).toEqual({});
  });

  it('extracts write callback bodies from domain authoring surfaces', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

          export const cart = domain({
            addItem: write(async (db, productId) => {
              await db.insert(cartItems).values({ productId });
            }),
          });
        `,
      },
    ]);

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts referenced source write callbacks from domain authoring surfaces', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'async function addItem(db, productId) {',
          '  await db.insert(cartItems).values({ productId });',
          '}',
          '',
          'export const cart = domain({',
          '  addItem: write(addItem),',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts member-referenced source write callbacks from domain authoring surfaces', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'const callbacks = {',
          '  addItem(db, productId) {',
          '    return db.insert(cartItems).values({ productId });',
          '  },',
          '};',
          '',
          'export const cart = domain({',
          '  addItem: write(callbacks.addItem),',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts source member write callback aliases from domain authoring surfaces', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'function addItem(db, productId) {',
          '  return db.insert(cartItems).values({ productId });',
          '}',
          '',
          'const callbacks = {',
          '  aliased: addItem,',
          '  addItem,',
          '};',
          '',
          'export const cart = domain({',
          '  addAliased: write(callbacks.aliased),',
          '  addShorthand: write(callbacks.addItem),',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      'cart.addAliased': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addShorthand': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts configured write callbacks and folds local helper summaries', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

          const writeAudit = async (db, productId) => {
            await db.insert(auditLog).values({ productId });
          };

          export const cart = domain({
            addItem: write({ touches: [cartItems] }, async (db, productId) => {
              await db.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));
              await writeAudit(db, productId);
            }),
          });
        `,
      },
    ]);

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'audit',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'audit_log',
          },
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'cart.domain.ts:11',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      writeAudit: {
        reads: [],
        touches: [
          {
            domain: 'audit',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'audit_log',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('uses typed receiver origins instead of likely receiver names in project extraction', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";

            export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

            interface FakeDb {
              insert(table: unknown): { values(value: unknown): Promise<void> };
            }

            export async function addItem(writer: PgDatabase, db: FakeDb, productId: string) {
              await writer.insert(cartItems).values({ productId });
              await db.insert(cartItems).values({ productId });
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
            site: 'cart.domain.ts:11',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('resolves project Drizzle alias table symbols for writes, reads, and query shapes', () => {
    const files = [
      {
        fileName: 'packages/drizzle/src/product.domain.ts',
        source: [
          'import { eq } from "drizzle-orm";',
          'import { alias, integer, pgTable, text, type PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          'const productAlias = alias(products, "p");',
          '',
          'export async function syncProduct(db: PgDatabase<any, any, any>, productId: string) {',
          '  await db.update(productAlias).set({ stock: 1 }).where(eq(productAlias.id, productId));',
          '  await db.select({ stock: productAlias.stock }).from(productAlias);',
          '}',
          '',
          'export const productQuery = query("product/alias", {',
          '  load(input, db: PgDatabase<any, any, any>) {',
          '    return db.select({ stock: productAlias.stock }).from(productAlias).where(eq(productAlias.id, input.id));',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'packages/drizzle/src/product.domain.ts:12',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'packages/drizzle/src/product.domain.ts:11',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        instanceKey: {
          domain: 'product',
          key: 'arg:id',
        },
        query: 'product/alias',
        reads: ['product'],
        shape: {
          stock: 'number',
        },
        site: 'packages/drizzle/src/product.domain.ts:15',
      },
    ]);
  });

  it('does not fabricate project alias table facts from local alias helpers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'function alias<T>(table: T): T { return table; }',
            'const productAlias = alias(products);',
            '',
            'export async function syncProduct(db: PgDatabase<any, any, any>) {',
            '  await db.update(productAlias).set({ stock: 1 });',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:8',
          },
        ],
      },
    });
  });

  it('marks project raw execute only for typed Drizzle receiver origins', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<void>;']),
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";

            interface FakeDb {
              execute(query: unknown): Promise<void>;
            }

            export async function reconcile(writer: PgDatabase, client: FakeDb) {
              await writer.execute(sql\`update cart_items set synced = true\`);
              await writer['execute'](sql\`update cart_items set audited = true\`);
              await client.execute(sql\`update cart_items set synced = false\`);
              await client['execute'](sql\`update cart_items set audited = false\`);
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      reconcile: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:9',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:10',
          },
        ],
      },
    });
  });

  it('does not promote project receivers from PgDatabase-like type names', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<void>;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface PgDatabaseLike {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            'interface FakeContext { db: PgDatabaseLike }',
            'interface RealContext { db: PgDatabase }',
            '',
            'declare function audit(context: unknown): Promise<void>;',
            '',
            'export async function sync(fake: PgDatabaseLike, fakeContext: FakeContext, realContext: RealContext) {',
            '  await fake.execute("select 1");',
            '  await fakeContext.db.execute("select 1");',
            '  await audit({ db: fake });',
            '  await audit(fakeContext);',
            '  await realContext.db.execute("select 1");',
            '  await audit(realContext);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:17',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:16',
          },
        ],
      },
    });
  });

  it('marks project unresolved helper surfaces only for typed Drizzle receiver symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          '$count(table: unknown): Promise<number>;',
          'execute(query: unknown): Promise<void>;',
          'query: any;',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  $count(table: unknown): Promise<number>;',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));',
            '',
            'declare const sendAudit: (receiver: unknown) => Promise<void>;',
            '',
            'export async function reconcile(db: PgDatabase, fake: FakeDb) {',
            '  await db.execute(sql`delete from cart_items`);',
            '  await fake.execute(sql`delete from cart_items`);',
            '  await sendAudit(db);',
            '  await sendAudit(fake);',
            '  await db.$count(cartItems);',
            '  await fake.$count(cartItems);',
            '  await db.query.cartItems.findMany();',
            '  await fake.query.cartItems.findMany();',
            '}',
            '',
            'export async function shadowed(db: FakeDb) {',
            '  await db.execute(sql`delete from cart_items`);',
            '  await sendAudit(db);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      reconcile: {
        reads: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:20',
            source: 'relational-query',
            via: 'cart_items',
          },
        ],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:16',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:14',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:18',
          },
        ],
      },
    });
  });

  it('marks project member helpers receiving typed Drizzle receivers as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'declare const auditServices: {',
            '  write(receiver: unknown): Promise<void>;',
            '};',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb) {',
            '  await auditServices.write(db);',
            '  await auditServices.write(fake);',
            '}',
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
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:12',
          },
        ],
      },
    });
  });

  it('marks project helpers receiving typed Drizzle receivers through containers as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'declare const auditServices: {',
            '  write(context: unknown): Promise<void>;',
            '};',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb) {',
            '  await auditServices.write({ fake });',
            '  await auditServices.write({ db });',
            '}',
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
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
        ],
      },
    });
  });

  it('marks project helpers receiving assigned typed Drizzle carrier aliases as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'declare const auditServices: {',
            '  write(context: unknown): Promise<void>;',
            '};',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb) {',
            '  let context;',
            '  context = { db };',
            '  let fakeContext;',
            '  fakeContext = { db: fake };',
            '  await auditServices.write(fakeContext);',
            '  await auditServices.write(context);',
            '}',
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
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:17',
          },
        ],
      },
    });
  });

  it('marks project helpers receiving typed Drizzle context containers as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface DrizzleContext { db: PgDatabase }',
            'interface FakeContext { db: unknown }',
            'declare function writeAudit(context: unknown): Promise<void>;',
            '',
            'export async function addItem(context: DrizzleContext, fake: FakeContext) {',
            '  await writeAudit({ fake });',
            '  await writeAudit({ context });',
            '}',
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
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:9',
          },
        ],
      },
    });
  });

  it('marks project local helpers receiving typed Drizzle carrier aliases as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            '',
            'function writeAudit(context: unknown): Promise<void> {',
            '  return Promise.resolve(context);',
            '}',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb) {',
            '  const context = { db };',
            '  const fakeContext = { db: fake };',
            '  await writeAudit(fakeContext);',
            '  await writeAudit(context);',
            '}',
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
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:15',
          },
        ],
      },
    });
  });

  it('marks project local helpers receiving assigned typed Drizzle carrier aliases as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            '',
            'function writeAudit(context: unknown): Promise<void> {',
            '  return Promise.resolve(context);',
            '}',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb) {',
            '  let context;',
            '  context = { db };',
            '  let fakeContext;',
            '  fakeContext = { db: fake };',
            '  await writeAudit(fakeContext);',
            '  await writeAudit(context);',
            '}',
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
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:17',
          },
        ],
      },
    });
  });

  it('marks project unknown direct receiver methods only for typed Drizzle symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          '$with(name: string): unknown;',
          'batch(queries: unknown[]): Promise<unknown[]>;',
          'findFirst(): Promise<unknown>;',
          'findMany(): Promise<unknown[]>;',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  $with(name: string): unknown;',
            '  batch(queries: unknown[]): Promise<unknown[]>;',
            '  findFirst(): Promise<unknown>;',
            '  findMany(): Promise<unknown[]>;',
            '}',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb) {',
            '  await db.batch([]);',
            '  db["$with"]("active_users");',
            '  await db.findMany();',
            '  await db["findFirst"]();',
            '  await fake.batch([]);',
            '  fake["$with"]("active_users");',
            '  await fake.findMany();',
            '  await fake["findFirst"]();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:12',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:14',
          },
        ],
      },
    });
  });

  it('marks project computed receiver methods only for typed Drizzle symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<void>;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'type FakeDb = Record<string, (query: unknown) => Promise<void>>;',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb, method: string) {',
            '  await db[method]("select 1");',
            '  await fake[method]("select 1");',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:6',
          },
        ],
      },
    });
  });

  it('marks project bound detached receiver methods only for typed Drizzle symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb, method: string) {',
            '  const execute = db.execute.bind(db);',
            '  const write = db.update.bind(db);',
            '  const computed = db[method].bind(db);',
            '  const fakeExecute = fake.execute.bind(fake);',
            '  await execute("select 1");',
            '  await write(users).set({});',
            '  await computed("select 1");',
            '  await fakeExecute("select 1");',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:15',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:16',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:17',
          },
        ],
      },
    });
  });

  it('marks project assigned detached receiver methods only for typed Drizzle symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb, method: string) {',
            '  let execute;',
            '  execute = db.execute;',
            '  let write;',
            '  write = db.update;',
            '  let computed;',
            '  computed = db[method];',
            '  let fakeExecute;',
            '  fakeExecute = fake.execute;',
            '  let destructuredExecute;',
            '  ({ execute: destructuredExecute } = db);',
            '  const carrier = { db, fake };',
            '  const carrierExecute = carrier.db.execute;',
            '  let carrierComputed;',
            '  carrierComputed = carrier.db[method];',
            '  const carrierFakeExecute = carrier.fake.execute;',
            '  await execute("select 1");',
            '  await write(users).set({});',
            '  await computed("select 1");',
            '  await destructuredExecute("select 1");',
            '  await carrierExecute("select 1");',
            '  await carrierComputed("select 1");',
            '  await carrierFakeExecute("select 1");',
            '  await fakeExecute("select 1");',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:26',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:27',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:28',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:29',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:30',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:31',
          },
        ],
      },
    });
  });

  it('marks project array-destructured detached receiver methods only for typed Drizzle symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb, method: string) {',
            '  const [execute, write, computed] = [db.execute, db.update, db[method]];',
            '  const [fakeExecute] = [fake.execute];',
            '  let assignedExecute;',
            '  [assignedExecute] = [db.execute];',
            '  await execute("select 1");',
            '  await write(users).set({});',
            '  await computed("select 1");',
            '  await assignedExecute("select 1");',
            '  await fakeExecute("select 1");',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:15',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:16',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:17',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:18',
          },
        ],
      },
    });
  });

  it('extracts project direct typed receiver carrier members without fake sibling facts', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'query: any;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb) {',
            '  const carrier = { db, fake };',
            '  await carrier.db.execute("select 1");',
            '  await carrier.db.update(users).set({});',
            '  await carrier.db.query.users.findMany();',
            '  await carrier.fake.execute("select 1");',
            '  await carrier.fake.update(users).set({});',
            '  await carrier.fake.query.users.findMany();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:15',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:14',
            via: 'users',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
        ],
      },
    });
  });

  it('extracts project spread-copied typed receiver carrier members without overridden fake facts', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'query: any;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb) {',
            '  const carrier = { db, fake };',
            '  const spread = { ...carrier };',
            '  const overwritten = { ...carrier, db: fake };',
            '  await spread.db.execute("select 1");',
            '  await spread.db.update(users).set({});',
            '  await spread.db.query.users.findMany();',
            '  await overwritten.db.execute("select 1");',
            '  await overwritten.db.update(users).set({});',
            '  await overwritten.db.query.users.findMany();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:17',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:16',
            via: 'users',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:15',
          },
        ],
      },
    });
  });

  it('extracts project nested typed receiver carrier members without nested fake overrides', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'query: any;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb) {',
            '  const carrier = { db, fake };',
            '  const nested = { inner: carrier };',
            '  const overwritten = { ...nested, inner: { db: fake } };',
            '  const execute = nested.inner.db.execute;',
            '  await nested.inner.db.execute("select 1");',
            '  await nested.inner.db.update(users).set({});',
            '  await nested.inner.db.query.users.findMany();',
            '  await execute("select 1");',
            '  await audit(nested);',
            '  await audit(nested.inner.db);',
            '  await audit({ db: nested.inner.db });',
            '  await audit({ db: overwritten.inner.db });',
            '  await overwritten.inner.db.execute("select 1");',
            '  await overwritten.inner.db.update(users).set({});',
            '  await overwritten.inner.db.query.users.findMany();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:18',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:17',
            via: 'users',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:20',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:21',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:22',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:19',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:16',
          },
        ],
      },
    });
  });

  it('uses project transaction callback receiver aliases from typed Drizzle origins', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'transaction<T>(callback: (tx: PgDatabase<TQueryResultHKT, TFullSchema, TSchema>) => Promise<T>): Promise<T>;',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";

            interface FakeDb {
              insert(table: unknown): { values(value: unknown): Promise<void> };
              update(table: unknown): { set(value: unknown): Promise<void> };
              transaction<T>(callback: (tx: FakeDb) => Promise<T>): Promise<T>;
            }

            export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

            export async function addItem(db: PgDatabase, fake: FakeDb, queue: FakeDb[], productId: string) {
              await db.transaction(async (writer) => {
                await writer.insert(cartItems).values({ productId });
                queue.forEach(async (writer) => {
                  await writer.update(cartItems).set({ productId });
                });
              });
              await fake.transaction(async (shadow) => {
                await shadow.insert(cartItems).values({ productId });
              });
              queue.forEach(async (writer) => {
                await writer.update(cartItems).set({ productId });
              });
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
            site: 'cart.domain.ts:14',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('uses typed receiver origins inside project domain write callbacks', () => {
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
            'interface FakeDb {',
            '  update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'export const cart = domain({',
            '  addItem: write(async (writer: PgDatabase, db: FakeDb, productId: string) => {',
            '    await writer.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
            '    await db.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
            '  }),',
            '});',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'cart.domain.ts:11',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts referenced project write callbacks from typed receiver symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(writer: PgDatabase, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'export const cart = domain({',
            '  addItem: write({ touches: [cartItems] }, addItem),',
            '});',
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
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('marks unresolved source domain write callback references as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'function addItem(db, productId) {',
          '  return db.insert(cartItems).values({ productId });',
          '}',
          '',
          'declare const actionName: string;',
          'const callbacks = { addItem };',
          '',
          'export const cart = domain({',
          '  addItem: write(callbacks[actionName]),',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
        ],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts source static element-access write callback aliases from domain authoring surfaces', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'function addItem(db, productId) {',
          '  return db.insert(cartItems).values({ productId });',
          '}',
          '',
          'const callbacks = {',
          '  aliased: addItem,',
          '  addItem,',
          '};',
          '',
          'export const cart = domain({',
          '  addAliased: write(callbacks["aliased"]),',
          '  addShorthand: write(callbacks["addItem"]),',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      'cart.addAliased': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addShorthand': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts source write callbacks through static object aliases and spreads', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'function addItem(db, productId) {',
          '  return db.insert(cartItems).values({ productId });',
          '}',
          'function noop() {',
          '  return undefined;',
          '}',
          '',
          'const base = { addItem };',
          'const alias = base;',
          'const spread = { ...base };',
          'const overridden = { ...base, addItem: noop };',
          '',
          'export const cart = domain({',
          '  addAliased: write(alias.addItem),',
          '  addSpread: write(spread["addItem"]),',
          '  addOverridden: write(overridden.addItem),',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      'cart.addAliased': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addSpread': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts source domain actions from static config spreads and degrades unresolved callbacks', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'function addItem(db, productId) {',
          '  return db.insert(cartItems).values({ productId });',
          '}',
          'function noop() {',
          '  return undefined;',
          '}',
          '',
          'declare const actionName: string;',
          'const callbacks = { addItem };',
          'const base = {',
          '  addItem: write(addItem),',
          '  unresolved: write(callbacks[actionName]),',
          '};',
          'const spread = { ...base };',
          'const overridden = { ...base, addItem: write(noop) };',
          '',
          'export const cart = domain({',
          '  ...spread,',
          '  addDirect: write(addItem),',
          '  ...overridden,',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      'cart.addDirect': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.unresolved': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:14',
          },
        ],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts source domain actions from static object aliases and degrades opaque aliases', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'function addItem(db, productId) {',
          '  return db.insert(cartItems).values({ productId });',
          '}',
          '',
          'declare const dynamicActions: any;',
          'const actions = { addItem: write(addItem) };',
          '',
          'export const cart = domain(actions);',
          'export const dynamicCart = domain(dynamicActions);',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'dynamicCart.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
        ],
      },
    });
  });

  it('marks direct opaque source domain action members as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'function addItem(db, productId) {',
          '  return db.insert(cartItems).values({ productId });',
          '}',
          '',
          'const addAction = write(addItem);',
          'declare const dynamicAction: unknown;',
          'const aliasActions = { aliased: addAction, opaque: dynamicAction };',
          '',
          'export const cart = domain({',
          '  addItem: addAction,',
          '  dynamic: dynamicAction,',
          '  method(db) {',
          '    return db.insert(cartItems).values({});',
          '  },',
          '  ...aliasActions,',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.aliased': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.dynamic': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
        ],
      },
      'cart.method': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:14',
          },
        ],
      },
      'cart.opaque': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:9',
          },
        ],
      },
    });
  });

  it('marks opaque source domain action spreads as FW406 instead of dropping mutation surfaces', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'function addItem(db, productId) {',
          '  return db.insert(cartItems).values({ productId });',
          '}',
          '',
          'declare const dynamicActions: any;',
          'const staticActions = { addItem: write(addItem) };',
          '',
          'export const cart = domain({',
          '  ...staticActions,',
          '  ...dynamicActions,',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      'cart.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:12',
          },
        ],
      },
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('marks typed source domain action spread members as FW406 when no write callback is proven', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'function addItem(db, productId) {',
          '  return db.insert(cartItems).values({ productId });',
          '}',
          '',
          'const typedActions: { addItem: typeof addItem } = { addItem };',
          '',
          'export const cart = domain({',
          '  ...typedActions,',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addItem': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:7',
          },
        ],
      },
    });
  });

  it('extracts source write callbacks through nested static object aliases', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'function addItem(db, productId) {',
          '  return db.insert(cartItems).values({ productId });',
          '}',
          'function noop() {',
          '  return undefined;',
          '}',
          '',
          'const base = { nested: { addItem } };',
          'const alias = base;',
          'const spread = { ...base };',
          'const overridden = { ...base, nested: { addItem: noop } };',
          '',
          'export const cart = domain({',
          '  addAliased: write(alias.nested.addItem),',
          '  addSpread: write(spread["nested"]["addItem"]),',
          '  addOverridden: write(overridden.nested.addItem),',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      'cart.addAliased': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addSpread': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts member-referenced project write callbacks from typed receiver symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'const callbacks = {',
            '  addItem(writer: PgDatabase, db: FakeDb, productId: string) {',
            '    writer.insert(cartItems).values({ productId });',
            '    db.insert(cartItems).values({ productId });',
            '  },',
            '};',
            '',
            'export const cart = domain({',
            '  addItem: write(callbacks.addItem),',
            '});',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:11',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts project write callbacks through static object aliases and spreads', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(writer: PgDatabase, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            'function fakeAdd(db: FakeDb, productId: string) {',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'const base = { addItem };',
            'const alias = base;',
            'const spread = { ...base };',
            'const overridden = { ...base, addItem: fakeAdd };',
            '',
            'export const cart = domain({',
            '  addAliased: write(alias.addItem),',
            '  addSpread: write(spread["addItem"]),',
            '  addOverridden: write(overridden.addItem),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addAliased': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addSpread': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts project domain actions from static object aliases and degrades opaque aliases', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(db: PgDatabase, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'declare const dynamicActions: any;',
            'const actions = { addItem: write(addItem) };',
            '',
            'export const cart = domain(actions);',
            'export const dynamicCart = domain(dynamicActions);',
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
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'dynamicCart.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
        ],
      },
    });
  });

  it('marks direct opaque project domain action members as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(db: PgDatabase, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'const addAction = write(addItem);',
            'declare const dynamicAction: unknown;',
            'const aliasActions = { aliased: addAction, opaque: dynamicAction };',
            '',
            'export const cart = domain({',
            '  addItem: addAction,',
            '  dynamic: dynamicAction,',
            '  method(db: PgDatabase) {',
            '    return db.insert(cartItems).values({});',
            '  },',
            '  ...aliasActions,',
            '});',
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
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.aliased': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.dynamic': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:15',
          },
        ],
      },
      'cart.method': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:16',
          },
        ],
      },
      'cart.opaque': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
        ],
      },
    });
  });

  it('marks typed project domain action spread members as FW406 when no write callback is proven', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'declare const externalActions: {',
            '  addItem(db: PgDatabase, productId: string): Promise<void>;',
            '};',
            '',
            'export const cart = domain({',
            '  ...externalActions,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:6',
          },
        ],
      },
    });
  });

  it('extracts project write callbacks through nested static object aliases', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(writer: PgDatabase, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            'function fakeAdd(db: FakeDb, productId: string) {',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'const base = { nested: { addItem } };',
            'const alias = base;',
            'const spread = { ...base };',
            'const overridden = { ...base, nested: { addItem: fakeAdd } };',
            '',
            'export const cart = domain({',
            '  addAliased: write(alias.nested.addItem),',
            '  addSpread: write(spread["nested"]["addItem"]),',
            '  addOverridden: write(overridden.nested.addItem),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addAliased': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addSpread': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('does not fabricate referenced project write callbacks from untyped receiver names', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'cart.domain.ts',
          source: [
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(db, productId) {',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'export const cart = domain({',
            '  addItem: write(addItem),',
            '});',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({});
  });

  it('extracts imported project write callbacks through ts-morph aliases', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'schema.ts',
          source: [
            'export const cartItems = pgTable("cart_items", {',
            '  productId: text("product_id").primaryKey(),',
            '}, jiso({ domain: "cart", key: "productId" }));',
          ].join('\n'),
        },
        {
          fileName: 'callbacks.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { cartItems } from "./schema";',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  await db.insert(cartItems).values({ productId });',
            '}',
          ].join('\n'),
        },
        {
          fileName: 'cart.domain.ts',
          source: [
            'import { addItem } from "./callbacks";',
            '',
            'export const cart = domain({',
            '  addItem: write(addItem),',
            '});',
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
            site: 'callbacks.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('marks opaque conditional source domain action spread branches as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'function addItem(db, productId) {',
          '  return db.insert(cartItems).values({ productId });',
          '}',
          '',
          'declare const useDynamic: boolean;',
          'declare const dynamicActions: any;',
          'const staticActions = { addItem: write(addItem) };',
          '',
          'export const cart = domain({',
          '  ...(useDynamic ? dynamicActions : staticActions),',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      'cart.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:12',
          },
        ],
      },
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:4',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts direct conditional domain action members and degrades opaque branches', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'declare const useDynamic: boolean;',
            'declare const dynamicAction: any;',
            '',
            'export const cart = domain({',
            '  add: useDynamic ? dynamicAction : write(addItem),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.add': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
        ],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts exported namespace project domain action spreads from write variables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'schema.ts',
          source: [
            'export const cartItems = pgTable("cart_items", {',
            '  productId: text("product_id").primaryKey(),',
            '}, jiso({ domain: "cart", key: "productId" }));',
          ].join('\n'),
        },
        {
          fileName: 'actions.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { cartItems } from "./schema";',
            '',
            'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'export const addItemAction = write(addItem);',
            'export declare const hiddenAction: unknown;',
          ].join('\n'),
        },
        {
          fileName: 'cart.domain.ts',
          source: [
            'import * as CartActions from "./actions";',
            '',
            'export const cart = domain({',
            '  ...CartActions,',
            '});',
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
            site: 'actions.ts:5',
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
            site: 'cart.domain.ts:4',
          },
        ],
      },
      'cart.addItemAction': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts namespace-imported project write callback containers through barrels', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'schema.ts',
          source: [
            'export const cartItems = pgTable("cart_items", {',
            '  productId: text("product_id").primaryKey(),',
            '}, jiso({ domain: "cart", key: "productId" }));',
          ].join('\n'),
        },
        {
          fileName: 'callbacks.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { cartItems } from "./schema";',
            '',
            'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'export const callbacks = { addItem };',
          ].join('\n'),
        },
        {
          fileName: 'barrel.ts',
          source: ['export { callbacks } from "./callbacks";'].join('\n'),
        },
        {
          fileName: 'cart.domain.ts',
          source: [
            'import * as CallbackBarrel from "./barrel";',
            '',
            'export const cart = domain({',
            '  addItem: write(CallbackBarrel.callbacks["addItem"]),',
            '});',
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
            site: 'callbacks.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('uses project typed destructured receiver bindings without fake context fabrication', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface FakeContext { db: FakeDb }',
          'interface DrizzleContext { db: PgDatabase }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct({ db: writer }: DrizzleContext, fake: FakeContext, productId: string) {',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fake.db.update(products).set({ stock: 2 });',
          '}',
          '',
          'export async function fakeSync({ db }: FakeContext) {',
          '  await db.update(products).set({ stock: 3 });',
          '}',
          '',
          'export const productQuery = query("product/destructured", {',
          '  load(_input, { db }: DrizzleContext, fake: FakeContext) {',
          '    fake.db.select({ id: products.id }).from(products);',
          '    return db.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
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
            site: 'product.domain.ts:16',
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
        site: 'product.domain.ts:24',
      },
    ]);
  });

  it('uses project typed body-local receiver aliases without fake context fabrication', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface FakeContext { db: FakeDb }',
          'interface DrizzleContext { db: PgDatabase }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  const { db: writer } = context;',
          '  const { db: fakeWriter } = fake;',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 2 });',
          '}',
          '',
          'export const productQuery = query("product/body-local-alias", {',
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    const { db: reader } = context;',
          '    const { db: fakeReader } = fake;',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
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
            site: 'product.domain.ts:18',
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
        site: 'product.domain.ts:22',
      },
    ]);
  });

  it('uses project member-referenced local query helpers from typed receiver symbols', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): Promise<void> };',
      ]),
      {
        fileName: 'product.queries.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'function loadProducts(db: PgDatabase) {',
          '  return db.select({ id: products.id, stock: products.stock }).from(products);',
          '}',
          '',
          'function fakeLoad(fake: FakeDb) {',
          '  return fake.select({ id: products.id }).from(products);',
          '}',
          '',
          'const helpers = { loadProducts, fakeLoad };',
          '',
          'export const productQuery = query("product/member-local-helper", {',
          '  load(_input, db: PgDatabase, fake: FakeDb) {',
          '    helpers.fakeLoad(fake);',
          '    return helpers.loadProducts(db);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/member-local-helper',
        reads: ['product'],
        shape: {},
        site: 'product.queries.ts:23',
      },
    ]);
  });

  it('uses project member-referenced local mutation helpers from typed receiver symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
            '',
            'function touchProduct(db: PgDatabase) {',
            '  return db.update(products).set({ stock: 1 });',
            '}',
            '',
            'function fakeTouch(fake: FakeDb) {',
            '  return fake.update(products).set({ stock: 2 });',
            '}',
            '',
            'const helpers = { touchProduct, fakeTouch };',
            '',
            'export async function syncProduct(db: PgDatabase, fake: FakeDb) {',
            '  await helpers.fakeTouch(fake);',
            '  await helpers.touchProduct(db);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:13',
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
            site: 'product.domain.ts:13',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('uses project inline object-member local helpers from typed receiver symbols', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): Promise<void> };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'const helpers = {',
          '  loadProducts(db: PgDatabase) {',
          '    return db.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '  touchProduct: async (db: PgDatabase) => {',
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
          'export const productQuery = query("product/inline-member-local-helper", {',
          '  load(_input, db: PgDatabase, fake: FakeDb) {',
          '    helpers.fakeLoad(fake);',
          '    return helpers.loadProducts(db);',
          '  },',
          '});',
          '',
          'export async function syncProduct(db: PgDatabase, fake: FakeDb) {',
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
        site: 'product.domain.ts:28',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:18',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('uses project assignment receiver aliases without fake context fabrication', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(db: PgDatabase, fake: FakeDb, productId: string) {',
          '  let writer;',
          '  writer = db;',
          '  let fakeWriter;',
          '  fakeWriter = fake;',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 2 });',
          '}',
          '',
          'export const productQuery = query("product/assignment-alias", {',
          '  load(_input, db: PgDatabase, fake: FakeDb) {',
          '    let reader;',
          '    reader = db;',
          '    let fakeReader;',
          '    fakeReader = fake;',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
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
            site: 'product.domain.ts:18',
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
        site: 'product.domain.ts:22',
      },
    ]);
  });

  it('uses project destructuring assignment receiver aliases from typed contexts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface FakeContext { db: FakeDb }',
          'interface DrizzleContext { db: PgDatabase }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  let writer;',
          '  ({ db: writer } = context);',
          '  let fakeWriter;',
          '  ({ db: fakeWriter } = fake);',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 2 });',
          '}',
          '',
          'export const productQuery = query("product/destructuring-assignment", {',
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    let reader;',
          '    ({ db: reader } = context);',
          '    let fakeReader;',
          '    ({ db: fakeReader } = fake);',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
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
            site: 'product.domain.ts:20',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/destructuring-assignment',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:24',
      },
    ]);
  });

  it('uses project nested destructuring assignment receiver aliases from typed contexts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface FakeContext { nested: { db: FakeDb } }',
          'interface DrizzleContext { nested: { db: PgDatabase } }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
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
          'export const productQuery = query("product/nested-destructuring-assignment", {',
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    let reader;',
          '    ({ nested: { db: reader } } = context);',
          '    let fakeReader;',
          '    ({ nested: { db: fakeReader } } = fake);',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
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
            site: 'product.domain.ts:20',
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
        site: 'product.domain.ts:24',
      },
    ]);
  });

  it('uses project tuple receiver aliases from typed contexts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface DrizzleContext { receivers: [PgDatabase, FakeDb]; nested: { tuple: [FakeDb, PgDatabase] } }',
          'interface FakeContext { receivers: [FakeDb, FakeDb] }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  const [writer] = context.receivers;',
          '  let assignedWriter;',
          '  [, assignedWriter] = context.nested.tuple;',
          '  const [fakeWriter] = fake.receivers;',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await assignedWriter.update(products).set({ stock: 2 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 3 });',
          '}',
          '',
          'export const productQuery = query("product/tuple-receiver", {',
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
          '',
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
            site: 'product.domain.ts:20',
            via: 'products',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:21',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/tuple-receiver',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:25',
      },
    ]);
  });

  it('does not promote project rest destructuring containers to receiver aliases', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface DrizzleContext { receivers: [FakeDb, PgDatabase]; writerRest: PgDatabase }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(context: DrizzleContext, productId: string) {',
          '  const [, ...writerRest] = context.receivers;',
          '  const { ...objectRest } = context;',
          '  await writerRest.update(products).set({ stock: 0 });',
          '  await objectRest.update(products).set({ stock: 0 });',
          '  await writerRest[0].update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '}',
          '',
          'export const productQuery = query("product/rest-receiver", {',
          '  load(_input, context: DrizzleContext) {',
          '    const [, ...readerRest] = context.receivers;',
          '    const { ...objectRest } = context;',
          '    readerRest.select({ id: products.id }).from(products);',
          '    objectRest.select({ id: products.id }).from(products);',
          '    return readerRest[0].select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
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
            site: 'product.domain.ts:19',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/rest-receiver',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:22',
      },
    ]);
  });

  it('uses project object-contained tuple assignment receiver aliases from typed contexts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface DrizzleContext { wrappers: { receivers: [PgDatabase, FakeDb] } }',
          'interface FakeContext { wrappers: { receivers: [FakeDb, FakeDb] } }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  let writer;',
          '  ({ wrappers: { receivers: [writer] } } = context);',
          '  let fakeWriter;',
          '  ({ wrappers: { receivers: [fakeWriter] } } = fake);',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 2 });',
          '}',
          '',
          'export const productQuery = query("product/object-contained-tuple-assignment", {',
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    let reader;',
          '    ({ wrappers: { receivers: [reader] } } = context);',
          '    let fakeReader;',
          '    ({ wrappers: { receivers: [fakeReader] } } = fake);',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
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
            site: 'product.domain.ts:20',
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
        site: 'product.domain.ts:24',
      },
    ]);
  });

  it('resolves imported table symbols instead of same-name tables from other modules', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.schema.ts',
          source: `
            export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'order.schema.ts',
          source: `
            export const items = pgTable("order_items", {}, jiso({ domain: "order", key: "id" }));
          `,
        },
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";
            import { items } from "./cart.schema";

            export async function addItem(db: PgDatabase, id: string) {
              await db.update(items).set({ id }).where(eq(items.id, id));
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
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('resolves namespace-imported project write targets from table symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.schema.ts',
          source: `
            export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'order.schema.ts',
          source: `
            export const items = pgTable("order_items", {}, jiso({ domain: "order", key: "id" }));
          `,
        },
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";
            import * as cartSchema from "./cart.schema";
            import * as orderSchema from "./order.schema";

            export async function addItem(db: PgDatabase, id: string) {
              await db.update(cartSchema.items).set({ id }).where(eq(cartSchema.items.id, id));
              const ignored = "db.update(orderSchema.items).set({ id })";
              return ignored;
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
            site: 'cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('resolves namespace static element-access project write targets from table symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.schema.ts',
          source: `
            export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";
            import * as cartSchema from "./cart.schema";

            export async function addItem(db: PgDatabase, id: string) {
              await db.update(cartSchema["items"]).set({ id }).where(eq(cartSchema["items"].id, id));
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
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('resolves namespace static element-access project write targets through re-export barrels', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.schema.ts',
          source: `
            export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));
          `,
        },
        {
          fileName: 'cart.tables.ts',
          source: `
            export { items as cartItems } from "./cart.schema";
          `,
        },
        {
          fileName: 'schema.ts',
          source: `
            export * from "./cart.tables";
          `,
        },
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";
            import * as schema from "./schema";

            export async function addItem(db: PgDatabase, id: string) {
              await db.update(schema["cartItems"]).set({ id }).where(eq(schema["cartItems"].id, id));
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
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('uses typed receiver origins for project static element-access writes', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '  update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb, productId: string) {',
            '  await db["insert"](cartItems).values({ productId });',
            '  await db["update"](cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
            '  await fake["insert"](cartItems).values({ productId });',
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
          { domain: 'cart', keys: null, site: 'cart.domain.ts:11', via: 'cart_items' },
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'cart.domain.ts:12',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('resolves project insert-select and update-from read sources from write call AST', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { select(value: unknown): Promise<void> };',
          'select(): { from(table: unknown): { where(value: unknown): Promise<void> } };',
          'update(table: unknown): { set(value: unknown): { from(table: unknown): { where(value: unknown): Promise<void> } } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));',
            'export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));',
            '',
            'export async function syncSnapshots(db: PgDatabase, productId: string) {',
            '  await db.insert(snapshots).select(db.select().from(products).where(gt(sql.raw(".from(prices)"), 0)));',
            '  await db.update(products).set({ price: prices.amount }).from(prices).where(eq(products.id, productId));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncSnapshots: {
        reads: [
          {
            domain: 'price',
            keys: null,
            site: 'product.domain.ts:9',
            source: 'update-from',
            via: 'prices',
          },
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:8',
            source: 'insert-select',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:9',
            via: 'products',
          },
          {
            domain: 'snapshot',
            keys: null,
            site: 'product.domain.ts:8',
            via: 'product_snapshots',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('does not borrow project write predicates from later writes in the same expression', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";

            export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

            export async function restock(db: PgDatabase, id: string) {
              await Promise.all([db.update(products).set({ stock: 1 }), db.update(products).set({ stock: 2 }).where(eq(products.id, id))]);
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      restock: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:7',
            via: 'products',
          },
          {
            domain: 'product',
            keys: 'arg:id',
            site: 'product.domain.ts:7',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('does not infer source body-local destructured receiver aliases', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

          export async function addItem(ctx, productId) {
            const { db: database } = ctx;
            await database.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));
          }
        `,
      },
    ]);

    expect(graph).toEqual({});
  });

  it('does not recognize destructured Drizzle receiver aliases from comments and strings', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export async function addItem(ctx) {',
          '  // const { db: database } = ctx;',
          '  const raw = "const { tx: writer } = ctx";',
          '  await database.execute(sql`delete from cart_items`);',
          '  await writer.query.cartItems.findMany();',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({});
  });

  it('does not recognize transaction receiver aliases from comments and strings', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export async function addItem(db) {',
          '  // await db.transaction(async (writer) => writer.insert(cartItems).values({}));',
          '  const raw = "db.transaction(async (writer) => writer.update(cartItems).set({}))";',
          '  await writer.execute(sql`delete from cart_items`);',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({});
  });

  it('marks ambient source-mode receiver calls as FW406 instead of extracting table facts', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers() {',
          '  await db.update(users).set({});',
          '  await db.select().from(users);',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:4',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:5',
          },
        ],
      },
    });
  });

  it('marks ambient source-mode query receivers as FW406 instead of deriving reads', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'export const usersQuery = query("users/ambient", {',
          '  load() {',
          '    return db.select({ id: users.id }).from(users);',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode ambient Drizzle receiver surface select() without a declared loader receiver.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
        ],
        query: 'users/ambient',
        reads: [],
        shape: {},
        site: 'user.queries.ts:3',
      },
    ]);
  });

  it('marks source parameter member receiver calls as FW406 instead of extracting table facts', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(context) {',
          '  await context.db.update(users).set({});',
          '  await context.tx.execute("select 1");',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:4',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:5',
          },
        ],
      },
    });
  });

  it('marks source query-loader member receivers as FW406 instead of deriving reads', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'export const usersQuery = query("users/source-member-receiver", {',
          '  load(_input, context) {',
          '    runReport(context.db);',
          '    context.tx.execute("select 1");',
          '    return context.db.select({ id: users.id }).from(users);',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver member surface runReport() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver member surface execute() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver member surface select() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
        ],
        query: 'users/source-member-receiver',
        reads: [],
        shape: {},
        site: 'user.queries.ts:3',
      },
    ]);
  });

  it('marks source body-local receiver aliases as FW406 instead of extracting table facts', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(db, fake) {',
          '  const writer = db;',
          '  let executor;',
          '  executor = writer;',
          '  const context = { writer, reader: db, fake };',
          '  const { reader: destructuredReader } = context;',
          '  const fakeContext = { reader: fake };',
          '  const { reader: fakeReader } = fakeContext;',
          '  await writer.update(users).set({});',
          '  await executor.execute("select 1");',
          '  await context.reader.select().from(users);',
          '  await destructuredReader.execute("select 1");',
          '  await fakeReader.update(users).set({});',
          '  await context.fake.update(users).set({});',
          '  await sendAudit(writer);',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:17',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:12',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:14',
          },
        ],
      },
    });
  });

  it('marks source destructuring assignment receiver aliases from carriers as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(db, fake) {',
          '  const context = { db, fake };',
          '  let writer;',
          '  ({ db: writer } = context);',
          '  let fakeWriter;',
          '  ({ fake: fakeWriter } = context);',
          '  await writer.execute("select 1");',
          '  await writer.update(users).set({});',
          '  await fakeWriter.update(users).set({});',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:9',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:10',
          },
        ],
      },
    });
  });

  it('marks source nested carrier destructuring aliases as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(db, fake) {',
          '  const carrier = { db, fake };',
          '  const nested = { inner: carrier };',
          '  const { inner: { db: declaredWriter } } = nested;',
          '  let assignedWriter;',
          '  ({ inner: { db: assignedWriter } } = nested);',
          '  const { inner: { fake: fakeWriter } } = nested;',
          '  await declaredWriter.execute("select 1");',
          '  await assignedWriter.update(users).set({});',
          '  await fakeWriter.update(users).set({});',
          '}',
        ].join('\n'),
      },
    ]);
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'export const usersQuery = query("users/nested-source-destructuring", {',
          '  load(_input, db, fake) {',
          '    const carrier = { db, fake };',
          '    const nested = { inner: carrier };',
          '    const { inner: { db: declaredReader } } = nested;',
          '    let assignedReader;',
          '    ({ inner: { db: assignedReader } } = nested);',
          '    const { inner: { fake: fakeReader } } = nested;',
          '    fakeReader.select({ id: users.id }).from(users);',
          '    declaredReader.execute("select 1");',
          '    return assignedReader.select({ id: users.id }).from(users);',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:10',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
        ],
      },
    });
    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface execute() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
        ],
        query: 'users/nested-source-destructuring',
        reads: [],
        shape: {},
        site: 'user.queries.ts:3',
      },
    ]);
  });

  it('marks source array carrier destructuring aliases as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(db, fake) {',
          '  const carrier = [db, fake];',
          '  const nested = [[fake, db]];',
          '  const [writer, fakeWriter] = carrier;',
          '  let assignedWriter;',
          '  [assignedWriter] = carrier;',
          '  const [[ignoredFake, nestedWriter]] = nested;',
          '  await writer.update(users).set({});',
          '  await assignedWriter.select().from(users);',
          '  await nestedWriter.execute("select 1");',
          '  await fakeWriter.update(users).set({});',
          '  await ignoredFake.execute("select 1");',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:10',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:12',
          },
        ],
      },
    });
  });

  it('marks source array rest carrier member aliases as FW406 without direct receiver fabrication', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(db, fake) {',
          '  const carrier = [fake, db];',
          '  const [, ...writerRest] = carrier;',
          '  await writerRest.update(users).set({});',
          '  await writerRest[0].update(users).set({});',
          '}',
        ].join('\n'),
      },
    ]);
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'users.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'export const usersQuery = query("users/source-rest-carrier", {',
          '  load(_input, db, fake) {',
          '    const carrier = [fake, db];',
          '    const [, ...readerRest] = carrier;',
          '    readerRest.select({ id: users.id }).from(users);',
          '    return readerRest[0].select({ id: users.id }).from(users);',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:7',
          },
        ],
      },
    });
    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'users.queries.ts:3',
          },
        ],
        query: 'users/source-rest-carrier',
        reads: [],
        shape: {},
        site: 'users.queries.ts:3',
      },
    ]);
  });

  it('marks source spread-copied receiver carriers as FW406 without overridden fake facts', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(db, fake) {',
          '  const carrier = { db, fake };',
          '  const spread = { ...carrier };',
          '  const overwritten = { ...carrier, db: fake };',
          '  await spread.db.execute("select 1");',
          '  await spread.db.update(users).set({});',
          '  await sendAudit(spread);',
          '  await overwritten.db.execute("select 1");',
          '  await overwritten.db.update(users).set({});',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:9',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:7',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:8',
          },
        ],
      },
    });
  });

  it('marks source nested receiver carrier members as FW406 without nested fake overrides', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(db, fake) {',
          '  const carrier = { db, fake };',
          '  const nested = { inner: carrier };',
          '  const { inner } = nested;',
          '  const overwritten = { ...nested, inner: { db: fake } };',
          '  const execute = nested.inner.db.execute;',
          '  await nested.inner.db.execute("select 1");',
          '  await inner.db.update(users).set({});',
          '  await execute("select 1");',
          '  await sendAudit(nested);',
          '  await sendAudit(nested.inner.db);',
          '  await overwritten.inner.db.execute("select 1");',
          '  await overwritten.inner.db.update(users).set({});',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:12',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:9',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:10',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
        ],
      },
    });
  });

  it('marks source query-loader receiver aliases as FW406 instead of deriving reads', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'export const usersQuery = query("users/source-alias", {',
          '  load(_input, db, fake) {',
          '    const reader = db;',
          '    let executor;',
          '    executor = reader;',
          '    const context = { reader, runner: db, fake };',
          '    const { runner } = context;',
          '    const fakeContext = { runner: fake };',
          '    const { runner: fakeRunner } = fakeContext;',
          '    reader.select({ id: users.id }).from(users);',
          '    executor.execute("select 1");',
          '    context.runner.select().from(users);',
          '    runner.execute("select 1");',
          '    fakeRunner.execute("select 1");',
          '    fake.select({ id: users.id }).from(users);',
          '    return [];',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface execute() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface execute() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
        ],
        query: 'users/source-alias',
        reads: [],
        shape: {},
        site: 'user.queries.ts:3',
      },
    ]);
  });

  it('marks source shorthand query-loader functions as FW406 instead of following untyped symbols', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'function load(_input, db) {',
          '  return db.select({ id: users.id }).from(users);',
          '}',
          '',
          'export const usersQuery = query("users/source-shorthand-loader", {',
          '  load,',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      unresolvedQueryLoadFact('users/source-shorthand-loader', 'user.queries.ts:7'),
    ]);
  });

  it('marks source member query-loader aliases as FW406 instead of following untyped symbols', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'function loadUsers(_input, db) {',
          '  return db.select({ id: users.id }).from(users);',
          '}',
          '',
          'const loaders = {',
          '  aliased: loadUsers,',
          '  loadUsers,',
          '};',
          '',
          'export const aliasedQuery = query("users/source-member-aliased-loader", {',
          '  load: loaders.aliased,',
          '});',
          '',
          'export const shorthandQuery = query("users/source-member-shorthand-loader", {',
          '  load: loaders.loadUsers,',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      unresolvedQueryLoadFact('users/source-member-aliased-loader', 'user.queries.ts:12'),
      unresolvedQueryLoadFact('users/source-member-shorthand-loader', 'user.queries.ts:16'),
    ]);
  });

  it('marks source element-access query-loader aliases as FW406 without static symbol fallback', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'function loadUsers(_input, db) {',
          '  return db.select({ id: users.id }).from(users);',
          '}',
          '',
          'const loaders = {',
          '  aliased: loadUsers,',
          '  loadUsers,',
          '};',
          '',
          'export const aliasedQuery = query("users/source-static-member-aliased-loader", {',
          '  load: loaders["aliased"],',
          '});',
          '',
          'export const shorthandQuery = query("users/source-static-member-shorthand-loader", {',
          '  load: loaders["loadUsers"],',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      unresolvedQueryLoadFact('users/source-static-member-aliased-loader', 'user.queries.ts:12'),
      unresolvedQueryLoadFact('users/source-static-member-shorthand-loader', 'user.queries.ts:16'),
    ]);
  });

  it('marks source query-loader callbacks through object aliases and spreads as FW406', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'function loadUsers(_input, db) {',
          '  return db.select({ id: users.id }).from(users);',
          '}',
          'function emptyLoad() {',
          '  return [];',
          '}',
          '',
          'const base = { loadUsers };',
          'const alias = base;',
          'const spread = { ...base };',
          'const overridden = { ...base, loadUsers: emptyLoad };',
          '',
          'export const aliasedQuery = query("users/source-object-alias-loader", {',
          '  load: alias.loadUsers,',
          '});',
          '',
          'export const spreadQuery = query("users/source-object-spread-loader", {',
          '  load: spread["loadUsers"],',
          '});',
          '',
          'export const overriddenQuery = query("users/source-overridden-object-spread-loader", {',
          '  load: overridden.loadUsers,',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      unresolvedQueryLoadFact('users/source-object-alias-loader', 'user.queries.ts:15'),
      unresolvedQueryLoadFact('users/source-object-spread-loader', 'user.queries.ts:19'),
      unresolvedQueryLoadFact('users/source-overridden-object-spread-loader', 'user.queries.ts:23'),
    ]);
  });

  it('marks source query loaders from config spreads as FW406', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'function loadUsers(_input, db) {',
          '  return db.select({ id: users.id }).from(users);',
          '}',
          '',
          'declare const dynamicConfig: any;',
          'const base = { load: loadUsers };',
          'const spread = { ...base };',
          '',
          'export const spreadQuery = query("users/source-config-spread-loader", {',
          '  ...spread,',
          '});',
          '',
          'export const obscuredQuery = query("users/source-config-obscured-loader", {',
          '  load: loadUsers,',
          '  ...dynamicConfig,',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      unresolvedQueryLoadFact('users/source-config-obscured-loader', 'user.queries.ts:15'),
      unresolvedQueryLoadFact('users/source-config-spread-loader', 'user.queries.ts:11'),
    ]);
  });

  it('marks source query loaders from external config objects as FW406', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey(), stock: integer("stock").notNull() }, jiso({ domain: "user", key: "id" }));',
          '',
          'function loadUsers(_input, db) {',
          '  return db.select({ id: users.id, stock: users.stock }).from(users);',
          '}',
          '',
          'declare const dynamicConfig: any;',
          'const baseConfig = { load: loadUsers };',
          'const configAlias = baseConfig;',
          'export const configQuery = query("users/source-external-config-loader", configAlias);',
          'export const dynamicQuery = query("users/source-dynamic-config-loader", dynamicConfig);',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      unresolvedQueryLoadFact('users/source-dynamic-config-loader', 'user.queries.ts:11'),
      unresolvedQueryLoadFact('users/source-external-config-loader', 'user.queries.ts:10'),
    ]);
  });

  it('marks unresolved source query-loader callback references as FW406', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'function loadUsers(_input, db) {',
          '  return db.select({ id: users.id }).from(users);',
          '}',
          '',
          'declare const loaderName: string;',
          'const loaders = { loadUsers };',
          '',
          'export const usersQuery = query("users/unresolved-source-loader", {',
          '  load: loaders[loaderName],',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'warn',
            site: 'user.queries.ts:10',
          },
        ],
        query: 'users/unresolved-source-loader',
        reads: [],
        shape: {},
        site: 'user.queries.ts:10',
      },
    ]);
  });

  it('marks source query-loader callbacks through nested object aliases as FW406', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey(), stock: integer("stock").notNull() }, jiso({ domain: "user", key: "id" }));',
          '',
          'function loadUsers(_input, db) {',
          '  return db.select({ id: users.id, stock: users.stock }).from(users);',
          '}',
          'function emptyLoad() {',
          '  return [];',
          '}',
          '',
          'const base = { nested: { loadUsers } };',
          'const alias = base;',
          'const spread = { ...base };',
          'const overridden = { ...base, nested: { loadUsers: emptyLoad } };',
          '',
          'export const aliasedQuery = query("users/source-nested-object-alias-loader", {',
          '  load: alias.nested.loadUsers,',
          '});',
          '',
          'export const spreadQuery = query("users/source-nested-object-spread-loader", {',
          '  load: spread["nested"]["loadUsers"],',
          '});',
          '',
          'export const overriddenQuery = query("users/source-overridden-nested-object-loader", {',
          '  load: overridden.nested.loadUsers,',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      unresolvedQueryLoadFact('users/source-nested-object-alias-loader', 'user.queries.ts:15'),
      unresolvedQueryLoadFact('users/source-nested-object-spread-loader', 'user.queries.ts:19'),
      unresolvedQueryLoadFact('users/source-overridden-nested-object-loader', 'user.queries.ts:23'),
    ]);
  });

  it('marks source query-loader destructuring assignment receiver aliases as FW406', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'export const usersQuery = query("users/source-destructuring-assignment", {',
          '  load(_input, db, fake) {',
          '    const context = { db, fake };',
          '    let reader;',
          '    ({ db: reader } = context);',
          '    let fakeReader;',
          '    ({ fake: fakeReader } = context);',
          '    reader.select({ id: users.id }).from(users);',
          '    reader.execute("select 1");',
          '    fakeReader.select({ id: users.id }).from(users);',
          '    return [];',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface execute() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
        ],
        query: 'users/source-destructuring-assignment',
        reads: [],
        shape: {},
        site: 'user.queries.ts:3',
      },
    ]);
  });

  it('marks source query-loader spread-copied receiver carriers as FW406', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'export const usersQuery = query("users/source-spread-carrier", {',
          '  load(_input, db, fake) {',
          '    const carrier = { db, fake };',
          '    const spread = { ...carrier };',
          '    const overwritten = { ...carrier, db: fake };',
          '    spread.db.select({ id: users.id }).from(users);',
          '    spread.db.execute("select 1");',
          '    overwritten.db.select({ id: users.id }).from(users);',
          '    fake.select({ id: users.id }).from(users);',
          '    return [];',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface execute() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
        ],
        query: 'users/source-spread-carrier',
        reads: [],
        shape: {},
        site: 'user.queries.ts:3',
      },
    ]);
  });

  it('marks source query-loader nested receiver carriers as FW406', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'export const usersQuery = query("users/source-nested-carrier", {',
          '  load(_input, db, fake) {',
          '    const carrier = { db, fake };',
          '    const nested = { inner: carrier };',
          '    const { inner } = nested;',
          '    const overwritten = { ...nested, inner: { db: fake } };',
          '    const execute = nested.inner.db.execute;',
          '    nested.inner.db.select({ id: users.id }).from(users);',
          '    inner.db.execute("select 1");',
          '    execute("select 1");',
          '    runReport(nested.inner.db);',
          '    runReport(nested);',
          '    overwritten.inner.db.select({ id: users.id }).from(users);',
          '    return [];',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver nested.inner.db to helper runReport().',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver nested to helper runReport().',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface execute() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface execute() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
        ],
        query: 'users/source-nested-carrier',
        reads: [],
        shape: {},
        site: 'user.queries.ts:3',
      },
    ]);
  });

  it('marks source query-loader array receiver carriers as FW406', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const users = pgTable("users", { id: text("id").primaryKey() }, jiso({ domain: "user", key: "id" }));',
          '',
          'export const usersQuery = query("users/source-array-carrier", {',
          '  load(_input, db, fake) {',
          '    const carrier = [db, fake];',
          '    const nested = [[fake, db]];',
          '    const [reader, fakeReader] = carrier;',
          '    let assignedReader;',
          '    [assignedReader] = carrier;',
          '    const [[ignoredFake, nestedReader]] = nested;',
          '    reader.select({ id: users.id }).from(users);',
          '    assignedReader.execute("select 1");',
          '    nestedReader.select({ id: users.id }).from(users);',
          '    fakeReader.select({ id: users.id }).from(users);',
          '    ignoredFake.execute("select 1");',
          '    return [];',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface execute() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses source-mode Drizzle receiver alias surface select() without project type proof.',
            severity: 'warn',
            site: 'user.queries.ts:3',
          },
        ],
        query: 'users/source-array-carrier',
        reads: [],
        shape: {},
        site: 'user.queries.ts:3',
      },
    ]);
  });

  it('marks source query-loader helpers receiving assigned carrier aliases as FW406', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'user.queries.ts',
        source: [
          'export const usersQuery = query("users/source-assigned-carrier-helper", {',
          '  load(_input, db, fake) {',
          '    let context;',
          '    context = { db };',
          '    let fakeContext;',
          '    fakeContext = { db: fake };',
          '    runReport(fakeContext);',
          '    return runReport(context);',
          '  },',
          '});',
        ].join('\n'),
      },
    ]);

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query passes Drizzle receiver context to helper runReport().',
            severity: 'warn',
            site: 'user.queries.ts:1',
          },
        ],
        query: 'users/source-assigned-carrier-helper',
        reads: [],
        shape: {},
        site: 'user.queries.ts:1',
      },
    ]);
  });

  it('marks external helpers receiving a Drizzle receiver as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

          export async function addItem(db, productId) {
            await db.insert(cartItems).values({ productId });
            await writeAudit(db, productId);
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:6',
          },
        ],
      },
    });
  });

  it('marks external helpers receiving a Drizzle receiver through containers as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export async function addItem(db, productId) {
            await writeAudit({ db, productId });
          }
        `,
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
            site: 'cart.domain.ts:3',
          },
        ],
      },
    });
  });

  it('marks project external helpers receiving factory-returned typed carriers as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {}',
            'declare function writeAudit(context: unknown): Promise<void>;',
            'declare function makeContext(): { nested: { db: PgDatabase<any, any, any> } };',
            'declare function makeFakeContext(): { nested: { db: FakeDb } };',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  void db;',
            '  void fake;',
            '  await writeAudit(makeFakeContext());',
            '  await writeAudit(makeContext());',
            '}',
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
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:12',
          },
        ],
      },
    });
  });

  it('marks external helpers receiving assigned Drizzle carrier aliases as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export async function addItem(db, fake) {',
          '  let context;',
          '  context = { db };',
          '  let fakeContext;',
          '  fakeContext = { db: fake };',
          '  await writeAudit(fakeContext);',
          '  await writeAudit(context);',
          '}',
        ].join('\n'),
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
            site: 'cart.domain.ts:7',
          },
        ],
      },
    });
  });

  it('marks source local helpers receiving ambiguous receiver parameters as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'async function writeAudit(client, productId) {',
          '  return Promise.resolve({ client, productId });',
          '}',
          '',
          'export async function addItem(db, productId) {',
          '  await writeAudit(db, productId);',
          '}',
        ].join('\n'),
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
            site: 'cart.domain.ts:6',
          },
        ],
      },
    });
  });

  it('does not mark external helper calls from comments and strings', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export async function addItem(db, productId) {',
          '  // await writeAudit(db, productId);',
          '  const raw = "writeAudit(db, productId)";',
          '  const templated = `writeAudit(db, ${productId})`;',
          '  return { raw, templated };',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({});
  });

  it('marks raw db.execute calls as FW406 instead of dropping the surface', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

          export async function reconcileCart(db, productId) {
            await db.execute(sql\`update cart_items set synced = true where product_id = \${productId}\`);
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      reconcileCart: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:5',
          },
        ],
      },
    });
  });

  it('marks materialized-view refresh calls as FW406 instead of dropping the surface', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'catalog.domain.ts',
        source: `
          export const productSearch = pgMaterializedView("product_search", {});

          export async function refreshCatalog(db) {
            await db.refreshMaterializedView(productSearch);
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      refreshCatalog: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'catalog.domain.ts:5',
          },
        ],
      },
    });
  });

  it('marks Drizzle count helper calls as FW406 instead of dropping the surface', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));

          export async function countUsers(db) {
            return db.$count(users, eq(users.active, true));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      countUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:5',
          },
        ],
      },
    });
  });

  it('marks unknown direct Drizzle receiver methods as FW406 instead of dropping them', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));

          export async function syncUsers(db) {
            await db.batch([db.select().from(users)]);
            await db["$with"]("active_users");
            await db.insert(users).values({});
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:5',
            source: 'select',
            via: 'users',
          },
        ],
        touches: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:7',
            via: 'users',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:5',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:6',
          },
        ],
      },
    });
  });

  it('marks source detached Drizzle receiver method aliases as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(db, fake, method) {',
          '  const { execute, update: write, query } = db;',
          '  const fakeExecute = fake.execute;',
          '  const countUsers = db["$count"];',
          '  let assignedExecute;',
          '  assignedExecute = db.execute;',
          '  let assignedWrite;',
          '  assignedWrite = db.update;',
          '  let assignedComputed;',
          '  assignedComputed = db[method];',
          '  await execute("select 1");',
          '  await write(users).set({});',
          '  await fakeExecute("select 1");',
          '  await countUsers(users);',
          '  await query.users.findMany();',
          '  await assignedExecute("select 1");',
          '  await assignedWrite(users).set({});',
          '  await assignedComputed("select 1");',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:14',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:16',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:17',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:18',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:19',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:20',
          },
        ],
      },
    });
  });

  it('marks source array-destructured detached receiver method aliases as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(db, fake, method) {',
          '  const [execute, write, computed] = [db.execute, db.update, db[method]];',
          '  const [fakeExecute] = [fake.execute];',
          '  let assignedExecute;',
          '  [assignedExecute] = [db.execute];',
          '  await execute("select 1");',
          '  await write(users).set({});',
          '  await computed("select 1");',
          '  await assignedExecute("select 1");',
          '  await fakeExecute("select 1");',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:8',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:9',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:10',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
        ],
      },
    });
  });

  it('does not mark shadowed source detached receiver method aliases', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export async function syncUsers(db, fake) {',
          '  const { execute } = db;',
          '  {',
          '    const execute = fake.execute;',
          '    await execute("select 1");',
          '  }',
          '  await execute("select 1");',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:7',
          },
        ],
      },
    });
  });

  it('marks bound detached Drizzle receiver methods as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
          '',
          'export async function syncUsers(db, fake, method) {',
          '  const execute = db.execute.bind(db);',
          '  const write = db.update.bind(db);',
          '  const computed = db[method].bind(db);',
          '  const fakeExecute = fake.execute.bind(fake);',
          '  await execute("select 1");',
          '  await write(users).set({});',
          '  await computed("select 1");',
          '  await fakeExecute("select 1");',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:8',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:9',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:10',
          },
        ],
      },
    });
  });

  it('marks static element-access raw and relational receiver calls as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));

          export async function loadUsers(db) {
            await db['execute'](sql\`update users set active = true\`);
            return db.query['users']['findFirst']({ where: eq(users.active, true) });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      loadUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:6',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:5',
          },
        ],
      },
    });
  });

  it('marks template-literal element-access raw and relational receiver calls as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));

          export async function loadUsers(db) {
            await db[\`execute\`](sql\`update users set active = true\`);
            return db.query[\`users\`][\`findFirst\`]({ where: eq(users.active, true) });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      loadUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:6',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:5',
          },
        ],
      },
    });
  });

  it('extracts standalone direct select chains as touch-graph reads', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'catalog.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
          export const vendors = pgTable("vendors", {}, jiso({ domain: "vendor", key: "id" }));

          export async function loadCatalog(db) {
            await db.select({ id: products.id }).from(products).leftJoin(vendors, eq(vendors.id, products.vendorId));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      loadCatalog: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'catalog.domain.ts:6',
            source: 'select',
            via: 'products',
          },
          {
            domain: 'vendor',
            keys: null,
            site: 'catalog.domain.ts:6',
            source: 'select',
            via: 'vendors',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
  });

  it('resolves wrapped source direct-select and write read-source tables', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'catalog.domain.ts',
        source: [
          'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
          'export const vendors = pgTable("vendors", {}, jiso({ domain: "vendor", key: "id" }));',
          'export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));',
          '',
          'export async function syncCatalog(db) {',
          '  await db.select().from((products as any)).leftJoin(vendors!, eq(vendors.id, products.vendorId));',
          '  await db.insert(snapshots).select(db.select().from((products as any)));',
          '  await db.update(snapshots).set({ refreshed: true }).from(vendors!);',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "syncCatalog": {',
        '    touches: [',
        '      { domain: "snapshot", via: "product_snapshots", site: "catalog.domain.ts:7", keys: null },',
        '      { domain: "snapshot", via: "product_snapshots", site: "catalog.domain.ts:8", keys: null },',
        '    ],',
        '    reads: [',
        '      { domain: "product", via: "products", site: "catalog.domain.ts:7", keys: null, source: "insert-select" },',
        '      { domain: "product", via: "products", site: "catalog.domain.ts:6", keys: null, source: "select" },',
        '      { domain: "vendor", via: "vendors", site: "catalog.domain.ts:6", keys: null, source: "select" },',
        '      { domain: "vendor", via: "vendors", site: "catalog.domain.ts:8", keys: null, source: "update-from" },',
        '    ],',
        '    unresolved: [',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
  });

  it('marks standalone direct select chains with unresolved tables as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'catalog.domain.ts',
        source: `
          export async function loadCatalog(db, tableName) {
            await db.select().from(tableFor(tableName));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      loadCatalog: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'catalog.domain.ts:3',
          },
        ],
      },
    });
  });

  it('extracts project standalone direct select chains from typed receivers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { leftJoin(table: unknown, on: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'catalog.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'export const vendors = pgTable("vendors", {}, jiso({ domain: "vendor", key: "id" }));',
            '',
            'export async function loadCatalog(reader: PgDatabase) {',
            '  await reader.select({ id: products.id }).from(products).leftJoin(vendors, eq(vendors.id, products.vendorId));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      loadCatalog: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'catalog.domain.ts:7',
            source: 'select',
            via: 'products',
          },
          {
            domain: 'vendor',
            keys: null,
            site: 'catalog.domain.ts:7',
            source: 'select',
            via: 'vendors',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
  });

  it('extracts project receiver aliases from typed destructured declarations', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'select(value?: unknown): { from(table: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'catalog.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb { update(table: unknown): { set(value: unknown): Promise<void> } }',
            '',
            'export const auditLogs = pgTable("audit_logs", {}, jiso({ domain: "audit", key: "id" }));',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            '',
            'export async function syncCatalog(context: { db: PgDatabase; nested: { tx: PgDatabase }; tuple: [PgDatabase] }, fake: { db: FakeDb }) {',
            '  const { db: writer, nested: { tx } } = context;',
            '  const [reader] = context.tuple;',
            '  const { db: fakeWriter } = fake;',
            '  await writer.update(products).set({});',
            '  await tx.insert(auditLogs).values({});',
            '  await reader.select().from(products);',
            '  await fakeWriter.update(products).set({});',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncCatalog: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'catalog.domain.ts:14',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'audit',
            keys: null,
            site: 'catalog.domain.ts:13',
            via: 'audit_logs',
          },
          {
            domain: 'product',
            keys: null,
            site: 'catalog.domain.ts:12',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('resolves wrapped project direct-select and write read-source tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { select(value: unknown): Promise<void> };',
          'select(value?: unknown): { from(table: unknown): { leftJoin(table: unknown, on: unknown): Promise<void> } };',
          'update(table: unknown): { set(value: unknown): { from(table: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'catalog.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'export const vendors = pgTable("vendors", {}, jiso({ domain: "vendor", key: "id" }));',
            'export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));',
            '',
            'export async function syncCatalog(db: PgDatabase) {',
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
        '      { domain: "snapshot", via: "product_snapshots", site: "catalog.domain.ts:10", keys: null },',
        '      { domain: "snapshot", via: "product_snapshots", site: "catalog.domain.ts:9", keys: null },',
        '    ],',
        '    reads: [',
        '      { domain: "product", via: "products", site: "catalog.domain.ts:9", keys: null, source: "insert-select" },',
        '      { domain: "product", via: "products", site: "catalog.domain.ts:8", keys: null, source: "select" },',
        '      { domain: "vendor", via: "vendors", site: "catalog.domain.ts:8", keys: null, source: "select" },',
        '      { domain: "vendor", via: "vendors", site: "catalog.domain.ts:10", keys: null, source: "update-from" },',
        '    ],',
        '    unresolved: [',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
  });

  it('extracts wrapped query declarations and domain write callbacks', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<void> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import { eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'export const productDomain = (domain({',
          '  add: (write(addItem) satisfies unknown),',
          '}) as unknown);',
          '',
          'export const productQuery = (query("product/wrapped", {',
          '  load(_input, db: PgDatabase<any, any, any>) {',
          '    return db.select({ id: products.id }).from(products);',
          '  },',
          '}) satisfies unknown);',
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
            site: 'product.domain.ts:9',
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
            site: 'product.domain.ts:9',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/wrapped',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.domain.ts:16',
      },
    ]);
  });

  it('extracts project query loaders and domain actions through static computed keys', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<void> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import { eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'const loadKey = "load";',
          'const addKey = "add";',
          'const keyBag = { restock: "restock" } as const;',
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'export const productDomain = domain({',
          '  [addKey]: write(addItem),',
          '  [keyBag.restock]: write(addItem),',
          '});',
          '',
          'export const productQuery = query("product/static-computed-loader", {',
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
            site: 'product.domain.ts:13',
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
            site: 'product.domain.ts:13',
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
            site: 'product.domain.ts:13',
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
        site: 'product.domain.ts:21',
      },
    ]);
  });

  it('marks unresolved computed query loaders and domain actions as FW406', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<void> };',
        'update(table: unknown): { set(value: unknown): Promise<void> };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'declare const actionKey: string;',
          'declare const loadKey: string;',
          '',
          'function addItem(db: PgDatabase<any, any, any>) {',
          '  return db.update(products).set({});',
          '}',
          '',
          'export const productDomain = domain({',
          '  [actionKey]: write(addItem),',
          '});',
          '',
          'export const productQuery = query("product/unresolved-computed-loader", {',
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
            site: 'product.domain.ts:11',
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
            site: 'product.domain.ts:15',
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
            site: 'product.domain.ts:18',
          },
        ],
        query: 'product/unresolved-computed-loader',
        reads: [],
        shape: {},
        site: 'product.domain.ts:18',
      },
    ]);
  });

  it('marks typed project query/domain factories as FW406 when callbacks are not statically visible', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<void> };',
        'update(table: unknown): { set(value: unknown): Promise<void> };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'declare function makeActions(): { add: ReturnType<typeof write> };',
          'declare function makeQueryOptions(): {',
          '  load(input: unknown, db: PgDatabase<any, any, any>): Promise<void>;',
          '};',
          '',
          'export const productDomain = domain(makeActions());',
          '',
          'export const productQuery = query("product/factory-loader", makeQueryOptions());',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      'productDomain.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:12',
          },
        ],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      unresolvedQueryLoadFact('product/factory-loader', 'product.domain.ts:14'),
    ]);
  });

  it('keeps wrapped opaque domain actions visible as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: [
          'declare const dynamicActions: any;',
          '',
          'export const productDomain = (domain(dynamicActions) satisfies unknown);',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      'productDomain.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:3',
          },
        ],
      },
    });
  });

  it('keeps insert-select nested reads classified as insert-select only', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'catalog.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
          export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));

          export async function syncSnapshots(db) {
            await db.insert(snapshots).select(db.select().from(products));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncSnapshots: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'catalog.domain.ts:6',
            source: 'insert-select',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'snapshot',
            keys: null,
            site: 'catalog.domain.ts:6',
            via: 'product_snapshots',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts relational query API calls on Drizzle receivers as reads', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));

          export async function loadUsers(db) {
            return db.query.users.findMany({ where: eq(users.active, true) });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      loadUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:5',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
  });

  it('marks unresolved relational query API table names as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export async function loadUsers(db, tableName) {
            return db.query[tableName].findMany();
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      loadUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:3',
          },
        ],
      },
    });
  });

  it('does not mark unclassified Drizzle receiver calls from comments and strings', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export async function loadUsers(db) {',
          '  // db.execute(sql`delete from users`);',
          '  // db.refreshMaterializedView(usersView);',
          '  // db.$count(users);',
          '  const raw = "db.execute(sql`delete from users`)";',
          '  const refresh = "db.refreshMaterializedView(usersView)";',
          '  const count = "db.$count(users)";',
          '  const relational = `db.query.users.findMany()`;',
          '  return { raw, refresh, count, relational };',
          '}',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({});
  });

  it('over-approximates local conditional table initializers', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const archivedProducts = pgTable("archived_products", {}, jiso({ domain: "archive", key: "id" }));
          export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
          const priceSource = useArchive ? archivedProducts : prices;
          const writeTarget = useArchive ? archivedProducts : products;

          export async function syncProduct(db, productId) {
            await db.update(writeTarget).set({ reserved: true }).from(priceSource).where(eq(writeTarget.id, productId));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'archive',
            keys: null,
            site: 'product.domain.ts:9',
            source: 'update-from',
            via: 'archived_products',
          },
          {
            domain: 'price',
            keys: null,
            site: 'product.domain.ts:9',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          {
            domain: 'archive',
            keys: 'arg:productId',
            site: 'product.domain.ts:9',
            via: 'archived_products',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:9',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('keeps resolved conditional branches when another branch is unresolved', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
          const writeTarget = useDynamic ? tableFor("archive") : products;

          export async function syncProduct(db) {
            await db.update(writeTarget).set({ reserved: true });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'product.domain.ts:6', via: 'products' }],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:6',
          },
        ],
      },
    });
  });

  it('keeps resolved conditional branches when opaque branch strings contain colons', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
          const writeTarget = useDynamic ? tableFor("archive:products") : products;

          export async function syncProduct(db) {
            await db.update(writeTarget).set({ reserved: true });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'product.domain.ts:6', via: 'products' }],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:6',
          },
        ],
      },
    });
  });

  it('marks aliases with unresolved bases as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          const productAlias = alias(tableFor("products"), "p");

          export async function syncProduct(db) {
            await db.update(productAlias).set({ reserved: true });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:5',
          },
        ],
      },
    });
  });

  it('marks non-identifier Drizzle table expressions as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export async function syncAudit(db) {
            await db.insert(tableFor("audit")).values({ productId: "p1" });
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      syncAudit: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:3',
          },
        ],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'FW406',
        message: 'Statically un-analyzable write site; manual touches required.',
        severity: 'warn',
        site: 'cart.domain.ts:3',
      },
    ]);
  });

  it('marks project-mode computed table expressions as FW406 instead of resolving descendant tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            '',
            'export async function syncProduct(db: PgDatabase<any, any, any>) {',
            '  await db.update(tableFor(products)).set({ reserved: true });',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:6',
          },
        ],
      },
    });
  });

  it('keeps resolved write read sources when the source-mode write target is opaque', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'catalog.domain.ts',
        source: [
          'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
          'export const vendors = pgTable("vendors", {}, jiso({ domain: "vendor", key: "id" }));',
          '',
          'export async function syncCatalog(db) {',
          '  await db.insert(tableFor("snapshots")).select(db.select().from(products));',
          '  await db.update(tableFor("snapshots")).set({ refreshed: true }).from(vendors);',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      syncCatalog: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'catalog.domain.ts:5',
            source: 'insert-select',
            via: 'products',
          },
          {
            domain: 'vendor',
            keys: null,
            site: 'catalog.domain.ts:6',
            source: 'update-from',
            via: 'vendors',
          },
        ],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'catalog.domain.ts:5',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'catalog.domain.ts:6',
          },
        ],
      },
    });
  });

  it('marks unresolved insert-select source tables as FW406', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));

          export async function importSnapshots(db) {
            await db.insert(snapshots).select(db.select().from(tableFor("products")));
          }
        `,
      },
    ]);

    expect(graph).toEqual({
      importSnapshots: {
        reads: [],
        touches: [
          { domain: 'snapshot', keys: null, site: 'product.domain.ts:5', via: 'product_snapshots' },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:5',
          },
        ],
      },
    });
  });

  it('does not fabricate insert-select read tables from string contents', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: [
          'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
          'export const snapshots = pgTable("product_snapshots", {}, jiso({ domain: "snapshot", key: "productId" }));',
          '',
          'export async function importSnapshots(db) {',
          '  await db.insert(snapshots).select(sql`select * from products where marker = ".from(products)"`);',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(graph).toEqual({
      importSnapshots: {
        reads: [],
        touches: [
          { domain: 'snapshot', keys: null, site: 'product.domain.ts:5', via: 'product_snapshots' },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:5',
          },
        ],
      },
    });
  });
});
