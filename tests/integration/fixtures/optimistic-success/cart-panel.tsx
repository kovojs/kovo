/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { cartQuery, type CartSummary } from './shared';

export const CartPanel = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartSummary }) => (
    <section id="cart-panel">
      <output>{cart.count}</output>
    </section>
  ),
});
