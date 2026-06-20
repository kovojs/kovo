interface CartValue {
  count?: number;
}

// Query-derive over the cart: doubles the count. The derived-optimism test (C6) uses
// this to prove an OPTIMISTIC query prediction flows through a derived binding — not
// just the direct data-bind — and reconciles to server truth like the rest.
export function Cart$doubleCount(value: unknown): string {
  const cart = value as CartValue | undefined;
  return cart?.count != null ? String(cart.count * 2) : '';
}

export function applyCartDerives(value: unknown, root: Document): void {
  const text = Cart$doubleCount(value);
  for (const element of root.querySelectorAll('[data-testid="cart-double"]')) {
    element.textContent = text;
  }
}
