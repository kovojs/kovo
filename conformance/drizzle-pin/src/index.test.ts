import { describe, expect, it } from 'vitest';

import { eq, gt, inArray } from 'drizzle-orm';
import { alias, boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import {
  createTouchGraphEntry,
  diagnosticsForTouchGraph,
  extractTouchGraphFromProject,
  extractTouchGraphFromSource,
  jiso,
  serializeDomainRegistry,
  serializeTouchGraph,
} from '../../../packages/drizzle/src/index.js';

describe('Drizzle pinned subset conformance', () => {
  it('imports the pinned real Drizzle Postgres subset used by extraction examples', () => {
    const products = pgTable('products', {
      archived: boolean('archived').notNull().default(false),
      createdAt: timestamp('created_at').notNull(),
      id: text('id').primaryKey(),
      stock: integer('stock').notNull(),
    });
    const cartItems = pgTable('cart_items', {
      cartId: text('cart_id').notNull(),
      productId: text('product_id').notNull(),
      qty: integer('qty').notNull(),
    });
    const productAlias = alias(products, 'p');

    expect(products.id).toBeDefined();
    expect(cartItems.productId).toBeDefined();
    expect(productAlias.id).toBeDefined();
    expect(eq(products.id, 'p1')).toBeDefined();
    expect(gt(products.stock, 0)).toBeDefined();
    expect(inArray(cartItems.cartId, ['c1', 'c2'])).toBeDefined();
  });

  it('recognizes real Drizzle receiver types in project extraction', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));

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

  it('pins table annotations as the domain registry source', () => {
    const cartItems = { ...jiso({ domain: 'cart', key: 'cartId' }), name: 'cart_items' };
    const products = { ...jiso({ domain: 'product', key: 'id' }), name: 'products' };

    expect(serializeDomainRegistry([{ table: products }, { table: cartItems }])).toBe(
      [
        'export type DomainKey = "cart" | "product";',
        '',
        'export const tableDomains = {',
        '  "cart_items": "cart",',
        '  "products": "product",',
        '} as const satisfies Record<string, DomainKey>;',
        '',
      ].join('\n'),
    );
  });

  it('pins write summaries, read domains, parameterized keys, unresolved sites, and diagnostics', () => {
    const graph = {
      'cart.addItem': createTouchGraphEntry({
        reads: [
          {
            operation: 'insert-select',
            predicate: 'non-eq',
            site: 'cart.domain.ts:15',
            table: { ...jiso({ domain: 'product', key: 'id' }), name: 'products' },
          },
          {
            branch: 'stock-check',
            operation: 'update-from',
            predicate: 'eq',
            readKey: 'arg:productId',
            site: 'cart.domain.ts:21',
            table: {
              ...jiso({ domain: 'inventory', key: 'productId' }),
              name: 'inventory_snapshots',
            },
          },
        ],
        unresolved: [{ domain: 'audit', operation: 'raw', site: 'cart.domain.ts:31' }],
        writes: [
          {
            branch: 'stock-check',
            operation: 'update',
            predicate: 'non-eq',
            site: 'cart.domain.ts:20',
            table: { ...jiso({ domain: 'product', key: 'id' }), name: 'products' },
            writeKey: 'arg:productId',
          },
          {
            operation: 'insert',
            site: 'cart.domain.ts:16',
            table: { ...jiso({ domain: 'cart', key: 'cartId' }), name: 'cart_items' },
          },
        ],
      }),
    };

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "cart.addItem": {',
        '    touches: [',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:16", keys: null },',
        '      { domain: "product", via: "products", site: "cart.domain.ts:20", keys: "arg:productId", branch: "stock-check", predicate: "non-eq" },',
        '    ],',
        '    reads: [',
        '      { domain: "inventory", via: "inventory_snapshots", site: "cart.domain.ts:21", keys: "arg:productId", source: "update-from", branch: "stock-check", predicate: "eq" },',
        '      { domain: "product", via: "products", site: "cart.domain.ts:15", keys: null, source: "insert-select", predicate: "non-eq" },',
        '    ],',
        '    unresolved: [',
        '      { code: \'FW406\', site: "cart.domain.ts:31", message: "Statically un-analyzable write site; manual touches required.", domain: "audit" },',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'FW406',
        message: 'Statically un-analyzable write site; manual touches required.',
        severity: 'warn',
        site: 'cart.domain.ts:31',
      },
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'cart.domain.ts:20',
      },
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'cart.domain.ts:15',
      },
    ]);
  });

  it('pins direct table source extraction for the first supported Drizzle case', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));',
          'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
          'export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));',
          'const productAlias = alias(products, "p");',
          '',
          'export async function addItem(db, productId, cartIds) {',
          '  await db.insert(cartItems).values({ productId: "p1" });',
          '  await db.update(productAlias).set({ reserved: true }).from(prices).where(eq(productAlias.id, productId));',
          '  await db.delete(cartItems).where(inArray(cartItems.cartId, cartIds));',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "addItem": {',
        '    touches: [',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:7", keys: null },',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:9", keys: null, predicate: "non-eq" },',
        '      { domain: "product", via: "products", site: "cart.domain.ts:8", keys: "arg:productId" },',
        '    ],',
        '    reads: [',
        '      { domain: "price", via: "prices", site: "cart.domain.ts:8", keys: null, source: "update-from" },',
        '    ],',
        '    unresolved: [',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'FW409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'cart.domain.ts:9',
      },
    ]);
  });

  it('pins local conditional table resolution as a safe over-approximation', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: [
          'export const archivedProducts = pgTable("archived_products", {}, jiso({ domain: "archive", key: "id" }));',
          'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
          'const writeTarget = useArchive ? archivedProducts : products;',
          '',
          'export async function syncProduct(db, productId) {',
          '  await db.update(writeTarget).set({ reserved: true }).where(eq(writeTarget.id, productId));',
          '}',
          '',
        ].join('\n'),
      },
    ]);

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "syncProduct": {',
        '    touches: [',
        '      { domain: "archive", via: "archived_products", site: "product.domain.ts:6", keys: "arg:productId" },',
        '      { domain: "product", via: "products", site: "product.domain.ts:6", keys: "arg:productId" },',
        '    ],',
        '    reads: [',
        '    ],',
        '    unresolved: [',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
  });

  it('pins domain write callback extraction for the Jiso authoring surface', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: [
          'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
          '',
          'export const cart = domain({',
          '  addItem: write(async (db, productId) => {',
          '    await db.insert(cartItems).values({ productId });',
          '  }),',
          '});',
          '',
        ].join('\n'),
      },
    ]);

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "cart.addItem": {',
        '    touches: [',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:5", keys: null },',
        '    ],',
        '    reads: [',
        '    ],',
        '    unresolved: [',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
  });
});
