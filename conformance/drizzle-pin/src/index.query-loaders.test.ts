import { describe, expect, it } from 'vitest';

import {
  diagnosticsForQueryFacts,
  extractTouchGraphFromProject,
} from '../../../packages/drizzle/src/static.js';

import { extractQueryFactsFromProject } from './test-helpers.js';

describe('Drizzle pinned subset conformance', () => {
  it('does not fabricate project query facts from untyped query-loader receiver names', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';

            export const products = pgTable('products', {
              id: text('id').primaryKey(),
            }, kovo({ domain: 'product', key: 'id' }));

            export const productQuery = query('product/untyped-db', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),
              load(_input, db) {
                db.update(products);
                return db.select({ id: products.id }).from(products);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([]);
  });

  it('pins project query-loader destructuring as KV406 without fabricated reads', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            "export const fakeQuery = query('product/destructured-fake', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load(_input, { fake }) {',
            '    return fake.select({ id: products.id }).from(products);',
            '  },',
            '});',
            '',
            "export const productQuery = query('product/destructured-db', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load(_input, { db: reader }) {',
            '    return reader.select({ id: products.id }).from(products);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses an un-provable destructured Drizzle receiver surface select() without project type proof.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:13',
          },
        ],
        query: 'product/destructured-db',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:13',
      },
    ]);
  });

  it('pins quoted project query-loader destructuring as KV406 without fabricated reads', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            "export const productQuery = query('product/quoted-destructured-db', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load(_input, { "db": reader }) {',
            '    return reader.select({ id: products.id }).from(products);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses an un-provable destructured Drizzle receiver surface select() without project type proof.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:7',
          },
        ],
        query: 'product/quoted-destructured-db',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:7',
      },
    ]);
  });

  it('pins local query-loader helper reads under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(db: PgDatabase<any, any, any>) {',
            '  return db.select({ name: products.name }).from(products);',
            '}',
            '',
            "export const productQuery = query('product/local-helper', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load(_input, db: PgDatabase<any, any, any>) {',
            '    return loadProducts(db);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/local-helper',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins local query-loader helper carrier reads under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts({ db }: { db: PgDatabase<any, any, any> }) {',
            '  return db.select({ name: products.name }).from(products);',
            '}',
            '',
            "export const productQuery = query('product/local-carrier-helper', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load(_input, db: PgDatabase<any, any, any>) {',
            '    const context = { db };',
            '    return loadProducts(context);',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/local-carrier-helper',
        reads: ['product'],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins shorthand query-loader functions under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function load(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            "export const productQuery = query('product/shorthand-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/shorthand-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins bound query-loader and domain write callbacks under real Drizzle imports', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/product.domain.ts',
        source: [
          "import { eq } from 'drizzle-orm';",
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          '',
          "export const products = pgTable('products', {",
          "  id: text('id').primaryKey(),",
          "  name: text('name').notNull(),",
          "}, kovo({ domain: 'product', key: 'id' }));",
          '',
          'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: products.id, name: products.name }).from(products);',
          '}',
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'declare const fakeDb: PgDatabase<any, any, any>;',
          '',
          "export const productQuery = query('product/bound-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
          '  load: loadProducts.bind(undefined),',
          '});',
          '',
          "export const unsafeQuery = query('product/prebound-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
          "  load: loadProducts.bind(undefined, { productId: 'p1' }),",
          '});',
          '',
          'export const productDomain = domain({',
          '  add: write(addItem.bind(null)),',
          '  unsafe: write(addItem.bind(null, fakeDb)),',
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
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.domain.ts:19',
      },
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.domain.ts:23',
          },
        ],
        query: 'product/prebound-loader',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.domain.ts:23',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      'productDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:14',
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
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/product.domain.ts:29',
          },
        ],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/product.domain.ts:14',
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
            site: 'conformance/drizzle-pin/src/product.domain.ts:10',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
  });

  it('pins imported query-loader callbacks under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: [
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
          ].join('\n'),
        },
        {
          fileName: 'conformance/drizzle-pin/src/loaders.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { products } from './schema';",
            '',
            'export function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            'export const loaders = { loadProducts };',
          ].join('\n'),
        },
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import { loadProducts, loaders } from './loaders';",
            '',
            "export const productQuery = query('product/imported-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: loadProducts,',
            '});',
            '',
            "export const memberQuery = query('product/imported-member-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: loaders.loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/imported-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:3',
      },
      {
        query: 'product/imported-member-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:7',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins namespace-imported query-loader callback containers through barrels', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: [
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
          ].join('\n'),
        },
        {
          fileName: 'conformance/drizzle-pin/src/loaders.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { products } from './schema';",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            'export const loaders = { loadProducts };',
          ].join('\n'),
        },
        {
          fileName: 'conformance/drizzle-pin/src/barrel.ts',
          source: ["export { loaders } from './loaders';"].join('\n'),
        },
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import * as LoaderBarrel from './barrel';",
            '',
            "export const productQuery = query('product/namespace-barrel-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            "  load: LoaderBarrel.loaders['loadProducts'],",
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/namespace-barrel-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:3',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins member-referenced query-loader functions under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'const loaders = {',
            '  product(_input: unknown, db: PgDatabase<any, any, any>) {',
            '    return db.select({ id: products.id, name: products.name }).from(products);',
            '  },',
            '};',
            '',
            "export const productQuery = query('product/member-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: loaders.product,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/member-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:14',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins member-referenced query-loader aliases under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            'const loaders = {',
            '  aliased: loadProducts,',
            '  loadProducts,',
            '};',
            '',
            "export const aliasedQuery = query('product/member-aliased-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: loaders.aliased,',
            '});',
            '',
            "export const shorthandQuery = query('product/member-shorthand-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: loaders.loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/member-aliased-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:17',
      },
      {
        query: 'product/member-shorthand-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:21',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins nested spread query-loader containers through real Drizzle type symbols', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            'function emptyLoad() {',
            '  return [];',
            '}',
            '',
            'const base = { nested: { loadProducts } };',
            'const alias = base;',
            'const spread = { ...base };',
            'const overridden = { ...base, nested: { loadProducts: emptyLoad } };',
            '',
            "export const aliasedQuery = query('product/nested-alias-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: alias.nested.loadProducts,',
            '});',
            '',
            "export const spreadQuery = query('product/nested-spread-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: spread["nested"]["loadProducts"],',
            '});',
            '',
            "export const overriddenQuery = query('product/nested-overridden-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: overridden.nested.loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/nested-alias-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:20',
      },
      {
        query: 'product/nested-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:24',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins static element-access query-loader aliases under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            'const loaders = {',
            '  aliased: loadProducts,',
            '  loadProducts,',
            '};',
            '',
            "export const aliasedQuery = query('product/static-member-aliased-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: loaders["aliased"],',
            '});',
            '',
            "export const shorthandQuery = query('product/static-member-shorthand-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: loaders["loadProducts"],',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/static-member-aliased-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:17',
      },
      {
        query: 'product/static-member-shorthand-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:21',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins object alias and spread query-loader callbacks under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  select(): { from(table: unknown): Promise<unknown> };',
            '}',
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  name: text('name').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            'function fakeLoad(_input: unknown, fake: FakeDb) {',
            '  return fake.select().from(products);',
            '}',
            '',
            'const base = { loadProducts };',
            'const alias = base;',
            'const spread = { ...base };',
            'const overridden = { ...base, loadProducts: fakeLoad };',
            '',
            "export const aliasedQuery = query('product/object-alias-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: alias.loadProducts,',
            '});',
            '',
            "export const spreadQuery = query('product/object-spread-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: spread["loadProducts"],',
            '});',
            '',
            "export const overriddenQuery = query('product/overridden-object-spread-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: overridden.loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/object-alias-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:24',
      },
      {
        query: 'product/object-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:28',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('pins query-loader config spreads under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  stock: integer('stock').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const dynamicConfig: any;',
            'const base = { load: loadProducts };',
            'const spread = { ...base };',
            '',
            "export const spreadQuery = query('product/config-spread-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  ...spread,',
            '});',
            '',
            "export const obscuredQuery = query('product/config-obscured-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: loadProducts,',
            '  ...dynamicConfig,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:20',
          },
        ],
        query: 'product/config-obscured-loader',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:20',
      },
      {
        query: 'product/config-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:16',
      },
    ]);
  });

  it('pins string-indexed query-loader config spreads as KV406 under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'type LoaderConfig = {',
            '  [name: string]: (input: unknown, db: PgDatabase<any, any, any>) => Promise<unknown[]>;',
            '};',
            'declare const indexedConfig: LoaderConfig;',
            '',
            "export const indexedQuery = query('product/indexed-config-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  ...indexedConfig,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:12',
          },
        ],
        query: 'product/indexed-config-loader',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:12',
      },
    ]);
  });

  it('pins conditional query-loader config spreads under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  stock: integer('stock').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const useDynamic: boolean;',
            'declare const dynamicConfig: any;',
            "const staticConfig = { access: publicAccess('drizzle conformance query fixture has no runtime guard'), load: loadProducts };",
            '',
            "export const productQuery = query('product/conditional-config-spread-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  ...(useDynamic ? dynamicConfig : staticConfig),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
        ],
        query: 'product/conditional-config-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:16',
      },
    ]);
  });

  it('pins conditional query-loader option objects under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  stock: integer('stock').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const useDynamic: boolean;',
            'declare const dynamicConfig: any;',
            'const staticConfig = { load: loadProducts };',
            '',
            "export const productQuery = query('product/conditional-options-loader',",
            "  { access: publicAccess('drizzle conformance query fixture has no runtime guard'), ...(useDynamic ? dynamicConfig : staticConfig) },",
            ');',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
        ],
        query: 'product/conditional-options-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:16',
      },
    ]);
  });

  it('pins direct conditional query-loader load members under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  stock: integer('stock').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const useDynamic: boolean;',
            'declare const dynamicLoad: any;',
            '',
            "export const productQuery = query('product/conditional-load-member', { access: publicAccess('drizzle conformance query fixture has no runtime guard'),",
            '  load: useDynamic ? dynamicLoad : loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:15',
          },
        ],
        query: 'product/conditional-load-member',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:15',
      },
    ]);
  });

  it('pins external query-loader config objects under real Drizzle imports', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/product.queries.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  stock: integer('stock').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const dynamicConfig: any;',
            "const baseConfig = { access: publicAccess('drizzle conformance query fixture has no runtime guard'), load: loadProducts };",
            'const configAlias = baseConfig;',
            "export const configQuery = query('product/external-config-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'), ...configAlias });",
            "export const dynamicQuery = query('product/dynamic-config-loader', { access: publicAccess('drizzle conformance query fixture has no runtime guard'), ...dynamicConfig });",
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'error',
            site: 'conformance/drizzle-pin/src/product.queries.ts:16',
          },
        ],
        query: 'product/dynamic-config-loader',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/product.queries.ts:16',
      },
      {
        query: 'product/external-config-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'conformance/drizzle-pin/src/product.queries.ts:15',
      },
    ]);
  });
});
