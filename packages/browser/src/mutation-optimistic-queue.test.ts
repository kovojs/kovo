import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  EnhancedMutationFetch,
  EnhancedMutationFetchOptions,
  EnhancedMutationResponseLike,
} from './mutation-fetch.js';
import { submitOptimisticEnhancedMutation } from './mutation-optimistic.js';
import { MutationQueue } from './mutation-queue.js';
import { OptimisticRebaser } from './optimism.js';
import { createQueryStore } from './query-store.js';
import { FakeMorphRoot } from './runtime-test-fakes.js';

describe('optimistic enhanced mutation queueing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
    const fetch = vi.fn<EnhancedMutationFetch>(async (_url, options) => {
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

  it('times out a hung head, revalidates the optimistic tail, and keeps draining', async () => {
    vi.useFakeTimers();
    const store = createQueryStore();
    const onError = vi.fn();
    const rebaser = new OptimisticRebaser(store, { onError });
    const queue = new MutationQueue({ timeoutMs: 10 });
    const root = new FakeMorphRoot();
    const order: string[] = [];
    let firstSignal: AbortSignal | undefined;
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
        firstSignal = options.signal;
        return new Promise<EnhancedMutationResponseLike>(() => {});
      }

      return {
        async text() {
          return '<kovo-query name="cart">{"count":2}</kovo-query>';
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
      onError,
      optimistic,
      queue,
      rebaser,
      root,
      store,
    });
    const firstSettled = first.catch((error: unknown) => error);
    const second = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: secondFormData,
      idem: 'idem_second',
      input: { quantity: 2 },
      onError,
      optimistic,
      queue,
      rebaser,
      root,
      store,
    });

    await Promise.resolve();
    expect(order).toEqual(['1:optimistic', '2:optimistic', '1:fetch']);
    expect(store.get('cart')).toEqual({ count: 3 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(firstSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(10);

    await expect(firstSettled).resolves.toMatchObject({
      message: 'Mutation queue "cart" head timed out after 10ms.',
      name: 'AbortError',
    });
    expect(firstSignal?.aborted).toBe(true);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Mutation queue "cart" head timed out after 10ms.',
      }),
    );

    await expect(second).resolves.toMatchObject({ idem: 'idem_second', queries: ['cart'] });
    expect(order).toEqual(['1:optimistic', '2:optimistic', '1:fetch', '2:optimistic', '2:fetch']);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(queue.pending('cart')).toBe(false);
  });

  it('refuses queue overflow before applying an optimistic prediction', async () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const rebaser = new OptimisticRebaser(store);
    const queue = new MutationQueue({ maxDepth: 1, timeoutMs: 0 });
    const root = new FakeMorphRoot();
    store.set('cart', { count: 0 });
    const optimistic = {
      queue: 'cart',
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          const cart = current as { count: number };
          return { count: cart.count + input.quantity };
        },
      },
    };

    const first = submitOptimisticEnhancedMutation({
      fetch: vi.fn<EnhancedMutationFetch>(
        async () => new Promise<EnhancedMutationResponseLike>(() => {}),
      ),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_first',
      input: { quantity: 1 },
      optimistic,
      queue,
      rebaser,
      root,
      store,
    });
    first.catch(() => undefined);

    await Promise.resolve();
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(queue.depth('cart')).toBe(1);

    await expect(
      submitOptimisticEnhancedMutation({
        fetch: vi.fn(async () => ({
          async text() {
            return '';
          },
        })),
        form: { action: '/_m/cart/add', method: 'post' },
        formData: new FormData(),
        idem: 'idem_second',
        input: { quantity: 2 },
        onError,
        optimistic,
        queue,
        rebaser,
        root,
        store,
      }),
    ).rejects.toThrow('Mutation queue "cart" exceeded its maximum depth of 1.');

    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Mutation queue "cart" exceeded its maximum depth of 1.',
      }),
    );
  });
});
