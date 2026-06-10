import { describe, expect, it, vi } from 'vitest';

import {
  dispatchDelegatedEvent,
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
