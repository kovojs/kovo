/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import type { OrderHistoryResult } from '../app.js';
import { orderHistoryQuery } from '../queries.js';

// SPEC.md section 4.1/4.2: authored sugar carries no stamps. The native <ol>
// host keeps the HTML content model valid for its <li> children (KV225), so
// the compiler emits the order-history kovo-c identity stamp explicitly
// (section 4.2) along with the kovo-deps stamp from the queries declaration.
// The lowered IR is committed at src/generated/order-history.tsx and is what
// the app imports at runtime.
export const OrderHistory = component({
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
