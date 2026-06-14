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
  it('pins table annotations as the domain registry source', () => {
    const cartItems = annotatedTable('cart_items', jiso({ domain: 'cart', key: 'cartId' }));
    const products = annotatedTable('products', jiso({ domain: 'product', key: 'id' }));

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
            table: annotatedTable('products', jiso({ domain: 'product', key: 'id' })),
          },
          {
            branch: 'stock-check',
            operation: 'update-from',
            predicate: 'eq',
            readKey: 'arg:productId',
            site: 'cart.domain.ts:21',
            table: annotatedTable(
              'inventory_snapshots',
              jiso({ domain: 'inventory', key: 'productId' }),
            ),
          },
        ],
        unresolved: [{ domain: 'audit', operation: 'raw', site: 'cart.domain.ts:31' }],
        writes: [
          {
            branch: 'stock-check',
            operation: 'update',
            predicate: 'non-eq',
            site: 'cart.domain.ts:20',
            table: annotatedTable('products', jiso({ domain: 'product', key: 'id' })),
            writeKey: 'arg:productId',
          },
          {
            operation: 'insert',
            site: 'cart.domain.ts:16',
            table: annotatedTable('cart_items', jiso({ domain: 'cart', key: 'cartId' })),
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

  it('pins direct table project extraction for the first supported Drizzle case', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'cart.domain.ts',
          source: [
            "import { eq, inArray } from 'drizzle-orm';",
            "import { alias } from 'drizzle-orm/pg-core';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, jiso({ domain: "price", key: "productId" }));',
            'const productAlias = alias(products, "p");',
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string, cartIds: string[]) {',
            '  await db.insert(cartItems).values({ productId: "p1" });',
            '  await db.update(productAlias).set({ reserved: true }).from(prices).where(eq(productAlias.id, productId));',
            '  await db.delete(cartItems).where(inArray(cartItems.cartId, cartIds));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "addItem": {',
        '    touches: [',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:11", keys: null },',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:13", keys: null, predicate: "non-eq" },',
        '      { domain: "product", via: "products", site: "cart.domain.ts:12", keys: "arg:productId" },',
        '    ],',
        '    reads: [',
        '      { domain: "price", via: "prices", site: "cart.domain.ts:12", keys: null, source: "update-from" },',
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
        site: 'cart.domain.ts:13',
      },
    ]);
  });

  it('pins AST-backed write predicate project extraction without string-contained key facts', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'product.domain.ts',
          source: [
            "import { gt, sql } from 'drizzle-orm';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            '',
            'export async function scrubPredicate(db: PgDatabase<any, any, any>, productId: string) {',
            '  await db.update(products).set({ reserved: true }).where(gt(sql.raw("products.id"), productId));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "scrubPredicate": {',
        '    touches: [',
        '      { domain: "product", via: "products", site: "product.domain.ts:7", keys: null },',
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
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
  });

  it('pins local conditional table project resolution as a safe over-approximation', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'product.domain.ts',
          source: [
            "import { eq } from 'drizzle-orm';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'export const archivedProducts = pgTable("archived_products", {}, jiso({ domain: "archive", key: "id" }));',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'declare const useArchive: boolean;',
            'const writeTarget = useArchive ? archivedProducts : products;',
            '',
            'export async function syncProduct(db: PgDatabase<any, any, any>, productId: string) {',
            '  await db.update(writeTarget).set({ reserved: true }).where(eq(writeTarget.id, productId));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "syncProduct": {',
        '    touches: [',
        '      { domain: "archive", via: "archived_products", site: "product.domain.ts:10", keys: "arg:productId" },',
        '      { domain: "product", via: "products", site: "product.domain.ts:10", keys: "arg:productId" },',
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

  it('pins project conditional table resolution as a safe over-approximation', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.domain.ts',
          source: [
            "import { eq } from 'drizzle-orm';",
            "import { pgTable } from 'drizzle-orm/pg-core';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const archivedProducts = pgTable('archived_products', {}, jiso({ domain: 'archive', key: 'id' }));",
            "export const prices = pgTable('prices', {}, jiso({ domain: 'price', key: 'productId' }));",
            "export const products = pgTable('products', {}, jiso({ domain: 'product', key: 'id' }));",
            'const priceSource = useArchive ? archivedProducts : prices;',
            'const writeTarget = useArchive ? archivedProducts : products;',
            '',
            'export async function syncProduct(db: PgDatabase<any, any, any>, productId: string) {',
            '  await db.update(writeTarget).set({ reserved: true }).from(priceSource).where(eq(writeTarget.id, productId));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'archive',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
            source: 'update-from',
            via: 'archived_products',
          },
          {
            domain: 'price',
            keys: null,
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          {
            domain: 'archive',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
            via: 'archived_products',
          },
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

  it('pins conditional table FW406 in project mode when the opaque branch contains string punctuation', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'product.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));',
            'declare const useDynamic: boolean;',
            'const writeTarget = useDynamic ? tableFor("archive:products") : products;',
            '',
            'export async function syncProduct(db: PgDatabase<any, any, any>) {',
            '  await db.update(writeTarget).set({ reserved: true });',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "syncProduct": {',
        '    touches: [',
        '      { domain: "product", via: "products", site: "product.domain.ts:8", keys: null },',
        '    ],',
        '    reads: [',
        '    ],',
        '    unresolved: [',
        '      { code: \'FW406\', site: "product.domain.ts:8", message: "Statically un-analyzable write site; manual touches required." },',
        '    ],',
        '  },',
        '} as const;',
        '',
      ].join('\n'),
    );
  });

  it('pins project update predicate subquery read sources under real Drizzle imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import { inArray } from 'drizzle-orm';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', { id: text('id').primaryKey() }, jiso({ domain: 'product', key: 'id' }));",
            "export const cartItems = pgTable('cart_items', { productId: text('product_id').notNull() }, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function reserveCartProducts(db: PgDatabase<any, any, any>) {',
            '  await db.update(products).set({ reserved: true }).where(inArray(products.id, db.select({ productId: cartItems.productId }).from(cartItems)));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      reserveCartProducts: {
        reads: [
          {
            domain: 'cart',
            keys: null,
            predicate: 'non-eq',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:9',
            source: 'update-predicate',
            via: 'cart_items',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:9',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins project delete predicate subquery read sources under real Drizzle imports', () => {
    // SPEC §11.1: real drizzle-orm Postgres `PgDeleteBase` exposes only where/returning (no
    // `.from()`/`.using()`), so a `delete().where(inArray(col, db.select().from(R)))` reads R as a
    // `delete-predicate` source instead of silently dropping the subquery read.
    expect(inArray).toBeTypeOf('function');
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import { inArray } from 'drizzle-orm';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', { id: text('id').primaryKey() }, jiso({ domain: 'product', key: 'id' }));",
            "export const cartItems = pgTable('cart_items', { productId: text('product_id').notNull() }, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function pruneOrphanedItems(db: PgDatabase<any, any, any>) {',
            '  await db.delete(cartItems).where(inArray(cartItems.productId, db.select({ id: products.id }).from(products)));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      pruneOrphanedItems: {
        reads: [
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:9',
            source: 'delete-predicate',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'cart',
            keys: null,
            predicate: 'non-eq',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:9',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins opaque project delete predicate subquery reads as FW406 under real Drizzle imports', () => {
    // SPEC §11.1: an opaque delete-predicate read source stays visible as FW406, not guessed.
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import { inArray } from 'drizzle-orm';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', { productId: text('product_id').notNull() }, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function pruneOrphanedItems(db: PgDatabase<any, any, any>) {',
            '  await db.delete(cartItems).where(inArray(cartItems.productId, db.select().from(tableFor("products"))));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      pruneOrphanedItems: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            predicate: 'non-eq',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:8',
            via: 'cart_items',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Delete predicate read source could not be resolved to a Drizzle table.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:8',
          },
        ],
      },
    });
  });

  it('pins project conditional table FW406 when an opaque branch remains', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.domain.ts',
          source: [
            "import { pgTable } from 'drizzle-orm/pg-core';",
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {}, jiso({ domain: 'product', key: 'id' }));",
            "const writeTarget = useDynamic ? tableFor('archive:products') : products;",
            '',
            'export async function syncProduct(db: PgDatabase<any, any, any>) {',
            '  await db.update(writeTarget).set({ reserved: true });',
            '}',
            '',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
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

  it('pins domain write callback project extraction for the Jiso authoring surface', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "productId" }));',
            '',
            'export const cart = domain({',
            '  addItem: write(async (db: PgDatabase<any, any, any>, productId: string) => {',
            '    await db.insert(cartItems).values({ productId });',
            '  }),',
            '});',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(serializeTouchGraph(graph)).toBe(
      [
        'export const touchGraph = {',
        '  "cart.addItem": {',
        '    touches: [',
        '      { domain: "cart", via: "cart_items", site: "cart.domain.ts:7", keys: null },',
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
