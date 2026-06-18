// @kovojs-ir — lowered from site/tutorial/steps/07-verification/src/components/order-history.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `node site/tutorial/run-steps.mjs --write`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component } from '@kovojs/core';

import { orderHistoryQuery, type OrderHistoryResult } from '../queries.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Tutorial step 07 (chapter 7): the third commerce island. The native <ol>
// host keeps the HTML content model valid for its <li> children (KV225), so
// the compiler emits the order-history kovo-c identity stamp explicitly
// (SPEC.md section 4.2) along with the kovo-deps stamp from the queries
// declaration — the same shape as examples/commerce.

// snippet:order-history
export const OrderHistory = component({
  queries: { orderHistory: orderHistoryQuery },
  render: ({ orderHistory }: { orderHistory: OrderHistoryResult }) => (
    <ol kovo-c="order-history" kovo-deps="orderHistory" kovo-fragment-target="order-history" kovo-live-component="components/order-history/order-history">
      {orderHistory.items.map((item) => (
        <li kovo-key={item.id}>
          {escapeText(item.productId)} x {escapeText(item.qty)} - {escapeText(item.total)}
        </li>
      ))}
    </ol>
  ),
});
OrderHistory.name = "components/order-history/order-history";
// /snippet

export const OrderHistory$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: OrderHistory,
  componentId: "components/order-history/order-history",
}));
