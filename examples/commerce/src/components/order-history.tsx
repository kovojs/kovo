/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Badge } from '@kovojs/ui/badge';
import * as style from '@kovojs/style';

import type { OrderHistoryResult } from '../domain.js';
import { orderHistoryQuery } from '../queries.js';
import { commerceStyles } from '../styles.js';
import { priceLabel } from './product-grid.js';

export const OrderHistory = component({
  queries: { orderHistory: orderHistoryQuery },
  render: ({ orderHistory }: { orderHistory: OrderHistoryResult }) => (
    <ol {...style.attrs(commerceStyles.stack)}>{renderOrderHistoryItems(orderHistory)}</ol>
  ),
});

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
        <li kovo-key={item.id} {...style.attrs(commerceStyles.orderItem)}>
          <div {...style.attrs(commerceStyles.stackSm)}>
            <span {...style.attrs(commerceStyles.title)}>{item.productId}</span>
            <span {...style.attrs(commerceStyles.mutedText)}>Order {item.id}</span>
          </div>
          <div {...style.attrs(commerceStyles.row)}>
            {Badge.definition.render({ children: `×${item.qty}`, variant: 'neutral' })}
            <span {...style.attrs(commerceStyles.tabularStrong)}>{priceLabel(item.total)}</span>
          </div>
        </li>
      ))}
    </>
  );
}
