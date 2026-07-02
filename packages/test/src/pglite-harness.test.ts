import { describe, expect, it } from 'vitest';

import { stampTrustedSql } from '@kovojs/core/internal/sql-safety';
import { mutation, s } from '@kovojs/server';
import { managedDb } from '@kovojs/server/internal/execution';

import { createKovoTestHarness } from './harness.js';
import { createPgliteTestDb, type PgliteTestDb } from './pglite.js';
import { expectedDiagnostic } from './test-fixtures.js';
import { assertOwnerWritesScoped, createDbVerifier } from './verifier.js';

describe('@kovojs/test PGlite harness integration', () => {
  it('backs managed readers with read-only PGlite transactions', async () => {
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table products (id text primary key, qty integer not null)');
      await db.exec('create sequence products_id_seq');
      await db.write('products', { id: 'p1', qty: 1 });
      await db.write('products', { id: 'p2', qty: 2 });

      const reader = managedDb(db, 'read') as unknown as Pick<
        PgliteTestDb,
        'exec' | 'query' | 'sql'
      >;

      await expect(
        reader.query<{ ids: string }>(
          stampTrustedSql(
            { text: "select string_agg(id, ',' order by id) as ids from products" },
            'static Postgres string_agg read',
          ),
        ),
      ).resolves.toEqual([{ ids: 'p1,p2' }]);
      await expect(
        reader.sql<{ day: Date | string }>(
          stampTrustedSql(
            { text: "select date_trunc('day', timestamp '2020-01-02 03:04:05') as day" },
            'static Postgres date_trunc read',
          ),
        ),
      ).resolves.toHaveLength(1);

      for (const statement of [
        { text: 'insert into products (id, qty) values ($1, $2)', values: ['p3', 3] },
        { text: 'update products set qty = $1 where id = $2', values: [4, 'p1'] },
        { text: 'delete from products where id = $1', values: ['p1'] },
      ]) {
        await expect(reader.query(statement)).rejects.toThrow(/KV433.*engine/s);
      }
      await expect(
        reader.exec(stampTrustedSql({ text: 'drop table products' }, 'read-surface DDL attempt')),
      ).rejects.toThrow(/KV433.*engine/s);
      await expect(
        reader.query(stampTrustedSql({ text: 'select * from products for update' }, 'read lock')),
      ).rejects.toThrow(/KV433.*engine/s);
      await expect(
        reader.query(
          stampTrustedSql({ text: "select nextval('products_id_seq')" }, 'sequence write'),
        ),
      ).rejects.toThrow(/KV433.*engine/s);
      await expect(
        reader.query(
          stampTrustedSql({ text: "select setval('products_id_seq', 10)" }, 'sequence write'),
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

  it('verifies direct db.query calls against the static touch graph', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      async handler(input, request: { db: Pick<PgliteTestDb, 'query'> }) {
        await request.db.query('insert into audit_log (product_id) values ($1)', [input.productId]);
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
        expectedDiagnostic('KV402', 'audit'),
      );
    } finally {
      await db.close();
    }
  });

  it('verifies direct db.exec calls against the static touch graph', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      async handler(input, request: { db: Pick<PgliteTestDb, 'exec'> }) {
        await request.db.exec(
          `insert into cart_items (product_id, qty) values ('${input.productId}', 1)`,
        );
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
      async handler(
        input,
        request: {
          db: Pick<PgliteTestDb, 'query'>;
          session: { user: { id: string } };
        },
      ) {
        await request.db.query('update orders set status = $1 where id = $2', [
          'cancelled',
          input.id,
        ]);
        return request.db.query<{ id: string; userId: string }>(
          'select id, user_id as "userId" from orders where id = $1',
          [input.id],
        );
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

  it('verifies engine-side cascade writes against the static touch graph', async () => {
    const deleteProduct = mutation('product/delete', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      async handler(input, request: { db: Pick<PgliteTestDb, 'exec'> }) {
        await request.db.exec(`delete from products where id = '${input.productId}'`);
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
        expectedDiagnostic('KV402', 'cart'),
      );
    } finally {
      await db.close();
    }
  });

  it('verifies raw pglite handle calls against the static touch graph', async () => {
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
        expectedDiagnostic('KV402', 'audit'),
      );
    } finally {
      await db.close();
    }
  });

  it('verifies raw pglite transaction handle calls against the static touch graph', async () => {
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
        expectedDiagnostic('KV402', 'audit'),
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

      await wrapped.sql('truncate products');

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
      await wrapped.sql('delete from products using archived where products.id = archived.id');

      expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'product'));
    } finally {
      await db.close();
    }
  });
});
