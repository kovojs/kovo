import { describe, expect, it, vi } from 'vitest';

import { createQueryStore } from './query-store.js';
import { refetchQueries } from './query-refetch.js';
import { FakeMorphRoot, FakeQueryBindingElement } from './runtime-test-fakes.js';

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
              '<kovo-query name="cart">{"count":2}</kovo-query>',
              '<kovo-fragment target="cart-badge"><cart-badge>2</cart-badge></kovo-fragment>',
            ].join('')
          : '<kovo-query name="reviews">{"total":5}</kovo-query>',
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
      headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
      method: 'GET',
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/_q/reviews', {
      headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
      method: 'GET',
    });
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('reviews')).toEqual({ total: 5 });
    expect(cartBinding.textContent).toBe('2');
    expect(reviewsBinding.textContent).toBe('5');
    expect(cartPlan).toHaveBeenLastCalledWith({ count: 2 });
    expect(reviewsPlan).toHaveBeenLastCalledWith({ total: 5 });
  });

  it('batches successful typed read responses through one runtime query apply pass', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const badge = new FakeQueryBindingElement({ 'data-bind:aria-label': 'cart.label' });
    const meter = new FakeQueryBindingElement({ 'data-bind:value': 'reviews.total' });
    const fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () =>
        url === '/_q/cart'
          ? '<kovo-query name="cart">{"label":"Cart has items"}</kovo-query>'
          : '<kovo-query name="reviews">{"total":8}</kovo-query>',
    }));

    root.bindings.push(badge, meter);

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

    // SPEC.md §4.4/§9.4: a visible-return typed-read pass should share the
    // batched runtime query apply path used by hydrated scripts and mutation
    // responses, so the compiled binding index is built once for all chunks.
    expect(root.wildcardSelectorCalls).toBe(1);
    expect(badge.getAttribute('aria-label')).toBe('Cart has items');
    expect(meter.getAttribute('value')).toBe('8');
  });

  it('applies keyed typed read chunks and reports canonical query keys', async () => {
    const store = createQueryStore();
    const plan = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<kovo-query name="product:p1">{"stock":6}</kovo-query>',
    }));

    store.subscribe('product', plan, 'p1');

    await expect(
      refetchQueries({
        fetch,
        queries: ['product:p1'],
        queryStore: store,
      }),
    ).resolves.toEqual([{ fragments: [], queries: ['product:p1'] }]);

    // SPEC.md §9.4/§10.2: typed-read responses carry the canonical query
    // instance key directly in the kovo-query name and still hit the keyed store.
    expect(fetch).toHaveBeenCalledWith('/_q/product%3Ap1', {
      headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
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
      text: async () => '<kovo-query name="cart">{"count":2}</kovo-query>',
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
          ? '<kovo-query name="cart">{</kovo-query><kovo-query name="inventory">{"available":true}</kovo-query>'
          : '<kovo-query name="reviews">{"total":2}</kovo-query>',
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
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in kovo-query cart',
    );
  });

  it('reports typed read apply hook failures while continuing later chunks in the batch', async () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const applyError = new Error('cart hook failed');
    const fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () =>
        url === '/_q/cart'
          ? '<kovo-query name="cart">{"count":2}</kovo-query>'
          : '<kovo-query name="reviews">{"total":4}</kovo-query>',
    }));

    const applied = await refetchQueries({
      applyQuery(query) {
        if (query.name === 'cart') throw applyError;
        store.set(query.name, query.value, query.key);
        return { value: store.get(query.name, query.key) };
      },
      fetch,
      onError,
      queries: ['cart', 'reviews'],
      queryStore: store,
    });

    // SPEC.md §4.4/§9.4: visible-return typed reads are background hydration
    // work; a bad apply hook for one decoded query must report through the
    // runtime error seam without preventing later typed-read truth from applying.
    expect(applied).toEqual([{ fragments: [], queries: ['reviews'] }]);
    expect(onError).toHaveBeenCalledWith(applyError);
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('reviews')).toEqual({ total: 4 });
  });

  it('reports typed read transport failures and continues applying later queries', async () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const transportError = new Error('typed read failed');
    const fetch = vi.fn(async (url: string) => {
      if (url === '/_q/cart') throw transportError;

      return {
        status: 200,
        text: async () => '<kovo-query name="reviews">{"total":2}</kovo-query>',
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
