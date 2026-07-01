import { describe, expect, it } from 'vitest';

import { queryBindingFromExpression, queryExpressionFromBinding } from './query-binding.js';

describe('query binding structural grammar', () => {
  it('parses refresh and args chain modifiers as binding metadata', () => {
    const expression =
      "productQuery.refresh().args((params) => ({ id: params.id, sku: params.items['sku'].value, tenant: params.scope().tenant }))";

    expect(queryBindingFromExpression(expression)).toEqual({
      argsExpression:
        "({ id: params.id, sku: params.items['sku'].value, tenant: params.scope().tenant })",
      argsParam: 'params',
      argsPropertyAccesses: [
        'params.id',
        'params.items.sku.value',
        'params.items',
        'params.scope().tenant',
        'params.scope',
      ],
      hasRefresh: true,
      queryExpression: 'productQuery',
    });
    expect(queryExpressionFromBinding(expression)).toBe('productQuery');
  });
});
