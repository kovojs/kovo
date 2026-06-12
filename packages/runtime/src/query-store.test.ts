import { describe, expect, it, vi } from 'vitest';

import { installJisoLoader, refetchQueries, type DelegatedEvent } from './index.js';
import { createQueryStore, hydrateQueryScripts } from './query-store.js';

class FakeRoot {
  listeners = new Map<string, (event: DelegatedEvent) => void | Promise<void>>();
  scripts: QueryScript[] = [];
  visibilityState: 'hidden' | 'visible' = 'visible';

  addEventListener(type: string, listener: (event: DelegatedEvent) => void | Promise<void>): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
  ): void {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  querySelectorAll(selector: string): Iterable<QueryScript> {
    return selector === 'script[fw-query]' ? this.scripts : [];
  }
}

interface QueryScript {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

describe('query store hydration and refetch', () => {
  it('hydrates fw-query scripts and immediately runs subscribed update plans', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('cart', plan);
    const hydrated = hydrateQueryScripts(store, [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":2}',
      },
    ]);

    expect(hydrated).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(plan).toHaveBeenCalledWith({ count: 2 });
  });

  it('returns only successfully hydrated fw-query scripts', () => {
    const store = createQueryStore();
    const onError = vi.fn();

    const hydrated = hydrateQueryScripts(
      store,
      [
        {
          getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
          textContent: '{"count":1}',
        },
        {
          getAttribute: (name) => (name === 'fw-query' ? 'inventory' : null),
          textContent: '{',
        },
      ],
      { onError },
    );

    expect(hydrated).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(store.get('inventory')).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

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

  it('registers visible-return refetch without invoking it eagerly', async () => {
    const root = new FakeRoot();
    const refetchOnFocus = vi.fn();

    installJisoLoader({
      focusTarget: root,
      importModule: vi.fn(),
      refetchOnFocus,
      root,
    });

    expect(root.listeners.has('visibilitychange')).toBe(true);
    expect(root.listeners.has('focus')).toBe(false);
    expect(refetchOnFocus).not.toHaveBeenCalled();

    root.visibilityState = 'hidden';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    expect(refetchOnFocus).not.toHaveBeenCalled();

    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    expect(refetchOnFocus).toHaveBeenCalledTimes(1);

    expect(refetchOnFocus).toHaveBeenCalledTimes(1);
  });

  it('passes hydrated query names to refetch-on-focus with per-query opt-out', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'inventory' : null),
        textContent: '{"sku":"sku_1","available":true}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'analytics' : null),
        textContent: '{"sampled":true}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];

    installJisoLoader({
      focusTarget: root,
      importModule: vi.fn(),
      queryStore: store,
      refetchOnFocus,
      refetchOnFocusOptOut: ['analytics'],
      root,
    });

    root.visibilityState = 'hidden';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    expect(refetchOnFocus).not.toHaveBeenCalled();

    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    expect(refetchOnFocus).toHaveBeenNthCalledWith(1, ['cart', 'inventory']);
    expect(refetchOnFocus).toHaveBeenCalledTimes(1);
  });

  it('does not make malformed initial fw-query scripts eligible for visible-return refetch', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const onError = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'inventory' : null),
        textContent: '{',
      },
    ];

    installJisoLoader({
      importModule: vi.fn(),
      onError,
      queryStore: store,
      refetchOnFocus,
      root,
    });

    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    // SPEC.md §4.4: focus refetch follows successfully hydrated query data.
    expect(refetchOnFocus).toHaveBeenCalledWith(['cart']);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: 'query-hydration' });
  });

  it('dedupes overlapping visible-return refetches', async () => {
    const root = new FakeRoot();
    const refetchOnFocus = vi.fn();
    let resolveRefetch: (() => void) | undefined;
    const refetchDone = new Promise<void>((resolve) => {
      resolveRefetch = resolve;
    });
    refetchOnFocus.mockReturnValue(refetchDone);

    installJisoLoader({
      focusTarget: root,
      importModule: vi.fn(),
      refetchOnFocus,
      root,
    });

    root.visibilityState = 'visible';
    const firstRefetch = root.listeners.get('visibilitychange')?.({
      target: null,
      type: 'visibilitychange',
    });
    const secondRefetch = root.listeners.get('visibilitychange')?.({
      target: null,
      type: 'visibilitychange',
    });

    expect(refetchOnFocus).toHaveBeenCalledTimes(1);

    resolveRefetch?.();
    await Promise.all([firstRefetch, secondRefetch]);

    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    expect(refetchOnFocus).toHaveBeenCalledTimes(2);
  });

  it('refreshes stale hydrated query data when a visible tab regains focus', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const analyticsPlan = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'analytics' : null),
        textContent: '{"sampled":true}',
      },
    ];

    store.subscribe('cart', cartPlan);
    store.subscribe('analytics', analyticsPlan);
    installJisoLoader({
      focusTarget: root,
      importModule: vi.fn(),
      queryStore: store,
      refetchOnFocus(queries) {
        for (const query of queries) {
          if (query === 'cart') store.set(query, { count: 2 });
        }
      },
      refetchOnFocusOptOut: ['analytics'],
      root,
    });

    expect(store.get('cart')).toEqual({ count: 1 });
    expect(store.get('analytics')).toEqual({ sampled: true });

    root.visibilityState = 'hidden';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    expect(store.get('cart')).toEqual({ count: 1 });

    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('analytics')).toEqual({ sampled: true });
    expect(cartPlan).toHaveBeenLastCalledWith({ count: 2 });
    expect(analyticsPlan).toHaveBeenCalledTimes(1);
  });

  it('refetches typed read endpoints and applies returned query chunks', async () => {
    const store = createQueryStore();
    const plan = vi.fn();
    const fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () =>
        url === '/_q/cart'
          ? '<fw-query name="cart">{"count":2}</fw-query>'
          : '<fw-query name="inventory">{"available":true}</fw-query>',
    }));

    store.subscribe('cart', plan);

    await expect(
      refetchQueries({
        fetch,
        queries: ['cart', 'inventory'],
        queryStore: store,
      }),
    ).resolves.toEqual([
      { fragments: [], queries: ['cart'] },
      { fragments: [], queries: ['inventory'] },
    ]);
    expect(fetch).toHaveBeenNthCalledWith(1, '/_q/cart', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/_q/inventory', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('inventory')).toEqual({ available: true });
    expect(plan).toHaveBeenLastCalledWith({ count: 2 });
  });

  it('uses typed read refetching from visible-return listeners when configured', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const plan = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<fw-query name="cart">{"count":3}</fw-query>',
    }));

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];
    store.subscribe('cart', plan);

    installJisoLoader({
      focusTarget: root,
      importModule: vi.fn(),
      queryRefetch: { fetch },
      queryStore: store,
      root,
    });

    expect(root.listeners.has('visibilitychange')).toBe(true);
    expect(root.listeners.has('focus')).toBe(false);
    expect(store.get('cart')).toEqual({ count: 1 });

    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    expect(fetch).toHaveBeenCalledWith('/_q/cart', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(store.get('cart')).toEqual({ count: 3 });
    expect(plan).toHaveBeenLastCalledWith({ count: 3 });
  });
});
