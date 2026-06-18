// @kovojs-ir — lowered from site/tutorial/steps/07-verification/src/components/cart-badge.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `node site/tutorial/run-steps.mjs --write`.
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { cartQuery, type CartResult } from '../queries.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Tutorial step 07 (chapter 7), unchanged from step 06: the badge is a fragment target the
// server re-renders standalone inside mutation responses (SPEC.md section
// 9.1).

// snippet:cart-badge
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartResult }) => (
    <cart-badge kovo-deps="cart" kovo-fragment-target="cart-badge" kovo-live-component="components/cart-badge/cart-badge">
      Cart: <span data-bind="cart.count">{cart.count}</span>
    </cart-badge>
  ),
});
CartBadge.name = "components/cart-badge/cart-badge";
// /snippet

export const CartBadge$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: CartBadge,
  componentId: "components/cart-badge/cart-badge",
}));
