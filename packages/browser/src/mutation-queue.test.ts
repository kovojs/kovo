import { describe, expect, it } from 'vitest';

import { MutationQueue } from './mutation-queue.js';

describe('mutation queue', () => {
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
});
