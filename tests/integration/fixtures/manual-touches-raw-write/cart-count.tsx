/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { cartQuery, type CartCountResult } from './shared';

export const CartCount = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartCountResult }) => (
    <output data-testid="cart-count">{cart.count}</output>
  ),
});
