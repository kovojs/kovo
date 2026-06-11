// @jiso-ir — lowered from site/tutorial/steps/06-streaming/src/components/cart-badge.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `node site/tutorial/run-steps.mjs --write`.


/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';

import { cartQuery, type CartResult } from '../queries.js';

// Tutorial step 06 (chapter 6), unchanged from step 05: the badge is a fragment target the
// server re-renders standalone inside mutation responses (SPEC.md section
// 9.1).

// snippet:cart-badge
export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartResult }) => (
    <cart-badge fw-deps="cart">
      Cart: <span data-bind="cart.count">{cart.count}</span>
    </cart-badge>
  ),
});
// /snippet
