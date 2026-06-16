/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { itemQuery, type StockResult } from './shared';

export const StockBadge = component('stock-badge', {
  fragmentTarget: true,
  queries: { item: itemQuery },
  render: ({ item }: { item: StockResult }) => (
    <stock-badge kovo-fragment-target="stock-badge">
      <span>Stock:</span> <output>{item.stock}</output>
    </stock-badge>
  ),
});
