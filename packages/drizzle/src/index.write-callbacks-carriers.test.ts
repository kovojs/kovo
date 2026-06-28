import { describe, expect, it } from 'vitest';

import { extractTouchGraphFromProject } from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle touch graph helpers', () => {
  it('extracts project direct typed receiver carrier members without fake sibling facts', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'query: any;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgAsyncDatabase<any, any>, fake: FakeDb) {',
            '  const carrier = { db, fake };',
            '  await carrier.db.execute("select 1");',
            '  await carrier.db.update(users).set({});',
            '  await carrier.db.query.users.findMany();',
            '  await carrier.fake.execute("select 1");',
            '  await carrier.fake.update(users).set({});',
            '  await carrier.fake.query.users.findMany();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:15',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:14',
            via: 'users',
          },
        ],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
        ],
      },
    });
  });

  it('extracts project spread-copied typed receiver carrier members without overridden fake facts', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'query: any;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgAsyncDatabase<any, any>, fake: FakeDb) {',
            '  const carrier = { db, fake };',
            '  const spread = { ...carrier };',
            '  const overwritten = { ...carrier, db: fake };',
            '  await spread.db.execute("select 1");',
            '  await spread.db.update(users).set({});',
            '  await spread.db.query.users.findMany();',
            '  await overwritten.db.execute("select 1");',
            '  await overwritten.db.update(users).set({});',
            '  await overwritten.db.query.users.findMany();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:17',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:16',
            via: 'users',
          },
        ],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:15',
          },
        ],
      },
    });
  });

  it('extracts project nested typed receiver carrier members without nested fake overrides', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'query: any;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgAsyncDatabase<any, any>, fake: FakeDb) {',
            '  const carrier = { db, fake };',
            '  const nested = { inner: carrier };',
            '  const overwritten = { ...nested, inner: { db: fake } };',
            '  const execute = nested.inner.db.execute;',
            '  await nested.inner.db.execute("select 1");',
            '  await nested.inner.db.update(users).set({});',
            '  await nested.inner.db.query.users.findMany();',
            '  await execute("select 1");',
            '  await audit(nested);',
            '  await audit(nested.inner.db);',
            '  await audit({ db: nested.inner.db });',
            '  await audit({ db: overwritten.inner.db });',
            '  await overwritten.inner.db.execute("select 1");',
            '  await overwritten.inner.db.update(users).set({});',
            '  await overwritten.inner.db.query.users.findMany();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:18',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [
          {
            domain: 'user',
            keys: null,
            site: 'cart.domain.ts:17',
            via: 'users',
          },
        ],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:20',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:21',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:22',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:19',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:16',
          },
        ],
      },
    });
  });

  it('uses project transaction callback receiver aliases from typed Drizzle origins', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'transaction<T>(callback: (tx: PgAsyncDatabase<TQueryResultHKT, TFullSchema>) => Promise<T>): Promise<T>;',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgAsyncDatabase } from "drizzle-orm/pg-core";

            interface FakeDb {
              insert(table: unknown): { values(value: unknown): Promise<void> };
              update(table: unknown): { set(value: unknown): Promise<void> };
              transaction<T>(callback: (tx: FakeDb) => Promise<T>): Promise<T>;
            }

            export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));

            export async function addItem(db: PgAsyncDatabase<any, any>, fake: FakeDb, queue: FakeDb[], productId: string) {
              await db.transaction(async (writer) => {
                await writer.insert(cartItems).values({ productId });
                queue.forEach(async (writer) => {
                  await writer.update(cartItems).set({ productId });
                });
              });
              await fake.transaction(async (shadow) => {
                await shadow.insert(cartItems).values({ productId });
              });
              queue.forEach(async (writer) => {
                await writer.update(cartItems).set({ productId });
              });
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
            site: 'cart.domain.ts:14',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('keeps writes visible through approved iteration callbacks and KV406s opaque callbacks', () => {
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

    expect(graph).toEqual({
      addItems: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:11',
            via: 'cart_items',
          },
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
          {
            domain: 'cart',
            keys: null,
            predicate: 'non-eq',
            site: 'cart.domain.ts:13',
            via: 'cart_items',
          },
        ],
        unresolved: [
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
        ],
      },
      saveItem: {
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

  it('uses typed receiver origins inside project domain write callbacks', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'export const cart = domain({',
            '  addItem: write(async (writer: PgAsyncDatabase<any, any>, db: FakeDb, productId: string) => {',
            '    await writer.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
            '    await db.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
            '  }),',
            '});',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'cart.domain.ts:11',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('extracts referenced project write callbacks from typed receiver symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(writer: PgAsyncDatabase<any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'export const cart = domain({',
            '  addItem: write({ touches: [cartItems] }, addItem),',
            '});',
            '',
          ].join('\n'),
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
            site: 'cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addItem': {
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

  it('marks opaque project domain action spreads as KV406 instead of dropping mutation surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'declare const dynamicActions: any;',
            'const staticActions = { addItem: write(addItem) };',
            '',
            'export const cart = domain({',
            '  ...staticActions,',
            '  ...dynamicActions,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:14',
          },
        ],
      },
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
      addItem: {
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

  it('extracts member-referenced project write callbacks from typed receiver symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'const callbacks = {',
            '  addItem(writer: PgAsyncDatabase<any, any>, db: FakeDb, productId: string) {',
            '    writer.insert(cartItems).values({ productId });',
            '    db.insert(cartItems).values({ productId });',
            '  },',
            '};',
            '',
            'export const cart = domain({',
            '  addItem: write(callbacks.addItem),',
            '});',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addItem': {
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

  it('extracts project write callbacks through static object aliases and spreads', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(writer: PgAsyncDatabase<any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            'function fakeAdd(db: FakeDb, productId: string) {',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'const base = { addItem };',
            'const alias = base;',
            'const spread = { ...base };',
            'const overridden = { ...base, addItem: fakeAdd };',
            '',
            'export const cart = domain({',
            '  addAliased: write(alias.addItem),',
            '  addSpread: write(spread["addItem"]),',
            '  addOverridden: write(overridden.addItem),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addAliased': {
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
      'cart.addSpread': {
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

  it('extracts project domain actions from static object aliases and degrades opaque aliases', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'declare const dynamicActions: any;',
            'const actions = { addItem: write(addItem) };',
            '',
            'export const cart = domain(actions);',
            'export const dynamicCart = domain(dynamicActions);',
          ].join('\n'),
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
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
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
      'dynamicCart.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
        ],
      },
    });
  });

  it('does not treat public string-keyed domain values as unresolved write actions', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'webhooks.ts',
          source: [
            'import { domain } from "@kovojs/server";',
            '',
            'export const paymentDomain = domain("payment");',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({});
  });

  it('marks direct opaque project domain action members as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'const addAction = write(addItem);',
            'declare const dynamicAction: unknown;',
            'const aliasActions = { aliased: addAction, opaque: dynamicAction };',
            '',
            'export const cart = domain({',
            '  addItem: addAction,',
            '  dynamic: dynamicAction,',
            '  method(db: PgAsyncDatabase<any, any>) {',
            '    return db.insert(cartItems).values({});',
            '  },',
            '  ...aliasActions,',
            '});',
          ].join('\n'),
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
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
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
      'cart.aliased': {
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
      'cart.dynamic': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:15',
          },
        ],
      },
      'cart.method': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:16',
          },
        ],
      },
      'cart.opaque': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
        ],
      },
    });
  });

  it('marks typed project domain action spread members as KV406 when no write callback is proven', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'declare const externalActions: {',
            '  addItem(db: PgAsyncDatabase<any, any>, productId: string): Promise<void>;',
            '};',
            '',
            'export const cart = domain({',
            '  ...externalActions,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:6',
          },
        ],
      },
    });
  });

  it('marks string-indexed project domain action spreads as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'type ActionBag = {',
            '  [name: string]: ReturnType<typeof write>;',
            '};',
            'declare const indexedActions: ActionBag;',
            '',
            'export const cart = domain({',
            '  ...indexedActions,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
        ],
      },
    });
  });

  it('extracts project write callbacks through nested static object aliases', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(writer: PgAsyncDatabase<any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            'function fakeAdd(db: FakeDb, productId: string) {',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'const base = { nested: { addItem } };',
            'const alias = base;',
            'const spread = { ...base };',
            'const overridden = { ...base, nested: { addItem: fakeAdd } };',
            '',
            'export const cart = domain({',
            '  addAliased: write(alias.nested.addItem),',
            '  addSpread: write(spread["nested"]["addItem"]),',
            '  addOverridden: write(overridden.nested.addItem),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addAliased': {
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
      'cart.addSpread': {
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

  it('does not fabricate referenced project write callbacks from untyped receiver names', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'cart.domain.ts',
          source: [
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(db, productId) {',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'export const cart = domain({',
            '  addItem: write(addItem),',
            '});',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({});
  });

  it('extracts imported project write callbacks through ts-morph aliases', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'schema.ts',
          source: [
            'export const cartItems = pgTable("cart_items", {',
            '  productId: text("product_id").primaryKey(),',
            '}, kovo({ domain: "cart", key: "productId" }));',
          ].join('\n'),
        },
        {
          fileName: 'callbacks.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'import { cartItems } from "./schema";',
            '',
            'export async function addItem(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  await db.insert(cartItems).values({ productId });',
            '}',
          ].join('\n'),
        },
        {
          fileName: 'cart.domain.ts',
          source: [
            'import { addItem } from "./callbacks";',
            '',
            'export const cart = domain({',
            '  addItem: write(addItem),',
            '});',
          ].join('\n'),
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
            site: 'callbacks.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addItem': {
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

  it('marks opaque conditional project domain action spread branches as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'declare const useDynamic: boolean;',
            'declare const dynamicActions: any;',
            'const staticActions = { addItem: write(addItem) };',
            '',
            'export const cart = domain({',
            '  ...(useDynamic ? dynamicActions : staticActions),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:14',
          },
        ],
      },
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
      addItem: {
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

  it('extracts direct conditional domain action members and degrades opaque branches', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
            '',
            'function addItem(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'declare const useDynamic: boolean;',
            'declare const dynamicAction: any;',
            '',
            'export const cart = domain({',
            '  add: useDynamic ? dynamicAction : write(addItem),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'cart.add': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:6',
            via: 'cart_items',
          },
        ],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
        ],
      },
      addItem: {
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

  it('extracts exported namespace project domain action spreads from write variables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'schema.ts',
          source: [
            'export const cartItems = pgTable("cart_items", {',
            '  productId: text("product_id").primaryKey(),',
            '}, kovo({ domain: "cart", key: "productId" }));',
          ].join('\n'),
        },
        {
          fileName: 'actions.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'import { cartItems } from "./schema";',
            '',
            'function addItem(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'export const addItemAction = write(addItem);',
            'export declare const hiddenAction: unknown;',
          ].join('\n'),
        },
        {
          fileName: 'cart.domain.ts',
          source: [
            'import * as CartActions from "./actions";',
            '',
            'export const cart = domain({',
            '  ...CartActions,',
            '});',
          ].join('\n'),
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
            site: 'actions.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:4',
          },
        ],
      },
      'cart.addItemAction': {
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

  it('extracts namespace-imported project write callback containers through barrels', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'schema.ts',
          source: [
            'export const cartItems = pgTable("cart_items", {',
            '  productId: text("product_id").primaryKey(),',
            '}, kovo({ domain: "cart", key: "productId" }));',
          ].join('\n'),
        },
        {
          fileName: 'callbacks.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'import { cartItems } from "./schema";',
            '',
            'function addItem(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'export const callbacks = { addItem };',
          ].join('\n'),
        },
        {
          fileName: 'barrel.ts',
          source: ['export { callbacks } from "./callbacks";'].join('\n'),
        },
        {
          fileName: 'cart.domain.ts',
          source: [
            'import * as CallbackBarrel from "./barrel";',
            '',
            'export const cart = domain({',
            '  addItem: write(CallbackBarrel.callbacks["addItem"]),',
            '});',
          ].join('\n'),
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
            site: 'callbacks.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addItem': {
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
});
