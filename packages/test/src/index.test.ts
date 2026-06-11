import { describe, expect, it } from 'vitest';

import { domain, mutation, query, s } from '@jiso/server';

import {
  assertMutationError,
  createDbVerifier,
  createJisoTestHarness,
  createPgliteTestDb,
  jisoTest,
  propertyTest,
  type PgliteTestDb,
} from './index.js';

interface FakeDb {
  read(table: string, options?: { branch?: string; rowKey?: string }): unknown[];
  sql(statement: string): unknown[];
  write(table: string, value: unknown, options?: { branch?: string; rowKey?: string }): void;
}

function createFakeDb(): FakeDb {
  const tables = new Map<string, unknown[]>();

  return {
    read(table) {
      return tables.get(table) ?? [];
    },
    sql() {
      return [];
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

  it('merges request fixtures into mutation exec context', async () => {
    const guarded = mutation('cart/add', {
      guard(request: { db: { cart: string[] }; session?: { user?: { id: string } | null } }) {
        return Boolean(request.session?.user);
      },
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: { cart: string[] }; session?: { user?: { id: string } } }) {
        request.db.cart.push(`${request.session?.user?.id}:${input.productId}`);
        return request.db.cart;
      },
    });
    const harness = createJisoTestHarness({
      db: { cart: [] as string[] },
      request: { session: { user: { id: 'u1' } } },
    });

    await expect(harness.exec(guarded, { productId: 'p1' })).resolves.toMatchObject({
      ok: true,
      value: ['u1:p1'],
    });
  });

  it('lets exec override request fixtures per assertion while keeping harness db authoritative', async () => {
    const addToCart = mutation('cart/add', {
      guard(request: { db: { cart: string[] }; session?: { user?: { id: string } | null } }) {
        return Boolean(request.session?.user);
      },
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: { cart: string[] }; session?: { user?: { id: string } } }) {
        request.db.cart.push(`${request.session?.user?.id}:${input.productId}`);
        return request.db.cart;
      },
    });
    const harness = createJisoTestHarness({
      db: { cart: [] as string[] },
      request: { session: { user: { id: 'default-user' } } },
    });

    await expect(
      harness.exec(
        addToCart,
        { productId: 'p1' },
        {
          request: { session: { user: { id: 'u2' } } },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: ['u2:p1'],
    });
    await expect(harness.exec(addToCart, { productId: 'p2' })).resolves.toMatchObject({
      ok: true,
      value: ['u2:p1', 'default-user:p2'],
    });

    const assertDbOverrideRejected = () => {
      void harness.exec(
        addToCart,
        { productId: 'p3' },
        {
          // @ts-expect-error Per-exec request fixtures cannot replace the harness db.
          request: { db: { cart: [] as string[] } },
        },
      );
    };
    expect(assertDbOverrideRejected).toBeTypeOf('function');
  });

  it('exposes a stable db handle for direct harness assertions', async () => {
    const harness = createJisoTestHarness({ db: { cart: [] as string[] } });

    expect(harness.dbHandle()).toBe(harness.db);
    harness.dbHandle().cart.push('direct');

    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: { cart: string[] } }) {
        request.db.cart.push(input.productId);
        return request.db.cart;
      },
    });

    await expect(harness.exec(addToCart, { productId: 'p1' })).resolves.toMatchObject({
      ok: true,
      value: ['direct', 'p1'],
    });
  });

  it('exposes the verifier-wrapped db handle for direct observed operations', () => {
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

    harness.dbHandle().write('cart_items', 'p1');

    expect(harness.dbHandle().read('cart_items')).toEqual(['p1']);
  });

  it('returns no verification diagnostics when verification is not configured', () => {
    const harness = createJisoTestHarness({ db: createFakeDb() });

    expect(harness.verificationDiagnostics()).toEqual([]);
  });

  it('asserts typed mutation error paths without rendering a browser', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input, request: { db: { stock: number } }, context) {
        if (input.quantity > request.db.stock) {
          return context.fail('OUT_OF_STOCK', { availableQuantity: request.db.stock });
        }

        return { added: input.quantity };
      },
    });
    const harness = createJisoTestHarness({ db: { stock: 0 } });

    const result = await harness.exec(addToCart, { productId: 'p1', quantity: 2 });
    const payload = assertMutationError(addToCart, result, {
      code: 'OUT_OF_STOCK',
      payload: { availableQuantity: 0 },
    });

    const typedPayload: { availableQuantity: number } = payload;
    expect(typedPayload.availableQuantity).toBe(0);

    const assertDeclaredErrorCodes = () => {
      // @ts-expect-error UNKNOWN_ERROR is not declared by this mutation's errors schema.
      assertMutationError(addToCart, result, 'UNKNOWN_ERROR');
    };
    expect(assertDeclaredErrorCodes).toBeTypeOf('function');
  });

  it('reports mutation error-path assertion mismatches', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
        PRICE_CHANGED: s.object({ currentPrice: s.number().min(0) }),
      },
      input: s.object({ quantity: s.number().int().min(1) }),
      handler(input, request: { db: { stock: number } }, context) {
        if (input.quantity > request.db.stock) {
          return context.fail('OUT_OF_STOCK', { availableQuantity: request.db.stock });
        }

        return { added: input.quantity };
      },
    });
    const failingHarness = createJisoTestHarness({ db: { stock: 0 } });
    const successHarness = createJisoTestHarness({ db: { stock: 5 } });

    const failure = await failingHarness.exec(addToCart, { quantity: 2 });
    expect(() => assertMutationError(addToCart, failure, 'PRICE_CHANGED')).toThrow(
      'Expected cart/add to fail with PRICE_CHANGED, got OUT_OF_STOCK.',
    );
    expect(() =>
      assertMutationError(addToCart, failure, {
        code: 'OUT_OF_STOCK',
        payload: { availableQuantity: 1 },
      }),
    ).toThrow(
      'Expected cart/add error OUT_OF_STOCK payload {"availableQuantity":1}, got {"availableQuantity":0}.',
    );

    const success = await successHarness.exec(addToCart, { quantity: 2 });
    expect(() => assertMutationError(addToCart, success, 'OUT_OF_STOCK')).toThrow(
      'Expected cart/add to fail with OUT_OF_STOCK, but it succeeded.',
    );
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

  it('asserts explicitly wrapped fragments with normal HTML attribute variants', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart':
          "<fw-fragment strategy='morph' target='cart-badge'><cart-badge><span>1</span></cart-badge></fw-fragment>",
      },
    });

    await expect(harness.page('/cart').then((page) => page.fragment('cart-badge'))).resolves.toBe(
      '<cart-badge><span>1</span></cart-badge>',
    );
  });

  it('asserts stamped fragment targets without matching unrelated fw-deps elements', async () => {
    const harness = createJisoTestHarness({
      db: {},
      pages: {
        '/cart':
          '<section fw-c=\'cart-badge\'><span>1</span></section><cart-form fw-deps="cart"><button>Add</button></cart-form>',
      },
    });

    const page = await harness.page('/cart');

    expect(page.fragment('cart-badge')).toBe("<section fw-c='cart-badge'><span>1</span></section>");
    expect(page.fragment('cart-form')).toBe(
      '<cart-form fw-deps="cart"><button>Add</button></cart-form>',
    );
    expect(page.fragment('missing-target')).toBe('');
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

  it('exposes verification diagnostics through the harness context', async () => {
    const cartMutation = mutation('cart/add', {
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

  it('scopes harness write verification to the executed mutation graph entry', async () => {
    const cartMutation = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('products', input.productId);
        return input.productId;
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart/add': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
        'product/update': {
          touches: [
            { domain: 'product', keys: null, site: 'product.domain.ts:1', via: 'products' },
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

    await expect(
      harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart/add' }),
    ).rejects.toThrow('FW402 Write touched an undeclared domain: product');
  });

  it('uses explicit harness touch graph keys when mutation keys differ from graph entries', async () => {
    const cartMutation = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('cart_items', input.productId);
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

    await expect(
      harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart.addItem' }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
  });

  it('keeps scoped FW406 coverage tied to the executed mutation graph entry', async () => {
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
        'cart/add': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
        'audit/raw': {
          touches: [],
          unresolved: [
            {
              code: 'FW406',
              domain: 'audit',
              message: 'Statically un-analyzable write site; manual touches required.',
              site: 'audit.domain.ts:1',
            },
          ],
        },
      },
      verification: {
        domainByTable: {
          audit_log: 'audit',
          cart_items: 'cart',
        },
      },
    });

    await expect(
      harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart/add' }),
    ).rejects.toThrow('FW402 Write touched an undeclared domain: audit');
  });

  it('allows scoped writes covered by same-entry FW406 annotations', async () => {
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
        'cart/add': {
          touches: [],
          unresolved: [
            {
              code: 'FW406',
              domain: 'audit',
              message: 'Statically un-analyzable write site; manual touches required.',
              site: 'cart.domain.ts:9',
            },
          ],
        },
      },
      verification: {
        domainByTable: {
          audit_log: 'audit',
        },
      },
    });

    await expect(
      harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart/add' }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
  });

  it('checks only writes observed during the current mutation exec', async () => {
    const cartMutation = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('cart_items', input.productId);
        return input.productId;
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart/add': {
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

    harness.db.write('audit_log', 'previous');

    await expect(
      harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart/add' }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
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

  it('verifies raw SQL writes against the static touch graph', async () => {
    const cartMutation = mutation('cart/add', {
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

  it('rejects observed writes covered only by unscoped FW406 static analysis', () => {
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

    expect(() => verifier.assertCovered()).toThrow(
      'FW402 Write touched an undeclared domain: audit',
    );
  });

  it('allows observed writes when unscoped FW406 is backed by declared touches', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:8', via: 'audit_log' }],
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

  it('limits domain-scoped FW406 coverage to the annotated domain', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [],
          unresolved: [
            {
              code: 'FW406',
              domain: 'audit',
              message: 'Statically un-analyzable write site; manual touches required.',
              site: 'cart.domain.ts:9',
            },
          ],
        },
      },
      { domainByTable: { audit_log: 'audit', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('audit_log', 'p1');
    db.write('products', 'p1');

    expect(() => verifier.assertCovered()).toThrow(
      'FW402 Write touched an undeclared domain: product',
    );
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

  it('warns when a declared conditional write branch is never observed', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [
            {
              branch: 'stock-reserve',
              domain: 'product',
              keys: 'arg:productId',
              site: 'cart.domain.ts:12',
              via: 'products',
            },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' } },
    );

    expect(verifier.diagnostics()).toEqual([
      {
        branch: 'stock-reserve',
        code: 'FW405',
        domain: 'product',
        message: 'Conditional write branch was never executed under instrumentation.',
        severity: 'warn',
        site: 'cart.domain.ts:12',
      },
      {
        code: 'FW403',
        domain: 'product',
        message: 'Declared domain was never observed written.',
        severity: 'warn',
      },
    ]);
  });

  it('does not warn for conditional write branches observed under instrumentation', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [
            {
              branch: 'stock-reserve',
              domain: 'product',
              keys: 'arg:productId',
              site: 'cart.domain.ts:12',
              via: 'products',
            },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('products', { id: 'p1' }, { branch: 'stock-reserve' });

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

  it('executes query loaders and verifies reads against declared domains', async () => {
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
      load() {
        return harness.db.read('cart_items');
      },
      reads: [cart],
    });

    db.write('cart_items', 'p1');

    await expect(harness.query(cartQuery)).resolves.toEqual(['p1']);
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

    await expect(harness.query(cartQuery)).rejects.toThrow(
      'FW407 Query read from undeclared domain: product',
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
      'FW407 Query read from undeclared domain: unmapped_table',
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
      'FW407 Query read from undeclared domain: product',
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
      'FW407 Query read from undeclared domain: product',
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
      'FW407 Query read from undeclared domain: vendor',
    );
  });

  it('verifies insert-select SQL as a target write plus source reads', async () => {
    const productImport = mutation('product/import', {
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
