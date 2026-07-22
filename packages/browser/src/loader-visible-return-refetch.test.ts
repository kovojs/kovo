import { afterAll, describe, expect, it, vi } from 'vitest';

import { createQueryStore, installKovoLoader } from './generated.js';
import type { QueryRefetchFetch } from './query-refetch.js';
import {
  FakeBroadcastChannel,
  FakeFormElement,
  FakeMorphRoot,
  FakeQueryBindingElement,
  FakeRoot,
  browserTransportTestBuild,
  browserTransportTestSourceUrl,
  installTestBuildDocument,
  mutationTestResponse,
  queryTestResponse,
} from './runtime-test-fakes.js';

const restoreBuildDocument = installTestBuildDocument();
afterAll(restoreBuildDocument);

const typedReadRequest = {
  cache: 'no-store',
  headers: {
    Accept: 'text/html',
    'Kovo-Build': browserTransportTestBuild,
    'Kovo-Fragment': 'true',
  },
  method: 'GET',
  redirect: 'error',
} as const;

const typedReadUrl = (path: string): string => new URL(path, browserTransportTestSourceUrl).href;

const queryRefetch = (fetch: QueryRefetchFetch) => ({
  expectedBuildToken: browserTransportTestBuild,
  fetch,
  sourceUrl: browserTransportTestSourceUrl,
});

const queryScript = (name: string, href: string, textContent: string, key?: string) => ({
  getAttribute(attribute: string) {
    if (attribute === 'kovo-query') return name;
    if (attribute === 'data-kovo-query-href') return href;
    return attribute === 'key' ? (key ?? null) : null;
  },
  textContent,
});

describe('loader visible-return refetch', () => {
  it('makes queries introduced by enhanced mutations eligible for visible-return refetch', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const formData = new FormData();
    formData.set('Kovo-Idem', 'v1_1750000000000_000102030405060708090a0b0c0d0e0f');
    const form = new FakeFormElement(
      {
        enhance: '',
        'data-mutation': 'recommendations/refresh',
      },
      {
        action: '/_m/recommendations/refresh',
        method: 'post',
      },
    );
    loaderRoot.scripts = [queryScript('cart', '/_q/cart', '{"count":1}')];
    const mutationFetch = vi.fn(async () =>
      mutationTestResponse('/_m/recommendations/refresh', {
        headers: {
          get() {
            return null;
          },
        },
        async text() {
          return '<kovo-query name="recommendations" href="/_q/recommendations">{"items":["p1"]}</kovo-query>';
        },
      }),
    );
    const refetchFetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: async () =>
          new URL(url).pathname === '/_q/cart'
            ? '<kovo-query name="cart">{"count":2}</kovo-query>'
            : '<kovo-query name="recommendations">{"items":["p2"]}</kovo-query>',
      }),
    );

    installKovoLoader({
      enhancedMutations: {
        fetch: mutationFetch,
        formData: () => formData,
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      queryRefetch: queryRefetch(refetchFetch),
      queryStore: store,
      refetchOnFocus,
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('submit')?.({
      preventDefault: vi.fn(),
      target: form,
      type: 'submit',
    });

    expect(store.get('cart')).toEqual({ count: 1 });
    expect(store.get('recommendations')).toEqual({ items: ['p1'] });

    loaderRoot.visibilityState = 'visible';
    await loaderRoot.listeners.get('visibilitychange')?.({
      target: null,
      type: 'visibilitychange',
    });

    // SPEC.md §4.4: visible-return refetch follows query data introduced by
    // later mutation query chunks, not just server-rendered hydration scripts.
    expect(refetchOnFocus).toHaveBeenCalledWith([{ name: 'cart' }, { name: 'recommendations' }]);
    expect(refetchFetch).toHaveBeenNthCalledWith(1, typedReadUrl('/_q/cart'), typedReadRequest);
    expect(refetchFetch).toHaveBeenNthCalledWith(
      2,
      typedReadUrl('/_q/recommendations'),
      typedReadRequest,
    );
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('recommendations')).toEqual({ items: ['p2'] });
  });

  it('makes queries introduced by default broadcast replay eligible for visible-return refetch', async () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originalBroadcastChannel = globalRecord.BroadcastChannel;
    const channels: FakeBroadcastChannel[] = [];
    class TestBroadcastChannel extends FakeBroadcastChannel {
      constructor() {
        super();
        channels.push(this);
      }
    }
    globalRecord.BroadcastChannel = TestBroadcastChannel;

    try {
      const loaderRoot = new FakeRoot();
      const mutationRoot = new FakeMorphRoot();
      const store = createQueryStore();
      const refetchOnFocus = vi.fn();
      const fetch = vi.fn(async (url: string) =>
        queryTestResponse(url, {
          status: 200,
          text: async () =>
            new URL(url).pathname === '/_q/cart'
              ? '<kovo-query name="cart">{"count":2}</kovo-query>'
              : '<kovo-query name="reviews">{"items":["r2"]}</kovo-query>',
        }),
      );
      loaderRoot.scripts = [queryScript('cart', '/_q/cart', '{"count":1}')];

      installKovoLoader({
        enhancedMutations: {
          buildToken: 'build-test',
          fetch: vi.fn(),
          root: mutationRoot,
          store,
        },
        importModule: vi.fn(),
        queryRefetch: queryRefetch(fetch),
        queryStore: store,
        refetchOnFocus,
        root: loaderRoot,
      });

      channels[0]?.onmessage?.({
        data: {
          body: '<kovo-query name="reviews" href="/_q/reviews">{"items":["r1"]}</kovo-query>',
          buildToken: 'build-test',
          changes: [],
          type: 'kovo:mutation-response',
        },
      });
      loaderRoot.visibilityState = 'visible';
      await loaderRoot.listeners.get('visibilitychange')?.({
        target: null,
        type: 'visibilitychange',
      });

      // SPEC.md §9.2: same-user tab sync consumes mutation wire bodies through
      // the same query-store path as the submitting tab.
      expect(refetchOnFocus).toHaveBeenCalledWith([{ name: 'cart' }, { name: 'reviews' }]);
      expect(fetch).toHaveBeenNthCalledWith(1, typedReadUrl('/_q/cart'), typedReadRequest);
      expect(fetch).toHaveBeenNthCalledWith(2, typedReadUrl('/_q/reviews'), typedReadRequest);
      expect(store.get('cart')).toEqual({ count: 2 });
      expect(store.get('reviews')).toEqual({ items: ['r2'] });
    } finally {
      globalRecord.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('refetches keyed hydrated query instances by typed-read key on visible return', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const p1Plan = vi.fn();
    const p2Plan = vi.fn();
    const refetchOnFocus = vi.fn();
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: async () =>
          new URL(url).searchParams.get('key') === 'p1'
            ? '<kovo-query name="product" key="product:p1">{"stock":5}</kovo-query>'
            : '<kovo-query name="product" key="product:p2">{"stock":10}</kovo-query>',
      }),
    );

    root.scripts = [
      queryScript('product', '/_q/product?key=p1', '{"stock":4}', 'product:p1'),
      queryScript('product', '/_q/product?key=p2', '{"stock":9}', 'product:p2'),
    ];
    store.subscribe('product', p1Plan, 'product:p1');
    store.subscribe('product', p2Plan, 'product:p2');

    installKovoLoader({
      importModule: vi.fn(),
      queryRefetch: queryRefetch(fetch),
      queryStore: store,
      refetchOnFocus,
      root,
    });

    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    // SPEC.md §9.4: refetch-on-focus talks to the typed-read endpoint with the
    // same query instance key that hydration and mutation chunks expose.
    expect(refetchOnFocus).toHaveBeenCalledWith([
      { key: 'product:p1', name: 'product' },
      { key: 'product:p2', name: 'product' },
    ]);
    expect(fetch).toHaveBeenNthCalledWith(1, typedReadUrl('/_q/product?key=p1'), typedReadRequest);
    expect(fetch).toHaveBeenNthCalledWith(2, typedReadUrl('/_q/product?key=p2'), typedReadRequest);
    expect(store.get('product', 'product:p1')).toEqual({ stock: 5 });
    expect(store.get('product', 'product:p2')).toEqual({ stock: 10 });
    expect(p1Plan).toHaveBeenLastCalledWith({ stock: 5 });
    expect(p2Plan).toHaveBeenLastCalledWith({ stock: 10 });
  });

  it('discovers kovo-query scripts inserted after install before visible-return refetch', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const reviewsPlan = vi.fn();
    const refetchOnFocus = vi.fn();
    const cartBinding = new FakeQueryBindingElement('cart.count', { textContent: '' });
    const reviewsBinding = new FakeQueryBindingElement('reviews.total', { textContent: '' });
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: async () =>
          new URL(url).pathname === '/_q/cart'
            ? '<kovo-query name="cart">{"count":2}</kovo-query>'
            : '<kovo-query name="reviews">{"total":7}</kovo-query>',
      }),
    );

    root.scripts = [queryScript('cart', '/_q/cart', '{"count":1}')];
    root.bindings = [cartBinding, reviewsBinding];
    store.subscribe('cart', cartPlan);
    store.subscribe('reviews', reviewsPlan);

    installKovoLoader({
      importModule: vi.fn(),
      queryPlans: { cart: { bindings: true }, reviews: { bindings: true } },
      queryRefetch: queryRefetch(fetch),
      queryStore: store,
      refetchOnFocus,
      root,
    });

    expect(store.get('cart')).toEqual({ count: 1 });
    expect(store.get('reviews')).toBeUndefined();
    expect(cartBinding.textContent).toBe('1');
    expect(reviewsBinding.textContent).toBe('');

    root.scripts.push(queryScript('reviews', '/_q/reviews', '{"total":5}'));

    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    // SPEC.md §4.4: visible-return refetch tracks hydrated query data discovered after install.
    expect(refetchOnFocus).toHaveBeenCalledWith([{ name: 'cart' }, { name: 'reviews' }]);
    expect(fetch).toHaveBeenNthCalledWith(1, typedReadUrl('/_q/cart'), typedReadRequest);
    expect(fetch).toHaveBeenNthCalledWith(2, typedReadUrl('/_q/reviews'), typedReadRequest);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('reviews')).toEqual({ total: 7 });
    expect(cartBinding.textContent).toBe('2');
    expect(reviewsBinding.textContent).toBe('7');
    expect(cartPlan).toHaveBeenLastCalledWith({ count: 2 });
    expect(reviewsPlan).toHaveBeenNthCalledWith(1, { total: 5 });
    expect(reviewsPlan).toHaveBeenNthCalledWith(2, { total: 7 });
  });
});
