/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { t } from '@kovojs/server';
import * as style from '@kovojs/style';

import { commerceMessages, type CartQueryResult } from '../domain.js';
import { cartQuery } from '../queries.js';
import { commerceStyles } from '../styles.js';

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartQueryResult }) => (
    <cart-badge {...style.attrs(commerceStyles.cartBadge)}>
      <span>{t(commerceMessages, 'cartLabel')}</span>
      <span {...style.attrs(commerceStyles.cartCount)}>{cart.count}</span>
    </cart-badge>
  ),
});
