export interface CommerceCartPageMetaInput {
  count: number;
}

export function commerceCartPageMeta(cart: CommerceCartPageMetaInput) {
  return {
    description: `Browse products and checkout with ${cart.count} verifiable cart item.`,
    title: `Kovo Commerce (${cart.count})`,
  };
}
