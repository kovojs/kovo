import { describe, expect, it } from 'vitest';

import { separatorRootAttributes } from './separator.js';

describe('headless-ui separator primitive', () => {
  it('builds decorative horizontal separator attributes by default', () => {
    expect(separatorRootAttributes()).toEqual({
      'data-orientation': 'horizontal',
      role: 'none',
    });
  });

  it('keeps decorative separators out of the accessibility tree by orientation', () => {
    expect(separatorRootAttributes({ orientation: 'vertical' })).toEqual({
      'data-orientation': 'vertical',
      role: 'none',
    });
  });

  it('builds explicit separator semantics when decoration is disabled', () => {
    expect(separatorRootAttributes({ decorative: false })).toEqual({
      'aria-orientation': 'horizontal',
      'data-orientation': 'horizontal',
      role: 'separator',
    });

    expect(separatorRootAttributes({ decorative: false, orientation: 'vertical' })).toEqual({
      'aria-orientation': 'vertical',
      'data-orientation': 'vertical',
      role: 'separator',
    });
  });

  it('returns frozen attribute records', () => {
    expect(Object.isFrozen(separatorRootAttributes())).toBe(true);
  });
});
