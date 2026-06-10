import { describe, expect, it } from 'vitest';

import {
  createTouchGraphEntry,
  diagnosticsForTouchGraph,
  extractTouchGraphFromSource,
  jiso,
  serializeDomainRegistry,
  serializeTouchGraph,
} from '../../../packages/drizzle/src/index.js';

describe('Drizzle pinned subset conformance', () => {
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
          '',
          'export async function addItem(db, productId, cartIds) {',
          '  await db.insert(cartItems).values({ productId: "p1" });',
          '  await db.update(products).set({ reserved: true }).from(prices).where(eq(products.id, productId));',
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
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:6", keys: null },',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:8", keys: null, predicate: "non-eq" },',
        '      { domain: "product", via: "products", site: "cart.domain.ts:7", keys: "arg:productId" },',
        '    ],',
        '    reads: [',
        '      { domain: "price", via: "prices", site: "cart.domain.ts:7", keys: null, source: "update-from" },',
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
        site: 'cart.domain.ts:8',
      },
    ]);
  });
});
