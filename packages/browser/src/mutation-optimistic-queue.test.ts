import { describe, expect, it, vi } from 'vitest';

import type { EnhancedMutationFetchOptions } from './mutation-fetch.js';
import { submitOptimisticEnhancedMutation } from './mutation-optimistic.js';
import { MutationQueue } from './mutation-queue.js';
import { OptimisticRebaser } from './optimism.js';
import { createQueryStore } from './query-store.js';
import { FakeMorphRoot } from './runtime-test-fakes.js';

describe('optimistic enhanced mutation queueing', () => {
  it('runs optimistic enhanced submits with the same named queue sequentially', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const queue = new MutationQueue();
    const root = new FakeMorphRoot();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    store.set('cart', { count: 0 });

    const optimistic = {
      queue: 'cart',
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          order.push(`${input.quantity}:optimistic`);
          const cart = current as { count: number };
          return { count: cart.count + input.quantity };
        },
      },
    };
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => {
      const quantityEntry = (options.body as FormData).get('quantity');
      const quantity = typeof quantityEntry === 'string' ? quantityEntry : '';
      order.push(`${quantity}:fetch`);

      if (quantity === '1') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push('1:released');
      }

      return {
        async text() {
          return `<kovo-query name="cart">{"count":${quantity === '1' ? 1 : 3}}</kovo-query>`;
        },
      };
    });

    const firstFormData = new FormData();
    firstFormData.set('quantity', '1');
    const secondFormData = new FormData();
    secondFormData.set('quantity', '2');

    const first = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: firstFormData,
      idem: 'idem_first',
      input: { quantity: 1 },
      optimistic,
      queue,
      rebaser,
      root,
      store,
    });
    const second = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: secondFormData,
      idem: 'idem_second',
      input: { quantity: 2 },
      optimistic,
      queue,
      rebaser,
      root,
      store,
    });

    await Promise.resolve();

    // SPEC.md §10.4 line 1121 (normative): a queued mutation applies its optimistic transform on
    // ENQUEUE — immediately, against the current optimistic value including earlier queued-but-unsent
    // transforms — NOT on dequeue. So BOTH predictions ('1:optimistic' then '2:optimistic') land
    // before the blocked head's fetch resolves, and the cart badge reflects the full queued intent
    // (count 3 = 0 + 1 + 2) while only the head is in flight. The SEND stays a serial FIFO (one fetch).
    expect(order).toEqual(['1:optimistic', '2:optimistic', '1:fetch']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toEqual({ count: 3 });
    expect(queue.pending('cart')).toBe(true);

    releaseFirst?.();

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { idem: 'idem_first', queries: ['cart'] },
      { idem: 'idem_second', queries: ['cart'] },
    ]);
    // Predictions applied on enqueue; the head drains and reconciles (re-applying the still-pending
    // tail transform over the head's truth — the extra '2:optimistic'), then the tail's fetch sends.
    expect(order).toEqual([
      '1:optimistic',
      '2:optimistic',
      '1:fetch',
      '1:released',
      '2:optimistic',
      '2:fetch',
    ]);
    expect(store.get('cart')).toEqual({ count: 3 });
    expect(queue.pending('cart')).toBe(false);
  });

  it('starts unqueued optimistic enhanced submits directly', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    store.set('cart', { count: 0 });
    const fetch = vi.fn(async () => ({
      async text() {
        return '<kovo-query name="cart">{"count":2}</kovo-query>';
      },
    }));

    const result = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_direct',
      input: { quantity: 1 },
      optimistic: {
        queue: 'cart',
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
      rebaser,
      root,
      store,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toEqual({ count: 1 });

    await expect(result).resolves.toMatchObject({ idem: 'idem_direct', queries: ['cart'] });
    expect(store.get('cart')).toEqual({ count: 2 });
  });
});
