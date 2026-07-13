/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { cartQuery, type CartItem, type CartResult } from './shared';

function CartRow({ item }: { item: CartItem }) {
  return (
    <li kovo-key={item.id} data-row={item.id}>
      <span data-bind=".qty">{item.qty}</span> <span data-bind=".name">{item.name}</span>
    </li>
  );
}

export const CartList = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartResult }) => (
    <cart-list>
      <ul data-bind-list="cart.items" kovo-key="id" aria-label="Cart items">
        {cart.items.map((item) => (
          <CartRow item={item} />
        ))}
        <template kovo-stamp>
          <CartRow item={{ id: '', name: '', qty: 0 }} />
        </template>
      </ul>
    </cart-list>
  ),
});
