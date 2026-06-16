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
    <cart-badge>
      Cart: <span>{cart.count}</span>
    </cart-badge>
  ),
});
// /snippet
