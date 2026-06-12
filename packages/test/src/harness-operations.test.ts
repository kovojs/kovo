import { describe, expect, it } from 'vitest';

import { domain, mutation, query, s } from '@jiso/server';
import {
  executeHarnessMutation,
  executeHarnessQuery,
  loadHarnessPage,
  type HarnessOperationVerifier,
} from './harness-operations.js';
import { createFakeDb, expectedDiagnostic, type FakeDb } from './test-fixtures.js';
import type { ObservedDbOperation } from './verifier.js';

function createRecordingVerifier(observed: readonly ObservedDbOperation[]): {
  coveredKey: string | undefined;
  reads: readonly string[] | undefined;
  verifier: HarnessOperationVerifier;
} {
  const state: {
    coveredKey: string | undefined;
    reads: readonly string[] | undefined;
    verifier: HarnessOperationVerifier;
  } = {
    coveredKey: undefined,
    reads: undefined,
    verifier: {
      assertCoveredOperations(operations, touchGraphKey) {
        expect(operations).toBe(observed);
        state.coveredKey = touchGraphKey;
      },
      assertReadsCoveredOperations(operations, domains) {
        expect(operations).toBe(observed);
        state.reads = domains;
      },
      async capture(callback) {
        return {
          observed,
          result: await callback(),
        };
      },
    },
  };

  return state;
}

describe('@jiso/test harness operations', () => {
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
    const state = createRecordingVerifier(observed);
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
    const state = createRecordingVerifier(observed);
    const cartQuery = query('cart', {
      load() {
        return { count: 'two' };
      },
      output: s.object({ count: s.number() }),
      reads: [cart],
    });

    await expect(
      executeHarnessQuery(cartQuery, undefined, createFakeDb(), undefined, state.verifier),
    ).rejects.toThrow(expectedDiagnostic('FW410', 'cart Expected number'));
    expect(state.reads).toEqual(['cart']);
  });

  it('loads page fixtures from literal and lazy HTML sources', async () => {
    await expect(
      loadHarnessPage(
        {
          '/cart': () =>
            '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
        },
        '/cart',
      ).then((page) => page.fragment('cart-badge')),
    ).resolves.toBe('<cart-badge>1</cart-badge>');

    await expect(loadHarnessPage({}, '/missing')).rejects.toThrow(
      'Page fixture not found: /missing',
    );
  });
});
