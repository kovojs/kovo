import { describe, expect, it, vi } from 'vitest';
import { event } from '@jiso/core';

import { createEventBus } from './events.js';

describe('typed event bus', () => {
  it('emits declared cross-island events with typed payloads', () => {
    const cartAdded = event<'cart:added', { productId: string; quantity: number }>('cart:added');
    const bus = createEventBus([cartAdded] as const);
    const listener = vi.fn();

    bus.on('cart:added', listener);
    bus.emit('cart:added', { productId: 'p1', quantity: 2 });

    expect(bus.events).toEqual(['cart:added']);
    expect(listener).toHaveBeenCalledWith({
      name: 'cart:added',
      payload: { productId: 'p1', quantity: 2 },
    });
  });

  it('unsubscribes typed event listeners', () => {
    const bus = createEventBus([event<'cart:added', { productId: string }>('cart:added')] as const);
    const listener = vi.fn();

    const subscription = bus.on('cart:added', listener);
    subscription.off();
    bus.emit('cart:added', { productId: 'p1' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects events that were not declared in the registry', () => {
    const bus = createEventBus([event<'cart:added', { productId: string }>('cart:added')] as const);

    expect(() => bus.emit('inventory:changed' as never, { sku: 'sku_1' } as never)).toThrow(
      'Event is not declared in the registry: inventory:changed',
    );
    expect(() => bus.on('inventory:changed' as never, vi.fn())).toThrow(
      'Event is not declared in the registry: inventory:changed',
    );
  });

  it('rejects event payloads that carry query data facts', () => {
    const cartAdded = event<'cart:added', { productId: string; quantity: number }>('cart:added', {
      serverFactKeys: ['productId'],
    });
    const bus = createEventBus([cartAdded] as const, { queryDataKeys: ['productId'] });

    expect(() => bus.emit('cart:added', { productId: 'p1', quantity: 2 })).toThrow(
      'Event payload overlaps query data; use a transform. event cart:added carries productId.',
    );
  });

  it('rejects undeclared actual payload keys that overlap query data', () => {
    const bus = createEventBus(
      [event<'cart:added', { productId: string; quantity: number }>('cart:added')] as const,
      { queryDataKeys: ['productId'] },
    );

    expect(() => bus.emit('cart:added', { productId: 'p1', quantity: 2 })).toThrow(
      'Event payload overlaps query data; use a transform. event cart:added carries productId.',
    );
  });

  it('reports async listener failures through the event bus error hook', async () => {
    const error = new Error('listener failed');
    const onError = vi.fn();
    const cartAdded = event<'cart:added', { productId: string }>('cart:added');
    const bus = createEventBus([cartAdded] as const, { onError });

    bus.on('cart:added', async () => {
      throw error;
    });
    bus.emit('cart:added', { productId: 'p1' });
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(error, {
      event: {
        name: 'cart:added',
        payload: { productId: 'p1' },
      },
      phase: 'event-listener',
    });
  });
});
