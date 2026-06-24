import { describe, expect, it } from 'vitest';

import { extractTouchGraphFromProject } from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle touch graph helpers', () => {
  it('marks project-mode computed table expressions as KV406 instead of resolving descendant tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function syncProduct(db: PgAsyncDatabase<any, any>) {',
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
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:6',
          },
        ],
      },
    });
  });

  it('over-approximates project-mode conditional table initializers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { from(table: unknown): { where(predicate: unknown): Promise<void> } } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const archivedProducts = pgTable("archived_products", {}, kovo({ domain: "archive", key: "id" }));',
            'export const prices = pgTable("prices", {}, kovo({ domain: "price", key: "productId" }));',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'const priceSource = useArchive ? archivedProducts : prices;',
            'const writeTarget = useArchive ? archivedProducts : products;',
            '',
            'export async function syncProduct(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  await db.update(writeTarget).set({ reserved: true }).from(priceSource).where(eq(writeTarget.id, productId));',
            '}',
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
            site: 'product.domain.ts:11',
            source: 'update-from',
            via: 'archived_products',
          },
          {
            domain: 'price',
            keys: null,
            site: 'product.domain.ts:11',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          {
            domain: 'archive',
            keys: 'arg:productId',
            site: 'product.domain.ts:11',
            via: 'archived_products',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:11',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('keeps project-mode resolved conditional table branches with opaque branch KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'const writeTarget = useDynamic ? tableFor("archive:products") : products;',
            '',
            'export async function syncProduct(db: PgAsyncDatabase<any, any>) {',
            '  await db.update(writeTarget).set({ reserved: true });',
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
            site: 'product.domain.ts:7',
            via: 'products',
          },
        ],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:7',
          },
        ],
      },
    });
  });

  it('keeps resolved write read sources when the project-mode write target is opaque', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { select(value: unknown): Promise<void> };',
          'select(value?: unknown): { from(table: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): { from(table: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'catalog.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'export const vendors = pgTable("vendors", {}, kovo({ domain: "vendor", key: "id" }));',
            '',
            'export async function syncCatalog(db: PgAsyncDatabase<any, any>) {',
            '  await db.insert(tableFor("snapshots")).select(db.select().from(products));',
            '  await db.update(tableFor("snapshots")).set({ refreshed: true }).from(vendors);',
            '}',
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
            site: 'catalog.domain.ts:7',
            source: 'insert-select',
            via: 'products',
          },
          {
            domain: 'vendor',
            keys: null,
            site: 'catalog.domain.ts:8',
            source: 'update-from',
            via: 'vendors',
          },
        ],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'catalog.domain.ts:7',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'catalog.domain.ts:8',
          },
        ],
      },
    });
  });

  it('marks project unresolved insert-select source tables as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { select(value: unknown): Promise<void> };',
          'select(value?: unknown): { from(table: unknown): Promise<void> };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const snapshots = pgTable("product_snapshots", {}, kovo({ domain: "snapshot", key: "productId" }));',
            '',
            'export async function importSnapshots(db: PgAsyncDatabase<any, any>) {',
            '  await db.insert(snapshots).select(db.select().from(tableFor("products")));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      importSnapshots: {
        reads: [],
        touches: [
          { domain: 'snapshot', keys: null, site: 'product.domain.ts:6', via: 'product_snapshots' },
        ],
        unresolved: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Insert-select read source could not be resolved to a Drizzle table.',
            site: 'product.domain.ts:6',
          },
        ],
      },
    });
  });

  it('marks project unresolved update-from source tables as explicit KV406 read-source surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { from(table: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function importSnapshots(db: PgAsyncDatabase<any, any>) {',
            '  await db.update(products).set({ reserved: true }).from(tableFor("prices"));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      importSnapshots: {
        reads: [],
        touches: [{ domain: 'product', keys: null, site: 'product.domain.ts:6', via: 'products' }],
        unresolved: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Update-from read source could not be resolved to a Drizzle table.',
            site: 'product.domain.ts:6',
          },
        ],
      },
    });
  });

  it('does not fabricate project insert-select read tables from string contents', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { select(value: unknown): Promise<void> };']),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'export const snapshots = pgTable("product_snapshots", {}, kovo({ domain: "snapshot", key: "productId" }));',
            '',
            'export async function importSnapshots(db: PgAsyncDatabase<any, any>) {',
            '  await db.insert(snapshots).select(sql`select * from products where marker = ".from(products)"`);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      importSnapshots: {
        reads: [],
        touches: [
          { domain: 'snapshot', keys: null, site: 'product.domain.ts:7', via: 'product_snapshots' },
        ],
        unresolved: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Insert-select read source could not be resolved to a Drizzle table.',
            site: 'product.domain.ts:7',
          },
        ],
      },
    });
  });
});
