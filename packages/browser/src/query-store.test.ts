import { describe, expect, it, vi } from 'vitest';

import { createQueryStore, queryWireKey, splitQueryWireKey } from './query-store.js';

// SPEC §9.4/§10.2 (F5): the typed-read endpoint dispatches by query NAME, so a
// refetch must split the canonical `name:keyValue` wireKey and use the name as
// the path. `splitQueryWireKey` is the inverse of `queryWireKey`.
describe('splitQueryWireKey (F5)', () => {
  it('splits a keyed wireKey into its name and instance key value', () => {
    expect(splitQueryWireKey('recommendations:user-1')).toEqual({
      keyValue: 'user-1',
      name: 'recommendations',
    });
  });

  it('returns just the name for an unkeyed wireKey', () => {
    expect(splitQueryWireKey('cart')).toEqual({ name: 'cart' });
  });

  it('keeps colons after the first inside the instance key value', () => {
    // The instance key value itself may contain colons (e.g. a composite key).
    expect(splitQueryWireKey('product:a:b')).toEqual({ keyValue: 'a:b', name: 'product' });
  });

  it('does not dispatch canonical query identities through late String prototype changes', () => {
    const indexOf = Object.getOwnPropertyDescriptor(String.prototype, 'indexOf');
    const slice = Object.getOwnPropertyDescriptor(String.prototype, 'slice');
    const startsWith = Object.getOwnPropertyDescriptor(String.prototype, 'startsWith');
    if (!indexOf || !slice || !startsWith) throw new Error('Missing String security descriptors');
    Object.defineProperty(String.prototype, 'indexOf', { ...indexOf, value: () => -1 });
    Object.defineProperty(String.prototype, 'slice', { ...slice, value: () => 'attacker' });
    Object.defineProperty(String.prototype, 'startsWith', { ...startsWith, value: () => false });
    try {
      expect(splitQueryWireKey('recommendations:user-1')).toEqual({
        keyValue: 'user-1',
        name: 'recommendations',
      });
      expect(queryWireKey('recommendations', 'recommendations:user-1')).toBe(
        'recommendations:user-1',
      );
    } finally {
      Object.defineProperty(String.prototype, 'indexOf', indexOf);
      Object.defineProperty(String.prototype, 'slice', slice);
      Object.defineProperty(String.prototype, 'startsWith', startsWith);
    }
  });
});

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
    it('prunes an empty subscription slot and leaves it reusable', () => {
      const store = createQueryStore();
      const retired = vi.fn();
      const unsubscribe = store.subscribe('reviews', retired, 'product:p1');
      unsubscribe();
      unsubscribe();
      const live = vi.fn();
      store.subscribe('reviews', live, 'product:p1');
      store.set('reviews', { items: ['p2'] }, 'product:p1');

      expect(retired).not.toHaveBeenCalled();
      expect(live).toHaveBeenCalledWith({ items: ['p2'] });
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

  it('retains query truth and subscriptions after late Map/Set prototype poisoning', () => {
    const store = createQueryStore();
    const plan = vi.fn();
    store.subscribe('cart', plan);
    const methods = [
      [Map.prototype, 'get', () => undefined],
      [
        Map.prototype,
        'set',
        function (this: Map<unknown, unknown>) {
          return this;
        },
      ],
      [Map.prototype, 'has', () => false],
      [
        Set.prototype,
        'add',
        function (this: Set<unknown>) {
          return this;
        },
      ],
      [Set.prototype, 'forEach', () => undefined],
    ] as const;
    const descriptors = methods.map(([prototype, name]) => {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (!descriptor) throw new Error(`Missing collection method ${name}`);
      return { descriptor, name, prototype };
    });
    for (let index = 0; index < methods.length; index += 1) {
      const [prototype, name, value] = methods[index]!;
      const descriptor = descriptors[index]!.descriptor;
      Object.defineProperty(prototype, name, { ...descriptor, value });
    }
    let value;
    try {
      store.set('cart', { count: 4 });
      value = store.get('cart');
    } finally {
      for (const { descriptor, name, prototype } of descriptors) {
        Object.defineProperty(prototype, name, descriptor);
      }
    }

    // SPEC §6.6/§9.4: server query truth and its update subscribers are framework-owned
    // state; authored modules cannot erase or redirect them by replacing collection methods.
    expect(value).toEqual({ count: 4 });
    expect(plan).toHaveBeenCalledWith({ count: 4 });
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
