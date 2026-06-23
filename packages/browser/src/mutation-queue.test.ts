import { afterEach, describe, expect, it, vi } from 'vitest';

import { MutationQueue } from './mutation-queue.js';

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
});
