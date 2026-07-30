import { describe, expect, it } from 'vitest';

import { allComponentOptionObjectEntries, parseComponentModule } from './parse.js';

describe('query binding structural grammar', () => {
  it('parses refresh and args chain modifiers as binding metadata', () => {
    const model = parseComponentModule(
      'product.tsx',
      `export const Product = component({
        queries: {
          product: productQuery.refresh().args((params) => ({ id: params.id, sku: params.items['sku'].value, tenant: params.scope().tenant })),
        },
        render() { return <main />; },
      });`,
    );
    const [binding] = allComponentOptionObjectEntries(model, 'queries');

    expect(binding?.queryBinding).toEqual({
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
      executable: true,
      hasRefresh: true,
      queryKeyExpression: 'productQuery',
      queryKeySpan: { end: 85, start: 73 },
      queryExpression: 'productQuery',
    });
  });
});
