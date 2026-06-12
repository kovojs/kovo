import { describe, expect, it } from 'vitest';

import { findMatchingToken, findStringEnd } from './text.js';

describe('compiler text scanner helpers', () => {
  it('skips template interpolations when finding a template literal end', () => {
    const source = '`color: ${theme.palette({ fallback: `blue ${shade}` })};`';

    expect(findStringEnd(source, 0, '`')).toBe(source.length - 1);
  });

  it('balances tokens around template literals with nested interpolation braces', () => {
    const source = '{ css: `a { color: ${palette({ fallback: `blue ${shade}` })}; }`, ok: true }';

    expect(findMatchingToken(source, 0, '{', '}')).toBe(source.length - 1);
  });
});
