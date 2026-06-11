import { describe, expect, it } from 'vitest';

import {
  createTouchGraphEntry,
  diagnosticsForTouchGraph,
  extractTouchGraphFromProject,
  extractTouchGraphFromSource,
  extractQueryFactsFromSource,
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

  it('extracts query result shapes, read domains, and instance keys from Drizzle selects', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'cart.queries.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export const cartQuery = query("cart", {
            async load(input, db) {
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

  it('omits instance keys when Drizzle query predicates do not target an annotated table key', () => {
    const facts = extractQueryFactsFromSource([
      {
        fileName: 'product.queries.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

          export const productQuery = query("product", {
            load(input, db) {
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

  it('keeps non-key and table-column predicates at table-level', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'product.domain.ts',
        source: `
          export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));
          export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));

          export async function syncProduct(db, productId) {
            await db.update(products).set({ reserved: true }).where(eq(products.sku, productId));
            await db.update(products).set({ price: prices.amount }).from(prices).where(eq(products.id, prices.productId));
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
            site: 'product.domain.ts:7',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          { domain: 'product', keys: null, site: 'product.domain.ts:6', via: 'products' },
          { domain: 'product', keys: null, site: 'product.domain.ts:7', via: 'products' },
        ],
        unresolved: [],
      },
    });
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

  it('recognizes renamed Drizzle receiver parameters', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

          export async function addItem(database, productId) {
            await database.insert(cartItems).values({ productId });
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
        unresolved: [],
      },
    });
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

  it('extracts configured write callbacks and folds local helper summaries', () => {
    const graph = extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const auditLog = pgTable("audit_log", {}, jiso({ domain: "audit", key: "productId" }));
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));

          async function writeAudit(db, productId) {
            await db.insert(auditLog).values({ productId });
          }

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
        {
          fileName: 'drizzle-types.d.ts',
          source: `
            declare module "drizzle-orm/pg-core" {
              export class PgDatabase<TQueryResultHKT = unknown, TFullSchema = unknown, TSchema = unknown> {
                insert(table: unknown): { values(value: unknown): Promise<void> };
              }
            }
          `,
        },
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

  it('resolves imported table symbols instead of same-name tables from other modules', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'drizzle-types.d.ts',
          source: `
            declare module "drizzle-orm/pg-core" {
              export class PgDatabase<TQueryResultHKT = unknown, TFullSchema = unknown, TSchema = unknown> {
                update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };
              }
            }
          `,
        },
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

  it('recognizes destructured Drizzle receiver aliases', () => {
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

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
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
