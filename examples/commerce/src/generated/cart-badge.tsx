// @kovojs-ir — lowered from examples/commerce/src/components/cart-badge.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { t } from '@kovojs/server';

import { commerceMessages, type CartQueryResult } from '../app.js';
import { cartQuery } from '../queries.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


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
    <cart-badge class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm" kovo-deps="cart" kovo-fragment-target="cart-badge" kovo-live-component="components/cart-badge/cart-badge">
      <span>{t(commerceMessages, 'cartLabel')}</span>
      <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-xs font-semibold tabular-nums text-white" data-bind="cart.count">
        {cart.count}
      </span>
    </cart-badge>
  ),
});
CartBadge.name = "components/cart-badge/cart-badge";

export const CartBadge$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: CartBadge,
  componentId: "components/cart-badge/cart-badge",
}));
