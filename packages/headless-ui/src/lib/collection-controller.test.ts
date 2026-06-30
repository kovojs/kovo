import { describe, expect, it } from 'vitest';

import {
  moveCollection,
  projectCollectionItems,
  typeaheadCollection,
} from './collection-controller.js';

describe('headless-ui collection controller', () => {
  const items = projectCollectionItems(
    [
      { disabled: false, label: 'Alpha', value: 'alpha' },
      { disabled: true, label: 'Beta', value: 'beta' },
      { label: 'Gamma', value: 'gamma' },
      { label: 'Delta', value: 'delta' },
    ],
    (item) => ({
      disabled: item.disabled,
      textValue: item.label,
      value: item.value,
    }),
  );

  it('projects items into frozen controller records', () => {
    expect(items).toEqual([
      { disabled: false, textValue: 'Alpha', value: 'alpha' },
      { disabled: true, textValue: 'Beta', value: 'beta' },
      { disabled: undefined, textValue: 'Gamma', value: 'gamma' },
      { disabled: undefined, textValue: 'Delta', value: 'delta' },
    ]);
    expect(Object.isFrozen(items)).toBe(true);
    expect(Object.isFrozen(items[0])).toBe(true);
  });

  it('moves through enabled items with Home/End and non-loop boundaries', () => {
    expect(moveCollection({ currentValue: 'alpha', items, key: 'ArrowDown' })).toEqual({
      highlightedIndex: 2,
      highlightedValue: 'gamma',
    });
    expect(moveCollection({ currentValue: 'gamma', items, key: 'Home' })).toEqual({
      highlightedIndex: 0,
      highlightedValue: 'alpha',
    });
    expect(moveCollection({ currentValue: 'alpha', items, key: 'End' })).toEqual({
      highlightedIndex: 3,
      highlightedValue: 'delta',
    });
    expect(moveCollection({ currentValue: 'alpha', items, key: 'ArrowUp', loop: false })).toEqual({
      highlightedIndex: 0,
      highlightedValue: 'alpha',
    });
  });

  it('honors orientation, direction, and disabled collection state', () => {
    expect(
      moveCollection({
        currentValue: 'gamma',
        dir: 'rtl',
        items,
        key: 'ArrowRight',
        orientation: 'horizontal',
      }),
    ).toEqual({ highlightedIndex: 0, highlightedValue: 'alpha' });
    expect(moveCollection({ disabled: true, items, key: 'ArrowDown' })).toBeUndefined();
    expect(moveCollection({ items, key: 'ArrowRight', orientation: 'vertical' })).toBeUndefined();
  });

  it('computes buffered typeahead results across enabled projected items', () => {
    expect(
      typeaheadCollection('d', {
        currentValue: 'alpha',
        items,
        now: 1000,
      }),
    ).toEqual({
      matchIndex: 3,
      state: { buffer: 'd', updatedAt: 1000 },
      value: 'delta',
    });
    expect(
      typeaheadCollection('b', {
        currentValue: 'alpha',
        items,
        now: 1000,
      }),
    ).toEqual({
      matchIndex: -1,
      state: { buffer: 'b', updatedAt: 1000 },
      value: 'alpha',
    });
  });
});
