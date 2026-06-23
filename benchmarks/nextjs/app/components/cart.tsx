'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface Product {
  id: string;
  slug: string;
  name: string;
  price: number;
  blurb: string;
  img: string;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
}

interface CartContextValue {
  add(product: Product, qty?: number): void;
  count: number;
  items: CartItem[];
  open(): void;
  opened: boolean;
  setOpened(open: boolean): void;
  total: number;
}

const CartContext = createContext<CartContextValue | null>(null);

function price(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [opened, setOpened] = useState(false);
  const [ordered, setOrdered] = useState(false);
  const [email, setEmail] = useState('');

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((sum, item) => sum + item.qty, 0);
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    return {
      add(product, qty = 1) {
        setItems((current) => {
          const next = current.map((item) => ({ ...item }));
          const existing = next.find((item) => item.id === product.id);
          if (existing) existing.qty += qty;
          else next.push({ id: product.id, name: product.name, price: product.price, qty });
          return next;
        });
        setOrdered(false);
        setOpened(true);
      },
      count,
      items,
      open() {
        setOpened(true);
      },
      opened,
      setOpened,
      total,
    };
  }, [items, opened]);

  return (
    <CartContext.Provider value={value}>
      {children}
      {opened ? (
        <div className="modal-backdrop" data-cart-modal="">
          <section className="cart-dialog" role="dialog" aria-modal="true" aria-labelledby="cart-title">
            <header>
              <div>
                <h2 id="cart-title">Review cart</h2>
                <p>{value.count === 0 ? 'Your cart is ready for items.' : `${value.count} item(s) selected.`}</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => setOpened(false)}>
                Close
              </button>
            </header>
            <div className="cart-lines">
              {items.length === 0
                ? 'No items yet.'
                : items.map((item) => (
                    <div className="cart-line" key={item.id}>
                      <span>
                        {item.name} x {item.qty}
                      </span>
                      <strong>{price(item.price * item.qty)}</strong>
                    </div>
                  ))}
            </div>
            <div className="cart-total">
              <span>Total</span>
              <strong>{price(value.total)}</strong>
            </div>
            <form className="checkout">
              <label>
                Name
                <input name="name" autoComplete="name" />
              </label>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                />
              </label>
              <button className="primary-button" type="button" onClick={() => setOrdered(true)}>
                Place order
              </button>
            </form>
            {ordered ? (
              <p className="confirmation" role="status">
                Order placed. Confirmation sent to {email || 'the checkout email'}.
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </CartContext.Provider>
  );
}

function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('Cart components must render inside CartProvider.');
  return value;
}

export function CartButton() {
  const cart = useCart();
  return (
    <button className="cart-button" type="button" aria-label={`Open cart with ${cart.count} items`} onClick={cart.open}>
      Cart ({cart.count})
    </button>
  );
}

export function AddToCartButton({ product }: { product: Product }) {
  const cart = useCart();
  return (
    <button className="primary-button" type="button" onClick={() => cart.add(product)}>
      Add to cart
    </button>
  );
}
