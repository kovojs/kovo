/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { t } from '@kovojs/server';

import { commerceMessages, type CartQueryResult } from '../app.js';
import { cartQuery } from '../queries.js';

// SPEC.md section 4.1: authored sugar carries no stamps. The compiler derives
// the kovo-deps stamp from the queries declaration and the cart.count data-bind
// stamp from the sole-text-child expression (section 4.8). The lowered IR is
// committed at src/generated/cart-badge.tsx (scripts/emit-components.mjs) and
// is what the app imports at runtime, so served HTML carries derived stamps.
//
// SPEC.md section 9.1: the `<cart-badge>` root is a live target candidate
// because it declares `queries`. The compiler derives the runtime
// `kovo-fragment-target` hook for the custom-element root; app TSX does not
// hand-author target strings it can derive from the component binding.
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartQueryResult }) => (
    <cart-badge class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm">
      <span>{t(commerceMessages, 'cartLabel')}</span>
      <span class="rounded bg-teal-600 px-2 py-0.5 text-white">{cart.count}</span>
    </cart-badge>
  ),
});
