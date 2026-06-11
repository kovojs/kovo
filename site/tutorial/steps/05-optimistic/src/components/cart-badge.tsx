/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';

import { cartQuery, type CartResult } from '../queries.js';

// Tutorial step 05 (chapter 5), unchanged from step 04: the badge is a fragment target the
// server re-renders standalone inside mutation responses (SPEC.md section
// 9.1).

// snippet:cart-badge
export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartResult }) => (
    <cart-badge>
      Cart: <span>{cart.count}</span>
    </cart-badge>
  ),
});
// /snippet
