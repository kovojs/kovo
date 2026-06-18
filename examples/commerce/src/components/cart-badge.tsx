/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { t } from '@kovojs/server';

import { commerceMessages, type CartQueryResult } from '../domain.js';
import { cartQuery } from '../queries.js';

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartQueryResult }) => (
    <cart-badge class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm">
      <span>{t(commerceMessages, 'cartLabel')}</span>
      <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-xs font-semibold tabular-nums text-white">
        {cart.count}
      </span>
    </cart-badge>
  ),
});
