'use client';

import { useState, type ReactNode } from 'react';

export function MatchedL1Shell({ basePath, children }: { basePath: string; children: ReactNode }) {
  const [count, setCount] = useState(0);
  const [email, setEmail] = useState('checkout@example.test');
  const [open, setOpen] = useState(false);
  const [ordered, setOrdered] = useState(false);

  return (
    <div className="shell" data-benchmark-lane="matched-l1">
      <nav className="nav">
        <a className="brand" href={basePath}>
          Benchmark Supply
        </a>
        <button
          className="cart-button"
          type="button"
          aria-label={`Open cart with ${count} items`}
          onClick={() => setOpen(true)}
        >
          Cart ({count})
        </button>
      </nav>
      {children}
      <div className="modal-backdrop" hidden={!open}>
        <section
          className="cart-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="matched-l1-cart-title"
        >
          <header>
            <div>
              <h2 id="matched-l1-cart-title">Review cart</h2>
              <p>Mutable cart, email, and order state are owned by this client island.</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </header>
          <div className="cart-lines">
            <div className="cart-line">
              <span>Benchmark item x {count}</span>
              <strong>$148.00</strong>
            </div>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setCount((value) => value + 1);
              setOrdered(false);
            }}
          >
            Add benchmark item
          </button>
          <form className="checkout" onSubmit={(event) => event.preventDefault()}>
            <label>
              Name
              <input name="name" autoComplete="name" />
            </label>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" value={email} readOnly />
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setEmail('alternate@example.test');
                setOrdered(false);
              }}
            >
              Use alternate email
            </button>
            <button className="primary-button" type="button" onClick={() => setOrdered(true)}>
              Place order
            </button>
          </form>
          <p className="confirmation" role="status" hidden={!ordered}>
            Order placed. Confirmation sent to <span>{email}</span>.
          </p>
        </section>
      </div>
    </div>
  );
}
