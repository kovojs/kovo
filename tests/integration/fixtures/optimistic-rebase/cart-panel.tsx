/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { cartQuery, type CartSummary } from './shared';

// SPEC §9.1/§10.4: this compiler-generated query-backed target authorizes
// server truth for optimistic settlement. Its fragment is deliberately hidden:
// the visible optimistic panel is a query-plan consumer and must retain rebased
// pending transforms when an earlier mutation's fragment also arrives.
export const CartPanelAuthority = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartSummary }) => (
    <cart-panel-authority aria-hidden="true" hidden>
      <output>{cart.count}</output>
    </cart-panel-authority>
  ),
});
