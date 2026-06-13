import { describe, expect, it, vi } from 'vitest';

import { createQueryStore } from './query-store.js';
import { refetchQueries } from './query-refetch.js';
import {
  createRefetchQueryLedger,
  installQueryVisibleReturnRefetch,
} from './query-visible-return.js';

class FakeVisibleReturnRoot {
  bindings: QueryBinding[] = [];
  listeners = new Map<string, (event: unknown) => void | Promise<void>>();
  scripts: QueryScript[] = [];
  visibilityState: 'hidden' | 'visible' = 'visible';

  addEventListener(type: string, listener: (event: unknown) => void | Promise<void>): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void | Promise<void>): void {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  querySelectorAll(selector: string): Iterable<QueryScript | QueryBinding> {
    if (selector === 'script[fw-query]') return this.scripts;
    if (selector === '[data-bind]') return this.bindings;
    if (selector === '*') return [];

    return [];
  }
}

interface QueryScript {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

interface QueryBinding {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

describe('query refetch ledger', () => {
  it('dedupes hydrated and later-applied query names while preserving first-seen order', () => {
    const ledger = createRefetchQueryLedger(['cart', 'inventory', 'cart']);

    ledger.remember(['reviews', 'cart', 'recommendations', 'inventory']);

    // SPEC.md section 4.4: visible-return refetch follows successfully hydrated/applied query data.
    expect(ledger.eligible()).toEqual(['cart', 'inventory', 'reviews', 'recommendations']);
    expect(ledger.eligible(['inventory', 'recommendations'])).toEqual(['cart', 'reviews']);
  });
});

describe('query refetch', () => {
  it('hydrates initial scripts without installing a visible-return listener when refetch is disabled', () => {
    const root = new FakeVisibleReturnRoot();
    const store = createQueryStore();
    const plan = vi.fn();
    const binding = {
      textContent: '',
      getAttribute: (name: string) => (name === 'data-bind' ? 'cart.count' : null),
    };

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];
    root.bindings = [binding];
    store.subscribe('cart', plan);

    const lifecycle = installQueryVisibleReturnRefetch({
      queryPlans: { cart: { bindings: true } },
      queryStore: store,
      root,
    });

    // SPEC.md §4.4/§9.4: query script hydration is loader lifecycle work even
    // when visible-return typed reads are not configured, and hydration uses
    // the same compiled query update plan path as mutation/query refetch.
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(binding.textContent).toBe('1');
    expect(plan).toHaveBeenCalledWith({ count: 1 });
    expect(root.listeners.has('visibilitychange')).toBe(false);

    lifecycle.rememberAppliedQueries(['reviews']);
    lifecycle.dispose();
    lifecycle.rememberAppliedQueries(['inventory']);
    expect(root.listeners.has('visibilitychange')).toBe(false);
  });

  it('hydrates new query scripts before visible-return refetch and dedupes in-flight work', async () => {
    const root = new FakeVisibleReturnRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const cartBinding = {
      textContent: '',
      getAttribute: (name: string) => (name === 'data-bind' ? 'cart.count' : null),
    };
    const reviewsBinding = {
      textContent: '',
      getAttribute: (name: string) => (name === 'data-bind' ? 'reviews.total' : null),
    };
    let resolveFetchText: ((body: string) => void) | undefined;
    const fetchText = new Promise<string>((resolve) => {
      resolveFetchText = resolve;
    });
    const fetch = vi.fn(async () => ({
      status: 200,
      text: () => fetchText,
    }));

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];
    root.bindings = [cartBinding, reviewsBinding];

    const refetch = installQueryVisibleReturnRefetch({
      queryPlans: { cart: { bindings: true }, reviews: { bindings: true } },
      queryRefetch: { fetch },
      queryStore: store,
      refetchOnFocus,
      root,
    });

    root.scripts.push({
      getAttribute: (name) => (name === 'fw-query' ? 'reviews' : null),
      textContent: '{"total":3}',
    });

    const first = root.listeners.get('visibilitychange')?.({});
    const second = root.listeners.get('visibilitychange')?.({});
    await Promise.resolve();

    // SPEC.md section 4.4: visible-return refetch follows query data discovered after install.
    expect(refetchOnFocus).toHaveBeenCalledWith(['cart', 'reviews']);
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFetchText?.('<fw-query name="cart">{"count":2}</fw-query>');
    await Promise.all([first, second]);

    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('reviews')).toEqual({ total: 3 });
    expect(cartBinding.textContent).toBe('2');
    expect(reviewsBinding.textContent).toBe('3');

    refetch.dispose();
    expect(root.listeners.has('visibilitychange')).toBe(false);
  });

  it('makes query chunks returned by typed reads eligible for the next visible-return refetch', async () => {
    const root = new FakeVisibleReturnRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () =>
        url === '/_q/cart'
          ? [
              '<fw-query name="cart">{"count":2}</fw-query>',
              '<fw-query name="recommendations">{"items":["p1"]}</fw-query>',
            ].join('')
          : '<fw-query name="recommendations">{"items":["p2"]}</fw-query>',
    }));

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];

    installQueryVisibleReturnRefetch({
      queryRefetch: { fetch },
      queryStore: store,
      refetchOnFocus,
      root,
    });

    await root.listeners.get('visibilitychange')?.({});

    expect(refetchOnFocus).toHaveBeenNthCalledWith(1, ['cart']);
    expect(fetch).toHaveBeenNthCalledWith(1, '/_q/cart', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('recommendations')).toEqual({ items: ['p1'] });

    await root.listeners.get('visibilitychange')?.({});

    // SPEC.md §4.4: typed-read query chunks join the same visible-return
    // ledger as server-rendered hydration and later mutation/deferred chunks.
    expect(refetchOnFocus).toHaveBeenNthCalledWith(2, ['cart', 'recommendations']);
    expect(fetch).toHaveBeenNthCalledWith(2, '/_q/cart', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(fetch).toHaveBeenNthCalledWith(3, '/_q/recommendations', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(store.get('recommendations')).toEqual({ items: ['p2'] });
  });

  it('forwards visible-return typed read parse errors to the loader error seam', async () => {
    const root = new FakeVisibleReturnRoot();
    const store = createQueryStore();
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<fw-query name="cart">{</fw-query>',
    }));

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];

    installQueryVisibleReturnRefetch({
      onError,
      queryRefetch: { fetch },
      queryStore: store,
      root,
    });

    await root.listeners.get('visibilitychange')?.({});

    // SPEC.md §4.4: visible-return refetch follows hydrated queries; malformed typed-read
    // chunks still report through the same runtime apply path instead of drifting silently.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0].message)).toContain('Malformed JSON in fw-query cart');
    expect(store.get('cart')).toEqual({ count: 1 });
  });

  it('reports visible-return callback failures and still runs typed read refetch', async () => {
    const root = new FakeVisibleReturnRoot();
    const store = createQueryStore();
    const callbackError = new Error('focus callback failed');
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<fw-query name="cart">{"count":2}</fw-query>',
    }));

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];

    installQueryVisibleReturnRefetch({
      onError,
      queryRefetch: { fetch },
      queryStore: store,
      refetchOnFocus: async () => {
        throw callbackError;
      },
      root,
    });

    await root.listeners.get('visibilitychange')?.({});

    // SPEC.md §4.4: visible-return refetch is background loader work; callback
    // failures report through the runtime error seam without blocking typed reads.
    expect(onError).toHaveBeenCalledWith(callbackError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toEqual({ count: 2 });
  });

  it('makes stale visible-return listeners inert after disposal', async () => {
    const root = new FakeVisibleReturnRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<fw-query name="cart">{"count":2}</fw-query>',
    }));

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];

    const refetch = installQueryVisibleReturnRefetch({
      queryRefetch: { fetch },
      queryStore: store,
      refetchOnFocus,
      root,
    });
    const staleListener = root.listeners.get('visibilitychange');

    refetch.dispose();
    await staleListener?.({});
    refetch.rememberAppliedQueries(['reviews']);
    await staleListener?.({});

    // SPEC.md §4.4: disposed visible-return refetch must not keep observing query data.
    expect(refetchOnFocus).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(root.listeners.has('visibilitychange')).toBe(false);
  });

  it('does not continue typed-read refetch work after disposal during visible-return', async () => {
    const root = new FakeVisibleReturnRoot();
    const store = createQueryStore();
    let resolveFocus: (() => void) | undefined;
    const focusDone = new Promise<void>((resolve) => {
      resolveFocus = resolve;
    });
    const refetchOnFocus = vi.fn(() => focusDone);
    const fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<fw-query name="cart">{"count":2}</fw-query>',
    }));

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];

    const refetch = installQueryVisibleReturnRefetch({
      queryRefetch: { fetch },
      queryStore: store,
      refetchOnFocus,
      root,
    });
    const visibleReturn = root.listeners.get('visibilitychange')?.({});

    await Promise.resolve();
    refetch.dispose();
    resolveFocus?.();
    await visibleReturn;

    // SPEC.md §4.4: disposal stops the remaining typed-read leg of a visible-return pass.
    expect(refetchOnFocus).toHaveBeenCalledWith(['cart']);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.get('cart')).toEqual({ count: 1 });
  });

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
      {
        fragments: [{ html: '<cart-badge>2</cart-badge>', target: 'cart-badge' }],
        queries: ['cart'],
      },
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

  it('reports malformed typed read chunks through the shared apply path', async () => {
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

    // SPEC.md §4.4: typed-read visible-return refetch applies server query chunks through
    // the same mutation-response vocabulary as other runtime apply paths.
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
