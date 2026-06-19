import { describe, expect, it } from 'vitest';

import { createQueryStore } from './client.js';
import { OptimisticRebaser } from './optimism.js';

// SPEC.md §10.4: the OptimisticRebaser replays pending predictions over arriving
// server truth and discards them on navigation; split from the runtime apply and
// compile-time typing seams in the sibling optimism-*.test.ts files.
describe('optimistic query rebase', () => {
  it('rebases pending optimistic transforms over arriving server truth', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const transform = (draft: unknown, input: { quantity: number }) => {
      const cart = draft as { count: number };
      cart.count += input.quantity;
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
    const transform = (draft: unknown, input: { reviewId: string }) => {
      const reviews = draft as { items: { id: string }[] };
      reviews.items.push({ id: input.reviewId });
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
    const transform = (draft: unknown, input: { quantity: number }) => {
      const cart = draft as { count: number };
      cart.count += input.quantity;
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
