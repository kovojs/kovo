/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { orderHistoryQuery, type OrderHistoryResult } from '../queries.js';

// Tutorial step 07 (chapter 7): the third commerce island. The native <ol>
// host keeps the HTML content model valid for its <li> children (KV225), so
// the compiler emits the order-history kovo-c identity stamp explicitly
// (SPEC.md section 4.2) along with the kovo-deps stamp from the queries
// declaration — the same shape as examples/commerce.

// snippet:order-history
export const OrderHistory = component({
  fragmentTarget: true,
  queries: { orderHistory: orderHistoryQuery },
  render: ({ orderHistory }: { orderHistory: OrderHistoryResult }) => (
    <ol>
      {orderHistory.items.map((item) => (
        <li kovo-key={item.id}>
          {item.productId} x {item.qty} - {item.total}
        </li>
      ))}
    </ol>
  ),
});
// /snippet
