import { describe, expect, it } from 'vitest';

import {
  extractTouchGraphFromProject,
  extractQueryFactsFromProject,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle touch graph helpers', () => {
  it('uses project typed destructured receiver bindings without fake context fabrication', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface FakeContext { db: FakeDb }',
          'interface DrizzleContext { db: PgAsyncDatabase<any, any> }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct({ db: writer }: DrizzleContext, fake: FakeContext, productId: string) {',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fake.db.update(products).set({ stock: 2 });',
          '}',
          '',
          'export async function fakeSync({ db }: FakeContext) {',
          '  await db.update(products).set({ stock: 3 });',
          '}',
          '',
          'export const productQuery = query("product/destructured", {',
          '  load(_input, { db }: DrizzleContext, fake: FakeContext) {',
          '    fake.db.select({ id: products.id }).from(products);',
          '    return db.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:16',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/destructured',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:24',
      },
    ]);
  });

  it('uses project typed body-local receiver aliases without fake context fabrication', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface FakeContext { db: FakeDb }',
          'interface DrizzleContext { db: PgAsyncDatabase<any, any> }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  const { db: writer } = context;',
          '  const { db: fakeWriter } = fake;',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 2 });',
          '}',
          '',
          'export const productQuery = query("product/body-local-alias", {',
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    const { db: reader } = context;',
          '    const { db: fakeReader } = fake;',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:18',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/body-local-alias',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:22',
      },
    ]);
  });

  it('uses project member-referenced local query helpers from typed receiver symbols', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): Promise<void> };',
      ]),
      {
        fileName: 'product.queries.ts',
        source: [
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'function loadProducts(db: PgAsyncDatabase<any, any>) {',
          '  return db.select({ id: products.id, stock: products.stock }).from(products);',
          '}',
          '',
          'function fakeLoad(fake: FakeDb) {',
          '  return fake.select({ id: products.id }).from(products);',
          '}',
          '',
          'const helpers = { loadProducts, fakeLoad };',
          '',
          'export const productQuery = query("product/member-local-helper", {',
          '  load(_input, db: PgAsyncDatabase<any, any>, fake: FakeDb) {',
          '    helpers.fakeLoad(fake);',
          '    return helpers.loadProducts(db);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/member-local-helper',
        reads: ['product'],
        shape: {},
        site: 'product.queries.ts:23',
      },
    ]);
  });

  it('uses project member-referenced local mutation helpers from typed receiver symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'function touchProduct(db: PgAsyncDatabase<any, any>) {',
            '  return db.update(products).set({ stock: 1 });',
            '}',
            '',
            'function fakeTouch(fake: FakeDb) {',
            '  return fake.update(products).set({ stock: 2 });',
            '}',
            '',
            'const helpers = { touchProduct, fakeTouch };',
            '',
            'export async function syncProduct(db: PgAsyncDatabase<any, any>, fake: FakeDb) {',
            '  await helpers.fakeTouch(fake);',
            '  await helpers.touchProduct(db);',
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
            site: 'product.domain.ts:13',
            via: 'products',
          },
        ],
        unresolved: [],
      },
      touchProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:13',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('uses project inline object-member local helpers from typed receiver symbols', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): Promise<void> };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'const helpers = {',
          '  loadProducts(db: PgAsyncDatabase<any, any>) {',
          '    return db.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '  touchProduct: async (db: PgAsyncDatabase<any, any>) => {',
          '    await db.update(products).set({ stock: 1 });',
          '  },',
          '  fakeLoad(fake: FakeDb) {',
          '    return fake.select({ id: products.id }).from(products);',
          '  },',
          '  fakeTouch: async (fake: FakeDb) => {',
          '    await fake.update(products).set({ stock: 2 });',
          '  },',
          '};',
          '',
          'export const productQuery = query("product/inline-member-local-helper", {',
          '  load(_input, db: PgAsyncDatabase<any, any>, fake: FakeDb) {',
          '    helpers.fakeLoad(fake);',
          '    return helpers.loadProducts(db);',
          '  },',
          '});',
          '',
          'export async function syncProduct(db: PgAsyncDatabase<any, any>, fake: FakeDb) {',
          '  await helpers.fakeTouch(fake);',
          '  await helpers.touchProduct(db);',
          '}',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/inline-member-local-helper',
        reads: ['product'],
        shape: {},
        site: 'product.domain.ts:28',
      },
    ]);
    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            site: 'product.domain.ts:18',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('uses project assignment receiver aliases without fake context fabrication', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(db: PgAsyncDatabase<any, any>, fake: FakeDb, productId: string) {',
          '  let writer;',
          '  writer = db;',
          '  let fakeWriter;',
          '  fakeWriter = fake;',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 2 });',
          '}',
          '',
          'export const productQuery = query("product/assignment-alias", {',
          '  load(_input, db: PgAsyncDatabase<any, any>, fake: FakeDb) {',
          '    let reader;',
          '    reader = db;',
          '    let fakeReader;',
          '    fakeReader = fake;',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:18',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/assignment-alias',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:22',
      },
    ]);
  });

  it('uses project destructuring assignment receiver aliases from typed contexts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface FakeContext { db: FakeDb }',
          'interface DrizzleContext { db: PgAsyncDatabase<any, any> }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  let writer;',
          '  ({ db: writer } = context);',
          '  let fakeWriter;',
          '  ({ db: fakeWriter } = fake);',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 2 });',
          '}',
          '',
          'export const productQuery = query("product/destructuring-assignment", {',
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    let reader;',
          '    ({ db: reader } = context);',
          '    let fakeReader;',
          '    ({ db: fakeReader } = fake);',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:20',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/destructuring-assignment',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:24',
      },
    ]);
  });

  it('uses project nested destructuring assignment receiver aliases from typed contexts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface FakeContext { nested: { db: FakeDb } }',
          'interface DrizzleContext { nested: { db: PgAsyncDatabase<any, any> } }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  let writer;',
          '  ({ nested: { db: writer } } = context);',
          '  let fakeWriter;',
          '  ({ nested: { db: fakeWriter } } = fake);',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 2 });',
          '}',
          '',
          'export const productQuery = query("product/nested-destructuring-assignment", {',
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    let reader;',
          '    ({ nested: { db: reader } } = context);',
          '    let fakeReader;',
          '    ({ nested: { db: fakeReader } } = fake);',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:20',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/nested-destructuring-assignment',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:24',
      },
    ]);
  });

  it('uses project tuple receiver aliases from typed contexts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface DrizzleContext { receivers: [PgAsyncDatabase<any, any>, FakeDb]; nested: { tuple: [FakeDb, PgAsyncDatabase<any, any>] } }',
          'interface FakeContext { receivers: [FakeDb, FakeDb] }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  const [writer] = context.receivers;',
          '  let assignedWriter;',
          '  [, assignedWriter] = context.nested.tuple;',
          '  const [fakeWriter] = fake.receivers;',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await assignedWriter.update(products).set({ stock: 2 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 3 });',
          '}',
          '',
          'export const productQuery = query("product/tuple-receiver", {',
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    const [reader] = context.receivers;',
          '    let assignedReader;',
          '    [, assignedReader] = context.nested.tuple;',
          '    const [fakeReader] = fake.receivers;',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    assignedReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:20',
            via: 'products',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:21',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/tuple-receiver',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:25',
      },
    ]);
  });

  it('does not promote project rest destructuring containers to receiver aliases', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface DrizzleContext { receivers: [FakeDb, PgAsyncDatabase<any, any>]; writerRest: PgAsyncDatabase<any, any> }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(context: DrizzleContext, productId: string) {',
          '  const [, ...writerRest] = context.receivers;',
          '  const { ...objectRest } = context;',
          '  await writerRest.update(products).set({ stock: 0 });',
          '  await objectRest.update(products).set({ stock: 0 });',
          '  await writerRest[0].update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '}',
          '',
          'export const productQuery = query("product/rest-receiver", {',
          '  load(_input, context: DrizzleContext) {',
          '    const [, ...readerRest] = context.receivers;',
          '    const { ...objectRest } = context;',
          '    readerRest.select({ id: products.id }).from(products);',
          '    objectRest.select({ id: products.id }).from(products);',
          '    return readerRest[0].select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:19',
            via: 'products',
          },
        ],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:17',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:18',
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
              'Statically un-analyzable write site; manual touches required. Query uses project Drizzle receiver container surface readerRest.select().',
            severity: 'error',
            site: 'product.domain.ts:22',
          },
          {
            code: 'KV406',
            message:
              'Statically un-analyzable write site; manual touches required. Query uses project Drizzle receiver container surface objectRest.select().',
            severity: 'error',
            site: 'product.domain.ts:22',
          },
        ],
        query: 'product/rest-receiver',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:22',
      },
    ]);
  });

  it('uses project object-contained tuple assignment receiver aliases from typed contexts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'product.domain.ts',
        source: [
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'interface FakeDb {',
          '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
          '  update(table: unknown): { set(value: unknown): Promise<void> };',
          '}',
          'interface DrizzleContext { wrappers: { receivers: [PgAsyncDatabase<any, any>, FakeDb] } }',
          'interface FakeContext { wrappers: { receivers: [FakeDb, FakeDb] } }',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          '',
          'export async function syncProduct(context: DrizzleContext, fake: FakeContext, productId: string) {',
          '  let writer;',
          '  ({ wrappers: { receivers: [writer] } } = context);',
          '  let fakeWriter;',
          '  ({ wrappers: { receivers: [fakeWriter] } } = fake);',
          '  await writer.update(products).set({ stock: 1 }).where(eq(products.id, productId));',
          '  await fakeWriter.update(products).set({ stock: 2 });',
          '}',
          '',
          'export const productQuery = query("product/object-contained-tuple-assignment", {',
          '  load(_input, context: DrizzleContext, fake: FakeContext) {',
          '    let reader;',
          '    ({ wrappers: { receivers: [reader] } } = context);',
          '    let fakeReader;',
          '    ({ wrappers: { receivers: [fakeReader] } } = fake);',
          '    fakeReader.select({ id: products.id }).from(products);',
          '    return reader.select({ id: products.id, stock: products.stock }).from(products);',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:20',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'product/object-contained-tuple-assignment',
        reads: ['product'],
        shape: {
          id: 'string',
          stock: 'number',
        },
        site: 'product.domain.ts:24',
      },
    ]);
  });
});
