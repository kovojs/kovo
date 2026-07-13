/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { cartQuery, type CartResult } from './shared';

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartResult }) => (
    <section data-component="CartBadge">
      <h1>Cart</h1>
      <output>{cart.count}</output>
    </section>
  ),
});
