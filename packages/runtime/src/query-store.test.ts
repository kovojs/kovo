import { describe, expect, it, vi } from 'vitest';

import { installJisoLoader, type DelegatedEvent } from './index.js';
import {
  applyQueryChunksToRuntime,
  createQueryScriptHydrationLedger,
  hydrateQueryScripts,
  queryScriptsFromRoot,
} from './query-apply.js';
import { createQueryStore } from './query-store.js';

class FakeRoot {
  bindings: QueryBinding[] = [];
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

class FakeFormElement {
  attributes: { name: string; value: string }[];
  action: string;
  method: string | undefined;

  constructor(attributes: Record<string, string>, options: { action: string; method?: string }) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.action = options.action;
    this.method = options.method;
  }

  closest(_selector: string): FakeFormElement {
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }
}

class FakeMorphTarget {
  html = '';

  replaceWithHtml(html: string): void {
    this.html = html;
  }
}

interface FakeTargetElement {
  getAttribute(name: string): string | null;
  id?: string;
}

class FakeMorphRoot {
  deps: { deps?: string; id?: string; target?: string }[] = [];
  targets = new Map<string, FakeMorphTarget>();

  findFragmentTarget(target: string): FakeMorphTarget | null {
    return this.targets.get(target) ?? null;
  }

  querySelectorAll(selector: string): Iterable<FakeTargetElement> {
    return selector === '[fw-deps]'
      ? this.deps.map((dep) => ({
          getAttribute: (name) => {
            if (name === 'fw-fragment-target') return dep.target ?? null;
            if (name === 'fw-deps') return dep.deps ?? null;
            return null;
          },
          ...(dep.id ? { id: dep.id } : {}),
        }))
      : [];
  }
}

class FakeBroadcastChannel {
  closed = false;
  messages: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  close(): void {
    this.closed = true;
  }
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

  it('hydrates keyed query instances with canonical typed-read keys', () => {
    const store = createQueryStore();
    const p1Plan = vi.fn();
    const p2Plan = vi.fn();

    store.subscribe('product', p1Plan, 'p1');
    store.subscribe('product', p2Plan, 'p2');
    const hydrated = hydrateQueryScripts(store, [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'product' : name === 'key' ? 'p1' : null),
        textContent: '{"stock":4}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'product' : name === 'key' ? 'p2' : null),
        textContent: '{"stock":9}',
      },
    ]);

    // SPEC.md §9.4: query instance keys use one canonical currency across
    // hydration, the client store, and typed-read refetch.
    expect(hydrated).toEqual(['product:p1', 'product:p2']);
    expect(store.get('product', 'p1')).toEqual({ stock: 4 });
    expect(store.get('product', 'p2')).toEqual({ stock: 9 });
    expect(store.get('product')).toBeUndefined();
    expect(p1Plan).toHaveBeenCalledWith({ stock: 4 });
    expect(p2Plan).toHaveBeenCalledWith({ stock: 9 });
  });

  it('shares keyed store writes between hydration and mutation query chunks', () => {
    const hydratedStore = createQueryStore();
    const appliedStore = createQueryStore();
    const hydratedPlan = vi.fn();
    const appliedPlan = vi.fn();

    hydratedStore.subscribe('product', hydratedPlan, 'p1');
    appliedStore.subscribe('product', appliedPlan, 'p1');

    const hydrated = hydrateQueryScripts(hydratedStore, [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'product' : name === 'key' ? 'p1' : null),
        textContent: '{"stock":4}',
      },
    ]);
    const applied = applyQueryChunksToRuntime(appliedStore, [
      {
        key: 'p1',
        name: 'product',
        value: { stock: 4 },
      },
    ]);

    // SPEC.md §9.4: hydrated scripts and later mutation/deferred query chunks
    // must write the same keyed store slot and publish the same typed-read key.
    expect(hydrated).toEqual(['product:p1']);
    expect(applied).toEqual(['product:p1']);
    expect(hydratedStore.get('product', 'p1')).toEqual(appliedStore.get('product', 'p1'));
    expect(hydratedStore.get('product')).toBeUndefined();
    expect(appliedStore.get('product')).toBeUndefined();
    expect(hydratedPlan).toHaveBeenCalledWith({ stock: 4 });
    expect(appliedPlan).toHaveBeenCalledWith({ stock: 4 });
  });

  it('hydrates each server query script once while accepting later script nodes', () => {
    const store = createQueryStore();
    const ledger = createQueryScriptHydrationLedger(store);
    const cartPlan = vi.fn();
    const originalScript = {
      getAttribute: (name: string) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{"count":1}',
    };
    const laterScript = {
      getAttribute: (name: string) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{"count":2}',
    };

    store.subscribe('cart', cartPlan);

    expect(ledger.hydrate([originalScript])).toEqual(['cart']);
    originalScript.textContent = '{"count":99}';
    expect(ledger.hydrate([originalScript])).toEqual([]);
    expect(ledger.hydrate([laterScript])).toEqual(['cart']);

    // SPEC.md §9.1/§9.4: later browser hydration discoveries share the query
    // apply path, but already observed server script nodes are not replayed.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(cartPlan).toHaveBeenNthCalledWith(1, { count: 1 });
    expect(cartPlan).toHaveBeenNthCalledWith(2, { count: 2 });
    expect(cartPlan).toHaveBeenCalledTimes(2);
  });

  it('retries malformed query scripts until a hydration pass successfully applies them', () => {
    const store = createQueryStore();
    const ledger = createQueryScriptHydrationLedger(store);
    const onError = vi.fn();
    const cartPlan = vi.fn();
    const script = {
      getAttribute: (name: string) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{',
    };

    store.subscribe('cart', cartPlan);

    expect(ledger.hydrate([script], { onError })).toEqual([]);
    expect(store.get('cart')).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);

    script.textContent = '{"count":2}';
    expect(ledger.hydrate([script], { onError })).toEqual(['cart']);
    script.textContent = '{"count":99}';
    expect(ledger.hydrate([script], { onError })).toEqual([]);

    // SPEC.md §9.4: hydrated script data shares the same runtime query apply
    // path; failed transient JSON must not permanently remove a query from
    // later visible-return hydration.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(cartPlan).toHaveBeenCalledTimes(1);
    expect(cartPlan).toHaveBeenCalledWith({ count: 2 });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('discovers hydrated query scripts through the shared root selector helper', () => {
    const root = new FakeRoot();
    const script = {
      getAttribute: (name: string) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{"count":1}',
    };

    root.scripts = [script];

    // SPEC.md §9.4: loader hydration and later visible-return scans must use
    // the same fw-query script discovery contract.
    expect([...queryScriptsFromRoot(root)]).toEqual([script]);
    expect([...queryScriptsFromRoot({})]).toEqual([]);
  });

  it('applies query chunks through one canonical runtime batch with interposed values', () => {
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const productPlan = vi.fn();
    const afterApplyQuery = vi.fn();

    store.subscribe('cart', cartPlan);
    store.subscribe('product', productPlan, 'p1');

    const applied = applyQueryChunksToRuntime(
      store,
      [
        { name: 'cart', value: { count: 1 } },
        { key: 'p1', name: 'product', value: { stock: 4 } },
      ],
      {
        afterApplyQuery,
        applyQuery(query) {
          if (query.name !== 'cart') return;

          store.set(query.name, { count: 2 }, query.key);
          return { value: store.get(query.name, query.key) };
        },
      },
    );

    // SPEC.md §9.1/§9.4: mutation, deferred, hydration, and typed-read paths
    // share canonical query instance keys while allowing runtime apply hooks.
    expect(applied).toEqual(['cart', 'product:p1']);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('product', 'p1')).toEqual({ stock: 4 });
    expect(cartPlan).toHaveBeenCalledWith({ count: 2 });
    expect(productPlan).toHaveBeenCalledWith({ stock: 4 });
    expect(afterApplyQuery).toHaveBeenCalledWith(
      { name: 'cart', value: { count: 1 } },
      {
        count: 2,
      },
    );
    expect(afterApplyQuery).toHaveBeenCalledWith(
      { key: 'p1', name: 'product', value: { stock: 4 } },
      { stock: 4 },
    );
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
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in fw-query inventory',
    );
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

  it('makes queries introduced by enhanced mutations eligible for visible-return refetch', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const formData = new FormData();
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
    loaderRoot.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];
    const mutationFetch = vi.fn(async () => ({
      headers: {
        get() {
          return null;
        },
      },
      async text() {
        return '<fw-query name="recommendations">{"items":["p1"]}</fw-query>';
      },
    }));
    const refetchFetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () =>
        url === '/_q/cart'
          ? '<fw-query name="cart">{"count":2}</fw-query>'
          : '<fw-query name="recommendations">{"items":["p2"]}</fw-query>',
    }));

    installJisoLoader({
      enhancedMutations: {
        fetch: mutationFetch,
        formData: () => formData,
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      queryRefetch: { fetch: refetchFetch },
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
    expect(refetchOnFocus).toHaveBeenCalledWith(['cart', 'recommendations']);
    expect(refetchFetch).toHaveBeenNthCalledWith(1, '/_q/cart', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(refetchFetch).toHaveBeenNthCalledWith(2, '/_q/recommendations', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
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
      const fetch = vi.fn(async (url: string) => ({
        status: 200,
        text: async () =>
          url === '/_q/cart'
            ? '<fw-query name="cart">{"count":2}</fw-query>'
            : '<fw-query name="reviews">{"items":["r2"]}</fw-query>',
      }));
      loaderRoot.scripts = [
        {
          getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
          textContent: '{"count":1}',
        },
      ];

      installJisoLoader({
        enhancedMutations: {
          fetch: vi.fn(),
          root: mutationRoot,
          store,
        },
        importModule: vi.fn(),
        queryRefetch: { fetch },
        queryStore: store,
        refetchOnFocus,
        root: loaderRoot,
      });

      channels[0]?.onmessage?.({
        data: {
          body: '<fw-query name="reviews">{"items":["r1"]}</fw-query>',
          changes: [],
          type: 'jiso:mutation-response',
        },
      });
      loaderRoot.visibilityState = 'visible';
      await loaderRoot.listeners.get('visibilitychange')?.({
        target: null,
        type: 'visibilitychange',
      });

      // SPEC.md §9.2: same-user tab sync consumes mutation wire bodies through
      // the same query-store path as the submitting tab.
      expect(refetchOnFocus).toHaveBeenCalledWith(['cart', 'reviews']);
      expect(fetch).toHaveBeenNthCalledWith(1, '/_q/cart', {
        headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
        method: 'GET',
      });
      expect(fetch).toHaveBeenNthCalledWith(2, '/_q/reviews', {
        headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
        method: 'GET',
      });
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
    const fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () =>
        url === '/_q/product%3Ap1'
          ? '<fw-query name="product" key="p1">{"stock":5}</fw-query>'
          : '<fw-query name="product" key="p2">{"stock":10}</fw-query>',
    }));

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'product' : name === 'key' ? 'p1' : null),
        textContent: '{"stock":4}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'product' : name === 'key' ? 'p2' : null),
        textContent: '{"stock":9}',
      },
    ];
    store.subscribe('product', p1Plan, 'p1');
    store.subscribe('product', p2Plan, 'p2');

    installJisoLoader({
      importModule: vi.fn(),
      queryRefetch: { fetch },
      queryStore: store,
      refetchOnFocus,
      root,
    });

    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    // SPEC.md §9.4: refetch-on-focus talks to the typed-read endpoint with the
    // same query instance key that hydration and mutation chunks expose.
    expect(refetchOnFocus).toHaveBeenCalledWith(['product:p1', 'product:p2']);
    expect(fetch).toHaveBeenNthCalledWith(1, '/_q/product%3Ap1', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/_q/product%3Ap2', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(store.get('product', 'p1')).toEqual({ stock: 5 });
    expect(store.get('product', 'p2')).toEqual({ stock: 10 });
    expect(p1Plan).toHaveBeenLastCalledWith({ stock: 5 });
    expect(p2Plan).toHaveBeenLastCalledWith({ stock: 10 });
  });

  it('discovers fw-query scripts inserted after install before visible-return refetch', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const reviewsPlan = vi.fn();
    const refetchOnFocus = vi.fn();
    const cartBinding = {
      textContent: '',
      getAttribute: (name: string) => (name === 'data-bind' ? 'cart.count' : null),
    };
    const reviewsBinding = {
      textContent: '',
      getAttribute: (name: string) => (name === 'data-bind' ? 'reviews.total' : null),
    };
    const fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () =>
        url === '/_q/cart'
          ? '<fw-query name="cart">{"count":2}</fw-query>'
          : '<fw-query name="reviews">{"total":7}</fw-query>',
    }));

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];
    root.bindings = [cartBinding, reviewsBinding];
    store.subscribe('cart', cartPlan);
    store.subscribe('reviews', reviewsPlan);

    installJisoLoader({
      importModule: vi.fn(),
      queryPlans: { cart: { bindings: true }, reviews: { bindings: true } },
      queryRefetch: { fetch },
      queryStore: store,
      refetchOnFocus,
      root,
    });

    expect(store.get('cart')).toEqual({ count: 1 });
    expect(store.get('reviews')).toBeUndefined();
    expect(cartBinding.textContent).toBe('1');
    expect(reviewsBinding.textContent).toBe('');

    root.scripts.push({
      getAttribute: (name) => (name === 'fw-query' ? 'reviews' : null),
      textContent: '{"total":5}',
    });

    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    // SPEC.md §4.4: visible-return refetch tracks hydrated query data discovered after install.
    expect(refetchOnFocus).toHaveBeenCalledWith(['cart', 'reviews']);
    expect(fetch).toHaveBeenNthCalledWith(1, '/_q/cart', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/_q/reviews', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('reviews')).toEqual({ total: 7 });
    expect(cartBinding.textContent).toBe('2');
    expect(reviewsBinding.textContent).toBe('7');
    expect(cartPlan).toHaveBeenLastCalledWith({ count: 2 });
    expect(reviewsPlan).toHaveBeenNthCalledWith(1, { total: 5 });
    expect(reviewsPlan).toHaveBeenNthCalledWith(2, { total: 7 });
  });
});
