import { describe, expect, it } from 'vitest';

import {
  createTouchGraphEntry,
  diagnosticsForTouchGraph,
  extractTouchGraphFromSource,
  jiso,
  serializeDomainRegistry,
  serializeTouchGraph,
} from './index.js';

describe('@jiso/drizzle touch graph helpers', () => {
  it('creates deterministic touch graph entries from annotated tables and read domains', () => {
    const cartItems = { ...jiso({ domain: 'cart', key: 'cartId' }), name: 'cart_items' };
    const products = { ...jiso({ domain: 'product', key: 'id' }), name: 'products' };
    const priceRules = { ...jiso({ domain: 'pricing', key: 'id' }), name: 'price_rules' };

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
              table: { ...jiso({ domain: 'price' }), name: 'prices' },
            },
          ],
          unresolved: [{ domain: 'audit', operation: 'raw', site: 'cart.domain.ts:20' }],
          writes: [
            {
              branch: 'stock-check',
              operation: 'update',
              predicate: 'non-eq',
              site: 'cart.domain.ts:12',
              table: { ...jiso({ domain: 'product', key: 'id' }), name: 'products' },
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
              table: { ...jiso({ domain: 'price', key: 'productId' }), name: 'prices' },
            },
          ],
          unresolved: [{ operation: 'raw', site: 'cart.domain.ts:20' }],
          writes: [
            {
              operation: 'update',
              predicate: 'non-eq',
              site: 'cart.domain.ts:12',
              table: { ...jiso({ domain: 'product', key: 'id' }), name: 'products' },
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
    const cartItems = { ...jiso({ domain: 'cart', key: 'cartId' }), name: 'cart_items' };
    const products = { ...jiso({ domain: 'product', key: 'id' }), name: 'products' };

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
});
