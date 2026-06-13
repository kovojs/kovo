import { describe, expect, it, vi } from 'vitest';
import { form } from '@jiso/core';

import { createQueryStore } from './query-store.js';
import { applyOptimisticTransforms, OptimisticRebaser, type OptimisticFor } from './optimism.js';

declare module '@jiso/core' {
  interface InvalidationSets {
    'cart/add': 'cart' | 'productGrid';
  }

  interface QueryRegistry {
    cart: { count: number };
    productGrid: { products: { id: string; pending: boolean }[] };
  }
}

describe('optimistic query runtime', () => {
  it('applies hand-written optimistic transforms through query update plans', () => {
    const store = createQueryStore();
    const plan = vi.fn();
    store.set('cart', { count: 1 });
    store.subscribe('cart', plan);

    const pending = applyOptimisticTransforms(
      store,
      { quantity: 2 },
      {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
    );

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(plan).toHaveBeenLastCalledWith({ count: 3 });
    pending.commit();
    expect(pending.snapshot.size).toBe(0);
  });

  it('applies hand-written optimistic transforms to keyed query instances', () => {
    const store = createQueryStore();
    const p1Plan = vi.fn();
    const unkeyedPlan = vi.fn();
    store.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
    store.subscribe('reviews', p1Plan, 'product:p1');
    store.subscribe('reviews', unkeyedPlan);

    const pending = applyOptimisticTransforms(
      store,
      { reviewId: 'draft' },
      {
        keys: { reviews: 'product:p1' },
        transforms: {
          reviews(current, input) {
            const reviews = current as { items: { id: string }[] };
            return { items: [...reviews.items, { id: input.reviewId }] };
          },
        },
      },
    );

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'draft' }],
    });
    expect(p1Plan).toHaveBeenLastCalledWith({ items: [{ id: 'r1' }, { id: 'draft' }] });
    expect(unkeyedPlan).not.toHaveBeenCalled();

    pending.restore();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1' }] });
  });

  it('applies optimistic transforms from unified change records and derives query keys', () => {
    const store = createQueryStore();
    const keyedPlan = vi.fn();
    const unkeyedPlan = vi.fn();
    store.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
    store.subscribe('reviews', keyedPlan, 'product:p1');
    store.subscribe('reviews', unkeyedPlan);

    const pending = applyOptimisticTransforms(
      store,
      { reviewId: 'ignored' },
      {
        keys: {
          reviews: (change) => `product:${change.keys?.[0]}`,
        },
        transforms: {
          reviews(current, input) {
            const reviews = current as { items: { id: string }[] };
            return { items: [...reviews.items, { id: input.reviewId }] };
          },
        },
      },
      {
        domain: 'product',
        input: { reviewId: 'draft-from-change' },
        keys: ['p1'],
      },
    );

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'draft-from-change' }],
    });
    expect(keyedPlan).toHaveBeenLastCalledWith({
      items: [{ id: 'r1' }, { id: 'draft-from-change' }],
    });
    expect(unkeyedPlan).not.toHaveBeenCalled();

    pending.restore();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1' }] });
  });

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

  it('restores optimistic snapshots on mutation error', () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });

    const pending = applyOptimisticTransforms(
      store,
      { quantity: 2 },
      {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
    );

    expect(store.get('cart')).toEqual({ count: 3 });
    pending.restore();
    expect(store.get('cart')).toEqual({ count: 1 });
  });

  it('rebases pending optimistic transforms over arriving server truth', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const transform = (current: unknown, input: { quantity: number }) => {
      const cart = current as { count: number };
      return { count: cart.count + input.quantity };
    };

    rebaser.add('m1', { quantity: 1 }, { transforms: { cart: transform } });
    rebaser.add('m2', { quantity: 2 }, { transforms: { cart: transform } });

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(rebaser.pendingCount('cart')).toBe(2);

    rebaser.applyServerTruth('cart', { count: 10 });

    expect(store.get('cart')).toEqual({ count: 13 });

    rebaser.settle('m1');
    rebaser.applyServerTruth('cart', { count: 11 });

    expect(store.get('cart')).toEqual({ count: 13 });
    expect(rebaser.pendingCount('cart')).toBe(1);
  });

  it('rebases pending optimistic transforms over keyed server truth', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
    const transform = (current: unknown, input: { reviewId: string }) => {
      const reviews = current as { items: { id: string }[] };
      return { items: [...reviews.items, { id: input.reviewId }] };
    };

    rebaser.add(
      'm1',
      { reviewId: 'draft-1' },
      {
        keys: { reviews: 'product:p1' },
        transforms: { reviews: transform },
      },
    );
    rebaser.add(
      'm2',
      { reviewId: 'draft-2' },
      {
        keys: { reviews: 'product:p1' },
        transforms: { reviews: transform },
      },
    );

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'draft-1' }, { id: 'draft-2' }],
    });
    expect(rebaser.pendingCount('reviews', 'product:p1')).toBe(2);

    rebaser.applyServerTruth('reviews', { items: [{ id: 'r1' }, { id: 'server' }] }, 'product:p1');

    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'server' }, { id: 'draft-1' }, { id: 'draft-2' }],
    });

    rebaser.settle('m1');
    rebaser.applyServerTruth('reviews', { items: [{ id: 'r1' }, { id: 'server' }] }, 'product:p1');

    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'server' }, { id: 'draft-2' }],
    });
    expect(rebaser.pendingCount('reviews', 'product:p1')).toBe(1);
  });

  it('discards pending optimistic transforms back to server truth on pagehide', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const transform = (current: unknown, input: { quantity: number }) => {
      const cart = current as { count: number };
      return { count: cart.count + input.quantity };
    };

    rebaser.add('m1', { quantity: 1 }, { transforms: { cart: transform } });
    rebaser.add('m2', { quantity: 2 }, { transforms: { cart: transform } });
    rebaser.applyServerTruth('cart', { count: 10 });

    // SPEC.md §10.4: pending optimistic predictions die with page navigation,
    // restoring the most recent server truth for affected query instances.
    expect(store.get('cart')).toEqual({ count: 13 });
    expect(rebaser.discardPendingOptimism()).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 10 });
    expect(rebaser.pendingCount('cart')).toBe(0);
  });
});
