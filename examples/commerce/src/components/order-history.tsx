/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';

import type { CommerceDb } from '../app.js';
import { orderHistoryQuery } from '../queries.js';

// SPEC.md section 4.1/4.2: authored sugar carries no stamps. The native <ol>
// host keeps the HTML content model valid for its <li> children (FW225), so
// the compiler emits the order-history fw-c identity stamp explicitly
// (section 4.2) along with the fw-deps stamp from the queries declaration.
// The lowered IR is committed at src/generated/order-history.tsx and is what
// the app imports at runtime.
export const OrderHistory = component('order-history', {
  fragmentTarget: true,
  queries: { orderHistory: orderHistoryQuery },
  render: ({ orderHistory }: { orderHistory: { items: CommerceDb['orders'] } }) => (
    <ol>
      {orderHistory.items.map((item) => (
        <li fw-key={item.id}>
          {item.productId} x {item.qty} - {item.total}
        </li>
      ))}
    </ol>
  ),
});
