/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { cartQuery, type CartItem, type CartResult } from './shared';

function CartRow({ item }: { item: CartItem }) {
  return (
    <li data-row={item.id}>
      <span>{item.qty}</span> <span>{item.name}</span>
    </li>
  );
}

export const CartList = component({
  queries: { cart: cartQuery },
  render: ({ cart }: { cart: CartResult }) => (
    <cart-list>
      <ul aria-label="Cart items">
        {cart.items.map((item) => (
          <CartRow key={item.id} item={item} />
        ))}
      </ul>
    </cart-list>
  ),
});
