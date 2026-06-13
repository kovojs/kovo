import { describe, expect, it, vi } from 'vitest';

import { installMutationBroadcast } from './broadcast.js';
import { submitOptimisticEnhancedMutation } from './mutation-optimistic.js';
import { OptimisticRebaser } from './optimism.js';
import { createQueryStore } from './query-store.js';
import {
  FakeBroadcastChannel,
  FakeMorphRoot,
  FakeMorphTarget,
  FakePendingElement,
  FakePendingRoot,
} from './runtime-test-fakes.js';

describe('optimistic enhanced mutation failure handling', () => {
  it('reports fetch failures, discards predictions, and clears pending state', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const pendingRoot = new FakePendingRoot([new FakePendingElement({ 'fw-deps': 'cart' })]);
    const onError = vi.fn();
    const error = new Error('network down');
    store.set('cart', { count: 1 });
    const fetch = vi.fn(async () => {
      const pending = [...pendingRoot.querySelectorAll('[fw-deps]')][0];
      expect(store.get('cart')).toEqual({ count: 3 });
      expect(pending?.attributes).toMatchObject({
        'aria-busy': 'true',
        'fw-pending': '',
      });
      throw error;
    });

    await expect(
      submitOptimisticEnhancedMutation({
        fetch,
        form: { action: '/_m/cart/add', method: 'post' },
        formData: new FormData(),
        idem: 'idem_failed_optimistic',
        input: { quantity: 2 },
        onError,
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
      }),
    ).rejects.toBe(error);

    const pending = [...pendingRoot.querySelectorAll('[fw-deps]')][0];
    // SPEC.md §10.4: optimistic mutations must discard failed predictions and
    // report direct-submit failures through the mutation-layer error seam.
    expect(onError).toHaveBeenCalledWith(error);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(pending?.attributes).not.toHaveProperty('fw-pending');
    expect(pending?.attributes).not.toHaveProperty('aria-busy');
  });

  it('reports omitted optimistic server truth and preserves other pending transforms', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    const onError = vi.fn();
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 0 });
    const optimistic = {
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          const cart = current as { count: number };
          return { count: cart.count + input.quantity };
        },
      },
    };
    const fetch = vi.fn(async () => {
      rebaser.add('idem_second', { quantity: 5 }, optimistic);
      expect(store.get('cart')).toEqual({ count: 7 });

      return {
        async text() {
          return '<fw-fragment target="cart-badge"><cart-badge>stale</cart-badge></fw-fragment>';
        },
      };
    });

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_first',
      input: { quantity: 2 },
      onError,
      optimistic,
      pendingRoot,
      rebaser,
      root,
      store,
    });

    expect(result.queries).toEqual([]);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Optimistic transform for cart was not covered by server query truth.',
      }),
    );
    expect(store.get('cart')).toEqual({ count: 5 });
    expect(rebaser.pendingCount('cart')).toBe(1);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
  });

  it('reports malformed optimistic server query chunks while applying unrelated fragments', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    const onError = vi.fn();
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 0 });

    const result = await submitOptimisticEnhancedMutation({
      fetch: vi.fn(async () => ({
        async text() {
          return [
            '<fw-query name="cart">{</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>stale</cart-badge></fw-fragment>',
          ].join('\n');
        },
      })),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_malformed_optimistic',
      input: { quantity: 2 },
      onError,
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

    expect(result.queries).toEqual([]);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>stale</cart-badge>');
    expect(store.get('cart')).toEqual({ count: 0 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(onError).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: expect.stringContaining('Malformed JSON in fw-query cart'),
      }),
    );
    expect(onError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'Optimistic transform for cart was not covered by server query truth.',
      }),
    );
  });

  it('discards optimistic state on enhanced mutation errors and applies the error fragment', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    const cartForm = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartForm]);
    root.deps = [{ id: 'cart-form' }];
    root.targets.set('cart-form', new FakeMorphTarget());
    store.set('cart', { count: 1 });
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 422,
      async text() {
        return '<fw-fragment target="cart-form"><form>Out of stock</form></fw-fragment>';
      },
    }));

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      broadcast,
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

    expect(result.appliedFragments).toEqual(['cart-form']);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(channel.messages).toEqual([]);
    expect(cartForm.attributes).not.toHaveProperty('fw-pending');
    expect(cartForm.attributes).not.toHaveProperty('aria-busy');
    expect(root.targets.get('cart-form')?.html).toBe('<form>Out of stock</form>');
  });
});
