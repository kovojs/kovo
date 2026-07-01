import { describe, expect, it } from 'vitest';

import { queryBindingFromExpression, queryExpressionFromBinding } from './query-binding.js';

describe('query binding structural grammar', () => {
  it('parses refresh and args chain modifiers as binding metadata', () => {
    const expression = 'productQuery.refresh().args((params) => ({ id: params.id }))';

    expect(queryBindingFromExpression(expression)).toEqual({
      argsExpression: '({ id: params.id })',
      argsParam: 'params',
      argsPropertyAccesses: ['params.id'],
      hasRefresh: true,
      queryExpression: 'productQuery',
    });
    expect(queryExpressionFromBinding(expression)).toBe('productQuery');
  });
});
