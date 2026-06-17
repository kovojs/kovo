// @kovojs-ir — lowered from site/tutorial/steps/03-queries/src/components/cart-badge.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `node site/tutorial/run-steps.mjs --write`.
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { cartQuery, type CartResult } from '../queries.js';

// Tutorial step 03 (chapter 3): authored sugar carries no stamps (SPEC.md
// section 4.1). The compiler derives kovo-deps from the queries declaration and
// the data-bind stamp from the sole-text-child expression (section 4.8); the
// committed lowered IR in ../generated/ is what the app imports.

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
