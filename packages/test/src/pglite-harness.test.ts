import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { stampTrustedSql } from '@kovojs/core/internal/sql-safety';
import { mutation, s } from '@kovojs/server';
import {
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  managedDb,
  type KovoDeclaredWriteDbCapable,
  type KovoReadonlyDbCapable,
} from '@kovojs/server/internal/execution';

import { createKovoTestHarness } from './harness.js';
import { createPgliteTestDb, type PgliteTestDb } from './pglite.js';
import { expectedDiagnostic } from './test-fixtures.js';
import { assertOwnerWritesScoped, createDbVerifier } from './verifier.js';

describe('@kovojs/test PGlite harness integration', () => {
  it('executes managed query snapshots instead of rereading mutable PGlite carriers', async () => {
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table products (id text primary key)');
      await db.write('products', { id: 'p1' });
      let textDescriptorReads = 0;
      const carrier = new Proxy(
        {},
        {
          getOwnPropertyDescriptor(_target, prop) {
            if (prop === 'text') {
              textDescriptorReads += 1;
              return {
                configurable: true,
                enumerable: true,
                value:
                  textDescriptorReads === 1
                    ? 'select id from products where id = $1'
                    : 'delete from products where id = $1',
                writable: true,
              };
            }
            if (prop === 'values') {
              return {
                configurable: true,
                enumerable: true,
                value: ['p1'],
                writable: true,
              };
            }
            return undefined;
          },
        },
      );
      const writer = managedDb(db, 'write', {
        sqlWritePolicy: { dialect: 'postgres', tables: ['products'], touches: ['product'] },
      }) as unknown as Pick<PgliteTestDb, 'query'>;

      await expect(writer.query<{ id: string }>(carrier as never)).resolves.toEqual([{ id: 'p1' }]);
      await expect(db.read<{ id: string }>('products')).resolves.toEqual([{ id: 'p1' }]);
    } finally {
      await db.close();
    }
  });

  it('backs managed readers with read-only PGlite transactions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-pglite-readonly-'));
    const db = await createPgliteTestDb({ dataDir: root });

    try {
      await db.exec('create table products (id text primary key, qty integer not null)');
      await db.exec('create sequence products_id_seq');
      await db.write('products', { id: 'p1', qty: 1 });
      await db.write('products', { id: 'p2', qty: 2 });

      const reader = managedDb(db, 'read', {
        rawRead: {
          dialectLabel: 'PGlite',
          executeMethod: 'query',
          normalizeTableName: (table) => table,
        },
      }) as unknown as Pick<PgliteTestDb, 'exec' | 'query'> & {
        rawRead<Row extends Record<string, unknown> = Record<string, unknown>>(
          statement: unknown,
          declaration: { reads: readonly string[] },
        ): Promise<Row[]>;
      };

      await expect(
        reader.rawRead<{ ids: string }>(
          stampTrustedSql(
            { sql: "select string_agg(id, ',' order by id) as ids from products" },
            'static Postgres string_agg read',
          ),
          { reads: ['products'] },
        ),
      ).resolves.toEqual([{ ids: 'p1,p2' }]);
      expect(() =>
        reader.query<{ ids: string }>(
          stampTrustedSql(
            { text: "select string_agg(id, ',' order by id) as ids from products" },
            'direct query read attempt',
          ),
        ),
      ).toThrow(/KV433/);

      for (const statement of [
        { sql: 'insert into products (id, qty) values ($1, $2)', values: ['p3', 3] },
        { sql: 'update products set qty = $1 where id = $2', values: [4, 'p1'] },
        { sql: 'delete from products where id = $1', values: ['p1'] },
      ]) {
        await expect(reader.rawRead(statement, { reads: ['products'] })).rejects.toThrow(
          /KV433.*engine/s,
        );
      }
      expect(() =>
        reader.exec(stampTrustedSql({ text: 'drop table products' }, 'read-surface DDL attempt')),
      ).toThrow(/KV433/);
      await expect(
        reader.rawRead(stampTrustedSql({ sql: 'select * from products for update' }, 'read lock'), {
          reads: ['products'],
        }),
      ).rejects.toThrow(/KV433.*engine/s);
      await expect(
        reader.rawRead(
          stampTrustedSql({ sql: "select nextval('products_id_seq')" }, 'sequence write'),
          { reads: ['products'] },
        ),
      ).rejects.toThrow(/KV433.*engine/s);
      await expect(
        reader.rawRead(
          stampTrustedSql({ sql: "select setval('products_id_seq', 10)" }, 'sequence write'),
          { reads: ['products'] },
        ),
      ).rejects.toThrow(/KV433.*engine/s);

      await db.write('products', { id: 'p3', qty: 3 });
      await expect(db.read<{ id: string }>('products')).resolves.toMatchObject([
        { id: 'p1' },
        { id: 'p2' },
        { id: 'p3' },
      ]);
    } finally {
      await db.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps the dedicated PGlite reader session read-only without poisoning writer paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-pglite-readonly-pool-'));
    const db = await createPgliteTestDb({ dataDir: root });

    try {
      await db.exec('create table products (id text primary key, qty integer not null)');
      await db.write('products', { id: 'p1', qty: 1 });

      const rawReader = (
        db as PgliteTestDb &
          KovoReadonlyDbCapable<Pick<PgliteTestDb, 'exec' | 'pglite' | 'query' | 'write'>>
      )[kovoReadonlyDbHandle]();

      await expect(
        rawReader.query<{ default_transaction_read_only: string }>(
          'show default_transaction_read_only',
        ),
      ).resolves.toEqual([{ default_transaction_read_only: 'on' }]);
      expect(rawReader.pglite).not.toBe(db.pglite);
      await expect(
        rawReader.query<{ transaction_read_only: string }>('show transaction_read_only'),
      ).resolves.toEqual([{ transaction_read_only: 'on' }]);
      await expect(rawReader.write('products', { id: 'blocked', qty: 0 })).rejects.toThrow(
        /read-only transaction/,
      );

      await expect(
        db.query<{ default_transaction_read_only: string }>('show default_transaction_read_only'),
      ).resolves.toEqual([{ default_transaction_read_only: 'off' }]);
      await expect(
        db.query<{ transaction_read_only: string }>('show transaction_read_only'),
      ).resolves.toEqual([{ transaction_read_only: 'off' }]);
      await db.write('products', { id: 'p2', qty: 2 });

      const declaredWriter = (
        db as PgliteTestDb & KovoDeclaredWriteDbCapable<Pick<PgliteTestDb, 'query' | 'write'>>
      )[kovoDeclaredWriteDbHandle]({
        dialect: 'postgres',
        tables: ['products'],
        touches: ['product'],
      });
      await expect(
        declaredWriter.query<{ default_transaction_read_only: string }>(
          'show default_transaction_read_only',
        ),
      ).resolves.toEqual([{ default_transaction_read_only: 'off' }]);
      await declaredWriter.write('products', { id: 'p3', qty: 3 });

      await expect(
        rawReader.query<{ default_transaction_read_only: string }>(
          'show default_transaction_read_only',
        ),
      ).resolves.toEqual([{ default_transaction_read_only: 'on' }]);
      await expect(db.read<{ id: string }>('products')).resolves.toMatchObject([
        { id: 'p1' },
        { id: 'p2' },
        { id: 'p3' },
      ]);
    } finally {
      await db.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('runs mutation suites against an in-memory pglite database', async () => {
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table cart_items (product_id text primary key, qty integer not null)');

      const addToCart = mutation('cart/add', {
        csrf: false,
        input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
        async handler(input, request: { db: typeof db }) {
          await request.db.write('cart_items', {
            product_id: input.productId,
            qty: input.quantity,
          });
          return request.db.read<{ product_id: string; qty: number }>('cart_items');
        },
      });
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'cart.addItem': {
            reads: [
              {
                domain: 'cart',
                keys: null,
                site: 'cart.domain.ts:2',
                source: 'cart_items',
                via: 'cart_items',
              },
            ],
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            cart_items: 'cart',
          },
        },
      });

      await expect(
        harness.exec(addToCart, { productId: 'p1', quantity: 2 }),
      ).resolves.toMatchObject({
        ok: true,
        value: [{ product_id: 'p1', qty: 2 }],
      });
    } finally {
      await db.close();
    }
  });

  it('enforces declared tables on PGlite adapter helper writes with schema-qualified names', async () => {
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table cart_items (product_id text primary key, qty integer not null)');
      await db.exec('create table audit_log (product_id text primary key)');

      const writer = managedDb(db, 'write', {
        sqlWritePolicy: {
          dialect: 'postgres',
          tables: ['cart_items'],
          touches: ['cart'],
        },
      }) as unknown as Pick<PgliteTestDb, 'write'>;

      await writer.write('public.cart_items', { product_id: 'p1', qty: 2 });
      await expect(db.read<{ product_id: string }>('cart_items')).resolves.toMatchObject([
        { product_id: 'p1' },
      ]);

      await expect(writer.write('public.audit_log', { product_id: 'p1' })).rejects.toThrow(
        /KV406.*PGlite adapter declared-write fallback/s,
      );
      await expect(db.read('audit_log')).resolves.toEqual([]);
    } finally {
      await db.close();
    }
  });

  it('rejects schema-qualified out-of-scope PGlite writes with the stat-delta fallback', async () => {
    const db = await createPgliteTestDb();

    try {
      await db.exec('create schema otherschema');
      await db.exec('create table public.cart_items (product_id text primary key, qty integer)');
      await db.exec('create table otherschema.audit_log (product_id text primary key)');

      const declaredWriteDb = db as unknown as {
        [kovoDeclaredWriteDbHandle](policy: {
          dialect: 'postgres';
          tables: readonly string[];
          touches: readonly string[];
        }): unknown;
      };
      const writer = declaredWriteDb[kovoDeclaredWriteDbHandle]({
        dialect: 'postgres',
        tables: ['public.cart_items'],
        touches: ['cart'],
      }) as Pick<PgliteTestDb, 'query'>;

      await expect(
        writer.query({
          text: 'insert into public.cart_items (product_id, qty) values ($1, $2)',
          values: ['p1', 2],
        }),
      ).resolves.toEqual([]);
      await expect(db.read<{ product_id: string }>('public.cart_items')).resolves.toEqual([
        { product_id: 'p1', qty: 2 },
      ]);

      await expect(
        writer.query({
          text: 'insert into otherschema.audit_log (product_id) values ($1)',
          values: ['p1'],
        }),
      ).rejects.toThrow(/KV406.*stat-delta fallback[\s\S]*otherschema\.audit_log/);
      await expect(db.read('otherschema.audit_log')).resolves.toEqual([]);
    } finally {
      await db.close();
    }
  });

  it('rejects direct db.query SQL writes without registry tables before touch graph verification', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      async handler(input, request: { db: Pick<PgliteTestDb, 'query'> }) {
        await request.db.query({
          text: 'insert into audit_log (product_id) values ($1)',
          values: [input.productId],
        });
        return input.productId;
      },
    });
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table audit_log (product_id text not null)');
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            audit_log: 'audit',
            cart_items: 'cart',
          },
        },
      });

      await expect(harness.exec(cartMutation, { productId: 'p1' })).rejects.toThrow(
        /KV406: raw-SQL write touched table\(s\) outside the declared mutation registry tables[\s\S]*public\.audit_log/,
      );
    } finally {
      await db.close();
    }
  });

  it('verifies separated db.query carriers against the static touch graph', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      registry: { tables: ['cart_items'] },
      async handler(input, request: { db: Pick<PgliteTestDb, 'query'> }) {
        await request.db.query({
          text: 'insert into cart_items (product_id, qty) values ($1, 1)',
          values: [input.productId],
        });
        return input.productId;
      },
    });
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table cart_items (product_id text primary key, qty integer not null)');
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            cart_items: 'cart',
          },
        },
      });

      await expect(harness.exec(cartMutation, { productId: 'p1' })).resolves.toMatchObject({
        ok: true,
        value: 'p1',
      });
    } finally {
      await db.close();
    }
  });

  it('detects a real raw SQL cross-tenant owner write with the runtime KV414 check', async () => {
    const cancelOrder = mutation('order/cancel', {
      csrf: false,
      input: s.object({ id: s.string() }),
      registry: { tables: ['orders'] },
      async handler(
        input,
        request: {
          db: Pick<PgliteTestDb, 'query'>;
          session: { user: { id: string } };
        },
      ) {
        await request.db.query({
          text: 'update orders set status = $1 where id = $2',
          values: ['cancelled', input.id],
        });
        return request.db.query<{ id: string; userId: string }>({
          text: 'select id, user_id as "userId" from orders where id = $1',
          values: [input.id],
        });
      },
    });
    const db = await createPgliteTestDb();

    try {
      await db.exec(
        [
          'create table orders (id text primary key, user_id text not null, status text not null)',
          "insert into orders (id, user_id, status) values ('o1', 'u1', 'open'), ('o2', 'u2', 'open')",
        ].join('; '),
      );
      const harness = createKovoTestHarness({
        db,
        request: { session: { user: { id: 'u1' } } },
        touchGraph: {
          'order.cancel': {
            reads: [
              {
                domain: 'order',
                keys: 'arg:id',
                site: 'order.domain.ts:2',
                source: 'orders',
                via: 'orders',
              },
            ],
            touches: [
              { domain: 'order', keys: 'arg:id', site: 'order.domain.ts:1', via: 'orders' },
            ],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            orders: 'order',
          },
        },
      });

      const result = await harness.exec(
        cancelOrder,
        { id: 'o2' },
        { touchGraphKey: 'order.cancel' },
      );
      if (!result.ok) throw new Error('Expected mutation to return the written owner row.');

      expect(() =>
        assertOwnerWritesScoped({
          domain: 'order',
          ownerColumn: 'userId',
          principal: 'u1',
          rows: result.value,
        }),
      ).toThrow(/KV414 \(runtime §11\.2\).*mutation wrote.*u2.*not the session principal u1/);
    } finally {
      await db.close();
    }
  });

  it('rejects engine-side PGlite cascade writes with the declared-write stat fallback', async () => {
    const deleteProduct = mutation('product/delete', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      registry: { tables: ['products'] },
      async handler(input, request: { db: Pick<PgliteTestDb, 'query'> }) {
        await request.db.query({
          text: 'delete from products where id = $1',
          values: [input.productId],
        });
        return input.productId;
      },
    });
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table products (id text primary key)');
      await db.exec(
        'create table cart_items (product_id text references products(id) on delete cascade)',
      );
      await db.exec("insert into products (id) values ('p1')");
      await db.exec("insert into cart_items (product_id) values ('p1')");
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'product.delete': {
            touches: [
              { domain: 'product', keys: 'sql:id', site: 'product.domain.ts:1', via: 'products' },
            ],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            cart_items: 'cart',
            products: 'product',
          },
        },
      });

      await expect(harness.exec(deleteProduct, { productId: 'p1' })).rejects.toThrow(
        /KV406: PGlite declared-write stat-delta fallback[\s\S]*public\.cart_items/,
      );
    } finally {
      await db.close();
    }
  });

  it('rejects raw pglite handle SQL strings before touch graph verification', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      async handler(input, request: { db: Pick<PgliteTestDb, 'pglite'> }) {
        await request.db.pglite.query('insert into audit_log (product_id) values ($1)', [
          input.productId,
        ]);
        return input.productId;
      },
    });
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table audit_log (product_id text not null)');
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            audit_log: 'audit',
            cart_items: 'cart',
          },
        },
      });

      await expect(harness.exec(cartMutation, { productId: 'p1' })).rejects.toThrow(
        /KV422: SQL text injection risk/,
      );
    } finally {
      await db.close();
    }
  });

  it('rejects raw pglite transaction SQL strings before touch graph verification', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      async handler(input, request: { db: Pick<PgliteTestDb, 'pglite'> }) {
        await request.db.pglite.transaction(async (tx) => {
          await tx.query('insert into audit_log (product_id) values ($1)', [input.productId]);
        });
        return input.productId;
      },
    });
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table audit_log (product_id text not null)');
      const harness = createKovoTestHarness({
        db,
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: {
            audit_log: 'audit',
            cart_items: 'cart',
          },
        },
      });

      await expect(harness.exec(cartMutation, { productId: 'p1' })).rejects.toThrow(
        /KV422: SQL text injection risk/,
      );
    } finally {
      await db.close();
    }
  });

  // E1 (SPEC.md §11.2 meta-soundness): an uncovered TRUNCATE is a full-table
  // destructive write. The parser emits a `truncate table` op per table, so an
  // uncovered truncate must fail `assertCovered()` instead of passing green.
  it('flags an uncovered TRUNCATE as an uncovered destructive write', async () => {
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table products (id text primary key)');
      await db.exec("insert into products (id) values ('p1'), ('p2')");

      const verifier = createDbVerifier({}, { domainByTable: { products: 'product' } });
      const wrapped = verifier.wrap(db);

      await wrapped.query(stampTrustedSql({ text: 'truncate products' }, 'static truncate test'));

      expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'product'));
    } finally {
      await db.close();
    }
  });

  // E1 (SPEC.md §11.2 meta-soundness): a destructive write the parser does not
  // recognize (`DELETE … USING` throws → fail-open `[]`) must still be caught by
  // the UNCONDITIONAL row-count backstop, not pass `assertCovered()` green.
  it('flags an unparseable destructive write via the unconditional row-count net', async () => {
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table products (id text primary key)');
      await db.exec('create table archived (id text primary key)');
      await db.exec("insert into products (id) values ('p1'), ('p2')");
      await db.exec("insert into archived (id) values ('p1')");

      const verifier = createDbVerifier({}, { domainByTable: { products: 'product' } });
      const wrapped = verifier.wrap(db);

      // pgsql-ast-parser rejects `DELETE … USING`, so the explicit parse drops to
      // [] (fail-open). The count delta on `products` is the only signal.
      await wrapped.query(
        stampTrustedSql(
          { text: 'delete from products using archived where products.id = archived.id' },
          'static delete-using test',
        ),
      );

      expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'product'));
    } finally {
      await db.close();
    }
  });
});
