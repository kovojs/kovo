import { describe, expect, it } from 'vitest';

import { mutation, s, publicAccess } from '@kovojs/server';

import { createKovoTestHarness } from './harness.js';
import { createPgliteTestDb, type PgliteTestDb } from './pglite.js';
import { expectedDiagnostic } from './test-fixtures.js';
import { createDbVerifier } from './verifier.js';

describe('@kovojs/test PGlite harness integration', () => {
  it('runs mutation suites against an in-memory pglite database', async () => {
    const db = await createPgliteTestDb();

    try {
      await db.exec('create table cart_items (product_id text primary key, qty integer not null)');

      const addToCart = mutation('cart/add', {
        access: publicAccess('test fixture'),
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
      access: publicAccess('test fixture'),
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
      access: publicAccess('test fixture'),
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

  it('verifies engine-side cascade writes against the static touch graph', async () => {
    const deleteProduct = mutation('product/delete', {
      access: publicAccess('test fixture'),
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
      access: publicAccess('test fixture'),
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
      access: publicAccess('test fixture'),
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
