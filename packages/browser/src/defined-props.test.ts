import { describe, expect, it } from 'vitest';

import { definedProps } from './defined-props.js';

describe('definedProps', () => {
  it('drops only undefined optional runtime props', () => {
    // SPEC.md §4.4 runtime wiring treats provided falsy values differently from absent options.
    expect(
      definedProps({
        empty: '',
        falseValue: false,
        missing: undefined,
        nil: null,
        zero: 0,
      }),
    ).toEqual({
      empty: '',
      falseValue: false,
      nil: null,
      zero: 0,
    });
  });
});
