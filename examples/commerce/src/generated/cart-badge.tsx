// @kovojs-ir — lowered from examples/commerce/src/components/cart-badge.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { t } from '@kovojs/server';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { commerceMessages, type CartQueryResult } from '../domain.js';
import { cartQuery } from '../queries.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


const cartBadgeStyles = style.create(
  {
    badge: {
      alignItems: 'center',
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderColor: tokens.sys.color.outlineVariant,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      color: tokens.sys.color.onSurface,
      display: 'inline-flex',
      fontSize: 14,
      fontWeight: 500,
      gap: 8,
      paddingBlock: 8,
      paddingInline: 12,
    },
    count: {
      alignItems: 'center',
      backgroundColor: tokens.sys.color.primary,
      borderRadius: tokens.sys.shape.cornerFull,
      color: tokens.sys.color.onPrimary,
      display: 'inline-flex',
      fontSize: 12,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 600,
      height: 20,
      justifyContent: 'center',
      minWidth: 20,
      paddingInline: 6,
    },
  }
);

export const cartBadgeStyleCss = style.emitAtomicCss(
  Object.values(cartBadgeStyles).flatMap((entry) => entry.__rules ?? []),
);

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartQueryResult }) => (
    <cart-badge class="kv-cart-badge-align-1n0np7 kv-cart-badge-bg-z64ku4 kv-cart-badge-bd-5rajyo kv-cart-badge-bd-zehgw2 kv-cart-badge-bd-169px8 kv-cart-badge-bd-19c8ne kv-cart-badge-fg-ulvh0s kv-cart-badge-d-rjc9a1 kv-cart-badge-font-wfjt8u kv-cart-badge-font-69d2ez kv-cart-badge-gap-th4gxo kv-cart-badge-pad-82ra0h kv-cart-badge-pad-1xb6c1" data-style-src="examples/commerce/src/components/cart-badge.tsx#badge" kovo-deps="cart" kovo-fragment-target="cart-badge" kovo-live-component="components/cart-badge/cart-badge">
      <span>{t(commerceMessages, 'cartLabel')}</span>
      <span class="kv-cart-badge-align-1n0np7 kv-cart-badge-bg-73eir6 kv-cart-badge-bd-1ans0m kv-cart-badge-fg-1d7izn kv-cart-badge-d-rjc9a1 kv-cart-badge-font-hgn7l4 kv-cart-badge-font-8pgwt0 kv-cart-badge-font-o2m1ue kv-cart-badge-h-1wd2oy kv-cart-badge-justify-olqh3l kv-cart-badge-min-6nuqyp kv-cart-badge-pad-88ob6b" data-style-src="examples/commerce/src/components/cart-badge.tsx#count" data-bind="cart.count">{cart.count}</span>
    </cart-badge>
  ),
});
CartBadge.name = "components/cart-badge/cart-badge";

export const CartBadge$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: CartBadge,
  componentId: "components/cart-badge/cart-badge",
}));
