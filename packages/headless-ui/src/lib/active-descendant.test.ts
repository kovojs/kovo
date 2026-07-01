import { describe, expect, it } from 'vitest';

import { activeDescendantId, describedByIds } from './active-descendant.js';

describe('headless-ui active descendant helpers', () => {
  it('prefers explicit item ids before falling back to synthesized option ids', () => {
    expect(
      activeDescendantId({
        fallbackId: (value) => `fallback-${value}`,
        highlightedValue: 'blue',
        itemId: (value) => (value === 'blue' ? 'item-blue' : undefined),
      }),
    ).toBe('item-blue');

    expect(
      activeDescendantId({
        fallbackId: (value) => `fallback-${value}`,
        highlightedValue: 'green',
        itemId: () => undefined,
      }),
    ).toBe('fallback-green');
  });

  it('omits the idref when no highlighted value exists', () => {
    expect(
      activeDescendantId({
        fallbackId: (value) => `fallback-${value}`,
        highlightedValue: undefined,
        itemId: () => 'item',
      }),
    ).toBeUndefined();
  });

  it('joins described-by ids while ignoring empty values', () => {
    expect(describedByIds('description', undefined, '', 'error')).toBe('description error');
    expect(describedByIds(undefined, '')).toBe('');
  });
});
