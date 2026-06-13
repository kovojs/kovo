import { describe, expect, it, vi } from 'vitest';

import { createQueryStore, installJisoLoader } from './index.js';
import {
  FakeBroadcastChannel,
  FakeBroadcastHub,
  FakeFormElement,
  FakeMorphRoot,
  FakeMorphTarget,
  FakeRoot,
} from './runtime-test-fakes.js';

// SPEC.md §9.2: loader-installed BroadcastChannel replay shares the enhanced
// mutation apply path and loader error seam; split from the submit and failure
// seams in the sibling loader-enhanced-mutation-*.test.ts files.
describe('loader enhanced mutation broadcasts', () => {
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

  it('reports default broadcast replay apply failures through the loader error hook', () => {
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
      const onError = vi.fn();
      const applyError = new Error('default broadcast apply failed');

      installJisoLoader({
        enhancedMutations: {
          applyQuery(query) {
            if (query.name === 'cart') throw applyError;
          },
          fetch: vi.fn(),
          root: mutationRoot,
          store,
        },
        importModule: vi.fn(),
        onError,
        root: loaderRoot,
      });

      channels[0]?.onmessage?.({
        data: {
          body: [
            '<fw-query name="cart">{"count":2}</fw-query>',
            '<fw-query name="product:p1">{"stock":8}</fw-query>',
          ].join('\n'),
          changes: [],
          type: 'jiso:mutation-response',
        },
      });

      // SPEC.md §9.2: loader-installed BroadcastChannel replay uses the same
      // mutation apply path and loader error seam as enhanced submit failures.
      expect(store.get('cart')).toBeUndefined();
      expect(store.get('product', 'p1')).toEqual({ stock: 8 });
      expect(onError).toHaveBeenCalledWith(applyError, { phase: 'mutation-broadcast' });
    } finally {
      globalRecord.BroadcastChannel = originalBroadcastChannel;
    }
  });
});
