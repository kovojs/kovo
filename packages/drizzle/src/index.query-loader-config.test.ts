import { describe, expect, it } from 'vitest';

import {
  diagnosticsForQueryFacts,
  extractTouchGraphFromProject,
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

const extractQueryFactsFromProject = (
  options: Parameters<typeof extractQueryFactsFromProjectBase>[0],
) => extractQueryFactsFromProjectBase(withPgDatabaseTypes(options));

describe('@kovojs/drizzle touch graph helpers', () => {
  it('marks project query-loader writes as KV406 instead of dropping the query fact', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: `
            export const products = pgTable("products", {
              id: text("id").primaryKey(),
            }, kovo({ domain: "product", key: "id" }));

            export const productQuery = query("product/write", {
              async load(_input, db: PgDatabase) {
                await db.update(products).set({ id: "p1" });
                return [];
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual([
      {
        diagnostics: [
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db.update().',
            severity: 'warn',
            site: 'product.queries.ts:6',
          },
        ],
        query: 'product/write',
        reads: [],
        shape: {},
        site: 'product.queries.ts:6',
      },
    ]);
  });

  it('extracts project shorthand query-loader functions through typed receiver symbols', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'function load(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'export const productQuery = query("product/shorthand-loader", {',
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
          stock: 'number',
        },
        site: 'product.queries.ts:12',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('extracts project member-referenced query-loader functions through typed receiver symbols', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'const loaders = {',
            '  product(_input: unknown, db: PgDatabase<any, any, any>) {',
            '    return db.select({ id: products.id, stock: products.stock }).from(products);',
            '  },',
            '};',
            '',
            'export const productQuery = query("product/member-loader", {',
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
          stock: 'number',
        },
        site: 'product.queries.ts:14',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('extracts project query-loader callbacks through static object aliases and spreads', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  select(): { from(table: unknown): Promise<unknown> };',
            '}',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id }).from(products);',
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
            'export const aliasedQuery = query("product/project-object-alias-loader", {',
            '  load: alias.loadProducts,',
            '});',
            '',
            'export const spreadQuery = query("product/project-object-spread-loader", {',
            '  load: spread["loadProducts"],',
            '});',
            '',
            'export const overriddenQuery = query("product/project-overridden-object-spread-loader", {',
            '  load: overridden.loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/project-object-alias-loader',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.queries.ts:23',
      },
      {
        query: 'product/project-object-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.queries.ts:27',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('extracts project query loaders from static config spreads and degrades obscuring spreads', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const dynamicConfig: any;',
            'const base = { load: loadProducts };',
            'const spread = { ...base };',
            '',
            'export const spreadQuery = query("product/project-config-spread-loader", {',
            '  ...spread,',
            '});',
            '',
            'export const obscuredQuery = query("product/project-config-obscured-loader", {',
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
            severity: 'warn',
            site: 'product.queries.ts:20',
          },
        ],
        query: 'product/project-config-obscured-loader',
        reads: [],
        shape: {},
        site: 'product.queries.ts:20',
      },
      {
        query: 'product/project-config-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:16',
      },
    ]);
  });

  it('marks string-indexed project query config spreads as KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'type LoaderConfig = {',
            '  [name: string]: (input: unknown, db: PgDatabase<any, any, any>) => Promise<unknown[]>;',
            '};',
            'declare const indexedConfig: LoaderConfig;',
            '',
            'export const indexedQuery = query("product/project-indexed-config-loader", {',
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
            severity: 'warn',
            site: 'product.queries.ts:12',
          },
        ],
        query: 'product/project-indexed-config-loader',
        reads: [],
        shape: {},
        site: 'product.queries.ts:12',
      },
    ]);
  });

  it('extracts project query loaders from conditional config spreads and degrades opaque branches', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const useDynamic: boolean;',
            'declare const dynamicConfig: any;',
            'const staticConfig = { load: loadProducts };',
            '',
            'export const productQuery = query("product/project-conditional-config-spread-loader", {',
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
            severity: 'warn',
            site: 'product.queries.ts:16',
          },
        ],
        query: 'product/project-conditional-config-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:16',
      },
    ]);
  });

  it('extracts project query loaders from conditional option objects and degrades opaque branches', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const useDynamic: boolean;',
            'declare const dynamicConfig: any;',
            'const staticConfig = { load: loadProducts };',
            '',
            'export const productQuery = query("product/project-conditional-options-loader",',
            '  useDynamic ? dynamicConfig : staticConfig,',
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
            severity: 'warn',
            site: 'product.queries.ts:16',
          },
        ],
        query: 'product/project-conditional-options-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:16',
      },
    ]);
  });

  it('extracts project query loaders from direct conditional load members', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const useDynamic: boolean;',
            'declare const dynamicLoad: any;',
            '',
            'export const productQuery = query("product/project-conditional-load-member", {',
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
            severity: 'warn',
            site: 'product.queries.ts:15',
          },
        ],
        query: 'product/project-conditional-load-member',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:15',
      },
    ]);
  });

  it('extracts project query loaders from static external config objects and degrades unresolved configs', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
            '}',
            '',
            'declare const dynamicConfig: any;',
            'const baseConfig = { load: loadProducts };',
            'const configAlias = baseConfig;',
            'export const configQuery = query("product/project-external-config-loader", configAlias);',
            'export const dynamicQuery = query("product/project-dynamic-config-loader", dynamicConfig);',
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
            severity: 'warn',
            site: 'product.queries.ts:16',
          },
        ],
        query: 'product/project-dynamic-config-loader',
        reads: [],
        shape: {},
        site: 'product.queries.ts:16',
      },
      {
        query: 'product/project-external-config-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:15',
      },
    ]);
  });

  it('extracts project domain actions from static config spreads and degrades unresolved callbacks', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            'function fakeAdd(db: FakeDb, productId: string) {',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'declare const actionName: string;',
            'const callbacks = { addItem };',
            'const base = {',
            '  addItem: write(addItem),',
            '  unresolved: write(callbacks[actionName]),',
            '};',
            'const spread = { ...base };',
            'const overridden = { ...base, addItem: write(fakeAdd) };',
            '',
            'export const cart = domain({',
            '  ...spread,',
            '  addDirect: write(addItem),',
            '  ...overridden,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addDirect': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.unresolved': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:21',
          },
        ],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts project query-loader callbacks through nested static object aliases', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, stock: products.stock }).from(products);',
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
            'export const aliasedQuery = query("product/project-nested-object-alias-loader", {',
            '  load: alias.nested.loadProducts,',
            '});',
            '',
            'export const spreadQuery = query("product/project-nested-object-spread-loader", {',
            '  load: spread["nested"]["loadProducts"],',
            '});',
            '',
            'export const overriddenQuery = query("product/project-overridden-nested-object-loader", {',
            '  load: overridden.nested.loadProducts,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts).toEqual([
      {
        query: 'product/project-nested-object-alias-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:20',
      },
      {
        query: 'product/project-nested-object-spread-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.queries.ts:24',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('extracts project query loaders and domain actions from static property declarations', () => {
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
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
          '  return db.update(products).set({ id: productId }).where(eq(products.id, productId));',
          '}',
          '',
          'class ProductLoaders {',
          '  static loadProduct = (_input: unknown, db: PgDatabase<any, any, any>) => {',
          '    return db.select({ id: products.id }).from(products);',
          '  };',
          '  static options = { load: ProductLoaders.loadProduct };',
          '}',
          '',
          'class ProductActions {',
          '  static add = write(addItem);',
          '  static actions = { add: ProductActions.add };',
          '}',
          '',
          'export const productDomain = domain(ProductActions.actions);',
          '',
          'export const productQuery = query("product/static-property-loader", ProductLoaders.options);',
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
        query: 'product/static-property-loader',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.domain.ts:26',
      },
    ]);
  });

  it('extracts project query loaders and domain actions from static accessors', () => {
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
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'class ProductLoaders {',
          '  static get loadProduct() {',
          '    return (_input: unknown, db: PgDatabase<any, any, any>) => {',
          '      return db.select({ id: products.id, stock: products.stock }).from(products);',
          '    };',
          '  }',
          '  static get options() {',
          '    return { load: ProductLoaders.loadProduct };',
          '  }',
          '}',
          '',
          'class ProductActions {',
          '  static get add() {',
          '    return write((db: PgDatabase<any, any, any>, productId: string) => {',
          '      return db.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '    });',
          '  }',
          '  static get actions() {',
          '    return { add: ProductActions.add };',
          '  }',
          '}',
          '',
          'export const productDomain = domain(ProductActions.actions);',
          '',
          'export const productQuery = query("product/static-accessor-loader", ProductLoaders.options);',
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
            site: 'product.domain.ts:23',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/static-accessor-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:33',
      },
    ]);
  });

  it('extracts project callbacks through destructured static callback containers', () => {
    const files = [
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
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
          'export const productQuery = query("product/destructured-callback-container", {',
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
            site: 'product.domain.ts:9',
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
            site: 'product.domain.ts:13',
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
            site: 'product.domain.ts:9',
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
        site: 'product.domain.ts:25',
      },
    ]);
  });

  it('extracts project callbacks through tuple-destructured static callback containers', () => {
    const files = [
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
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
          'export const productQuery = query("product/tuple-destructured-callback-container", {',
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
            site: 'product.domain.ts:9',
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
            site: 'product.domain.ts:13',
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
            site: 'product.domain.ts:9',
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
        site: 'product.domain.ts:25',
      },
    ]);
  });

  it('extracts project callbacks and configs through tuple-indexed static containers', () => {
    const files = [
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
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
          'const queryConfigs = [{ load: callbackTuples[1][0].loadProducts }] as const;',
          '',
          'export const productDomain = domain(actionConfigs[0]);',
          '',
          'export const productQuery = query("product/tuple-indexed-config", queryConfigs[0]);',
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
      loadProducts: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:13',
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
            site: 'product.domain.ts:9',
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
        site: 'product.domain.ts:22',
      },
    ]);
  });

  it('extracts imported project query-loader callbacks through ts-morph aliases', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'schema.ts',
          source: [
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  name: text("name").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
          ].join('\n'),
        },
        {
          fileName: 'loaders.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { products } from "./schema";',
            '',
            'export function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            'export const loaders = { loadProducts };',
          ].join('\n'),
        },
        {
          fileName: 'product.queries.ts',
          source: [
            'import { loadProducts, loaders } from "./loaders";',
            '',
            'export const productQuery = query("product/imported-loader", {',
            '  load: loadProducts,',
            '});',
            '',
            'export const memberQuery = query("product/imported-member-loader", {',
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
        site: 'product.queries.ts:3',
      },
      {
        query: 'product/imported-member-loader',
        reads: ['product'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'product.queries.ts:7',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });

  it('extracts namespace-imported project query-loader callback containers through barrels', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'schema.ts',
          source: [
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  name: text("name").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
          ].join('\n'),
        },
        {
          fileName: 'loaders.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { products } from "./schema";',
            '',
            'function loadProducts(_input: unknown, db: PgDatabase<any, any, any>) {',
            '  return db.select({ id: products.id, name: products.name }).from(products);',
            '}',
            '',
            'export const loaders = { loadProducts };',
          ].join('\n'),
        },
        {
          fileName: 'barrel.ts',
          source: ['export { loaders } from "./loaders";'].join('\n'),
        },
        {
          fileName: 'product.queries.ts',
          source: [
            'import * as LoaderBarrel from "./barrel";',
            '',
            'export const productQuery = query("product/namespace-barrel-loader", {',
            '  load: LoaderBarrel.loaders["loadProducts"],',
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
        site: 'product.queries.ts:3',
      },
    ]);
    expect(diagnosticsForQueryFacts(facts)).toEqual([]);
  });
});
