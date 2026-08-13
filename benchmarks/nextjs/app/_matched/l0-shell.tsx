import type { ReactNode } from 'react';

export function MatchedL0Shell({ basePath, children }: { basePath: string; children: ReactNode }) {
  return (
    <div className="shell" data-benchmark-lane="matched-l0">
      <nav className="nav">
        <a className="brand" href={basePath}>
          Benchmark Supply
        </a>
        <button
          className="cart-button"
          type="button"
          aria-label="Open cart with 0 items"
          popoverTarget="matched-l0-cart"
        >
          Cart (0)
        </button>
      </nav>
      {children}
      <div
        id="matched-l0-cart"
        className="cart-dialog"
        role="dialog"
        aria-labelledby="matched-l0-cart-title"
        popover="auto"
      >
        <header>
          <div>
            <h2 id="matched-l0-cart-title">Review cart</h2>
            <p>Native cart controls require no framework client state.</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            popoverTarget="matched-l0-cart"
            popoverTargetAction="hide"
          >
            Close
          </button>
        </header>
        <form className="checkout" action={basePath} method="get">
          <label>
            Name
            <input name="name" autoComplete="name" />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" />
          </label>
          <button className="primary-button" type="submit">
            Continue with native navigation
          </button>
        </form>
      </div>
    </div>
  );
}
