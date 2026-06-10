import { describe, expect, it, vi } from 'vitest';

import {
  applyMutationResponse,
  createQueryStore,
  dispatchDelegatedEvent,
  hydrateQueryScripts,
  installJisoLoader,
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
});
