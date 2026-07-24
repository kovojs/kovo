import { queryRef } from '@kovojs/core';
import { describe, expect, it, vi } from 'vitest';

import type { DelegatedEvent } from './events.js';
import type { QueryRefetchFetch } from './query-refetch.js';
import { createQueryStore } from './query-store.js';
import {
  FakeQueryBindingElement,
  FakeRoot,
  browserTransportTestBuild,
  browserTransportTestSourceUrl,
  queryTestResponse,
} from './runtime-test-fakes.js';
import { installQueryVisibleReturnRefetch } from './query-visible-return.js';

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

const testQueryRefetch = (fetch: QueryRefetchFetch) => ({
  expectedBuildToken: browserTransportTestBuild,
  fetch,
  sourceUrl: browserTransportTestSourceUrl,
});

const testQueryScript = (name: string, href: string, textContent: string, key?: string) => ({
  getAttribute(attribute: string) {
    if (attribute === 'kovo-query') return name;
    if (attribute === 'data-kovo-query-href') return href;
    return attribute === 'key' ? (key ?? null) : null;
  },
  textContent,
});

function visibleReturnEvent(): DelegatedEvent {
  return { target: null, type: 'visibilitychange' };
}

// SPEC.md §4.4/§9.4: installing visible-return refetch hydrates initial scripts
// as loader lifecycle work, installs deduped visible-return listeners only when
// typed-read refetch is configured, threads typed-read chunks and parse/
// callback failures through the one runtime apply/error path, and goes inert on
// disposal. The pure eligibility-ledger seam lives in the sibling
// query-visible-return-ledger.test.ts file.
describe('queryRef visible-return refetch', () => {
  it('hydrates initial scripts without installing a visible-return listener when refetch is disabled', () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const plan = vi.fn();
    const binding = new FakeQueryBindingElement('cart.count', '');

    root.scripts = [testQueryScript('cart', '/_q/cart', '{"count":1}')];
    root.bindings = [binding];
    store.subscribe('cart', plan);

    const lifecycle = installQueryVisibleReturnRefetch({
      queryPlans: { cart: { bindings: true } },
      queryStore: store,
      root,
    });

    // SPEC.md §4.4/§9.4: queryRef script hydration is loader lifecycle work even
    // when visible-return typed reads are not configured, and hydration uses
    // the same compiled queryRef update plan path as mutation/queryRef refetch.
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(binding.textContent).toBe('1');
    expect(plan).toHaveBeenCalledWith({ count: 1 });
    expect(root.listeners.has('visibilitychange')).toBe(false);
    expect(root.listeners.has('pageshow')).toBe(false);

    lifecycle.rememberAppliedQueries(['reviews']);
    lifecycle.dispose();
    lifecycle.rememberAppliedQueries(['inventory']);
    expect(root.listeners.has('visibilitychange')).toBe(false);
    expect(root.listeners.has('pageshow')).toBe(false);
  });

  it('hydrates new queryRef scripts before visible-return refetch and dedupes in-flight work', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const cartBinding = new FakeQueryBindingElement('cart.count', '');
    const reviewsBinding = new FakeQueryBindingElement('reviews.total', '');
    let resolveFetchText: ((body: string) => void) | undefined;
    const fetchText = new Promise<string>((resolve) => {
      resolveFetchText = resolve;
    });
    const fetch = vi.fn(async (url: string) => {
      const queryName = new URL(url).pathname === '/_q/cart' ? 'cart' : 'reviews';
      return queryTestResponse(url, {
        status: 200,
        text: () =>
          queryName === 'cart'
            ? fetchText
            : '<kovo-query name="reviews" href="/_q/reviews">{"total":3}</kovo-query>',
      });
    });

    root.scripts = [testQueryScript('cart', '/_q/cart', '{"count":1}')];
    root.bindings = [cartBinding, reviewsBinding];

    const refetch = installQueryVisibleReturnRefetch({
      queryPlans: { cart: { bindings: true }, reviews: { bindings: true } },
      queryRefetch: testQueryRefetch(fetch),
      queryStore: store,
      refetchOnFocus,
      root,
    });

    root.scripts.push(testQueryScript('reviews', '/_q/reviews', '{"total":3}'));

    const first = root.listeners.get('visibilitychange')?.(visibleReturnEvent());
    const second = root.listeners.get('visibilitychange')?.(visibleReturnEvent());
    await Promise.resolve();

    // SPEC.md section 4.4: visible-return refetch follows queryRef data discovered after install.
    expect(refetchOnFocus).toHaveBeenCalledWith([{ name: 'cart' }, { name: 'reviews' }]);
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFetchText?.('<kovo-query name="cart" href="/_q/cart">{"count":2}</kovo-query>');
    await Promise.all([first, second]);

    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('reviews')).toEqual({ total: 3 });
    expect(cartBinding.textContent).toBe('2');
    expect(reviewsBinding.textContent).toBe('3');

    refetch.dispose();
    expect(root.listeners.has('visibilitychange')).toBe(false);
    expect(root.listeners.has('pageshow')).toBe(false);
  });

  it('refetches on bfcache pageshow using the visible-return ledger', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const binding = new FakeQueryBindingElement('cart.count', '');
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: async () => '<kovo-query name="cart" href="/_q/cart">{"count":2}</kovo-query>',
      }),
    );

    root.scripts = [testQueryScript('cart', '/_q/cart', '{"count":1}')];
    root.bindings = [binding];

    installQueryVisibleReturnRefetch({
      queryPlans: { cart: { bindings: true } },
      queryRefetch: testQueryRefetch(fetch),
      queryStore: store,
      refetchOnFocus,
      root,
    });

    await root.listeners.get('pageshow')?.({
      persisted: true,
      target: null,
      type: 'pageshow',
    } as DelegatedEvent & {
      persisted: true;
    });

    // SPEC.md §8/§9.3: a bfcache pageshow resumes from server truth through
    // the same typed-read recovery path as visible-return refetch.
    expect(refetchOnFocus).toHaveBeenCalledWith([{ name: 'cart' }]);
    expect(fetch).toHaveBeenCalledWith(typedReadUrl('/_q/cart'), typedReadRequest);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(binding.textContent).toBe('2');
  });

  it('defaults visible-return typed reads to the document build token', async () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originalDocument = globalRecord.document;
    const root = new FakeRoot();
    const store = createQueryStore();
    const onBuildSkew = vi.fn();
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(
        url,
        {
          status: 200,
          text: async () => '<kovo-query name="cart">{"count":99}</kovo-query>',
        },
        { buildToken: 'build-B', sourceUrl: browserTransportTestSourceUrl },
      ),
    );

    root.scripts = [testQueryScript('cart', '/_q/cart', '{"count":1}')];

    try {
      globalRecord.document = {
        querySelector(selector: string) {
          return selector === 'meta[name="kovo-build"]'
            ? { getAttribute: (name: string) => (name === 'content' ? 'build-A' : null) }
            : null;
        },
      };

      installQueryVisibleReturnRefetch({
        queryRefetch: {
          fetch,
          onBuildSkew,
          sourceUrl: browserTransportTestSourceUrl,
        },
        queryStore: store,
        root,
      });

      await root.listeners.get('visibilitychange')?.(visibleReturnEvent());

      // SPEC.md §5.2.1/§9.4/§14: the loader defaults expectedBuildToken from
      // <meta name="kovo-build">, so visible-return /_q data from another build is not merged.
      expect(onBuildSkew).toHaveBeenCalledTimes(1);
      expect(store.get('cart')).toEqual({ count: 1 });
    } finally {
      if (originalDocument === undefined) delete globalRecord.document;
      else globalRecord.document = originalDocument;
    }
  });

  it('also listens for browser pageshow when the loader root is document-like', async () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originalAddEventListener = globalRecord.addEventListener;
    const originalRemoveEventListener = globalRecord.removeEventListener;
    const globalListeners = new Map<string, (event: DelegatedEvent) => void | Promise<void>>();
    const root = new FakeRoot();
    const store = createQueryStore();
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: async () => '<kovo-query name="cart" href="/_q/cart">{"count":2}</kovo-query>',
      }),
    );

    root.scripts = [testQueryScript('cart', '/_q/cart', '{"count":1}')];

    try {
      globalRecord.addEventListener = (
        type: string,
        listener: (event: DelegatedEvent) => void | Promise<void>,
      ) => {
        globalListeners.set(type, listener);
      };
      globalRecord.removeEventListener = (
        type: string,
        listener: (event: DelegatedEvent) => void | Promise<void>,
      ) => {
        if (globalListeners.get(type) === listener) globalListeners.delete(type);
      };

      const refetch = installQueryVisibleReturnRefetch({
        queryRefetch: testQueryRefetch(fetch),
        queryStore: store,
        root,
      });

      expect(root.listeners.has('pageshow')).toBe(true);
      expect(globalListeners.has('pageshow')).toBe(true);

      await globalListeners.get('pageshow')?.({ target: null, type: 'pageshow' });
      expect(fetch).toHaveBeenCalledWith(typedReadUrl('/_q/cart'), typedReadRequest);
      expect(store.get('cart')).toEqual({ count: 2 });

      refetch.dispose();
      expect(root.listeners.has('pageshow')).toBe(false);
      expect(globalListeners.has('pageshow')).toBe(false);
    } finally {
      if (originalAddEventListener === undefined) delete globalRecord.addEventListener;
      else globalRecord.addEventListener = originalAddEventListener;
      if (originalRemoveEventListener === undefined) delete globalRecord.removeEventListener;
      else globalRecord.removeEventListener = originalRemoveEventListener;
    }
  });

  it('makes newly hydrated keyed queryRefs eligible after an earlier typed-read pass', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: async () =>
          new URL(url).pathname === '/_q/cart'
            ? '<kovo-query name="cart" href="/_q/cart">{"count":2}</kovo-query>'
            : '<kovo-query name="group:catalog" key="group:catalog:item" href="/_q/group%3Acatalog?key=item">{"items":["p2"]}</kovo-query>',
      }),
    );

    root.scripts = [testQueryScript('cart', '/_q/cart', '{"count":1}')];

    installQueryVisibleReturnRefetch({
      queryRefetch: testQueryRefetch(fetch),
      queryStore: store,
      refetchOnFocus,
      root,
    });

    await root.listeners.get('visibilitychange')?.(visibleReturnEvent());

    expect(refetchOnFocus).toHaveBeenNthCalledWith(1, [{ name: 'cart' }]);
    expect(fetch).toHaveBeenNthCalledWith(1, typedReadUrl('/_q/cart'), typedReadRequest);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('group:catalog', 'group:catalog:item')).toBeUndefined();

    root.scripts.push(
      testQueryScript(
        'group:catalog',
        '/_q/group%3Acatalog?key=item',
        '{"items":["p1"]}',
        'group:catalog:item',
      ),
    );

    await root.listeners.get('visibilitychange')?.(visibleReturnEvent());

    // SPEC.md §4.4/§9.4: later server-rendered queryRefs join the same visible-return
    // ledger after the first typed-read pass, including their exact retained href and key.
    expect(refetchOnFocus).toHaveBeenNthCalledWith(2, [
      { name: 'cart' },
      { key: 'group:catalog:item', name: 'group:catalog' },
    ]);
    expect(fetch).toHaveBeenNthCalledWith(2, typedReadUrl('/_q/cart'), typedReadRequest);
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      typedReadUrl('/_q/group%3Acatalog?key=item'),
      typedReadRequest,
    );
    expect(store.get('group:catalog', 'group:catalog:item')).toEqual({ items: ['p2'] });
  });

  it('forwards visible-return typed read parse errors to the loader error seam', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const onError = vi.fn();
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: async () => '<kovo-query name="cart" href="/_q/cart">{</kovo-query>',
      }),
    );

    root.scripts = [testQueryScript('cart', '/_q/cart', '{"count":1}')];

    installQueryVisibleReturnRefetch({
      onError,
      queryRefetch: testQueryRefetch(fetch),
      queryStore: store,
      root,
    });

    await root.listeners.get('visibilitychange')?.(visibleReturnEvent());

    // SPEC.md §4.4: visible-return refetch follows hydrated queries; malformed typed-read
    // chunks still report through the same runtime apply path instead of drifting silently.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in kovo-query cart',
    );
    expect(store.get('cart')).toEqual({ count: 1 });
  });

  it('reports visible-return callback failures and still runs typed read refetch', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const callbackError = new Error('focus callback failed');
    const onError = vi.fn();
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: async () => '<kovo-query name="cart">{"count":2}</kovo-query>',
      }),
    );

    root.scripts = [testQueryScript('cart', '/_q/cart', '{"count":1}')];

    installQueryVisibleReturnRefetch({
      onError,
      queryRefetch: testQueryRefetch(fetch),
      queryStore: store,
      refetchOnFocus: async () => {
        throw callbackError;
      },
      root,
    });

    await root.listeners.get('visibilitychange')?.(visibleReturnEvent());

    // SPEC.md §4.4: visible-return refetch is background loader work; callback
    // failures report through the runtime error seam without blocking typed reads.
    expect(onError).toHaveBeenCalledWith(callbackError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toEqual({ count: 2 });
  });

  it('makes stale visible-return listeners inert after disposal', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: async () => '<kovo-query name="cart">{"count":2}</kovo-query>',
      }),
    );

    root.scripts = [testQueryScript('cart', '/_q/cart', '{"count":1}')];

    const refetch = installQueryVisibleReturnRefetch({
      queryRefetch: testQueryRefetch(fetch),
      queryStore: store,
      refetchOnFocus,
      root,
    });
    const staleListener = root.listeners.get('visibilitychange');

    refetch.dispose();
    await staleListener?.(visibleReturnEvent());
    refetch.rememberAppliedQueries(['reviews']);
    await staleListener?.(visibleReturnEvent());

    // SPEC.md §4.4: disposed visible-return refetch must not keep observing queryRef data.
    expect(refetchOnFocus).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(root.listeners.has('visibilitychange')).toBe(false);
    expect(root.listeners.has('pageshow')).toBe(false);
  });

  it('does not continue typed-read refetch work after disposal during visible-return', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    let resolveFocus: (() => void) | undefined;
    const focusDone = new Promise<void>((resolve) => {
      resolveFocus = resolve;
    });
    const refetchOnFocus = vi.fn(() => focusDone);
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: async () => '<kovo-query name="cart">{"count":2}</kovo-query>',
      }),
    );

    root.scripts = [testQueryScript('cart', '/_q/cart', '{"count":1}')];

    const refetch = installQueryVisibleReturnRefetch({
      queryRefetch: testQueryRefetch(fetch),
      queryStore: store,
      refetchOnFocus,
      root,
    });
    const visibleReturn = root.listeners.get('visibilitychange')?.(visibleReturnEvent());

    await Promise.resolve();
    refetch.dispose();
    resolveFocus?.();
    await visibleReturn;

    // SPEC.md §4.4: disposal stops the remaining typed-read leg of a visible-return pass.
    expect(refetchOnFocus).toHaveBeenCalledWith([{ name: 'cart' }]);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.get('cart')).toEqual({ count: 1 });
  });

  it('excludes a declared refetchOnFocus:false queryRef from focus refetch while others still refetch (SPEC §9.3/§9.4)', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const cartBinding = new FakeQueryBindingElement('cart.count', '');
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: async () => '<kovo-query name="cart">{"count":2}</kovo-query>',
      }),
    );

    root.scripts = [
      testQueryScript('cart', '/_q/cart', '{"count":1}'),
      testQueryScript('productGrid', '/_q/productGrid', '{"products":[]}'),
    ];
    root.bindings = [cartBinding];

    // SPEC §9.3/§9.4: the declarative opt-out lives on the `@kovojs/core` queryRef handle, and the
    // runtime derives its focus-refetch exclusion from those declarations — a `queryRef(key,
    // { refetchOnFocus: false })` declaration drives the runtime, an unmarked queryRef still refetches.
    installQueryVisibleReturnRefetch({
      declaredQueries: [queryRef('productGrid', { refetchOnFocus: false }), queryRef('cart')],
      queryPlans: { cart: { bindings: true } },
      queryRefetch: testQueryRefetch(fetch),
      queryStore: store,
      refetchOnFocus,
      root,
    });

    await root.listeners.get('visibilitychange')?.(visibleReturnEvent());

    // `productGrid` was declared `refetchOnFocus: false`, so it is excluded; `cart` still refetches.
    expect(refetchOnFocus).toHaveBeenCalledWith([{ name: 'cart' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(typedReadUrl('/_q/cart'), typedReadRequest);
    expect(store.get('cart')).toEqual({ count: 2 });
    // The opted-out queryRef keeps its hydrated value and is never re-read on focus.
    expect(store.get('productGrid')).toEqual({ products: [] });
  });
});
