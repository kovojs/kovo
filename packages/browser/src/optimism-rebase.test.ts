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

  it('settles every transform in the arriving truth set before rebasing (no double-count)', () => {
    // SPEC.md §9.1.1 line 828 / §10.4 line 1118: a truth chunk carries a settlement set of the
    // Kovo-Idem tokens it already reflects; the client MUST drop those pending transforms BEFORE
    // re-applying the rest. Two concurrent additive same-query commits whose truth already contains
    // both must NOT be re-applied (which would double-count the writes to 6).
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const add = (draft: unknown, input: { quantity: number }) => {
      (draft as { count: number }).count += input.quantity;
    };

    rebaser.add('A', { quantity: 1 }, { transforms: { cart: add } });
    rebaser.add('B', { quantity: 2 }, { transforms: { cart: add } });
    expect(store.get('cart')).toEqual({ count: 3 });

    rebaser.applyServerTruth('cart', { count: 3 }, undefined, ['A', 'B']);

    expect(store.get('cart')).toEqual({ count: 3 }); // settled both; NOT 6
    expect(rebaser.pendingCount('cart')).toBe(0);
  });

  it('settles only the named transforms, leaving the rest pending to rebase', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const add = (draft: unknown, input: { quantity: number }) => {
      (draft as { count: number }).count += input.quantity;
    };

    rebaser.add('A', { quantity: 1 }, { transforms: { cart: add } });
    rebaser.add('B', { quantity: 2 }, { transforms: { cart: add } });
    expect(store.get('cart')).toEqual({ count: 3 });

    // Truth reflects A's commit only; B stays pending and is re-applied over the truth.
    rebaser.applyServerTruth('cart', { count: 3 }, undefined, ['A']);

    expect(store.get('cart')).toEqual({ count: 5 }); // 3 (truth incl. A) + B(+2)
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
