import { describe, expect, it, vi } from 'vitest';
import { event, form } from '@jiso/core';

import {
  applyFragments,
  applyOptimisticTransforms,
  applyMutationResponseToDom,
  applyMutationResponse,
  createEventBus,
  createQueryStore,
  createSubmitContext,
  dispatchDelegatedEvent,
  hydrateQueryScripts,
  installMutationBroadcast,
  installPagehideOptimismCleanup,
  installJisoLoader,
  MutationQueue,
  morphStructuralTree,
  OptimisticRebaser,
  parseHandlerReference,
  readElementParams,
  stampPendingQueries,
  submitEnhancedMutation,
  submitOptimisticEnhancedMutation,
  type DelegatedEvent,
  type EnhancedMutationFetchOptions,
  type EventElementLike,
  type StructuralMorphNode,
} from './index.js';

class FakeRoot {
  listeners = new Map<string, (event: DelegatedEvent) => void | Promise<void>>();

  addEventListener(type: string, listener: (event: DelegatedEvent) => void | Promise<void>): void {
    this.listeners.set(type, listener);
  }
}

class FakeElement implements EventElementLike {
  attributes: { name: string; value: string }[];

  constructor(attributes: Record<string, string>) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
  }

  closest(_selector: string): FakeElement {
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }
}

class FakeBroadcastChannel {
  messages: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

class FakeMorphTarget {
  html: string;

  constructor(html = '') {
    this.html = html;
  }

  replaceWithHtml(html: string): void {
    this.html = html;
  }
}

class FakeMorphRoot {
  deps: { id?: string; target?: string }[] = [];
  targets = new Map<string, FakeMorphTarget>();

  findFragmentTarget(target: string): FakeMorphTarget | null {
    return this.targets.get(target) ?? null;
  }

  querySelectorAll(_selector: string): Iterable<{
    getAttribute(name: string): string | null;
    id?: string;
  }> {
    return this.deps.map((dep) => ({
      getAttribute: (name) => (name === 'fw-fragment-target' ? (dep.target ?? null) : null),
      ...(dep.id ? { id: dep.id } : {}),
    }));
  }
}

class FakePendingElement {
  attributes: Record<string, string>;

  constructor(attributes: Record<string, string>) {
    this.attributes = { ...attributes };
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

class FakePendingRoot {
  constructor(readonly elements: FakePendingElement[]) {}

  querySelectorAll(_selector: string): Iterable<FakePendingElement> {
    return this.elements;
  }
}

describe('runtime loader', () => {
  it('registers delegated capture listeners without importing handler modules', () => {
    const root = new FakeRoot();
    const importModule = vi.fn();

    const loader = installJisoLoader({ importModule, root });

    expect(loader.events).toEqual(['click', 'submit', 'input', 'change']);
    expect([...root.listeners.keys()]).toEqual(['click', 'submit', 'input', 'change']);
    expect(importModule).not.toHaveBeenCalled();
  });

  it('imports and invokes a url#export handler only when a matching event arrives', async () => {
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ CartBadge$button_click: handler }));
    const element = new FakeElement({
      'data-p-item-id': 'i_42',
      'on:click': '/c/cart-badge.client.js#CartBadge$button_click',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(importModule).toHaveBeenCalledWith('/c/cart-badge.client.js');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'click' }),
      expect.objectContaining({ params: { itemId: 'i_42' } }),
    );
  });

  it('parses full handler references and data params', () => {
    expect(parseHandlerReference('/c/cart.client.js?v=1#Cart$remove')).toEqual({
      exportName: 'Cart$remove',
      url: '/c/cart.client.js?v=1',
    });
    expect(readElementParams(new FakeElement({ 'data-p-product-id': 'p1' }))).toEqual({
      productId: 'p1',
    });
  });
});

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
});

describe('query store', () => {
  it('hydrates fw-query scripts and immediately runs subscribed update plans', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('cart', plan);
    hydrateQueryScripts(store, [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":2}',
      },
    ]);

    expect(store.get('cart')).toEqual({ count: 2 });
    expect(plan).toHaveBeenCalledWith({ count: 2 });
  });

  it('runs update plans whenever a query value changes', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    const unsubscribe = store.subscribe<{ count: number }>('cart', plan);
    store.set('cart', { count: 1 });
    unsubscribe();
    store.set('cart', { count: 2 });

    expect(plan).toHaveBeenCalledTimes(1);
    expect(plan).toHaveBeenCalledWith({ count: 1 });
  });

  it('registers refetch-on-focus and visibility listeners without invoking them eagerly', async () => {
    const root = new FakeRoot();
    const refetchOnFocus = vi.fn();

    installJisoLoader({
      importModule: vi.fn(),
      refetchOnFocus,
      root,
    });

    expect(root.listeners.has('visibilitychange')).toBe(true);
    expect(root.listeners.has('focus')).toBe(true);
    expect(refetchOnFocus).not.toHaveBeenCalled();

    await root.listeners.get('focus')?.({ target: null, type: 'focus' });

    expect(refetchOnFocus).toHaveBeenCalledTimes(1);
  });

  it('registers pagehide optimism cleanup without unload handlers', () => {
    const root = new FakeRoot();
    const discardPendingOptimism = vi.fn();

    installPagehideOptimismCleanup({ discardPendingOptimism, root });

    expect(root.listeners.has('pagehide')).toBe(true);
    expect(root.listeners.has('unload')).toBe(false);

    void root.listeners.get('pagehide')?.({ target: null, type: 'pagehide' });

    expect(discardPendingOptimism).toHaveBeenCalledTimes(1);
  });

  it('applies mutation response query chunks and returns fragment chunks for morphing', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('cart', plan);
    const applied = applyMutationResponse(
      store,
      [
        '<fw-query name="cart">{"count":3}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>3</cart-badge></fw-fragment>',
      ].join('\n'),
    );

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(plan).toHaveBeenCalledWith({ count: 3 });
    expect(applied).toEqual({
      fragments: [{ html: '<cart-badge>3</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
  });

  it('accepts escaped JSON from text/html-compatible fw-query chunks', () => {
    const store = createQueryStore();

    applyMutationResponse(store, '<fw-query name="cart">{&quot;count&quot;:4}</fw-query>');

    expect(store.get('cart')).toEqual({ count: 4 });
  });

  it('rebroadcasts and applies mutation responses for same-user tab sync', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const onChanges = vi.fn();
    const broadcast = installMutationBroadcast({ channel, onChanges, store });

    broadcast.publish('<fw-query name="cart">{"count":5}</fw-query>', [
      { domain: 'cart', input: { productId: 'p1' } },
    ]);
    expect(channel.messages).toEqual([
      {
        body: '<fw-query name="cart">{"count":5}</fw-query>',
        changes: [{ domain: 'cart', input: { productId: 'p1' } }],
        type: 'jiso:mutation-response',
      },
    ]);

    channel.onmessage?.({
      data: {
        body: '<fw-query name="cart">{"count":6}</fw-query>',
        changes: [{ domain: 'cart', keys: ['cart_1'] }],
        type: 'jiso:mutation-response',
      },
    });

    expect(store.get('cart')).toEqual({ count: 6 });
    expect(onChanges).toHaveBeenCalledWith([{ domain: 'cart', keys: ['cart_1'] }]);
  });

  it('applies hand-written optimistic transforms through query update plans', () => {
    const store = createQueryStore();
    const plan = vi.fn();
    store.set('cart', { count: 1 });
    store.subscribe('cart', plan);

    const pending = applyOptimisticTransforms(
      store,
      { quantity: 2 },
      {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
    );

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(plan).toHaveBeenLastCalledWith({ count: 3 });
    pending.commit();
    expect(pending.snapshot.size).toBe(0);
  });

  it('restores optimistic snapshots on mutation error', () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });

    const pending = applyOptimisticTransforms(
      store,
      { quantity: 2 },
      {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
    );

    expect(store.get('cart')).toEqual({ count: 3 });
    pending.restore();
    expect(store.get('cart')).toEqual({ count: 1 });
  });

  it('stamps and clears pending state on islands consuming optimistic queries', () => {
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const recommendations = new FakePendingElement({ 'fw-deps': 'product:p1 cart' });
    const profile = new FakePendingElement({ 'fw-deps': 'profile' });
    const root = new FakePendingRoot([cartBadge, recommendations, profile]);

    expect(stampPendingQueries(root, ['cart'], true)).toEqual(['cart', 'product:p1,cart']);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
    expect(recommendations.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
    expect(profile.attributes).not.toHaveProperty('fw-pending');

    expect(stampPendingQueries(root, ['cart'], false)).toEqual(['cart', 'product:p1,cart']);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(recommendations.attributes).not.toHaveProperty('fw-pending');
    expect(recommendations.attributes).not.toHaveProperty('aria-busy');
  });

  it('rebases pending optimistic transforms over arriving server truth', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const transform = (current: unknown, input: { quantity: number }) => {
      const cart = current as { count: number };
      return { count: cart.count + input.quantity };
    };

    rebaser.add('m1', { quantity: 1 }, { transforms: { cart: transform } });
    rebaser.add('m2', { quantity: 2 }, { transforms: { cart: transform } });

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(rebaser.pendingCount('cart')).toBe(2);

    rebaser.applyServerTruth('cart', { count: 10 });

    expect(store.get('cart')).toEqual({ count: 13 });

    rebaser.settle('m1');
    rebaser.applyServerTruth('cart', { count: 11 });

    expect(store.get('cart')).toEqual({ count: 13 });
    expect(rebaser.pendingCount('cart')).toBe(1);
  });

  it('discards pending optimistic transforms back to server truth on pagehide', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const transform = (current: unknown, input: { quantity: number }) => {
      const cart = current as { count: number };
      return { count: cart.count + input.quantity };
    };

    rebaser.add('m1', { quantity: 1 }, { transforms: { cart: transform } });
    rebaser.add('m2', { quantity: 2 }, { transforms: { cart: transform } });
    rebaser.applyServerTruth('cart', { count: 10 });

    expect(store.get('cart')).toEqual({ count: 13 });

    expect(rebaser.discardPendingOptimism()).toEqual(['cart']);

    expect(store.get('cart')).toEqual({ count: 10 });
    expect(rebaser.pendingCount('cart')).toBe(0);
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

  it('applies fragment chunks through the morph adapter', () => {
    const root = new FakeMorphRoot();
    root.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>old</cart-badge>'));

    expect(
      applyFragments(root, [
        { html: '<cart-badge>new</cart-badge>', target: 'cart-badge' },
        { html: '<aside>ignored</aside>', target: 'missing' },
      ]),
    ).toEqual(['cart-badge']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>new</cart-badge>');
  });

  it('morphs a structural tree to the next tree shape without DOM APIs', () => {
    const current: StructuralMorphNode = {
      children: [
        { key: 'total', text: 'Cart total: $4', type: 'span' },
        { text: 'stale helper', type: 'small' },
      ],
      props: { role: 'status' },
      type: 'cart-badge',
    };
    const next: StructuralMorphNode = {
      children: [
        {
          key: 'total',
          props: { 'data-bind': 'cart.total' },
          text: 'Cart total: $7',
          type: 'span',
        },
        { key: 'count', text: '2 items', type: 'strong' },
      ],
      props: { role: 'status', 'aria-live': 'polite' },
      type: 'cart-badge',
    };

    const result = morphStructuralTree(current, next);

    expect(result).toBe(current);
    expect(result).toEqual(next);
    expect(result.children?.[1]).not.toBe(next.children?.[1]);
  });

  it('preserves keyed structural node identity when sibling order changes', () => {
    const first: StructuralMorphNode = {
      children: [{ text: '$4', type: 'span' }],
      key: 'line:1',
      props: { 'data-id': 'line:1' },
      text: 'Coffee',
      type: 'li',
    };
    const second: StructuralMorphNode = {
      children: [{ text: '$3', type: 'span' }],
      key: 'line:2',
      props: { 'data-id': 'line:2' },
      text: 'Tea',
      type: 'li',
    };
    const current: StructuralMorphNode = {
      children: [first, second],
      type: 'ul',
    };
    const next: StructuralMorphNode = {
      children: [
        {
          children: [{ text: '$5', type: 'span' }],
          key: 'line:2',
          props: { 'data-id': 'line:2', 'data-selected': 'true' },
          text: 'Tea',
          type: 'li',
        },
        {
          children: [{ text: '$4', type: 'span' }],
          key: 'line:1',
          props: { 'data-id': 'line:1' },
          text: 'Coffee',
          type: 'li',
        },
      ],
      type: 'ul',
    };

    const result = morphStructuralTree(current, next);

    expect(result).toEqual(next);
    expect(result.children?.[0]).toBe(second);
    expect(result.children?.[1]).toBe(first);
  });

  it('updates query data and morphs fragments from one mutation response', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    root.targets.set('cart-badge', new FakeMorphTarget());

    const result = applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"count":7}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge><span data-bind="cart.count">7</span></cart-badge></fw-fragment>',
      ].join('\n'),
      root,
      store,
    });

    expect(result).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [
        {
          html: '<cart-badge><span data-bind="cart.count">7</span></cart-badge>',
          target: 'cart-badge',
        },
      ],
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 7 });
    expect(root.targets.get('cart-badge')?.html).toContain('data-bind="cart.count"');
  });

  it('submits enhanced mutation forms with live targets and applies the fragment response', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    root.deps = [{ id: 'cart-badge' }, { target: 'recommendations' }, { id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    root.targets.set('recommendations', new FakeMorphTarget());
    const formData = new FormData();
    formData.set('productId', 'p1');
    formData.set('quantity', '1');
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes'
            ? '[{"domain":"cart","input":{"productId":"p1","quantity":"1"}}]'
            : null;
        },
      },
      async text() {
        return [
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
          '<fw-fragment target="recommendations"><section></section></fw-fragment>',
        ].join('\n');
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData,
      idem: 'idem_01HX',
      root,
      store,
    });

    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_01HX',
        'FW-Targets': 'cart-badge,recommendations',
      },
      keepalive: true,
      method: 'POST',
    });
    expect(result).toEqual({
      appliedFragments: ['cart-badge', 'recommendations'],
      fragments: [
        { html: '<cart-badge>1</cart-badge>', target: 'cart-badge' },
        { html: '<section></section>', target: 'recommendations' },
      ],
      changes: [{ domain: 'cart', input: { productId: 'p1', quantity: '1' } }],
      idem: 'idem_01HX',
      queries: ['cart'],
      targets: ['cart-badge', 'recommendations'],
    });
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>1</cart-badge>');
    expect(root.targets.get('recommendations')?.html).toBe('<section></section>');
  });

  it('submits enhanced mutations with optimistic transforms and reconciles server truth', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 1 });

    const fetch = vi.fn(async () => {
      expect(store.get('cart')).toEqual({ count: 3 });
      expect(cartBadge.attributes).toMatchObject({
        'aria-busy': 'true',
        'fw-pending': '',
      });

      return {
        async text() {
          return [
            '<fw-query name="cart">{"count":4}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>4</cart-badge></fw-fragment>',
          ].join('\n');
        },
      };
    });

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_optimistic',
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

    expect(result.queries).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 4 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>4</cart-badge>');
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
          return `<fw-query name="cart">{"count":${quantity === '1' ? 1 : 3}}</fw-query>`;
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

    expect(order).toEqual(['1:optimistic', '1:fetch']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(queue.pending('cart')).toBe(true);

    releaseFirst?.();

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { idem: 'idem_first', queries: ['cart'] },
      { idem: 'idem_second', queries: ['cart'] },
    ]);
    expect(order).toEqual(['1:optimistic', '1:fetch', '1:released', '2:optimistic', '2:fetch']);
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
        return '<fw-query name="cart">{"count":2}</fw-query>';
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

  it('rebases other pending optimism while reconciling an optimistic submit', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    root.deps = [{ id: 'cart-badge' }];
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
          return '<fw-query name="cart">{"count":2}</fw-query>';
        },
      };
    });

    await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_first',
      input: { quantity: 2 },
      optimistic,
      pendingRoot,
      rebaser,
      root,
      store,
    });

    expect(store.get('cart')).toEqual({ count: 7 });
    expect(rebaser.pendingCount('cart')).toBe(1);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
  });

  it('discards optimistic state on enhanced mutation errors and applies the error fragment', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
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
    expect(cartForm.attributes).not.toHaveProperty('fw-pending');
    expect(cartForm.attributes).not.toHaveProperty('aria-busy');
    expect(root.targets.get('cart-form')?.html).toBe('<form>Out of stock</form>');
  });

  it('submits typed forms through a ctx.submit-style helper', async () => {
    const addToCart = form<'cart/add', { productId: string; quantity: number }>('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => {
      const body = options.body as FormData;

      expect(body.get('productId')).toBe('p1');
      expect(body.get('quantity')).toBe('2');

      return {
        async text() {
          return [
            '<fw-query name="cart">{"count":2}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
          ].join('\n');
        },
      };
    });
    const ctx = createSubmitContext({ fetch, root, store });

    const result = await ctx.submit(addToCart, {
      idem: 'idem_ctx',
      input: { productId: 'p1', quantity: 2 },
    });

    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: expect.any(FormData),
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_ctx',
        'FW-Targets': 'cart-badge',
      },
      keepalive: true,
      method: 'POST',
    });
    expect(result.appliedFragments).toEqual(['cart-badge']);
    expect(store.get('cart')).toEqual({ count: 2 });
  });

  it('passes typed validation failures from ctx.submit on 422 responses', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK' }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-error>{&quot;code&quot;:&quot;OUT_OF_STOCK&quot;}</fw-error>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    const result = await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 1 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({ code: 'OUT_OF_STOCK' });
    expect(result.fragments).toEqual([]);
  });
});
