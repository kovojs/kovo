import { describe, expect, it, vi } from 'vitest';

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

  it('F2: a throwing survivor transform during applyServerTruth lands on settled server truth, not the stale prediction', () => {
    // SPEC §10.4 line 1129 / KV313: when a pending transform throws while rebasing over
    // arriving server truth (e.g. a concurrent delete made truth `{items:null}` but the
    // transform does `items.push`), the runtime MUST present the SETTLED server truth, drop
    // the throwing prediction, and report it — never freeze the pre-truth prediction on screen
    // nor discard the server truth.
    const store = createQueryStore();
    const onError = vi.fn();
    const rebaser = new OptimisticRebaser(store, { onError });
    store.set('cart', { items: [{ id: 'a' }] });
    const pushTransform = (draft: unknown) => {
      (draft as { items: { id: string }[] }).items.push({ id: 'draft' });
    };

    rebaser.add('m1', {}, { transforms: { cart: pushTransform } });
    expect(store.get('cart')).toEqual({ items: [{ id: 'a' }, { id: 'draft' }] });

    // A concurrent delete makes server truth `{items:null}`; re-applying the push throws.
    expect(() => rebaser.applyServerTruth('cart', { items: null })).not.toThrow();

    // The store must reflect the settled server truth, not the stale `{items:[...draft]}`.
    expect(store.get('cart')).toEqual({ items: null });
    // The throwing transform is dropped (KV313) and reported.
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('F2: a surviving transform still rebases after an earlier sibling throws', () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const rebaser = new OptimisticRebaser(store, { onError });
    store.set('cart', { items: [{ id: 'a' }], count: 0 });

    const throwing = (draft: unknown) => {
      (draft as { items: { id: string }[] }).items.push({ id: 'm1' });
    };
    const safe = (draft: unknown) => {
      (draft as { count: number }).count += 10;
    };

    rebaser.add('m1', {}, { transforms: { cart: throwing } });
    rebaser.add('m2', {}, { transforms: { cart: safe } });

    // Truth makes items null (m1's push throws) but count is present (m2's add applies).
    rebaser.applyServerTruth('cart', { items: null, count: 5 });

    expect(store.get('cart')).toEqual({ items: null, count: 15 });
    expect(rebaser.pendingCount('cart')).toBe(1); // only m2 survives
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('F3: a transform that throws on enqueue does not orphan a pending entry', () => {
    // SPEC §10.4: addChange records pending then applies. If the transform throws on enqueue
    // (store value undefined/wrong shape), the pending entry must NOT be recorded — otherwise
    // every future applyServerTruth re-runs the throwing transform and throws forever.
    const store = createQueryStore();
    const onError = vi.fn();
    const rebaser = new OptimisticRebaser(store, { onError });
    // Unseeded store: `store.get('cart')` is undefined; `d.count += 1` throws on undefined.
    const add = (draft: unknown) => {
      (draft as { count: number }).count += 1;
    };

    expect(() => rebaser.add('m1', {}, { transforms: { cart: add } })).not.toThrow();

    // No orphaned pending entry; a later server truth must not re-throw.
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(() => rebaser.applyServerTruth('cart', { count: 9 })).not.toThrow();
    expect(store.get('cart')).toEqual({ count: 9 });
  });

  it('F3: a throwing enqueue restores earlier in-call store writes and reports', () => {
    // A plan touching two queries where the second transform throws must not leave the first
    // query mutated with the second orphaned: roll back the earlier write in the same call.
    const store = createQueryStore();
    const onError = vi.fn();
    const rebaser = new OptimisticRebaser(store, { onError });
    store.set('cart', { count: 1 });
    // `reviews` is unseeded → throws.
    const addCart = (draft: unknown) => {
      (draft as { count: number }).count += 1;
    };
    const addReviews = (draft: unknown) => {
      (draft as { items: unknown[] }).items.push({});
    };

    rebaser.add('m1', {}, { transforms: { cart: addCart, reviews: addReviews } });

    // Neither query keeps a pending prediction; cart is restored to its pre-call value.
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(rebaser.pendingCount('reviews')).toBe(0);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(onError).toHaveBeenCalled();
  });

  it('F4: applyServerTruth refreshes the baseline so a later rollback keeps an out-of-band write', () => {
    // SPEC §10.4: an external server-truth write (a concurrent broadcast/refetch) routed through
    // the rebaser must refresh the captured baseline. A subsequent failed mutation rollback then
    // re-derives from the FRESH baseline, never reverting the out-of-band committed value.
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const inc = (draft: unknown) => {
      (draft as { count: number }).count += 1;
    };

    // m1 predicts +1 over baseline 0 → store 1.
    rebaser.add('m1', {}, { transforms: { cart: inc } });
    expect(store.get('cart')).toEqual({ count: 1 });

    // A concurrent same-user broadcast commits {count:100}, routed through the rebaser so it
    // refreshes the baseline and re-applies m1's pending prediction → store 101, baseline 100.
    rebaser.applyServerTruth('cart', { count: 100 });
    expect(store.get('cart')).toEqual({ count: 101 });

    // m1 fails → rollback must re-derive from the refreshed baseline (100), not the frozen 0.
    rebaser.settleWithoutServerTruth('m1', 'cart');
    expect(store.get('cart')).toEqual({ count: 100 });
  });

  it('rebases and rolls back with structural sharing for untouched server truth', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const baseUntouched = { rows: Array.from({ length: 32 }, (_value, id) => ({ id })) };
    const base = { count: 0, untouched: baseUntouched };
    const truthUntouched = { rows: [{ id: 'server-row' }] };
    const truth = { count: 10, untouched: truthUntouched };
    store.set('cart', base);

    rebaser.add(
      'm1',
      { quantity: 2 },
      {
        transforms: {
          cart(draft, input) {
            const cart = draft as typeof base;
            cart.count += input.quantity;
          },
        },
      },
    );

    const predicted = store.get<typeof base>('cart')!;
    expect(predicted).not.toBe(base);
    expect(predicted.untouched).toBe(baseUntouched);

    rebaser.applyServerTruth('cart', truth);
    const rebased = store.get<typeof truth>('cart')!;
    expect(rebased).not.toBe(truth);
    expect(rebased.count).toBe(12);
    expect(rebased.untouched).toBe(truthUntouched);

    rebaser.settleWithoutServerTruth('m1', 'cart');
    expect(store.get('cart')).toBe(truth);
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
