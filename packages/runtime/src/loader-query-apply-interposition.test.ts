import { describe, expect, it, vi } from 'vitest';

import { createQueryStore, installJisoLoader } from './index.js';
import { FakeRoot } from './runtime-test-fakes.js';

describe('loader query apply interposition', () => {
  it('hydrates initial query scripts through the configured apply hook', () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const plan = vi.fn();
    const applyQuery = vi.fn((query) => ({
      value: { count: Number(query.value.count) + 1 },
    }));

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":2}',
      },
    ];
    store.subscribe('cart', plan);

    installJisoLoader({ applyQuery, importModule: vi.fn(), queryStore: store, root });

    // SPEC.md §9.1/§9.4: loader script hydration must enter the same decoded
    // query apply path as mutation responses, typed reads, and inline events.
    expect(applyQuery).toHaveBeenCalledWith({ name: 'cart', value: { count: 2 } });
    expect(store.get('cart')).toBeUndefined();
    expect(plan).not.toHaveBeenCalled();
  });

  it('passes the loader apply hook to inline query events and typed-read visible returns', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const reviewsPlan = vi.fn();
    const applyQuery = vi.fn((query) => {
      store.set(query.name, { ...query.value, viaHook: true }, query.key);
      return { value: store.get(query.name, query.key) };
    });
    const fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<fw-query name="reviews">{"total":3}</fw-query>',
    }));

    store.subscribe('cart', cartPlan);
    store.subscribe('reviews', reviewsPlan);

    installJisoLoader({
      applyQuery,
      importModule: vi.fn(),
      queryRefetch: { fetch },
      queryStore: store,
      refetchOnFocus: vi.fn(),
      root,
    });

    const queryEventListener = root.listeners.get('jiso:query') as
      | ((event: { detail?: unknown }) => void)
      | undefined;
    queryEventListener?.({
      detail: {
        attrs: ' name="cart"',
        content: '{"count":2}',
      },
    });
    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({
      target: null,
      type: 'visibilitychange',
    });

    // SPEC.md §4.4/§9.4: visible-return typed reads and inline query events
    // must not drift from the loader's configured runtime query apply hook.
    expect(store.get('cart')).toEqual({ count: 2, viaHook: true });
    expect(store.get('reviews')).toEqual({ total: 3, viaHook: true });
    expect(cartPlan).toHaveBeenCalledWith({ count: 2, viaHook: true });
    expect(reviewsPlan).toHaveBeenCalledWith({ total: 3, viaHook: true });
    expect(applyQuery).toHaveBeenCalledWith({ name: 'cart', value: { count: 2 } });
    expect(applyQuery).toHaveBeenCalledWith({ name: 'reviews', value: { total: 3 } });
  });
});
