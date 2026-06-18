import { describe, expect, it } from 'vitest';

import {
  createDelegatedHandlerContext,
  createIslandSignalScope,
  readElementParams,
  readElementState,
  readElementStateHost,
  writeElementState,
} from './handler-context.js';
import {
  readElementParams as readElementParamsFromBarrel,
  readElementState as readElementStateFromBarrel,
  writeElementState as writeElementStateFromBarrel,
} from './client.js';
import type { EventElementLike } from './events.js';

class FakeElement implements EventElementLike {
  attributes: { name: string; value: string }[];

  constructor(
    attributes: Record<string, string>,
    private readonly parent: FakeElement | null = null,
  ) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
  }

  closest(selector: string): FakeElement | null {
    if (selector === '[kovo-state]') return this.withAttribute('kovo-state');
    if (selector === '[kovo-c]') return this.withAttribute('kovo-c');
    return null;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }

    this.attributes.push({ name, value });
  }

  private withAttribute(name: string): FakeElement | null {
    if (this.getAttribute(name) !== null) return this;
    return this.parent?.withAttribute(name) ?? null;
  }
}

describe('handler context module', () => {
  it('is the public owner for delegated handler context helpers', () => {
    // SPEC.md §4.7: delegated handlers receive params, mutable state, and ctx.signal.
    expect(readElementParamsFromBarrel).toBe(readElementParams);
    expect(readElementStateFromBarrel).toBe(readElementState);
    expect(writeElementStateFromBarrel).toBe(writeElementState);
  });

  it('defaults missing or malformed serialized state to an empty object', () => {
    expect(readElementState(new FakeElement({}))).toEqual({});
    expect(readElementState(new FakeElement({ 'kovo-state': '{' }))).toEqual({});
  });

  it('parses typed data params for handler contexts', () => {
    expect(readElementParams(new FakeElement({ 'data-p-product-id': 'p1' }))).toEqual({
      productId: 'p1',
    });
    expect(
      readElementParams(
        new FakeElement({
          'data-p-featured': 'false',
          'data-p-product-id': 'p1',
          'data-p-quantity': '2',
          'kovo-param-types': 'quantity:number featured:boolean',
        }),
      ),
    ).toEqual({
      featured: false,
      productId: 'p1',
      quantity: 2,
    });
  });

  it('builds delegated context from the nearest state host and commits to that host', () => {
    const stateHost = new FakeElement({
      'kovo-c': 'cart-badge',
      'kovo-state': '{"count":1}',
    });
    const button = new FakeElement(
      {
        'data-p-quantity': '2',
        'kovo-param-types': 'quantity:number',
      },
      stateHost,
    );
    const context = createDelegatedHandlerContext(
      button,
      readElementStateHost(button) ?? button,
      createIslandSignalScope(),
    );

    expect(context.context.params).toEqual({ quantity: 2 });
    expect(context.context.state).toEqual({ count: 1 });

    (context.context.state as { count: number }).count += 1;
    context.commit();

    expect(stateHost.getAttribute('kovo-state')).toBe('{"count":2}');
    expect(button.getAttribute('kovo-state')).toBe(null);
  });
});
