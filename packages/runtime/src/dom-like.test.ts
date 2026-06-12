import { describe, expect, it } from 'vitest';

import { domAttributes } from './dom-like.js';

describe('DOM-like helpers', () => {
  it('normalizes iterable and array-like attribute collections', () => {
    const countAttribute = { name: 'data-p-count', value: '3' };
    const typeAttribute = { name: 'fw-param-types', value: 'count:number' };
    const attributes = [countAttribute, typeAttribute];
    const arrayLike: ArrayLike<{ name: string; value: string }> = {
      0: countAttribute,
      1: typeAttribute,
      length: 2,
    };

    expect(domAttributes(attributes)).toEqual(attributes);
    expect(domAttributes(arrayLike)).toEqual(attributes);
    expect(domAttributes(undefined)).toEqual([]);
  });
});
