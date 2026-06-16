/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { cartQuery, type CartResult } from '../queries.js';

// Tutorial step 05 (chapter 5), unchanged from step 04: the badge is a fragment target the
// server re-renders standalone inside mutation responses (SPEC.md section
// 9.1).

// snippet:cart-badge
export const CartBadge = component({
  fragmentTarget: true,
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartResult }) => (
    <cart-badge>
      Cart: <span>{cart.count}</span>
    </cart-badge>
  ),
});
// /snippet
