import { describe, expect, it, vi } from 'vitest';

import { createQueryStore, installJisoLoader } from './index.js';
import {
  FakeBroadcastChannel,
  FakeFormElement,
  FakeMorphRoot,
  FakeMorphTarget,
  FakeQueryBindingElement,
  FakeRoot,
} from './runtime-test-fakes.js';

describe('loader query apply interposition', () => {
  it('hydrates initial query scripts through the configured apply hook', () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const plan = vi.fn();
    const applyQuery = vi.fn((query) => ({
      value: { count: Number(query.value.count) + 1 },
    }));

    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":2}',
      },
    ];
    store.subscribe('cart', plan);

    installJisoLoader({ applyQuery, importModule: vi.fn(), queryStore: store, root });

    // SPEC.md §9.1/§9.4: loader script hydration must enter the same decoded
    // query apply path as mutation responses, typed reads, and inline events.
    expect(applyQuery).toHaveBeenCalledWith({ name: 'cart', value: { count: 2 } });
    expect(store.get('cart')).toBeUndefined();
    expect(plan).not.toHaveBeenCalled();
  });

  it('passes the loader apply hook to inline query events and typed-read visible returns', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const reviewsPlan = vi.fn();
    const applyQuery = vi.fn((query) => {
      store.set(query.name, { ...query.value, viaHook: true }, query.key);
      return { value: store.get(query.name, query.key) };
    });
    const fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<fw-query name="reviews">{"total":3}</fw-query>',
    }));

    store.subscribe('cart', cartPlan);
    store.subscribe('reviews', reviewsPlan);

    installJisoLoader({
      applyQuery,
      importModule: vi.fn(),
      queryRefetch: { fetch },
      queryStore: store,
      refetchOnFocus: vi.fn(),
      root,
    });

    const queryEventListener = root.listeners.get('jiso:query') as
      | ((event: { detail?: unknown }) => void)
      | undefined;
    queryEventListener?.({
      detail: {
        attrs: ' name="cart"',
        content: '{"count":2}',
      },
    });
    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({
      target: null,
      type: 'visibilitychange',
    });

    // SPEC.md §4.4/§9.4: visible-return typed reads and inline query events
    // must not drift from the loader's configured runtime query apply hook.
    expect(store.get('cart')).toEqual({ count: 2, viaHook: true });
    expect(store.get('reviews')).toEqual({ total: 3, viaHook: true });
    expect(cartPlan).toHaveBeenCalledWith({ count: 2, viaHook: true });
    expect(reviewsPlan).toHaveBeenCalledWith({ total: 3, viaHook: true });
    expect(applyQuery).toHaveBeenCalledWith({ name: 'cart', value: { count: 2 } });
    expect(applyQuery).toHaveBeenCalledWith({ name: 'reviews', value: { total: 3 } });
  });

  it('passes the loader apply hook to enhanced mutation submit responses', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const applyQuery = vi.fn((query) => {
      store.set(query.name, { count: Number(query.value.count) + 10 }, query.key);
      return { value: store.get(query.name, query.key) };
    });
    const form = new FakeFormElement({ enhance: '' }, { action: '/_m/cart/add', method: 'post' });
    const fetch = vi.fn(async () => ({
      headers: {
        get() {
          return null;
        },
      },
      text: async () =>
        [
          '<fw-query name="cart">{"count":2}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>server</cart-badge></fw-fragment>',
        ].join('\n'),
    }));
    const observedDuringMorph: string[] = [];
    mutationRoot.bindings.push(count);
    mutationRoot.targets.set('cart-badge', new FakeMorphTarget());

    installJisoLoader({
      applyQuery,
      enhancedMutations: {
        fetch,
        formData: () => new FormData(),
        morph(target, html) {
          observedDuringMorph.push(count.textContent ?? '');
          target.replaceWithHtml(html);
        },
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('submit')?.({
      preventDefault: vi.fn(),
      target: form,
      type: 'submit',
    });

    // SPEC.md §4.4/§9.1: loader-installed enhanced form submits must share the
    // same decoded query apply hook as hydration, inline query events, and typed reads.
    expect(applyQuery).toHaveBeenCalledWith({ name: 'cart', value: { count: 2 } });
    expect(store.get('cart')).toEqual({ count: 12 });
    expect(count.textContent).toBe('12');
    expect(observedDuringMorph).toEqual(['12']);
    expect(mutationRoot.targets.get('cart-badge')?.html).toBe('<cart-badge>server</cart-badge>');
  });

  it('passes the loader apply hook to default broadcast replay responses', () => {
    const originalBroadcastChannel = globalThis.BroadcastChannel;
    const channels: FakeBroadcastChannel[] = [];
    class TestBroadcastChannel extends FakeBroadcastChannel {
      constructor() {
        super();
        channels.push(this);
      }
    }
    globalThis.BroadcastChannel = TestBroadcastChannel as never;

    try {
      const loaderRoot = new FakeRoot();
      const mutationRoot = new FakeMorphRoot();
      const store = createQueryStore();
      const count = new FakeQueryBindingElement('reviews.total', { textContent: '0' });
      const applyQuery = vi.fn((query) => {
        store.set(query.name, { total: Number(query.value.total) + 10 }, query.key);
        return { value: store.get(query.name, query.key) };
      });
      mutationRoot.bindings.push(count);

      installJisoLoader({
        applyQuery,
        enhancedMutations: {
          fetch: vi.fn(),
          root: mutationRoot,
          store,
        },
        importModule: vi.fn(),
        root: loaderRoot,
      });

      channels[0]?.onmessage?.({
        data: {
          body: '<fw-query name="reviews">{"total":3}</fw-query>',
          changes: [],
          type: 'jiso:mutation-response',
        },
      });

      // SPEC.md §9.2: same-user tab replay is another mutation wire transport,
      // so loader-level query interposition must not stop at submit/refetch paths.
      expect(applyQuery).toHaveBeenCalledWith({ name: 'reviews', value: { total: 3 } });
      expect(store.get('reviews')).toEqual({ total: 13 });
      expect(count.textContent).toBe('13');
    } finally {
      globalThis.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('keeps enhanced mutation apply hooks ahead of the loader hook for default broadcast replay', () => {
    const originalBroadcastChannel = globalThis.BroadcastChannel;
    const channels: FakeBroadcastChannel[] = [];
    class TestBroadcastChannel extends FakeBroadcastChannel {
      constructor() {
        super();
        channels.push(this);
      }
    }
    globalThis.BroadcastChannel = TestBroadcastChannel as never;

    try {
      const loaderRoot = new FakeRoot();
      const mutationRoot = new FakeMorphRoot();
      const store = createQueryStore();
      const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
      const loaderApplyQuery = vi.fn((query) => {
        store.set(query.name, { count: -1 }, query.key);
        return { value: store.get(query.name, query.key) };
      });
      const enhancedApplyQuery = vi.fn((query) => {
        store.set(query.name, { count: Number(query.value.count) + 20 }, query.key);
        return { value: store.get(query.name, query.key) };
      });
      mutationRoot.bindings.push(count);

      installJisoLoader({
        applyQuery: loaderApplyQuery,
        enhancedMutations: {
          applyQuery: enhancedApplyQuery,
          fetch: vi.fn(),
          root: mutationRoot,
          store,
        },
        importModule: vi.fn(),
        root: loaderRoot,
      });

      channels[0]?.onmessage?.({
        data: {
          body: '<fw-query name="cart">{"count":4}</fw-query>',
          changes: [],
          type: 'jiso:mutation-response',
        },
      });

      // SPEC.md §9.2: broadcast replay is part of the enhanced mutation
      // transport, so an enhanced-mutation apply hook must override the broader
      // loader hook just like direct enhanced submits do.
      expect(enhancedApplyQuery).toHaveBeenCalledWith({ name: 'cart', value: { count: 4 } });
      expect(loaderApplyQuery).not.toHaveBeenCalled();
      expect(store.get('cart')).toEqual({ count: 24 });
      expect(count.textContent).toBe('24');
    } finally {
      globalThis.BroadcastChannel = originalBroadcastChannel;
    }
  });
});
