import { afterEach, describe, expect, it, vi } from 'vitest';

import { MutationQueue, type MutationQueueRunOptions } from './mutation-queue.js';

describe('mutation queue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes named mutation queues without blocking unrelated queues', async () => {
    const queue = new MutationQueue();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = queue.run('cart', async () => {
      order.push('cart:first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('cart:first:end');
      return 'first';
    });
    const second = queue.run('cart', () => {
      order.push('cart:second');
      return 'second';
    });
    const inventory = queue.run('inventory', () => {
      order.push('inventory');
      return 'inventory';
    });

    await Promise.resolve();

    expect(order).toEqual(['cart:first:start', 'inventory']);
    expect(queue.pending('cart')).toBe(true);
    await expect(inventory).resolves.toBe('inventory');
    expect(queue.pending('inventory')).toBe(false);

    releaseFirst?.();

    await expect(Promise.all([first, second, inventory])).resolves.toEqual([
      'first',
      'second',
      'inventory',
    ]);
    expect(order).toEqual(['cart:first:start', 'inventory', 'cart:first:end', 'cart:second']);
    expect(queue.pending('cart')).toBe(false);
  });

  it('continues a named mutation queue after a failed task', async () => {
    const queue = new MutationQueue();
    const order: string[] = [];

    const failed = queue.run('cart', async () => {
      order.push('failed');
      throw new Error('nope');
    });
    const next = queue.run('cart', () => {
      order.push('next');
      return 'next';
    });

    await expect(failed).rejects.toThrow('nope');
    await expect(next).resolves.toBe('next');
    expect(order).toEqual(['failed', 'next']);
    expect(queue.pending('cart')).toBe(false);
  });

  it('aborts a timed-out head and advances the surviving tail', async () => {
    vi.useFakeTimers();
    const queue = new MutationQueue({ timeoutMs: 10 });
    const order: string[] = [];
    let firstSignal: AbortSignal | undefined;

    const first = queue.run('cart', (signal) => {
      firstSignal = signal;
      order.push('first:start');
      return new Promise<string>(() => {});
    });
    const firstSettled = first.catch((error: unknown) => error);
    const second = queue.run('cart', () => {
      order.push('second');
      return 'second';
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    expect(firstSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(10);

    await expect(firstSettled).resolves.toMatchObject({
      message: 'Mutation queue "cart" head timed out after 10ms.',
      name: 'AbortError',
    });
    expect(firstSignal?.aborted).toBe(true);
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first:start', 'second']);
    expect(queue.pending('cart')).toBe(false);
  });

  it('refuses enqueue past the configured queue depth', () => {
    const queue = new MutationQueue({ maxDepth: 1, timeoutMs: 0 });

    void queue.run('cart', () => new Promise<string>(() => {}));

    expect(() => queue.run('cart', () => 'overflow')).toThrow(
      'Mutation queue "cart" exceeded its maximum depth of 1.',
    );
    expect(queue.depth('cart')).toBe(1);
  });

  it('retains queue continuation order after late Promise method replacement', async () => {
    const queue = new MutationQueue({ timeoutMs: 0 });
    const order: string[] = [];
    const resolve = Object.getOwnPropertyDescriptor(Promise, 'resolve');
    const then = Object.getOwnPropertyDescriptor(Promise.prototype, 'then');
    if (!resolve || !then) throw new Error('Missing Promise security descriptors');
    Object.defineProperty(Promise, 'resolve', { ...resolve, value: () => ({ then() {} }) });
    Object.defineProperty(Promise.prototype, 'then', {
      ...then,
      value: () => new Promise(() => {}),
    });
    let first: Promise<string> | undefined;
    let second: Promise<string> | undefined;
    try {
      first = queue.run('cart', () => {
        order[order.length] = 'first';
        return 'first';
      });
      second = queue.run('cart', () => {
        order[order.length] = 'second';
        return 'second';
      });
    } finally {
      Object.defineProperty(Promise, 'resolve', resolve);
      Object.defineProperty(Promise.prototype, 'then', then);
    }
    if (!first || !second) throw new Error('Missing queued mutation completions');
    const firstValue = await first;
    const secondValue = await second;

    // SPEC §6.6/§10.4: authored Promise method replacement cannot suppress the queue's
    // framework-owned task start, settlement, or next-head continuation.
    expect(firstValue).toBe('first');
    expect(secondValue).toBe('second');
    expect(order).toEqual(['first', 'second']);
  });

  it('retains named queue state after late Map/Array method replacement', async () => {
    const queue = new MutationQueue({ timeoutMs: 0 });
    const get = Object.getOwnPropertyDescriptor(Map.prototype, 'get');
    const set = Object.getOwnPropertyDescriptor(Map.prototype, 'set');
    const push = Object.getOwnPropertyDescriptor(Array.prototype, 'push');
    const indexOf = Object.getOwnPropertyDescriptor(Array.prototype, 'indexOf');
    const splice = Object.getOwnPropertyDescriptor(Array.prototype, 'splice');
    if (!get || !set || !push || !indexOf || !splice) {
      throw new Error('Missing mutation queue collection security descriptors');
    }
    Object.defineProperty(Map.prototype, 'get', { ...get, value: () => undefined });
    Object.defineProperty(Map.prototype, 'set', {
      ...set,
      value: function (this: Map<unknown, unknown>) {
        return this;
      },
    });
    Object.defineProperty(Array.prototype, 'push', { ...push, value: () => 0 });
    Object.defineProperty(Array.prototype, 'indexOf', { ...indexOf, value: () => -1 });
    Object.defineProperty(Array.prototype, 'splice', { ...splice, value: () => [] });
    let first: Promise<string> | undefined;
    let second: Promise<string> | undefined;
    try {
      first = queue.run('cart', () => 'first');
      second = queue.run('cart', () => 'second');
      expect(queue.depth('cart')).toBe(2);
    } finally {
      Object.defineProperty(Map.prototype, 'get', get);
      Object.defineProperty(Map.prototype, 'set', set);
      Object.defineProperty(Array.prototype, 'push', push);
      Object.defineProperty(Array.prototype, 'indexOf', indexOf);
      Object.defineProperty(Array.prototype, 'splice', splice);
    }

    if (!first || !second) throw new Error('Missing queued mutation completions');
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(queue.pending('cart')).toBe(false);
  });

  it('rejects queue option accessors without invoking them', () => {
    let constructorReads = 0;
    const constructorOptions = Object.defineProperty({}, 'maxDepth', {
      get() {
        constructorReads += 1;
        return 1;
      },
    });
    expect(() => new MutationQueue(constructorOptions)).toThrow(
      'Kovo mutation queue maxDepth must be an own-data property.',
    );
    expect(constructorReads).toBe(0);

    const queue = new MutationQueue({ timeoutMs: 0 });
    let runReads = 0;
    const runOptions = Object.defineProperty({}, 'onTimeout', {
      get() {
        runReads += 1;
        return vi.fn();
      },
    });
    expect(() => queue.run('cart', () => 'value', runOptions)).toThrow(
      'Kovo mutation queue onTimeout must be an own-data property.',
    );
    expect(runReads).toBe(0);
  });

  it('snapshots an unstable timeout option carrier exactly once', async () => {
    vi.useFakeTimers();
    const queue = new MutationQueue({ timeoutMs: 10 });
    const accepted = vi.fn();
    const substituted = vi.fn();
    let descriptorReads = 0;
    const options = new Proxy<MutationQueueRunOptions>(
      {},
      {
        getOwnPropertyDescriptor(_target, property) {
          if (property !== 'onTimeout') return undefined;
          descriptorReads += 1;
          return {
            configurable: true,
            enumerable: true,
            value: descriptorReads === 1 ? accepted : substituted,
            writable: true,
          };
        },
      },
    );
    const completion = queue.run('cart', () => new Promise<string>(() => {}), options);
    const settled = completion.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);
    await expect(settled).resolves.toMatchObject({ name: 'AbortError' });
    expect(descriptorReads).toBe(1);
    expect(accepted).toHaveBeenCalledOnce();
    expect(substituted).not.toHaveBeenCalled();
  });
});
