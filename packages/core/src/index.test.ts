import { describe, expect, it } from 'vitest';

import {
  component,
  event,
  form,
  formFields,
  query,
  type EventPayload,
  type FormFailure,
  type FormFieldName,
  type FormInput,
  type JsonValue,
} from './index.js';

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

  it('preserves query and form keys as typed authoring facts', () => {
    expect(query('cart').key).toBe('cart');
    expect(form('cart/add').key).toBe('cart/add');
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
