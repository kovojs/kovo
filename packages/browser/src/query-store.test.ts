import { describe, expect, it, vi } from 'vitest';

import { createQueryStore, queryStoreKey } from './query-store.js';

describe('query store', () => {
  it('runs update plans whenever a query value changes', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    const unsubscribe = store.subscribe<{ count: number }>('cart', plan);
    store.set('cart', { count: 1 });
    unsubscribe();
    store.set('cart', { count: 2 });

    expect(plan).toHaveBeenCalledTimes(1);
    expect(plan).toHaveBeenCalledWith({ count: 1 });
  });

  // L7-1 / SPEC §9.4: unsubscribe must prune the now-empty subscriber Set so the
  // internal `plans` map does not leak one empty Set per distinct `(name, key)`.
  describe('subscriber Set pruning (L7-1)', () => {
    it('prunes the empty Set from the internal plans map on unsubscribe', () => {
      // The `plans` map is module-private, so observe the prune by spying on the
      // Map the store creates internally: a `Map.prototype.delete` call for the
      // store key proves the now-empty Set was removed rather than retained.
      const mapDelete = vi.spyOn(Map.prototype, 'delete');
      try {
        const store = createQueryStore();
        mapDelete.mockClear();

        const unsubscribe = store.subscribe('reviews', vi.fn(), 'product:p1');
        // The internal store key for ('reviews','product:p1') (queryStoreKey uses \0).
        const storeKey = queryStoreKey('reviews', 'product:p1');
        expect(mapDelete).not.toHaveBeenCalledWith(storeKey);

        unsubscribe();

        // The empty Set is pruned: plans.delete(storeKey) fired during unsubscribe.
        expect(mapDelete).toHaveBeenCalledWith(storeKey);
      } finally {
        mapDelete.mockRestore();
      }
    });

    it('still receives updates after a re-subscribe to a pruned key', () => {
      const store = createQueryStore();
      const first = vi.fn();
      const unsubscribe = store.subscribe('reviews', first, 'product:p1');
      unsubscribe();

      const second = vi.fn();
      store.subscribe('reviews', second, 'product:p1');
      store.set('reviews', { items: [] }, 'product:p1');

      // The recreated Set carries only the live subscriber.
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith({ items: [] });
    });

    it('does not delete a Set that a later subscribe replaced for the same key', () => {
      // The re-resolve guard: subscribe A, subscribe B (same key), unsubscribe A.
      // A late unsubscribe must NOT delete B's live Set. (Here both share one Set,
      // but the guard also protects against a future replacement.)
      const store = createQueryStore();
      const a = vi.fn();
      const b = vi.fn();
      const unsubscribeA = store.subscribe('cart', a);
      store.subscribe('cart', b);
      unsubscribeA();

      store.set('cart', { count: 3 });
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledWith({ count: 3 });
    });
  });

  // L7-2 / SPEC §9.4: rotating server-authored `<kovo-query key>` instances must be
  // evictable so the `values` map does not grow without bound for the session.
  describe('value eviction (L7-2)', () => {
    it('clear() empties the values map but preserves subscriptions', () => {
      const store = createQueryStore();
      const plan = vi.fn();
      store.subscribe('cart', plan);
      store.set('cart', { count: 1 });
      store.set('reviews', { items: [] }, 'product:p1');

      store.clear();

      // All held values are released.
      expect(store.get('cart')).toBeUndefined();
      expect(store.get('reviews', 'product:p1')).toBeUndefined();

      // The subscription survives a clear so the store can be re-hydrated.
      plan.mockClear();
      store.set('cart', { count: 2 });
      expect(plan).toHaveBeenCalledWith({ count: 2 });
    });

    it('delete(name, key) evicts a single rotating instance key', () => {
      const store = createQueryStore();
      store.set('reviews', { items: ['a'] }, 'product:p1');
      store.set('reviews', { items: ['b'] }, 'product:p2');

      store.delete('reviews', 'product:p1');

      expect(store.get('reviews', 'product:p1')).toBeUndefined();
      // Sibling keys are untouched.
      expect(store.get('reviews', 'product:p2')).toEqual({ items: ['b'] });
    });

    it('delete() handles the unkeyed query identity', () => {
      const store = createQueryStore();
      store.set('cart', { count: 1 });

      store.delete('cart');

      expect(store.get('cart')).toBeUndefined();
    });
  });
});
