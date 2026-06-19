// @kovojs-ir — lowered from examples/commerce/src/components/order-history.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component } from '@kovojs/core';
import { Badge } from '@kovojs/ui/badge';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import type { OrderHistoryResult } from '../domain.js';
import { orderHistoryQuery } from '../queries.js';
import { priceLabel } from './product-grid.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


const orderHistoryStyles = style.create({
  item: {
    alignItems: 'center',
    backgroundColor: tokens.sys.color.surfaceContainerLowest,
    borderColor: tokens.sys.color.outlineVariant,
    borderRadius: tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'flex',
    justifyContent: 'space-between',
    paddingBlock: 12,
    paddingInline: 16,
  },
  mutedText: {
    color: tokens.sys.color.onSurfaceVariant,
    fontSize: 12,
  },
  row: {
    alignItems: 'center',
    display: 'flex',
    gap: 16,
  },
  stack: {
    display: 'grid',
    gap: 16,
  },
  stackSm: {
    display: 'grid',
    gap: 4,
  },
  tabularStrong: {
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
  },
  title: {
    color: tokens.sys.color.onSurface,
    fontWeight: 600,
    letterSpacing: 0,
    margin: 0,
  },
});

export const orderHistoryStyleCss = style.emitAtomicCss(
  Object.values(orderHistoryStyles).flatMap((entry) => entry.__rules ?? []),
);

export const OrderHistory = component({
  queries: { orderHistory: orderHistoryQuery },
  render: ({ orderHistory }: { orderHistory: OrderHistoryResult }) => (
    <ol class="kv-order-history-d-1x60gr kv-order-history-gap-vivniy" data-style-src="examples/commerce/src/components/order-history.tsx#stack" kovo-c="order-history" kovo-deps="orderHistory" kovo-fragment-target="order-history" kovo-live-component="components/order-history/order-history">{renderOrderHistoryItems(orderHistory)}</ol>
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
        <li kovo-key={item.id} class="kv-order-history-align-1vxg5e kv-order-history-bg-18m7ru kv-order-history-bd-op7bl2 kv-order-history-bd-iktxcg kv-order-history-bd-4bkxwb kv-order-history-bd-3lxn3i kv-order-history-d-10jo0b kv-order-history-justify-15wv6m kv-order-history-pad-1b45q7 kv-order-history-pad-92euu" data-style-src="examples/commerce/src/components/order-history.tsx#item">
          <div class="kv-order-history-d-1x60gr kv-order-history-gap-1s2lxs" data-style-src="examples/commerce/src/components/order-history.tsx#stackSm">
            <span class="kv-order-history-fg-1h3b6s kv-order-history-font-1bl9ee kv-order-history-letter-1yuj1e kv-order-history-m-1m87zi" data-style-src="examples/commerce/src/components/order-history.tsx#title">{escapeText(item.productId)}</span>
            <span class="kv-order-history-fg-2xog1x kv-order-history-font-1pgyx3" data-style-src="examples/commerce/src/components/order-history.tsx#mutedText">Order {escapeText(item.id)}</span>
          </div>
          <div class="kv-order-history-align-1vxg5e kv-order-history-d-10jo0b kv-order-history-gap-vivniy" data-style-src="examples/commerce/src/components/order-history.tsx#row">
            {Badge.definition.render({ children: `×${item.qty}`, variant: 'neutral' })}
            <span class="kv-order-history-font-4v1il5 kv-order-history-font-1bl9ee" data-style-src="examples/commerce/src/components/order-history.tsx#tabularStrong">{priceLabel(item.total)}</span>
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
