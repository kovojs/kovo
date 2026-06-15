// @jiso-ir — lowered from site/tutorial/steps/03-queries/src/components/cart-badge.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `node site/tutorial/run-steps.mjs --write`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';

import { cartQuery, type CartResult } from '../queries.js';

// Tutorial step 03 (chapter 3): authored sugar carries no stamps (SPEC.md
// section 4.1). The compiler derives fw-deps from the queries declaration and
// the data-bind stamp from the sole-text-child expression (section 4.8); the
// committed lowered IR in ../generated/ is what the app imports.

// snippet:cart-badge
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartResult }) => (
    <cart-badge fw-deps="cart">
      Cart: <span data-bind="cart.count">{cart.count}</span>
    </cart-badge>
  ),
});
// /snippet
