import { describe, expect, it } from 'vitest';

import {
  extractTouchGraphFromProject,
  extractQueryFactsFromProject,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle touch graph helpers', () => {
  it('extracts project configured write callbacks and folds local helper summaries', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";

            export const auditLog = pgTable("audit_log", {}, kovo({ domain: "audit", key: "productId" }));
            export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));

            const writeAudit = async (db: PgDatabase<any, any, any>, productId: string) => {
              await db.insert(auditLog).values({ productId });
            };

            export const cart = domain({
              addItem: write({ touches: [cartItems] }, async (db: PgDatabase<any, any, any>, productId: string) => {
                await db.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));
                await writeAudit(db, productId);
              }),
            });
          `,
        },
      ],
    });

    expect(graph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'audit',
            keys: null,
            site: 'cart.domain.ts:8',
            via: 'audit_log',
          },
          {
            domain: 'cart',
            keys: 'arg:productId',
            site: 'cart.domain.ts:13',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
      writeAudit: {
        reads: [],
        touches: [
          {
            domain: 'audit',
            keys: null,
            site: 'cart.domain.ts:8',
            via: 'audit_log',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('uses typed receiver origins instead of likely receiver names in project extraction', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";

            export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));

            interface FakeDb {
              insert(table: unknown): { values(value: unknown): Promise<void> };
            }

            export async function addItem(writer: PgDatabase, db: FakeDb, productId: string) {
              await writer.insert(cartItems).values({ productId });
              await db.insert(cartItems).values({ productId });
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
            site: 'cart.domain.ts:11',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('resolves project Drizzle alias table symbols for writes, reads, and query shapes', () => {
    const files = [
      {
        fileName: 'packages/drizzle/src/product.domain.ts',
        source: [
          'import { eq } from "drizzle-orm";',
          'import { alias, integer, pgTable, text, type PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const products = pgTable("products", {',
          '  id: text("id").primaryKey(),',
          '  stock: integer("stock").notNull(),',
          '}, kovo({ domain: "product", key: "id" }));',
          'const productAlias = alias(products, "p");',
          '',
          'export async function syncProduct(db: PgDatabase<any, any, any>, productId: string) {',
          '  await db.update(productAlias).set({ stock: 1 }).where(eq(productAlias.id, productId));',
          '  await db.select({ stock: productAlias.stock }).from(productAlias);',
          '}',
          '',
          'export const productQuery = query("product/alias", {',
          '  load(input, db: PgDatabase<any, any, any>) {',
          '    return db.select({ stock: productAlias.stock }).from(productAlias).where(eq(productAlias.id, input.id));',
          '  },',
          '});',
          '',
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'product',
            keys: null,
            site: 'packages/drizzle/src/product.domain.ts:12',
            source: 'select',
            via: 'products',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'packages/drizzle/src/product.domain.ts:11',
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
        query: 'product/alias',
        reads: ['product'],
        shape: {
          stock: 'number',
        },
        site: 'packages/drizzle/src/product.domain.ts:15',
      },
    ]);
  });

  it('does not fabricate project alias table facts from local alias helpers', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'product.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'function alias<T>(table: T): T { return table; }',
            'const productAlias = alias(products);',
            '',
            'export async function syncProduct(db: PgDatabase<any, any, any>) {',
            '  await db.update(productAlias).set({ stock: 1 });',
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
            site: 'product.domain.ts:8',
          },
        ],
      },
    });
  });

  it('marks project raw execute only for typed Drizzle receiver origins', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<void>;']),
        {
          fileName: 'cart.domain.ts',
          source: `
            import type { PgDatabase } from "drizzle-orm/pg-core";

            interface FakeDb {
              execute(query: unknown): Promise<void>;
            }

            export async function reconcile(writer: PgDatabase, client: FakeDb) {
              await writer.execute(sql\`update cart_items set synced = true\`);
              await writer['execute'](sql\`update cart_items set audited = true\`);
              await client.execute(sql\`update cart_items set synced = false\`);
              await client['execute'](sql\`update cart_items set audited = false\`);
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      reconcile: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:9',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:10',
          },
        ],
      },
    });
  });

  it('does not promote project receivers from PgDatabase-like type names', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<void>;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface PgDatabaseLike {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            'interface FakeContext { db: PgDatabaseLike }',
            'interface RealContext { db: PgDatabase }',
            '',
            'declare function audit(context: unknown): Promise<void>;',
            '',
            'export async function sync(fake: PgDatabaseLike, fakeContext: FakeContext, realContext: RealContext) {',
            '  await fake.execute("select 1");',
            '  await fakeContext.db.execute("select 1");',
            '  await audit({ db: fake });',
            '  await audit(fakeContext);',
            '  await realContext.db.execute("select 1");',
            '  await audit(realContext);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:17',
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

  it('marks project unresolved helper surfaces only for typed Drizzle receiver symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          '$count(table: unknown): Promise<number>;',
          'execute(query: unknown): Promise<void>;',
          'query: any;',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  $count(table: unknown): Promise<number>;',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '}',
            '',
            'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "id" }));',
            '',
            'declare const sendAudit: (receiver: unknown) => Promise<void>;',
            '',
            'export async function reconcile(db: PgDatabase, fake: FakeDb) {',
            '  await db.execute(sql`delete from cart_items`);',
            '  await fake.execute(sql`delete from cart_items`);',
            '  await sendAudit(db);',
            '  await sendAudit(fake);',
            '  await db.$count(cartItems);',
            '  await fake.$count(cartItems);',
            '  await db.query.cartItems.findMany();',
            '  await fake.query.cartItems.findMany();',
            '}',
            '',
            'export async function shadowed(db: FakeDb) {',
            '  await db.execute(sql`delete from cart_items`);',
            '  await sendAudit(db);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      reconcile: {
        reads: [
          {
            domain: 'cart',
            keys: null,
            site: 'cart.domain.ts:20',
            source: 'relational-query',
            via: 'cart_items',
          },
        ],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:16',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:14',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:18',
          },
        ],
      },
    });
  });

  it('marks project member helpers receiving typed Drizzle receivers as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'declare const auditServices: {',
            '  write(receiver: unknown): Promise<void>;',
            '};',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb) {',
            '  await auditServices.write(db);',
            '  await auditServices.write(fake);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:12',
          },
        ],
      },
    });
  });

  it('marks project helpers receiving typed Drizzle receivers through containers as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'declare const auditServices: {',
            '  write(context: unknown): Promise<void>;',
            '};',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb) {',
            '  await auditServices.write({ fake });',
            '  await auditServices.write({ db });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
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

  it('marks project helpers receiving assigned typed Drizzle carrier aliases as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  insert(table: unknown): { values(value: unknown): Promise<void> };',
            '}',
            '',
            'declare const auditServices: {',
            '  write(context: unknown): Promise<void>;',
            '};',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb) {',
            '  let context;',
            '  context = { db };',
            '  let fakeContext;',
            '  fakeContext = { db: fake };',
            '  await auditServices.write(fakeContext);',
            '  await auditServices.write(context);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:17',
          },
        ],
      },
    });
  });

  it('marks project helpers receiving typed Drizzle context containers as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface DrizzleContext { db: PgDatabase }',
            'interface FakeContext { db: unknown }',
            'declare function writeAudit(context: unknown): Promise<void>;',
            '',
            'export async function addItem(context: DrizzleContext, fake: FakeContext) {',
            '  await writeAudit({ fake });',
            '  await writeAudit({ context });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:9',
          },
        ],
      },
    });
  });

  it('marks project local helpers receiving typed Drizzle carrier aliases as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            '',
            'function writeAudit(context: unknown): Promise<void> {',
            '  return Promise.resolve(context);',
            '}',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb) {',
            '  const context = { db };',
            '  const fakeContext = { db: fake };',
            '  await writeAudit(fakeContext);',
            '  await writeAudit(context);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
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
    });
  });

  it('marks project local helpers receiving assigned typed Drizzle carrier aliases as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '}',
            '',
            'function writeAudit(context: unknown): Promise<void> {',
            '  return Promise.resolve(context);',
            '}',
            '',
            'export async function addItem(db: PgDatabase, fake: FakeDb) {',
            '  let context;',
            '  context = { db };',
            '  let fakeContext;',
            '  fakeContext = { db: fake };',
            '  await writeAudit(fakeContext);',
            '  await writeAudit(context);',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      addItem: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:17',
          },
        ],
      },
    });
  });

  it('marks project unknown direct receiver methods only for typed Drizzle symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          '$with(name: string): unknown;',
          'batch(queries: unknown[]): Promise<unknown[]>;',
          'findFirst(): Promise<unknown>;',
          'findMany(): Promise<unknown[]>;',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'interface FakeDb {',
            '  $with(name: string): unknown;',
            '  batch(queries: unknown[]): Promise<unknown[]>;',
            '  findFirst(): Promise<unknown>;',
            '  findMany(): Promise<unknown[]>;',
            '}',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb) {',
            '  await db.batch([]);',
            '  db["$with"]("active_users");',
            '  await db.findMany();',
            '  await db["findFirst"]();',
            '  await fake.batch([]);',
            '  fake["$with"]("active_users");',
            '  await fake.findMany();',
            '  await fake["findFirst"]();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:11',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:12',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:13',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:14',
          },
        ],
      },
    });
  });

  it('keeps project CTE builder query surfaces visible as KV406', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes([
          '$with(name: string): unknown;',
          'with(value: unknown): { select(value?: unknown): { from(table: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'product.queries.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            '',
            'export const productQuery = query("product/cte-builder", {',
            '  load(_input: unknown, db: PgDatabase) {',
            '    const active = db.$with("active_products");',
            '    return db.with(active).select({ id: products.id }).from(products);',
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
              'Statically un-analyzable write site; manual touches required. Query uses unclassified Drizzle receiver call db.$with().',
            severity: 'warn',
            site: 'product.queries.ts:7',
          },
        ],
        query: 'product/cte-builder',
        reads: ['product'],
        shape: {
          id: 'string',
        },
        site: 'product.queries.ts:7',
      },
    ]);
  });

  it('marks project computed receiver methods only for typed Drizzle symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['execute(query: unknown): Promise<void>;']),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'type FakeDb = Record<string, (query: unknown) => Promise<void>>;',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb, method: string) {',
            '  await db[method]("select 1");',
            '  await fake[method]("select 1");',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
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

  it('marks project bound detached receiver methods only for typed Drizzle symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb, method: string) {',
            '  const execute = db.execute.bind(db);',
            '  const write = db.update.bind(db);',
            '  const computed = db[method].bind(db);',
            '  const fakeExecute = fake.execute.bind(fake);',
            '  await execute("select 1");',
            '  await write(users).set({});',
            '  await computed("select 1");',
            '  await fakeExecute("select 1");',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:15',
          },
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
    });
  });

  it('marks project assigned detached receiver methods only for typed Drizzle symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb, method: string) {',
            '  let execute;',
            '  execute = db.execute;',
            '  let write;',
            '  write = db.update;',
            '  let computed;',
            '  computed = db[method];',
            '  let fakeExecute;',
            '  fakeExecute = fake.execute;',
            '  let destructuredExecute;',
            '  ({ execute: destructuredExecute } = db);',
            '  const carrier = { db, fake };',
            '  const carrierExecute = carrier.db.execute;',
            '  let carrierComputed;',
            '  carrierComputed = carrier.db[method];',
            '  const carrierFakeExecute = carrier.fake.execute;',
            '  await execute("select 1");',
            '  await write(users).set({});',
            '  await computed("select 1");',
            '  await destructuredExecute("select 1");',
            '  await carrierExecute("select 1");',
            '  await carrierComputed("select 1");',
            '  await carrierFakeExecute("select 1");',
            '  await fakeExecute("select 1");',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:26',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:27',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:28',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:29',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:30',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:31',
          },
        ],
      },
    });
  });

  it('marks project array-destructured detached receiver methods only for typed Drizzle symbols', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'execute(query: unknown): Promise<void>;',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'cart.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));',
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function sync(db: PgDatabase, fake: FakeDb, method: string) {',
            '  const [execute, write, computed] = [db.execute, db.update, db[method]];',
            '  const [fakeExecute] = [fake.execute];',
            '  let assignedExecute;',
            '  [assignedExecute] = [db.execute];',
            '  await execute("select 1");',
            '  await write(users).set({});',
            '  await computed("select 1");',
            '  await assignedExecute("select 1");',
            '  await fakeExecute("select 1");',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      sync: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:15',
          },
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
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'cart.domain.ts:18',
          },
        ],
      },
    });
  });
});
