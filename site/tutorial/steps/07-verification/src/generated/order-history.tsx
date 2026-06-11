// @jiso-ir — lowered from site/tutorial/steps/07-verification/src/components/order-history.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `node site/tutorial/run-steps.mjs --write`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';

import { orderHistoryQuery, type OrderHistoryResult } from '../queries.js';

// Tutorial step 07 (chapter 7): the third commerce island. The native <ol>
// host keeps the HTML content model valid for its <li> children (FW225), so
// the compiler emits the order-history fw-c identity stamp explicitly
// (SPEC.md section 4.2) along with the fw-deps stamp from the queries
// declaration — the same shape as examples/commerce.

// snippet:order-history
export const OrderHistory = component('order-history', {
  fragmentTarget: true,
  queries: { orderHistory: orderHistoryQuery },
  render: ({ orderHistory }: { orderHistory: OrderHistoryResult }) => (
    <ol fw-c="order-history" fw-deps="orderHistory">
      {orderHistory.items.map((item) => (
        <li fw-key={item.id}>
          {item.productId} x {item.qty} - {item.total}
        </li>
      ))}
    </ol>
  ),
});
// /snippet
