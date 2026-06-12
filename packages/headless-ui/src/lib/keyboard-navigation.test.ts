import { describe, expect, it } from 'vitest';

import { moveCollectionIndex, navigationIntentFromKey } from './keyboard-navigation.js';

describe('headless-ui keyboard navigation', () => {
  it('maps APG-style collection keys by orientation and direction', () => {
    expect(navigationIntentFromKey('ArrowDown')).toBe('next');
    expect(navigationIntentFromKey('ArrowUp')).toBe('previous');
    expect(navigationIntentFromKey('ArrowRight', { orientation: 'horizontal' })).toBe('next');
    expect(navigationIntentFromKey('ArrowLeft', { orientation: 'horizontal' })).toBe('previous');
    expect(navigationIntentFromKey('ArrowRight', { dir: 'rtl', orientation: 'horizontal' })).toBe(
      'previous',
    );
    expect(navigationIntentFromKey('ArrowLeft', { dir: 'rtl', orientation: 'horizontal' })).toBe(
      'next',
    );
    expect(navigationIntentFromKey('ArrowRight', { orientation: 'vertical' })).toBeUndefined();
    expect(navigationIntentFromKey('Home')).toBe('first');
    expect(navigationIntentFromKey('End')).toBe('last');
  });

  it('moves across enabled collection items with wrapping by default', () => {
    const items = [{}, { disabled: true }, {}, {}];

    expect(moveCollectionIndex('next', { currentIndex: 0, items })).toBe(2);
    expect(moveCollectionIndex('previous', { currentIndex: 0, items })).toBe(3);
    expect(moveCollectionIndex('first', { currentIndex: 3, items })).toBe(0);
    expect(moveCollectionIndex('last', { currentIndex: 0, items })).toBe(3);
  });

  it('keeps the current item when non-looping movement would leave the collection', () => {
    const items = [{}, { disabled: true }, {}];

    expect(moveCollectionIndex('previous', { currentIndex: 0, items, loop: false })).toBe(0);
    expect(moveCollectionIndex('next', { currentIndex: 2, items, loop: false })).toBe(2);
  });

  it('returns -1 for first/last when every item is disabled', () => {
    const items = [{ disabled: true }, { disabled: true }];

    expect(moveCollectionIndex('first', { currentIndex: 0, items })).toBe(-1);
    expect(moveCollectionIndex('last', { currentIndex: 0, items })).toBe(-1);
  });
});
