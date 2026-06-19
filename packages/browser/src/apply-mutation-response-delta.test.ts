/**
 * Tests for SPEC §9.1.1 production wire delta support in the mutation response
 * apply path: build-token mismatch routing, onDeltaMiss threading, and full
 * chunks still applying during a mismatch.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  applyMutationResponseBodyToRuntime,
  applyMutationResponseChunksToRuntime,
} from './apply-mutation-response.js';
import { createQueryStore } from './query-store.js';

describe('apply-mutation-response delta / build-token (SPEC §9.1.1)', () => {
  it('applies a delta chunk against a base in the store', () => {
    const store = createQueryStore();
    store.set('cart', { count: 1, items: [{ id: 'p1', qty: 1 }] });
    const onDeltaMiss = vi.fn();

    const result = applyMutationResponseBodyToRuntime({
      body: '<kovo-query name="cart" delta>{"set":{"count":2},"lists":{"items":{"key":"id","upsert":[{"id":"p1","qty":2}]}}}</kovo-query>',
      onDeltaMiss,
      store,
    });

    expect(result.queries).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 2, items: [{ id: 'p1', qty: 2 }] });
    expect(onDeltaMiss).not.toHaveBeenCalled();
  });

  it('routes a delta chunk to onDeltaMiss when the base is missing', () => {
    const store = createQueryStore();
    const onDeltaMiss = vi.fn();

    const result = applyMutationResponseBodyToRuntime({
      body: '<kovo-query name="cart" delta>{"set":{"count":2}}</kovo-query>',
      onDeltaMiss,
      store,
    });

    // Delta miss: the chunk was not applied.
    expect(result.queries).toEqual([]);
    expect(store.get('cart')).toBeUndefined();
    expect(onDeltaMiss).toHaveBeenCalledWith('cart', undefined);
  });

  it('routes delta chunks to onDeltaMiss on build-token mismatch, applies full chunks normally', () => {
    // SPEC §9.1.1: when responseBuildToken !== expectedBuildToken, all delta
    // chunks become misses; full chunks still apply.
    const store = createQueryStore();
    store.set('cart', { count: 1 });
    const onDeltaMiss = vi.fn();

    const result = applyMutationResponseChunksToRuntime(
      {
        fragments: [],
        queries: [
          { delta: true, name: 'cart', value: { set: { count: 2 } } },
          { name: 'inventory', value: { available: false } },
        ],
      },
      {
        expectedBuildToken: 'build-1',
        responseBuildToken: 'build-2',
        onDeltaMiss,
        store,
      },
    );

    // Delta was a miss (token mismatch); full inventory chunk applied.
    expect(result.queries).toEqual(['inventory']);
    expect(store.get('cart')).toEqual({ count: 1 }); // unchanged
    expect(store.get('inventory')).toEqual({ available: false });
    expect(onDeltaMiss).toHaveBeenCalledWith('cart', undefined);
  });

  it('applies delta chunks normally when build tokens match', () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });
    const onDeltaMiss = vi.fn();

    const result = applyMutationResponseChunksToRuntime(
      {
        fragments: [],
        queries: [{ delta: true, name: 'cart', value: { set: { count: 3 } } }],
      },
      {
        expectedBuildToken: 'build-1',
        responseBuildToken: 'build-1',
        onDeltaMiss,
        store,
      },
    );

    expect(result.queries).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 3 });
    expect(onDeltaMiss).not.toHaveBeenCalled();
  });

  it('applies delta chunks normally when no build tokens are provided', () => {
    // When neither expectedBuildToken nor responseBuildToken is set, no token
    // validation occurs (SPEC §9.1.1 — both must be present to validate).
    const store = createQueryStore();
    store.set('cart', { count: 1 });

    const result = applyMutationResponseChunksToRuntime(
      {
        fragments: [],
        queries: [{ delta: true, name: 'cart', value: { set: { count: 4 } } }],
      },
      { store },
    );

    expect(result.queries).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 4 });
  });

  it('drops delta chunks silently on build-token mismatch when no onDeltaMiss is provided', () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });

    const result = applyMutationResponseChunksToRuntime(
      {
        fragments: [],
        queries: [
          { delta: true, name: 'cart', value: { set: { count: 99 } } },
          { name: 'inventory', value: { available: true } },
        ],
      },
      {
        expectedBuildToken: 'build-1',
        responseBuildToken: 'build-2',
        store,
      },
    );

    // Delta chunk dropped silently; full chunk applied.
    expect(result.queries).toEqual(['inventory']);
    expect(store.get('cart')).toEqual({ count: 1 }); // unchanged
  });
});
