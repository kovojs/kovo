import { describe, expect, it, vi } from 'vitest';

import { createQueryStore } from './query-store.js';
import { refetchQueries } from './query-refetch.js';

describe('query refetch', () => {
  it('applies successful typed read chunks and reports names for the loader ledger', async () => {
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const reviewsPlan = vi.fn();
    const cartBinding = {
      textContent: '',
      getAttribute: (name: string) => (name === 'data-bind' ? 'cart.count' : null),
    };
    const reviewsBinding = {
      textContent: '',
      getAttribute: (name: string) => (name === 'data-bind' ? 'reviews.total' : null),
    };
    const root = {
      querySelectorAll(selector: string) {
        if (selector === '[data-bind]') return [cartBinding, reviewsBinding];
        if (selector === '*') return [];
        return [];
      },
    };
    const fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () =>
        url === '/_q/cart'
          ? [
              '<fw-query name="cart">{"count":2}</fw-query>',
              '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
            ].join('')
          : '<fw-query name="reviews">{"total":5}</fw-query>',
    }));

    store.subscribe('cart', cartPlan);
    store.subscribe('reviews', reviewsPlan);

    await expect(
      refetchQueries({
        fetch,
        queryPlans: { cart: { bindings: true }, reviews: { bindings: true } },
        queries: ['cart', 'reviews'],
        queryStore: store,
        root,
      }),
    ).resolves.toEqual([
      { fragments: [], queries: ['cart'] },
      { fragments: [], queries: ['reviews'] },
    ]);

    expect(fetch).toHaveBeenNthCalledWith(1, '/_q/cart', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/_q/reviews', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('reviews')).toEqual({ total: 5 });
    expect(cartBinding.textContent).toBe('2');
    expect(reviewsBinding.textContent).toBe('5');
    expect(cartPlan).toHaveBeenLastCalledWith({ count: 2 });
    expect(reviewsPlan).toHaveBeenLastCalledWith({ total: 5 });
  });

  it('applies keyed typed read chunks and reports canonical query keys', async () => {
    const store = createQueryStore();
    const plan = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<fw-query name="product" key="p1">{"stock":6}</fw-query>',
    }));

    store.subscribe('product', plan, 'p1');

    await expect(
      refetchQueries({
        fetch,
        queries: ['product:p1'],
        queryStore: store,
      }),
    ).resolves.toEqual([{ fragments: [], queries: ['product:p1'] }]);

    // SPEC.md §9.4: typed reads, wire chunks, and the runtime query store share
    // one canonical query instance key.
    expect(fetch).toHaveBeenCalledWith('/_q/product%3Ap1', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(store.get('product', 'p1')).toEqual({ stock: 6 });
    expect(store.get('product')).toBeUndefined();
    expect(plan).toHaveBeenCalledWith({ stock: 6 });
  });

  it('does not apply failed or disabled typed read responses', async () => {
    const store = createQueryStore();
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => '<fw-query name="cart">{"count":2}</fw-query>',
    }));

    await expect(
      refetchQueries({
        fetch,
        queries: ['cart', 'inventory'],
        queryStore: store,
        urlForQuery: (query) => (query === 'inventory' ? '' : `/_q/${query}`),
      }),
    ).resolves.toEqual([]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toBeUndefined();
  });

  it('reports malformed typed read query chunks through the shared decoded apply path', async () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () =>
        url === '/_q/cart'
          ? '<fw-query name="cart">{</fw-query><fw-query name="inventory">{"available":true}</fw-query>'
          : '<fw-query name="reviews">{"total":2}</fw-query>',
    }));

    const applied = await refetchQueries({
      fetch,
      onError,
      queries: ['cart', 'reviews'],
      queryStore: store,
    });

    // SPEC.md §4.4/§9.4: typed-read visible-return refetch applies server query
    // chunks through the same decoded runtime apply primitive as mutation bodies
    // without accepting a second fragment parser surface.
    expect(applied).toEqual([
      { fragments: [], queries: ['inventory'] },
      { fragments: [], queries: ['reviews'] },
    ]);
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect(store.get('reviews')).toEqual({ total: 2 });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0].message)).toContain('Malformed JSON in fw-query cart');
  });

  it('reports typed read transport failures and continues applying later queries', async () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const transportError = new Error('typed read failed');
    const fetch = vi.fn(async (url: string) => {
      if (url === '/_q/cart') throw transportError;

      return {
        status: 200,
        text: async () => '<fw-query name="reviews">{"total":2}</fw-query>',
      };
    });

    const applied = await refetchQueries({
      fetch,
      onError,
      queries: ['cart', 'reviews'],
      queryStore: store,
    });

    // SPEC.md §4.4: one failed visible-return typed read must not prevent
    // later hydrated queries from receiving fresh server data.
    expect(applied).toEqual([{ fragments: [], queries: ['reviews'] }]);
    expect(onError).toHaveBeenCalledWith(transportError);
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('reviews')).toEqual({ total: 2 });
  });
});
