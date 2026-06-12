import { describe, expect, it } from 'vitest';

import { domain, mutation, s } from '@jiso/server';

import {
  createDbVerifier,
  createJisoTestHarness,
  createPgliteTestDb,
  type PgliteTestDb,
} from './index.js';
import { createFakeDb, type FakeDb } from './test-fixtures.js';

function deferred<T = void>(): {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}

describe('@jiso/test harness', () => {
  it('verifies observed writes against the static touch graph after exec', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('cart_items', input.productId);
        return request.db.read('cart_items');
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
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
      value: ['p1'],
    });
  });

  it('exposes verification diagnostics through the harness context', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('cart_items', input.productId, { branch: 'cart-line' });
        return request.db.read('cart_items');
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart.addItem': {
          touches: [
            {
              branch: 'cart-line',
              domain: 'cart',
              keys: 'arg:productId',
              site: 'cart.domain.ts:1',
              via: 'cart_items',
            },
            {
              branch: 'stock-reserve',
              domain: 'product',
              keys: 'arg:productId',
              site: 'cart.domain.ts:2',
              via: 'products',
            },
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

    await harness.exec(cartMutation, { productId: 'p1' });

    expect(harness.verificationDiagnostics()).toEqual([
      {
        branch: 'stock-reserve',
        code: 'FW405',
        domain: 'product',
        message: 'Conditional write branch was never executed under instrumentation.',
        severity: 'warn',
        site: 'cart.domain.ts:2',
      },
      {
        code: 'FW403',
        domain: 'product',
        message: 'Declared domain was never observed written.',
        severity: 'warn',
      },
    ]);
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
      const harness = createJisoTestHarness({
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

  it('verifies raw SQL writes against the static touch graph', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.sql(`insert into cart_items (product_id) values ('${input.productId}')`);
        return input.productId;
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
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
    expect(harness.dbHandle().read('cart_items')).toEqual([]);
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
      const harness = createJisoTestHarness({
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
        'FW402 Write touched an undeclared domain: audit',
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
      const harness = createJisoTestHarness({
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
      const harness = createJisoTestHarness({
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
        'FW402 Write touched an undeclared domain: audit',
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
      const harness = createJisoTestHarness({
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
        'FW402 Write touched an undeclared domain: audit',
      );
    } finally {
      await db.close();
    }
  });

  it('fails verification when raw SQL writes outside FW406 coverage', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.sql(`update audit_log set product_id = '${input.productId}' where id = 'a1'`);
        return input.productId;
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
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
      'FW402 Write touched an undeclared domain: audit',
    );
  });

  it('scopes observations to interleaved mutation exec calls', async () => {
    const releaseHandlers = deferred();
    const cartStarted = deferred();
    const auditStarted = deferred();
    const bothWritten = deferred();
    let writeCount = 0;
    const waitForBothWrites = async () => {
      writeCount += 1;
      if (writeCount === 2) bothWritten.resolve(undefined);
      await bothWritten.promise;
    };
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      async handler(input, request: { db: FakeDb }) {
        cartStarted.resolve(undefined);
        await releaseHandlers.promise;
        request.db.write('cart_items', input.productId);
        await waitForBothWrites();
        return input.productId;
      },
    });
    const auditMutation = mutation('audit/add', {
      csrf: false,
      input: s.object({ event: s.string() }),
      async handler(input, request: { db: FakeDb }) {
        auditStarted.resolve(undefined);
        await releaseHandlers.promise;
        request.db.write('audit_log', input.event);
        await waitForBothWrites();
        return input.event;
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'audit.add': {
          touches: [{ domain: 'audit', keys: null, site: 'audit.domain.ts:1', via: 'audit_log' }],
          unresolved: [],
        },
        'cart.add': {
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

    const cartExec = harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart.add' });
    const auditExec = harness.exec(
      auditMutation,
      { event: 'cart-add' },
      { touchGraphKey: 'audit.add' },
    );
    await Promise.all([cartStarted.promise, auditStarted.promise]);
    releaseHandlers.resolve(undefined);

    await expect(Promise.all([cartExec, auditExec])).resolves.toMatchObject([
      { ok: true, value: 'p1' },
      { ok: true, value: 'cart-add' },
    ]);
    expect(harness.verificationDiagnostics()).toEqual([]);
  });

  it('verifies insert-select SQL as a target write plus source reads', async () => {
    const productImport = mutation('product/import', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      registry: {
        touches: [domain('product')],
      },
      handler(_input, request: { db: FakeDb }) {
        request.db.sql(
          [
            'insert into product_snapshots (product_id, name)',
            'select products.id, products.name',
            'from products',
            'join vendors on vendors.id = products.vendor_id',
          ].join(' '),
        );
        return 'ok';
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'product.import': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'product.ts:2',
              source: 'insert-select',
              via: 'products',
            },
            {
              domain: 'vendor',
              keys: null,
              site: 'product.ts:3',
              source: 'insert-select',
              via: 'vendors',
            },
          ],
          touches: [
            { domain: 'product', keys: null, site: 'product.ts:1', via: 'product_snapshots' },
          ],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          product_snapshots: 'product',
          products: 'product',
          vendors: 'vendor',
        },
      },
    });

    await expect(harness.exec(productImport, { productId: 'p1' })).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });

    const verifier = createDbVerifier(
      {},
      {
        domainByTable: {
          product_snapshots: 'product',
          products: 'product',
          vendors: 'vendor',
        },
      },
    );
    const db = verifier.wrap(createFakeDb());
    db.sql(
      'insert into product_snapshots select products.id from products join vendors on vendors.id = products.vendor_id',
    );

    expect(() => verifier.assertReadsCovered(['product', 'vendor'])).not.toThrow();
    expect(() => verifier.assertReadsCovered(['product'])).toThrow(
      'FW407 Query read from undeclared domain: vendor',
    );
  });

  it('fails mutation exec when insert-select reads are missing from the touch graph', async () => {
    const productImport = mutation('product/import', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      registry: {
        touches: [domain('product')],
      },
      handler(_input, request: { db: FakeDb }) {
        request.db.sql(
          [
            'insert into product_snapshots (product_id, name)',
            'select products.id, products.name',
            'from products',
            'join vendors on vendors.id = products.vendor_id',
          ].join(' '),
        );
        return 'ok';
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'product.import': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'product.ts:2',
              source: 'insert-select',
              via: 'products',
            },
          ],
          touches: [
            { domain: 'product', keys: null, site: 'product.ts:1', via: 'product_snapshots' },
          ],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          product_snapshots: 'product',
          products: 'product',
          vendors: 'vendor',
        },
      },
    });

    await expect(harness.exec(productImport, { productId: 'p1' })).rejects.toThrow(
      'FW407 Query read from undeclared domain: vendor',
    );
  });

  it('does not let unscoped FW406 cover missing mutation read domains', async () => {
    const productImport = mutation('product/import', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(_input, request: { db: FakeDb }) {
        request.db.sql(
          [
            'insert into product_snapshots (product_id, name)',
            'select products.id, vendors.name',
            'from products',
            'join vendors on vendors.id = products.vendor_id',
          ].join(' '),
        );
        return 'ok';
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'product.import': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'product.ts:2',
              source: 'insert-select',
              via: 'products',
            },
          ],
          touches: [
            { domain: 'product', keys: null, site: 'product.ts:1', via: 'product_snapshots' },
          ],
          unresolved: [
            {
              code: 'FW406',
              message: 'Statically un-analyzable write site; manual touches required.',
              site: 'product.ts:9',
            },
          ],
        },
      },
      verification: {
        domainByTable: {
          product_snapshots: 'product',
          products: 'product',
          vendors: 'vendor',
        },
      },
    });

    await expect(harness.exec(productImport, { productId: 'p1' })).rejects.toThrow(
      'FW407 Query read from undeclared domain: vendor',
    );
  });

  it('scopes mutation-read verification to the executed mutation graph entry', async () => {
    const productImport = mutation('product/import', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(_input, request: { db: FakeDb }) {
        request.db.sql(
          [
            'insert into product_snapshots (product_id, name)',
            'select products.id, vendors.name',
            'from products',
            'join vendors on vendors.id = products.vendor_id',
          ].join(' '),
        );
        return 'ok';
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'product/import': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'product.ts:2',
              source: 'insert-select',
              via: 'products',
            },
          ],
          touches: [
            { domain: 'product', keys: null, site: 'product.ts:1', via: 'product_snapshots' },
          ],
          unresolved: [],
        },
        'vendor/import': {
          reads: [
            {
              domain: 'vendor',
              keys: null,
              site: 'vendor.ts:2',
              source: 'insert-select',
              via: 'vendors',
            },
          ],
          touches: [],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          product_snapshots: 'product',
          products: 'product',
          vendors: 'vendor',
        },
      },
    });

    await expect(
      harness.exec(productImport, { productId: 'p1' }, { touchGraphKey: 'product/import' }),
    ).rejects.toThrow('FW407 Query read from undeclared domain: vendor');
  });

  it('verifies update-from SQL as a target write plus source reads', () => {
    const verifier = createDbVerifier(
      {
        'product.syncPrice': {
          reads: [
            {
              domain: 'price',
              keys: null,
              site: 'product.ts:2',
              source: 'update-from',
              via: 'prices',
            },
          ],
          touches: [{ domain: 'product', keys: null, site: 'product.ts:1', via: 'products' }],
          unresolved: [],
        },
      },
      { domainByTable: { prices: 'price', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql(
      'update products set price = prices.amount from prices where prices.product_id = products.id',
    );

    expect(() => verifier.assertCovered()).not.toThrow();
    expect(() => verifier.assertReadsCovered(['price'])).not.toThrow();
    expect(() => verifier.assertReadsCovered(['product'])).toThrow(
      'FW407 Query read from undeclared domain: price',
    );
  });

  it('verifies update expression subqueries as mutation reads', () => {
    const verifier = createDbVerifier(
      {
        'product.syncPrice': {
          touches: [{ domain: 'product', keys: null, site: 'product.ts:1', via: 'products' }],
          unresolved: [],
        },
      },
      { domainByTable: { prices: 'price', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql(
      'update products set unit_price = (select max(amount) from prices) where id in (select product_id from prices)',
    );

    expect(() => verifier.assertCovered()).toThrow(
      'FW407 Query read from undeclared domain: price',
    );
  });

  it('verifies select expression subqueries as query reads', () => {
    const verifier = createDbVerifier(
      {
        'product.load': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'product.ts:1',
              source: 'select',
              via: 'products',
            },
          ],
          touches: [],
          unresolved: [],
        },
      },
      { domainByTable: { prices: 'price', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql('select * from products where id in (select product_id from prices)');

    expect(() => verifier.assertReadsCovered(['product'])).toThrow(
      'FW407 Query read from undeclared domain: price',
    );
    expect(() => verifier.assertReadsCovered(['product', 'price'])).not.toThrow();
  });

  it('checks row keys parsed from raw SQL predicates', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql("update products set reserved = true where sku = 'sku-1'");

    expect(() => verifier.assertCovered()).toThrow(
      'FW408 Declared row key differs from observed row predicate: products expected id observed sku',
    );
  });

  it('accepts raw SQL compound predicates when one observed row key matches', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql("update products set reserved = true where sku = 'sku-1' and id = 'p1'");

    expect(() => verifier.assertCovered()).not.toThrow();
  });

  it('reports all raw SQL predicate keys when none matches the declared row key', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql("update products set reserved = true where sku = 'sku-1' and slug = 'beans'");

    expect(() => verifier.assertCovered()).toThrow(
      'FW408 Declared row key differs from observed row predicate: products expected id observed sku, slug',
    );
  });

  it('checks row keys parsed from raw SQL delete predicates', () => {
    const verifier = createDbVerifier(
      {
        'product.delete': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql("delete from public.products where sku = 'sku-1'");

    expect(() => verifier.assertCovered()).toThrow(
      'FW408 Declared row key differs from observed row predicate: products expected id observed sku',
    );
  });

  it('fails verification when an observed write predicate uses the wrong row key', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('products', { id: 'p1' }, { rowKey: 'sku' });

    expect(() => verifier.assertCovered()).toThrow(
      'FW408 Declared row key differs from observed row predicate: products expected id observed sku',
    );
  });

  it('fails verification when a keyed static write has no observed row predicate', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('products', { id: 'p1' });

    expect(() => verifier.assertCovered()).toThrow(
      'FW408 Declared row key differs from observed row predicate: products expected id observed <missing>',
    );
  });

  it('accepts observed row predicates that match the declared table key', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('products', { id: 'p1' }, { rowKey: 'id' });

    expect(() => verifier.assertCovered()).not.toThrow();
  });
});
