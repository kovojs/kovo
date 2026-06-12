import { describe, expect, it } from 'vitest';

import { domain, query, s, type QueryLoadContext } from '@jiso/server';

import { createDbVerifier, createJisoTestHarness } from './index.js';
import { createFakeDb, expectedDiagnostic, type FakeDb } from './test-fixtures.js';

describe('@jiso/test query verifier', () => {
  it('fails read-side verification for undeclared query domains', () => {
    const verifier = createDbVerifier(
      {},
      { domainByTable: { cart_items: 'cart', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.read('cart_items');
    db.read('products');

    expect(() => verifier.assertReadsCovered(['cart'])).toThrow(
      expectedDiagnostic('FW407', 'product'),
    );
  });

  it('passes non-string query arguments through before SQL verification', () => {
    const verifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
    const calls: unknown[] = [];
    const db = verifier.wrap({
      query(statement: unknown) {
        calls.push(statement);
        return ['ok'];
      },
    });
    const queryObject = { text: 'select * from cart_items' };

    expect(db.query(queryObject)).toEqual(['ok']);
    expect(calls).toEqual([queryObject]);
    expect(verifier.observed).toEqual([]);
  });

  it('passes non-string exec and sql arguments through before SQL verification', () => {
    const verifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
    const calls: Array<[string, unknown]> = [];
    const db = verifier.wrap({
      exec(statement: unknown) {
        calls.push(['exec', statement]);
        return ['exec-ok'];
      },
      sql(statement: unknown) {
        calls.push(['sql', statement]);
        return ['sql-ok'];
      },
    });
    const execObject = { text: 'create table cart_items (id text)' };
    const sqlObject = { text: 'select * from cart_items' };

    expect(db.exec(execObject)).toEqual(['exec-ok']);
    expect(db.sql(sqlObject)).toEqual(['sql-ok']);
    expect(calls).toEqual([
      ['exec', execObject],
      ['sql', sqlObject],
    ]);
    expect(verifier.observed).toEqual([]);
  });

  it('lets unparseable SQL reach wrapped methods before SQL verification', () => {
    const verifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
    const calls: Array<[string, unknown]> = [];
    const db = verifier.wrap({
      exec(statement: unknown) {
        calls.push(['exec', statement]);
        return ['exec-ok'];
      },
      query(statement: unknown) {
        calls.push(['query', statement]);
        return ['query-ok'];
      },
      sql(statement: unknown) {
        calls.push(['sql', statement]);
        return ['sql-ok'];
      },
    });
    const statement = 'not valid sql for the parser';

    expect(db.exec(statement)).toEqual(['exec-ok']);
    expect(db.query(statement)).toEqual(['query-ok']);
    expect(db.sql(statement)).toEqual(['sql-ok']);
    expect(calls).toEqual([
      ['exec', statement],
      ['query', statement],
      ['sql', statement],
    ]);
    expect(verifier.observed).toEqual([]);
  });

  it('passes non-string nested pglite query and exec arguments through before SQL verification', () => {
    const verifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
    const calls: Array<[string, unknown]> = [];
    const db = verifier.wrap({
      pglite: {
        exec(statement: unknown) {
          calls.push(['exec', statement]);
          return ['exec-ok'];
        },
        query(statement: unknown) {
          calls.push(['query', statement]);
          return ['query-ok'];
        },
      },
    });
    const execObject = { text: 'create table cart_items (id text)' };
    const queryObject = { text: 'select * from cart_items' };

    expect(db.pglite.exec(execObject)).toEqual(['exec-ok']);
    expect(db.pglite.query(queryObject)).toEqual(['query-ok']);
    expect(calls).toEqual([
      ['exec', execObject],
      ['query', queryObject],
    ]);
    expect(verifier.observed).toEqual([]);
  });

  it('executes query loaders and verifies reads against declared domains', async () => {
    const cart = domain('cart');
    const db = createFakeDb();
    const harness = createJisoTestHarness({
      db,
      request: {
        session: { cartId: 'c1' },
      },
      touchGraph: {},
      verification: {
        domainByTable: {
          cart_items: 'cart',
        },
      },
    });
    const cartQuery = query('cart', {
      load(_input, context: { request: { db: FakeDb; session?: { cartId: string } } }) {
        return {
          cartId: context.request.session?.cartId,
          items: context.request.db.read('cart_items'),
        };
      },
      reads: [cart],
    });

    db.write('cart_items', 'p1');

    await expect(harness.query(cartQuery)).resolves.toEqual({ cartId: 'c1', items: ['p1'] });
  });

  it('passes the verifier-wrapped db as the query loader context db', async () => {
    const cart = domain('cart');
    const db = createFakeDb();
    const harness = createJisoTestHarness({
      db,
      touchGraph: {},
      verification: {
        domainByTable: {
          cart_items: 'cart',
        },
      },
    });
    const cartQuery = query('cart', {
      load(_input, context?: { db: FakeDb; request: { db: FakeDb } }) {
        expect(context?.db).toBe(context?.request.db);
        expect(context?.db).toBe(harness.dbHandle());
        return context?.db.read('cart_items');
      },
      reads: [cart],
    });

    db.write('cart_items', 'p1');

    await expect(harness.query(cartQuery)).resolves.toEqual(['p1']);
    expect(harness.verificationDiagnostics()).toEqual([]);
  });

  it('passes query input through the public harness while keeping db verification scoped', async () => {
    const product = domain('product');
    const db = createFakeDb();
    db.write('products', 'p1');
    db.write('products', 'p2');
    const harness = createJisoTestHarness({
      db,
      touchGraph: {},
      verification: {
        domainByTable: {
          products: 'product',
        },
      },
    });
    const productQuery = query('product/page', {
      load(input: unknown, context?: QueryLoadContext<{ db: FakeDb }> & { db: FakeDb }) {
        const { after = null, limit = 2 } = input as { after?: string | null; limit?: number };
        const products = context?.db.read('products') ?? [];
        const start = after ? products.indexOf(after) + 1 : 0;

        return products.slice(start, start + limit);
      },
      reads: [product],
    });

    await expect(harness.query(productQuery, { after: 'p1', limit: 1 })).resolves.toEqual(['p2']);
    expect(harness.verificationDiagnostics()).toEqual([]);
  });

  it('validates query loader results against declared output schemas', async () => {
    const cart = domain('cart');
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {},
      verification: {
        domainByTable: {
          cart_items: 'cart',
        },
      },
    });
    const cartQuery = query('cart', {
      load() {
        harness.db.read('cart_items');
        return { count: 2 };
      },
      output: s.object({ count: s.number().int().min(0) }),
      reads: [cart],
    });

    await expect(harness.query(cartQuery)).resolves.toEqual({ count: 2 });
  });

  it('fails query output verification when observed result shape violates the schema', async () => {
    const cart = domain('cart');
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {},
      verification: {
        domainByTable: {
          cart_items: 'cart',
        },
      },
    });
    const cartQuery = query('cart', {
      load() {
        harness.db.read('cart_items');
        return { count: 'two' };
      },
      output: s.object({ count: s.number().int().min(0) }),
      reads: [cart],
    });

    await expect(harness.query(cartQuery)).rejects.toThrow(
      expectedDiagnostic('FW410', 'cart Expected number'),
    );
  });

  it('reports FW410 for nested query output shape mismatches', async () => {
    const product = domain('product');
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {},
      verification: {
        domainByTable: {
          products: 'product',
        },
      },
    });
    const productQuery = query('product/list', {
      load() {
        harness.db.read('products');
        return { items: [{ id: 7 }] };
      },
      output: s.object({ items: s.array(s.object({ id: s.string() })) }),
      reads: [product],
    });

    await expect(harness.query(productQuery)).rejects.toThrow(
      expectedDiagnostic('FW410', 'product/list Expected string'),
    );
  });

  it('fails query-loader verification for reads outside declared domains', async () => {
    const cart = domain('cart');
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {},
      verification: {
        domainByTable: {
          cart_items: 'cart',
          products: 'product',
        },
      },
    });
    const cartQuery = query('cart', {
      load() {
        harness.db.read('products');
        return harness.db.read('cart_items');
      },
      reads: [cart],
    });

    await expect(harness.query(cartQuery)).rejects.toThrow(expectedDiagnostic('FW407', 'product'));
  });

  it('fails query-loader verification for raw SQL reads of exempt tables', async () => {
    const cart = domain('cart');
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {},
      verification: {
        domainByTable: {
          cart_items: 'cart',
        },
        exemptTables: ['audit_log'],
      },
    });
    const cartQuery = query('cart', {
      load() {
        harness.db.sql('select * from audit_log');
        return harness.db.read('cart_items');
      },
      reads: [cart],
    });

    await expect(harness.query(cartQuery)).rejects.toThrow(
      expectedDiagnostic('FW411', 'audit_log'),
    );
  });

  it('scopes automatic query read verification to the current loader', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {},
      verification: {
        domainByTable: {
          cart_items: 'cart',
          products: 'product',
        },
      },
    });
    const productQuery = query('product', {
      load() {
        return harness.db.read('products');
      },
      reads: [product],
    });
    const cartQuery = query('cart', {
      load() {
        return harness.db.read('cart_items');
      },
      reads: [cart],
    });

    await harness.query(productQuery);

    await expect(harness.query(cartQuery)).resolves.toEqual([]);
  });

  it('fails read-side verification for unmapped query tables', () => {
    const verifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
    const db = verifier.wrap(createFakeDb());

    db.read('unmapped_table');

    expect(() => verifier.assertReadsCovered(['cart'])).toThrow(
      expectedDiagnostic('FW407', 'unmapped_table'),
    );
  });

  it('verifies raw SQL query reads with joins against declared domains', () => {
    const verifier = createDbVerifier(
      {},
      { domainByTable: { cart_items: 'cart', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql(
      'select cart_items.product_id, products.name from cart_items join products on products.id = cart_items.product_id',
    );

    expect(() => verifier.assertReadsCovered(['cart', 'product'])).not.toThrow();
    expect(() => verifier.assertReadsCovered(['cart'])).toThrow(
      expectedDiagnostic('FW407', 'product'),
    );
  });

  it('verifies aliased and schema-qualified SQL reads through the parser', () => {
    const verifier = createDbVerifier(
      {},
      { domainByTable: { cart_items: 'cart', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql(
      'select c.product_id, p.name from public.cart_items c join catalog.products p on p.id = c.product_id where c.id = $1',
    );

    expect(() => verifier.assertReadsCovered(['cart', 'product'])).not.toThrow();
    expect(() => verifier.assertReadsCovered(['cart'])).toThrow(
      expectedDiagnostic('FW407', 'product'),
    );
  });

  it('checks row keys parsed from raw SQL query predicates', () => {
    const verifier = createDbVerifier(
      {},
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql("select * from products where sku = 'sku-1'");

    expect(() => verifier.assertReadsCovered(['product'])).toThrow(
      expectedDiagnostic('FW408', 'products expected id observed sku'),
    );
  });

  it('verifies CTE source reads while ignoring the CTE alias as a table', () => {
    const verifier = createDbVerifier(
      {},
      { domainByTable: { products: 'product', vendors: 'vendor' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql(
      [
        'with recent as (select id, vendor_id from products where id = $1)',
        'select recent.id, vendors.name',
        'from recent',
        'join vendors on vendors.id = recent.vendor_id',
      ].join(' '),
    );

    expect(() => verifier.assertReadsCovered(['product', 'vendor'])).not.toThrow();
    expect(() => verifier.assertReadsCovered(['product'])).toThrow(
      expectedDiagnostic('FW407', 'vendor'),
    );
  });
});
