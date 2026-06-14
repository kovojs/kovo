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
  it('pins real Drizzle receiver types inside domain write callbacks', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'export const cart = domain({',
            '  addItem: write(async (writer: PgDatabase<any, any, any>, productId: string) => {',
            '    await writer.insert(cartItems).values({ productId });',
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
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins referenced domain write callbacks with real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'function addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
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

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins imported domain write callbacks with real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: [
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {",
            "  productId: text('product_id').primaryKey(),",
            "}, jiso({ domain: 'cart', key: 'productId' }));",
          ].join('\n'),
        },
        {
          fileName: 'conformance/drizzle-pin/src/callbacks.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { cartItems } from './schema';",
            '',
            'export function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
          ].join('\n'),
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import { addItem } from './callbacks';",
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
            site: 'conformance/drizzle-pin/src/callbacks.ts:5',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins namespace-imported domain write callback containers through barrels', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/schema.ts',
          source: [
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {",
            "  productId: text('product_id').primaryKey(),",
            "}, jiso({ domain: 'cart', key: 'productId' }));",
          ].join('\n'),
        },
        {
          fileName: 'conformance/drizzle-pin/src/callbacks.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { cartItems } from './schema';",
            '',
            'function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  return db.insert(cartItems).values({ productId });',
            '}',
            '',
            'export const callbacks = { addItem };',
          ].join('\n'),
        },
        {
          fileName: 'conformance/drizzle-pin/src/barrel.ts',
          source: ["export { callbacks } from './callbacks';"].join('\n'),
        },
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import * as CallbackBarrel from './barrel';",
            '',
            'export const cart = domain({',
            "  addItem: write(CallbackBarrel.callbacks['addItem']),",
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
            site: 'conformance/drizzle-pin/src/callbacks.ts:5',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:5',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins member-referenced domain write callbacks with real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'const callbacks = {',
            '  addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:11',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins member-referenced domain write callback aliases with real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'function addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'const callbacks = {',
            '  aliased: addItem,',
            '  addItem,',
            '};',
            '',
            'export const cart = domain({',
            '  addAliased: write(callbacks.aliased),',
            '  addShorthand: write(callbacks.addItem),',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addShorthand': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins nested spread domain write callback containers through real Drizzle type symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'function addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins static element-access domain write callback aliases with real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'function addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
            '  writer.insert(cartItems).values({ productId });',
            '  db.insert(cartItems).values({ productId });',
            '}',
            '',
            'const callbacks = {',
            '  aliased: addItem,',
            '  addItem,',
            '};',
            '',
            'export const cart = domain({',
            '  addAliased: write(callbacks["aliased"]),',
            '  addShorthand: write(callbacks["addItem"]),',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      'cart.addShorthand': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins object alias and spread domain write callbacks with real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'function addItem(writer: PgDatabase<any, any, any>, db: FakeDb, productId: string) {',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins domain action config spreads and unresolved callbacks under real Drizzle receiver types', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
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
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:21',
          },
        ],
      },
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/drizzle-pin/src/cart.domain.ts:10',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('pins real Drizzle receiver types with static element-access write methods', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/cart.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {}, jiso({ domain: 'cart', key: 'productId' }));",
            '',
            'export async function addItem(db: PgDatabase<any, any, any>, productId: string) {',
            '  await db["insert"](cartItems).values({ productId });',
            '  await db["update"](cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
            '}',
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
            site: 'conformance/drizzle-pin/src/cart.domain.ts:6',
            via: 'cart_items',
          },
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'conformance/drizzle-pin/src/cart.domain.ts:7',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });
});
