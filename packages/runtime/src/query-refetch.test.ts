import { describe, expect, it, vi } from 'vitest';

import { createQueryStore } from './query-store.js';
import {
  createRefetchQueryLedger,
  installQueryVisibleReturnRefetch,
  refetchQueries,
} from './query-refetch.js';

class FakeVisibleReturnRoot {
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

  querySelectorAll(selector: string): Iterable<QueryScript> {
    return selector === 'script[fw-query]' ? this.scripts : [];
  }
}

interface QueryScript {
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
  it('hydrates new query scripts before visible-return refetch and dedupes in-flight work', async () => {
    const root = new FakeVisibleReturnRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
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

    const refetch = installQueryVisibleReturnRefetch({
      queryRefetch: { fetch },
      queryScripts: () => root.querySelectorAll('script[fw-query]'),
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

    refetch.dispose();
    expect(root.listeners.has('visibilitychange')).toBe(false);
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
      queryScripts: () => root.querySelectorAll('script[fw-query]'),
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

  it('applies successful typed read chunks and reports names for the loader ledger', async () => {
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const reviewsPlan = vi.fn();
    const fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () =>
        url === '/_q/cart'
          ? '<fw-query name="cart">{"count":2}</fw-query>'
          : '<fw-query name="reviews">{"total":5}</fw-query>',
    }));

    store.subscribe('cart', cartPlan);
    store.subscribe('reviews', reviewsPlan);

    await expect(
      refetchQueries({
        fetch,
        queries: ['cart', 'reviews'],
        queryStore: store,
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
    expect(cartPlan).toHaveBeenLastCalledWith({ count: 2 });
    expect(reviewsPlan).toHaveBeenLastCalledWith({ total: 5 });
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
});
