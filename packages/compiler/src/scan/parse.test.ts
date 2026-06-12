import { describe, expect, it } from 'vitest';

import {
  arrowFunctionParts,
  functionBodyPropertyAccessPaths,
  solePropertyAccessPath,
  stringLiteralArrayValues,
} from './parse.js';

describe('compiler scan parser helpers', () => {
  it('extracts one property access expression with optional receiver segments', () => {
    expect(solePropertyAccessPath('expression.tsx', 'cart.count')).toBe('cart.count');
    expect(solePropertyAccessPath('expression.tsx', 'cart.items?.name')).toBe('cart.items?.name');
    expect(solePropertyAccessPath('expression.tsx', 'cart.items?.details?.price')).toBe(
      'cart.items?.details?.price',
    );
  });

  it('rejects non-sole property access expressions', () => {
    expect(solePropertyAccessPath('expression.tsx', 'cart.count + 1')).toBeNull();
    expect(solePropertyAccessPath('expression.tsx', 'count')).toBeNull();
  });

  it('extracts outer property access paths from function body source', () => {
    expect(
      functionBodyPropertyAccessPaths(
        'handler-expression.ts',
        'submit(item.id, cart.items?.length, state.count, "item.name")',
      ),
    ).toEqual(['item.id', 'cart.items?.length', 'state.count']);
  });

  it('extracts string literal array values from expression source', () => {
    expect(stringLiteralArrayValues('expression.tsx', '["cart"]')).toEqual(['cart']);
    expect(stringLiteralArrayValues('expression.tsx', "['cart', 'productGrid']")).toEqual([
      'cart',
      'productGrid',
    ]);
    expect(stringLiteralArrayValues('expression.tsx', '[cart]')).toBeNull();
  });

  it('extracts concise arrow function parts through the TypeScript parser', () => {
    expect(arrowFunctionParts('expression.tsx', '(cart: Cart) => cart.count + ";"')).toEqual({
      expression: 'cart.count + ";"',
      param: 'cart',
    });
    expect(arrowFunctionParts('expression.tsx', 'cart => cart.count')).toEqual({
      expression: 'cart.count',
      param: 'cart',
    });
    expect(arrowFunctionParts('expression.tsx', 'cart => { return cart.count; }')).toBeNull();
  });
});
