import { describe, expect, it } from 'vitest';

import { component, form, query, type JsonValue } from './index.js';

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
});
