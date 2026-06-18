// @kovojs-ir — lowered from examples/commerce/src/components/cart-badge.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { t } from '@kovojs/server';
import * as style from '@kovojs/style';

import { commerceMessages, type CartQueryResult } from '../domain.js';
import { cartQuery } from '../queries.js';
import { commerceStyles } from '../styles.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartQueryResult }) => (
    <cart-badge {...style.attrs(commerceStyles.cartBadge)} kovo-deps="cart" kovo-fragment-target="cart-badge" kovo-live-component="components/cart-badge/cart-badge">
      <span>{t(commerceMessages, 'cartLabel')}</span>
      <span {...style.attrs(commerceStyles.cartCount)} data-bind="cart.count">{cart.count}</span>
    </cart-badge>
  ),
});
CartBadge.name = "components/cart-badge/cart-badge";

export const CartBadge$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: CartBadge,
  componentId: "components/cart-badge/cart-badge",
}));
