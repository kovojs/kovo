/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { t } from '@kovojs/server';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { commerceMessages, type CartQueryResult } from '../domain.js';
import { cartQuery } from '../queries.js';

const cartBadgeStyles = style.create({
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
});

export const cartBadgeStyleCss = style.emitAtomicCss(
  Object.values(cartBadgeStyles).flatMap((entry) => entry.__rules ?? []),
);

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartQueryResult }) => (
    <cart-badge style={cartBadgeStyles.badge}>
      <span>{t(commerceMessages, 'cartLabel')}</span>
      <span style={cartBadgeStyles.count}>{cart.count}</span>
    </cart-badge>
  ),
});
