/** @jsxImportSource @kovojs/server */
import { Badge } from '@kovojs/ui/badge';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import type { OrderHistoryResult } from '../domain.js';

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

interface OrderHistoryItem {
  id: string;
  productId: string;
  qty: number;
  total: number;
}

function priceLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function renderOrderHistoryItems(result: OrderHistoryResult): string {
  return (
    <>
      {result.items.map((item: OrderHistoryItem) => (
        <li kovo-key={item.id} style={orderHistoryStyles.item}>
          <div style={orderHistoryStyles.stackSm}>
            <span style={orderHistoryStyles.title}>{item.productId}</span>
            <span style={orderHistoryStyles.mutedText}>Order {item.id}</span>
          </div>
          <div style={orderHistoryStyles.row}>
            {Badge.definition.render({ children: `×${item.qty}`, variant: 'neutral' })}
            <span style={orderHistoryStyles.tabularStrong}>{priceLabel(item.total)}</span>
          </div>
        </li>
      ))}
    </>
  );
}

export function renderOrderHistory(result: OrderHistoryResult): string {
  return <ol style={orderHistoryStyles.stack}>{renderOrderHistoryItems(result)}</ol>;
}
