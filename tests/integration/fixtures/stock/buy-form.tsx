/** @jsxImportSource @kovojs/server */
import { component, form, FormError } from '@kovojs/core';

import { buy } from './app';
import { itemQuery, type StockResult } from './shared';

interface OutOfStockFailure {
  code: 'OUT_OF_STOCK';
  payload: { available: number };
}

const buyForm = form<'stock/buy', Record<string, never>, OutOfStockFailure>('stock/buy');

export const BuyForm = component({
  mutations: { buy: buyForm },
  queries: { item: itemQuery },
  render: ({ item }: { item: StockResult }) => (
    <form mutation={buy} enhance>
      <stock-badge>
        <span>Stock:</span> <output>{item.stock}</output>
      </stock-badge>
      <FormError
        code="OUT_OF_STOCK"
        message={(failure: OutOfStockFailure) => `Sold out (${failure.payload.available} left)`}
      />
      <button type="submit">Buy</button>
    </form>
  ),
});
