import { describe, expect, it } from 'vitest';

import {
  diagnosticsForQueryFacts,
  diagnosticsForTouchGraph,
  extractTouchGraphFromProject,
} from '../../../packages/drizzle/src/static.js';

import { extractQueryFactsFromProject } from './test-helpers.js';

describe('Drizzle pinned subset conformance', () => {
  it('pins destructured static callback containers under real Drizzle Postgres receiver types', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
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
          "export const productQuery = query('product/destructured-callback-container', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:13',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
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
        site: 'conformance/drizzle-pin/src/product.domain.ts:25',
      },
    ]);
  });

  it('pins tuple-destructured static callback containers under real Drizzle Postgres receiver types', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
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
          "export const productQuery = query('product/tuple-destructured-callback-container', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:13',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
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
        site: 'conformance/drizzle-pin/src/product.domain.ts:25',
      },
    ]);
  });

  it('pins tuple-indexed static callback configs under real Drizzle Postgres receiver types', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  stock: integer('stock').notNull(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
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
          "const queryConfigs = [{ access: publicAccess('drizzle conformance query fixture has no runtime guard'), load: callbackTuples[1][0].loadProducts }] as const;",
          '',
          'export const productDomain = domain(actionConfigs[0]);',
          '',
          "export const productQuery = query('product/tuple-indexed-config', { access: publicAccess('drizzle conformance query fixture has no runtime guard'), ...queryConfigs[0] });",
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:13',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:9',
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
        site: 'conformance/drizzle-pin/src/product.domain.ts:22',
      },
    ]);
  });

  it('pins unresolved dynamic callback references as KV406 under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id }).from(products);',
          '}',
          '',
          'declare const actionName: string;',
          'declare const loaderName: string;',
          'const callbacks = { addItem };',
          'const loaders = { loadProducts };',
          '',
          'export const productDomain = domain({',
          '  add: write(callbacks[actionName]),',
          '});',
          '',
          "export const productQuery = query('product/unresolved-dynamic-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
          '  load: loaders[loaderName],',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [],
        unresolved: [],
      },
      'productDomain.add': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:21',
          },
        ],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.domain.ts:24',
          },
        ],
        query: 'product/unresolved-dynamic-loader',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.domain.ts:24',
      },
    ]);
  });

  it('pins static computed query loaders and domain actions under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          "const loadKey = 'load';",
          "const addKey = 'add';",
          "const keyBag = { restock: 'restock' } as const;",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'export const productDomain = domain({',
          '  [addKey]: write(addItem),',
          '  [keyBag.restock]: write(addItem),',
          '});',
          '',
          "export const productQuery = query('product/static-computed-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:12',
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
        site: 'conformance/drizzle-pin/src/product.domain.ts:20',
      },
    ]);
  });

  it('pins unresolved computed query loaders and domain actions as KV406 under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'declare const actionKey: string;',
          'declare const loadKey: string;',
          '',
          'function addItem(db: PgDatabase<any, any, any>) {',
          '  db.update(products).set({});',
          '}',
          '',
          'export const productDomain = domain({',
          '  [actionKey]: write(addItem),',
          '});',
          '',
          "export const productQuery = query('product/unresolved-computed-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:11',
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
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:15',
          },
        ],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.domain.ts:18',
          },
        ],
        query: 'product/unresolved-computed-loader',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.domain.ts:18',
      },
    ]);
  });

  it('pins opaque domain action spreads as KV406 under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'declare const dynamicActions: any;',
          'const staticActions = { add: write(addItem) };',
          '',
          'export const productDomain = domain({',
          '  ...staticActions,',
          '  ...dynamicActions,',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      'productDomain.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:16',
          },
        ],
      },
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins direct opaque domain action members as KV406 under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'const addAction = write(addItem);',
          'declare const dynamicAction: unknown;',
          'const actionBag = { aliased: addAction, opaque: dynamicAction };',
          '',
          'export const productDomain = domain({',
          '  add: addAction,',
          '  dynamic: dynamicAction,',
          '  method(db: PgDatabase<any, any, any>) {',
          '    db.update(products).set({});',
          '  },',
          '  ...actionBag,',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      'productDomain.aliased': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      'productDomain.dynamic': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:17',
          },
        ],
      },
      'productDomain.method': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:18',
          },
        ],
      },
      'productDomain.opaque': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:13',
          },
        ],
      },
    });
  });

  it('pins conditional domain action spreads under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'declare const useDynamic: boolean;',
          'declare const dynamicActions: any;',
          'const staticActions = { add: write(addItem) };',
          '',
          'export const productDomain = domain({',
          '  ...(useDynamic ? dynamicActions : staticActions),',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      'productDomain.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:16',
          },
        ],
      },
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins direct conditional domain action members under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'declare const useDynamic: boolean;',
          'declare const dynamicAction: any;',
          '',
          'export const productDomain = domain({',
          '  add: useDynamic ? dynamicAction : write(addItem),',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:15',
          },
        ],
      },
    });
  });
});
