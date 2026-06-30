import { describe, expect, it } from 'vitest';

import { reconcileKeyed } from './keyed-reconciler.js';
import { morphStructuralTree, type StructuralMorphNode } from './morph.js';

describe('keyed reconciliation kernel', () => {
  it('matches, removes, inserts, and reorders rows by key while preserving matched identity', () => {
    const current = [
      { key: 'a', value: 1 },
      { key: 'b', value: 2 },
      { key: 'c', value: 3 },
    ];
    const inserted = { key: 'd', value: 4 };

    const next = reconcileKeyed(current, [current[2]!, inserted, current[0]!], {
      create(item) {
        return { ...item };
      },
      currentKey(item) {
        return item.key;
      },
      match(currentItem, nextItem) {
        currentItem.value = nextItem.value;
        return currentItem;
      },
      nextKey(item) {
        return item.key;
      },
    });

    // SPEC.md §13.2: keyed identity, not position, owns reuse and order.
    expect(next.map((item) => item.key)).toEqual(['c', 'd', 'a']);
    expect(next[0]).toBe(current[2]);
    expect(next[1]).not.toBe(inserted);
    expect(next[2]).toBe(current[0]);
    expect(next).not.toContain(current[1]);
  });

  it('keeps structural morph duplicate-key diagnostics on the shared kernel adapter', () => {
    const current: StructuralMorphNode = {
      children: [
        { key: 'dup', type: 'li' },
        { key: 'dup', type: 'li' },
      ],
      type: 'ul',
    };

    expect(() =>
      morphStructuralTree(current, {
        children: [{ key: 'dup', type: 'li' }],
        type: 'ul',
      }),
    ).toThrow('Duplicate current structural morph key: dup');
  });
});
