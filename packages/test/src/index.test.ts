import { describe, expect, it } from 'vitest';

import { mutation, s } from '@jiso/server';

import { createDbVerifier, createJisoTestHarness, jisoTest, propertyTest } from './index.js';

interface FakeDb {
  read(table: string, options?: { rowKey?: string }): unknown[];
  write(table: string, value: unknown, options?: { rowKey?: string }): void;
}

function createFakeDb(): FakeDb {
  const tables = new Map<string, unknown[]>();

  return {
    read(table) {
      return tables.get(table) ?? [];
    },
    write(table, value) {
      tables.set(table, [...(tables.get(table) ?? []), value]);
    },
  };
}

describe('@jiso/test harness', () => {
  it('property-tests optimistic predictions against eventual query truth', () => {
    const result = propertyTest({
      apply(state: { count: number }, input: { quantity: number }) {
        return { count: state.count + input.quantity };
      },
      cases: [
        { input: { quantity: 1 }, state: { count: 0 } },
        { input: { quantity: 2 }, state: { count: 3 } },
      ],
      predict(state, input) {
        return { count: state.count + input.quantity };
      },
    });

    expect(result).toEqual({ cases: 2 });
  });

  it('reports the first optimistic prediction counterexample', () => {
    expect(() =>
      propertyTest({
        apply(state: { count: number }, input: { quantity: number }) {
          return { count: state.count + input.quantity };
        },
        cases: [
          { input: { quantity: 1 }, state: { count: 0 } },
          { input: { quantity: 2 }, state: { count: 3 } },
        ],
        predict(state) {
          return { count: state.count };
        },
      }),
    ).toThrow('Optimistic property failed for case 0: predicted {"count":0}, eventual {"count":1}');
  });

  it('executes mutations against the provided db context', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: { cart: string[] } }) {
        request.db.cart.push(input.productId);
        return request.db.cart;
      },
    });
    const harness = createJisoTestHarness({ db: { cart: [] as string[] } });

    await expect(harness.exec(addToCart, { productId: 'p1' })).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: ['p1'],
    });
  });

  it('asserts fragments from rendered HTML without a browser', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart':
          '<html><body><fw-fragment target="cart-badge"><cart-badge fw-deps="cart"><span data-bind="cart.count">1</span></cart-badge></fw-fragment></body></html>',
      },
    });

    await expect(harness.page('/cart')).resolves.toMatchObject({
      html: expect.stringContaining('cart-badge'),
    });
    await expect(
      harness.page('/cart').then((page) => page.fragment('cart-badge')),
    ).resolves.toContain('data-bind="cart.count"');
  });

  it('runs a provided callback with a harness context', async () => {
    await expect(
      jisoTest(
        'cart page',
        async ({ page }) => {
          await expect(
            page('/cart').then((result) => result.fragment('cart-badge')),
          ).resolves.toContain('<cart-badge');
        },
        {
          db: {},
          pages: {
            '/cart': '<fw-fragment target="cart-badge"><cart-badge></cart-badge></fw-fragment>',
          },
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('verifies observed writes against the static touch graph after exec', async () => {
    const cartMutation = mutation('cart/add', {
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

  it('fails verification for writes to domains outside the static graph', async () => {
    const cartMutation = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('audit_log', input.productId);
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

  it('fails verification for writes to unmapped tables', async () => {
    const cartMutation = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('unknown_table', input.productId);
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

    await expect(harness.exec(cartMutation, { productId: 'p1' })).rejects.toThrow(
      'FW404 Write to unmapped table: unknown_table',
    );
  });

  it('allows observed writes when FW406 marks unresolved static analysis', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [],
          unresolved: [
            {
              code: 'FW406',
              message: 'Statically un-analyzable write site; manual touches required.',
              site: 'cart.domain.ts:9',
            },
          ],
        },
      },
      { domainByTable: { audit_log: 'audit' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('audit_log', 'p1');

    expect(() => verifier.assertCovered()).not.toThrow();
  });

  it('warns when a declared write domain is never observed', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [
            { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
            { domain: 'product', keys: null, site: 'cart.domain.ts:2', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { cart_items: 'cart', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('cart_items', 'p1');

    expect(verifier.diagnostics()).toEqual([
      {
        code: 'FW403',
        domain: 'product',
        message: 'Declared domain was never observed written.',
        severity: 'warn',
      },
    ]);
  });

  it('does not warn for declared write domains observed under instrumentation', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      { domainByTable: { cart_items: 'cart' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('cart_items', 'p1');

    expect(verifier.diagnostics()).toEqual([]);
  });

  it('verifies observed query reads against declared domains', () => {
    const verifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
    const db = verifier.wrap(createFakeDb());

    db.read('cart_items');

    expect(() => verifier.assertReadsCovered(['cart'])).not.toThrow();
  });

  it('fails read-side verification for undeclared query domains', () => {
    const verifier = createDbVerifier(
      {},
      { domainByTable: { cart_items: 'cart', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.read('cart_items');
    db.read('products');

    expect(() => verifier.assertReadsCovered(['cart'])).toThrow(
      'FW407 Query read from undeclared domain: product',
    );
  });

  it('fails read-side verification for unmapped query tables', () => {
    const verifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
    const db = verifier.wrap(createFakeDb());

    db.read('unmapped_table');

    expect(() => verifier.assertReadsCovered(['cart'])).toThrow(
      'FW407 Query read from undeclared domain: unmapped_table',
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
