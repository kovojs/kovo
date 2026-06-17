import { describe, expect, it } from 'vitest';

import * as mutationTargetsModule from './mutation-targets.js';
import { readLiveTargetSnapshot, readLiveTargets } from './mutation-targets.js';

class FakeTargetRoot {
  queries = 0;

  constructor(private readonly elements: FakeTargetElement[]) {}

  querySelectorAll(selector: string): Iterable<FakeTargetElement> {
    this.queries += 1;
    return selector === '[kovo-deps]' ? this.elements : [];
  }
}

class FakeTargetElement {
  readonly id?: string;

  constructor(
    private readonly attrs: Record<string, string | null>,
    options: { id?: string } = {},
  ) {
    if (options.id !== undefined) {
      this.id = options.id;
    }
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
}

describe('mutation targets', () => {
  it('collects live DOM Kovo-Targets in first-seen order with dedupe and nullish id fallback', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement(
        {
          'kovo-deps': 'cart',
          'kovo-fragment-target': null,
          'kovo-live-component': 'components/cart/cart-badge/cart-badge',
        },
        { id: 'cart-badge' },
      ),
      new FakeTargetElement({
        'kovo-deps': 'inventory stock',
        'kovo-fragment-target': 'inventory',
        'kovo-live-component': 'components/inventory/inventory',
        'kovo-props': '{"warehouseId":"w1"}',
      }),
      new FakeTargetElement({
        'kovo-deps': 'inventory stock',
        'kovo-fragment-target': 'inventory',
        'kovo-live-component': 'components/inventory/duplicate',
        'kovo-props': '{"warehouseId":"w2"}',
      }),
      new FakeTargetElement({ 'kovo-deps': 'debug', 'kovo-fragment-target': '' }, { id: 'debug' }),
      new FakeTargetElement({
        'kovo-deps': ' , ',
        'kovo-fragment-target': 'empty-deps',
      }),
      new FakeTargetElement({ 'kovo-c': 'cart-summary', 'kovo-deps': 'cart summary' }),
      new FakeTargetElement({ 'kovo-deps': 'ignored' }),
    ]);

    // SPEC.md §9.1: enhanced mutations send Kovo-Targets from live kovo-deps DOM
    // stamps, including component stamps when no explicit target/id exists.
    expect(readLiveTargets(root)).toEqual([
      'cart-badge=cart',
      'inventory=inventory stock',
      'empty-deps',
      'cart-summary=cart summary',
    ]);
    expect(readLiveTargetSnapshot(root).header).toBe(
      'cart-badge=cart; inventory=inventory stock; empty-deps; cart-summary=cart summary',
    );
    expect(readLiveTargetSnapshot(root).liveHeader).toBe(
      'cart-badge#components/cart/cart-badge/cart-badge:{}; inventory#components/inventory/inventory:{"warehouseId":"w1"}; empty-deps#empty-deps:{}; cart-summary#cart-summary:{}',
    );
  });

  it('reads one live target snapshot for enhanced mutation request headers', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement({ 'kovo-deps': 'cart', 'kovo-fragment-target': null }, { id: 'cart' }),
      new FakeTargetElement({
        'kovo-deps': 'reviews',
        'kovo-fragment-target': 'reviews:p1',
        'kovo-live-component': 'components/reviews/reviews',
        'kovo-props': '{"productId":"p1"}',
      }),
    ]);

    const snapshot = readLiveTargetSnapshot(root);

    // SPEC.md §9.1: the enhanced mutation request and returned metadata use one
    // live Kovo-Targets snapshot, not separate compatibility serialization passes.
    expect(snapshot).toEqual({
      header: 'cart=cart; reviews:p1=reviews',
      liveHeader:
        'cart#cart:{}; reviews:p1#components/reviews/reviews:{"productId":"p1"}',
      liveTargets: [
        { component: 'cart', props: {}, target: 'cart' },
        {
          component: 'components/reviews/reviews',
          props: { productId: 'p1' },
          target: 'reviews:p1',
        },
      ],
      targets: ['cart=cart', 'reviews:p1=reviews'],
    });
    expect(root.queries).toBe(1);
    expect(Object.hasOwn(mutationTargetsModule, 'serializeLiveTargets')).toBe(false);
    expect(Object.hasOwn(mutationTargetsModule, 'serializeLiveTargetEntries')).toBe(false);
    expect(Object.hasOwn(mutationTargetsModule, 'liveTargetHeaderSeparator')).toBe(false);
  });
});
