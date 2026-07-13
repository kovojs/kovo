import { describe, expect, it, vi } from 'vitest';
import { event } from '@kovojs/core/internal/event';

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

  it('rejects duplicate event names before server-fact registry disagreement', () => {
    expect(() =>
      createEventBus([
        event<'cart:added', { productId: string }>('cart:added', {
          serverFactKeys: ['productId'],
        }),
        event<'cart:added', { quantity: number }>('cart:added', {
          serverFactKeys: ['quantity'],
        }),
      ] as const),
    ).toThrow('Kovo event registry contains duplicate name: cart:added.');
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

  it('retains registry and query-confidentiality facts after late intrinsic poisoning', () => {
    const cartAdded = event<'cart:added', { productId: string }>('cart:added', {
      serverFactKeys: ['productId'],
    });
    const bus = createEventBus([cartAdded] as const, { queryDataKeys: ['productId'] });
    const get = Object.getOwnPropertyDescriptor(Map.prototype, 'get');
    const has = Object.getOwnPropertyDescriptor(Set.prototype, 'has');
    const keys = Object.getOwnPropertyDescriptor(Object, 'keys');
    const find = Object.getOwnPropertyDescriptor(Array.prototype, 'find');
    if (!get || !has || !keys || !find) throw new Error('Missing event security descriptors');
    Object.defineProperty(Map.prototype, 'get', { ...get, value: () => undefined });
    Object.defineProperty(Set.prototype, 'has', { ...has, value: () => false });
    Object.defineProperty(Object, 'keys', { ...keys, value: () => [] });
    Object.defineProperty(Array.prototype, 'find', { ...find, value: () => undefined });
    try {
      expect(() => bus.emit('cart:added', { productId: 'p1' })).toThrow(
        'Event payload overlaps query data; use a transform. event cart:added carries productId.',
      );
      expect(() => bus.emit('attacker' as never, {} as never)).toThrow(
        'Event is not declared in the registry: attacker',
      );
    } finally {
      Object.defineProperty(Map.prototype, 'get', get);
      Object.defineProperty(Set.prototype, 'has', has);
      Object.defineProperty(Object, 'keys', keys);
      Object.defineProperty(Array.prototype, 'find', find);
    }
  });

  it('retains listener dispatch and rejection reporting after late Promise/collection poisoning', async () => {
    const error = new Error('late listener failure');
    const onError = vi.fn();
    const bus = createEventBus([event<'cart:added', {}>('cart:added')] as const, { onError });
    const listener = vi.fn(async () => {
      throw error;
    });
    bus.on('cart:added', listener);
    const resolve = Object.getOwnPropertyDescriptor(Promise, 'resolve');
    const catchMethod = Object.getOwnPropertyDescriptor(Promise.prototype, 'catch');
    const get = Object.getOwnPropertyDescriptor(Map.prototype, 'get');
    const forEach = Object.getOwnPropertyDescriptor(Set.prototype, 'forEach');
    if (!resolve || !catchMethod || !get || !forEach) {
      throw new Error('Missing event continuation security descriptors');
    }
    Object.defineProperty(Promise, 'resolve', { ...resolve, value: () => ({ catch() {} }) });
    Object.defineProperty(Promise.prototype, 'catch', { ...catchMethod, value: () => undefined });
    Object.defineProperty(Map.prototype, 'get', { ...get, value: () => undefined });
    Object.defineProperty(Set.prototype, 'forEach', { ...forEach, value: () => undefined });
    try {
      bus.emit('cart:added', {});
    } finally {
      Object.defineProperty(Promise, 'resolve', resolve);
      Object.defineProperty(Promise.prototype, 'catch', catchMethod);
      Object.defineProperty(Map.prototype, 'get', get);
      Object.defineProperty(Set.prototype, 'forEach', forEach);
    }
    await Promise.resolve();

    // SPEC §4.3/§6.6: listener registry and continuation state are framework facts; late
    // Promise/Map/Set replacement cannot suppress dispatch or its error channel.
    expect(listener).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error, {
      event: { name: 'cart:added', payload: {} },
      phase: 'event-listener',
    });
  });
});
