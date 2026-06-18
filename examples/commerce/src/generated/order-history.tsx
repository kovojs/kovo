// @kovojs-ir — lowered from examples/commerce/src/components/order-history.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component } from '@kovojs/core';
import { Badge } from '@kovojs/ui/badge';

import type { OrderHistoryResult } from '../domain.js';
import { orderHistoryQuery } from '../queries.js';
import { priceLabel } from './product-grid.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


export const OrderHistory = component({
  queries: { orderHistory: orderHistoryQuery },
  render: ({ orderHistory }: { orderHistory: OrderHistoryResult }) => (
    <ol class="grid gap-2" kovo-c="order-history" kovo-deps="orderHistory" kovo-fragment-target="order-history" kovo-live-component="components/order-history/order-history">{renderOrderHistoryItems(orderHistory)}</ol>
  ),
});
OrderHistory.name = "components/order-history/order-history";

interface OrderHistoryItem {
  id: string;
  productId: string;
  qty: number;
  total: number;
}

export function renderOrderHistoryItems(result: OrderHistoryResult): string {
  return (
    <>
      {result.items.map((item: OrderHistoryItem) => (
        <li
          kovo-key={item.id}
          class="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3"
        >
          <div class="grid gap-0.5">
            <span class="font-medium">{escapeText(item.productId)}</span>
            <span class="text-xs text-slate-500">Order {escapeText(item.id)}</span>
          </div>
          <div class="flex items-center gap-3">
            {Badge.definition.render({ children: `×${item.qty}`, variant: 'neutral' })}
            <span class="font-semibold tabular-nums">{priceLabel(item.total)}</span>
          </div>
        </li>
      ))}
    </>
  );
}

export const OrderHistory$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: OrderHistory,
  componentId: "components/order-history/order-history",
}));
