import { describe, expect, it, vi } from 'vitest';

import type { EnhancedMutationFetchOptions } from './mutation-fetch.js';
import { submitOptimisticEnhancedMutation } from './mutation-optimistic.js';
import { installPagehideOptimismCleanup, OptimisticRebaser } from './optimism.js';
import { stampPendingQueries } from './pending.js';
import { createQueryStore } from './query-store.js';
import {
  FakeMorphRoot,
  FakePendingElement,
  FakePendingRoot,
  FakeRoot,
} from './runtime-test-fakes.js';

describe('optimistic enhanced mutation pagehide cleanup', () => {
  it('cleans up mid-flight optimistic navigation while the keepalive mutation continues', async () => {
    const lifecycleRoot = new FakeRoot();
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    let releaseFetch: (() => void) | undefined;
    store.set('cart', { count: 1 });

    installPagehideOptimismCleanup({
      discardPendingOptimism() {
        const discarded = rebaser.discardPendingOptimism();
        stampPendingQueries(pendingRoot, discarded, false);
        return discarded;
      },
      root: lifecycleRoot,
    });

    const fetch = vi.fn(
      async (_url: string, options: EnhancedMutationFetchOptions) =>
        new Promise<{
          text(): Promise<string>;
        }>((resolve) => {
          expect(options.keepalive).toBe(true);
          releaseFetch = () => {
            resolve({
              async text() {
                return '<fw-query name="cart">{"count":2}</fw-query>';
              },
            });
          };
        }),
    );

    const formData = new FormData();
    formData.set('quantity', '2');
    const submit = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData,
      idem: 'idem_bfcache',
      input: { quantity: 2 },
      optimistic: {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
      pendingRoot,
      rebaser,
      root,
      store,
    });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(store.get('cart')).toEqual({ count: 3 });
    expect(rebaser.pendingCount('cart')).toBe(1);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });

    // SPEC.md §8/§10.4: pagehide is the bfcache-safe teardown point; the
    // optimistic log dies with the document while the POST continues keepalive.
    void lifecycleRoot.listeners.get('pagehide')?.({ target: null, type: 'pagehide' });

    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_bfcache',
        'FW-Targets': '',
      },
      keepalive: true,
      method: 'POST',
    });

    releaseFetch?.();

    await expect(submit).resolves.toMatchObject({
      idem: 'idem_bfcache',
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
  });
});
