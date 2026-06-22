import { describe, expect, it, vi } from 'vitest';

import { createQueryStore } from './query-store.js';
import { rebaserApplyQueryInterposition } from './query-apply.js';
import { OptimisticRebaser } from './optimism.js';
import { createDeltaMissRefetcher, refetchQueries } from './query-refetch.js';
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
      cache: 'no-store',
      headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
      method: 'GET',
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/_q/reviews', {
      cache: 'no-store',
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

  it('refetches a keyed query over /_q/<name> with the instance key as a search param (F5)', async () => {
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

    // SPEC.md §9.4/§10.2 (F5): the typed-read endpoint dispatches by query NAME and a keyed
    // query's args arrive as search params. A refetch MUST hit `/_q/product?key=p1`, NOT the
    // canonical instance key as a path (`/_q/product%3Ap1`), which the server registers no
    // query for and answers 404 — leaving the stale base in place forever.
    expect(fetch).toHaveBeenCalledWith('/_q/product?key=p1', {
      cache: 'no-store',
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

  it('escalates to a reload (no apply) when a /_q refetch token still differs (D3, SPEC §14)', async () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });
    const onBuildSkew = vi.fn();
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'Kovo-Build' ? 'build-B' : null) },
      status: 200,
      text: async () => '<kovo-query name="cart">{"count":99}</kovo-query>',
    }));

    const applied = await refetchQueries({
      expectedBuildToken: 'build-A',
      fetch,
      onBuildSkew,
      queries: ['cart'],
      queryStore: store,
    });

    // The fresh-build (build-B) value must NOT be merged into the stale-build (build-A) store;
    // the document is fundamentally skewed → a single reload escalation, no chunks applied.
    expect(onBuildSkew).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([]);
    expect(store.get('cart')).toEqual({ count: 1 });
  });

  it('applies normally when the /_q refetch token matches the document token (D2)', async () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });
    const onBuildSkew = vi.fn();
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'Kovo-Build' ? 'build-A' : null) },
      status: 200,
      text: async () => '<kovo-query name="cart">{"count":2}</kovo-query>',
    }));

    await refetchQueries({
      expectedBuildToken: 'build-A',
      fetch,
      onBuildSkew,
      queries: ['cart'],
      queryStore: store,
    });

    expect(onBuildSkew).not.toHaveBeenCalled();
    expect(store.get('cart')).toEqual({ count: 2 });
  });

  it('createDeltaMissRefetcher GETs /_q/<name>?key=<keyValue> for a keyed delta miss (F1+F5)', async () => {
    // SPEC §9.1.1 (F1 delta-miss) + §9.4/§10.2 (F5): when a delta cannot be applied to a keyed
    // query, the full refetch must hit the NAME endpoint with the instance key as a search param,
    // not `/_q/<name:keyValue>` (404).
    const store = createQueryStore();
    let resolveFetch: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const fetch = vi.fn(async () => {
      resolveFetch?.();
      return {
        status: 200,
        text: async () => '<kovo-query name="recommendations:user-1">{"items":["p9"]}</kovo-query>',
      };
    });

    const onDeltaMiss = createDeltaMissRefetcher({ fetch, queryStore: store });
    onDeltaMiss('recommendations', 'user-1');
    await done;
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledWith('/_q/recommendations?key=user-1', {
      cache: 'no-store',
      headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
      method: 'GET',
    });
    expect(store.get('recommendations', 'user-1')).toEqual({ items: ['p9'] });
  });

  it('L8-2: a refetch routed through the rebaser rebases pending instead of clobbering', async () => {
    // SPEC §10.4 (F4/L8-2): when a refetch is wired through the rebaser, the arriving server
    // truth refreshes the baseline and re-applies pending predictions, rather than overwriting
    // the store with raw truth (which would drop the in-flight optimistic prediction).
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    rebaser.add(
      'm1',
      {},
      {
        transforms: {
          cart(draft: unknown) {
            (draft as { count: number }).count += 1;
          },
        },
      },
    );
    expect(store.get('cart')).toEqual({ count: 1 });

    const fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<kovo-query name="cart">{"count":100}</kovo-query>',
    }));

    await refetchQueries({
      applyQuery: rebaserApplyQueryInterposition(store, rebaser),
      fetch,
      queries: ['cart'],
      queryStore: store,
    });

    // Server truth 100 + the still-pending m1 prediction (+1) = 101; the prediction is NOT lost.
    expect(store.get('cart')).toEqual({ count: 101 });
    expect(rebaser.pendingCount('cart')).toBe(1);

    // A later m1 failure now re-derives from the refreshed baseline (100), not the frozen 0.
    rebaser.settleWithoutServerTruth('m1', 'cart');
    expect(store.get('cart')).toEqual({ count: 100 });
  });
});
