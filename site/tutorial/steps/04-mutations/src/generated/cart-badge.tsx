// @kovojs-ir — lowered from site/tutorial/steps/04-mutations/src/components/cart-badge.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `node site/tutorial/run-steps.mjs --write`.
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { cartQuery, type CartResult } from '../queries.js';

// Tutorial step 04 (chapter 4): declared queries make the badge an inferred
// server-refreshable fragment target (SPEC.md sections 4.1 and 9.1).

// snippet:cart-badge
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartResult }) => (
    <cart-badge kovo-deps="cart" kovo-fragment-target="cart-badge">
      Cart: <span data-bind="cart.count">{cart.count}</span>
    </cart-badge>
  ),
});
CartBadge.name = "components/cart-badge/cart-badge";
// /snippet
