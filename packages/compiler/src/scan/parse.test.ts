import { describe, expect, it } from 'vitest';

import {
  arrowFunctionParts,
  documentElementActionFromZeroArgArrow,
  functionBodyPropertyAccessPaths,
  jsxElements,
  mutationHandlers,
  parseComponentModule,
  solePropertyAccessPath,
  soleWrappedPropertyAccessPath,
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

  it('extracts one property access from wrapped JSX expression text', () => {
    expect(soleWrappedPropertyAccessPath('expression.tsx', ' { cart.count } ')).toBe('cart.count');
    expect(soleWrappedPropertyAccessPath('expression.tsx', 'cart.count')).toBeNull();
    expect(soleWrappedPropertyAccessPath('expression.tsx', '{cart.count + 1}')).toBeNull();
  });

  it('extracts outer property access paths from function body source', () => {
    expect(
      functionBodyPropertyAccessPaths(
        'handler-expression.ts',
        'submit(item.id, cart.items?.length, state.count, "item.name")',
      ),
    ).toEqual(['item.id', 'cart.items?.length', 'state.count']);
  });

  it('records mutation handler property access paths with source spans', () => {
    const source = `
export const save = mutation('cart/save', {
  handler(input: Input, request: Request) {
    const text = "request.db";
    return request.db.insert(input);
  },
});
`;
    const [handler] = mutationHandlers(parseComponentModule('cart.mutation.ts', source));

    expect(handler?.bodyPropertyAccesses).toEqual([
      {
        end: source.indexOf('request.db.insert') + 'request.db.insert'.length,
        path: 'request.db.insert',
        start: source.indexOf('request.db.insert'),
      },
    ]);
    expect(handler?.paramNames).toEqual(['input', 'request']);
  });

  it('records simple destructured mutation handler parameter names', () => {
    const source = `
export const save = mutation('cart/save', {
  handler({ db }) {
    return db.insert(input);
  },
});
`;
    const [handler] = mutationHandlers(parseComponentModule('cart.mutation.ts', source));

    expect(handler?.paramNames).toEqual(['db']);
  });

  it('extracts string literal array values from expression source', () => {
    expect(stringLiteralArrayValues('expression.tsx', '["cart"]')).toEqual(['cart']);
    expect(stringLiteralArrayValues('expression.tsx', "['cart', 'productGrid']")).toEqual([
      'cart',
      'productGrid',
    ]);
    expect(stringLiteralArrayValues('expression.tsx', '[cart]')).toBeNull();
  });

  it('records zero-argument JSX arrow attribute body facts', () => {
    const source = `
export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => { log('item.id'); state.count += item.quantity; }}>Add</button>
  ),
});
`;
    const [button] = jsxElements(parseComponentModule('cart-actions.tsx', source));
    const click = button?.attributes.find((attribute) => attribute.name === 'onClick');

    expect(click?.zeroArgArrow).toEqual({
      body: "log('item.id'); state.count += item.quantity;",
      bodyEnd: source.indexOf(' }}>Add') + 1,
      bodyKind: 'block',
      bodyPropertyAccesses: [
        {
          end: source.indexOf('state.count') + 'state.count'.length,
          path: 'state.count',
          start: source.indexOf('state.count'),
        },
        {
          end: source.indexOf('item.quantity') + 'item.quantity'.length,
          path: 'item.quantity',
          start: source.indexOf('item.quantity'),
        },
      ],
      bodyStart: source.indexOf(" log('item.id');"),
      references: ['log', 'state', 'item'],
    });
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

  it('extracts document element method actions from zero-argument arrows', () => {
    expect(
      documentElementActionFromZeroArgArrow(
        'handler.tsx',
        "() => (document.getElementById('cart-drawer') as HTMLDialogElement).requestClose()",
      ),
    ).toEqual({
      action: 'method',
      method: 'requestClose',
      target: 'cart-drawer',
    });
    expect(
      documentElementActionFromZeroArgArrow(
        'handler.tsx',
        '() => document.getElementById(dynamicId)!.showModal()',
      ),
    ).toBeNull();
  });

  it('extracts matching document element open toggles from zero-argument arrows', () => {
    expect(
      documentElementActionFromZeroArgArrow(
        'handler.tsx',
        "() => document.getElementById('shipping')!.open = !document.getElementById('shipping')!.open",
      ),
    ).toEqual({
      action: 'toggle-open',
      target: 'shipping',
    });
    expect(
      documentElementActionFromZeroArgArrow(
        'handler.tsx',
        "() => document.getElementById('shipping')!.open = !document.getElementById('billing')!.open",
      ),
    ).toBeNull();
  });
});
