import { describe, expect, it } from 'vitest';

import { domain, mutation, query, s } from '@kovojs/server';
import {
  executeHarnessMutation,
  executeHarnessQuery,
  loadHarnessPage,
} from '@kovojs/test/internal/harness-operations';
import {
  createFakeDb,
  createRecordingOperationVerifier,
  expectedDiagnostic,
  type FakeDb,
} from './test-fixtures.js';
import type { ObservedDbOperation } from './verifier.js';

describe('@kovojs/test harness operations', () => {
  it('runs mutations through captured verification and preserves the harness db request seam', async () => {
    const db = createFakeDb();
    const observed: ObservedDbOperation[] = [
      {
        branch: undefined,
        domain: 'cart',
        kind: 'write',
        mutationRead: undefined,
        rowKey: undefined,
        sql: undefined,
        table: 'cart_items',
      },
    ];
    const state = createRecordingOperationVerifier(observed);
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb; session?: { user?: { id: string } } }) {
        request.db.write('cart_items', `${request.session?.user?.id}:${input.productId}`);
        return request.db.read('cart_items');
      },
    });

    await expect(
      executeHarnessMutation(
        addToCart,
        { productId: 'p1' },
        db,
        { session: { user: { id: 'u1' } } },
        state.verifier,
        { touchGraphKey: 'cart.add' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: ['u1:p1'],
    });
    expect(state.coveredKey).toBe('cart.add');
    expect(state.captured).toEqual([observed]);
  });

  it('merges per-mutation request overrides before captured verification', async () => {
    const db = createFakeDb();
    const observed: ObservedDbOperation[] = [
      {
        branch: undefined,
        domain: 'cart',
        kind: 'write',
        mutationRead: undefined,
        rowKey: undefined,
        sql: undefined,
        table: 'cart_items',
      },
    ];
    const state = createRecordingOperationVerifier(observed);
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb; session?: { user?: { id: string } } }) {
        request.db.write('cart_items', `${request.session?.user?.id}:${input.productId}`);
        return request.db.read('cart_items');
      },
    });

    await expect(
      executeHarnessMutation(
        addToCart,
        { productId: 'p1' },
        db,
        { session: { user: { id: 'default-user' } } },
        state.verifier,
        {
          request: { session: { user: { id: 'u2' } } },
          touchGraphKey: 'cart.add',
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: ['u2:p1'],
    });
    expect(db.read('cart_items')).toEqual(['u2:p1']);
    expect(state.coveredKey).toBe('cart.add');
    expect(state.captured).toEqual([observed]);
  });

  it('runs query loaders through captured read verification before output validation', async () => {
    const cart = domain('cart');
    const observed: ObservedDbOperation[] = [
      {
        branch: undefined,
        domain: 'cart',
        kind: 'read',
        mutationRead: undefined,
        rowKey: undefined,
        sql: undefined,
        table: 'cart_items',
      },
    ];
    const state = createRecordingOperationVerifier(observed);
    const cartQuery = query('cart', {
      load() {
        return { count: 'two' };
      },
      output: s.object({ count: s.number() }),
      reads: [cart],
    });

    await expect(
      executeHarnessQuery(cartQuery, undefined, createFakeDb(), undefined, state.verifier),
    ).rejects.toThrow(expectedDiagnostic('KV410', 'cart Expected number'));
    expect(state.reads).toEqual(['cart']);
    expect(state.captured).toEqual([observed]);
  });

  it('passes query request fixtures and db through the captured loader context', async () => {
    const cart = domain('cart');
    const db = createFakeDb();
    const observed: ObservedDbOperation[] = [
      {
        branch: undefined,
        domain: 'cart',
        kind: 'read',
        mutationRead: undefined,
        rowKey: undefined,
        sql: undefined,
        table: 'cart_items',
      },
    ];
    const state = createRecordingOperationVerifier(observed);
    const cartQuery = query('cart', {
      load(
        _input,
        context?: { db: FakeDb; request: { db: FakeDb; session?: { cartId: string } } },
      ) {
        expect(context?.db).toBe(db);
        expect(context?.request.db).toBe(db);
        return {
          cartId: context?.request.session?.cartId,
          items: context?.db.read('cart_items'),
        };
      },
      reads: [cart],
    });

    db.write('cart_items', 'p1');

    await expect(
      executeHarnessQuery(cartQuery, undefined, db, { session: { cartId: 'c1' } }, state.verifier),
    ).resolves.toEqual({ cartId: 'c1', items: ['p1'] });
    expect(state.reads).toEqual(['cart']);
    expect(state.captured).toEqual([observed]);
  });

  it('loads page fixtures from literal and lazy HTML sources', async () => {
    await expect(
      loadHarnessPage(
        {
          '/cart': () =>
            '<kovo-fragment target="cart-badge"><cart-badge>1</cart-badge></kovo-fragment>',
        },
        '/cart',
        {},
        null,
      ).then((page) => page.fragment('cart-badge')),
    ).resolves.toBe('<cart-badge>1</cart-badge>');

    await expect(loadHarnessPage({}, '/missing', {}, null)).rejects.toThrow(
      'Page fixture not found: /missing',
    );
  });
});
