/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { cartQuery, type CartResult } from '../queries.js';

// Tutorial step 04 (chapter 4): the badge becomes a fragment target — the
// server can re-render it standalone inside a mutation response (SPEC.md
// section 9.1). fragmentTarget requires the render inputs to be ⊆ declared
// queries, so the server can always answer a re-render request (section 4.1).

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
