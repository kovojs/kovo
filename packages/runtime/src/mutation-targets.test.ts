import { describe, expect, it } from 'vitest';

import { readLiveTargets } from './mutation-targets.js';

class FakeTargetRoot {
  constructor(private readonly elements: FakeTargetElement[]) {}

  querySelectorAll(selector: string): Iterable<FakeTargetElement> {
    return selector === '[fw-deps]' ? this.elements : [];
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
  it('collects live DOM FW-Targets in first-seen order with dedupe and nullish id fallback', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement(
        { 'fw-deps': 'cart', 'fw-fragment-target': null },
        { id: 'cart-badge' },
      ),
      new FakeTargetElement({
        'fw-deps': 'inventory stock',
        'fw-fragment-target': 'inventory',
      }),
      new FakeTargetElement({
        'fw-deps': 'inventory stock',
        'fw-fragment-target': 'inventory',
      }),
      new FakeTargetElement({ 'fw-deps': 'debug', 'fw-fragment-target': '' }, { id: 'debug' }),
      new FakeTargetElement({
        'fw-deps': ' , ',
        'fw-fragment-target': 'empty-deps',
      }),
      new FakeTargetElement({ 'fw-deps': 'ignored' }),
    ]);

    // SPEC.md §9.1: enhanced mutations send FW-Targets from live fw-deps DOM stamps.
    expect(readLiveTargets(root)).toEqual([
      'cart-badge=cart',
      'inventory=inventory stock',
      'empty-deps',
    ]);
  });
});
