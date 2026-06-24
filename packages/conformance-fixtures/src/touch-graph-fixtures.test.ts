import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SourceFileInput } from '@kovojs/drizzle/internal/static';
import {
  extractQueryFactsFromProject,
  extractTouchGraphFromProject,
} from '@kovojs/drizzle/internal/static';
import { describe, expect, it } from 'vitest';

import { drizzleQueryBehaviorSourceFixtures } from './source-fixtures.js';
import {
  touchGraphProvenanceHonestyFact,
  touchGraphProvenanceFact,
  touchGraphSourceFacts,
  touchGraphSourceSiteSummaryFact,
  touchGraphSummaryFacts,
} from './touch-graph-fixtures.js';

function pgDatabaseTypes(methods: readonly string[]): SourceFileInput {
  return {
    fileName: 'drizzle-types.d.ts',
    source: [
      'import "drizzle-orm/pg-core";',
      'declare module "drizzle-orm/pg-core" {',
      '  export interface PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> {',
      ...methods.map((method) => `    ${method}`),
      '  }',
      '}',
      'type PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> = import("drizzle-orm/pg-core").PgAsyncDatabase<TQueryResultHKT, TFullSchema>;',
    ].join('\n'),
  };
}

function sqliteDatabaseTypes(methods: readonly string[]): SourceFileInput {
  return {
    fileName: 'sqlite-drizzle-types.d.ts',
    source: [
      'import "drizzle-orm/sqlite-core";',
      'declare module "drizzle-orm/sqlite-core" {',
      '  export interface BaseSQLiteDatabase<TResultKind = unknown, TRunResult = unknown, TFullSchema = unknown, TSchema = unknown> {',
      ...methods.map((method) => `    ${method}`),
      '  }',
      '}',
      'type BaseSQLiteDatabase<TResultKind = unknown, TRunResult = unknown, TFullSchema = unknown, TSchema = unknown> = import("drizzle-orm/sqlite-core").BaseSQLiteDatabase<TResultKind, TRunResult, TFullSchema, TSchema>;',
    ].join('\n'),
  };
}

describe('@kovojs/test touch graph fixture seam', () => {
  it('locks closure-nested Drizzle writes as captured touches or KV406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'delete(table: unknown): { where(value: unknown): Promise<void> };',
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'transaction<T>(callback: (tx: PgAsyncDatabase<TQueryResultHKT, TFullSchema>) => Promise<T>): Promise<T>;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'function saveItem(writer: PgAsyncDatabase<any, any>, productId: string) {',
            '  return writer.insert(cartItems).values({ productId });',
            '}',
            '',
            'export async function addItems(db: PgAsyncDatabase<any, any>, productIds: string[]) {',
            '  await Promise.all(productIds.map(async (productId) => db.insert(cartItems).values({ productId })));',
            '  productIds.forEach((productId) => db.update(cartItems).set({ productId }));',
            '  await db.transaction(async (tx) => {',
            '    await Promise.all(productIds.map(async (productId) => tx.delete(cartItems).where(eq(cartItems.productId, productId))));',
            '  });',
            '  productIds.map((productId) => saveItem(db, productId));',
            '  withRetry(async () => db.insert(cartItems).values({ productId: "opaque" }));',
            '  withRetry(async () => saveItem(db, "opaque-helper"));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.addItems?.touches).toEqual([
      { domain: 'cart', keys: null, site: 'cart.domain.ts:10', via: 'cart_items' },
      { domain: 'cart', keys: null, site: 'cart.domain.ts:11', via: 'cart_items' },
      { domain: 'cart', keys: null, site: 'cart.domain.ts:6', via: 'cart_items' },
      {
        domain: 'cart',
        keys: null,
        predicate: 'non-eq',
        site: 'cart.domain.ts:13',
        via: 'cart_items',
      },
    ]);
    expect(graph.addItems?.unresolved).toEqual([
      {
        code: 'KV406',
        message: 'Statically un-analyzable write site; manual touches required.',
        site: 'cart.domain.ts:16',
      },
      {
        code: 'KV406',
        message: 'Statically un-analyzable write site; manual touches required.',
        site: 'cart.domain.ts:17',
      },
    ]);
  });

  it('locks the SQLite Drizzle fixture into touch and read-shape extraction', () => {
    const files = [
      sqliteDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } & Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      ...drizzleQueryBehaviorSourceFixtures().sqlitePortability,
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      reserveProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'sqlite.domain.ts:7',
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
        query: 'product/sqlite',
        reads: ['product'],
        shape: {
          active: 'boolean',
          id: 'string',
          metadata: {
            kind: 'nullable',
            shape: 'object',
          },
          stock: 'number',
        },
        site: 'sqlite.domain.ts:12',
      },
      {
        query: 'search/sqlite',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'sqlite.domain.ts:23',
      },
    ]);
  });

  it('summarizes touch-graph source provenance against resolved source lines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-test-touch-graph-'));
    const touchGraph = {
      'cart.addItem': {
        touches: [
          { domain: 'cart', keys: null, site: 'src/cart.ts:2', via: 'cart_items' },
          {
            domain: 'product',
            keys: 'arg:productId',
            predicate: 'eq',
            site: 'src/cart.ts:3',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    };

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(
        join(root, 'src/cart.ts'),
        [
          'export function addToCart() {',
          '  db.write("cart_items", item);',
          '  db.write("products", productId);',
          '}',
        ].join('\n'),
      );

      await expect(touchGraphSourceFacts(root, touchGraph)).resolves.toEqual([
        {
          domain: 'cart',
          keys: null,
          line: 2,
          mutation: 'cart.addItem',
          path: 'src/cart.ts',
          predicate: undefined,
          sourceLine: 'db.write("cart_items", item);',
          via: 'cart_items',
        },
        {
          domain: 'product',
          keys: 'arg:productId',
          line: 3,
          mutation: 'cart.addItem',
          path: 'src/cart.ts',
          predicate: 'eq',
          sourceLine: 'db.write("products", productId);',
          via: 'products',
        },
      ]);
      await expect(touchGraphSummaryFacts(root, touchGraph)).resolves.toEqual({
        'cart.addItem': {
          reads: [],
          touches: [
            {
              domain: 'cart',
              keys: null,
              predicate: undefined,
              sitePath: 'src/cart.ts',
              sourceLineIncludesVia: true,
              via: 'cart_items',
            },
            {
              domain: 'product',
              keys: 'arg:productId',
              predicate: 'eq',
              sitePath: 'src/cart.ts',
              sourceLineIncludesVia: true,
              via: 'products',
            },
          ],
          unresolved: [],
        },
      });
      expect(touchGraphSourceSiteSummaryFact(touchGraph)).toEqual({
        count: 2,
        linesArePositive: true,
        paths: ['src/cart.ts'],
      });
      const provenance = await touchGraphProvenanceFact(root, touchGraph);

      expect(provenance).toEqual({
        entries: {
          'cart.addItem': {
            reads: [],
            touches: [
              {
                domain: 'cart',
                keys: null,
                predicate: undefined,
                sitePath: 'src/cart.ts',
                via: 'cart_items',
              },
              {
                domain: 'product',
                keys: 'arg:productId',
                predicate: 'eq',
                sitePath: 'src/cart.ts',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
        siteSummary: {
          count: 2,
          linesArePositive: true,
          paths: ['src/cart.ts'],
        },
        sourceLineMismatches: [],
        unresolvedMutations: [],
      });
      expect(touchGraphProvenanceHonestyFact(provenance)).toEqual({
        entryKeys: ['cart.addItem'],
        sourceLineMismatches: [],
        sourceSites: {
          count: 2,
          linesArePositive: true,
          paths: ['src/cart.ts'],
        },
        touchCountsByMutation: {
          'cart.addItem': 2,
        },
        unresolvedMutations: [],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects touch graph facts that do not name a source site', async () => {
    await expect(
      touchGraphSourceFacts('/tmp/unused', {
        'cart.addItem': {
          touches: [{ domain: 'cart', via: 'cart_items' }],
        },
      }),
    ).rejects.toThrow('Touch graph fact includes a source site: cart.addItem cart');
  });
});
