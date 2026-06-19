import { describe, expect, it } from 'vitest';

import { eq, getTableName, sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { kovo } from '@kovojs/drizzle';
import {
  createTouchGraphEntry,
  deriveInvalidationRegistry,
  deriveMutationTouchRegistry,
  diagnosticsForTouchGraph,
  extractTouchGraphFromProject,
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
  serializeInvalidationRegistry,
  serializeDomainRegistry,
  serializeMutationTouchRegistry,
  serializeTouchGraph,
} from '@kovojs/drizzle/internal/static';
import { annotatedTable, pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

const extractQueryFactsFromProject = (
  options: Parameters<typeof extractQueryFactsFromProjectBase>[0],
) => extractQueryFactsFromProjectBase(withPgDatabaseTypes(options));

describe('@kovojs/drizzle touch graph helpers', () => {
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
      kovo({ domain: 'product', key: 'id' }),
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
            '}, kovo({ domain: "product", key: "id" }));',
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
          '}, kovo({ domain: "product", key: "id" }));',
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
        '}, kovo({ domain: "product", key: "id" }));',
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

  it('creates deterministic touch graph entries from annotated tables and read domains', () => {
    const cartItems = annotatedTable('cart_items', kovo({ domain: 'cart', key: 'cartId' }));
    const products = annotatedTable('products', kovo({ domain: 'product', key: 'id' }));
    const priceRules = annotatedTable('price_rules', kovo({ domain: 'pricing', key: 'id' }));

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
              table: annotatedTable('prices', kovo({ domain: 'price' })),
            },
          ],
          unresolved: [{ domain: 'audit', operation: 'raw', site: 'cart.domain.ts:20' }],
          writes: [
            {
              branch: 'stock-check',
              operation: 'update',
              predicate: 'non-eq',
              site: 'cart.domain.ts:12',
              table: annotatedTable('products', kovo({ domain: 'product', key: 'id' })),
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
      { code: 'KV406', site: "cart.domain.ts:20", message: "Statically un-analyzable write site; manual touches required.", domain: "audit" },
    ],
  },
} as const;
`);
  });

  it('reports KV406 diagnostics for unresolved write sites', () => {
    expect(
      diagnosticsForTouchGraph({
        'cart.addItem': createTouchGraphEntry({
          reads: [
            {
              operation: 'insert-select',
              predicate: 'non-eq',
              site: 'cart.domain.ts:18',
              table: annotatedTable('prices', kovo({ domain: 'price', key: 'productId' })),
            },
          ],
          unresolved: [{ operation: 'raw', site: 'cart.domain.ts:20' }],
          writes: [
            {
              operation: 'update',
              predicate: 'non-eq',
              site: 'cart.domain.ts:12',
              table: annotatedTable('products', kovo({ domain: 'product', key: 'id' })),
            },
          ],
        }),
      }),
    ).toEqual([
      {
        code: 'KV406',
        message: 'Statically un-analyzable write site; manual touches required.',
        severity: 'warn',
        site: 'cart.domain.ts:20',
      },
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'cart.domain.ts:12',
      },
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'cart.domain.ts:18',
      },
    ]);
  });

  it('serializes deterministic domain registry output from table annotations', () => {
    const cartItems = annotatedTable('cart_items', kovo({ domain: 'cart', key: 'cartId' }));
    const products = annotatedTable('products', kovo({ domain: 'product', key: 'id' }));

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
              table: annotatedTable('cart_items', kovo({ domain: 'cart', key: 'cartId' })),
            },
            {
              operation: 'insert',
              site: 'cart.domain.ts:12',
              table: annotatedTable('orders', kovo({ domain: 'order' })),
            },
            {
              operation: 'update',
              site: 'cart.domain.ts:16',
              table: annotatedTable('products', kovo({ domain: 'product', key: 'id' })),
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

  it('derives and serializes mutation inferred touches for generated registries', () => {
    const registry = deriveMutationTouchRegistry({
      mutations: [{ mutation: 'cart/add', touchGraphKey: 'cart.addItem' }],
      touchGraph: {
        'cart.addItem': createTouchGraphEntry({
          writes: [
            {
              operation: 'insert',
              site: 'cart.domain.ts:8',
              table: annotatedTable('cart_items', kovo({ domain: 'cart', key: 'cartId' })),
            },
            {
              operation: 'update',
              site: 'cart.domain.ts:16',
              table: annotatedTable('products', kovo({ domain: 'product', key: 'id' })),
              writeKey: 'arg:productId',
            },
          ],
        }),
      },
    });

    expect(registry).toEqual({
      'cart/add': [
        { domain: 'cart', keys: null },
        { domain: 'product', keys: 'arg:productId' },
      ],
    });
    expect(
      serializeMutationTouchRegistry(registry, {
        constName: 'commerceMutationTouches',
        typeName: 'CommerceMutationTouches',
      }),
    ).toBe(`export const commerceMutationTouches = {
  'cart/add': [
    { domain: 'cart', keys: null },
    { domain: 'product', keys: 'arg:productId' },
  ],
} as const;

export interface CommerceMutationTouches {
  'cart/add': typeof commerceMutationTouches['cart/add'];
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
});
