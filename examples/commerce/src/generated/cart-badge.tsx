// @jiso-ir — lowered from examples/commerce/src/components/cart-badge.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { t } from '@jiso/server';

import { commerceMessages, type CartQueryResult } from '../app.js';
import { cartQuery } from '../queries.js';

// SPEC.md section 4.1: authored sugar carries no stamps. The compiler derives
// the fw-deps stamp from the queries declaration and the cart.count data-bind
// stamp from the sole-text-child expression (section 4.8). The lowered IR is
// committed at src/generated/cart-badge.tsx (scripts/emit-components.mjs) and
// is what the app imports at runtime, so served HTML carries derived stamps.
export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartQueryResult }) => (
    <cart-badge class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm" fw-deps="cart">
      <span>{t(commerceMessages, 'cartLabel')}</span>
      <span class="rounded bg-teal-600 px-2 py-0.5 text-white" data-bind="cart.count">{cart.count}</span>
    </cart-badge>
  ),
});
