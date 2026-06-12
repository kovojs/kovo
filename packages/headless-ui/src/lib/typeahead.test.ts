import { describe, expect, it } from 'vitest';

import { findTypeaheadMatch, nextTypeaheadState } from './typeahead.js';

describe('headless-ui typeahead', () => {
  it('builds a lower-cased buffer while keys arrive inside the timeout', () => {
    const first = nextTypeaheadState(undefined, 'A', 1000);
    const second = nextTypeaheadState(first, 'p', 1200);

    expect(second).toEqual({ buffer: 'ap', updatedAt: 1200 });
  });

  it('resets the buffer after the timeout and ignores non-printable keys', () => {
    const previous = { buffer: 'ap', updatedAt: 1000 };

    expect(nextTypeaheadState(previous, 'B', 2000)).toEqual({
      buffer: 'b',
      updatedAt: 2000,
    });
    expect(nextTypeaheadState(previous, 'ArrowDown', 1100)).toEqual(previous);
  });

  it('finds the next enabled item by text prefix with wrapping', () => {
    const items = [
      { textValue: 'Apple' },
      { disabled: true, textValue: 'Apricot' },
      { textValue: 'Banana' },
      { textValue: 'Avocado' },
    ];

    expect(findTypeaheadMatch({ currentIndex: 0, items, search: 'a' })).toBe(3);
    expect(findTypeaheadMatch({ currentIndex: 3, items, search: 'ap' })).toBe(0);
    expect(findTypeaheadMatch({ currentIndex: 0, items, search: 'ap', loop: false })).toBe(-1);
  });
});
