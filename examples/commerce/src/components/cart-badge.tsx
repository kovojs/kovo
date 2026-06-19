/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { t } from '@kovojs/server';
import * as style from '@kovojs/style';

import { commerceMessages, type CartQueryResult } from '../domain.js';
import { cartQuery } from '../queries.js';

const cartBadgeStyles = style.create({
  badge: {
    alignItems: 'center',
    backgroundColor: style.tokens.sys.color.surfaceContainerLowest,
    borderColor: style.tokens.sys.color.outlineVariant,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    color: style.tokens.sys.color.onSurface,
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 500,
    gap: 8,
    paddingBlock: 8,
    paddingInline: 12,
  },
  count: {
    alignItems: 'center',
    backgroundColor: style.tokens.sys.color.primary,
    borderRadius: style.tokens.sys.shape.cornerFull,
    color: style.tokens.sys.color.onPrimary,
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

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartQueryResult }) => (
    <cart-badge style={cartBadgeStyles.badge}>
      <span>{t(commerceMessages, 'cartLabel')}</span>
      <span style={cartBadgeStyles.count}>{cart.count}</span>
    </cart-badge>
  ),
});
