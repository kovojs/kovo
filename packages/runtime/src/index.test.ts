import { describe, expect, it, vi } from 'vitest';
import type { Route } from '@jiso/core';

import {
  createQueryStore,
  installJisoLoader,
  type EnhancedMutationFetchOptions,
  type MutationBroadcast,
} from './index.js';
import {
  FakeBroadcastChannel,
  FakeBroadcastHub,
  FakeElement,
  FakeFormElement,
  FakeMorphRoot,
  FakeMorphTarget,
  FakePendingElement,
  FakePendingRoot,
  FakeRoot,
} from './runtime-test-fakes.js';

declare module '@jiso/core' {
  interface RouteRegistry {
    '/cart': Route<'/cart'>;
    '/catalog': Route<'/catalog', {}, { max: number; sort: string }>;
    '/catalog/:id': Route<'/catalog/:id', { id: string }, { max: number; sort: string }>;
  }
}

describe('runtime loader', () => {
  it('registers delegated capture listeners without importing handler modules', () => {
    const root = new FakeRoot();
    const importModule = vi.fn();

    const loader = installJisoLoader({ importModule, root });

    expect(loader.events).toEqual(['click', 'submit', 'input', 'change']);
    expect([...root.listeners.keys()]).toEqual(['click', 'submit', 'input', 'change']);
    expect(importModule).not.toHaveBeenCalled();
  });

  it('hydrates initial fw-query scripts into the configured query store', () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const plan = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":2}',
      },
    ];
    store.subscribe('cart', plan);

    installJisoLoader({ importModule: vi.fn(), queryStore: store, root });

    expect(store.get('cart')).toEqual({ count: 2 });
    expect(plan).toHaveBeenCalledWith({ count: 2 });
  });

  it('ignores malformed initial fw-query scripts without aborting loader install', () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const importModule = vi.fn();
    const onError = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'inventory' : null),
        textContent: '{"available":true}',
      },
    ];

    installJisoLoader({ importModule, onError, queryStore: store, root });

    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect([...root.listeners.keys()]).toEqual([
      'click',
      'submit',
      'input',
      'change',
      'jiso:query',
    ]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: 'query-hydration' });
  });

  it('retries malformed initial fw-query scripts before visible-return refetch', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const onError = vi.fn();
    const refetchOnFocus = vi.fn();
    const cartPlan = vi.fn();
    const script = {
      getAttribute: (name: string) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{',
    };

    root.scripts = [script];
    store.subscribe('cart', cartPlan);

    installJisoLoader({
      importModule: vi.fn(),
      onError,
      queryStore: store,
      refetchOnFocus,
      root,
    });

    expect(store.get('cart')).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: 'query-hydration' });

    script.textContent = '{"count":2}';
    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({
      target: null,
      type: 'visibilitychange',
    });

    // SPEC.md §4.4/§9.4: visible-return hydration retries transiently
    // malformed server query data through the same query-store apply path.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(cartPlan).toHaveBeenCalledWith({ count: 2 });
    expect(refetchOnFocus).toHaveBeenCalledWith(['cart']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('intercepts enhanced form submits through the loader bridge', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const pendingForm = new FakePendingElement({ 'fw-deps': 'order' });
    const pendingRoot = new FakePendingRoot([pendingForm]);
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const importModule = vi.fn();
    const uploadProgress = vi.fn();
    const formData = new FormData();
    const form = new FakeFormElement(
      {
        enhance: '',
        'data-mutation': 'cart/add',
        'fw-deps': 'order',
      },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );
    const progressElement = new FakeElement({ 'fw-upload-progress': '', max: '100', value: '0' });
    form.progressElements = [progressElement];
    mutationRoot.deps = [{ deps: 'cart', id: 'cart-badge' }];
    mutationRoot.targets.set('cart-badge', new FakeMorphTarget());
    formData.set('productId', 'p1');
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes' ? '[{"domain":"cart","input":{"productId":"p1"}}]' : null;
        },
      },
      async text() {
        options.onUploadProgress?.({ loaded: 512, total: 1024 });
        expect(pendingForm.attributes).toMatchObject({
          'aria-busy': 'true',
          'fw-pending': '',
        });
        return [
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
        ].join('\n');
      },
    }));

    installJisoLoader({
      enhancedMutations: {
        fetch,
        formData: () => formData,
        idem: () => 'idem_loader',
        onUploadProgress: uploadProgress,
        pendingRoot,
        root: mutationRoot,
        store,
      },
      importModule,
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('submit')?.({
      preventDefault,
      target: form,
      type: 'submit',
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(importModule).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_loader',
        'FW-Targets': 'cart-badge=cart',
      },
      keepalive: true,
      method: 'POST',
      onUploadProgress: expect.any(Function),
    });
    expect(uploadProgress).toHaveBeenCalledWith({ loaded: 512, total: 1024 }, form);
    expect(progressElement.getAttribute('value')).toBe('50');
    expect(progressElement.getAttribute('max')).toBe('100');
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(mutationRoot.targets.get('cart-badge')?.html).toBe('<cart-badge>1</cart-badge>');
    expect(pendingForm.attributes).not.toHaveProperty('fw-pending');
    expect(pendingForm.attributes).not.toHaveProperty('aria-busy');
  });

  it('renders upload progress as indeterminate when total bytes are unknown', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const importModule = vi.fn();
    const formData = new FormData();
    const form = new FakeFormElement(
      {
        enhance: '',
        'data-mutation': 'cart/add',
      },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );
    const progressElement = new FakeElement({ 'fw-upload-progress': '', max: '100', value: '0' });
    form.progressElements = [progressElement];
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => ({
      headers: {
        get() {
          return null;
        },
      },
      async text() {
        options.onUploadProgress?.({ loaded: 512 });
        return '<fw-query name="cart">{"count":1}</fw-query>';
      },
    }));

    installJisoLoader({
      enhancedMutations: {
        fetch,
        formData: () => formData,
        root: mutationRoot,
        store,
      },
      importModule,
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('submit')?.({
      preventDefault,
      target: form,
      type: 'submit',
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(progressElement.getAttribute('value')).toBeNull();
    expect(progressElement.getAttribute('max')).toBe('100');
    expect(store.get('cart')).toEqual({ count: 1 });
  });

  it('reports enhanced loader submit failures after preventing native submit', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const pendingForm = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([pendingForm]);
    const store = createQueryStore();
    const loaderOnError = vi.fn();
    const preventDefault = vi.fn();
    const importModule = vi.fn();
    const onError = vi.fn();
    const submit = vi.fn();
    const error = new Error('network down');
    const formData = new FormData();
    const form = Object.assign(
      new FakeFormElement(
        {
          enhance: '',
          'fw-deps': 'cart',
        },
        {
          action: '/_m/cart/add',
          method: 'post',
        },
      ),
      { submit },
    );
    mutationRoot.deps = [{ deps: 'cart', id: 'cart-badge' }];
    const fetch = vi.fn(async () => {
      expect(pendingForm.attributes).toMatchObject({
        'aria-busy': 'true',
        'fw-pending': '',
      });
      throw error;
    });

    installJisoLoader({
      enhancedMutations: {
        fetch,
        formData: () => formData,
        onError,
        pendingRoot,
        root: mutationRoot,
        store,
      },
      importModule,
      onError: loaderOnError,
      root: loaderRoot,
    });

    await expect(
      loaderRoot.listeners.get('submit')?.({
        preventDefault,
        target: form,
        type: 'submit',
      }),
    ).resolves.toBeUndefined();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, form);
    expect(loaderOnError).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(importModule).not.toHaveBeenCalled();
    expect(pendingForm.attributes).not.toHaveProperty('fw-pending');
    expect(pendingForm.attributes).not.toHaveProperty('aria-busy');
  });

  it('reports enhanced loader submit failures through the loader error hook', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const onError = vi.fn();
    const error = new Error('network down');
    const form = new FakeFormElement(
      { enhance: '' },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );

    installJisoLoader({
      enhancedMutations: {
        fetch: vi.fn(async () => {
          throw error;
        }),
        formData: () => new FormData(),
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      onError,
      root: loaderRoot,
    });

    await expect(
      loaderRoot.listeners.get('submit')?.({
        preventDefault,
        target: form,
        type: 'submit',
      }),
    ).resolves.toBeUndefined();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, {
      event: { preventDefault, target: form, type: 'submit' },
      phase: 'enhanced-mutation',
    });
  });

  it('falls back to native submit when unhandled enhanced submits fail', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const onError = vi.fn();
    const submit = vi.fn();
    const error = new Error('network down');
    const form = Object.assign(
      new FakeFormElement(
        { enhance: '' },
        {
          action: '/_m/cart/add',
          method: 'post',
        },
      ),
      { submit },
    );

    installJisoLoader({
      enhancedMutations: {
        fetch: vi.fn(async () => {
          throw error;
        }),
        formData: () => new FormData(),
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      onError,
      root: loaderRoot,
    });

    await expect(
      loaderRoot.listeners.get('submit')?.({
        preventDefault,
        target: form,
        type: 'submit',
      }),
    ).resolves.toBeUndefined();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, {
      event: { preventDefault, target: form, type: 'submit' },
      phase: 'enhanced-mutation',
    });
  });

  it('auto-wires enhanced mutation broadcasts through the loader bridge', async () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originalBroadcastChannel = globalRecord.BroadcastChannel;
    const hub = new FakeBroadcastHub();
    const channelNames: string[] = [];
    class TestBroadcastChannel extends FakeBroadcastChannel {
      constructor(name: string) {
        channelNames.push(name);
        super(hub);
      }
    }
    globalRecord.BroadcastChannel = TestBroadcastChannel;

    try {
      const loaderRootA = new FakeRoot();
      const loaderRootB = new FakeRoot();
      const mutationRootA = new FakeMorphRoot();
      const mutationRootB = new FakeMorphRoot();
      const storeA = createQueryStore();
      const storeB = createQueryStore();
      const formData = new FormData();
      const form = new FakeFormElement(
        {
          enhance: '',
          'data-mutation': 'cart/add',
        },
        {
          action: '/_m/cart/add',
          method: 'post',
        },
      );
      const fetch = vi.fn(async () => ({
        headers: { get: () => null },
        async text() {
          return [
            '<fw-query name="cart">{"count":4}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>4</cart-badge></fw-fragment>',
          ].join('\n');
        },
      }));

      mutationRootA.deps = [{ deps: 'cart', id: 'cart-badge' }];
      mutationRootB.deps = [{ deps: 'cart', id: 'cart-badge' }];
      mutationRootA.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>0</cart-badge>'));
      mutationRootB.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>0</cart-badge>'));

      installJisoLoader({
        enhancedMutations: {
          fetch,
          formData: () => formData,
          idem: () => 'idem_auto_broadcast',
          root: mutationRootB,
          store: storeB,
        },
        importModule: vi.fn(),
        root: loaderRootB,
      });
      installJisoLoader({
        enhancedMutations: {
          fetch,
          formData: () => formData,
          idem: () => 'idem_auto_broadcast',
          root: mutationRootA,
          store: storeA,
        },
        importModule: vi.fn(),
        root: loaderRootA,
      });

      await loaderRootA.listeners.get('submit')?.({
        preventDefault: vi.fn(),
        target: form,
        type: 'submit',
      });

      expect(channelNames).toEqual(['jiso:mutation-response', 'jiso:mutation-response']);
      expect(storeA.get('cart')).toEqual({ count: 4 });
      expect(storeB.get('cart')).toEqual({ count: 4 });
      expect(mutationRootA.targets.get('cart-badge')?.html).toBe('<cart-badge>4</cart-badge>');
      expect(mutationRootB.targets.get('cart-badge')?.html).toBe('<cart-badge>4</cart-badge>');
    } finally {
      globalRecord.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('disposes loader listeners, visible observers, and auto-created broadcasts', () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originalBroadcastChannel = globalRecord.BroadcastChannel;
    const root = new FakeRoot();
    const focusTarget = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const visibleElement = new FakeElement({ 'on:visible': '/c/chart.js#mount' });
    const discardPendingOptimism = vi.fn();
    const observer = {
      observe: vi.fn(),
      unobserve: vi.fn(),
    };
    const channels: FakeBroadcastChannel[] = [];
    class TestBroadcastChannel extends FakeBroadcastChannel {
      constructor() {
        super();
        channels.push(this);
      }
    }
    globalRecord.BroadcastChannel = TestBroadcastChannel;
    root.elements.set('[on\\:visible]', [visibleElement]);

    try {
      const loader = installJisoLoader({
        discardPendingOptimism,
        enhancedMutations: {
          fetch: vi.fn(),
          root: mutationRoot,
          store,
        },
        focusTarget,
        importModule: vi.fn(),
        queryRefetch: { fetch: vi.fn() },
        queryStore: store,
        root,
        visibleObserver: () => observer,
      });

      expect(root.listeners.has('click')).toBe(true);
      expect(root.listeners.has('visibilitychange')).toBe(true);
      expect(root.listeners.has('pagehide')).toBe(true);
      expect(focusTarget.listeners.has('focus')).toBe(false);
      expect(observer.observe).toHaveBeenCalledWith(visibleElement);
      expect(channels[0]?.closed).toBe(false);

      loader.dispose();

      expect(root.listeners.size).toBe(0);
      expect(focusTarget.listeners.size).toBe(0);
      expect(observer.unobserve).toHaveBeenCalledWith(visibleElement);
      expect(channels[0]?.closed).toBe(true);
    } finally {
      globalRecord.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('does not close caller-owned mutation broadcasts on dispose', () => {
    const root = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const close = vi.fn();
    const broadcast: MutationBroadcast = {
      close,
      publish: vi.fn(),
    };

    const loader = installJisoLoader({
      enhancedMutations: {
        broadcast,
        fetch: vi.fn(),
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      root,
    });

    loader.dispose();

    expect(close).not.toHaveBeenCalled();
  });
});
