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
// SPEC.md section 9.1: the `<cart-badge>` root is the live fragment-target host
// the inline-loader morph re-renders after addToCart. The morph resolves the
// page-side host by `kovo-c` / id / `kovo-fragment-target` — and the compiler
// stamps `kovo-c` only on standard-tag roots, not on a custom-element root whose
// tag already equals the component name. So we author an explicit
// `kovo-fragment-target` here (as the stackoverflow regions do) to give the
// custom-element root a resolvable host; without it the cart badge cannot morph
// in the browser. `kovo-fragment-target` is an authored attribute (not a lowered
// stamp), so it does not violate the section 4.8 "authored sugar carries no
// stamps" gate.
export const CartBadge = component({
  fragmentTarget: true,
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartQueryResult }) => (
    <cart-badge
      kovo-fragment-target="cart-badge"
      class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm"
    >
      <span>{t(commerceMessages, 'cartLabel')}</span>
      <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-xs font-semibold tabular-nums text-white">
        {cart.count}
      </span>
    </cart-badge>
  ),
});
