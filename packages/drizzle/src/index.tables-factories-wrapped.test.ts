import { describe, expect, it } from 'vitest';

import {
  diagnosticsForQueryFacts,
  diagnosticsForTouchGraph,
  extractTouchGraphFromProject,
  extractQueryFactsFromProject,
  serializeTouchGraph,
} from '@jiso/drizzle/static';
import { pgDatabaseTypes, unresolvedQueryLoadFact } from './test-helpers.js';

describe('@jiso/drizzle touch graph helpers', () => {
  it('extracts project tables and column shapes from aliased real Postgres factory imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<void> };']),
        {
          fileName: 'catalog.domain.ts',
          source: [
            'import { pgTable as table, text as pgText, integer as pgInteger, type PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = table("products", {',
            '  id: pgText("id").primaryKey(),',
            '  stock: pgInteger("stock").notNull(),',
            '}, jiso({ domain: "product", key: "id" }));',
            '',
            'export const productQuery = query("product/aliased-imports", {',
            '  load(_input, db: PgDatabase<any, any, any>) {',
            '    return db.select({ id: products.id, stock: products.stock }).from(products);',
            '  },',
            '});',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/aliased-imports',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'catalog.domain.ts:8',
      },
    ]);
  });

  it('extracts project tables and column shapes from Postgres factory re-export barrels', () => {
    const files = [
      {
        fileName: 'packages/drizzle/src/pg-barrel.fixture.ts',
        source: [
          'export { pgTable as table, text as pgText, integer as pgInteger } from "drizzle-orm/pg-core";',
          '',
        ].join('\n'),
      },
      {
        fileName: 'packages/drizzle/src/fake-barrel.fixture.ts',
        source: [
          'export function table(_name: string, _columns: unknown, _extra: unknown) { return {}; }',
          'export function pgText(_name: string) { return { primaryKey() { return this; } }; }',
          '',
        ].join('\n'),
      },
      {
        fileName: 'packages/drizzle/src/catalog.domain.fixture.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          'import { table, pgText, pgInteger } from "./pg-barrel.fixture";',
          'import { table as fakeTable, pgText as fakeText } from "./fake-barrel.fixture";',
          '',
          'export const products = table("products", {',
          '  id: pgText("id").primaryKey(),',
          '  stock: pgInteger("stock").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export const fakeProducts = fakeTable("fake_products", {',
          '  id: fakeText("id").primaryKey(),',
          '}, jiso({ domain: "fake", key: "id" }));',
          '',
          'export const productQuery = query("product/barrel-factories", {',
          '  load(_input, db: PgDatabase<any, any, any>) {',
          '    return db.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
          'export const fakeQuery = query("product/fake-barrel-factories", {',
          '  load(_input, db: PgDatabase<any, any, any>) {',
          '    return db.select({ id: fakeProducts.id }).from(fakeProducts);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/barrel-factories',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'packages/drizzle/src/catalog.domain.fixture.ts:14',
      },
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query projection product/fake-barrel-factories.id could not be resolved to a Drizzle column or typed sql<T> expression.',
            severity: 'warn',
            site: 'packages/drizzle/src/catalog.domain.fixture.ts:20',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query read source for db.from() could not be resolved to a Drizzle table.',
            severity: 'warn',
            site: 'packages/drizzle/src/catalog.domain.fixture.ts:20',
          },
        ],
        query: 'product/fake-barrel-factories',
        reads: [],
        shape: {},
        site: 'packages/drizzle/src/catalog.domain.fixture.ts:20',
      },
    ]);
  });

  it('does not fabricate project table facts from local Postgres factory lookalikes', () => {
    const files = [
      pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<void> };']),
      {
        fileName: 'catalog.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'function pgTable(_name: string, _columns: unknown, _extra: unknown) { return {}; }',
          'function text(_name: string) { return { primaryKey() { return this; } }; }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'export async function loadCatalog(db: PgDatabase<any, any, any>) {',
          '  await db.select({ id: products.id }).from(products);',
          '}',
          '',
          'export const productQuery = query("product/fake-factory", {',
          '  load(_input, db: PgDatabase<any, any, any>) {',
          '    return db.select({ id: products.id }).from(products);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      loadCatalog: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'catalog.domain.ts:11',
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
              'Statically un-analyzable write site; manual touches required. Query projection product/fake-factory.id could not be resolved to a Drizzle column or typed sql<T> expression.',
            severity: 'warn',
            site: 'catalog.domain.ts:14',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query read source for db.from() could not be resolved to a Drizzle table.',
            severity: 'warn',
            site: 'catalog.domain.ts:14',
          },
        ],
        query: 'product/fake-factory',
        reads: [],
        shape: {},
        site: 'catalog.domain.ts:14',
      },
    ]);
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

  it('extracts wrapped variable-assigned local helpers from query loaders and domain callbacks', () => {
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
          'const readProducts = ((db: PgDatabase<any, any, any>) => {',
          '  return db.select({ id: products.id }).from(products);',
          '}) satisfies unknown;',
          '',
          'const touchProduct = (async (db: PgDatabase<any, any, any>, productId: string) => {',
          '  return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}) as unknown;',
          '',
          'export const productQuery = query("product/wrapped-helper", {',
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
        query: 'product/wrapped-helper',
        reads: ['product'],
        shape: {},
        site: 'product.domain.ts:16',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
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
      readProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:9',
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
            site: 'product.domain.ts:13',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts bound project query loaders and domain callbacks without pre-bound arguments', () => {
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
          'function readProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id }).from(products);',
          '}',
          '',
          'function touchProduct(db: PgDatabase<any, any, any>, productId: string) {',
          '  return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'declare const fakeDb: PgDatabase<any, any, any>;',
          '',
          'export const productQuery = query("product/bound-loader", {',
          '  load: readProducts.bind(undefined),',
          '});',
          '',
          'export const unsafeQuery = query("product/prebound-loader", {',
          '  load: readProducts.bind(undefined, { productId: "p1" }),',
          '});',
          '',
          'export const productDomain = domain({',
          '  add: write(touchProduct.bind(null)),',
          '  unsafe: write(touchProduct.bind(null, fakeDb)),',
          '});',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/bound-loader',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.domain.ts:18',
      },
      unresolvedQueryLoadFact('product/prebound-loader', 'product.domain.ts:22'),
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
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
      'productDomain.unsafe': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:28',
          },
        ],
      },
      readProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:9',
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
            site: 'product.domain.ts:13',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
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

  it('folds project query and mutation helper summaries from static class members', () => {
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
          'export const productQuery = query("product/static-class-helper-loader", {',
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

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/static-class-helper-loader',
        reads: ['product'],
        shape: {},
        site: 'product.domain.ts:18',
      },
    ]);
    expect(diagnosticsForQueryFacts(extractQueryFactsFromProject({ files }))).toEqual([]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:14',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(extractTouchGraphFromProject({ files }))).toEqual([]);
  });

  it('propagates project static class member local helpers and FW406 surfaces', () => {
    const files = [
      pgDatabaseTypes([
        'execute(value: unknown): Promise<void>;',
        'select(value?: unknown): { from(table: unknown): Promise<void> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import { eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'declare function inspect(value: unknown): void;',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '}, jiso({ domain: "product", key: "id" }));',
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
          'export const productQuery = query("product/static-class-local-helper", {',
          '  load(input: unknown, db: PgDatabase<any, any, any>) {',
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
            site: 'product.domain.ts:24',
          },
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query local helper has unresolved Drizzle execute().',
            severity: 'warn',
            site: 'product.domain.ts:25',
          },
        ],
        query: 'product/static-class-local-helper',
        reads: ['product'],
        shape: {},
        site: 'product.domain.ts:38',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:15',
            via: 'products',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:33',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:34',
          },
        ],
      },
      readProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:11',
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
            site: 'product.domain.ts:15',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts project domain action shorthand aliases through destructured static containers', () => {
    const files = [
      pgDatabaseTypes([
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
          'class ProductActions {',
          '  static add = write(addItem);',
          '  static get restock() {',
          '    return write(addItem);',
          '  }',
          '}',
          '',
          'const { add, restock: refill } = ProductActions;',
          '',
          'export const productDomain = domain({',
          '  add,',
          '  refill,',
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
      'productDomain.refill': {
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

  it('extracts visible project query and domain factories returning static objects', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<void> };',
        'update(table: unknown): { set(value: unknown): Promise<void> };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import { eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  name: text("name").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id, name: products.name }).from(products);',
          '}',
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  return db.update(products).set({ name: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'function makeOptions() {',
          '  return { load: loadProducts };',
          '}',
          '',
          'const makeActions = () => ({',
          '  add: write(addItem),',
          '});',
          '',
          'export const productDomain = domain(makeActions());',
          '',
          'export const productQuery = query("product/factory-return-loader", makeOptions());',
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
            site: 'product.domain.ts:14',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:14',
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
            site: 'product.domain.ts:10',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/factory-return-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'product.domain.ts:27',
      },
    ]);
  });

  it('extracts project query and domain factories returning local static aliases', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<void> };',
        'update(table: unknown): { set(value: unknown): Promise<void> };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import { eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  name: text("name").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id, name: products.name }).from(products);',
          '}',
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  return db.update(products).set({ name: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'function makeOptions() {',
          '  const base = { load: loadProducts };',
          '  const options = { ...base };',
          '  return options;',
          '}',
          '',
          'function makeActions() {',
          '  const base = { add: write(addItem) };',
          '  const actions = { ...base };',
          '  return actions;',
          '}',
          '',
          'export const productDomain = domain(makeActions());',
          '',
          'export const productQuery = query("product/local-factory-return-loader", makeOptions());',
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
            site: 'product.domain.ts:14',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:14',
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
            site: 'product.domain.ts:10',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/local-factory-return-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'product.domain.ts:31',
      },
    ]);
  });

  it('extracts project query loader getters returning static callbacks', () => {
    const files = [
      pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<void> };']),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  name: text("name").notNull(),',
          '}, jiso({ domain: "product", key: "id" }));',
          '',
          'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id, name: products.name }).from(products);',
          '}',
          '',
          'const options = {',
          '  get load() {',
          '    return loadProducts;',
          '  },',
          '};',
          '',
          'export const productQuery = query("product/getter-loader", options);',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/getter-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'product.domain.ts:18',
      },
    ]);
  });

  it('keeps wrapped opaque project domain actions visible as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'product.domain.ts',
          source: [
            'declare const dynamicActions: any;',
            '',
            'export const productDomain = (domain(dynamicActions) satisfies unknown);',
          ].join('\n'),
        },
      ],
    });

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

  it('extracts project relational query API calls on Drizzle receivers as reads', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['query: any;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, jiso({ domain: "user", key: "id" }));',
            '',
            'export async function loadUsers(db: PgDatabase<any, any, any>) {',
            '  return db.query.users.findMany({ where: eq(users.active, true) });',
            '}',
          ].join('\n'),
        },
      ],
    });

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
        unresolved: [],
      },
    });
  });

  it('marks project unresolved relational query API table names as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['query: any;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export async function loadUsers(db: PgDatabase<any, any, any>, tableName: string) {',
            '  return db.query[tableName].findMany();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      loadUsers: {
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

  it('marks project aliases with unresolved bases as FW406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'const productAlias = alias(tableFor("products"), "p");',
            '',
            'export async function syncProduct(db: PgDatabase<any, any, any>) {',
            '  await db.update(productAlias).set({ reserved: true });',
            '}',
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
});
