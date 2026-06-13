import { describe, expect, it } from 'vitest';
import { form } from '@jiso/core';

import { type OptimisticFor } from './optimism.js';

declare module '@jiso/core' {
  interface InvalidationSets {
    'cart/add': 'cart' | 'productGrid';
  }

  interface QueryRegistry {
    cart: { count: number };
    productGrid: { products: { id: string; pending: boolean }[] };
  }
}

// SPEC.md §10.4: hand-written optimistic plans are typed from the mutation form
// input, query value shapes, and generated invalidation sets; split from the
// runtime apply and rebase seams in the sibling optimism-*.test.ts files.
describe('optimistic query typing', () => {
  it('types hand-written optimistic plans from mutation forms and query shapes', () => {
    const addToCart = form<'cart/add', { productId: string; quantity: number }>('cart/add');
    const optimistic = {
      queue: 'cart',
      transforms: {
        cart(current, input) {
          return {
            count: current.count + input.quantity,
            productIds: [...current.productIds, input.productId],
          };
        },
      },
    } satisfies OptimisticFor<typeof addToCart, { cart: { count: number; productIds: string[] } }>;

    expect(
      optimistic.transforms.cart(
        { count: 1, productIds: [] },
        {
          productId: 'p1',
          quantity: 2,
        },
      ),
    ).toEqual({
      count: 3,
      productIds: ['p1'],
    });
  });

  it('requires optimistic coverage from generated invalidation sets by default', () => {
    const addToCart = form<'cart/add', { productId: string; quantity: number }>('cart/add');
    const optimistic = {
      transforms: {
        cart(current, input) {
          return {
            count: current.count + input.quantity,
          };
        },
        productGrid: 'await-fragment',
      },
    } satisfies OptimisticFor<typeof addToCart>;

    expect(optimistic.transforms.productGrid).toBe('await-fragment');

    const assertMissingCoverageRejected = () => {
      ({
        // @ts-expect-error productGrid is invalidated by cart/add and needs a transform or await-fragment.
        transforms: {
          cart(current, input) {
            return {
              count: current.count + input.quantity,
            };
          },
        },
      }) satisfies OptimisticFor<typeof addToCart>;
    };

    expect(assertMissingCoverageRejected).toBeTypeOf('function');
  });

  it('rejects optimistic plans that do not match mutation input or query values', () => {
    const addToCart = form<'cart/add', { productId: string; quantity: number }>('cart/add');
    const assertWrongInputRejected = () => {
      ({
        transforms: {
          cart(current, input) {
            return {
              // @ts-expect-error sku is not part of the mutation input schema.
              count: current.count + input.sku,
            };
          },
        },
      }) satisfies OptimisticFor<typeof addToCart, { cart: { count: number } }>;
    };
    const assertWrongQueryValueRejected = () => {
      ({
        transforms: {
          cart(current, input) {
            return {
              // @ts-expect-error missingCount is not part of the cart query value.
              count: current.missingCount + input.quantity,
            };
          },
        },
      }) satisfies OptimisticFor<typeof addToCart, { cart: { count: number } }>;
    };

    expect(assertWrongInputRejected).toBeTypeOf('function');
    expect(assertWrongQueryValueRejected).toBeTypeOf('function');
  });
});
