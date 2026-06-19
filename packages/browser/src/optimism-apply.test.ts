import { describe, expect, it, vi } from 'vitest';

import { createQueryStore } from './client.js';
import { applyOptimisticTransforms, installPagehideOptimismCleanup } from './optimism.js';
import { FakeRoot } from './runtime-test-fakes.js';

// SPEC.md §10.4: hand-written optimistic transforms apply through the query
// update plans and can commit or restore their snapshot; split from the
// compile-time typing and rebase seams in the sibling optimism-*.test.ts files.
describe('optimistic query apply', () => {
  it('registers pagehide optimism cleanup without unload handlers', () => {
    const root = new FakeRoot();
    const discardPendingOptimism = vi.fn();

    installPagehideOptimismCleanup({ discardPendingOptimism, root });

    expect(root.listeners.has('pagehide')).toBe(true);
    expect(root.listeners.has('unload')).toBe(false);

    void root.listeners.get('pagehide')?.({ target: null, type: 'pagehide' });

    expect(discardPendingOptimism).toHaveBeenCalledTimes(1);
  });

  it('also listens on the browser lifecycle target when the loader root is document-like', () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originalAddEventListener = globalRecord.addEventListener;
    const originalRemoveEventListener = globalRecord.removeEventListener;
    const root = new FakeRoot();
    const discardPendingOptimism = vi.fn();
    const globalListeners = new Map<string, () => void>();

    try {
      globalRecord.addEventListener = (type: string, listener: () => void) => {
        globalListeners.set(type, listener);
      };
      globalRecord.removeEventListener = (type: string, listener: () => void) => {
        if (globalListeners.get(type) === listener) globalListeners.delete(type);
      };

      const dispose = installPagehideOptimismCleanup({ discardPendingOptimism, root });

      expect(root.listeners.has('pagehide')).toBe(true);
      expect(globalListeners.has('pagehide')).toBe(true);

      globalListeners.get('pagehide')?.();
      expect(discardPendingOptimism).toHaveBeenCalledTimes(1);

      dispose();
      expect(root.listeners.has('pagehide')).toBe(false);
      expect(globalListeners.has('pagehide')).toBe(false);
    } finally {
      if (originalAddEventListener === undefined) delete globalRecord.addEventListener;
      else globalRecord.addEventListener = originalAddEventListener;
      if (originalRemoveEventListener === undefined) delete globalRecord.removeEventListener;
      else globalRecord.removeEventListener = originalRemoveEventListener;
    }
  });

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
          cart(draft, input) {
            const cart = draft as { count: number };
            cart.count += input.quantity;
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
          reviews(draft, input) {
            const reviews = draft as { items: { id: string }[] };
            reviews.items.push({ id: input.reviewId });
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
          reviews(draft, input) {
            const reviews = draft as { items: { id: string }[] };
            reviews.items.push({ id: input.reviewId });
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

  it('restores optimistic snapshots on mutation error', () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });

    const pending = applyOptimisticTransforms(
      store,
      { quantity: 2 },
      {
        transforms: {
          cart(draft, input) {
            const cart = draft as { count: number };
            cart.count += input.quantity;
          },
        },
      },
    );

    expect(store.get('cart')).toEqual({ count: 3 });
    pending.restore();
    expect(store.get('cart')).toEqual({ count: 1 });
  });
});
