import { describe, expect, it } from 'vitest';

import {
  component,
  event,
  form,
  formFields,
  fragmentTarget,
  query,
  type EventPayload,
  type FormFailure,
  type FormFieldName,
  type FormInput,
  type JsonValue,
} from './index.js';

declare module './index.js' {
  interface QueryRegistry {
    cart: { count: number };
  }

  interface MutationRegistry {
    'cart/add': unknown;
  }

  interface FragmentTargets {
    'cart-row': { rowId: string };
  }
}

describe('core authoring APIs', () => {
  it('preserves component names and definitions for compiler analysis', () => {
    const cart = query<'cart', { count: number }>('cart');
    const CartBadge = component('cart-badge', {
      fragmentTarget: true,
      queries: { cart },
      state: () => ({ bouncing: false }) satisfies JsonValue,
      render: ({ cart: cartQuery }, state) => ({ cartQuery, state }),
    });

    expect(CartBadge.name).toBe('cart-badge');
    expect(CartBadge.definition.fragmentTarget).toBe(true);
    expect(CartBadge.definition.queries?.cart.key).toBe('cart');
  });

  it('rejects non-JsonValue component state at authoring time', () => {
    const assertDateState = () => {
      component('clock-face', {
        render: () => null,
        // @ts-expect-error component state must satisfy JsonValue; Date cannot be serialized.
        state: () => ({ now: new Date() }),
      });
    };
    const assertMapState = () => {
      component('filter-panel', {
        render: () => null,
        // @ts-expect-error component state must satisfy JsonValue; Map cannot be serialized.
        state: () => ({ selected: new Map<string, string>() }),
      });
    };

    expect(assertDateState).toBeTypeOf('function');
    expect(assertMapState).toBeTypeOf('function');
  });

  it('preserves query and form keys as typed authoring facts', () => {
    expect(query('cart').key).toBe('cart');
    expect(form('cart/add').key).toBe('cart/add');

    const assertUnknownQuery = () => {
      // @ts-expect-error query keys are checked against generated QueryRegistry facts.
      query('missing-query');
    };
    const assertUnknownMutation = () => {
      // @ts-expect-error form keys are checked against generated MutationRegistry facts.
      form('missing/mutation');
    };
    expect(assertUnknownQuery).toBeTypeOf('function');
    expect(assertUnknownMutation).toBeTypeOf('function');
  });

  it('preserves typed form input and failure facts', () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK' }
    >('cart/add');
    const input = {
      productId: 'p1',
      quantity: 2,
    } satisfies FormInput<typeof addToCart>;
    const failure = {
      code: 'OUT_OF_STOCK',
    } satisfies FormFailure<typeof addToCart>;

    expect(addToCart.key).toBe('cart/add');
    expect(input.quantity).toBe(2);
    expect(failure.code).toBe('OUT_OF_STOCK');
  });

  it('checks form field completeness from typed mutation inputs', () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK' }
    >('cart/add');
    const fields = formFields(addToCart, ['productId', 'quantity'] as const);
    const fieldName = 'productId' satisfies FormFieldName<typeof addToCart>;

    expect(fields).toEqual(['productId', 'quantity']);
    expect(fieldName).toBe('productId');

    const assertMissingField = () => {
      // @ts-expect-error quantity is required by the mutation input schema.
      formFields(addToCart, ['productId'] as const);
    };
    const assertUnknownField = () => {
      // @ts-expect-error sku is not part of the mutation input schema.
      formFields(addToCart, ['productId', 'quantity', 'sku'] as const);
    };
    expect(assertMissingField).toBeTypeOf('function');
    expect(assertUnknownField).toBeTypeOf('function');
  });

  it('checks fragment target names and props from generated registry facts', () => {
    expect(fragmentTarget('cart-row', { rowId: 'row-1' })).toEqual({
      props: { rowId: 'row-1' },
      target: 'cart-row',
    });

    const assertUnknownTarget = () => {
      // @ts-expect-error fragment target names are checked against generated FragmentTargets facts.
      fragmentTarget('missing-target', {});
    };
    const assertMissingProp = () => {
      // @ts-expect-error rowId is required by the generated fragment target props.
      fragmentTarget('cart-row', {});
    };
    const assertUnknownProp = () => {
      // @ts-expect-error sku is not part of the generated fragment target props.
      fragmentTarget('cart-row', { rowId: 'row-1', sku: 'sku-1' });
    };

    expect(assertUnknownTarget).toBeTypeOf('function');
    expect(assertMissingProp).toBeTypeOf('function');
    expect(assertUnknownProp).toBeTypeOf('function');
  });

  it('preserves typed event names as registry facts', () => {
    const cartAdded = event<'cart:added', { productId: string; quantity: number }>('cart:added', {
      serverFactKeys: ['productId'],
    });
    const payload = {
      productId: 'p1',
      quantity: 2,
    } satisfies EventPayload<typeof cartAdded>;

    expect(cartAdded.name).toBe('cart:added');
    expect(cartAdded.serverFactKeys).toEqual(['productId']);
    expect(payload.quantity).toBe(2);

    const assertUnknownServerFactKey = () => {
      event<'cart:added', { productId: string; quantity: number }>('cart:added', {
        // @ts-expect-error sku is not part of the event payload.
        serverFactKeys: ['sku'],
      });
    };
    expect(assertUnknownServerFactKey).toBeTypeOf('function');
  });
});
