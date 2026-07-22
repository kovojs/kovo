import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryStore } from './query-store.js';
import { applyQueryChunksToRuntime, rebaserApplyQueryInterposition } from './query-apply.js';
import { OptimisticRebaser } from './optimism.js';
import {
  createDeltaMissRefetcher as createFrameworkDeltaMissRefetcher,
  deriveRefetchOnFocusOptOut,
  refetchQueries as refetchFrameworkQueries,
} from './query-refetch.js';
import { hydrateQueryScripts } from './query-script-hydration.js';
import { FakeMorphRoot, FakeQueryBindingElement } from './runtime-test-fakes.js';
import { readQueryChunks } from './wire-parser.js';

const TEST_SOURCE_URL = 'http://localhost/account';
const TEST_REQUEST_HEADERS = {
  Accept: 'text/html',
  'Kovo-Build': 'test-build',
  'Kovo-Fragment': 'true',
};
const queryResponseUrl = (value: string) => new URL(value, TEST_SOURCE_URL).href;
const queryRequestPath = (value: string) => {
  const parsed = new URL(value);
  return parsed.pathname + parsed.search;
};
const fragmentHeaders = (
  read: (name: string) => string | null = (name) => (name === 'Kovo-Build' ? 'test-build' : null),
  mediaType = 'text/html; charset=utf-8',
) => ({
  get(name: string) {
    return name.toLowerCase() === 'content-type' ? mediaType : read(name);
  },
});
const refetchQueries = (options: Parameters<typeof refetchFrameworkQueries>[0]) =>
  refetchFrameworkQueries({
    expectedBuildToken: 'test-build',
    sourceUrl: TEST_SOURCE_URL,
    ...options,
  });
const createDeltaMissRefetcher = (
  options: Parameters<typeof createFrameworkDeltaMissRefetcher>[0],
) =>
  createFrameworkDeltaMissRefetcher({
    expectedBuildToken: 'test-build',
    sourceUrl: TEST_SOURCE_URL,
    ...options,
  });

beforeAll(() => {
  // Seed canonical refetch hrefs through the real wire parser + hydration/apply path. The private
  // ledger must be populated when server truth is applied, not by a test-only metadata backdoor.
  const hydrationStore = createQueryStore();
  applyQueryChunksToRuntime(
    hydrationStore,
    readQueryChunks(
      [
        '<kovo-query name="cart" href="/_q/cart">null</kovo-query>',
        '<kovo-query name="reviews" href="/_q/reviews">null</kovo-query>',
        '<kovo-query name="inventory" href="/_q/inventory">null</kovo-query>',
        '<kovo-query name="product" key="product:p1" href="/_q/product?key=p1">null</kovo-query>',
        '<kovo-query name="group:catalog" key="group:catalog:item" href="/_q/group%3Acatalog?key=item">null</kovo-query>',
        '<kovo-query name="productDetail" key="product:p1" href="/_q/productDetail?key=product%3Ap1">null</kovo-query>',
        '<kovo-query name="cart" key="cart:" href="/_q/cart?key=">null</kovo-query>',
        '<kovo-query name="queries/product details" key="queries/product details:p 1" href="/_q/queries/product%20details?key=p%201">null</kovo-query>',
        '<kovo-query name="recommendations" key="recommendations:user-1" href="/_q/recommendations?key=user-1">null</kovo-query>',
      ].join(''),
    ),
  );
});

describe('refetch-on-focus opt-out derivation', () => {
  it('derives the opt-out name set from declared refetchOnFocus:false queries (SPEC §9.3/§9.4)', () => {
    // SPEC §9.3/§9.4: a query declared with `refetchOnFocus: false` is excluded from focus
    // refetch; queries without the field stay eligible. The declared value drives the runtime
    // opt-out, so the field is not dead metadata.
    expect(
      deriveRefetchOnFocusOptOut([
        { key: 'ticker', refetchOnFocus: false },
        { key: 'cart' },
        { key: 'product', refetchOnFocus: false },
      ]),
    ).toEqual(['ticker', 'product']);

    // No declared opt-outs → empty set → nothing excluded (refetch-on-focus stays on by default).
    expect(deriveRefetchOnFocusOptOut([{ key: 'cart' }, { key: 'reviews' }])).toEqual([]);

    // Duplicate declarations of the same opted-out query collapse to one entry.
    expect(
      deriveRefetchOnFocusOptOut([
        { key: 'ticker', refetchOnFocus: false },
        { key: 'ticker', refetchOnFocus: false },
      ]),
    ).toEqual(['ticker']);
  });
});

describe('query refetch', () => {
  it('does not materialize query truth from an attachment response', async () => {
    const store = createQueryStore();
    const text = vi.fn(() => '<kovo-query name="cart">{"html":"ATTACKER"}</kovo-query>');
    const onError = vi.fn();

    await expect(
      refetchQueries({
        fetch: (url) => ({
          headers: {
            get(name: string) {
              if (name.toLowerCase() === 'content-type') {
                return 'text/html; charset=utf-8';
              }
              if (name === 'Kovo-Build') return 'test-build';
              return name.toLowerCase() === 'content-disposition'
                ? 'attachment; filename="attacker.html"'
                : null;
            },
          },
          redirected: false,
          status: 200,
          text,
          url: queryResponseUrl(url),
        }),
        onError,
        queries: ['cart'],
        queryStore: store,
      }),
    ).resolves.toEqual([]);

    expect(text).not.toHaveBeenCalled();
    expect(store.get('cart')).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/attachment or malformed/u) }),
    );
  });

  it('preserves direct injected response carriers and synchronous text', async () => {
    const store = createQueryStore();
    const response = {
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: () => '<kovo-query name="cart">{"count":3}</kovo-query>',
      url: queryResponseUrl('/_q/cart'),
    };

    await expect(
      refetchQueries({ fetch: () => response, queries: ['cart'], queryStore: store }),
    ).resolves.toEqual([{ fragments: [], queries: [{ name: 'cart' }] }]);
    expect(store.get('cart')).toEqual({ count: 3 });
  });

  it('rejects direct thenable response carriers without invoking their then method', async () => {
    const store = createQueryStore();
    const then = vi.fn();

    await expect(
      refetchQueries({
        fetch: () => ({ status: 200, text: () => '', then }),
        onError(error) {
          throw error;
        },
        queries: ['cart'],
        queryStore: store,
      }),
    ).rejects.toThrow(/cannot be thenable/);
    expect(then).not.toHaveBeenCalled();
  });

  it('applies only dense decoded query facts after late Array iterator poisoning', async () => {
    const store = createQueryStore();
    const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    if (!iterator) throw new Error('Missing Array iterator security descriptor');
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () => '<kovo-query name="cart">{"count":2}</kovo-query>',
      url: queryResponseUrl(url),
    }));
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      ...iterator,
      value: function* () {
        yield { name: 'attacker', value: { admin: true } };
      },
    });
    let applied;
    try {
      applied = await refetchQueries({ fetch, queries: ['cart'], queryStore: store });
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
    }

    // SPEC §6.6/§9.4: the query apply loop consumes the scanner's dense carrier, not an
    // ambient iterator that authored code can redirect to attacker-chosen server truth.
    expect(applied).toEqual([{ fragments: [], queries: [{ name: 'cart' }] }]);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('attacker')).toBeUndefined();
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
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () =>
        queryRequestPath(url) === '/_q/cart'
          ? [
              '<kovo-query name="cart">{"count":2}</kovo-query>',
              '<kovo-fragment target="cart-badge"><cart-badge>2</cart-badge></kovo-fragment>',
            ].join('')
          : '<kovo-query name="reviews">{"total":5}</kovo-query>',
      url: queryResponseUrl(url),
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
      { fragments: [], queries: [{ name: 'cart' }] },
      { fragments: [], queries: [{ name: 'reviews' }] },
    ]);

    expect(fetch).toHaveBeenNthCalledWith(1, queryResponseUrl('/_q/cart'), {
      cache: 'no-store',
      headers: TEST_REQUEST_HEADERS,
      method: 'GET',
      redirect: 'error',
    });
    expect(fetch).toHaveBeenNthCalledWith(2, queryResponseUrl('/_q/reviews'), {
      cache: 'no-store',
      headers: TEST_REQUEST_HEADERS,
      method: 'GET',
      redirect: 'error',
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
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () =>
        queryRequestPath(url) === '/_q/cart'
          ? '<kovo-query name="cart">{"label":"Cart has items"}</kovo-query>'
          : '<kovo-query name="reviews">{"total":8}</kovo-query>',
      url: queryResponseUrl(url),
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
      { fragments: [], queries: [{ name: 'cart' }] },
      { fragments: [], queries: [{ name: 'reviews' }] },
    ]);

    // SPEC.md §4.4/§9.4: a visible-return typed-read pass should share the
    // batched runtime query apply path used by hydrated scripts and mutation
    // responses, so the compiled binding index is built once for all chunks.
    expect(root.wildcardSelectorCalls).toBe(1);
    expect(badge.getAttribute('aria-label')).toBe('Cart has items');
    expect(meter.getAttribute('value')).toBe('8');
  });

  it('uses the server-emitted canonical href for a keyed query refetch (F5)', async () => {
    const store = createQueryStore();
    const plan = vi.fn();
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () => '<kovo-query name="product" key="product:p1">{"stock":6}</kovo-query>',
      url: queryResponseUrl(url),
    }));

    store.subscribe('product', plan, 'product:p1');

    await expect(
      refetchQueries({
        fetch,
        queries: [{ key: 'product:p1', name: 'product' }],
        queryStore: store,
      }),
    ).resolves.toEqual([{ fragments: [], queries: [{ key: 'product:p1', name: 'product' }] }]);

    // SPEC.md §9.4/§10.2 (F5): hydration retained this exact server-authored href. The browser
    // does not attempt to invert the app's instance-key function.
    expect(fetch).toHaveBeenCalledWith(queryResponseUrl('/_q/product?key=p1'), {
      cache: 'no-store',
      headers: TEST_REQUEST_HEADERS,
      method: 'GET',
      redirect: 'error',
    });
    expect(store.get('product', 'product:p1')).toEqual({ stock: 6 });
    expect(store.get('product')).toBeUndefined();
    expect(plan).toHaveBeenCalledWith({ stock: 6 });
  });

  it('carries document-script href authority through hydration into the keyed fetch', async () => {
    const store = createQueryStore();
    hydrateQueryScripts(store, [
      {
        getAttribute(name) {
          if (name === 'kovo-query') return 'hydrated-product';
          if (name === 'key') return 'hydrated-product:raw:p1';
          if (name === 'data-kovo-query-href') {
            return '/_q/hydrated-product?id=raw%3Ap1&view=card';
          }
          return null;
        },
        textContent: '{"stock":1}',
      },
    ]);
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () =>
        '<kovo-query name="hydrated-product" key="hydrated-product:raw:p1">{"stock":2}</kovo-query>',
      url: queryResponseUrl(url),
    }));

    await refetchQueries({
      fetch,
      queries: [{ key: 'hydrated-product:raw:p1', name: 'hydrated-product' }],
      queryStore: store,
    });

    expect(fetch).toHaveBeenCalledWith(
      queryResponseUrl('/_q/hydrated-product?id=raw%3Ap1&view=card'),
      {
        cache: 'no-store',
        headers: TEST_REQUEST_HEADERS,
        method: 'GET',
        redirect: 'error',
      },
    );
    expect(store.get('hydrated-product', 'hydrated-product:raw:p1')).toEqual({ stock: 2 });
  });

  it('never strips a name-shaped prefix from an opaque instance key to synthesize a URL', async () => {
    const store = createQueryStore();
    applyQueryChunksToRuntime(
      store,
      readQueryChunks(
        '<kovo-query name="product" key="product:product:p1" href="/_q/product?id=product%3Ap1">{"stock":1}</kovo-query>',
      ),
    );
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () =>
        '<kovo-query name="product" key="product:product:p1">{"stock":2}</kovo-query>',
      url: queryResponseUrl(url),
    }));

    await refetchQueries({
      fetch,
      queries: [{ key: 'product:product:p1', name: 'product' }],
      queryStore: store,
    });

    expect(fetch).toHaveBeenCalledWith(queryResponseUrl('/_q/product?id=product%3Ap1'), {
      cache: 'no-store',
      headers: TEST_REQUEST_HEADERS,
      method: 'GET',
      redirect: 'error',
    });
    expect(store.get('product', 'product:product:p1')).toEqual({ stock: 2 });
  });

  it('keeps server-emitted keyed hrefs separate from colon-bearing query identities', async () => {
    const store = createQueryStore();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        headers: fragmentHeaders(),
        redirected: false,
        status: 200,
        text: async () =>
          '<kovo-query name="group:catalog" key="group:catalog:item">{"stock":3}</kovo-query>',
        url: queryResponseUrl('/_q/group%3Acatalog?key=item'),
      })
      .mockResolvedValueOnce({
        headers: fragmentHeaders(),
        redirected: false,
        status: 200,
        text: async () =>
          '<kovo-query name="productDetail" key="product:p1">{"stock":4}</kovo-query>',
        url: queryResponseUrl('/_q/productDetail?key=product%3Ap1'),
      });

    await refetchQueries({
      fetch,
      queries: [
        { key: 'group:catalog:item', name: 'group:catalog' },
        { key: 'product:p1', name: 'productDetail' },
      ],
      queryStore: store,
    });

    expect(fetch).toHaveBeenNthCalledWith(1, queryResponseUrl('/_q/group%3Acatalog?key=item'), {
      cache: 'no-store',
      headers: TEST_REQUEST_HEADERS,
      method: 'GET',
      redirect: 'error',
    });
    // A domain-owned canonical instance key may legitimately differ from the registry name.
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      queryResponseUrl('/_q/productDetail?key=product%3Ap1'),
      {
        cache: 'no-store',
        headers: TEST_REQUEST_HEADERS,
        method: 'GET',
        redirect: 'error',
      },
    );
  });

  it('passes frozen structured identities to custom URL hooks without colon ambiguity', async () => {
    const store = createQueryStore();
    const seen: unknown[] = [];
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () =>
        queryRequestPath(url) === '/_q/unkeyed-colon-name'
          ? '<kovo-query name="foo:bar">{"kind":"unkeyed"}</kovo-query>'
          : '<kovo-query name="foo" key="foo:bar">{"kind":"keyed"}</kovo-query>',
      url: queryResponseUrl(url),
    }));

    await refetchQueries({
      fetch,
      queries: ['foo:bar', { key: 'foo:bar', name: 'foo' }],
      queryStore: store,
      urlForQuery(identity) {
        expect(Object.isFrozen(identity)).toBe(true);
        seen.push(identity);
        return identity.key === undefined ? '/_q/unkeyed-colon-name' : '/_q/keyed-colon-instance';
      },
    });

    expect(seen).toEqual([{ name: 'foo:bar' }, { key: 'foo:bar', name: 'foo' }]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      queryResponseUrl('/_q/unkeyed-colon-name'),
      queryResponseUrl('/_q/keyed-colon-instance'),
    ]);
    expect(store.get('foo:bar')).toEqual({ kind: 'unkeyed' });
    expect(store.get('foo', 'foo:bar')).toEqual({ kind: 'keyed' });
  });

  it('rejects a raw empty structured key but permits the canonical empty-value identity', async () => {
    const store = createQueryStore();
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () => '<kovo-query name="cart" key="cart:">{"count":1}</kovo-query>',
      url: queryResponseUrl(url),
    }));

    await expect(
      refetchQueries({ fetch, queries: [{ key: '', name: 'cart' }], queryStore: store }),
    ).rejects.toThrow(/non-empty own-data valid scalar/u);
    expect(fetch).not.toHaveBeenCalled();

    await refetchQueries({
      fetch,
      queries: [{ key: 'cart:', name: 'cart' }],
      queryStore: store,
    });
    expect(fetch).toHaveBeenCalledWith(queryResponseUrl('/_q/cart?key='), {
      cache: 'no-store',
      headers: TEST_REQUEST_HEADERS,
      method: 'GET',
      redirect: 'error',
    });
  });

  it('preserves query-name path hierarchy while encoding each path segment', async () => {
    const store = createQueryStore();
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () =>
        '<kovo-query name="queries/product details" key="queries/product details:p 1">{"stock":4}</kovo-query>',
      url: queryResponseUrl(url),
    }));

    await expect(
      refetchQueries({
        fetch,
        queries: [
          {
            key: 'queries/product details:p 1',
            name: 'queries/product details',
          },
        ],
        queryStore: store,
      }),
    ).resolves.toEqual([
      {
        fragments: [],
        queries: [{ key: 'queries/product details:p 1', name: 'queries/product details' }],
      },
    ]);

    // SPEC.md §9.4/§10.2: query names retain their registered slash hierarchy. Encoding
    // the complete name would produce `%2F`, which the request-ingress floor rejects as an
    // ambiguous encoded path separator; reserved characters inside a segment remain encoded.
    expect(fetch).toHaveBeenCalledWith(
      queryResponseUrl('/_q/queries/product%20details?key=p%201'),
      {
        cache: 'no-store',
        headers: TEST_REQUEST_HEADERS,
        method: 'GET',
        redirect: 'error',
      },
    );
    expect(store.get('queries/product details', 'queries/product details:p 1')).toEqual({
      stock: 4,
    });
  });

  it('does not apply failed typed read responses', async () => {
    const store = createQueryStore();
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      ok: false,
      redirected: false,
      status: 500,
      text: async () => '<kovo-query name="cart">{"count":2}</kovo-query>',
      url: queryResponseUrl(url),
    }));

    await expect(
      refetchQueries({
        fetch,
        queries: ['cart'],
        queryStore: store,
      }),
    ).resolves.toEqual([]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toBeUndefined();
  });

  it('terminally recovers when a requested query has no server-emitted href metadata', async () => {
    const store = createQueryStore();
    const onDocumentRecovery = vi.fn();
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () => '<kovo-query name="cart">{"count":2}</kovo-query>',
      url: queryResponseUrl(url),
    }));

    const applied = await refetchQueries({
      fetch,
      onDocumentRecovery,
      queries: ['cart', 'query-without-href-authority', 'reviews'],
      queryStore: store,
    });

    expect(applied).toEqual([]);
    expect(onDocumentRecovery).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('reviews')).toBeUndefined();
  });

  it('keeps failed native responses rejected after late Response prototype poisoning', async () => {
    const store = createQueryStore();
    const response = new Response('<kovo-query name="cart">{"count":99}</kovo-query>', {
      status: 500,
    });
    let releaseFetch: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const pending = refetchQueries({
      fetch: async () => {
        await gate;
        return response;
      },
      queries: ['cart'],
      queryStore: store,
    });
    const ok = Object.getOwnPropertyDescriptor(Response.prototype, 'ok');
    const status = Object.getOwnPropertyDescriptor(Response.prototype, 'status');
    if (!ok || !status) throw new Error('Missing Response security descriptors');
    Object.defineProperty(Response.prototype, 'ok', { ...ok, get: () => true });
    Object.defineProperty(Response.prototype, 'status', { ...status, get: () => 200 });
    try {
      releaseFetch?.();
      await expect(pending).resolves.toEqual([]);
    } finally {
      Object.defineProperty(Response.prototype, 'ok', ok);
      Object.defineProperty(Response.prototype, 'status', status);
    }

    // SPEC §6.6/§9.4: visible-return typed reads share the boot-pinned response membrane;
    // a failed response cannot become fresh server truth through late Web API getter replacement.
    expect(store.get('cart')).toBeUndefined();
  });

  it('reports malformed typed read query chunks through the shared decoded apply path', async () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () =>
        queryRequestPath(url) === '/_q/cart'
          ? '<kovo-query name="cart">{</kovo-query><kovo-query name="inventory">{"available":true}</kovo-query>'
          : '<kovo-query name="reviews">{"total":2}</kovo-query>',
      url: queryResponseUrl(url),
    }));

    const applied = await refetchQueries({
      fetch,
      onError,
      queries: ['cart', 'reviews'],
      queryStore: store,
    });

    // SPEC.md §4.4/§9.4: typed-read visible-return refetch applies server query chunks
    // through the same decoded runtime apply primitive as mutation bodies, but endpoint identity
    // is exact: an `inventory` chunk cannot gain truth authority from the `cart` response.
    expect(applied).toEqual([{ fragments: [], queries: [{ name: 'reviews' }] }]);
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toBeUndefined();
    expect(store.get('reviews')).toEqual({ total: 2 });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in kovo-query cart',
    );
    expect(String(onError.mock.calls[1]?.[0].message)).toContain('different query identity');
  });

  it('reports typed read apply hook failures while continuing later chunks in the batch', async () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const applyError = new Error('cart hook failed');
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () =>
        queryRequestPath(url) === '/_q/cart'
          ? '<kovo-query name="cart">{"count":2}</kovo-query>'
          : '<kovo-query name="reviews">{"total":4}</kovo-query>',
      url: queryResponseUrl(url),
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
    expect(applied).toEqual([{ fragments: [], queries: [{ name: 'reviews' }] }]);
    expect(onError).toHaveBeenCalledWith(applyError);
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('reviews')).toEqual({ total: 4 });
  });

  it('reports typed read transport failures and continues applying later queries', async () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const transportError = new Error('typed read failed');
    const fetch = vi.fn(async (url: string) => {
      if (queryRequestPath(url) === '/_q/cart') throw transportError;

      return {
        headers: fragmentHeaders(),
        redirected: false,
        status: 200,
        text: async () => '<kovo-query name="reviews">{"total":2}</kovo-query>',
        url: queryResponseUrl(url),
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
    expect(applied).toEqual([{ fragments: [], queries: [{ name: 'reviews' }] }]);
    expect(onError).toHaveBeenCalledWith(transportError);
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('reviews')).toEqual({ total: 2 });
  });

  it('recovers the native document when an admitted same-build typed read denies access', async () => {
    const store = createQueryStore();
    store.set('secret', { value: 'prior-private-truth' });
    const onAuthDenied = vi.fn();
    const onError = vi.fn();
    const text = vi.fn(async () => '<kovo-query name="secret">{"value":"attacker"}</kovo-query>');
    const fetch = vi.fn(async (url: string, init: { redirect: 'error' }) => {
      expect(init.redirect).toBe('error');
      return {
        headers: fragmentHeaders(),
        redirected: false,
        status: 403,
        text,
        url: queryResponseUrl(url),
      };
    });

    const applied = await refetchQueries({
      fetch,
      onAuthDenied,
      onError,
      queries: ['secret'],
      queryStore: store,
      urlForQuery: () => '/_q/secret',
    });

    expect(applied).toEqual([]);
    expect(onAuthDenied).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(store.get('secret')).toEqual({ value: 'prior-private-truth' });
  });

  it('does not infer auth revocation from redirect-error transport rejection', async () => {
    const store = createQueryStore();
    store.set('secret', { value: 'prior-private-truth' });
    const redirectError = new TypeError('redirect mode rejected a response redirect');
    const onAuthDenied = vi.fn();
    const onError = vi.fn();
    const fetch = vi.fn((_url: string, init: { redirect: 'error' }) => {
      expect(init.redirect).toBe('error');
      throw redirectError;
    });

    const applied = await refetchQueries({
      fetch,
      onAuthDenied,
      onError,
      queries: ['secret'],
      queryStore: store,
      urlForQuery: () => '/_q/secret',
    });

    expect(applied).toEqual([]);
    expect(onAuthDenied).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(redirectError);
    expect(store.get('secret')).toEqual({ value: 'prior-private-truth' });
  });

  it('keeps auth denial terminal when recovery throws after an earlier query response', async () => {
    const store = createQueryStore();
    const recoveryError = new Error('navigation adapter threw');
    const onAuthDenied = vi.fn(() => {
      throw recoveryError;
    });
    const onError = vi.fn();
    const fetch = vi.fn(async (url: string) => {
      const path = queryRequestPath(url);
      if (path === '/_q/terminal-first') {
        return {
          headers: fragmentHeaders(),
          redirected: false,
          status: 200,
          text: async () =>
            '<kovo-query name="terminal-first">{"value":"must-not-apply"}</kovo-query>',
          url: queryResponseUrl(url),
        };
      }
      if (path !== '/_q/terminal-denied') throw new Error('fetched after terminal denial');
      return {
        headers: fragmentHeaders(),
        redirected: false,
        status: 403,
        text: vi.fn(async () => ''),
        url: queryResponseUrl(url),
      };
    });

    const applied = await refetchQueries({
      fetch,
      onAuthDenied,
      onError,
      queries: ['terminal-first', 'terminal-denied', 'terminal-later'],
      queryStore: store,
      urlForQuery: (query) => `/_q/${query.name}`,
    });

    expect(applied).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onAuthDenied).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(recoveryError);
    expect(store.get('terminal-first')).toBeUndefined();
    expect(store.get('terminal-later')).toBeUndefined();
  });

  it('keeps build-skew recovery terminal when its callback throws after an earlier response', async () => {
    const store = createQueryStore();
    const recoveryError = new Error('reload adapter threw');
    const onBuildSkew = vi.fn(() => {
      throw recoveryError;
    });
    const onError = vi.fn();
    const fetch = vi.fn(async (url: string) => {
      const path = queryRequestPath(url);
      if (path === '/_q/skew-first') {
        return {
          headers: fragmentHeaders(),
          redirected: false,
          status: 200,
          text: async () => '<kovo-query name="skew-first">{"value":"must-not-apply"}</kovo-query>',
          url: queryResponseUrl(url),
        };
      }
      if (path !== '/_q/skew-denied') throw new Error('fetched after terminal build skew');
      return {
        headers: fragmentHeaders((name) => {
          if (name === 'Kovo-Build') return 'other-build';
          if (name === 'Kovo-Build-Skew') return 'true';
          return null;
        }, 'text/vnd.kovo.fragment+html; charset=utf-8'),
        redirected: false,
        status: 409,
        text: vi.fn(async () => ''),
        url: queryResponseUrl(url),
      };
    });

    const applied = await refetchQueries({
      fetch,
      onBuildSkew,
      onError,
      queries: ['skew-first', 'skew-denied', 'skew-later'],
      queryStore: store,
      urlForQuery: (query) => `/_q/${query.name}`,
    });

    expect(applied).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onBuildSkew).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(recoveryError);
    expect(store.get('skew-first')).toBeUndefined();
    expect(store.get('skew-later')).toBeUndefined();
  });

  it('stamps /_q with the document build and reloads on a stamped 409 mismatch', async () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });
    const onBuildSkew = vi.fn();
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders((name) => {
        if (name === 'Kovo-Build') return 'build-B';
        if (name === 'Kovo-Build-Skew') return 'true';
        return null;
      }, 'text/vnd.kovo.fragment+html; charset=utf-8'),
      redirected: false,
      status: 409,
      text: async () => '<kovo-query name="cart">{"count":99}</kovo-query>',
      url: queryResponseUrl(url),
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
    expect(fetch).toHaveBeenCalledWith(queryResponseUrl('/_q/cart'), {
      cache: 'no-store',
      headers: {
        Accept: 'text/html',
        'Kovo-Build': 'build-A',
        'Kovo-Fragment': 'true',
      },
      method: 'GET',
      redirect: 'error',
    });
  });

  it('escalates to a reload (no apply) when a stamped /_q refetch omits Kovo-Build', async () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });
    const onBuildSkew = vi.fn();
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(() => null),
      redirected: false,
      status: 200,
      text: async () => '<kovo-query name="cart">{"count":99}</kovo-query>',
      url: queryResponseUrl(url),
    }));

    const applied = await refetchQueries({
      expectedBuildToken: 'build-A',
      fetch,
      onBuildSkew,
      queries: ['cart'],
      queryStore: store,
    });

    expect(onBuildSkew).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([]);
    expect(store.get('cart')).toEqual({ count: 1 });
  });

  it('keeps missing build terminal even when the exact response has malformed media', async () => {
    const store = createQueryStore();
    store.set('media-skew', { count: 1 });
    const onBuildSkew = vi.fn();
    const onError = vi.fn();
    const text = vi.fn(async () => '<kovo-query name="media-skew">{"count":99}</kovo-query>');

    const applied = await refetchQueries({
      fetch: async (url) => ({
        headers: fragmentHeaders(() => null, 'application/octet-stream'),
        redirected: false,
        status: 200,
        text,
        url: queryResponseUrl(url),
      }),
      onBuildSkew,
      onError,
      queries: ['media-skew'],
      queryStore: store,
      urlForQuery: () => '/_q/media-skew',
    });

    expect(applied).toEqual([]);
    expect(onBuildSkew).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(store.get('media-skew')).toEqual({ count: 1 });
  });

  it('prevents an older in-flight refetch from applying after another batch selects denial', async () => {
    const store = createQueryStore();
    let releaseOlder: ((response: unknown) => void) | undefined;
    const olderResponse = new Promise<unknown>((resolve) => {
      releaseOlder = resolve;
    });
    const onAuthDenied = vi.fn(() => {
      throw new Error('delayed navigation adapter');
    });
    const onError = vi.fn();
    const older = refetchQueries({
      fetch: () => olderResponse as never,
      onAuthDenied,
      onError,
      queries: ['race-older'],
      queryStore: store,
      urlForQuery: () => '/_q/race-older',
    });

    await refetchQueries({
      fetch: async (url) => ({
        headers: fragmentHeaders(),
        redirected: false,
        status: 403,
        text: async () => '',
        url: queryResponseUrl(url),
      }),
      onAuthDenied,
      onError,
      queries: ['race-denied'],
      queryStore: store,
      urlForQuery: () => '/_q/race-denied',
    });

    releaseOlder?.({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () => '<kovo-query name="race-older">{"secret":"must-not-apply"}</kovo-query>',
      url: queryResponseUrl('/_q/race-older'),
    });
    await older;

    expect(onAuthDenied).toHaveBeenCalledOnce();
    expect(store.get('race-older')).toBeUndefined();
  });

  it('applies normally when the /_q refetch token matches the document token (D2)', async () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });
    const onBuildSkew = vi.fn();
    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders((name) => (name === 'Kovo-Build' ? 'build-A' : null)),
      redirected: false,
      status: 200,
      text: async () => '<kovo-query name="cart">{"count":2}</kovo-query>',
      url: queryResponseUrl(url),
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
    const fetch = vi.fn(async (url: string) => {
      resolveFetch?.();
      return {
        headers: fragmentHeaders(),
        redirected: false,
        status: 200,
        text: async () =>
          '<kovo-query name="recommendations" key="recommendations:user-1">{"items":["p9"]}</kovo-query>',
        url: queryResponseUrl(url),
      };
    });

    const onDeltaMiss = createDeltaMissRefetcher({ fetch, queryStore: store });
    onDeltaMiss('recommendations', 'recommendations:user-1');
    await done;
    await vi.waitFor(() => {
      expect(store.get('recommendations', 'recommendations:user-1')).toEqual({ items: ['p9'] });
    });

    expect(fetch).toHaveBeenCalledWith(queryResponseUrl('/_q/recommendations?key=user-1'), {
      cache: 'no-store',
      headers: TEST_REQUEST_HEADERS,
      method: 'GET',
      redirect: 'error',
    });
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

    const fetch = vi.fn(async (url: string) => ({
      headers: fragmentHeaders(),
      redirected: false,
      status: 200,
      text: async () => '<kovo-query name="cart">{"count":100}</kovo-query>',
      url: queryResponseUrl(url),
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
