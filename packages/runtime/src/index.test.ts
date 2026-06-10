import { describe, expect, it, vi } from 'vitest';

import {
  applyFragments,
  applyOptimisticTransforms,
  applyMutationResponseToDom,
  applyMutationResponse,
  createQueryStore,
  dispatchDelegatedEvent,
  hydrateQueryScripts,
  installMutationBroadcast,
  installJisoLoader,
  OptimisticRebaser,
  parseHandlerReference,
  readElementParams,
  type DelegatedEvent,
  type EventElementLike,
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
  targets = new Map<string, FakeMorphTarget>();

  findFragmentTarget(target: string): FakeMorphTarget | null {
    return this.targets.get(target) ?? null;
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
    const broadcast = installMutationBroadcast({ channel, store });

    broadcast.publish('<fw-query name="cart">{"count":5}</fw-query>');
    expect(channel.messages).toEqual([
      {
        body: '<fw-query name="cart">{"count":5}</fw-query>',
        type: 'jiso:mutation-response',
      },
    ]);

    channel.onmessage?.({
      data: {
        body: '<fw-query name="cart">{"count":6}</fw-query>',
        type: 'jiso:mutation-response',
      },
    });

    expect(store.get('cart')).toEqual({ count: 6 });
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
});
